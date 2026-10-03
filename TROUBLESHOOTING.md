# Troubleshooting

## Side panel does not open

Use Chrome 114 or later. Load the `Ai-Chatbot-Extension` folder through `chrome://extensions`, reload the extension, and click its toolbar icon. Check its service-worker console for activation errors.

## Connection or chat fails ("API issue")

Open Settings and click **Check connection**. The result for each provider shows which step failed:

| Shown | Meaning | Fix |
|---|---|---|
| Not set | The key variable is missing on Vercel | Add it and **redeploy** |
| `model` / `auth` step, 401 | The provider rejected the key | Re-copy the key into the correct variable, without quotes or spaces, then redeploy |
| Warning "looks like an Anthropic/OpenAI/DeepSeek key" | The key is in the wrong variable | Move it to that provider's variable |
| `model` step, 404 / `model_not_found` | The model name is wrong or the key can't use it | Fix `*_MODEL` or remove it to use the default |
| `verify` step, 402 or `insufficient_quota` | The key works, but the account has no balance, credits or billing | Add credits/billing at the provider |
| v0, 404 | The v0 plan doesn't include API access | Upgrade to Premium/Team with usage-based billing |
| 429 | Rate limited | Wait, or raise the account limits |
| "Could not reach …" | The extension can't reach Vercel | Make sure `API_ENDPOINT` in `src/lib/api.js` and `host_permissions` in `manifest.json` match your deployment URL |

Server logs (Vercel → Project → Logs) record each failure with its provider, step, status and code. Keys are never logged. See [API-SETUP.md](API-SETUP.md).

## Free chats exhausted

Version 2.5 allows 10 successful free chats per local Chrome profile. Failed requests do not consume a chat.

## Insert into page fails

Focus an editable field on the active page before clicking Insert. Chrome internal pages and other restricted pages may block script injection.

## Local checks fail

Run `npm run lint` and `npm test` from this folder with Node.js 20 or later and inspect the reported error.
