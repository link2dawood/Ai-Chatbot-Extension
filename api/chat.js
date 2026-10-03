// Vercel Serverless Function — /api/chat
//
// GET                          → checks every provider (key accepted + model reachable).
// GET ?provider=<id>           → checks one provider.
// GET ...&verify=1             → also sends a tiny real request to each checked provider.
// POST { prompt, system, provider? } → one chat turn on the chosen provider
//                                (provider omitted or "auto" → AI_PROVIDER, else the first configured).
//
// Keys live only in Vercel environment variables; see server/providers.js.
//
// When POLAR_ORGANIZATION_ID is set, the server-side providers are for paid
// users only: POST needs a valid Polar license key in the X-License-Key
// header, and GET ?verify=1 (which spends tokens) needs one too. See
// server/entitlement.js.

import { PROVIDERS, PROVIDER_IDS, ProviderError, checkProvider, generate, isConfigured, resolveProvider } from "../server/providers.js";
import { denial, entitlementFor } from "../server/entitlement.js";

const MAX_PROMPT = 6000;
const MAX_SYSTEM = 4000;
const DEFAULT_SYSTEM = "Be concise, practical, and natural.";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Client-Id, X-License-Key");
  res.setHeader("Cache-Control", "no-store");
}

function send(res, status, body) {
  cors(res);
  return res.status(status).json(body);
}

function queryParam(req, name) {
  const value = req.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

async function handleHealth(req, res) {
  const requested = String(queryParam(req, "provider") || "").toLowerCase();
  let verify = ["1", "true", "yes"].includes(String(queryParam(req, "verify") || "").toLowerCase());
  // A verified check sends a real request to each provider, which costs tokens
  // on your keys, so when gating is on only paid users may run it.
  const entitlement = await entitlementFor(req);
  if (verify && !entitlement.entitled) verify = false;
  if (requested && !PROVIDERS[requested]) {
    return send(res, 400, { ok: false, vercel: true, error: `Unknown provider "${requested}". Use one of: ${PROVIDER_IDS.join(", ")}.` });
  }

  const ids = requested ? [requested] : PROVIDER_IDS;
  const results = await Promise.all(ids.map(id => checkProvider(id, { verify })));
  const providers = Object.fromEntries(results.map(result => [result.provider, result]));
  const defaultProvider = resolveProvider("auto");
  const ok = requested ? results[0].ok : results.some(result => result.ok);

  return send(res, ok ? 200 : 503, {
    ok,
    vercel: true,
    verified: verify,
    gated: entitlement.gated,
    entitled: entitlement.entitled,
    defaultProvider,
    providers,
    error: ok ? null : (requested ? results[0].error : "No AI provider is connected. Add at least one API key on Vercel and redeploy.")
  });
}

async function handleChat(req, res) {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const system = typeof req.body?.system === "string" ? req.body.system.trim() : "";
  const requested = typeof req.body?.provider === "string" ? req.body.provider.trim().toLowerCase() : "auto";
  if (!prompt) return send(res, 400, { ok: false, error: "Prompt is required." });
  if (prompt.length > MAX_PROMPT) return send(res, 413, { ok: false, error: "Prompt is too long." });
  if (system.length > MAX_SYSTEM) return send(res, 413, { ok: false, error: "System prompt is too long." });

  const entitlement = await entitlementFor(req);
  if (!entitlement.entitled) {
    const { status, body } = denial(entitlement.reason);
    return send(res, status, body);
  }

  let provider = null;
  try {
    provider = resolveProvider(requested);
    if (!provider) {
      return send(res, 503, {
        ok: false,
        upstreamCode: "not_configured",
        error: "No AI provider is configured on Vercel.",
        hint: `Set one of ${PROVIDER_IDS.map(id => PROVIDERS[id].keyEnv).join(", ")} and redeploy.`
      });
    }
    if (!isConfigured(provider)) {
      return send(res, 503, {
        ok: false,
        provider,
        upstreamCode: "not_configured",
        error: `${PROVIDERS[provider].label} is not configured on Vercel.`,
        hint: `Set ${PROVIDERS[provider].keyEnv} and redeploy, or pick another provider.`
      });
    }

    const result = await generate(provider, { system: system || DEFAULT_SYSTEM, prompt });
    return send(res, 200, { ok: true, ...result });
  } catch (error) {
    const err = error instanceof ProviderError ? error : new ProviderError(provider || "unknown", { message: error?.message });
    console.error("[Smart Chat API] Chat request failed", {
      provider: err.provider,
      stage: err.stage,
      status: err.status,
      code: err.code,
      message: err.message
    });
    if (err.retryAfter) res.setHeader("Retry-After", err.retryAfter);
    // Pass 4xx through so the extension can explain it; upstream 5xx become 502.
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    return send(res, status, {
      ok: false,
      provider: err.provider,
      upstreamStatus: err.status,
      upstreamCode: err.code,
      error: err.message,
      hint: err.hint
    });
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return handleHealth(req, res);
  if (req.method === "POST") return handleChat(req, res);
  res.setHeader("Allow", "GET, POST, OPTIONS");
  return send(res, 405, { ok: false, error: "Method not allowed." });
}
