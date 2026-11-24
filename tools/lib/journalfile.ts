// journal(行動ログ)への追記。lint と cosense-sync が、結果を1行ずつ残すのに使う。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 時刻を除いた部分。同じ結果を何度も書かないための比較に使う */
export function withoutTime(line: string): string {
  return line.replace(/^- \d{2}:\d{2} /, "");
}

/**
 * その日の journal に1行足す。時刻以外が同じ行がすでにあれば、書かない(起床のたびに同じ理由が並ぶのを防ぐ)。
 * 書いたら true。
 */
export function appendJournalOnce(root: string, date: string, line: string): boolean {
  const file = join(root, "journal", `${date}.md`);
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, `# ${date} の行動ログ\n\n`);
  const text = readFileSync(file, "utf8");
  if (text.split("\n").map(withoutTime).includes(withoutTime(line))) return false;
  appendFileSync(file, (text.endsWith("\n") ? "" : "\n") + line + "\n");
  return true;
}
