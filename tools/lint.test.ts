// 実行: node --test   (Node.js 22.18 以上)

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyStatus,
  extractUrls,
  isPublicWebUrl,
  isReady,
  lintLine,
  lintLineKey,
  quoteBlocks,
  staticProblems,
  toEntry,
  urlsToCheck,
} from "./lib/lint.ts";
import { splitFrontMatter } from "./lib/markdown.ts";

const GOOD = `---
title: つなぎの話を読んだ日
date: 2026-11-24
status: ready
sources:
  - https://example.com/article
terms:
  - eBPF
---

## 読んだ記事

- 記事: 題名 https://example.com/article
- 用語: [eBPF](https://scrapbox.io/mokumoku-ai/eBPF)

## 感じたこと

気になったです。
`;

const check = (source: string, fileDate = "2026-11-24", today = "2026-11-24") =>
  staticProblems({ fileDate, source, today });

test("isReady: status: ready のときだけ", () => {
  assert.equal(isReady(splitFrontMatter(GOOD).meta), true);
  assert.equal(isReady(splitFrontMatter(GOOD.replace("status: ready\n", "")).meta), false);
  assert.equal(isReady(splitFrontMatter(GOOD.replace("status: ready", "status: draft")).meta), false);
  assert.equal(isReady(splitFrontMatter("本文だけ").meta), false);
});

test("staticProblems: 整った下書きは問題なし", () => {
  assert.deepEqual(check(GOOD), []);
});

test("staticProblems: front matter の不足を挙げる", () => {
  assert.match(check(GOOD.replace("title: つなぎの話を読んだ日\n", "")).join("\n"), /title が無い/);
  assert.match(check(GOOD.replace("date: 2026-11-24", "date: 2026-11-23")).join("\n"), /date がファイル名/);
  assert.match(check(GOOD, "2026-11-25", "2026-11-24").join("\n"), /未来の日付/);
  assert.match(check(GOOD.replace("sources:\n  - https://example.com/article\n", "")).join("\n"), /sources.*が無い/);
  assert.match(check(GOOD.replace("  - https://example.com/article\nterms", "  - ftp://example.com/a\nterms")).join("\n"), /公開の Web の URL でない/);
  assert.match(check(GOOD.replace("  - eBPF\n", "  - [eBPF]\n")).join("\n"), /terms には語だけ/);
});

test("staticProblems: 必要な節が無い・空", () => {
  assert.match(check(GOOD.replace("## 感じたこと\n\n気になったです。\n", "")).join("\n"), /「## 感じたこと」の節が無い/);
  assert.match(check(GOOD.replace("気になったです。\n", "")).join("\n"), /「## 感じたこと」の節が空/);
});

test("staticProblems: 引用は短く、出典のリンク付き", () => {
  const withQuote = (quote: string, after = "") => GOOD.replace("気になったです。\n", `気になったです。\n\n${quote}\n${after}\n`);
  assert.deepEqual(check(withQuote("> 短い引用", "出典: https://example.com/article")), []);
  assert.deepEqual(check(withQuote("> 短い引用 https://example.com/article")), []);
  assert.match(check(withQuote("> 短い引用", "出典なし")).join("\n"), /引用に出典のリンクが無い/);
  assert.match(check(withQuote("> " + "あ".repeat(201), "https://example.com/article")).join("\n"), /引用が長い\(201文字/);
});

test("staticProblems: 用語リンクの形と、公開でない URL", () => {
  const withLine = (line: string) => GOOD.replace("気になったです。\n", `気になったです。\n${line}\n`);
  assert.match(check(withLine("https://scrapbox.io/other-project/eBPF")).join("\n"), /用語リンクは/);
  assert.match(check(withLine("https://cosen.se/x")).join("\n"), /用語リンクは/);
  assert.match(check(withLine("http://169.254.169.254/latest/meta-data")).join("\n"), /公開の Web の URL でない/);
  assert.match(check(withLine("http://localhost:8080/")).join("\n"), /公開の Web の URL でない/);
});

test("extractUrls / urlsToCheck: 重複を除き、文末の句読点を落とす", () => {
  assert.deepEqual(extractUrls("見た(https://example.com/a)。あと https://example.com/b. と https://example.com/a"), [
    "https://example.com/a",
    "https://example.com/b",
  ]);
  assert.deepEqual(urlsToCheck(GOOD), ["https://example.com/article", "https://scrapbox.io/mokumoku-ai/eBPF"]);
});

test("isPublicWebUrl", () => {
  assert.equal(isPublicWebUrl("https://www.publickey1.jp/blog/26/x.html"), true);
  for (const bad of ["ftp://example.com/", "http://127.0.0.1/", "http://[::1]/", "http://intranet/", "https://user:pw@example.com/", "x"]) {
    assert.equal(isPublicWebUrl(bad), false, bad);
  }
});

test("quoteBlocks: コードブロックの中の > は引用として数えない", () => {
  const body = "本文\n\n> 引用1\n> 続き\n\n出典 https://example.com/\n\n```\n> これはコード\n```\n";
  assert.deepEqual(quoteBlocks(body), [{ text: "引用1\n続き", next: "出典 https://example.com/" }]);
});

test("classifyStatus", () => {
  assert.equal(classifyStatus(200), "alive");
  assert.equal(classifyStatus(301), "alive");
  assert.equal(classifyStatus(404), "dead");
  assert.equal(classifyStatus(410), "dead");
  assert.equal(classifyStatus(403), "blocked");
  assert.equal(classifyStatus(429), "blocked");
  assert.equal(classifyStatus(503), "retry");
});

test("toEntry: status の行だけを取り除く", () => {
  const entry = toEntry(GOOD);
  assert.equal(entry.includes("status:"), false);
  assert.equal(entry, GOOD.replace("status: ready\n", ""));
  assert.equal(splitFrontMatter(entry).meta.title, "つなぎの話を読んだ日");
});

test("lintLine / lintLineKey", () => {
  const ok = lintLine("21:37", "drafts/2026-11-24.md", { published: "entries/2026-11-24.md" });
  assert.equal(ok, "- 21:37 lint drafts/2026-11-24.md → 公開した(entries/2026-11-24.md)");
  const ng = lintLine("21:37", "drafts/2026-11-24.md", { problems: ["A", "B"] });
  assert.equal(ng, "- 21:37 lint drafts/2026-11-24.md → 不合格: A / B");
  assert.equal(lintLineKey(ng), lintLineKey(lintLine("22:07", "drafts/2026-11-24.md", { problems: ["A", "B"] })));
});
