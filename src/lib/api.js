export const API_ENDPOINT = "https://ai-chatbot-extension.vercel.app/api/chat";

export async function sendAssistantRequest({ prompt, system, signal }) {
  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, system }),
    signal
  });

  let data = null;
  try { data = await response.json(); } catch { data = null; }

  if (!response.ok) {
    console.error("[Smart Chat] API request failed", {
      endpoint: API_ENDPOINT,
      status: response.status,
      statusText: response.statusText,
      response: data
    });
    const detail = data?.upstreamCode ? ` [${data.upstreamCode}]` : "";
    const error = new Error(`${data?.error || `Request failed (${response.status}).`}${detail}`);
    error.status = response.status;
    error.upstreamStatus = data?.upstreamStatus || response.status;
    error.upstreamCode = data?.upstreamCode || null;
    error.provider = data?.provider || null;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }

  const text = data?.text?.trim();
  if (!text) throw new Error("The assistant returned an empty response.");
  return { text, usage: data?.usage || null, rateLimit: data?.rateLimit || null };
}

export async function pingAssistant() {
  const response = await fetch(API_ENDPOINT, { method: "GET" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[Smart Chat] Connection check failed", {
      endpoint: API_ENDPOINT,
      status: response.status,
      statusText: response.statusText,
      response: data
    });
    const detail = data?.upstreamCode ? ` [${data.upstreamCode}]` : "";
    throw new Error(`${data?.error || `Service check failed (${response.status}).`}${detail}`);
  }
  return data;
}
