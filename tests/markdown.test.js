import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, renderMarkdown } from "../src/lib/markdown.js";

test("escapeHtml neutralizes HTML special characters", () => {
    assert.equal(escapeHtml("<b> & </b>"), "&lt;b&gt; &amp; &lt;/b&gt;");
});

test("renderMarkdown is XSS-safe: script tags are escaped, not executed", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    assert.ok(!html.includes("<script>"), "raw <script> must not survive");
    assert.ok(html.includes("&lt;script&gt;"), "angle brackets must be escaped");
});

test("renderMarkdown renders bold and italic", () => {
    assert.ok(renderMarkdown("**bold**").includes("<strong>bold</strong>"));
    assert.ok(renderMarkdown("*italic*").includes("<em>italic</em>"));
});

test("renderMarkdown renders inline code", () => {
    assert.ok(renderMarkdown("use `npm test` now").includes("<code>npm test</code>"));
});

test("renderMarkdown renders fenced code blocks", () => {
    const html = renderMarkdown("```\nconst x = 1;\n```");
    assert.ok(html.includes("<pre><code>"));
    assert.ok(html.includes("const x = 1;"));
});

test("renderMarkdown renders unordered and ordered lists", () => {
    const ul = renderMarkdown("- one\n- two");
    assert.ok(ul.includes("<ul>") && ul.includes("<li>one</li>") && ul.includes("<li>two</li>"));

    const ol = renderMarkdown("1. first\n2. second");
    assert.ok(ol.includes("<ol>") && ol.includes("<li>first</li>"));
});

test("renderMarkdown renders headings", () => {
    assert.ok(renderMarkdown("# Title").includes("<h1>Title</h1>"));
});

test("renderMarkdown wraps plain text in a paragraph", () => {
    assert.equal(renderMarkdown("hello world"), "<p>hello world</p>");
});
