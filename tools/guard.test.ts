// 実行: node --test   (Node.js 22.18 以上)

import assert from "node:assert/strict";
import { test } from "node:test";

import { isWritable, parsePorcelain, violation } from "./lib/guard.ts";

test("parsePorcelain: 変更・新規・削除を読む", () => {
  const raw = " M journal/2026-11-24.md\0?? drafts/2026-11-24.md\0 D drafts/old.md\0";
  assert.deepEqual(parsePorcelain(raw), [
    { status: " M", path: "journal/2026-11-24.md" },
    { status: "??", path: "drafts/2026-11-24.md" },
    { status: " D", path: "drafts/old.md" },
  ]);
  assert.deepEqual(parsePorcelain(""), []);
});

test("parsePorcelain: 空白や日本語を含むパス、改名の元のパスも拾う", () => {
  const raw = "?? drafts/日記 の下書き.md\0R  drafts/new.md\0tools/wake.ts\0";
  assert.deepEqual(parsePorcelain(raw), [
    { status: "??", path: "drafts/日記 の下書き.md" },
    { status: "R ", path: "drafts/new.md" },
    { status: "R ", path: "tools/wake.ts" },
  ]);
});

test("isWritable: drafts/・journal/・cosense/pages/・cosense/append/ の下だけ", () => {
  assert.equal(isWritable("drafts/2026-11-24.md"), true);
  assert.equal(isWritable("journal/2026-11-24.md"), true);
  assert.equal(isWritable("drafts/sub/a.md"), true);
  assert.equal(isWritable("cosense/pages/eBPF.txt"), true);
  assert.equal(isWritable("cosense/append/2026年11月24日のツッコミ.txt"), true);
  for (const path of [
    "SOUL.md",
    "RULES.md",
    "CLAUDE.md",
    "state/cursor.json",
    "state/questions.md",
    "state/inbox/2026年11月24日のツッコミ.md",
    "state/cosense-sent.json",
    "cosense/other.txt",
    "cosense/.gitkeep",
    "entries/2026-11-24.md",
    "tools/wake.ts",
    "site/style.css",
    "ops/agent/prompt.md",
    ".github/workflows/heartbeat.yml",
    ".claude/settings.json",
    "drafts",
    "draftsx/a.md",
    "drafts/../SOUL.md",
    "/etc/passwd",
  ]) {
    assert.equal(isWritable(path), false, path);
  }
});

test("violation: 場所と拡張子を見る。削除は拡張子を問わない", () => {
  assert.equal(violation({ status: "??", path: "drafts/2026-11-24.md" }), null);
  assert.equal(violation({ status: " M", path: "journal/2026-11-24.md" }), null);
  assert.match(violation({ status: " M", path: "SOUL.md" }) ?? "", /場所の外/);
  assert.match(violation({ status: "??", path: "drafts/run.sh" }) ?? "", /拡張子/);
  assert.match(violation({ status: "??", path: "journal/data.json" }) ?? "", /拡張子/);
  assert.equal(violation({ status: " D", path: "drafts/.gitkeep" }), null);
  assert.match(violation({ status: " D", path: "tools/wake.ts" }) ?? "", /場所の外/);
});

test("violation: cosense/ は .txt だけ。下の階層は作らせない", () => {
  assert.equal(violation({ status: "??", path: "cosense/pages/eBPF.txt" }), null);
  assert.equal(violation({ status: " M", path: "cosense/append/2026年11月24日のツッコミ.txt" }), null);
  assert.match(violation({ status: "??", path: "cosense/pages/eBPF.md" }) ?? "", /拡張子/);
  assert.match(violation({ status: "??", path: "cosense/pages/sub/eBPF.txt" }) ?? "", /下の階層/);
  assert.match(violation({ status: "??", path: "cosense/eBPF.txt" }) ?? "", /場所の外/);
  assert.match(violation({ status: "??", path: "drafts/note.txt" }) ?? "", /拡張子/);
  assert.equal(violation({ status: " D", path: "cosense/append/2026年11月24日のツッコミ.txt" }), null);
});
