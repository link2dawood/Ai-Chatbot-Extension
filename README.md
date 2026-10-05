# Smart Chat Assistant 2.5

Chrome Manifest V3 side-panel assistant with Chat, Reply ("What should I say?"), Rewrite (with intents like Decline or Follow up), Grammar, Summarize, and Explain modes.

## Included
- Native Chrome side panel
- 10 successful free chats per local Chrome profile
- Chat / Reply / Rewrite / Grammar / Summarize / Explain modes
- Reply: select a message you received and get four ready-to-send replies (Professional, Persuasive, Short, Friendly)
- Rewrite intents: Agree, Disagree, Ask for clarification, Negotiate, Follow up, Decline, Apologize, Persuade, Escalate, Thank, Request, Remind
- Copy, insert into page, clear history, export, light/dark theme
- Vercel serverless API route at `api/chat.js`
- Choice of provider: OpenAI, DeepSeek, Anthropic or v0. Keys stay server-side.
- Free allowance counted on the server (Redis), so clearing the extension does not reset it
- Premium users can attach images, PDFs and text files to a chat
- Clear "Upgrade to Premium" and "Use your own key" buttons in the panel
- Users can add their own OpenAI, DeepSeek or Anthropic key (stored only in their browser, called directly)
- Paid-only access to the hosted providers through Polar license keys, with a sandbox/production switch (optional; see [API.md](API.md))
- Connection check that verifies each provider's key, model and billing, and suggests a fix when something fails

## API architecture

Chrome extension → `https://ai-chatbot-extension.vercel.app/api/chat` → OpenAI / DeepSeek / Anthropic / v0

Set one or more of `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `V0_API_KEY` as Vercel environment variables, then redeploy. See [API-SETUP.md](API-SETUP.md). Never put keys in `manifest.json`, browser JavaScript, HTML or committed `.env` files.

## Install extension locally
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this folder.
5. Click the extension icon to open the side panel.

## Verify connection
Open Settings, pick a provider (or Auto), and click **Check connection**. Each provider is reported as Verified, Failed (with the reason and a fix) or Not set.


## Debug logging

API failures are logged to the sidebar DevTools console, and upstream provider failures are logged in Vercel Functions logs. Secret keys are never logged.
