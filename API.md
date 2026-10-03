# API reference and sample payloads

Base URL: `https://ai-chatbot-extension.vercel.app/api/chat`

Ready-to-use request bodies for all five modes are in [`examples/payloads.json`](examples/payloads.json). The tests send every one of them to the handler, so they stay in step with the prompts in `src/lib/prompts.js`.

## `POST /api/chat`

Request headers:

| Header | Required | Notes |
|---|---|---|
| `Content-Type: application/json` | yes | |
| `X-License-Key` | only when paid gating is on | The customer's Polar license key. |

Request body:

| Field | Type | Notes |
|---|---|---|
| `prompt` | string, required | The user's message. 1 to 6000 characters. |
| `system` | string, optional | Mode instructions. Up to 4000 characters. Defaults to a short generic prompt. |
| `provider` | string, optional | `auto` (default), `openai`, `deepseek`, `anthropic` or `v0`. |

### Sample: Rewrite mode

```bash
curl -s https://ai-chatbot-extension.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -H "X-License-Key: YOUR_POLAR_LICENSE_KEY" \
  -d '{
    "prompt": "Rewrite this to sound professional and natural: hey, just checking if u got my email abt the invoice, need it paid asap thx",
    "system": "You are an expert editor. Rewrite the user'\''s text so it is clearer, better organised and better toned while keeping the original meaning.\n\nRules:\n- Return only the rewritten text, with no preface, labels or explanation.\n- Keep every fact, name, number, date and link exactly as given.\n- Reply in the same language as the user'\''s text unless they ask for another language.",
    "provider": "auto"
  }'
```

(`examples/payloads.json` has the full, exact system prompt for every mode.)

Success, `200`:

```json
{
  "ok": true,
  "provider": "deepseek",
  "model": "deepseek-flash",
  "text": "Hello, I wanted to check that you received my email about the invoice. Please could you arrange payment at your earliest convenience? Thank you.",
  "usage": { "prompt_tokens": 210, "completion_tokens": 38, "total_tokens": 248 }
}
```

Errors always look like `{ "ok": false, "error": "...", ... }`:

| Status | `code` / `upstreamCode` | Meaning | Fix |
|---|---|---|---|
| 400 | | Missing `prompt`, or unknown `provider` | Fix the request |
| 402 | `paid_required` | Gating is on and no license key was sent. Includes `upgradeUrl`. | Buy, or paste the license key |
| 401 | `license_invalid`, `license_revoked`, `license_expired` | The license was not accepted | Check the key or renew |
| 413 | | `prompt` over 6000 or `system` over 4000 characters | Shorten it |
| 503 | `license_unavailable` | Polar could not be reached, so the server refuses (fails closed) | Retry shortly |
| 503 | `not_configured` | No provider key is set on Vercel | Add a key and redeploy |
| 401, 402, 404, 429 and others | provider's code | The provider rejected the call. Includes `provider`, `upstreamStatus` and a `hint`. | Follow the `hint` |
| 502 | | Provider or network failure | Retry |

## `GET /api/chat`: connection report

```
GET /api/chat                              all providers: key set, key accepted, model available
GET /api/chat?verify=1                     the same, plus a tiny real request to each provider
GET /api/chat?provider=deepseek&verify=1   one provider
```

When paid gating is on, `verify=1` only runs for requests that carry a valid `X-License-Key`, because it spends tokens on your keys. Without one the report is still returned, with `verified: false`.

Sample response:

```json
{
  "ok": true,
  "vercel": true,
  "verified": true,
  "gated": true,
  "entitled": true,
  "defaultProvider": "deepseek",
  "providers": {
    "deepseek": { "provider": "deepseek", "label": "DeepSeek", "configured": true, "ok": true, "verified": true, "model": "deepseek-flash", "latencyMs": 940, "warnings": [] },
    "openai":   { "provider": "openai", "label": "OpenAI", "configured": false, "ok": false, "stage": "config", "error": "OPENAI_API_KEY is not set on Vercel.", "hint": "Add OPENAI_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy." }
  },
  "error": null
}
```

## Paid access with Polar

Set `POLAR_ORGANIZATION_ID` and the hosted providers become paid-only. Leave it empty and the API stays open.

1. In Polar, create a product (a subscription or one-time purchase) and add the **License Keys** benefit to it.
2. In Polar → Settings, copy the **Organization ID**. Create a **checkout link** for the product.
3. In Vercel, set `POLAR_ORGANIZATION_ID` and `POLAR_CHECKOUT_URL`, then redeploy. Set `POLAR_SERVER=sandbox` to try it against Polar's sandbox first.
4. A customer buys, Polar emails them a license key, and they paste it into the extension under Settings → Paid plan.

On every request the server asks Polar `POST /v1/customer-portal/license-keys/validate` with `{ "key", "organization_id" }` and accepts the key only when its `status` is `granted` and it has not expired. Valid results are cached for 5 minutes, so a cancelled subscription stops working within about 5 minutes. If Polar is unreachable the request is refused.
