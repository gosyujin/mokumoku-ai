// Cosense(Scrapbox)連携の判定部分(ファイルもネットワークも触らない純粋な関数)。
//   - 読み取り: ツッコミページから、人間が書いた行だけを取り出す
//   - 書き込み: エージェントが望む中身と、いまのページとの差分を作る(他人が書いた行は変えない)

import { extractUrls, isPublicWebUrl } from "./lint.ts";

export const COSENSE_ORIGIN = "https://scrapbox.io";
/** 書き込み先のプロジェクト。ここ以外には書かない(URL はこの定数からしか作らない) */
export const COSENSE_PROJECT = "mokumoku-ai";

/** 人間のアカウント(gosyujin)。この userId の行だけを、ツッコミとしてエージェントに渡す */
export const HUMAN_USER_IDS: readonly string[] = ["5d3666e602575b00172c53d8"];
/** エージェント用のアカウント(satoca)。書き込みに使うトークンは、このアカウントのものでなければならない */
export const AGENT_USER_ID = "60921a9653ca71001cb497d3";
/** エージェントの署名(プロジェクトは mokumoku-ai、書き手は gi-yoza) */
export const AGENT_ICON = "[gi-yoza.icon]";

export const TSUKKOMI_TITLE = /^\d{4}年\d{1,2}月\d{1,2}日のツッコミ$/;

/** エージェントに書かせないページ(設定・メンバーのページ・署名のアイコン) */
export const RESERVED_TITLES: readonly string[] = ["settings", "favicon", "gosyujin", "gosyujin_2", "satoca", "gi-yoza"];

export const TITLE_MAX_CHARS = 80;
export const PAGE_MAX_LINES = 300;
export const APPEND_MAX_LINES = 50;
export const LINE_MAX_CHARS = 1000;

/**
 * 用語ページの書式の版。書式の決まり(formatPageBody)を変えたら、数を上げる。
 * 送信済みかどうかの判定に混ぜてあるので、上げると全部の用語ページが1回だけ送り直される。
 */
export const PAGE_FORMAT = 2;

export interface Line {
  id: string;
  text: string;
  userId: string;
  /** 最後に変わった時刻(UNIX 秒) */
  updated?: number;
}

export interface Page {
  id: string;
  title: string;
  updated: number;
  lines: Line[];
}

/** サーバーに送る変更(cosense-cli の previewEdit と同じ形) */
export type Change =
  | { _insert: string; lines: { id: string; text: string } }
  | { _delete: string };

export function isTsukkomiTitle(title: string): boolean {
  return TSUKKOMI_TITLE.test(title);
}

/** ページの URL の末尾(空白は _ にする。Cosense の慣習) */
export function encodeTitle(title: string): string {
  return encodeURIComponent(title.replace(/ /g, "_"));
}

export function pageUrl(title: string): string {
  return `${COSENSE_ORIGIN}/${COSENSE_PROJECT}/${encodeTitle(title)}`;
}

/**
 * ファイル名(例: "eBPF.txt")からページ名を決める。使えない名前なら理由を返す。
 * ページ名はエージェントが決めるので、設定ページや他人のページを指せないようにする。
 */
export function titleFromFileName(name: string): { title: string } | { problem: string } {
  if (!name.endsWith(".txt")) return { problem: "拡張子が .txt ではない" };
  const title = name.slice(0, -4).normalize("NFC").trim();
  if (title === "") return { problem: "ページ名が空" };
  if (title.length > TITLE_MAX_CHARS) return { problem: `ページ名が長い(${TITLE_MAX_CHARS}文字まで)` };
  if (/[\/\\\[\]#\n\r\t]/.test(title) || /^\.+/.test(title)) return { problem: "ページ名に使えない文字がある(/ \\ [ ] # や、先頭の .)" };
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(title)) return { problem: "ページ名に制御文字がある" };
  const lower = title.toLowerCase().replace(/ /g, "_");
  if (RESERVED_TITLES.some((r) => r.toLowerCase() === lower)) return { problem: `「${title}」は書き込めないページ` };
  return { title };
}

/** ファイルの中身を行に分ける。末尾の空行は落とす */
export function toLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lineProblems(lines: readonly string[], max: number): string[] {
  const problems: string[] = [];
  if (lines.length === 0) problems.push("中身が空");
  if (lines.length > max) problems.push(`行が多い(${lines.length}行。${max}行まで)`);
  if (lines.some((l) => l.length > LINE_MAX_CHARS)) problems.push(`長すぎる行がある(1行${LINE_MAX_CHARS}文字まで)`);
  for (const url of extractUrls(lines.join("\n"))) {
    if (!isPublicWebUrl(url)) problems.push(`公開の Web の URL でないものがある: ${url}`);
  }
  return problems;
}

/** 用語ページ(cosense/pages/*.txt)の検査。出典の URL が1つは要る */
export function pageProblems(title: string, body: readonly string[]): string[] {
  const problems = lineProblems(body, PAGE_MAX_LINES);
  if (isTsukkomiTitle(title)) problems.push("ツッコミのページは pages/ では書かない(返信は append/ に書く)");
  if (body.length > 0 && body[0].trim() === title) problems.push("1行目にページ名を書かない(ページ名はファイル名で決まる)");
  if (extractUrls(body.join("\n")).length === 0) problems.push("出典の URL が1つも無い");
  return problems;
}

/** 返信(cosense/append/*.txt)の検査。書けるのはツッコミのページだけ */
export function appendProblems(title: string, lines: readonly string[]): string[] {
  const problems = lineProblems(lines, APPEND_MAX_LINES);
  if (!isTsukkomiTitle(title)) problems.push("append/ で書けるのは「yyyy年M月d日のツッコミ」のページだけ");
  return problems;
}

/**
 * 用語ページの書式を整える(ページ名の行より後ろの部分を返す)。
 *   - ページ名の次の行は、必ず空行
 *   - まとまりの区切りは、空行1つ(空行が続いていたら1つにする)
 *   - 署名が無ければ、最後に足す
 *   - ページの末尾は、必ず空行1つ
 */
export function formatPageBody(body: readonly string[]): string[] {
  const out: string[] = [""];
  const push = (line: string) => {
    if (line.trim() === "") {
      if (out[out.length - 1] !== "") out.push("");
    } else {
      out.push(line);
    }
  };
  for (const line of body) push(line);
  if (!out.some((l) => l.includes(AGENT_ICON))) {
    push("");
    out.push(AGENT_ICON);
  }
  push("");
  return out;
}

/** 返信の先頭の行に、署名が無ければ付ける(字下げは保つ) */
export function signReply(lines: readonly string[]): string[] {
  if (lines.length === 0 || lines.some((l) => l.includes(AGENT_ICON))) return [...lines];
  const indent = /^\s*/.exec(lines[0])?.[0] ?? "";
  return [`${indent}${AGENT_ICON} ${lines[0].slice(indent.length)}`, ...lines.slice(1)];
}

/** 末尾の空行の、最初の1つの位置(無ければ行数) */
function trailingBlankStart(lines: readonly Line[]): number {
  let i = lines.length;
  while (i > 1 && lines[i - 1].text.trim() === "") i--;
  return i;
}

export type PagePlan =
  | { kind: "create"; lines: string[] }
  | { kind: "noop" }
  | { kind: "update"; mode: "replace" | "append"; changes: Change[] };

type Step = { op: "keep"; i: number } | { op: "del"; i: number } | { op: "ins"; j: number };

/** 行の並び a を b にするための手順(共通部分をできるだけ残す。ページは高々数百行) */
function diffLines(a: readonly string[], b: readonly string[]): Step[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = a[i..] と b[j..] の共通部分の長さ
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      steps.push({ op: "keep", i });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      steps.push({ op: "ins", j });
      j++;
    } else {
      steps.push({ op: "del", i });
      i++;
    }
  }
  return steps;
}

/**
 * 用語ページを、エージェントが望む中身(formatPageBody を通したもの)にするための変更を作る。
 *   - ページが無ければ作る。
 *   - あれば、同じ行は残し、違う所だけを足したり消したりする。
 *   - 消すことになる行に、他人が書いた行が1つでもあれば、何も消さず、まだページに無い行だけを末尾に足す。
 * 1行目(ページ名の行)は変えない。
 */
export function planPage(current: Page | null, title: string, body: readonly string[], newId: () => string): PagePlan {
  if (current === null) return { kind: "create", lines: [title, ...body] };

  const cur = current.lines.slice(1);
  const steps = diffLines(cur.map((l) => l.text), body);
  if (steps.every((s) => s.op === "keep")) return { kind: "noop" };

  const deleted = steps.filter((s) => s.op === "del").map((s) => cur[(s as { i: number }).i]);
  if (deleted.every((l) => l.userId === AGENT_USER_ID)) {
    // 足す行は、次に残る行の直前に入れる(残る行が無ければ末尾)。同じ場所に続けて入れると、入れた順に並ぶ
    const changes: Change[] = [];
    let pending: string[] = [];
    for (const s of steps) {
      if (s.op === "ins") pending.push(body[s.j]);
      else if (s.op === "del") changes.push({ _delete: cur[s.i].id });
      else {
        for (const text of pending) changes.push({ _insert: cur[s.i].id, lines: { id: newId(), text } });
        pending = [];
      }
    }
    for (const text of pending) changes.push({ _insert: "_end", lines: { id: newId(), text } });
    return { kind: "update", mode: "replace", changes };
  }

  // 他人の行は消さない。まだ無い行だけを、末尾の空行の手前に足す
  const have = new Set(current.lines.map((l) => l.text));
  const missing = body.filter((text) => text.trim() !== "" && !have.has(text));
  if (missing.length === 0) return { kind: "noop" };
  return { kind: "update", mode: "append", changes: tailInserts(current.lines, missing, newId) };
}

/** 末尾に足す。ページが空行で終わっていれば、その手前に入れる。終わっていなければ、足したあとに空行を1つ置く */
function tailInserts(lines: readonly Line[], texts: readonly string[], newId: () => string): Change[] {
  const at = trailingBlankStart(lines);
  if (at < lines.length) return texts.map((text) => ({ _insert: lines[at].id, lines: { id: newId(), text } }));
  return [...texts, ""].map((text) => ({ _insert: "_end", lines: { id: newId(), text } }));
}

/** ツッコミのページの末尾に、返信の行を足す変更を作る(ページの末尾は空行1つのままにする) */
export function planAppend(current: Page, lines: readonly string[], newId: () => string): Change[] {
  return tailInserts(current.lines, signReply(lines), newId);
}

/** 人間が書いた行(ページ名の行と空行は除く) */
export function humanLines(page: Page): Line[] {
  return page.lines.slice(1).filter((l) => HUMAN_USER_IDS.includes(l.userId) && l.text.trim() !== "");
}

/** 人間の行が増えた・変わったかを比べるための文字列(行の id と中身) */
export function humanDigestSource(page: Page): string {
  return humanLines(page).map((l) => `${l.id}\t${l.text}`).join("\n");
}

/**
 * state/inbox/ に書く転記。人間が書いた行だけを、順番と字下げを保って写す。
 * since より後に変わった行には ★ を付ける(since が null なら全部)。
 */
export function inboxText(page: Page, since: number | null, fetchedAt: string): string {
  const lines = humanLines(page);
  const mark = (l: Line) => (since === null || (l.updated ?? 0) > since ? "★" : " ");
  return [
    `# ${page.title}`,
    "",
    `- ページ: ${pageUrl(page.title)}`,
    `- 転記した時刻: ${fetchedAt}`,
    "- 人間(gosyujin)が書いた行だけを写している。★ は、前回の転記のあとに増えた・変わった行。",
    "- このファイルは wake が書き直す。返信は cosense/append/ に書く。",
    "",
    "```",
    ...lines.map((l) => `${mark(l)} ${l.text}`),
    "```",
    "",
  ].join("\n");
}

/** journal に書く1行 */
export function syncLine(hhmm: string, file: string, result: string): string {
  return `- ${hhmm} cosense ${file} → ${result}`;
}
