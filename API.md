# API reference and sample payloads

Base URL: `https://ai-chatbot-extension.vercel.app/api/chat`

Ready-to-use request bodies for all five modes are in [`examples/payloads.json`](examples/payloads.json). The tests send every one of them to the handler, so they stay in step with the prompts in `src/lib/prompts.js`.

## `POST /api/chat`

Request headers:

| Header | Required | Notes |
|---|---|---|
| `Content-Type: application/json` | yes | |
| `X-License-Key` | for paid access | The customer's Polar license key. |
| `X-Client-Id` | for the free allowance | A random UUID the extension makes on first run. Free chats are counted against it. |

Request body:

| Field | Type | Notes |
|---|---|---|
| `prompt` | string, required | The user's message. 1 to 6000 characters. |
| `system` | string, optional | Mode instructions. Up to 4000 characters. Defaults to a short generic prompt. |
| `provider` | string, optional | `auto` (default), `openai`, `deepseek`, `anthropic` or `v0`. Ignored for free visitors, who always get the free provider. |
| `attachments` | array, optional | Up to 3 files, **paid users only**. Each is `{ "name": "report.pdf", "mime": "application/pdf", "data": "<base64>" }`. See below. |

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
| 402 | `paid_required` | Gating is on and the caller is neither licensed nor able to use the free allowance. Includes `upgradeUrl`. | Buy, or paste the license key |
| 402 | `free_limit_reached` | The device has used all of its free chats. Includes `quota` and `upgradeUrl`. | Upgrade, or use your own key |
| 402 | `free_limit_ip` | This IP address used up its free chats for today | Try tomorrow, or upgrade |
| 402 | `attachments_paid` | Attachments need a verified paid license | Upgrade |
| 400 | `attachments_unsupported` | Images or PDFs sent to DeepSeek or v0, which can't read them | Use OpenAI, Anthropic or auto |
| 400 / 413 | `unsupported_type`, `type_mismatch`, `attachments_too_large` | A file is not an allowed type, its bytes don't match its type, or the limits were exceeded | Fix the files |
| 503 | `quota_unavailable` | The free-allowance store could not be reached (fails closed) | Retry shortly |
| 401 | `license_invalid`, `license_revoked`, `license_expired` | The license was not accepted | Check the key or renew |
| 413 | | `prompt` over 6000 or `system` over 4000 characters | Shorten it |
| 503 | `license_unavailable` | Polar could not be reached, so the server refuses (fails closed) | Retry shortly |
| 503 | `not_configured` | No provider key is set on Vercel | Add a key and redeploy |
| 401, 402, 404, 429 and others | provider's code | The provider rejected the call. Includes `provider`, `upstreamStatus` and a `hint`. | Follow the `hint` |
| 502 | | Provider or network failure | Retry |

## Attachments (paid users)

Premium users can attach images, PDFs and text files. The server checks the license first, then the files.

| | |
|---|---|
| Types | PNG, JPEG, GIF, WebP images; PDF; plain text, Markdown, CSV and JSON files |
| Limits | 3 files, 3 MB in total, and 60,000 characters across text files. (Vercel rejects bodies over 4.5 MB, and base64 adds a third.) |
| Checks | Each file's real bytes must match its type (a renamed `.exe` or a text file called `.png` is refused). File names are cleaned. |
| Providers | **OpenAI** and **Anthropic** read images and PDFs. **DeepSeek** and **v0** are text-only, so they accept text files only (added to the prompt) and refuse images and PDFs with a message. With `auto`, a provider that can read them is chosen. |
| Not stored | Files are passed to the provider and not kept. The extension keeps only the file names in the chat history. |

Sample payload:

```json
{
  "prompt": "Summarize this report and describe the chart.",
  "system": "You are a precise summariser. ...",
  "provider": "auto",
  "attachments": [
    { "name": "report.pdf", "mime": "application/pdf", "data": "JVBERi0xLjQK..." },
    { "name": "chart.png", "mime": "image/png", "data": "iVBORw0KGgo..." }
  ]
}
```

## Plans, usage and the thin client

The extension is a thin client. The server decides plans, limits, prices, prompts and which model answers; the extension only reads them, so changing any of it needs a Vercel redeploy and **no extension update**.

- `GET /api/chat?config=1` returns public data: `apiVersion`, `gated`, `environment`, `upgradeUrl`, `plans` (name, price, period, limit, premiumLimit, perks), `features`, `intents` (id and label for Rewrite), `modes` (system prompts), `minExtensionVersion`, `updateMessage`. The extension checks every field, accepts only https links, and never runs anything it receives.
- **Free**: `FREE_DAILY_LIMIT` messages per day (default 10) on `STANDARD_PROVIDER` (default DeepSeek), counted per device (`X-Client-Id`) and per IP (`FREE_IP_DAILY_LIMIT`, default 40) in UTC days.
- **Pro**: `PRO_MONTHLY_LIMIT` messages per month (default 500) on the standard provider, plus `PRO_PREMIUM_MONTHLY_LIMIT` (default 30) premium requests on `PREMIUM_PROVIDER` (default Anthropic Claude Haiku). A request is premium when the Premium toggle is on (`quality: "premium"`) or it carries an image or PDF. Files are Pro only.
- Counts live in Redis (Upstash) against keyed hashes of the device id, IP and license key. A message is reserved before the model is called and given back if the call fails. If the store is missing or down while paid-only access is on, requests fail closed.
- Refusals carry a `code` and server-worded `error`: `free_limit_reached`, `free_limit_ip`, `pro_limit_reached`, `premium_limit_reached`, `premium_required`, `attachments_paid`, `update_required` (HTTP 426, only when `MIN_EXTENSION_VERSION` is set and the `X-Extension-Version` header is older).
- Reply accepts `intent` too, with ids from `replyIntents` (reply, ask, follow_up, close). Rewrite and Reply accept `style`: a short plain-text writing profile from the extension (max 1200 characters), used as style preferences only. Mode `learn` turns writing samples into a list of style characteristics.
- Rewrite accepts `intent`: an id from `intents` (Agree, Disagree, Decline, …) or free text such as "firm but respectful". The instructions behind the ids stay on the server.
- `GET /api/chat?quota=1` (with `X-Client-Id`, and `X-License-Key` for Pro) returns `{ plan, period, resetsAt, used, limit, remaining, premium? }`.
- OpenAI (gpt-5-nano) is kept for internal utility jobs and only serves chats if it is the only provider. v0 is disabled unless `DISABLED_PROVIDERS` is set without it.

## `GET /api/chat`: connection report

```
GET /api/chat                              all providers: key set, key accepted, model available
GET /api/chat?verify=1                     the same, plus a tiny real request to each provider
GET /api/chat?provider=deepseek&verify=1   one provider
```

When paid gating is on, `verify=1` only runs for requests that carry a valid `X-License-Key`, because it spends tokens on your keys. Without one the report is still returned, with `verified: false`.

The report also has a `usageCounting` block with the counter store status, the limits and the routing, even while paid-only access is still off: `{ "configured": true, "reachable": true, "activeNow": false, "limits": {...}, "standardProvider": "deepseek", "premiumProvider": "anthropic" }`. `reachable: true` means the store answered a ping; `activeNow` becomes true once paid-only access is on.

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

## `GET /api/chat?info=1`: public settings

Cheap and safe: no provider calls and nothing secret. The extension reads it on open to know where the Upgrade button goes.

```json
{ "ok": true, "gated": true, "environment": "production", "upgradeUrl": "https://buy.polar.sh/polar_cl_...", "freeQuota": true, "freeLimit": 10 }
```

`upgradeUrl` is `null` unless the checkout link is set and uses `https`. `environment` is `sandbox` when `POLAR_ENV=sandbox`; the extension then shows a "test mode" note.

## Paid access with Polar

### Environment variables

| Variable | Purpose |
|---|---|
| `POLAR_ENV` | `production` (default) or `sandbox`. The one switch for which Polar the server uses. Any other value means production. |
| `POLAR_ORGANIZATION_ID` | Production organization id. **Setting it turns paid-only access on.** Leave it unset to keep the API open. |
| `POLAR_CHECKOUT_URL` | Production checkout link for the Upgrade buttons. Works even while paid-only access is off. |
| `POLAR_SANDBOX_ORGANIZATION_ID` | Sandbox organization id (a different id from production). |
| `POLAR_SANDBOX_CHECKOUT_URL` | Sandbox checkout link. |

Keep both sets in Vercel and flip `POLAR_ENV`. In sandbox mode the `POLAR_SANDBOX_*` values are used, and the production names are the fallback when a sandbox one is not set. The old name `POLAR_SERVER` still works; `POLAR_ENV` wins if both are set. Redeploy after changing any of them.

### Setup

1. In Polar, create a product (a subscription or one-time purchase) and add the **License Keys** benefit to it.
2. In Polar → Settings, copy the **Organization ID**. Create a **checkout link** for the product, with the success URL pointing at your site.
3. In Vercel, set the checkout link variable first. The Upgrade buttons appear in the extension right away.
4. When you want paid-only access, set the organization id for the active environment and redeploy.
5. A customer buys, Polar emails them a license key, and they paste it into the extension under Settings → Paid plan.

On every request the server asks Polar `POST /v1/customer-portal/license-keys/validate` with `{ "key", "organization_id" }` and accepts the key only when its `status` is `granted` and it has not expired. Valid results are cached for 5 minutes (per environment), so a cancelled subscription stops working within about 5 minutes. If Polar is unreachable the request is refused.

## Own API keys (no server involved)

Users can add their own OpenAI, DeepSeek or Anthropic key under Settings → Your own API key. The extension then calls that provider directly from the browser: the key is stored only in `chrome.storage.local` and never reaches this server, so none of the endpoints above are involved and there is no free limit. Chrome asks for permission to contact that one provider at the moment the key is added (`optional_host_permissions` in `manifest.json`), and removing the key removes the permission.
