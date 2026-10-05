// "Bring your own key": the user's own API key, used straight from the browser.
//
// The key is stored only in chrome.storage.local and is sent only to the
// provider the user chose, never to our server. Chrome needs permission to
// contact that provider, which the extension requests at the moment the user
// adds the key (optional_host_permissions in manifest.json).
//
// This file calls the three providers' HTTP APIs with fetch, on purpose: a
// Manifest V3 extension is shipped as plain files with no bundler, and its
// content security policy forbids loading scripts from elsewhere, so an npm
// SDK can't be used here.

export const BYOK_PROVIDERS = {
  openai: {
    label: "OpenAI",
    origin: "https://api.openai.com/*",
    defaultModel: "gpt-5-nano",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-proj-..."
  },
  deepseek: {
    label: "DeepSeek",
    origin: "https://api.deepseek.com/*",
    defaultModel: "deepseek-flash",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "sk-..."
  },
  anthropic: {
    label: "Anthropic",
    origin: "https://api.anthropic.com/*",
    defaultModel: "claude-haiku-4-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-..."
  }
};

export const BYOK_IDS = Object.keys(BYOK_PROVIDERS);

const TIMEOUT_MS = 50000;

export class OwnKeyError extends Error {
  constructor(provider, { status = 0, code = null, message, retryAfter = null }) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

// A key pasted into the wrong provider is the most common mistake.
export function keyProblem(provider, rawKey) {
  const key = String(rawKey || "").trim();
  if (!key) return "Paste your API key first.";
  if (/\s/.test(key)) return "The key contains spaces or line breaks. Paste only the key.";
  if (provider !== "anthropic" && key.startsWith("sk-ant-")) return "That looks like an Anthropic key. Choose Anthropic as the provider.";
  if (provider === "anthropic" && !key.startsWith("sk-ant-")) return 'Anthropic keys start with "sk-ant-". Check the key or pick another provider.';
  if (provider === "deepseek" && /^sk-(proj|svcacct|admin)-/.test(key)) return "That looks like an OpenAI key. Choose OpenAI as the provider.";
  return null;
}

export function explainOwnKeyError(provider, status, code, message = "") {
  const label = BYOK_PROVIDERS[provider]?.label || "The provider";
  const c = String(code || "").toLowerCase();
  const m = String(message).toLowerCase();
  if (status === 401) return `${label} rejected the key. Check that you copied all of it, and that it belongs to ${label}.`;
  if (status === 402 || c.includes("insufficient") || m.includes("insufficient balance") || m.includes("credit balance")) return `Your ${label} account has no balance or credits. Add billing or credits, then try again.`;
  if (status === 403) return `${label} denied access. Check the key's permissions and that it can use this model.`;
  if (status === 404 || c.includes("model_not_found")) return `${label} does not have this model for your key. Clear the Model box to use the default, or enter a model your account can use.`;
  if (status === 429) return `${label} is rate limiting your key. Wait a moment and try again.`;
  if (status >= 500) return `${label} is having problems right now. Try again shortly.`;
  return null;
}

async function call(provider, url, init, fetchImpl, signal) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: signal || AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new OwnKeyError(provider, {
      code: timedOut ? "timeout" : "network",
      message: timedOut
        ? `${BYOK_PROVIDERS[provider].label} did not respond in time.`
        : `Could not reach ${BYOK_PROVIDERS[provider].label}. Check your connection, and that Chrome has permission to contact it (remove the key and add it again).`
    });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = data?.error;
    const message = (typeof err === "object" ? err?.message : err) || `${BYOK_PROVIDERS[provider].label} returned HTTP ${response.status}.`;
    const code = (typeof err === "object" && (err?.code || err?.type)) || null;
    throw new OwnKeyError(provider, {
      status: response.status,
      code,
      retryAfter: response.headers?.get?.("retry-after") || null,
      message: explainOwnKeyError(provider, response.status, code, message) || message
    });
  }
  return data;
}

const empty = (provider) => new OwnKeyError(provider, { status: 502, code: "empty_response", message: `${BYOK_PROVIDERS[provider].label} returned no text. Try again, or a different model.` });

const ADAPTERS = {
  openai: async ({ key, model, system, prompt, maxTokens, fetchImpl, signal }) => {
    const data = await call("openai", "https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, ...(system ? { instructions: system } : {}), input: prompt, max_output_tokens: maxTokens })
    }, fetchImpl, signal);
    const text = (data.output || []).flatMap(item => item.content || []).filter(part => part.type === "output_text").map(part => part.text).join("").trim();
    if (!text) {
      if (data.incomplete_details?.reason === "max_output_tokens") throw new OwnKeyError("openai", { status: 502, code: "max_output_tokens", message: "OpenAI used its whole token budget thinking and returned no text. Try a shorter message." });
      throw empty("openai");
    }
    return { text, model: data.model || model };
  },

  deepseek: async ({ key, model, system, prompt, maxTokens, fetchImpl, signal }) => {
    const data = await call("deepseek", "https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
        max_tokens: maxTokens
      })
    }, fetchImpl, signal);
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw empty("deepseek");
    return { text, model: data.model || model };
  },

  anthropic: async ({ key, model, system, prompt, maxTokens, fetchImpl, signal }) => {
    const data = await call("anthropic", "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // Required by Anthropic for calls made from a browser context.
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json"
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] })
    }, fetchImpl, signal);
    if (data.stop_reason === "refusal") throw new OwnKeyError("anthropic", { status: 422, code: "refusal", message: "Claude declined this request. Try rephrasing it." });
    const text = (data.content || []).filter(block => block.type === "text").map(block => block.text).join("").trim();
    if (!text) throw empty("anthropic");
    return { text, model: data.model || model };
  }
};

// One chat turn with the user's own key.
export async function sendOwnKeyRequest({ provider, key, model, prompt, system, signal, fetchImpl = (...args) => fetch(...args) }) {
  if (!ADAPTERS[provider]) throw new OwnKeyError(provider, { message: `Unknown provider "${provider}".` });
  const result = await ADAPTERS[provider]({
    key: String(key).trim(),
    model: (model || "").trim() || BYOK_PROVIDERS[provider].defaultModel,
    system,
    prompt,
    maxTokens: 4000,
    fetchImpl,
    signal
  });
  return { ...result, provider };
}

// A tiny real request, so billing, model and key problems show up when the key
// is added instead of on the first chat.
export async function testOwnKey({ provider, key, model, fetchImpl }) {
  const result = await ADAPTERS[provider]({
    key: String(key).trim(),
    model: (model || "").trim() || BYOK_PROVIDERS[provider].defaultModel,
    prompt: "Reply with OK.",
    maxTokens: 1024,
    fetchImpl: fetchImpl || ((...args) => fetch(...args)),
    signal: AbortSignal.timeout(30000)
  });
  return { ok: true, model: result.model };
}

export function maskKey(key) {
  const k = String(key || "");
  return k.length > 8 ? `...${k.slice(-4)}` : "saved";
}
