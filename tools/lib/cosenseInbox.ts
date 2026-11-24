// wake の Cosense 読み取り。認証なしの公開 API だけを使う。
//   - ページ名の一覧を state/known.txt に書く(既知ワードの台帳)
//   - 更新のあった「yyyy年M月d日のツッコミ」ページから、人間が書いた行だけを state/inbox/ に写す

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { humanDigestSource, humanLines, inboxText, isTsukkomiTitle, RESERVED_TITLES } from "./cosense.ts";
import { listPages, readPage } from "./cosenseApi.ts";

/** 1回の起床で読むツッコミページの上限 */
const TSUKKOMI_FETCH_LIMIT = 10;

export interface CosenseReadState {
  /** ツッコミページごとの、最後に見た更新時刻と、人間の行のダイジェスト */
  tsukkomi: Record<string, { updated: number; digest: string }>;
}

export interface CosenseReadResult {
  state: CosenseReadState;
  /** 人間の行が増えた・変わったツッコミページ */
  fresh: string[];
  known: number;
}

function writeIfChanged(file: string, text: string): void {
  if (existsSync(file) && readFileSync(file, "utf8") === text) return;
  writeFileSync(file, text);
}

export async function updateFromCosense(root: string, prev: CosenseReadState, fetchedAt: string): Promise<CosenseReadResult> {
  const state: CosenseReadState = { tsukkomi: { ...(prev.tsukkomi ?? {}) } };
  const pages = await listPages();

  // 既知ワード = 用語ページの名前(ツッコミと、設定・メンバーのページは除く)
  const reserved = new Set(RESERVED_TITLES.map((t) => t.toLowerCase()));
  const known = pages
    .map((p) => p.title)
    .filter((t) => !isTsukkomiTitle(t) && !reserved.has(t.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "ja"));
  writeIfChanged(join(root, "state", "known.txt"), known.length > 0 ? known.join("\n") + "\n" : "");

  const fresh: string[] = [];
  const updated = pages
    .filter((p) => isTsukkomiTitle(p.title) && p.updated > (state.tsukkomi[p.title]?.updated ?? 0))
    .slice(0, TSUKKOMI_FETCH_LIMIT);
  for (const p of updated) {
    const page = await readPage(p.title);
    if (page === null) continue;
    const before = state.tsukkomi[p.title];
    const digest = createHash("sha256").update(humanDigestSource(page)).digest("hex");
    // 人間の行が無い、または前回と同じ(エージェント自身の返信で更新されただけ)なら、起床理由にしない
    if (humanLines(page).length > 0 && digest !== before?.digest) {
      mkdirSync(join(root, "state", "inbox"), { recursive: true });
      writeFileSync(join(root, "state", "inbox", `${page.title}.md`), inboxText(page, before?.updated ?? null, fetchedAt));
      fresh.push(page.title);
    }
    state.tsukkomi[p.title] = { updated: p.updated, digest };
  }
  return { state, fresh, known: known.length };
}
