// wake: LLM を使わない起床判定。
//   1. 稼働時間外・二重起動なら何も書かずに終わる
//   2. フィードの新着を集めて state/candidates.json に積む
//   3. 起床理由があり、本日の上限内なら act=true を出力する
//   4. state/cursor.json と journal/ に今回の起床を記録する
//
// 実行: node tools/wake.ts   (Node.js 22.18 以上。TypeScript をそのまま実行する)
// 環境変数:
//   MOKUMOKU_TRIGGER  起動のきっかけ(github.event_name)。journal に書く
//   MOKUMOKU_NOW      現在時刻を差し替える(動作確認用。ISO 8601)
//   MOKUMOKU_ROOT     読み書きするリポジトリの場所を差し替える(動作確認用)

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

import {
  buildReasons,
  countQuestions,
  decide,
  detectNew,
  journalLine,
  LLM_DAILY_LIMIT,
  mergeSeen,
  pruneCandidates,
  toCandidates,
} from "./lib/core.ts";
import type { Candidate, Reason } from "./lib/core.ts";
import { FEEDS, fetchFeed } from "./lib/feed.ts";
import type { FeedCache } from "./lib/feed.ts";
import { gate, jst } from "./lib/time.ts";

interface Cursor {
  lastBeat: string | null;
  elapsedMinutes: number | null;
  trigger: string;
  act: boolean;
  reasons: Reason[];
  llm: { date: string; count: number; limit: number };
}

interface SeenFile {
  feeds: Record<string, FeedCache & { seen: string[] }>;
}

interface CandidatesFile {
  updatedAt: string;
  items: Candidate[];
}

const ROOT = process.env.MOKUMOKU_ROOT ?? join(import.meta.dirname ?? ".", "..");
const path = (...p: string[]) => join(ROOT, ...p);

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    console.warn(`読めないので初期値を使う: ${file}`);
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function output(name: string, value: string): void {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function triggerLabel(raw: string | undefined): string {
  if (raw === "workflow_dispatch") return "dispatch";
  if (raw === "schedule") return "schedule";
  return "local";
}

async function main(): Promise<void> {
  const now = process.env.MOKUMOKU_NOW ? new Date(process.env.MOKUMOKU_NOW) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("MOKUMOKU_NOW が日時として読めない");
  const today = jst(now);
  const trigger = triggerLabel(process.env.MOKUMOKU_TRIGGER);

  const cursorFile = path("state", "cursor.json");
  const prev = readJson<Partial<Cursor>>(cursorFile, {});
  const lastBeat = prev.lastBeat ?? null;

  // --- 関門: ここで終わる場合は何も書かない(コミットも発生しない)
  const g = gate(now, lastBeat);
  if (g.kind === "outside-hours") {
    console.log(`稼働時間外(JST ${today.hhmm})。何もしない`);
    output("beat", "false");
    output("act", "false");
    return;
  }
  if (g.kind === "too-soon") {
    console.log(`前回の起床から${g.minutes}分。二重起動とみなして何もしない`);
    output("beat", "false");
    output("act", "false");
    return;
  }

  // --- フィードの新着を集める(優先順。上位にある URL は下位から除外)
  const seenFile = path("state", "seen.json");
  const seen = readJson<SeenFile>(seenFile, { feeds: {} });
  seen.feeds ??= {};
  const candidatesFile = path("state", "candidates.json");
  let candidates = readJson<CandidatesFile>(candidatesFile, { updatedAt: "", items: [] }).items ?? [];

  const upper = new Set<string>();
  const errors: string[] = [];
  for (const def of FEEDS) {
    const state = seen.feeds[def.id] ?? { seen: [] };
    const res = await fetchFeed(def, { etag: state.etag, lastModified: state.lastModified });
    if (res.status === "error") {
      errors.push(`${def.name}(${res.error})`);
      console.warn(`${def.name}: 取得失敗 ${res.error}`);
    } else if (res.status === "not-modified") {
      console.log(`${def.name}: 変更なし(304)`);
    } else {
      const firstRun = state.seen.length === 0;
      const { fresh, duplicated } = detectNew(res.items, new Set(state.seen), upper, firstRun);
      console.log(
        `${def.name}: ${res.items.length}件中 新着${fresh.length}件` +
          (duplicated > 0 ? `、上位フィードと重複${duplicated}件` : "") +
          (firstRun ? "(初回のため先頭のみ)" : ""),
      );
      candidates = [...toCandidates(def, fresh, now), ...candidates];
      seen.feeds[def.id] = { ...res.cache, seen: mergeSeen(state.seen, res.items) };
    }
    for (const url of seen.feeds[def.id]?.seen ?? []) upper.add(url);
  }
  candidates = pruneCandidates(candidates, now);

  // --- 起床理由と判定
  const questionsFile = path("state", "questions.md");
  const questions = existsSync(questionsFile) ? countQuestions(readFileSync(questionsFile, "utf8")) : 0;
  const reasons = buildReasons({
    candidates,
    feeds: FEEDS,
    questions,
    diaryExists: existsSync(path("entries", `${today.date}.md`)),
    now,
  });
  const llmToday = prev.llm?.date === today.date ? (prev.llm.count ?? 0) : 0;
  const decision = decide(reasons, llmToday);
  if (decision.act) candidates = candidates.map((c) => ({ ...c, offered: true }));

  // --- 記録
  writeJson(seenFile, seen);
  writeJson(candidatesFile, { updatedAt: now.toISOString(), items: candidates } satisfies CandidatesFile);
  writeJson(cursorFile, {
    lastBeat: now.toISOString(),
    elapsedMinutes: g.elapsedMinutes,
    trigger,
    act: decision.act,
    reasons,
    llm: { date: today.date, count: decision.llmCount, limit: LLM_DAILY_LIMIT },
  } satisfies Cursor);

  const journalFile = path("journal", `${today.date}.md`);
  mkdirSync(dirname(journalFile), { recursive: true });
  if (!existsSync(journalFile)) writeFileSync(journalFile, `# ${today.date} の行動ログ\n\n`);
  const line = journalLine({ now, trigger, elapsedMinutes: g.elapsedMinutes, lastBeat, reasons, decision, errors });
  appendFileSync(journalFile, line + "\n");
  console.log(line);

  // Claude の step に渡す日付と時刻(JST)。自分で計算した値だけを出す(外部のテキストを出力に混ぜない)
  output("date", today.date);
  output("time", today.hhmm);
  // 関門を通った起床か。lint は、この回だけ動かす(関門で止まった回に commit を作らないため)
  output("beat", "true");
  output("act", String(decision.act));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
