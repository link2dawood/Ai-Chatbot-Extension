# API setup

## How it connects

Chrome extension → `https://ai-chatbot-extension.vercel.app/api/chat` → OpenAI, DeepSeek, Anthropic or v0

The extension never sees an API key. Keys are Vercel environment variables, read by `server/providers.js`.

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables. You can configure one provider or several. **Redeploy after every change**, because Vercel only applies new variables to new deployments.

| Provider | Key variable | Model variable (default) | Notes |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL` (`gpt-5-nano`) | Responses API. Needs API billing, which is separate from a ChatGPT subscription. |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL` (`deepseek-flash`) | The account needs a positive balance. |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` (`claude-haiku-4-5`) | Official SDK. Cheapest Claude model by default. `ANTHROPIC_EFFORT` is optional and only applies to Opus/Sonnet 5+ models. |
| v0 | `V0_API_KEY` | `V0_MODEL` (`v0-1.5-md`) | Needs a v0 Premium/Team plan with usage-based billing. Otherwise v0 returns 404. |

`AI_PROVIDER` chooses which provider **Auto** uses. If it is unset, or that provider has no key, Auto uses the first configured provider in this order: OpenAI, DeepSeek, Anthropic, v0.

Each key belongs in its own variable. An Anthropic or DeepSeek key placed in `OPENAI_API_KEY` is sent to OpenAI and rejected. The connection check detects this and tells you which variable the key belongs in.

## Connection check

Open the extension → Settings → choose a provider (or Auto) → **Check connection**. For each provider the server:

1. confirms the key variable is set, and warns about quotes, spaces or a key that looks like another provider's;
2. confirms the key is accepted and the model is available (`GET /models/{model}` for OpenAI and Anthropic, the model list for DeepSeek, `/rate-limits` for v0);
3. sends a tiny test request. This catches billing, balance, quota and plan problems that a key check alone misses.

Each provider shows **Verified**, **Failed** (with the failing step, the provider's error, and a suggested fix) or **Not set**.

You can call the same check directly:

```
GET /api/chat                              # all providers, key + model only
GET /api/chat?verify=1                     # all providers, plus a test request
GET /api/chat?provider=deepseek&verify=1   # one provider
```

## Chat request

```
POST /api/chat  { "prompt": "...", "system": "...", "provider": "auto" | "openai" | "deepseek" | "anthropic" | "v0" }
```

A successful reply returns `{ ok, provider, model, text, usage }`. A failure returns `{ ok: false, provider, upstreamStatus, upstreamCode, error, hint }`. Upstream 4xx statuses are passed through, and upstream 5xx statuses become 502.

## Paid access and the checkout link

Set `POLAR_CHECKOUT_URL` and the extension shows an "Upgrade to Premium" button. Set `POLAR_ORGANIZATION_ID` and the hosted providers become paid-only. `POLAR_ENV` (`production` or `sandbox`) chooses which Polar is used, with `POLAR_SANDBOX_ORGANIZATION_ID` and `POLAR_SANDBOX_CHECKOUT_URL` for the sandbox. The full table and setup steps are in [API.md](API.md#paid-access-with-polar).

## Users' own API keys

Anyone can add their own OpenAI, DeepSeek or Anthropic key in the extension's Settings. Those chats go straight from the browser to the provider and never touch this server, so there is nothing to configure here.

## Free allowance on the server

With paid-only access on, visitors without a license get a few chats on one cheap model, counted on the server (details in [API.md](API.md#free-allowance)). It needs a small Redis store, because Vercel functions forget everything between requests:

1. In Vercel open your project → **Storage** → **Create** → **Upstash Redis** (the free plan is enough), and connect it to the project. Vercel adds the variables for you: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` and `KV_REST_API_TOKEN`. If you gave the connection a prefix, the names carry it (for example `chat_assistant_db_KV_REST_API_URL`), and the server finds those too. It never uses the read-only token.
2. Optionally set `FREE_CHAT_LIMIT` (default 10), `FREE_IP_DAILY_LIMIT` (default 40) and `FREE_PROVIDER` (default: the first of DeepSeek, OpenAI, Anthropic with a key).
3. Redeploy, then open `/api/chat?provider=deepseek` (any provider works). The `freeAllowance` block should show `"configured": true, "reachable": true`. That works even before paid-only access is on; `"activeNow"` turns true once it is, and `?info=1` then shows `"freeQuota": true`.

Without the store there is no free tier: visitors get the paid-only message. Free chats are never counted in the extension when the server counts them.

## Attachments

Premium users can attach images, PDFs and text files. Images and PDFs need OpenAI or Anthropic; text files work with any provider. Nothing to configure: it uses the provider keys you already set. Limits and the sample payload are in [API.md](API.md#attachments-paid-users).
