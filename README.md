# Smart Chat Assistant 2.4

Chrome Manifest V3 side-panel assistant with Chat, Rewrite, Grammar, Summarize, and Explain modes.

## Included
- Native Chrome side panel
- 10 successful free chats per local Chrome profile
- Chat / Rewrite / Grammar / Summarize / Explain modes
- Copy, insert into page, clear history, export, light/dark theme
- Vercel serverless API route at `api/chat.js`
- OpenAI Responses API integration with the API key kept server-side
- Health check that verifies both Vercel and OpenAI connectivity

## API architecture

Chrome extension → `https://ai-chatbot-extension.vercel.app/api/chat` → OpenAI Responses API

Set `OPENAI_API_KEY` as a Vercel environment variable. Do not put it in `manifest.json`, browser JavaScript, HTML, or committed `.env` files.

## Install extension locally
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this folder.
5. Click the extension icon to open the side panel.

## Verify connection
Open Settings and click **Check connection**. Version 2.4 reports success only when the hosted Vercel function can also authenticate to OpenAI.


## Debug logging

Version 2.4 logs API failures to the sidebar DevTools console and logs upstream OpenAI failures in Vercel Functions logs. Secret keys are never logged.
