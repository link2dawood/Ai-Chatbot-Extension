# Development Guide

This document covers how the extension is built, how to run it locally, and how to extend it.

## Overview

Two pieces live in one repo:

1. **The extension** (loaded into Chrome) — `manifest.json`, `public/`, `src/`, `icon-16.png`.
2. **The backend** (deployed to Vercel) — `api/chat.js`.

The popup never holds an API key. It POSTs `{ prompt, system }` to the Vercel function,
which adds the key from `process.env.V0_API_KEY` and proxies to the v0 Model API
(`https://api.v0.dev/v1/chat/completions`), returning `{ text, usage }`.

## Project structure

```
manifest.json            MV3 manifest — load the repo ROOT as the unpacked extension
public/popup.html        Popup markup (loads popup.js as an ES module)
src/scripts/popup.js      Popup controller: events, rendering, fetch, history, export
src/lib/markdown.js       escapeHtml / renderInline / renderMarkdown (pure, tested)
src/lib/chat.js           MODES, buildRequestBody, parseChatResponse, estimateTokens,
                          tokensFromResponse (pure, tested)
src/styles/popup.css      Popup styles (light + dark)
api/chat.js               Vercel serverless function (ESM default export)
tests/*.test.js           node:test unit tests for the lib modules
.github/workflows/ci.yml  CI: validate manifest, lint, test
.env / .env.example       Local env vars for `vercel dev` (.env is git-ignored)
```

Pure, browser-free logic lives in `src/lib/` so it can be unit-tested in Node. The popup
imports those modules; `api/chat.js` is independent.

## Running locally

### Load the extension

1. `chrome://extensions/` → enable **Developer mode**.
2. **Load unpacked** → select the repo root.
3. After editing files, click the **reload** icon on the extension card.

DevTools for the popup: right-click the popup → **Inspect**.

### Run the backend locally (optional)

```bash
# .env already holds V0_API_KEY and AI_MODEL (git-ignored)
vercel dev
```

Point `API_ENDPOINT` in `src/scripts/popup.js` at the local URL (e.g.
`http://localhost:3000/api/chat`) while developing, then switch it back to the production
URL before publishing.

## Deploying the backend

```bash
vercel --prod
vercel env add V0_API_KEY production
vercel env add AI_MODEL production        # optional; default is "v0-1.5-md"
```

`.env` is for local development only — Vercel does **not** read it in production. Set
production values via the dashboard or `vercel env add`.

Then set `API_ENDPOINT` in `src/scripts/popup.js` to the deployed URL and reload.

## Testing & linting

```bash
npm test       # node --test  (runs tests/*.test.js)
npm run lint   # node --check on every JS file
```

No dependencies are required — both use Node's built-ins (Node 18+). CI runs the same
commands on every push and PR.

When you add logic worth testing, put the pure part in `src/lib/` and add a
`tests/<name>.test.js` using `node:test` + `node:assert/strict`.

## How to extend

### Add a conversation mode
Add an entry to `MODES` in [`src/lib/chat.js`](src/lib/chat.js) and a matching
`<option>` in the `#modeSelect` element in [`public/popup.html`](public/popup.html).
Update the `MODES` keys assertion in `tests/chat.test.js`.

### Add or change an icon
Icons are inline SVG in `public/popup.html` (and the moon/sun strings in
`src/scripts/popup.js`). Use `currentColor` for stroke/fill so they inherit button color
and dark-mode styling. Do **not** add a remote icon font — it would violate the CSP.

### Change the model
Set the `AI_MODEL` env var (no code change). Default is `v0-1.5-md`; `v0-1.5-lg` is also valid.

## Conventions

- Keep all assets local — the CSP is `script-src 'self'; object-src 'self'` and the
  extension must make no third-party requests except to the Vercel endpoint.
- Render AI output through `renderMarkdown` (escapes HTML first); never assign untrusted
  text to `innerHTML` directly.
- Keep the permission set minimal (`activeTab`, `scripting`).
