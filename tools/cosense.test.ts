// 実行: node --test   (Node.js 22.18 以上)

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_ICON,
  AGENT_USER_ID,
  appendProblems,
  formatPageBody,
  HUMAN_USER_IDS,
  humanDigestSource,
  humanLines,
  inboxText,
  isTsukkomiTitle,
  pageProblems,
  pageUrl,
  planAppend,
  planPage,
  replyLines,
  replyTarget,
  titleFromFileName,
  toLines,
} from "./lib/cosense.ts";
import type { Line, Page } from "./lib/cosense.ts";
import { splitSentences, tidyLines, toHalfWidth } from "./lib/cosenseFormat.ts";

const HUMAN = HUMAN_USER_IDS[0];
const AGENT = AGENT_USER_ID;
const OTHER = "ffffffffffffffffffffffff";

let seq = 0;
const newId = () => `new${++seq}`;
const page = (title: string, rows: [string, string, number?][]): Page => ({
  id: "page1",
  title,
  updated: 1000,
  lines: [
    { id: "t", text: title, userId: rows[0]?.[1] ?? AGENT },
    ...rows.map(([text, userId, updated], i): Line => ({ id: `l${i + 1}`, text, userId, updated: updated ?? 100 })),
  ],
});

test("isTsukkomiTitle: 日付は0埋めしない形", () => {
  assert.equal(isTsukkomiTitle("2026年11月24日のツッコミ"), true);
  assert.equal(isTsukkomiTitle("2026年1月5日のツッコミ"), true);
  assert.equal(isTsukkomiTitle("2026年11月24日のツッコミ2"), false);
  assert.equal(isTsukkomiTitle("ツッコミ"), false);
});

test("titleFromFileName: 使える名前だけを通す", () => {
  assert.deepEqual(titleFromFileName("eBPF.txt"), { title: "eBPF" });
  assert.deepEqual(titleFromFileName("Known Exploited Vulnerabilities.txt"), { title: "Known Exploited Vulnerabilities" });
  for (const bad of ["eBPF.md", ".txt", "a/b.txt", "..txt", ".hidden.txt", "a[b].txt", "a#b.txt", "settings.txt", "Settings.txt", "gosyujin.txt", "satoca.txt", "gi-yoza.txt", "mokumoku-ai.txt", "あ".repeat(81) + ".txt"]) {
    assert.equal("problem" in titleFromFileName(bad), true, bad);
  }
});

test("pageUrl: 空白は _ に、日本語は符号化する", () => {
  assert.equal(pageUrl("a b"), "https://scrapbox.io/mokumoku-ai/a_b");
  assert.equal(pageUrl("用語"), "https://scrapbox.io/mokumoku-ai/%E7%94%A8%E8%AA%9E");
});

test("toLines: 行末の空白と末尾の空行を落とす", () => {
  assert.deepEqual(toLines("a  \r\n b\n\n\n"), ["a", " b"]);
  assert.deepEqual(toLines("\n"), []);
});

test("pageProblems / appendProblems", () => {
  const body = ["定義", " カーネルの中でプログラムを動かす仕組み https://ebpf.io/"];
  assert.deepEqual(pageProblems("eBPF", body), []);
  assert.match(pageProblems("eBPF", ["出典なし"]).join("\n"), /出典の URL が1つも無い/);
  assert.match(pageProblems("eBPF", ["eBPF", ...body]).join("\n"), /1行目にページ名を書かない/);
  assert.match(pageProblems("2026年11月24日のツッコミ", body).join("\n"), /append/);
  assert.match(pageProblems("eBPF", []).join("\n"), /中身が空/);
  assert.match(pageProblems("eBPF", [...body, "http://127.0.0.1/x"]).join("\n"), /公開の Web の URL でない/);
  assert.match(pageProblems("eBPF", [...body, "あ".repeat(1001)]).join("\n"), /長すぎる行/);

  assert.deepEqual(appendProblems("2026年11月24日のツッコミ", ["直したです"]), []);
  assert.match(appendProblems("eBPF", ["直したです"]).join("\n"), /ツッコミ」のページだけ/);
  assert.match(appendProblems("2026年11月24日のツッコミ", Array(51).fill("a")).join("\n"), /行が多い/);
});

test("formatPageBody: 先頭に空行1つ、区切りは空行1つ、署名、末尾に空行1つ", () => {
  assert.deepEqual(formatPageBody(["定義", " 出典: https://ebpf.io/"]), ["", "定義", " 出典: https://ebpf.io/", "", AGENT_ICON, ""]);
  // 先頭や途中に空行が続いていても、1つにする。末尾の空行も1つにする
  assert.deepEqual(formatPageBody(["", "", "定義", "", "", "", "登場背景", " まだ調べていない", "", ""]), [
    "",
    "定義",
    "",
    "登場背景",
    " まだ調べていない",
    "",
    AGENT_ICON,
    "",
  ]);
  // 署名がすでにあれば足さない。空白だけの行は空行として扱う
  assert.deepEqual(formatPageBody(["定義", "  ", AGENT_ICON]), ["", "定義", "", AGENT_ICON, ""]);
  // 何度通しても同じ
  const once = formatPageBody(["定義", "", "登場背景"]);
  assert.deepEqual(formatPageBody(once), once);
});

test("toHalfWidth: 全角の英数・記号を半角に。！？ と ＃［］ は残す", () => {
  assert.equal(toHalfWidth("ＡＢＣ１２３（補足）：５０％，Ａ＆Ｂ"), "ABC123(補足):50%,A&B");
  assert.equal(toHalfWidth("本当ですか？　すごい！「」、。"), "本当ですか？ すごい！「」、。");
  assert.equal(toHalfWidth("＃タグ ［リンク］"), "＃タグ ［リンク］");
});

test("splitSentences: 。！？ で分ける。括弧・リンク・URL の中では分けない", () => {
  assert.deepEqual(splitSentences("確かめたです。直っていたです。"), ["確かめたです。", "直っていたです。"]);
  assert.deepEqual(splitSentences("本当ですか！？ そうらしいです"), ["本当ですか！？", "そうらしいです"]);
  assert.deepEqual(splitSentences("「できる。たぶん。」と書いてあったです。(未確認です。)"), ["「できる。たぶん。」と書いてあったです。", "(未確認です。)"]);
  assert.deepEqual(splitSentences("[題名。その2 https://example.com/a?b=1] を読んだです。"), ["[題名。その2 https://example.com/a?b=1] を読んだです。"]);
  assert.deepEqual(splitSentences("eBPF は……まだ分からないです"), ["eBPF は……まだ分からないです"]);
});

test("tidyLines: 1行1文に分け(続きの文は1段深く)、記号と Markdown の名残を直す", () => {
  assert.deepEqual(tidyLines([" 技術です。拡張できるです。", "  出典: https://example.com/。", "", "仕組み"]), [
    " 技術です。",
    "  拡張できるです。",
    "  出典: https://example.com/。",
    "",
    "仕組み",
  ]);
  assert.deepEqual(tidyLines(["- 箇条書き（全角）", " * 2段目", "# 見出し", "**強調**です。"]), [" 箇条書き(全角)", "  2段目", "見出し", "強調です。"]);
  // 引用・リンクだけの行・コードのある行・code: ブロックの中は、分けない・変えない
  const asIs = [" > 引用（原文のまま）。その続き。", "[題名 https://example.com/]", " `a。b（）` を使うです。次の文です。", "code:sample.js", " const a = '。（）';", "本文に戻る（ここは直る）"];
  assert.deepEqual(tidyLines(asIs), [...asIs.slice(0, 5), "本文に戻る(ここは直る)"]);
  // 人間が書いた行は触らない
  assert.deepEqual(tidyLines(["人間の行。そのまま（全角）", "自分の行。分ける。"], new Set(["人間の行。そのまま（全角）"])), ["人間の行。そのまま（全角）", "自分の行。", " 分ける。"]);
});

test("formatPageBody: 文ごとの行に分けたうえで、書式を整える。何度通しても同じ", () => {
  const once = formatPageBody(["定義", " 定義です。補足です。", "  出典: https://ebpf.io/"]);
  assert.deepEqual(once, ["", "定義", " 定義です。", "  補足です。", "  出典: https://ebpf.io/", "", AGENT_ICON, ""]);
  assert.deepEqual(formatPageBody(once), once);
});

test("replyLines: 文ごとの行にして、同じ深さに並べ、どの行の末尾にも署名を付ける", () => {
  assert.deepEqual(replyLines(["確かめたです。直してもらったです。"], 2), [`  確かめたです。${AGENT_ICON}`, `  直してもらったです。${AGENT_ICON}`]);
  // 自分で書いた字下げ・署名・空行は外してから付け直す
  assert.deepEqual(replyLines([` ${AGENT_ICON} 済みです`, "", "   深く書いた行です"], 1), [` 済みです${AGENT_ICON}`, ` 深く書いた行です${AGENT_ICON}`]);
});

test("replyTarget: 人間が最後に書いた行。同じ時刻なら下の行", () => {
  const cur = page("2026年11月24日のツッコミ", [["古い指摘", HUMAN, 100], [" 返信", AGENT, 300], ["新しい指摘", HUMAN, 200], ["", HUMAN, 250], ["知らない人", OTHER, 400]]);
  assert.equal(replyTarget(cur.lines), 3);
  const same = page("2026年11月24日のツッコミ", [["> 引用", HUMAN, 100], [" 指摘", HUMAN, 100]]);
  assert.equal(replyTarget(same.lines), 2);
  assert.equal(replyTarget(page("2026年11月24日のツッコミ", [["", HUMAN]]).lines), -1);
});

test("planPage: 無ければ作る(ページ名の次は空行、末尾は空行1つ)。同じなら何もしない", () => {
  const body = formatPageBody(["a", "b"]);
  assert.deepEqual(planPage(null, "eBPF", body, newId), { kind: "create", lines: ["eBPF", "", "a", "b", "", AGENT_ICON, ""] });
  const cur = page("eBPF", [["", AGENT], ["a", AGENT], ["b", AGENT], ["", AGENT], [AGENT_ICON, AGENT], ["", AGENT]]);
  assert.deepEqual(planPage(cur, "eBPF", body, newId), { kind: "noop" });
});

test("planPage: 古い書式のページには、先頭と末尾の空行だけを足す(ほかの行は触らない)", () => {
  seq = 0;
  const cur = page("eBPF", [["a", AGENT], ["b", AGENT], ["", AGENT], [AGENT_ICON, AGENT]]);
  assert.deepEqual(planPage(cur, "eBPF", formatPageBody(["a", "b"]), newId), {
    kind: "update",
    mode: "replace",
    changes: [
      { _insert: "l1", lines: { id: "new1", text: "" } },
      { _insert: "_end", lines: { id: "new2", text: "" } },
    ],
  });
});

test("planPage: 自分の行だけなら、違う所だけを足したり消したりする", () => {
  seq = 0;
  const cur = page("eBPF", [["", AGENT], ["a", AGENT], ["古い", AGENT], ["c", AGENT], ["", AGENT], [AGENT_ICON, AGENT], ["", AGENT]]);
  assert.deepEqual(planPage(cur, "eBPF", formatPageBody(["a", "新しい1", "新しい2", "c"]), newId), {
    kind: "update",
    mode: "replace",
    changes: [
      { _delete: "l3" },
      { _insert: "l4", lines: { id: "new1", text: "新しい1" } },
      { _insert: "l4", lines: { id: "new2", text: "新しい2" } },
    ],
  });
});

test("planPage: 消すことになる行に他人の行があれば、消さずに、無い行だけを末尾に足す", () => {
  seq = 0;
  const cur = page("eBPF", [["", AGENT], ["a", AGENT], ["人間が直した行", HUMAN], ["c", AGENT], ["", AGENT]]);
  const plan = planPage(cur, "eBPF", formatPageBody(["a", "エージェントの案", "c", "d"]), newId);
  assert.deepEqual(plan, {
    kind: "update",
    mode: "append",
    changes: [
      { _insert: "l5", lines: { id: "new1", text: "エージェントの案" } },
      { _insert: "l5", lines: { id: "new2", text: "d" } },
      { _insert: "l5", lines: { id: "new3", text: AGENT_ICON } },
    ],
  });
  assert.equal(JSON.stringify(plan).includes("_delete"), false);
  // 人間の行を残したまま、自分の行だけを差し替えるのは、ふつうにできる
  seq = 0;
  const kept = page("eBPF", [["", HUMAN], ["人間の前書き", HUMAN], ["古い", AGENT], ["", AGENT], [AGENT_ICON, AGENT], ["", AGENT]]);
  assert.deepEqual(planPage(kept, "eBPF", formatPageBody(["人間の前書き", "新しい"]), newId), {
    kind: "update",
    mode: "replace",
    changes: [{ _delete: "l3" }, { _insert: "l4", lines: { id: "new1", text: "新しい" } }],
  });
  // 知らないアカウントの行も、他人の行として扱う
  const other = page("eBPF", [["誰かの行", OTHER]]);
  assert.equal((planPage(other, "eBPF", formatPageBody(["別の中身 https://example.com/"]), newId) as { mode: string }).mode, "append");
});

test("planAppend: 指摘の行のすぐ下に、1段深く、文ごとの行で足す(どの行にも署名)", () => {
  // 実際のページと同じ形(引用の行、1段下げた指摘、末尾の空行)
  seq = 0;
  const cur = page("2026年11月24日のツッコミ", [["", HUMAN], ["> 【Shirudo の記事について】", HUMAN, 100], [" 変だよ[gosyujin.icon]", HUMAN, 120], ["", HUMAN]]);
  assert.deepEqual(planAppend(cur, ["確かめたです。直してもらったです。"], newId), [
    { _insert: "l4", lines: { id: "new1", text: `  確かめたです。${AGENT_ICON}` } },
    { _insert: "l4", lines: { id: "new2", text: `  直してもらったです。${AGENT_ICON}` } },
  ]);
  // 字下げなしで書いた指摘には、字下げ1つで返す。空行で終わっていなければ、空行を1つ足す
  seq = 0;
  const noBlank = page("2026年11月24日のツッコミ", [["指摘", HUMAN]]);
  assert.deepEqual(planAppend(noBlank, ["確かめるです"], newId), [
    { _insert: "_end", lines: { id: "new1", text: ` 確かめるです${AGENT_ICON}` } },
    { _insert: "_end", lines: { id: "new2", text: "" } },
  ]);
});

test("planAppend: 前の返信の後ろに並べる。別の指摘が下にあっても、新しい指摘の下に入れる", () => {
  seq = 0;
  const cur = page("2026年11月24日のツッコミ", [
    [" 指摘1", HUMAN, 100],
    [`  前の返信${AGENT_ICON}`, AGENT, 150],
    [" 指摘2", HUMAN, 110],
    [`  指摘2への返信${AGENT_ICON}`, AGENT, 160],
    ["", HUMAN],
  ]);
  // 指摘1 を人間が書き直した(いちばん新しい) → 指摘1 の下の、前の返信の次に入る
  cur.lines[1].updated = 200;
  assert.deepEqual(planAppend(cur, ["もう一度確かめたです"], newId), [
    { _insert: "l3", lines: { id: "new1", text: `  もう一度確かめたです${AGENT_ICON}` } },
  ]);
  // 人間の行が無いページには、字下げ1つで末尾に足す
  seq = 0;
  const none = page("2026年11月24日のツッコミ", [["", AGENT]]);
  assert.deepEqual(planAppend(none, ["書いたです"], newId), [{ _insert: "l1", lines: { id: "new1", text: ` 書いたです${AGENT_ICON}` } }]);
});

test("humanLines / inboxText: 人間の行だけを写し、新しい行に ★ を付ける", () => {
  const cur = page("2026年11月24日のツッコミ", [
    ["Java4Shell は Log4Shell の間違いでは?", HUMAN, 100],
    [` ${AGENT_ICON} 確かめるです`, AGENT, 150],
    ["", HUMAN, 100],
    ["知らない人の行", OTHER, 150],
    ["文体はもう少し控えめで", HUMAN, 200],
  ]);
  assert.deepEqual(humanLines(cur).map((l) => l.text), ["Java4Shell は Log4Shell の間違いでは?", "文体はもう少し控えめで"]);
  assert.equal(humanDigestSource(cur), "l1\tJava4Shell は Log4Shell の間違いでは?\nl5\t文体はもう少し控えめで");
  const text = inboxText(cur, 150, "2026-11-25 07:07");
  assert.match(text, /^# 2026年11月24日のツッコミ\n/);
  assert.match(text, /\n  Java4Shell は Log4Shell の間違いでは\?\n★ 文体はもう少し控えめで\n/);
  assert.equal(text.includes("確かめるです"), false);
  assert.equal(text.includes("知らない人の行"), false);
  // 初めて写すときは、全部が新しい
  assert.match(inboxText(cur, null, "x"), /\n★ Java4Shell/);
});
