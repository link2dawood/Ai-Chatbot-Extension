// Regenerates the Chrome Web Store images in store-assets/out/.
//
//   npm install --no-save playwright   (once; the browser must be installed)
//   node store-assets/make-assets.mjs
//
// The side panel in every image is the real public/sidebar.html running in
// Chromium, with its stored chat history pre-filled. Nothing in the panel is
// mocked up by hand. The backdrop around it (captions, a sample email page) is
// decoration. Output is JPEG, which has no alpha channel, as the store requires.

import { chromium } from "playwright";
import http from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "store-assets", "out");
mkdirSync(outDir, { recursive: true });

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".html": "text/html", ".png": "image/png" };
const server = http.createServer((req, res) => {
  try {
    const body = readFileSync(join(root, decodeURIComponent(req.url.split("?")[0])));
    res.writeHead(200, { "content-type": TYPES[extname(req.url.split("?")[0])] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, done));
const PANEL = `http://localhost:${server.address().port}/public/sidebar.html`;
const LOGO = `http://localhost:${server.address().port}/assets/logo.svg`;

const at = Date.now();
const turn = (user, assistant) => [{ role: "user", text: user, at }, { role: "assistant", text: assistant, at }];

const SHOTS = {
  rewrite: {
    settings: { theme: "light", mode: "rewrite" },
    history: turn(
      "Rewrite this to sound professional and natural: hey, just checking if u got my email abt the invoice, need it paid asap thx",
      "Hello, I wanted to check that you received my email about the invoice. Could you please arrange payment at your earliest convenience? Thank you."
    ),
    headline: "Rewrite any text<br>in one click",
    sub: "Clearer, friendlier or more professional, with your meaning, names and numbers kept."
  },
  grammar: {
    settings: { theme: "light", mode: "grammar" },
    history: turn(
      "Correct the grammar in this text without changing my tone: me and him goes to the market yesterday and buyed some apple.",
      "He and I went to the market yesterday and bought some apples."
    ),
    headline: "Fix grammar and<br>keep your voice",
    sub: "Spelling, grammar and punctuation corrected with a light touch."
  },
  summarize: {
    settings: { theme: "light", mode: "summarize" },
    history: turn(
      "Summarize this in 3 concise bullets: The team met on Monday to review Q3. Revenue grew 12% to $4.2M, driven by the new Pro plan. Churn rose from 2.1% to 2.9% after the August price change. The team decided to run a win-back campaign in October and to revisit pricing in November.",
      "- Q3 revenue grew 12% to $4.2M, driven by the new Pro plan.\n- Churn rose from 2.1% to 2.9% after the August price change.\n- Decisions: run a win-back campaign in October and revisit pricing in November."
    ),
    headline: "Summarize long text<br>in seconds",
    sub: "Turn articles, notes and email threads into the points that matter."
  },
  insert: {
    settings: { theme: "light", mode: "rewrite" },
    history: turn(
      "Rewrite this to sound professional and natural: hey, just checking if u got my email abt the invoice, need it paid asap thx",
      "Hello, I wanted to check that you received my email about the invoice. Could you please arrange payment at your earliest convenience? Thank you."
    ),
    headline: "Insert the reply<br>straight into the page",
    sub: "Put the answer into the email, document or form you are working in.",
    emailBody: "Hello, I wanted to check that you received my email about the invoice. Could you please arrange payment at your earliest convenience? Thank you."
  },
  dark: {
    settings: { theme: "dark", mode: "chat" },
    history: turn(
      "What is the difference between a cookie and local storage?",
      "Cookies are small pieces of data sent to the server with every request. Local storage stays in the browser and is never sent automatically.\n\n- **Cookies:** about 4 KB, can expire, sent with each request.\n- **Local storage:** about 5 MB, no expiry, read only by your page's scripts."
    ),
    headline: "Light and dark<br>themes",
    sub: "Ask anything and get a short, direct answer beside the page you are on.",
    dark: true
  }
};

const FONT = "'Liberation Sans', Helvetica, Arial, sans-serif";

function panelFrame(shot, { width = 380, height = 740 } = {}) {
  const state = encodeURIComponent(JSON.stringify({ settings: shot.settings, chatHistory: shot.history, freeChatsUsed: 2 }));
  return `<iframe src="${PANEL}#${state}" style="width:${width}px;height:${height}px;border:0;border-radius:18px;background:#fff;box-shadow:0 30px 70px rgba(20,40,34,.28), 0 0 0 1px rgba(0,0,0,.08)"></iframe>`;
}

function screenshotHtml(shot) {
  const dark = shot.dark;
  const bg = dark ? "linear-gradient(135deg,#142521,#1f3a33)" : "linear-gradient(135deg,#e6efeb,#f6f6f1)";
  const ink = dark ? "#f2f5f3" : "#1c2b26";
  const muted = dark ? "#a9bdb6" : "#4c615a";
  const left = shot.emailBody
    ? `<div style="width:600px;background:#fff;border-radius:14px;box-shadow:0 20px 50px rgba(20,40,34,.18),0 0 0 1px rgba(0,0,0,.07);overflow:hidden;font-family:${FONT}">
         <div style="background:#eef1ef;padding:12px 16px;font-size:13px;color:#52615b;border-bottom:1px solid #dfe5e2">New message</div>
         <div style="padding:14px 20px;font-size:14px;color:#52615b;border-bottom:1px solid #eef1ef">To: accounts@example.com</div>
         <div style="padding:14px 20px;font-size:14px;color:#52615b;border-bottom:1px solid #eef1ef">Subject: Invoice follow-up</div>
         <div style="padding:22px 20px 70px;font-size:16px;line-height:1.55;color:#1c2b26">${shot.emailBody}</div>
       </div>`
    : "";
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1280px;height:800px;background:${bg};font-family:${FONT};position:relative;overflow:hidden">
    <img src="${LOGO}" style="position:absolute;left:64px;top:56px;width:44px;height:44px">
    <div style="position:absolute;left:120px;top:63px;font-size:22px;font-weight:700;color:${ink}">Smart Chat Assistant</div>
    <div style="position:absolute;left:64px;top:${shot.emailBody ? 150 : 230}px;width:${shot.emailBody ? 600 : 640}px">
      <div style="font-size:${shot.emailBody ? 52 : 62}px;line-height:1.08;font-weight:700;letter-spacing:-1.5px;color:${ink}">${shot.headline}</div>
      <div style="margin-top:22px;font-size:22px;line-height:1.45;color:${muted};max-width:560px">${shot.sub}</div>
    </div>
    ${shot.emailBody ? `<div style="position:absolute;left:64px;top:410px">${left}</div>` : ""}
    <div style="position:absolute;right:72px;top:30px">${panelFrame(shot)}</div>
  </body>`;
}

function promoSmallHtml() {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;width:440px;height:280px;background:linear-gradient(135deg,#2f5a4f,#3f6f63);font-family:${FONT};position:relative;overflow:hidden">
    <img src="${LOGO}" style="position:absolute;left:30px;top:30px;width:64px;height:64px">
    <div style="position:absolute;left:30px;top:116px;font-size:34px;line-height:1.1;font-weight:700;color:#fff;letter-spacing:-.5px">Smart Chat<br>Assistant</div>
    <div style="position:absolute;left:30px;top:200px;font-size:17px;color:#d6e6e0">AI writing and chat in your side panel</div>
    <div style="position:absolute;left:30px;bottom:18px;display:flex;gap:6px;font-size:11px;color:#fff">${["Chat", "Rewrite", "Grammar", "Summarize", "Explain"].map(t => `<span style="padding:3px 8px;border:1px solid rgba(255,255,255,.45);border-radius:99px">${t}</span>`).join("")}</div>
  </body>`;
}

function marqueeHtml() {
  const shot = SHOTS.rewrite;
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1400px;height:560px;background:linear-gradient(120deg,#2b5348,#3f6f63 55%,#5b8a7d);font-family:${FONT};position:relative;overflow:hidden">
    <img src="${LOGO}" style="position:absolute;left:80px;top:78px;width:72px;height:72px">
    <div style="position:absolute;left:80px;top:178px;width:760px;font-size:64px;line-height:1.05;font-weight:700;letter-spacing:-2px;color:#fff">AI writing and chat<br>in your side panel</div>
    <div style="position:absolute;left:80px;top:370px;font-size:26px;color:#d6e6e0;width:700px;line-height:1.4">Rewrite, proofread, summarize and explain text without leaving the page.</div>
    <div style="position:absolute;left:80px;bottom:56px;display:flex;gap:10px;font-size:18px;color:#fff">${["Chat", "Rewrite", "Grammar", "Summarize", "Explain"].map(t => `<span style="padding:6px 16px;border:1.5px solid rgba(255,255,255,.5);border-radius:99px">${t}</span>`).join("")}</div>
    <div style="position:absolute;right:110px;top:48px;transform:rotate(0deg)">${panelFrame(shot, { width: 380, height: 700 })}</div>
  </body>`;
}

const browser = await chromium.launch();
async function render(html, width, height, file) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  // Give the panel its stored state and stub the extension APIs it calls.
  await context.addInitScript(() => {
    const raw = decodeURIComponent(location.hash.slice(1) || "");
    let state = {};
    try { state = raw ? JSON.parse(raw) : {}; } catch { state = {}; }
    window.chrome = { storage: { local: { get: (keys, cb) => cb(state), set: (data, cb) => cb && cb() } }, tabs: {}, scripting: {} };
  });
  const page = await context.newPage();
  await page.setContent(html);
  await page.waitForFunction(() => [...document.images].every(i => i.complete));
  await page.waitForTimeout(1200); // let the panel frames run their scripts
  await page.screenshot({ path: join(outDir, file), type: "jpeg", quality: 96 });
  await context.close();
  console.log("wrote", file, `${width}x${height}`);
}

let n = 1;
for (const [name, shot] of Object.entries(SHOTS)) await render(screenshotHtml(shot), 1280, 800, `screenshot-${n++}-${name}.jpg`);
await render(promoSmallHtml(), 440, 280, "promo-small-440x280.jpg");
await render(marqueeHtml(), 1400, 560, "promo-marquee-1400x560.jpg");

await browser.close();
server.close();
