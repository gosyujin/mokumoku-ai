// guard: エージェント(Claude の step)が、書いてよい場所の外を変更していたら job を失敗させる。
//
// 前提: 直前の commit の step で作業ツリーがきれいになっていること。
//       だから、ここで見える変更はすべてエージェントが書いたもの。
// 失敗すると、後ろの commit の step が動かないので、エージェントの変更は1つも push されない。
//
// 実行: node tools/guard.ts   (Node.js 22.18 以上)

import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import process from "node:process";

import { AGENT_WRITABLE, parsePorcelain, violation } from "./lib/guard.ts";

/** 1ファイルの上限。日記・行動ログがこれを超えることは無いはず */
const MAX_BYTES = 200 * 1024;

const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
  encoding: "utf8",
});
const changes = parsePorcelain(raw);

const problems: string[] = [];
for (const change of changes) {
  let reason = violation(change);
  if (reason === null && !change.status.includes("D")) {
    try {
      const stat = lstatSync(change.path);
      if (!stat.isFile()) reason = "通常のファイルではない(リンクなど)";
      else if (stat.size > MAX_BYTES) reason = `大きすぎる(${stat.size} バイト)`;
    } catch {
      // 改名の元のパスなど、もう存在しないもの
    }
  }
  if (reason !== null) problems.push(`${change.status} ${change.path} — ${reason}`);
}

console.log(`エージェントの変更: ${changes.length} 件(書いてよい場所: ${AGENT_WRITABLE.join(" ")})`);
for (const change of changes) console.log(`  ${change.status} ${change.path}`);

if (problems.length > 0) {
  console.error("guard: 許可されていない変更がある。commit しない");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("guard: 問題なし");
