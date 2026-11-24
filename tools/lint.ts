// lint: 仕上がった下書き(drafts/YYYY-MM-DD.md)を検査し、合格したものだけを entries/ に移す。
//   - 検査するのは、front matter に `status: ready` がある下書きだけ(エージェントが仕上げたと判断した印)
//   - 合格: status の行を除いて entries/ に書き、下書きを消す。次の build でサイトに載る
//   - 不合格: 下書きは残し、理由を今日の journal に書く(同じ理由を繰り返しては書かない)
//   - 公開済みの日記への訂正・続き: `kind: addendum` も付いた下書きは、日記の末尾に「追記(日時)」として足す
//   - entries/ に書くのは、この lint だけ。公開済みの日記の文面は変えない(足すだけ)
//
// 実行: node tools/lint.ts   (Node.js 22.18 以上)
// 環境変数:
//   MOKUMOKU_NOW    現在時刻を差し替える(動作確認用。ISO 8601)
//   MOKUMOKU_ROOT   読み書きする場所を差し替える(動作確認用)

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { appendJournalOnce } from "./lib/journalfile.ts";
import { linkProblems } from "./lib/linkcheck.ts";
import {
  addendumProblems,
  applyAddendum,
  isAddendum,
  isReady,
  lintLine,
  staticProblems,
  toEntry,
  urlsToCheck,
} from "./lib/lint.ts";
import { splitFrontMatter } from "./lib/markdown.ts";
import { jst } from "./lib/time.ts";

/** 1回の実行で公開する日記・足す追記の上限(それぞれ。まとめて大量に公開されないようにする) */
const MAX_PER_RUN = 1;

const ROOT = process.env.MOKUMOKU_ROOT ?? join(import.meta.dirname ?? ".", "..");
const path = (...parts: string[]) => join(ROOT, ...parts);

function writeJournal(today: string, line: string): void {
  if (!appendJournalOnce(ROOT, today, line)) console.log("  journal には同じ結果がすでにある。書かない");
}

async function main(): Promise<void> {
  const now = process.env.MOKUMOKU_NOW ? new Date(process.env.MOKUMOKU_NOW) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("MOKUMOKU_NOW が日時として読めない");
  const today = jst(now);

  const draftsDir = path("drafts");
  const names = existsSync(draftsDir) ? readdirSync(draftsDir).sort() : [];
  let published = 0;
  let appended = 0;
  let checked = 0;

  for (const name of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(name);
    if (!m) continue;
    const fileDate = m[1];
    const draft = `drafts/${name}`;
    const entry = `entries/${name}`;
    const source = readFileSync(path("drafts", name), "utf8");
    if (!isReady(splitFrontMatter(source).meta)) {
      console.log(`${draft}: status: ready が無い。検査しない`);
      continue;
    }
    checked++;

    const meta = splitFrontMatter(source).meta;
    const exists = existsSync(path("entries", name));
    const addendum = isAddendum(meta);
    let problems: string[];
    try {
      if (addendum && !exists) {
        problems = [`追記する先の日記(${entry})が無い。kind: addendum は、公開済みの日記に足すときだけ付ける`];
      } else if (!addendum && exists) {
        problems = [
          `この日の日記は公開済み(${entry})。訂正や続きを足すなら、front matter に kind: addendum を付け、本文には足す内容だけを書く`,
        ];
      } else if ((addendum ? appended : published) >= MAX_PER_RUN) {
        console.log(`${draft}: 今回の${addendum ? "追記" : "公開"}は${MAX_PER_RUN}件まで。次の起床に回す`);
        continue;
      } else {
        const input = { fileDate, source, today: today.date };
        problems = addendum ? addendumProblems(input) : staticProblems(input);
        if (problems.length === 0) problems = await linkProblems(urlsToCheck(source));
      }
    } catch (e) {
      console.error(e);
      problems = ["lint の内部エラー(Actions のログを参照)"];
    }

    if (problems.length > 0) {
      console.log(`${draft}: 不合格`);
      for (const p of problems) console.log(`  - ${p}`);
      writeJournal(today.date, lintLine(today.hhmm, draft, { problems }));
      continue;
    }

    if (addendum) {
      // 公開済みの日記の末尾に足す。元の本文は変えない
      const current = readFileSync(path("entries", name), "utf8");
      writeFileSync(path("entries", name), applyAddendum(current, source, { date: today.date, hhmm: today.hhmm }));
      unlinkSync(path("drafts", name));
      appended++;
      console.log(`${draft}: 合格。${entry} に追記した`);
      writeJournal(today.date, lintLine(today.hhmm, draft, { appended: entry }));
      continue;
    }

    mkdirSync(path("entries"), { recursive: true });
    writeFileSync(path("entries", name), toEntry(source), { flag: "wx" }); // すでにあれば失敗させる(上書きしない)
    unlinkSync(path("drafts", name));
    published++;
    console.log(`${draft}: 合格。${entry} に移した`);
    writeJournal(today.date, lintLine(today.hhmm, draft, { published: entry }));
  }

  console.log(`lint: 検査 ${checked} 件、公開 ${published} 件、追記 ${appended} 件`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
