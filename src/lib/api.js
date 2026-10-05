// The only thing the extension needs to know about the backend is where it lives. Everything
// else (plans, limits, prompts, prices, which AI answers) is decided by the server and read from
// GET ?config=1, so the backend can change without a new extension release. See config.js.
export const API_ENDPOINT = "https://ai-chatbot-extension.vercel.app/api/chat";

// Sent as X-Extension-Version so the server can ask an old extension to update.
let clientVersion = "";
export function setClientVersion(version) { clientVersion = String(version || ""); }

// X-License-Key proves a paid plan; X-Client-Id is a random id made on first run, used to count free messages.
function requestHeaders({ licenseKey, clientId } = {}, headers = {}) {
  const key = typeof licenseKey === "string" ? licenseKey.trim() : "";
  return {
    ...headers,
    ...(key ? { "X-License-Key": key } : {}),
    ...(clientId ? { "X-Client-Id": clientId } : {}),
    ...(clientVersion ? { "X-Extension-Version": clientVersion } : {})
  };
}

export async function sendAssistantRequest({ prompt, system, mode, quality, licenseKey, clientId, attachments, signal }) {
  let response;
  try {
    response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: requestHeaders({ licenseKey, clientId }, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        prompt,
        // The server uses its own prompt for a known mode; `system` is only a fallback for servers that don't.
        system,
        mode,
        quality: quality === "premium" ? "premium" : "standard",
        // Only what the server needs, never the file sizes or anything local.
        ...(attachments?.length ? { attachments: attachments.map(({ name, mime, data }) => ({ name, mime, data })) } : {})
      }),
      signal
    });
  } catch (cause) {
    throw unreachable(cause);
  }

  let data = null;
  try { data = await response.json(); } catch { data = null; }

  if (!response.ok) {
    console.error("[Smart Chat] API request failed", {
      endpoint: API_ENDPOINT,
      status: response.status,
      statusText: response.statusText,
      response: data
    });
    const error = new Error(data?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.upstreamStatus = data?.upstreamStatus || response.status;
    error.upstreamCode = data?.upstreamCode || null;
    error.provider = data?.provider || null;
    error.hint = data?.hint || null;
    error.code = data?.code || null;
    error.upgradeUrl = data?.upgradeUrl || null;
    error.quota = data?.quota || null;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }

  const text = data?.text?.trim();
  if (!text) throw new Error("The assistant returned an empty response.");
  return { text, usage: data?.usage || null, provider: data?.provider || null, model: data?.model || null, quota: data?.quota || null };
}

// The server's settings, as the server sent them (config.js checks them). null when unreachable.
export async function fetchConfig() {
  try {
    const url = new URL(API_ENDPOINT);
    url.searchParams.set("config", "1");
    const response = await fetch(url, { method: "GET", headers: requestHeaders(), signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// This browser's usage, from the server.
//   { status: "ok", quota }         the numbers
//   { status: "off" }               the server isn't counting (paid-only access is off)
//   { status: "denied", code, message }   a license that was sent is not valid
//   { status: "error" }             the server couldn't be reached or answered badly
export async function fetchQuota({ clientId, licenseKey } = {}) {
  try {
    const url = new URL(API_ENDPOINT);
    url.searchParams.set("quota", "1");
    const response = await fetch(url, { method: "GET", headers: requestHeaders({ clientId, licenseKey }), signal: AbortSignal.timeout(8000) });
    const data = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 402) return { status: "denied", code: data?.code || null, message: data?.error || "That license was not accepted." };
    if (!response.ok || !data) return { status: "error" };
    if (!data.enabled) return { status: "off" };
    const { ok, enabled, ...quota } = data;
    return { status: "ok", quota };
  } catch {
    return { status: "error" };
  }
}

function unreachable(cause) {
  const error = new Error(`Could not reach ${new URL(API_ENDPOINT).host}. Check your internet connection and try again.`);
  error.status = 0;
  error.cause = cause;
  return error;
}
