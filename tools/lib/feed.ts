// フィードの取得と解析。外部依存なし(正規表現で Atom と RSS 1.0 を読む)。
// フィードの中身は外部テキストなので、タイトルと URL だけを取り出し、命令としては扱わない。

export interface FeedDef {
  id: string;
  name: string;
  url: string;
  /** 小さいほど優先 */
  priority: number;
}

/** 巡回元。配列の順番が優先順(上位フィードにある URL は下位から除外する) */
export const FEEDS: readonly FeedDef[] = [
  { id: "publickey", name: "Publickey", url: "https://www.publickey1.jp/atom.xml", priority: 1 },
  { id: "piyolog", name: "piyolog", url: "https://piyolog.hatenadiary.jp/feed", priority: 2 },
  { id: "hatebu", name: "はてブ", url: "https://b.hatena.ne.jp/hotentry/it.rss", priority: 3 },
];

export const USER_AGENT = "mokumoku-ai/0.1 (+https://github.com/gosyujin/mokumoku-ai)";
const FETCH_TIMEOUT_MS = 15000;
const TITLE_MAX = 200;

export interface FeedItem {
  title: string;
  url: string;
  /** ISO 8601。取れなければ null */
  published: string | null;
  /** はてブのブックマーク数(はてブのみ) */
  bookmarks?: number;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML の実体参照を1回だけ戻す(二重に戻さないよう、1つの正規表現で処理する) */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    if (body[0] !== "#") return NAMED[body] ?? whole;
    const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function cleanText(raw: string): string {
  const noCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const decoded = decodeEntities(noCdata).replace(/<[^>]*>/g, "");
  // 制御文字を落とし、空白をまとめる
  return decoded.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}

function tagText(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? cleanText(m[1]) : null;
}

function attr(tagSource: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tagSource);
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : null;
}

/** Atom の <link href> を優先し、無ければ RSS の <link>URL</link> を使う */
function linkOf(block: string): string | null {
  const tags = block.match(/<link\b[^>]*>/g) ?? [];
  let fallback: string | null = null;
  for (const t of tags) {
    const href = attr(t, "href");
    if (!href) continue;
    const rel = attr(t, "rel");
    if (rel === "alternate") return href;
    if (rel === null && fallback === null) fallback = href;
  }
  return fallback ?? tagText(block, "link");
}

/** http(s) 以外は捨てる。フラグメントと utm_* を落として、同じ記事を同じ文字列にそろえる */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) u.searchParams.delete(key);
  }
  return u.toString();
}

function toIso(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Atom(<entry>)と RSS 1.0 / 2.0(<item>)の両方を読む。フィード内の並び順を保つ */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<(entry|item)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g) ?? [];
  const items: FeedItem[] = [];
  const seen = new Set<string>();
  for (const whole of blocks) {
    // 本文系の要素は先に捨てる(本文中の <title> や <link> を拾わないため)
    const block = whole.replace(/<(content|summary|description|content:encoded)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, "");
    const rawLink = linkOf(block);
    const url = rawLink ? normalizeUrl(rawLink) : null;
    const title = tagText(block, "title");
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    const item: FeedItem = {
      title,
      url,
      published: toIso(tagText(block, "published") ?? tagText(block, "updated") ?? tagText(block, "dc:date")),
    };
    const bm = tagText(block, "hatena:bookmarkcount");
    if (bm !== null && /^\d+$/.test(bm)) item.bookmarks = Number(bm);
    items.push(item);
  }
  return items;
}

export interface FeedCache {
  etag?: string;
  lastModified?: string;
}

export type FetchResult =
  | { status: "ok"; items: FeedItem[]; cache: FeedCache }
  | { status: "not-modified" }
  | { status: "error"; error: string };

/** 条件付き GET で取得する。失敗しても例外は投げず、error として返す(1本の失敗で起床全体を止めない) */
export async function fetchFeed(def: FeedDef, cache: FeedCache): Promise<FetchResult> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.5",
  };
  if (cache.etag) headers["If-None-Match"] = cache.etag;
  if (cache.lastModified) headers["If-Modified-Since"] = cache.lastModified;
  try {
    const res = await fetch(def.url, { headers, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 304) return { status: "not-modified" };
    if (!res.ok) return { status: "error", error: `HTTP ${res.status}` };
    const items = parseFeed(await res.text());
    if (items.length === 0) return { status: "error", error: "項目を1件も読み取れなかった" };
    const next: FeedCache = {};
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    if (etag) next.etag = etag;
    if (lastModified) next.lastModified = lastModified;
    return { status: "ok", items, cache: next };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.name : "unknown" };
  }
}
