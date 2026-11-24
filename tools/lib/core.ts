// wake の判断部分。ファイルにもネットワークにも触らない(テストしやすくするため)。

import type { FeedDef, FeedItem } from "./feed.ts";
import { GAP_WARN_MIN, jst } from "./time.ts";

/** 1日の LLM 起動上限 */
export const LLM_DAILY_LIMIT = 12;
/** 初めて読むフィードは、先頭のこの件数だけを新着として扱う(全件が新着になるのを防ぐ) */
export const FIRST_RUN_LIMIT = 3;
/** フィードごとに覚えておく既読 URL の数 */
export const SEEN_LIMIT = 500;
/** 候補を残しておく時間と、候補の最大件数 */
export const CANDIDATE_TTL_HOURS = 72;
export const CANDIDATE_LIMIT = 60;
/** 今日の日記が無いことを起床理由にし始める時刻(JST) */
export const DIARY_HOUR = 21;

export interface Candidate {
  feed: string;
  priority: number;
  title: string;
  url: string;
  published: string | null;
  bookmarks?: number;
  /** wake が見つけた時刻(ISO 8601) */
  foundAt: string;
  /** act=true の起床で一度でも提示したか。false のものが残っていれば起床理由になる */
  offered: boolean;
}

export interface Reason {
  kind: "tsukkomi" | "feed" | "questions" | "diary";
  detail: string;
}

/** 既読に無い URL を新着とする。上位フィードに既にある URL は除外する */
export function detectNew(
  items: readonly FeedItem[],
  seen: ReadonlySet<string>,
  upper: ReadonlySet<string>,
  firstRun: boolean,
): { fresh: FeedItem[]; duplicated: number } {
  const unseen = items.filter((i) => !seen.has(i.url));
  const fresh = unseen.filter((i) => !upper.has(i.url));
  return {
    fresh: firstRun ? fresh.slice(0, FIRST_RUN_LIMIT) : fresh,
    duplicated: unseen.length - fresh.length,
  };
}

/** 既読リストの先頭に今回の URL を足し、上限で切る */
export function mergeSeen(seen: readonly string[], items: readonly FeedItem[]): string[] {
  const merged = [...new Set([...items.map((i) => i.url), ...seen])];
  return merged.slice(0, SEEN_LIMIT);
}

export function toCandidates(def: FeedDef, items: readonly FeedItem[], now: Date): Candidate[] {
  return items.map((i) => ({
    feed: def.id,
    priority: def.priority,
    title: i.title,
    url: i.url,
    published: i.published,
    ...(i.bookmarks !== undefined ? { bookmarks: i.bookmarks } : {}),
    foundAt: now.toISOString(),
    offered: false,
  }));
}

/** 古い候補を捨て、優先順 → 新しい順に並べて上限で切る */
export function pruneCandidates(list: readonly Candidate[], now: Date): Candidate[] {
  const limit = now.getTime() - CANDIDATE_TTL_HOURS * 3600 * 1000;
  const byUrl = new Map<string, Candidate>();
  for (const c of list) {
    const found = Date.parse(c.foundAt);
    if (Number.isNaN(found) || found < limit) continue;
    if (!byUrl.has(c.url)) byUrl.set(c.url, c);
  }
  return [...byUrl.values()]
    .sort((a, b) => a.priority - b.priority || b.foundAt.localeCompare(a.foundAt))
    .slice(0, CANDIDATE_LIMIT);
}

/** questions.md のうち、行頭が "- [ ]" の行を数える */
export function countQuestions(markdown: string): number {
  return (markdown.match(/^- \[ \] \S/gm) ?? []).length;
}

export function buildReasons(input: {
  candidates: readonly Candidate[];
  feeds: readonly FeedDef[];
  questions: number;
  diaryExists: boolean;
  now: Date;
  /** 人間の行が増えた・変わったツッコミページの数(Cosense) */
  tsukkomi?: number;
}): Reason[] {
  const reasons: Reason[] = [];
  // ツッコミは人間からの指摘なので、最初に挙げる。ページ名や中身は理由に入れない(外部のテキストを行動ログに混ぜない)
  if ((input.tsukkomi ?? 0) > 0) reasons.push({ kind: "tsukkomi", detail: `ツッコミ 新着${input.tsukkomi}` });
  const parts: string[] = [];
  for (const f of input.feeds) {
    const n = input.candidates.filter((c) => c.feed === f.id && !c.offered).length;
    if (n > 0) parts.push(`${f.name} 新着${n}`);
  }
  if (parts.length > 0) reasons.push({ kind: "feed", detail: parts.join("、") });
  if (input.questions > 0) reasons.push({ kind: "questions", detail: `疑問キュー残${input.questions}` });
  if (!input.diaryExists && jst(input.now).hour >= DIARY_HOUR) {
    reasons.push({ kind: "diary", detail: "今日の日記が未作成" });
  }
  return reasons;
}

export interface Decision {
  act: boolean;
  /** この起床を含めた本日の LLM 起動回数 */
  llmCount: number;
  capped: boolean;
}

/** 理由があり、上限に達していなければ起こす */
export function decide(reasons: readonly Reason[], llmCountToday: number): Decision {
  if (reasons.length === 0) return { act: false, llmCount: llmCountToday, capped: false };
  if (llmCountToday >= LLM_DAILY_LIMIT) return { act: false, llmCount: llmCountToday, capped: true };
  return { act: true, llmCount: llmCountToday + 1, capped: false };
}

/** journal に書く1行。フィードのタイトルは入れない(外部テキストを行動ログに混ぜないため) */
export function journalLine(input: {
  now: Date;
  trigger: string;
  elapsedMinutes: number | null;
  lastBeat: string | null;
  reasons: readonly Reason[];
  decision: Decision;
  errors: readonly string[];
}): string {
  const t = jst(input.now);
  const elapsed = input.elapsedMinutes === null ? "初回" : `前回から${input.elapsedMinutes}分`;
  const sameDay = input.lastBeat !== null && jst(new Date(input.lastBeat)).date === t.date;
  const gap = sameDay && input.elapsedMinutes !== null && input.elapsedMinutes > GAP_WARN_MIN;
  const verdict = input.decision.act
    ? `act=true(本日${input.decision.llmCount}/${LLM_DAILY_LIMIT})`
    : input.decision.capped
      ? `act=false(上限${LLM_DAILY_LIMIT}回に到達)`
      : "act=false";
  const why = input.reasons.length > 0 ? `理由: ${input.reasons.map((r) => r.detail).join(" / ")}` : "理由なし";
  let line = `- ${t.hhmm} wake(${input.trigger})${elapsed}${gap ? " ⚠間隔超過" : ""} → ${verdict} ${why}`;
  if (input.errors.length > 0) line += ` ⚠取得失敗: ${input.errors.join("、")}`;
  return line;
}
