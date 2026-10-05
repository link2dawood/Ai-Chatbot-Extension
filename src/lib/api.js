export const API_ENDPOINT = "https://ai-chatbot-extension.vercel.app/api/chat";

export const PROVIDER_OPTIONS = [
  { id: "auto", label: "Auto (server default)" },
  { id: "openai", label: "OpenAI" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "anthropic", label: "Anthropic" },
  { id: "v0", label: "v0" }
];

export async function sendAssistantRequest({ prompt, system, provider, licenseKey, signal }) {
  let response;
  try {
    response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: licenseHeaders(licenseKey, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prompt, system, provider: provider || "auto" }),
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
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }

  const text = data?.text?.trim();
  if (!text) throw new Error("The assistant returned an empty response.");
  return { text, usage: data?.usage || null, provider: data?.provider || null, model: data?.model || null };
}

// Returns the server's per-provider report:
// { ok, defaultProvider, providers: { openai: { ok, configured, model, error, hint, ... }, ... } }
// A 503 still carries the report (it means no provider passed), so it is returned, not thrown.
export async function checkProviders({ provider, verify = true, licenseKey } = {}) {
  const url = new URL(API_ENDPOINT);
  if (provider && provider !== "auto") url.searchParams.set("provider", provider);
  if (verify) url.searchParams.set("verify", "1");

  let response;
  try {
    response = await fetch(url, { method: "GET", headers: licenseHeaders(licenseKey) });
  } catch (cause) {
    throw unreachable(cause);
  }
  const data = await response.json().catch(() => null);
  if (data?.providers) return data;

  console.error("[Smart Chat] Connection check failed", {
    endpoint: API_ENDPOINT,
    status: response.status,
    statusText: response.statusText,
    response: data
  });
  throw new Error(data?.error || `Service check failed (${response.status}). Is the latest api/chat.js deployed?`);
}

// Public settings from the server: where the Upgrade button goes and whether
// Polar is in test mode. Cheap (no provider calls). Returns null when the
// server can't be reached, so the panel still works offline.
export async function fetchServerInfo() {
  try {
    const url = new URL(API_ENDPOINT);
    url.searchParams.set("info", "1");
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return null;
    const data = await response.json();
    let upgradeUrl = null;
    try { upgradeUrl = data.upgradeUrl && new URL(data.upgradeUrl).protocol === "https:" ? data.upgradeUrl : null; } catch { /* ignore a malformed link */ }
    return { gated: Boolean(data.gated), environment: data.environment === "sandbox" ? "sandbox" : "production", upgradeUrl };
  } catch {
    return null;
  }
}

function licenseHeaders(licenseKey, headers = {}) {
  const key = typeof licenseKey === "string" ? licenseKey.trim() : "";
  return key ? { ...headers, "X-License-Key": key } : headers;
}

function unreachable(cause) {
  const error = new Error(`Could not reach ${new URL(API_ENDPOINT).host}. Check your internet connection, and that API_ENDPOINT in src/lib/api.js and host_permissions in manifest.json match your Vercel deployment.`);
  error.status = 0;
  error.cause = cause;
  return error;
}
