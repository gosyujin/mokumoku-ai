// Cosense に送る文章を、送る直前に整える(記号・Markdown の名残・1行1文)。
// 決まりは waiwai-ai(同じ人間が運用している別プロジェクト)の書き込みルールに合わせてある。
// エージェントにも同じ決まりを指示しているが、守られなかったときに、ここで形だけはそろえる。

/**
 * 全角の英数・記号を半角にする。全角空白も半角にする。
 * 残すもの: ！？(文章では全角でよい)、＃［］(半角にすると、Cosense でタグやリンクになる)。
 * 「」『』、。・ー などの日本語の約物は、もともと対象外。
 */
export function toHalfWidth(text: string): string {
  return text
    .replace(/[！-～]/g, (c) => ("！？＃［］".includes(c) ? c : String.fromCharCode(c.charCodeAt(0) - 0xfee0)))
    .replace(/　/g, " ");
}

/** `…`(行の中のコード)の外側だけに f を当てる */
function outsideCode(line: string, f: (seg: string) => string): string {
  return line.split(/(`[^`]*`)/).map((seg, i) => (i % 2 === 0 ? f(seg) : seg)).join("");
}

/**
 * Markdown の書き方を、Cosense の書き方にする。
 *   - 行頭の「- 」「* 」「+ 」を外して、字下げを1段深くする(Cosense の箇条書きは、行頭の空白だけ)
 *   - 行頭の「# 」(見出し)を外す。**強調** の ** を外す
 */
function unMarkdown(line: string): string {
  const ws = /^[ \t]*/.exec(line)?.[0] ?? "";
  let rest = line.slice(ws.length);
  let head = ws;
  const bullet = /^[-*+] +(.*)$/.exec(rest);
  if (bullet) {
    rest = bullet[1];
    head = `${ws} `;
  } else {
    rest = rest.replace(/^#{1,6} +/, "");
  }
  return head + outsideCode(rest, (seg) => seg.replace(/\*\*([^*\n]+)\*\*/g, "$1"));
}

const OPEN = "「『([";
const CLOSE = "」』)]";

/**
 * 文ごとに分ける。区切りは、全角の 。！？ の連なり(「！？」は1つの区切り)。
 * 括弧「」『』() とリンク [ ] の中、URL の中では区切らない。区切りの直後が閉じ括弧のときも、そこでは分けない。
 */
export function splitSentences(text: string): string[] {
  const inUrl = new Array<boolean>(text.length).fill(false);
  for (const m of text.matchAll(/https?:\/\/[^\s\]]+/g)) {
    const at = m.index ?? 0;
    inUrl.fill(true, at, at + m[0].length);
  }

  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    cur += c;
    if (inUrl[i]) continue;
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && "。！？".includes(c) && !"。！？」』)]".includes(text[i + 1] ?? " ")) {
      if (cur.trim() !== "") out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

/** 文に分けない行: 出典の行、引用の行、リンクだけの行、行の中にコードがある行 */
function keepWhole(body: string): boolean {
  return /^出典/.test(body) || body.startsWith(">") || /^\[[^\[\]]+\]$/.test(body) || body.includes("`");
}

/**
 * 行の並びを整える: 全角記号を半角に、Markdown の名残を外し、1行に2つ以上の文があれば、文ごとの行に分ける。
 *   - 分けたときは、最初の文をもとの字下げに、続きの文を1段深くする(続きは、最初の文の掘り下げとして扱う)
 *   - `code:` `table:` の行と、その下の字下げが深い行(ブロックの中身)は、触らない
 *   - 引用の行(`>` で始まる)は、原文そのままなので、触らない
 *   - keep にある行(ページにある、エージェント以外が書いた行)は、触らない
 *   - 空行は、そのまま返す
 */
export function tidyLines(lines: readonly string[], keep: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  let blockIndent: number | null = null;
  for (const raw of lines) {
    if (raw.trim() === "" || keep.has(raw)) {
      out.push(raw);
      continue;
    }
    const rawIndent = /^[ \t　]*/.exec(raw)?.[0].length ?? 0;
    if (blockIndent !== null) {
      if (rawIndent > blockIndent) {
        out.push(raw);
        continue;
      }
      blockIndent = null;
    }
    if (/^[ \t　]*(code|table):/.test(raw)) {
      blockIndent = rawIndent;
      out.push(raw);
      continue;
    }
    // 引用の行(> で始まる)は、原文そのままなので、記号も変えない
    if (raw.trimStart().startsWith(">")) {
      out.push(raw);
      continue;
    }
    const line = unMarkdown(outsideCode(raw, toHalfWidth));
    const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
    const body = line.slice(indent.length);
    if (keepWhole(body)) out.push(line);
    else splitSentences(body).forEach((s, k) => out.push(indent + (k > 0 ? " " : "") + s));
  }
  return out;
}
