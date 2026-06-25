# AI Writing Assistant — Chrome Extension

A lightweight Manifest V3 Chrome extension that puts an AI chat assistant in your
browser toolbar. It's **zero-setup for end users** — there is no API key to enter and
nothing to configure. The extension talks to a small [Vercel](https://vercel.com)
serverless function that holds the API key in an environment variable, so the key is
never shipped inside the extension.

> Backend: the function proxies to the **v0 Model API** (default model `v0-1.5-md`).
> The v0 API requires a **Premium/Team plan with usage-based billing enabled**.

## ✨ Features

- **Side panel UI** — clicking the toolbar icon opens a docked side panel that **stays open
  until you close it** (unlike a popup, it survives clicking the page / switching tabs).
- **One-click chat** — type and get answers without leaving the page.
- **Conversation modes** — Chat, Improve writing, Fix grammar, Summarize, Explain.
- **Markdown rendering** — replies render bold, italic, code blocks, headings, and lists
  (via a small, XSS-safe renderer — no remote scripts).
- **Token counter** — shows approximate API tokens used this session.
- **Quota display & limits** — a header progress bar shows your real v0 allowance
  (`used/total today` + reset timer, green→yellow→red). The backend checks
  `/v1/rate-limits` before each call; when exhausted, sends are blocked with a "daily
  limit reached" modal (chat history kept). Sends are also debounced while a reply is in
  flight.
- **Plain-text replies** — a server-side system prompt keeps v0's UI-oriented models
  answering in prose, not code/components.
- **History management** — conversations persist locally; Clear and Export (Text / Markdown / PDF).
- **Copy & Insert** — copy the last reply, or inject it into the focused field on the page.
- **Keyboard** — Enter to send, Shift+Enter for a newline.
- **Dark mode**, loading skeletons, and clear error messages with a Retry button.

## 🧱 Architecture

```
Side panel (public/popup.html + src/scripts/popup.js)
        │  POST { prompt, system }
        ▼
Vercel function (api/chat.js)  ──uses V0_API_KEY (env var)──►  v0 Model API
        ▲
        │  { text, usage }
        ◄
```

The API key lives only in a Vercel environment variable. End users install the extension
and chat immediately — they never see or supply a key.

## 📁 Project structure

```
manifest.json            MV3 manifest (loads from the repo root; side_panel + background)
icon-16.png              Toolbar icon
public/
  popup.html             Side panel UI
src/
  scripts/popup.js       UI logic (ES module)
  scripts/background.js  Service worker — opens the side panel on icon click
  lib/markdown.js        XSS-safe Markdown renderer (tested)
  lib/chat.js            Request/response helpers + modes (tested)
  styles/popup.css       UI styles
api/
  chat.js                Vercel serverless proxy (holds the key server-side)
tests/                   node:test unit tests
.github/workflows/ci.yml Lint + test on every push/PR
```

## 🚀 Install (Load Unpacked)

1. Clone this repo:
   ```bash
   git clone https://github.com/link2dawood/Ai-Chatbot-Extension.git
   cd Ai-Chatbot-Extension
   ```
2. Open `chrome://extensions/` and enable **Developer mode** (top right).
3. Click **Load unpacked** and select the repository root.
4. Pin the extension and click its icon — the chat opens in the **side panel** and stays
   open until you close it.

> The extension only works once the backend is deployed and its URL is set — see below.

## 🔧 Backend setup (one-time, by the developer)

The extension calls a Vercel function you deploy. Users do **not** do this.

1. Deploy to Vercel from the repo:
   ```bash
   vercel --prod
   ```
2. Add the API key as an environment variable (never commit it):
   ```bash
   vercel env add V0_API_KEY production
   vercel env add AI_MODEL production   # optional, defaults to v0-1.5-md
   ```
3. Put your deployed URL into [`src/scripts/popup.js`](src/scripts/popup.js) — replace the
   `API_ENDPOINT` value `https://your-app.vercel.app/api/chat` with your real URL.
4. Reload the extension.

See [DEVELOPMENT.md](DEVELOPMENT.md) for details and [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
if something doesn't work.

## 🧪 Development

```bash
npm test       # run unit tests (Node's built-in runner, no dependencies)
npm run lint   # syntax-check all JS
```

CI runs both on every push and pull request.

## 🔒 Security & privacy

- No API key is stored in the extension; it lives in a Vercel environment variable.
- A strict Content Security Policy (`script-src 'self'; object-src 'self'`) is enforced,
  and all assets (icons, scripts, styles) are local — the extension makes no third-party
  requests other than to your Vercel endpoint.
- Permissions are minimal: `activeTab` and `scripting` (used only when you click **Insert**),
  plus `host_permissions` for `https://*.vercel.app/*`.

## 📄 License

MIT — see [LICENSE](LICENSE) if present.

## ⚠️ Disclaimer

AI responses may be inaccurate. Use your own judgment when acting on them. You are
responsible for the AI provider account and any usage costs incurred by your deployed
Vercel function.
