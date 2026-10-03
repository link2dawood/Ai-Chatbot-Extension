# API setup

## How it connects

Chrome extension → `https://ai-chatbot-extension.vercel.app/api/chat` → OpenAI, DeepSeek, Anthropic or v0

The extension never sees an API key. Keys are Vercel environment variables, read by `server/providers.js`.

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables. You can configure one provider or several. **Redeploy after every change**, because Vercel only applies new variables to new deployments.

| Provider | Key variable | Model variable (default) | Notes |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL` (`gpt-5-mini`) | Responses API. Needs API billing, which is separate from a ChatGPT subscription. |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL` (`deepseek-chat`) | The account needs a positive balance. |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` (`claude-opus-5-5`) | Official SDK. `ANTHROPIC_EFFORT` is optional (`low` to `max`). Server-side refusal fallback is enabled. |
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

## Free quota

The extension includes 10 successful free chats per Chrome profile. Failed requests do not consume a chat. The quota is stored locally because the project has no database or account system.
