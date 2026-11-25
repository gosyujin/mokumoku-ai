// 日記(entries/*.md)を HTML にする最小限の変換。外部依存なし。
// 日記は AI が外部の記事を読んで書いたものなので、生の HTML は一切通さない(すべて文字として出す)。
// 対応: 見出し / 段落 / 箇条書き(入れ子) / 番号付き / 引用 / コードブロック / 区切り線 / `コード` / **強調** / リンク

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface FrontMatter {
  [key: string]: string | string[];
}

/** 先頭の --- で囲まれた部分を読む。対応するのは `key: 値` と、`key:` に続く `- 項目` の並びだけ */
export function splitFrontMatter(source: string): { meta: FrontMatter; body: string } {
  const text = source.replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: FrontMatter = {};
  let listKey: string | null = null;
  for (const line of m[1].split("\n")) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (meta[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2] === "") {
      meta[kv[1]] = [];
      listKey = kv[1];
    } else {
      meta[kv[1]] = unquote(kv[2]);
      listKey = null;
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

function unquote(s: string): string {
  const t = s.trim();
  const q = /^"(.*)"$/.exec(t) ?? /^'(.*)'$/.exec(t);
  return q ? q[1] : t;
}

/** 行内の記法。先に全体をエスケープしてから、http(s) のリンクと強調だけをタグにする */
export function renderInline(raw: string): string {
  return raw
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return escapeHtml(part)
        .replace(
          /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()「」、。]+)/g,
          (_whole, label: string | undefined, href: string | undefined, bare: string | undefined) => {
            const url = href ?? bare ?? "";
            return `<a href="${url}" rel="noopener">${label ?? url}</a>`;
          },
        )
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    })
    .join("");
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

interface ListRow {
  indent: number;
  ordered: boolean;
  text: string;
}

/** rows[start..end) を1つのリストにする。先頭の項目より字下げが深い行は、その直前の項目の中のリストにする */
function renderList(rows: readonly ListRow[], start: number, end: number): string {
  const base = rows[start].indent;
  const tag = rows[start].ordered ? "ol" : "ul";
  let html = `<${tag}>`;
  let k = start;
  while (k < end) {
    let next = k + 1;
    while (next < end && rows[next].indent > base) next++;
    // 項目が > で始まるときは、原文そのままの引用として出す
    const quote = /^>\s?(.*)$/.exec(rows[k].text);
    const inner = quote ? `<blockquote><p>${renderInline(quote[1])}</p></blockquote>` : renderInline(rows[k].text);
    html += `<li>${inner}${next > k + 1 ? renderList(rows, k + 1, next) : ""}</li>`;
    k = next;
  }
  return `${html}</${tag}>`;
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const isBlank = (s: string | undefined) => s === undefined || s.trim() === "";
  const startsBlock = (s: string) => /^(#{1,4}\s|```|>\s?|\s*[-*]\s+|\s*\d+\.\s+|---\s*$)/.test(s);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++; // 閉じの ```
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      // 記事タイトルが h1 なので、本文の見出しは1段下げる
      const level = Math.min(heading[1].length + 1, 5);
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }
    if (/^---\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote><p>${quote.map(renderInline).join("<br>")}</p></blockquote>`);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      // 箇条書き。行頭の字下げが深い行は、直前の項目の下に入れ子にする
      const rows: ListRow[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m) break;
        rows.push({ indent: m[1].replace(/\t/g, "  ").length, ordered: /\d/.test(m[2]), text: m[3] });
        i++;
      }
      out.push(renderList(rows, 0, rows.length));
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && !(para.length > 0 && startsBlock(lines[i]))) {
      para.push(lines[i++].trim());
    }
    out.push(`<p>${para.map(renderInline).join("<br>")}</p>`);
  }
  return out.join("\n");
}
