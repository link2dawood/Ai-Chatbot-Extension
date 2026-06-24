// Minimal, XSS-safe Markdown renderer.
// Supports: code blocks, inline code, bold, italic, headings, ordered and
// unordered lists, paragraphs. All input is HTML-escaped first, so only the
// tags this module generates are ever inserted into the DOM.

export function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function renderInline(s) {
    return s
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/__([^_]+)__/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/(^|[\s(])_([^_]+)_/g, "$1<em>$2</em>");
}

export function renderMarkdown(text) {
    const lines = escapeHtml(text).split("\n");
    let html = "";
    let inCode = false;
    let codeBuffer = [];
    let listType = null;
    let paraBuffer = [];

    function flushPara() {
        if (paraBuffer.length) {
            html += `<p>${renderInline(paraBuffer.join(" "))}</p>`;
            paraBuffer = [];
        }
    }
    function closeList() {
        if (listType) { html += `</${listType}>`; listType = null; }
    }

    for (let line of lines) {
        if (line.trim().startsWith("```")) {
            if (!inCode) {
                flushPara(); closeList();
                inCode = true; codeBuffer = [];
            } else {
                html += `<pre><code>${codeBuffer.join("\n")}</code></pre>`;
                inCode = false;
            }
            continue;
        }
        if (inCode) { codeBuffer.push(line); continue; }

        const ul = line.match(/^\s*[-*]\s+(.*)$/);
        const ol = line.match(/^\s*\d+\.\s+(.*)$/);
        const h = line.match(/^(#{1,3})\s+(.*)$/);

        if (ul) {
            flushPara();
            if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; }
            html += `<li>${renderInline(ul[1])}</li>`;
        } else if (ol) {
            flushPara();
            if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; }
            html += `<li>${renderInline(ol[1])}</li>`;
        } else if (h) {
            flushPara(); closeList();
            html += `<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`;
        } else if (line.trim() === "") {
            flushPara(); closeList();
        } else {
            closeList();
            paraBuffer.push(line);
        }
    }
    if (inCode) { html += `<pre><code>${codeBuffer.join("\n")}</code></pre>`; }
    flushPara(); closeList();
    return html;
}
