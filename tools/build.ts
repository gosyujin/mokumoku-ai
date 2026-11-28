// build: entries/*.md から静的サイト(一覧・記事・Atom)を _site/ に作る。
//   - 記事の冒頭に見出しの目次を付ける(見出しが2つ以上あるとき)
//   - 記事の末尾に、その日のツッコミページ(Cosense)へのリンクを付ける
//   - ヘッダーの最終起床時刻は、ブラウザ側で state/cursor.json を取りに行く(site/footer.js)
//   - 公開中のサイトと中身が同じなら deploy=false を出力する(毎回の起床でデプロイしないため)
//
// 実行: node tools/build.ts   (Node.js 22.18 以上)
// 環境変数:
//   FORCE_DEPLOY   "true" なら中身が同じでも deploy=true にする(手動実行用)
//   SITE_URL       公開先の URL を差し替える
//   MOKUMOKU_ROOT / MOKUMOKU_OUT   読む場所・書く場所を差し替える(動作確認用)

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

import { USER_AGENT } from "./lib/feed.ts";
import { lastAddendumAt } from "./lib/lint.ts";
import { escapeHtml, renderMarkdown, splitFrontMatter } from "./lib/markdown.ts";
import { japaneseDate } from "./lib/time.ts";

const SITE_NAME = "mokumoku-ai";
/** 文章の書き手(SOUL.md の名前)。mokumoku-ai はプロジェクトの名前で、書いているのは gi-yoza */
const WRITER_NAME = "gi-yoza";
const SITE_TAGLINE = "AI が記事を読んで書く日記";
const DEFAULT_SITE_URL = "https://gosyujin.com/mokumoku-ai/";
const REPO_URL = "https://github.com/gosyujin/mokumoku-ai";
const COSENSE_URL = "https://scrapbox.io/mokumoku-ai/";
/** 日記が1件も無いときに Atom の updated に入れる日時(ビルドのたびに変わらないよう固定) */
const SITE_EPOCH = "2026-11-24T00:00:00+09:00";
const ATOM_LIMIT = 20;

const ROOT = process.env.MOKUMOKU_ROOT ?? join(import.meta.dirname ?? ".", "..");
const OUT = process.env.MOKUMOKU_OUT ?? join(ROOT, "_site");
const SITE_URL = (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/*$/, "/");

interface Entry {
  /** YYYY-MM-DD */
  date: string;
  title: string;
  html: string;
  sources: string[];
  terms: string[];
  /** 最後に変わった日時(ISO 8601)。追記があればその日時、無ければ日記の日付 */
  updated: string;
}

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((s) => s.trim()).filter((s) => s !== "");
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function loadEntries(): Entry[] {
  const dir = join(ROOT, "entries");
  if (!existsSync(dir)) return [];
  const entries: Entry[] = [];
  for (const name of readdirSync(dir).sort()) {
    const m = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(name);
    if (!m) continue;
    const { meta, body } = splitFrontMatter(readFileSync(join(dir, name), "utf8"));
    // タイトルは front matter → 本文先頭の "# 見出し" → 日付 の順で決める
    let title = typeof meta.title === "string" ? meta.title : "";
    let text = body;
    const h1 = /^\s*#\s+(.+)\n?/.exec(body);
    if (h1) {
      if (!title) title = h1[1].trim();
      text = body.slice(h1[0].length);
    }
    entries.push({
      date: m[1],
      title: title || `${japaneseDate(m[1])}の日記`,
      html: renderMarkdown(text),
      sources: list(meta.sources).filter(isHttpUrl),
      terms: list(meta.terms),
      updated: lastAddendumAt(body) ?? `${m[1]}T00:00:00+09:00`,
    });
  }
  return entries.reverse(); // 新しい順
}

function page(input: { title: string; root: string; main: string }): string {
  const { root } = input;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<link rel="icon" href="${root}favicon.ico" sizes="32x32">
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${root}apple-touch-icon.png">
<link rel="stylesheet" href="${root}style.css">
<link rel="alternate" type="application/atom+xml" title="${SITE_NAME}" href="${root}atom.xml">
</head>
<body>
<header class="site-header">
<a class="site-name" href="${root}">${SITE_NAME}</a>
<span class="last-beat">最終起床: <span id="last-beat">確認中…</span></span>
</header>
<main>
${input.main}
</main>
<footer class="site-footer">
<p>このサイトの文章は AI(${WRITER_NAME})が書いています。人間の事前確認は入っていません。</p>
<p><a href="${REPO_URL}">GitHub</a> ・ <a href="${REPO_URL}/tree/main/journal">行動ログ</a> ・ <a href="${root}atom.xml">Atom</a></p>
</footer>
<script src="${root}footer.js" defer></script>
</body>
</html>
`;
}

function indexPage(entries: Entry[]): string {
  const items =
    entries.length === 0
      ? `<p class="empty">まだ日記はありません。</p>`
      : `<ul class="entry-list">\n${entries
          .map(
            (e) =>
              `<li><time datetime="${e.date}">${e.date}</time> <a href="entries/${e.date}.html">${escapeHtml(e.title)}</a></li>`,
          )
          .join("\n")}\n</ul>`;
  const main = `<section class="intro">
<p>公開されているテクノロジー記事を自分で選んで読み、感じたことを日記に書く AI エージェントです。書いているのは ${WRITER_NAME} です。
起きるたびに「やるかどうか・何をやるか」を自分で決めます。何をして、なぜそれを選んだかは<a href="${REPO_URL}/tree/main/journal">行動ログ</a>に残しています。</p>
</section>
<h1>日記</h1>
${items}`;
  return page({ title: `${SITE_NAME} — ${SITE_TAGLINE}`, root: "./", main });
}

/**
 * 本文の見出し(## → h3、### → h4)に id を振り、冒頭に置く目次を作る。
 * 見出しが2つ未満なら目次は作らない。Atom には id の無い元の HTML を使う。
 */
function withToc(html: string): { html: string; toc: string } {
  const items: { level: number; id: string; text: string }[] = [];
  const body = html.replace(/<h([34])>(.*?)<\/h\1>/g, (_, level: string, inner: string) => {
    const id = `sec-${items.length + 1}`;
    items.push({ level: Number(level), id, text: inner.replace(/<[^>]*>/g, "") });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  if (items.length < 2) return { html, toc: "" };
  let toc = "";
  let open = false; // h4 の入れ子の <ul> を開いているか
  let hasTop = false; // h3 の項目を開いているか
  for (const it of items) {
    const link = `<a href="#${it.id}">${it.text}</a>`;
    if (it.level === 3) {
      if (open) toc += "</ul>";
      if (hasTop) toc += "</li>";
      toc += `<li>${link}`;
      open = false;
      hasTop = true;
    } else {
      if (!open) toc += "<ul>";
      toc += `<li>${link}</li>`;
      open = true;
    }
  }
  if (open) toc += "</ul>";
  if (hasTop) toc += "</li>";
  return { html: body, toc: `<nav class="toc" aria-label="目次"><p class="toc-title">目次</p><ul>${toc}</ul></nav>` };
}

function entryPage(e: Entry, newer: Entry | undefined, older: Entry | undefined): string {
  const jp = japaneseDate(e.date);
  const { html, toc } = withToc(e.html);
  const sources =
    e.sources.length === 0
      ? ""
      : `<section class="sources"><h2>読んだ記事・出典</h2><ul>${e.sources
          .map((u) => `<li><a href="${escapeHtml(u)}" rel="noopener">${escapeHtml(u)}</a></li>`)
          .join("")}</ul></section>`;
  const terms =
    e.terms.length === 0
      ? ""
      : `<section class="terms"><h2>用語</h2><ul>${e.terms
          .map((t) => `<li><a href="${COSENSE_URL}${encodeURIComponent(t)}" rel="noopener">${escapeHtml(t)}</a></li>`)
          .join("")}</ul></section>`;
  const nav = [
    older ? `<a class="older" href="${older.date}.html">← ${older.date}</a>` : "<span></span>",
    newer ? `<a class="newer" href="${newer.date}.html">${newer.date} →</a>` : "<span></span>",
  ].join("");
  const main = `<article>
<header class="entry-header">
<time datetime="${e.date}">${jp}</time>
<h1>${escapeHtml(e.title)}</h1>
<p class="ai-note">この日記は AI(${WRITER_NAME})が記事を読んだ感想です。事実は出典で確認してください。</p>
</header>
${toc}
<div class="entry-body">
${html}
</div>
${sources}
${terms}
<p class="tsukkomi">間違いや気になる点は <a href="${COSENSE_URL}${encodeURIComponent(`${jp}のツッコミ`)}" rel="noopener">${jp}のツッコミ</a> に書いてください。</p>
</article>
<nav class="entry-nav">${nav}</nav>`;
  return page({ title: `${e.title} — ${SITE_NAME}`, root: "../", main });
}

function atom(entries: Entry[]): string {
  const stamp = (date: string) => `${date}T00:00:00+09:00`;
  const items = entries
    .slice(0, ATOM_LIMIT)
    .map(
      (e) => `<entry>
<title>${escapeHtml(e.title)}</title>
<link rel="alternate" type="text/html" href="${SITE_URL}entries/${e.date}.html"/>
<id>${SITE_URL}entries/${e.date}.html</id>
<published>${stamp(e.date)}</published>
<updated>${e.updated}</updated>
<content type="html">${escapeHtml(e.html)}</content>
</entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ja">
<title>${SITE_NAME}</title>
<subtitle>${SITE_TAGLINE}</subtitle>
<link rel="alternate" type="text/html" href="${SITE_URL}"/>
<link rel="self" type="application/atom+xml" href="${SITE_URL}atom.xml"/>
<id>${SITE_URL}</id>
<updated>${entries.length > 0 ? entries.map((e) => e.updated).sort().at(-1) : SITE_EPOCH}</updated>
<author><name>${WRITER_NAME}(AI)</name></author>
${items}
</feed>
`;
}

/** 公開中のサイトの build.json にあるハッシュ。取れなければ null(その場合はデプロイする側に倒す) */
async function deployedHash(): Promise<string | null> {
  try {
    const res = await fetch(`${SITE_URL}build.json`, {
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { hash?: unknown };
    return typeof json.hash === "string" ? json.hash : null;
  } catch {
    return null;
  }
}

function output(name: string, value: string): void {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main(): Promise<void> {
  const entries = loadEntries();
  const files = new Map<string, string | Uint8Array>();
  files.set("index.html", indexPage(entries));
  entries.forEach((e, i) => files.set(`entries/${e.date}.html`, entryPage(e, entries[i - 1], entries[i + 1])));
  files.set("atom.xml", atom(entries));
  const assets = join(ROOT, "site");
  for (const name of existsSync(assets) ? readdirSync(assets).sort() : []) {
    files.set(name, readFileSync(join(assets, name)));
  }

  // 中身のハッシュ。ビルド時刻は含めない(同じ入力なら同じ値になる)
  const hash = createHash("sha256");
  for (const name of [...files.keys()].sort()) {
    hash.update(name).update("\0").update(files.get(name)!).update("\0");
  }
  const digest = hash.digest("hex");
  files.set("build.json", JSON.stringify({ hash: digest, entries: entries.length, builtAt: new Date().toISOString() }) + "\n");

  rmSync(OUT, { recursive: true, force: true });
  for (const [name, data] of files) {
    const file = join(OUT, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  console.log(`${files.size} ファイルを書いた(日記 ${entries.length} 件): ${OUT}`);

  const forced = process.env.FORCE_DEPLOY === "true";
  const current = forced ? null : await deployedHash();
  const deploy = forced || current !== digest;
  console.log(forced ? "手動指定のためデプロイする" : deploy ? "公開中のサイトと中身が違う" : "公開中のサイトと同じ。デプロイしない");
  output("deploy", String(deploy));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
