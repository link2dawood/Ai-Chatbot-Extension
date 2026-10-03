// Server-side AI provider adapters used by api/chat.js.
//
// Each provider reads its own key from a Vercel environment variable and
// exposes two operations:
//   check(verify)  → confirms the key is accepted and the model is reachable.
//                    With verify=true it also sends a tiny real request, which
//                    catches billing/quota/plan problems that a key check misses.
//   generate(...)  → runs one chat turn and returns { text, usage, model }.
//
// Errors are normalized into ProviderError so the extension gets the same
// shape (status, code, message, hint) no matter which provider failed.

import Anthropic from "@anthropic-ai/sdk";

const CHECK_TIMEOUT_MS = 12000;
const CHAT_TIMEOUT_MS = 50000;

// v0's models are tuned for UI/code generation; force plain prose so the
// extension behaves like a writing assistant, not an app generator.
const V0_BASE_SYSTEM =
  "You are a helpful writing assistant. Always reply in plain, conversational text. " +
  "Do not generate code, code blocks, components, apps, or UI unless the user explicitly asks for code.";

export const PROVIDERS = {
  openai: {
    label: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-5-nano"
  },
  deepseek: {
    label: "DeepSeek",
    keyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat"
  },
  anthropic: {
    label: "Anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-haiku-4-5"
  },
  v0: {
    label: "v0",
    keyEnv: "V0_API_KEY",
    modelEnv: "V0_MODEL",
    defaultModel: "v0-1.5-md"
  }
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export class ProviderError extends Error {
  constructor(provider, { status = 502, code = null, message, retryAfter = null, stage = "request" }) {
    super(message || `${PROVIDERS[provider]?.label || provider} request failed (${status}).`);
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.stage = stage;
    this.hint = explainError(provider, status, code, this.message);
  }
}

// Vercel stores values exactly as pasted. Surrounding quotes, spaces or a
// trailing newline make every provider reject an otherwise valid key.
export function readKey(provider, env = process.env) {
  const raw = env[PROVIDERS[provider].keyEnv];
  if (typeof raw !== "string" || !raw.trim()) return { key: null, warnings: [] };
  const warnings = [];
  let key = raw.trim();
  if (key !== raw) warnings.push("The key had leading/trailing whitespace; it was trimmed.");
  if (/^["'].*["']$/.test(key)) {
    key = key.slice(1, -1).trim();
    warnings.push("The key was wrapped in quotes; remove the quotes in Vercel.");
  }
  const mismatch = detectKeyMismatch(provider, key);
  if (mismatch) warnings.push(mismatch);
  return { key, warnings };
}

export function readModel(provider, env = process.env) {
  const value = env[PROVIDERS[provider].modelEnv];
  return typeof value === "string" && value.trim() ? value.trim() : PROVIDERS[provider].defaultModel;
}

export function isConfigured(provider, env = process.env) {
  return Boolean(readKey(provider, env).key);
}

// Best-effort guess at a key pasted into the wrong variable. Only used as a hint.
export function detectKeyMismatch(provider, key) {
  const looksAnthropic = key.startsWith("sk-ant-");
  const looksOpenAI = /^sk-(proj|svcacct|admin)-/.test(key);
  const looksDeepSeek = /^sk-[a-f0-9]{32}$/.test(key);
  const env = (id) => PROVIDERS[id].keyEnv;
  if (provider !== "anthropic" && looksAnthropic) return `This looks like an Anthropic key. Put it in ${env("anthropic")} instead of ${env(provider)}.`;
  if (provider === "anthropic" && !looksAnthropic) return `Anthropic keys start with "sk-ant-". Check the value of ${env("anthropic")}.`;
  if (provider !== "openai" && looksOpenAI) return `This looks like an OpenAI key. Put it in ${env("openai")} instead of ${env(provider)}.`;
  if (provider === "openai" && looksDeepSeek) return `This looks like a DeepSeek key. Put it in ${env("deepseek")} instead of ${env("openai")}.`;
  return null;
}

export function explainError(provider, status, code, message = "") {
  const { label, keyEnv, modelEnv } = PROVIDERS[provider] || { label: provider, keyEnv: "the API key", modelEnv: "the model" };
  const c = String(code || "").toLowerCase();
  const m = String(message || "").toLowerCase();
  if (status === 0 || c === "timeout") return `${label} did not respond in time. Try again; if it keeps happening, check ${label}'s status page.`;
  if (c === "network") return `Vercel could not reach ${label}. This is usually a temporary network problem.`;
  if (c === "not_configured") return `Add ${keyEnv} in Vercel → Project → Settings → Environment Variables, then redeploy.`;
  if (status === 401) return `${label} rejected the key. Re-copy it into ${keyEnv} (no quotes or spaces) and redeploy.`;
  if (status === 402 || c.includes("insufficient_balance") || m.includes("insufficient balance")) return `The ${label} account has no balance. Top up the account, then try again.`;
  if (c.includes("insufficient_quota") || m.includes("credit balance")) return `The ${label} account has no credits or billing set up. Add billing/credits, then try again.`;
  if (status === 403) return `${label} denied access. Check the key's project/workspace permissions and that it can use this model.`;
  if (status === 404 && provider === "v0") return "v0's API needs a Premium or Team plan with usage-based billing, and a valid V0_MODEL (for example v0-1.5-md).";
  if (status === 404 || c.includes("model_not_found")) return `The model is not available to this key. Check ${modelEnv}.`;
  if (status === 400 && (c.includes("model") || m.includes("model"))) return `${label} rejected the model name. Check ${modelEnv}.`;
  if (status === 429) return `${label} is rate limiting this key. Wait a moment and try again, or raise the account's limits.`;
  if (status === 529 || status >= 500) return `${label} is having problems right now. Try again shortly.`;
  return null;
}

function retryAfterOf(headers) {
  return headers?.get?.("retry-after") || null;
}

// fetch wrapper that converts timeouts and network failures into ProviderError.
async function request(provider, url, init, { timeoutMs, stage }) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new ProviderError(provider, {
      status: timedOut ? 504 : 502,
      code: timedOut ? "timeout" : "network",
      stage,
      message: timedOut
        ? `${PROVIDERS[provider].label} did not respond within ${Math.round(timeoutMs / 1000)}s.`
        : `Could not reach ${PROVIDERS[provider].label}: ${error?.message || "network error"}.`
    });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // OpenAI, DeepSeek and v0 all use { error: { message, code|type } }.
    const err = data?.error;
    throw new ProviderError(provider, {
      status: response.status,
      code: (typeof err === "object" && (err?.code || err?.type)) || null,
      message: (typeof err === "object" ? err?.message : err) || data?.message || `${PROVIDERS[provider].label} returned HTTP ${response.status}.`,
      retryAfter: retryAfterOf(response.headers),
      stage
    });
  }
  return data;
}

// ---------- OpenAI (Responses API) ----------

const openai = {
  async check({ key, model, verify }) {
    const auth = { Authorization: `Bearer ${key}` };
    const info = await request("openai", `https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: auth }, { timeoutMs: CHECK_TIMEOUT_MS, stage: "model" });
    if (verify) {
      // Any 200 proves billing and model access; reasoning models may return
      // status "incomplete" for a request this small, which is fine here.
      await request("openai", "https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: "Reply with OK.", max_output_tokens: 32 })
      }, { timeoutMs: CHECK_TIMEOUT_MS * 2, stage: "verify" });
    }
    return { model: info?.id || model };
  },

  async generate({ key, model, system, prompt }) {
    const data = await request("openai", "https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // gpt-5 models reason before answering, and reasoning tokens count
      // toward this limit; too small a value returns no visible text.
      body: JSON.stringify({ model, instructions: system, input: prompt, max_output_tokens: 4000 })
    }, { timeoutMs: CHAT_TIMEOUT_MS, stage: "chat" });

    const text = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(part => part.type === "output_text")
      .map(part => part.text)
      .join("")
      .trim();
    if (!text) {
      const reason = data.incomplete_details?.reason;
      throw new ProviderError("openai", {
        status: 502,
        code: reason || "empty_response",
        stage: "chat",
        message: reason === "max_output_tokens"
          ? "OpenAI used the whole token budget on reasoning and returned no text. Try a shorter request or a non-reasoning model."
          : "OpenAI returned an empty response."
      });
    }
    return { text, usage: data.usage || null, model: data.model || model };
  }
};

// ---------- OpenAI-compatible chat completions (DeepSeek, v0) ----------

function chatCompletionsProvider(provider, { baseUrl, checkPath, baseSystem = "" }) {
  return {
    async check({ key, model, verify }) {
      const auth = { Authorization: `Bearer ${key}` };
      const data = await request(provider, `${baseUrl}${checkPath}`, { headers: auth }, { timeoutMs: CHECK_TIMEOUT_MS, stage: "auth" });
      if (Array.isArray(data?.data) && data.data.length && !data.data.some(item => item.id === model)) {
        throw new ProviderError(provider, {
          status: 404,
          code: "model_not_found",
          stage: "model",
          message: `Model "${model}" is not available. Available: ${data.data.map(item => item.id).slice(0, 8).join(", ")}.`
        });
      }
      if (verify) {
        await request(provider, `${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 5 })
        }, { timeoutMs: CHECK_TIMEOUT_MS * 2, stage: "verify" });
      }
      return { model };
    },

    async generate({ key, model, system, prompt }) {
      const fullSystem = [baseSystem, system].filter(Boolean).join("\n\n");
      const data = await request(provider, `${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            ...(fullSystem ? [{ role: "system", content: fullSystem }] : []),
            { role: "user", content: prompt }
          ],
          max_tokens: 4000
        })
      }, { timeoutMs: CHAT_TIMEOUT_MS, stage: "chat" });

      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new ProviderError(provider, { status: 502, code: "empty_response", stage: "chat", message: `${PROVIDERS[provider].label} returned an empty response.` });
      return { text, usage: data.usage || null, model: data.model || model };
    }
  };
}

const deepseek = chatCompletionsProvider("deepseek", { baseUrl: "https://api.deepseek.com", checkPath: "/models" });
// v0 has no public model list; the rate-limit endpoint is an authenticated read.
const v0 = chatCompletionsProvider("v0", { baseUrl: "https://api.v0.dev/v1", checkPath: "/rate-limits", baseSystem: V0_BASE_SYSTEM });

// ---------- Anthropic (official SDK) ----------

function anthropicClient(key) {
  // Late-bound fetch so tests can stub globalThis.fetch.
  return new Anthropic({ apiKey: key, maxRetries: 1, timeout: CHAT_TIMEOUT_MS, fetch: (...args) => globalThis.fetch(...args) });
}

function fromAnthropicError(error, stage) {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError("anthropic", { status: 504, code: "timeout", stage, message: "Anthropic did not respond in time." });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError("anthropic", { status: 502, code: "network", stage, message: `Could not reach Anthropic: ${error.message}` });
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError("anthropic", {
      status: error.status || 502,
      code: error.error?.error?.type || null,
      message: error.error?.error?.message || error.message,
      retryAfter: retryAfterOf(error.headers),
      stage
    });
  }
  return new ProviderError("anthropic", { status: 502, code: "unknown", stage, message: error?.message || "Anthropic request failed." });
}

// Haiku 4.5 rejects `effort` and the refusal-fallback beta, so those are only
// sent to the newer models that support them.
const supportsFallbacks = (model) => /^claude-(fable|mythos|opus|sonnet)-[5-9]/.test(model);

function anthropicRequest({ model, system, prompt, maxTokens }) {
  const effort = process.env.ANTHROPIC_EFFORT?.trim();
  return {
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    ...(effort && supportsFallbacks(model) ? { output_config: { effort } } : {}),
    messages: [{ role: "user", content: prompt }],
    // If the model declines for policy reasons, the API retries on its
    // server-defined fallback model within the same call.
    ...(supportsFallbacks(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {})
  };
}

const anthropic = {
  async check({ key, model, verify }) {
    const client = anthropicClient(key);
    let info;
    try {
      info = await client.models.retrieve(model, { timeout: CHECK_TIMEOUT_MS });
    } catch (error) {
      throw fromAnthropicError(error, "model");
    }
    if (verify) {
      try {
        await client.beta.messages.create(
          anthropicRequest({ model, prompt: "Reply with OK.", maxTokens: 1024 }),
          { timeout: CHECK_TIMEOUT_MS * 3 }
        );
      } catch (error) {
        throw fromAnthropicError(error, "verify");
      }
    }
    return { model: info?.id || model };
  },

  async generate({ key, model, system, prompt }) {
    let response;
    try {
      response = await anthropicClient(key).beta.messages.create(
        anthropicRequest({ model, system, prompt, maxTokens: 16000 })
      );
    } catch (error) {
      throw fromAnthropicError(error, "chat");
    }
    if (response.stop_reason === "refusal") {
      throw new ProviderError("anthropic", {
        status: 422,
        code: `refusal${response.stop_details?.category ? `:${response.stop_details.category}` : ""}`,
        stage: "chat",
        message: "Claude declined this request. Try rephrasing it."
      });
    }
    const text = response.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("")
      .trim();
    if (!text) throw new ProviderError("anthropic", { status: 502, code: response.stop_reason || "empty_response", stage: "chat", message: "Anthropic returned an empty response." });
    return { text, usage: response.usage || null, model: response.model || model };
  }
};

const ADAPTERS = { openai, deepseek, anthropic, v0 };

// Resolve which provider handles a chat: explicit request → AI_PROVIDER → first configured.
export function resolveProvider(requested, env = process.env) {
  if (requested && requested !== "auto") {
    if (!PROVIDERS[requested]) throw new ProviderError(requested, { status: 400, code: "unknown_provider", message: `Unknown provider "${requested}". Use one of: ${PROVIDER_IDS.join(", ")}.` });
    return requested;
  }
  const preferred = typeof env.AI_PROVIDER === "string" ? env.AI_PROVIDER.trim().toLowerCase() : "";
  if (preferred && PROVIDERS[preferred] && isConfigured(preferred, env)) return preferred;
  return PROVIDER_IDS.find(id => isConfigured(id, env)) || null;
}

function notConfigured(provider) {
  return new ProviderError(provider, {
    status: 503,
    code: "not_configured",
    stage: "config",
    message: `${PROVIDERS[provider].keyEnv} is not set on Vercel.`
  });
}

export async function checkProvider(provider, { verify = false, env = process.env } = {}) {
  const { label, keyEnv } = PROVIDERS[provider];
  const { key, warnings } = readKey(provider, env);
  const model = readModel(provider, env);
  const base = { provider, label, keyEnv, model, configured: Boolean(key), verified: false, warnings };
  if (!key) {
    const error = notConfigured(provider);
    return { ...base, ok: false, stage: error.stage, error: error.message, hint: error.hint };
  }
  const started = Date.now();
  try {
    const result = await ADAPTERS[provider].check({ key, model, verify });
    return { ...base, ok: true, verified: verify, model: result.model, latencyMs: Date.now() - started };
  } catch (error) {
    const err = error instanceof ProviderError ? error : new ProviderError(provider, { message: error?.message });
    console.error(`[Smart Chat API] ${label} check failed`, { stage: err.stage, status: err.status, code: err.code, message: err.message });
    return {
      ...base,
      ok: false,
      latencyMs: Date.now() - started,
      stage: err.stage,
      upstreamStatus: err.status,
      upstreamCode: err.code,
      error: err.message,
      hint: err.hint || warnings[0] || null
    };
  }
}

export async function generate(provider, { system, prompt, env = process.env }) {
  const { key } = readKey(provider, env);
  if (!key) throw notConfigured(provider);
  const model = readModel(provider, env);
  return { provider, ...(await ADAPTERS[provider].generate({ key, model, system, prompt })) };
}
