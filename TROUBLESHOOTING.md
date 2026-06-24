# Troubleshooting

Common problems and how to fix them. Open the popup's DevTools (right-click the popup →
**Inspect**) and check the Console — most issues show a clear error there.

## "AI service is unavailable" / "Couldn't reach the AI service"

The popup couldn't get a valid reply from the backend. Work through these in order:

| Cause | Check | Fix |
|-------|-------|-----|
| Endpoint not set | `API_ENDPOINT` in `src/scripts/popup.js` is still `https://your-app.vercel.app/api/chat` | Set it to your real deployed URL, then reload the extension |
| Function not deployed | Visit `<your-url>/api/chat` in the browser | Run `vercel --prod` |
| Missing env var | Function returns "Server is not configured with an API key" | `vercel env add V0_API_KEY production`, then redeploy |
| **v0 API not enabled** | v0 returns **404 for every request** — a valid key and an invalid key get the identical 404 | Enable **usage-based billing on a Premium/Team plan** in v0 → Billing. The v0 API is gated behind this. |
| Bad/expired key | Function logs show a 401/403 from v0 | Rotate the key (v0.app → Settings → API Keys) and update the env var |
| Wrong model id | v0 returns an error about the model | Set `AI_MODEL` to a valid id (`v0-1.5-md` or `v0-1.5-lg`) |
| No internet | Other sites fail too | Reconnect and click **Retry** |

The **Retry** button in the error bubble re-sends the last message once you've fixed the cause.

## CORS error in the console

`Access to fetch ... has been blocked by CORS policy`.

- `api/chat.js` sets `Access-Control-Allow-Origin: *` and handles `OPTIONS`. If you edited
  it, make sure those headers are still sent **before** any early return.
- Confirm `host_permissions` in `manifest.json` still covers your endpoint
  (`https://*.vercel.app/*`). If you use a custom domain, add it there.

## CSP violation in the console

`Refused to load/execute ... because it violates the Content Security Policy`.

The CSP is strict on purpose: `script-src 'self'; object-src 'self'`. It blocks remote
scripts and inline `<script>`. Keep everything local:

- Don't add CDN `<script>`/icon-font `<link>` tags — use the inline SVG icons instead.
- Don't use inline event handlers or inline `<script>`; keep JS in `src/scripts/`.

## Icons are missing / boxes show

All icons are inline SVG, so they shouldn't depend on the network. If they're missing,
you likely edited an SVG and broke its markup — re-check the `<svg>` in
`public/popup.html` (and the moon/sun strings in `src/scripts/popup.js`).

## Export → PDF doesn't open the print dialog

PDF export opens a printable page and calls `print()`. This is best-effort: if the popup
closes (loses focus) before the new tab finishes loading, the print dialog may not appear
automatically.

- The printable page still opens — just press **Ctrl/Cmd + P** and choose **Save as PDF**.
- A popup blocker can also stop the new tab; allow popups for the extension.
- Text (.txt) and Markdown (.md) exports download directly and are fully reliable.

## Insert ("Insert into page field") does nothing

The button injects the last reply into the **focused** input on the active tab.

- Click into a text field on the page first, then click Insert.
- It only fills `<input>` and `<textarea>` (and the active element must be editable).
- Some pages (e.g. `chrome://` pages, the Web Store) block content injection — try a normal site.

## Chat history or token counter looks wrong

History, the selected mode, dark mode, and the token total are stored in the popup's
`localStorage`. Use **Clear** to wipe the conversation and reset the token counter. To
reset everything, remove and re-add the extension.

## Tests or CI failing

```bash
npm run lint   # syntax errors in any JS file
npm test       # failing unit assertions
```

Run these locally (Node 18+) before pushing; CI runs the same commands.
