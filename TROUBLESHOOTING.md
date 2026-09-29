# Troubleshooting

## Side panel does not open

Use Chrome 114 or later. Load the `Ai-Chatbot-Extension` folder through `chrome://extensions`, reload the extension, and click its toolbar icon. Check its service-worker console for activation errors.

## Connection or chat fails

Open Settings and click **Check connection**. Success requires Vercel connectivity and OpenAI authentication. Inspect the side-panel console and Vercel function logs for details.

- Ensure `api/chat.js` is deployed and `OPENAI_API_KEY` is configured on Vercel. Redeploy after environment changes.
- Check that `OPENAI_MODEL`, if configured, is available to the server's API key.
- Ensure `API_ENDPOINT` in `src/lib/api.js` matches the deployment and is covered by `host_permissions` in `manifest.json`.
- For upstream authentication or rate-limit errors, check the server key or account limits using the reported error details.

See [API-SETUP.md](API-SETUP.md). Never put a secret key in browser code.

## Free chats exhausted

Version 2.4 allows 10 successful free chats per local Chrome profile. Failed requests do not consume a chat.

## Insert into page fails

Focus an editable field on the active page before clicking Insert. Chrome internal pages and other restricted pages may block script injection.

## Local checks fail

Run `npm run lint` and `npm test` from this folder with Node.js 20 or later and inspect the reported error.
