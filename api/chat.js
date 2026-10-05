// Vercel Serverless Function — /api/chat
//
// GET ?info=1                  → public settings only: { gated, environment, upgradeUrl } (no provider calls).
// GET                          → checks every provider (key accepted + model reachable).
// GET ?provider=<id>           → checks one provider.
// GET ...&verify=1             → also sends a tiny real request to each checked provider.
// POST { prompt, system, provider? } → one chat turn on the chosen provider
//                                (provider omitted or "auto" → AI_PROVIDER, else the first configured).
//
// Keys live only in Vercel environment variables; see server/providers.js.
//
// When a Polar organization id is set (POLAR_ORGANIZATION_ID, or the sandbox one
// when POLAR_ENV=sandbox), the server-side providers are for paid
// users only: POST needs a valid Polar license key in the X-License-Key
// header, and GET ?verify=1 (which spends tokens) needs one too. See
// server/entitlement.js.
//
// Visitors without a license get a small free allowance, counted on the server
// (server/quota.js) and served by one cheap provider, when the counter store is
// configured. Attachments (images, PDFs, text files) are for paid users only.

import { PROVIDERS, PROVIDER_IDS, ProviderError, canReadFiles, checkProvider, generate, isConfigured, resolveProvider } from "../server/providers.js";
import { denial, entitlementFor, gatingEnabled, polarEnvironment, upgradeUrl } from "../server/entitlement.js";
import { AttachmentError, validateAttachments } from "../server/attachments.js";
import { needsVision } from "../src/lib/attachments.js";
import { QuotaError, freeLimit, pickFreeProvider, readClientId, readIp, refund, reserve, storeConfigured, usage } from "../server/quota.js";

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

// Cheap, public settings for the extension (no provider calls, no secrets):
// where the Upgrade button goes and whether Polar is in test mode.
function handleInfo(res) {
  const freeQuota = gatingEnabled() && storeConfigured();
  return send(res, 200, {
    ok: true,
    gated: gatingEnabled(),
    environment: polarEnvironment(),
    upgradeUrl: upgradeUrl(),
    freeQuota,
    freeLimit: freeQuota ? freeLimit() : null
  });
}

// How much of the free allowance this device has used (needs the X-Client-Id header).
async function handleQuota(req, res) {
  if (!(gatingEnabled() && storeConfigured())) return send(res, 200, { ok: true, enabled: false });
  const clientId = readClientId(req);
  if (!clientId) return send(res, 400, { ok: false, code: "client_id_required", error: "A client id is required." });
  try {
    return send(res, 200, { ok: true, enabled: true, ...(await usage(clientId)) });
  } catch (error) {
    if (error instanceof QuotaError) return send(res, 503, { ok: false, code: error.code, error: error.message });
    throw error;
  }
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
    environment: polarEnvironment(),
    upgradeUrl: upgradeUrl(),
    defaultProvider,
    providers,
    error: ok ? null : (requested ? results[0].error : "No AI provider is connected. Add at least one API key on Vercel and redeploy.")
  });
}

const quotaBody = (r) => ({ used: r.used, limit: r.limit, remaining: r.remaining });

async function handleChat(req, res) {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const system = typeof req.body?.system === "string" ? req.body.system.trim() : "";
  const requested = typeof req.body?.provider === "string" ? req.body.provider.trim().toLowerCase() : "auto";
  if (!prompt) return send(res, 400, { ok: false, error: "Prompt is required." });
  if (prompt.length > MAX_PROMPT) return send(res, 413, { ok: false, error: "Prompt is too long." });
  if (system.length > MAX_SYSTEM) return send(res, 413, { ok: false, error: "System prompt is too long." });

  let attachments;
  try {
    attachments = validateAttachments(req.body?.attachments);
  } catch (error) {
    if (error instanceof AttachmentError) return send(res, error.status, { ok: false, code: error.code, error: error.message });
    throw error;
  }

  const entitlement = await entitlementFor(req);
  // A license that was sent but is not good is its own error, not a free visitor.
  if (entitlement.gated && !entitlement.entitled && entitlement.reason !== "missing") {
    const { status, body } = denial(entitlement.reason);
    return send(res, status, body);
  }
  const paid = entitlement.gated && entitlement.entitled;

  if (attachments.length && !paid) {
    return send(res, 402, {
      ok: false,
      code: "attachments_paid",
      error: "Attaching files is a Premium feature. Upgrade to add images, PDFs and text files to your chat.",
      upgradeUrl: upgradeUrl()
    });
  }

  // A visitor without a license: the free allowance, counted on the server.
  let free = null;
  if (entitlement.gated && !entitlement.entitled) {
    const clientId = readClientId(req);
    if (!storeConfigured() || !clientId) {
      const { status, body } = denial("missing");
      return send(res, status, body);
    }
    free = { clientId, ip: readIp(req) };
  }

  let provider = null;
  let reservation = null;
  try {
    if (free) {
      // Free chats always use the one cheap provider, whatever the extension asked for.
      provider = pickFreeProvider(id => isConfigured(id));
      if (!provider) return send(res, 503, { ok: false, upstreamCode: "not_configured", error: "The free allowance has no AI provider configured.", hint: "Set FREE_PROVIDER or a provider key on Vercel." });
      try {
        reservation = await reserve(free.clientId, free.ip);
      } catch (error) {
        if (error instanceof QuotaError) return send(res, 503, { ok: false, code: error.code, error: error.message });
        throw error;
      }
      if (!reservation.ok) {
        return send(res, 402, {
          ok: false,
          code: reservation.reason === "ip" ? "free_limit_ip" : "free_limit_reached",
          error: reservation.reason === "ip"
            ? "Too many free chats have been used from this network today. Try again tomorrow, or upgrade."
            : `You have used your ${reservation.limit} free chats.`,
          quota: quotaBody(reservation),
          upgradeUrl: upgradeUrl()
        });
      }
    } else {
      const files = needsVision(attachments);
      provider = resolveProvider(requested, process.env, { needsFiles: files });
      if (!provider) {
        return send(res, 503, {
          ok: false,
          upstreamCode: "not_configured",
          error: files ? "No provider that can read images or PDFs is configured." : "No AI provider is configured on Vercel.",
          hint: files ? "Set OPENAI_API_KEY or ANTHROPIC_API_KEY on Vercel and redeploy." : `Set one of ${PROVIDER_IDS.map(id => PROVIDERS[id].keyEnv).join(", ")} and redeploy.`
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
      if (files && !canReadFiles(provider)) {
        return send(res, 400, {
          ok: false,
          provider,
          code: "attachments_unsupported",
          error: `${PROVIDERS[provider].label} cannot read images or PDFs.`,
          hint: "Choose OpenAI or Anthropic (or Auto) to attach images and PDFs. Text files work with every provider."
        });
      }
    }

    const result = await generate(provider, { system: system || DEFAULT_SYSTEM, prompt, attachments });
    return send(res, 200, { ok: true, ...result, ...(reservation ? { quota: quotaBody(reservation) } : {}) });
  } catch (error) {
    // The model call failed, so the free chat is given back.
    if (reservation?.ok) await refund(free.clientId, free.ip);
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
  if (req.method === "GET") {
    if (queryParam(req, "info")) return handleInfo(res);
    if (queryParam(req, "quota")) return handleQuota(req, res);
    return handleHealth(req, res);
  }
  if (req.method === "POST") return handleChat(req, res);
  res.setHeader("Allow", "GET, POST, OPTIONS");
  return send(res, 405, { ok: false, error: "Method not allowed." });
}
