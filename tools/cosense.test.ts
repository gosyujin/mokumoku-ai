// 実行: node --test   (Node.js 22.18 以上)

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_ICON,
  AGENT_USER_ID,
  appendProblems,
  HUMAN_USER_IDS,
  humanDigestSource,
  humanLines,
  inboxText,
  isTsukkomiTitle,
  pageProblems,
  pageUrl,
  planAppend,
  planPage,
  signReply,
  titleFromFileName,
  toLines,
  withSignature,
} from "./lib/cosense.ts";
import type { Line, Page } from "./lib/cosense.ts";

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
  for (const bad of ["eBPF.md", ".txt", "a/b.txt", "..txt", ".hidden.txt", "a[b].txt", "a#b.txt", "settings.txt", "Settings.txt", "gosyujin.txt", "satoca.txt", "gi-yoza.txt", "あ".repeat(81) + ".txt"]) {
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

test("withSignature / signReply: 署名が無ければ付ける", () => {
  assert.deepEqual(withSignature(["a"]), ["a", "", AGENT_ICON]);
  assert.deepEqual(withSignature(["a", AGENT_ICON]), ["a", AGENT_ICON]);
  assert.deepEqual(signReply([" 直したです", "  詳しくは日記の追記に"]), [` ${AGENT_ICON} 直したです`, "  詳しくは日記の追記に"]);
  assert.deepEqual(signReply([`${AGENT_ICON} 済み`]), [`${AGENT_ICON} 済み`]);
});

test("planPage: 無ければ作る。同じなら何もしない", () => {
  assert.deepEqual(planPage(null, "eBPF", ["a", "b"], newId), { kind: "create", lines: ["eBPF", "a", "b"] });
  const cur = page("eBPF", [["a", AGENT], ["b", AGENT], ["", AGENT]]);
  assert.deepEqual(planPage(cur, "eBPF", ["a", "b"], newId), { kind: "noop" });
});

test("planPage: 自分の行だけなら、食い違う真ん中だけを差し替える", () => {
  seq = 0;
  const cur = page("eBPF", [["a", AGENT], ["古い", AGENT], ["c", AGENT]]);
  assert.deepEqual(planPage(cur, "eBPF", ["a", "新しい1", "新しい2", "c"], newId), {
    kind: "update",
    mode: "replace",
    changes: [
      { _insert: "l3", lines: { id: "new1", text: "新しい1" } },
      { _insert: "l3", lines: { id: "new2", text: "新しい2" } },
      { _delete: "l2" },
    ],
  });
  // 末尾に足すだけのとき。最後の空行の手前に入れる
  seq = 0;
  const tail = page("eBPF", [["a", AGENT], ["", AGENT]]);
  assert.deepEqual(planPage(tail, "eBPF", ["a", "b"], newId), {
    kind: "update",
    mode: "replace",
    changes: [{ _insert: "l2", lines: { id: "new1", text: "b" } }],
  });
});

test("planPage: 差し替える範囲に他人の行があれば、消さずに、無い行だけを末尾に足す", () => {
  seq = 0;
  const cur = page("eBPF", [["a", AGENT], ["人間が直した行", HUMAN], ["c", AGENT]]);
  const plan = planPage(cur, "eBPF", ["a", "エージェントの案", "c", "d"], newId);
  assert.deepEqual(plan, {
    kind: "update",
    mode: "append",
    changes: [
      { _insert: "_end", lines: { id: "new1", text: "エージェントの案" } },
      { _insert: "_end", lines: { id: "new2", text: "d" } },
    ],
  });
  assert.equal(JSON.stringify(plan).includes("_delete"), false);
  // 人間の行が、差し替えない場所(一致する先頭・末尾)にあるだけなら、ふつうに差し替える
  seq = 0;
  const kept = page("eBPF", [["人間の前書き", HUMAN], ["古い", AGENT]]);
  assert.deepEqual(planPage(kept, "eBPF", ["人間の前書き", "新しい"], newId), {
    kind: "update",
    mode: "replace",
    changes: [{ _insert: "_end", lines: { id: "new1", text: "新しい" } }, { _delete: "l2" }],
  });
  // 知らないアカウントの行も、他人の行として扱う
  const other = page("eBPF", [["誰かの行", OTHER]]);
  assert.equal((planPage(other, "eBPF", ["別の中身 https://example.com/"], newId) as { mode: string }).mode, "append");
});

test("planAppend: 末尾に、署名つきで足す", () => {
  seq = 0;
  const cur = page("2026年11月24日のツッコミ", [["Java4Shell は Log4Shell の間違いでは?", HUMAN], ["", HUMAN]]);
  assert.deepEqual(planAppend(cur, [" 確かめるです"], newId), [
    { _insert: "l2", lines: { id: "new1", text: ` ${AGENT_ICON} 確かめるです` } },
  ]);
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
