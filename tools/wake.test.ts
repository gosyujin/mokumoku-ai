// 実行: node --test   (Node.js 22.18 以上)

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildReasons,
  countQuestions,
  decide,
  detectNew,
  journalLine,
  LLM_DAILY_LIMIT,
  pruneCandidates,
} from "./lib/core.ts";
import type { Candidate } from "./lib/core.ts";
import { decodeEntities, FEEDS, normalizeUrl, parseFeed } from "./lib/feed.ts";
import { gate, jst } from "./lib/time.ts";

const at = (jstTime: string) => new Date(`2026-11-24T${jstTime}:00+09:00`);

test("jst: UTC から日本時間の日付と時刻を出す", () => {
  const t = jst(new Date("2026-11-23T22:07:00Z"));
  assert.equal(t.date, "2026-11-24");
  assert.equal(t.hhmm, "07:07");
});

test("gate: 稼働時間は 7:00〜23:30(両端を含む)", () => {
  assert.equal(gate(at("06:59"), null).kind, "outside-hours");
  assert.equal(gate(at("07:00"), null).kind, "run");
  assert.equal(gate(at("23:30"), null).kind, "run");
  assert.equal(gate(at("23:31"), null).kind, "outside-hours");
});

test("gate: 前回から20分未満は二重起動", () => {
  const last = at("10:07").toISOString();
  assert.deepEqual(gate(at("10:22"), last), { kind: "too-soon", minutes: 15 });
  assert.deepEqual(gate(at("10:27"), last), { kind: "run", elapsedMinutes: 20 });
});

test("parseFeed: Atom(rel=alternate の link を使い、本文中のタグは拾わない)", () => {
  const xml = `<feed><title>サイト名</title>
    <entry>
      <title>A &amp; B</title>
      <link rel="self" href="https://example.com/self"/>
      <link rel="alternate" type="text/html" href="https://example.com/a?utm_source=x#top"/>
      <published>2026-11-24T00:00:00Z</published>
      <content type="html"><![CDATA[<title>偽</title><link href="https://evil.example/"/>]]></content>
    </entry>
    <entry><title>C</title><link href="https://example.com/c"/><updated>2026-11-23T10:00:00+09:00</updated></entry>
  </feed>`;
  assert.deepEqual(parseFeed(xml), [
    { title: "A & B", url: "https://example.com/a", published: "2026-11-24T00:00:00.000Z" },
    { title: "C", url: "https://example.com/c", published: "2026-11-23T01:00:00.000Z" },
  ]);
});

test("parseFeed: RSS 1.0(はてブ形式。<items> は項目として数えない)", () => {
  const xml = `<rdf:RDF><channel><title>ch</title><link>https://b.example/</link>
    <items><rdf:Seq><rdf:li rdf:resource="https://example.com/x"/></rdf:Seq></items></channel>
    <item rdf:about="https://example.com/x">
      <title>&#x3042;&#12356;</title><link>https://example.com/x</link>
      <dc:date>2026-11-23T21:20:45Z</dc:date><hatena:bookmarkcount>123</hatena:bookmarkcount>
    </item></rdf:RDF>`;
  assert.deepEqual(parseFeed(xml), [
    { title: "あい", url: "https://example.com/x", published: "2026-11-23T21:20:45.000Z", bookmarks: 123 },
  ]);
});

test("decodeEntities: 二重には戻さない", () => {
  assert.equal(decodeEntities("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
});

test("normalizeUrl: http(s) 以外は捨てる", () => {
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("https://example.com/p?id=1&utm_medium=rss"), "https://example.com/p?id=1");
});

test("detectNew: 既読と上位フィードの URL を除く。初回は先頭3件だけ", () => {
  const items = ["a", "b", "c", "d", "e"].map((x) => ({ title: x, url: `https://e.com/${x}`, published: null }));
  const r = detectNew(items, new Set(["https://e.com/a"]), new Set(["https://e.com/b"]), false);
  assert.deepEqual(r.fresh.map((i) => i.title), ["c", "d", "e"]);
  assert.equal(r.duplicated, 1);
  assert.equal(detectNew(items, new Set(), new Set(), true).fresh.length, 3);
});

const cand = (over: Partial<Candidate>): Candidate => ({
  feed: "publickey",
  priority: 1,
  title: "t",
  url: "https://e.com/1",
  published: null,
  foundAt: at("10:00").toISOString(),
  offered: false,
  ...over,
});

test("pruneCandidates: 72時間を過ぎた候補を捨て、優先順に並べる", () => {
  const list = [
    cand({ url: "https://e.com/old", foundAt: "2026-11-20T00:00:00Z" }),
    cand({ url: "https://e.com/h", feed: "hatebu", priority: 3 }),
    cand({ url: "https://e.com/p" }),
  ];
  assert.deepEqual(pruneCandidates(list, at("10:07")).map((c) => c.url), ["https://e.com/p", "https://e.com/h"]);
});

test("countQuestions: 行頭の - [ ] だけを数える", () => {
  assert.equal(countQuestions("説明 `- [ ] 語` の形\n- [ ] WASI — Publickey\n- [x] 済み\n- [ ] \n"), 1);
});

test("buildReasons: 提示済みの候補は理由にしない。日記は21時以降だけ", () => {
  const base = { feeds: FEEDS, questions: 0, diaryExists: false };
  assert.deepEqual(buildReasons({ ...base, candidates: [cand({ offered: true })], now: at("20:59") }), []);
  assert.deepEqual(
    buildReasons({ ...base, candidates: [cand({})], now: at("21:00") }).map((r) => r.kind),
    ["feed", "diary"],
  );
});

test("decide: 理由が無ければ起こさない。上限に達したら起こさない", () => {
  const reason = [{ kind: "feed" as const, detail: "x" }];
  assert.deepEqual(decide([], 0), { act: false, llmCount: 0, capped: false });
  assert.deepEqual(decide(reason, 0), { act: true, llmCount: 1, capped: false });
  assert.deepEqual(decide(reason, LLM_DAILY_LIMIT), { act: false, llmCount: LLM_DAILY_LIMIT, capped: true });
});

test("journalLine: 同じ日に45分を超えて空いたら警告を付ける", () => {
  const line = journalLine({
    now: at("11:07"),
    trigger: "dispatch",
    elapsedMinutes: 60,
    lastBeat: at("10:07").toISOString(),
    reasons: [],
    decision: { act: false, llmCount: 0, capped: false },
    errors: [],
  });
  assert.equal(line, "- 11:07 wake(dispatch)前回から60分 ⚠間隔超過 → act=false 理由なし");
});
