// 実行: node --test   (Node.js 22.18 以上)

import assert from "node:assert/strict";
import { test } from "node:test";

import { renderMarkdown } from "./lib/markdown.ts";

test("renderMarkdown: 字下げした箇条書きは、直前の項目の下に入れ子にする", () => {
  const html = renderMarkdown(["- 話題1", "  - 掘り下げ", "    - さらに掘り下げ", "  - 別の掘り下げ", "- 話題2"].join("\n"));
  assert.equal(
    html,
    "<ul><li>話題1<ul><li>掘り下げ<ul><li>さらに掘り下げ</li></ul></li><li>別の掘り下げ</li></ul></li><li>話題2</li></ul>",
  );
});

test("renderMarkdown: 見出しと箇条書きは別のかたまり。入れ子の無い箇条書きは、これまでどおり", () => {
  assert.equal(renderMarkdown("### 話題\n\n- a\n- b"), "<h4>話題</h4>\n<ul><li>a</li><li>b</li></ul>");
  assert.equal(renderMarkdown("1. 一\n2. 二"), "<ol><li>一</li><li>二</li></ol>");
});

test("renderMarkdown: 生の HTML は通さない(入れ子の中でも)", () => {
  assert.equal(renderMarkdown("- a\n  - <script>x</script>"), "<ul><li>a<ul><li>&lt;script&gt;x&lt;/script&gt;</li></ul></li></ul>");
});
