// lint の判定部分(ファイルもネットワークも触らない純粋な関数)。
// 下書き(drafts/YYYY-MM-DD.md)を公開(entries/)に移してよいかを決める。

import { splitFrontMatter } from "./markdown.ts";
import type { FrontMatter } from "./markdown.ts";

/** 下書きの front matter にこの印があるものだけを検査する(エージェントが「仕上げた」と判断したときに付ける) */
export const READY_STATUS = "ready";

/** 用語ページ(Cosense)へのリンクは、この形でなければならない */
export const COSENSE_PREFIX = "https://scrapbox.io/mokumoku-ai/";

/** 1つの引用の上限(文字数)。本文の転載をしないため */
export const QUOTE_MAX_CHARS = 200;

/** 1つの下書きで生存確認する URL の上限 */
export const URL_CHECK_LIMIT = 30;

/** 用語1つの上限(文字数) */
export const TERM_MAX_CHARS = 60;

/** 公開済みの日記への追記であることを示す front matter の値(kind: addendum) */
export const ADDENDUM_KIND = "addendum";

/** 追記1回の上限(文字数)。日記をまるごと書き直して足すのを防ぐ */
export const ADDENDUM_MAX_CHARS = 4000;

/** 追記の見出し。lint が付ける(エージェントは書かない) */
export const ADDENDUM_HEADING = /^## 追記\((\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\)\s*$/;

/** 本文に無ければならない節 */
export const REQUIRED_SECTIONS: readonly string[] = ["## 読んだ記事", "## 感じたこと"];

const URL_PATTERN = /https?:\/\/[^\s<>()「」、。]+/g;

export function isReady(meta: FrontMatter): boolean {
  return typeof meta.status === "string" && meta.status.trim().toLowerCase() === READY_STATUS;
}

export function isAddendum(meta: FrontMatter): boolean {
  return typeof meta.kind === "string" && meta.kind.trim().toLowerCase() === ADDENDUM_KIND;
}

function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((s) => s.trim()).filter((s) => s !== "");
}

/** 文章の中の http(s) の URL(出てきた順、重複なし) */
export function extractUrls(text: string): string[] {
  const found = text.match(URL_PATTERN) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?)\]]+$/, "")))];
}

/** 公開の Web の URL か(IP アドレス直書きや localhost は、生存確認の対象にしない) */
export function isPublicWebUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
  return host.includes(".");
}

/** 引用(行頭が > の連続)を、直後の行と一緒に取り出す */
export function quoteBlocks(body: string): { text: string; next: string }[] {
  const lines = body.split("\n");
  const blocks: { text: string; next: string }[] = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("```")) inCode = !inCode;
    if (inCode || !/^>\s?/.test(lines[i])) continue;
    const quote: string[] = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
    let j = i;
    while (j < lines.length && lines[j].trim() === "") j++;
    blocks.push({ text: quote.join("\n"), next: lines[j] ?? "" });
    i--;
  }
  return blocks;
}

/** 本文の引用と URL の検査(日記にも追記にも使う) */
function bodyProblems(body: string): string[] {
  const problems: string[] = [];
  for (const q of quoteBlocks(body)) {
    const length = q.text.replace(/\s/g, "").length;
    if (length > QUOTE_MAX_CHARS) problems.push(`引用が長い(${length}文字。${QUOTE_MAX_CHARS}文字まで)`);
    if (extractUrls(q.text + "\n" + q.next).length === 0) {
      problems.push(`引用に出典のリンクが無い(引用の中か、直後の行に URL を書く): ${q.text.slice(0, 20)}…`);
    }
  }

  for (const url of extractUrls(body)) {
    if (!isPublicWebUrl(url)) {
      problems.push(`本文に公開の Web の URL でないものがある: ${url}`);
      continue;
    }
    const host = new URL(url).hostname.toLowerCase();
    const isCosense = host === "scrapbox.io" || host.endsWith(".scrapbox.io") || host === "cosen.se";
    if (isCosense && !url.startsWith(COSENSE_PREFIX)) {
      problems.push(`用語リンクは ${COSENSE_PREFIX}{用語} の形にする: ${url}`);
    }
  }
  return problems;
}

function sourceProblems(meta: FrontMatter): string[] {
  const problems: string[] = [];
  for (const s of asList(meta.sources)) {
    if (!isPublicWebUrl(s)) problems.push(`sources に公開の Web の URL でないものがある: ${s}`);
  }
  for (const t of asList(meta.terms)) {
    if (t.length > TERM_MAX_CHARS) problems.push(`terms の語が長すぎる(${TERM_MAX_CHARS}文字まで): ${t.slice(0, 20)}…`);
    if (/[\[\]\n]/.test(t) || /^https?:/.test(t)) problems.push(`terms には語だけを書く(URL や [ ] は書かない): ${t.slice(0, 40)}`);
  }
  return problems;
}

export interface DraftInput {
  /** ファイル名の日付(YYYY-MM-DD) */
  fileDate: string;
  /** ファイルの中身 */
  source: string;
  /** 今日(JST、YYYY-MM-DD) */
  today: string;
}

/**
 * ネットワークを使わない検査。問題の一覧を返す(空なら合格)。
 * 「AI が書いた旨の署名」は、サイトが記事の冒頭とフッターに入れるので、本文には求めない。
 */
export function staticProblems(input: DraftInput): string[] {
  const { meta, body } = splitFrontMatter(input.source);
  const problems: string[] = [];

  if (typeof meta.title !== "string" || meta.title.trim() === "") problems.push("front matter に title が無い");
  if (meta.date !== input.fileDate) problems.push(`front matter の date がファイル名の日付(${input.fileDate})と違う`);
  if (input.fileDate > input.today) problems.push("未来の日付の日記は公開しない");

  if (asList(meta.sources).length === 0) problems.push("front matter に sources(出典の URL)が無い");
  problems.push(...sourceProblems(meta));

  for (const heading of REQUIRED_SECTIONS) {
    const at = body.split("\n").findIndex((l) => l.trim() === heading);
    if (at < 0) {
      problems.push(`本文に「${heading}」の節が無い`);
      continue;
    }
    const rest = body.split("\n").slice(at + 1);
    const end = rest.findIndex((l) => /^##\s/.test(l));
    const section = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
    if (section === "") problems.push(`「${heading}」の節が空`);
  }

  problems.push(...bodyProblems(body));

  return problems;
}

/**
 * 公開済みの日記への追記(kind: addendum)の検査。日記と違い、節や sources は求めない。
 */
export function addendumProblems(input: DraftInput): string[] {
  const { meta, body } = splitFrontMatter(input.source);
  const problems: string[] = [];
  if (meta.date !== input.fileDate) problems.push(`front matter の date がファイル名の日付(${input.fileDate})と違う`);
  if (input.fileDate > input.today) problems.push("未来の日付の日記には追記できない");
  const length = body.replace(/\s/g, "").length;
  if (length === 0) problems.push("追記する内容が空");
  if (length > ADDENDUM_MAX_CHARS) {
    problems.push(`追記が長い(${length}文字。${ADDENDUM_MAX_CHARS}文字まで)。元の日記を書き写さず、足す内容だけを書く`);
  }
  if (body.split("\n").some((l) => /^##\s*追記/.test(l))) {
    problems.push("「## 追記」の見出しは書かない(見出しと日時は lint が付ける)");
  }
  problems.push(...sourceProblems(meta));
  problems.push(...bodyProblems(body));
  return problems;
}

/** front matter の行の並びに、リストの項目を足す(すでにある行は変えない) */
function addToList(front: string[], key: string, items: string[]): string[] {
  if (items.length === 0) return front;
  const out = [...front];
  const at = out.findIndex((l) => l.startsWith(`${key}:`));
  if (at < 0) return [...out, `${key}:`, ...items.map((x) => `  - ${x}`)];
  const scalar = out[at].slice(key.length + 1).trim();
  let end = at + 1;
  while (end < out.length && /^\s*-\s+/.test(out[end])) end++;
  const indent = end > at + 1 ? (/^\s*/.exec(out[at + 1])?.[0] ?? "  ") : "  ";
  const added = items.map((x) => `${indent}- ${x}`);
  if (scalar !== "") {
    // `key: 値` と1行で書かれていた場合は、リストに直してから足す
    out.splice(at, 1, `${key}:`, `${indent}- ${scalar}`, ...added);
    return out;
  }
  out.splice(end, 0, ...added);
  return out;
}

/**
 * 公開済みの日記に追記を足した中身を返す。元の本文は1文字も変えず、末尾に見出しつきで足す。
 * 追記の sources / terms のうち、まだ無いものだけを front matter に足す。
 */
export function applyAddendum(entry: string, addendum: string, at: { date: string; hhmm: string }): string {
  const text = entry.replace(/\r\n?/g, "\n");
  const add = splitFrontMatter(addendum);
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  let front = m ? m[1].split("\n") : [];
  const body = m ? text.slice(m[0].length) : text;
  const existing = splitFrontMatter(text).meta;
  for (const key of ["sources", "terms"]) {
    const have = new Set(asList(existing[key]));
    const fresh = [...new Set(asList(add.meta[key]))].filter((x) => !have.has(x));
    front = addToList(front, key, fresh);
  }
  const head = front.length > 0 ? `---\n${front.join("\n")}\n---\n` : "";
  return `${head}${body.replace(/\n*$/, "\n")}\n## 追記(${at.date} ${at.hhmm})\n\n${add.body.trim()}\n`;
}

/** 日記の最後の追記の日時(ISO 8601、JST)。追記が無ければ null */
export function lastAddendumAt(body: string): string | null {
  let last: string | null = null;
  for (const line of body.split("\n")) {
    const m = ADDENDUM_HEADING.exec(line);
    if (m) last = `${m[1]}T${m[2]}:00+09:00`;
  }
  return last;
}

/** 生存確認する URL(sources と本文のリンク。重複なし、上限あり) */
export function urlsToCheck(source: string): string[] {
  const { meta, body } = splitFrontMatter(source);
  const all = [...new Set([...asList(meta.sources), ...extractUrls(body)])].filter(isPublicWebUrl);
  return all.slice(0, URL_CHECK_LIMIT);
}

/**
 * alive   : 取れた
 * dead    : 無い(404 など)。不合格
 * retry   : サーバー側の一時的な失敗かもしれない。今回は公開せず、次の起床でもう一度試す
 * blocked : 機械からの取得を断られた(403 など)。あるかどうか分からないので、警告だけ出して通す
 */
export type LinkVerdict = "alive" | "dead" | "retry" | "blocked";

export function classifyStatus(status: number): LinkVerdict {
  if (status >= 200 && status < 400) return "alive";
  if (status === 401 || status === 403 || status === 405 || status === 429 || status === 451) return "blocked";
  if (status === 408 || status >= 500) return "retry";
  return "dead";
}

/** 公開するときの中身。front matter の status の行だけを取り除く */
export function toEntry(source: string): string {
  const text = source.replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return text;
  const kept = m[1].split("\n").filter((line) => !/^status:\s*/.test(line));
  return `---\n${kept.join("\n")}\n---\n${text.slice(m[0].length)}`;
}

/** journal に書く1行 */
export function lintLine(
  hhmm: string,
  draft: string,
  outcome: { published: string } | { appended: string } | { problems: string[] },
): string {
  if ("published" in outcome) return `- ${hhmm} lint ${draft} → 公開した(${outcome.published})`;
  if ("appended" in outcome) return `- ${hhmm} lint ${draft} → 追記した(${outcome.appended})`;
  return `- ${hhmm} lint ${draft} → 不合格: ${outcome.problems.join(" / ")}`;
}

/** 同じ結果を何度も journal に書かないための比較(時刻を除いた部分) */
export function lintLineKey(line: string): string {
  return line.replace(/^- \d{2}:\d{2} /, "");
}
