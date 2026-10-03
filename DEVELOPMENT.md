# Development Guide

Smart Chat Assistant 2.5 is a Chrome Manifest V3 side-panel extension with a Vercel backend.

## Project structure

- `manifest.json` and `background.js`: configuration and side-panel activation.
- `public/sidebar.html`: side-panel markup.
- `src/scripts/sidebar.js`: interface, modes, history, and export.
- `src/styles/sidebar.css`: light and dark styles.
- `src/lib/api.js`: backend endpoint and requests.
- `src/lib/markdown.js`: Markdown rendering.
- `assets/`: icons and artwork.
- `api/chat.js`: Vercel function (health check and chat routing).
- `server/providers.js`: OpenAI, DeepSeek, Anthropic and v0 adapters, connection checks and error hints.
- `tests/`: renderer and provider/backend tests (network calls are stubbed).

## Local development

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this `Ai-Chatbot-Extension` folder.
3. Click the extension icon to open the side panel.
4. Reload after changes. Inspect the side panel to view its console.

Run `npm ci`, then `npm run lint` and `npm test`, with Node.js 20 or later. The only dependency is `@anthropic-ai/sdk`, which the backend uses. GitHub Actions runs these checks on pushes and pull requests.

## Backend

See [API-SETUP.md](API-SETUP.md) for configuration. Set at least one provider key on Vercel (see `.env.example`). Keep credentials server-side. Deploy this folder as the Vercel project root.

If the backend URL changes, update `API_ENDPOINT` in `src/lib/api.js` and the matching `host_permissions` entry in `manifest.json`.

For local backend development, copy `.env.example` to `.env.local`, fill in server credentials, and run `vercel dev`. To connect locally, temporarily set the extension endpoint and host permission to the local server address.
