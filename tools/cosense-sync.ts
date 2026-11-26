// cosense-sync: エージェントが cosense/ に書いたものを、Cosense(プロジェクト mokumoku-ai)に送る。
//   cosense/append/{ページ名}.txt  「yyyy年M月d日のツッコミ」ページの末尾に足す行(返信)。送ったら消す
//   cosense/pages/{ページ名}.txt   用語ページの中身(ページ名の行は書かない)。前回送ったあとに変わったものだけ送る
//
// 守ること:
//   - 書き込み先は COSENSE_PROJECT(定数)だけ。トークンは Cosense の API にしか送らない
//   - 他人が書いた行は変えない・消さない。重なったら、まだ無い行を末尾に足すだけにする
//   - 設定・メンバーのページには書かない。ツッコミのページには足すだけ
//   - 送る前に、出典の URL が生きているかを確かめる(lint と同じ検査)
//
// 実行: node tools/cosense-sync.ts   (Node.js 22.18 以上)
// 環境変数:
//   COSENSE_PAT     Cosense のトークン(エージェント用アカウントのもの)。この step にだけ渡す。
//                   無いときは、送らずに「何を送るつもりか」だけを表示する
//   MOKUMOKU_NOW / MOKUMOKU_ROOT   動作確認用

import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

import {
  AGENT_USER_ID,
  appendProblems,
  formatPageBody,
  PAGE_FORMAT,
  pageProblems,
  pageUrl,
  planAppend,
  planPage,
  syncLine,
  titleFromFileName,
  toLines,
} from "./lib/cosense.ts";
import type { Change } from "./lib/cosense.ts";
import { previewEdit, readPage, submitEdit, whoami } from "./lib/cosenseApi.ts";
import { appendJournalOnce } from "./lib/journalfile.ts";
import { linkProblems } from "./lib/linkcheck.ts";
import { extractUrls, isPublicWebUrl, URL_CHECK_LIMIT } from "./lib/lint.ts";
import { jst } from "./lib/time.ts";

/** 1回の実行で送る上限(返信・用語ページそれぞれ)。検査で落ちたものは数えない */
const MAX_PER_RUN = 3;
/** 1回の実行で調べるファイルの上限(返信・用語ページそれぞれ) */
const MAX_EXAMINED = 20;

const ROOT = process.env.MOKUMOKU_ROOT ?? join(import.meta.dirname ?? ".", "..");
const path = (...parts: string[]) => join(ROOT, ...parts);
const PAT = (process.env.COSENSE_PAT ?? "").trim();
const DRY_RUN = PAT === "";

interface SentState {
  /** 用語ページのファイルごとの、最後に送った中身のハッシュ */
  pages: Record<string, string>;
}

const newLineId = () => randomBytes(12).toString("hex");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/** 送信済みかどうかの判定に使う値。書式の版を混ぜてあるので、書式を変えると送り直しになる */
const sentKey = (raw: string) => sha256(`format:${PAGE_FORMAT}\n${raw}`);

function listTxt(dir: string): string[] {
  return existsSync(path("cosense", dir)) ? readdirSync(path("cosense", dir)).filter((n) => n.endsWith(".txt")).sort() : [];
}

function describe(changes: Change[]): string {
  const inserts = changes.filter((c) => "_insert" in c).length;
  const deletes = changes.filter((c) => "_delete" in c).length;
  return `${inserts}行を足す` + (deletes > 0 ? `、${deletes}行を消す` : "");
}

async function urlProblems(lines: readonly string[]): Promise<string[]> {
  const urls = extractUrls(lines.join("\n")).filter(isPublicWebUrl).slice(0, URL_CHECK_LIMIT);
  return await linkProblems(urls);
}

/** preview → submit。新しいページで、サーバーが別の名前を付けようとしたら確定しない */
async function send(pageId: string | null, changes: Change[], expectTitle: string): Promise<void> {
  const preview = await previewEdit(PAT, pageId, changes);
  if (pageId === null && preview.title !== expectTitle) {
    throw new Error(`同じ名前のページがあるらしい(サーバーが付けた名前: ${preview.title.slice(0, 40)})。確定しなかった`);
  }
  await submitEdit(PAT, preview.previewId);
}

async function main(): Promise<void> {
  const now = process.env.MOKUMOKU_NOW ? new Date(process.env.MOKUMOKU_NOW) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("MOKUMOKU_NOW が日時として読めない");
  const today = jst(now);
  const note = (file: string, result: string) => {
    console.log(`${file}: ${result}`);
    if (!DRY_RUN) appendJournalOnce(ROOT, today.date, syncLine(today.hhmm, file, result));
  };

  const sentFile = path("state", "cosense-sent.json");
  const sent: SentState = existsSync(sentFile) ? JSON.parse(readFileSync(sentFile, "utf8")) : { pages: {} };
  sent.pages ??= {};

  const appendFiles = listTxt("append");
  const pageFiles = listTxt("pages").filter((name) => sent.pages[name] !== sentKey(readFileSync(path("cosense", "pages", name), "utf8")));
  if (appendFiles.length === 0 && pageFiles.length === 0) {
    console.log("cosense-sync: 送るものが無い");
    return;
  }

  if (DRY_RUN) {
    console.log("cosense-sync: COSENSE_PAT が無い。送らずに、送るつもりの内容だけを表示する");
  } else {
    // トークンがエージェント用アカウントのものかを確かめる(人間のアカウントのトークンで書くと、行の持ち主の判定が壊れる)
    const me = await whoami(PAT);
    if (me !== AGENT_USER_ID) {
      throw new Error("COSENSE_PAT がエージェント用アカウント(satoca)のものではない。何も送らなかった");
    }
  }

  // --- 返信(ツッコミのページの末尾に足す)
  let replied = 0;
  for (const name of appendFiles.slice(0, MAX_EXAMINED)) {
    const file = `cosense/append/${name}`;
    if (replied >= MAX_PER_RUN) {
      console.log(`${file}: 今回の返信は${MAX_PER_RUN}件まで。次の起床に回す`);
      continue;
    }
    try {
      const parsed = titleFromFileName(name);
      if ("problem" in parsed) {
        note(file, `送らなかった: ${parsed.problem}`);
        continue;
      }
      const lines = toLines(readFileSync(path("cosense", "append", name), "utf8"));
      const problems = [...appendProblems(parsed.title, lines)];
      if (problems.length === 0) problems.push(...(await urlProblems(lines)));
      if (problems.length > 0) {
        note(file, `送らなかった: ${problems.join(" / ")}`);
        continue;
      }
      const page = await readPage(parsed.title);
      if (page === null) {
        note(file, "送らなかった: そのツッコミのページが無い(隊長さんが書くまで、返信する先が無い)");
        continue;
      }
      const changes = planAppend(page, lines, newLineId);
      replied++;
      if (DRY_RUN) {
        console.log(`${file}: (送らない)${describe(changes)} → ${pageUrl(page.title)}`);
        continue;
      }
      await send(page.id, changes, page.title);
      unlinkSync(path("cosense", "append", name));
      note(file, `返信した(${pageUrl(page.title)})`);
    } catch (e) {
      note(file, `失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  }

  // --- 用語ページ(前回送ったあとに変わったものだけ)
  let written = 0;
  for (const name of pageFiles.slice(0, MAX_EXAMINED)) {
    const file = `cosense/pages/${name}`;
    if (written >= MAX_PER_RUN) {
      console.log(`${file}: 今回の用語ページは${MAX_PER_RUN}件まで。次の起床に回す`);
      continue;
    }
    try {
      const raw = readFileSync(path("cosense", "pages", name), "utf8");
      const parsed = titleFromFileName(name);
      if ("problem" in parsed) {
        note(file, `送らなかった: ${parsed.problem}`);
        continue;
      }
      const body = toLines(raw);
      const problems = [...pageProblems(parsed.title, body)];
      if (problems.length === 0) problems.push(...(await urlProblems(body)));
      if (problems.length > 0) {
        note(file, `送らなかった: ${problems.join(" / ")}`);
        continue;
      }
      const page = await readPage(parsed.title);
      // 人間が書いた行は、書式を整える対象から外す(整えると、その行を消して書き直す変更になってしまう)
      const humanTexts = new Set((page?.lines ?? []).filter((l) => l.userId !== AGENT_USER_ID).map((l) => l.text));
      const plan = planPage(page, page?.title ?? parsed.title, formatPageBody(body, humanTexts), newLineId);
      if (plan.kind === "noop") {
        console.log(`${file}: ページはすでに同じ中身`);
        if (!DRY_RUN) sent.pages[name] = sentKey(raw);
        continue;
      }
      const changes: Change[] =
        plan.kind === "create" ? plan.lines.map((text) => ({ _insert: "_end", lines: { id: newLineId(), text } })) : plan.changes;
      const what =
        plan.kind === "create" ? "作成した" : plan.mode === "replace" ? "更新した" : "隊長さんの行と重なるので、無い行だけを末尾に足した";
      written++;
      if (DRY_RUN) {
        console.log(`${file}: (送らない)${what.replace(/した$/, "する")}。${describe(changes)} → ${pageUrl(parsed.title)}`);
        continue;
      }
      await send(page?.id ?? null, changes, parsed.title);
      sent.pages[name] = sentKey(raw);
      note(file, `${what}(${pageUrl(page?.title ?? parsed.title)})`);
    } catch (e) {
      note(file, `失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  }

  if (!DRY_RUN) {
    mkdirSync(dirname(sentFile), { recursive: true });
    writeFileSync(sentFile, JSON.stringify(sent, null, 2) + "\n");
  }
}

// 失敗しても job は止めない(止めると、エージェントが書いた日記や行動ログまで commit されなくなる)。
// 送れなかったファイルは残るので、次の起床でもう一度試す。
main().catch((e) => {
  console.error(`cosense-sync: ${e instanceof Error ? e.message : String(e)}`);
  try {
    const today = jst(new Date());
    appendJournalOnce(ROOT, today.date, syncLine(today.hhmm, "(全体)", `失敗: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`));
  } catch {
    // journal に書けなくても、ここでは止めない
  }
});
