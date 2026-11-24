// Cosense の API を呼ぶ部分。
//   - 読み取りは、認証なしの公開 API を使う(wake と cosense-sync の両方)。
//   - 書き込みは、トークン(PAT)を付けて「preview → submit」の2段階で行う。
//     書き込み先の URL は、COSENSE_ORIGIN と COSENSE_PROJECT の定数からしか作らない。

import { COSENSE_ORIGIN, COSENSE_PROJECT, encodeTitle } from "./cosense.ts";
import type { Change, Page } from "./cosense.ts";
import { USER_AGENT } from "./feed.ts";

const TIMEOUT_MS = 20000;
const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 5000;

export class CosenseError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CosenseError";
    this.status = status;
  }
}

async function getJson(url: string): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) {
    await res.body?.cancel();
    return { status: 404, data: null };
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new CosenseError(res.status, `Cosense の読み取りに失敗(HTTP ${res.status})`);
  }
  return { status: res.status, data: await res.json() };
}

/** プロジェクトの全ページの名前と更新時刻(公開 API) */
export async function listPages(): Promise<{ title: string; updated: number }[]> {
  const out: { title: string; updated: number }[] = [];
  for (let skip = 0; skip < LIST_MAX_PAGES; skip += LIST_PAGE_SIZE) {
    const url = `${COSENSE_ORIGIN}/api/pages/${COSENSE_PROJECT}/?limit=${LIST_PAGE_SIZE}&skip=${skip}&sort=updated`;
    const { data } = await getJson(url);
    const d = data as { count?: number; pages?: { title?: unknown; updated?: unknown }[] } | null;
    const pages = d?.pages ?? [];
    for (const p of pages) {
      if (typeof p.title === "string") out.push({ title: p.title, updated: Number(p.updated) || 0 });
    }
    if (pages.length < LIST_PAGE_SIZE || out.length >= (d?.count ?? 0)) break;
  }
  return out;
}

/** ページを読む(公開 API)。無ければ null */
export async function readPage(title: string): Promise<Page | null> {
  const { status, data } = await getJson(`${COSENSE_ORIGIN}/api/pages/${COSENSE_PROJECT}/${encodeTitle(title)}`);
  if (status === 404 || data === null) return null;
  const d = data as { id?: unknown; title?: unknown; updated?: unknown; persistent?: unknown; lines?: unknown };
  if (d.persistent === false || typeof d.id !== "string" || typeof d.title !== "string" || !Array.isArray(d.lines)) return null;
  return {
    id: d.id,
    title: d.title,
    updated: Number(d.updated) || 0,
    lines: (d.lines as { id?: unknown; text?: unknown; userId?: unknown; updated?: unknown }[]).map((l) => ({
      id: String(l.id ?? ""),
      text: String(l.text ?? ""),
      userId: String(l.userId ?? ""),
      updated: Number(l.updated) || 0,
    })),
  };
}

/** トークンを付けた要求。別の場所への転送には付いていかない(redirect を追わない) */
async function authed(pat: string, method: "GET" | "POST", url: string, body?: unknown): Promise<unknown> {
  if (!url.startsWith(`${COSENSE_ORIGIN}/api/`)) throw new Error("Cosense 以外にはトークンを送らない");
  const res = await fetch(url, {
    method,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "x-personal-access-token": pat,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
    throw new CosenseError(res.status, `HTTP ${res.status} ${text}`);
  }
  return res.json();
}

/** トークンの持ち主の userId */
export async function whoami(pat: string): Promise<string> {
  const data = (await authed(pat, "GET", `${COSENSE_ORIGIN}/api/users/me`)) as { id?: unknown };
  return typeof data.id === "string" ? data.id : "";
}

export interface Preview {
  previewId: string;
  /** サーバーが適用したあとのページ名(同名のページがあると、別の名前にされることがある) */
  title: string;
  /** 新しく作られるページか */
  isNew: boolean;
}

/** 変更を仮に適用する。pageId が無ければ新しいページ(最初の行がページ名) */
export async function previewEdit(pat: string, pageId: string | null, changes: Change[]): Promise<Preview> {
  const url = `${COSENSE_ORIGIN}/api/pages/v2/${COSENSE_PROJECT}/page-edit-for-ai/preview`;
  const data = (await authed(pat, "POST", url, pageId === null ? { changes } : { pageId, changes })) as {
    previewId?: unknown;
    pagePreview?: { title?: unknown; persistent?: unknown } | null;
  };
  if (typeof data.previewId !== "string") throw new Error("preview の応答に previewId が無い");
  return {
    previewId: data.previewId,
    title: typeof data.pagePreview?.title === "string" ? data.pagePreview.title : "",
    isNew: data.pagePreview?.persistent === false,
  };
}

/** 仮の適用を確定する(previewId は1回だけ使える。約5分で失効する) */
export async function submitEdit(pat: string, previewId: string): Promise<{ title: string }> {
  const url = `${COSENSE_ORIGIN}/api/pages/v2/${COSENSE_PROJECT}/page-edit-for-ai/submit`;
  const data = (await authed(pat, "POST", url, { previewId })) as { page?: { title?: unknown } | null };
  return { title: typeof data.page?.title === "string" ? data.page.title : "" };
}
