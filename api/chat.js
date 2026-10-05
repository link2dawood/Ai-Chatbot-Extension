// Vercel Serverless Function — /api/chat
//
// GET ?config=1        → everything the extension needs to build its screens: plans, limits, copy,
//                        mode prompts, feature switches, upgrade link (public data; see server/plans.js).
// GET ?quota=1         → this caller's usage (X-License-Key for paid, X-Client-Id for free).
// GET ?info=1          → the older, smaller settings object (kept for older extensions).
// GET                  → checks every provider (key accepted + model reachable). ?provider=<id> checks one,
//                        ?verify=1 also sends a tiny real request to each.
// POST { prompt, mode?, intent?, quality?, attachments?, system?, provider? } → one chat turn.
//
// The extension is a thin client: what to charge, how much each plan gets, which model answers and what
// the prompts say are all decided here, so they can change with a deploy and no new extension release.
// Keys live only in Vercel environment variables; see server/providers.js.
//
// Plans (when a Polar organization id is set; otherwise the API is open and nothing is counted):
//   free   no license. FREE_DAILY_LIMIT messages a day on the standard provider, counted on the server.
//   pro    valid Polar license. PRO_MONTHLY_LIMIT messages a month on the standard provider, of which
//          PRO_PREMIUM_MONTHLY_LIMIT can be premium requests (the Premium toggle, images and PDFs) on the
//          premium provider. Attachments are for pro only.
// Counting needs the Redis store (server/quota.js). See server/entitlement.js for licenses.

import { intentInstruction } from "../server/intents.js";
import { PROVIDERS, PROVIDER_IDS, ProviderError, canReadFiles, checkProvider, generate, isConfigured, isDisabled } from "../server/providers.js";
import { denial, entitlementFor, gatingEnabled, polarEnvironment, readLicenseKey, upgradeUrl } from "../server/entitlement.js";
import { AttachmentError, validateAttachments } from "../server/attachments.js";
import { needsVision } from "../src/lib/attachments.js";
import { MODE_PROMPTS } from "../src/lib/prompts.js";
import { QuotaError, ping, readClientId, readIp, refundChat, reserveChat, storeConfigured, usageFor } from "../server/quota.js";
import { limitFailure, pickPremiumProvider, pickStandardProvider, premiumAvailable, publicConfig } from "../server/plans.js";
import { compareVersions, limits, updatePolicy } from "../server/settings.js";

const MAX_PROMPT = 6000;
const MAX_SYSTEM = 4000;
const DEFAULT_SYSTEM = "Be concise, practical, and natural.";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Client-Id, X-License-Key, X-Extension-Version");
  res.setHeader("Cache-Control", "no-store");
}

function send(res, status, body) {
  cors(res);
  return res.status(status).json(body);
}

const fail = (res, status, code, error, extra = {}) => send(res, status, { ok: false, code, error, ...extra });

function queryParam(req, name) {
  const value = req.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

const header = (req, name) => {
  const value = req.headers?.[name];
  return (Array.isArray(value) ? value[0] : value)?.toString().trim() || "";
};

// ---------- public settings ----------

// What the extension builds its screens from. Public data only: no secrets, nothing per user.
const handleConfig = (res) => send(res, 200, publicConfig());

// The older, smaller object that earlier extension builds read.
function handleInfo(res) {
  const counted = gatingEnabled() && storeConfigured();
  return send(res, 200, {
    ok: true,
    gated: gatingEnabled(),
    environment: polarEnvironment(),
    upgradeUrl: upgradeUrl(),
    freeQuota: counted,
    freeLimit: counted ? limits().freeDaily : null
  });
}

// ---------- usage ----------

// Who is making this request, for counting: a paid license, or a free visitor's id.
async function whoIs(req) {
  const entitlement = await entitlementFor(req);
  if (entitlement.gated && !entitlement.entitled && entitlement.reason !== "missing") return { denied: denial(entitlement.reason) };
  if (entitlement.gated && entitlement.entitled) return { who: { plan: "pro", license: readLicenseKey(req) } };
  const clientId = readClientId(req);
  return clientId ? { who: { plan: "free", clientId, ip: readIp(req) } } : { who: null };
}

async function handleQuota(req, res) {
  if (!(gatingEnabled() && storeConfigured())) return send(res, 200, { ok: true, enabled: false });
  const { who, denied } = await whoIs(req);
  if (denied) return send(res, denied.status, denied.body);
  if (!who) return fail(res, 400, "client_id_required", "A client id is required.");
  try {
    return send(res, 200, { ok: true, enabled: true, ...(await usageFor(who)) });
  } catch (error) {
    if (error instanceof QuotaError) return fail(res, 503, error.code, error.message);
    throw error;
  }
}

// ---------- connection report ----------

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
  const ok = requested ? results[0].ok : results.some(result => result.ok);

  // The counter store and the routing, so they can be checked before paid-only access is switched on.
  const configured = storeConfigured();
  const usageCounting = {
    configured,
    reachable: configured ? await ping() : null,
    activeNow: gatingEnabled() && configured,
    limits: limits(),
    standardProvider: pickStandardProvider(),
    premiumProvider: premiumAvailable() ? pickPremiumProvider() : null
  };

  return send(res, ok ? 200 : 503, {
    ok,
    vercel: true,
    verified: verify,
    gated: entitlement.gated,
    entitled: entitlement.entitled,
    environment: polarEnvironment(),
    upgradeUrl: upgradeUrl(),
    defaultProvider: pickStandardProvider(),
    usageCounting,
    providers,
    error: ok ? null : (requested ? results[0].error : "No AI provider is connected. Add at least one API key on Vercel and redeploy.")
  });
}

// ---------- chat ----------

function notConfigured(res, provider) {
  return send(res, 503, {
    ok: false,
    provider,
    upstreamCode: "not_configured",
    error: isDisabled(provider) ? `${PROVIDERS[provider].label} is disabled on this server.` : `${PROVIDERS[provider].label} is not configured on Vercel.`,
    hint: isDisabled(provider) ? `Remove "${provider}" from DISABLED_PROVIDERS to enable it.` : `Set ${PROVIDERS[provider].keyEnv} and redeploy.`
  });
}

// With nothing gated, AI_PROVIDER (if set and usable) picks the provider for ordinary messages.
function openModeProvider(wantsPremium) {
  if (wantsPremium) return pickPremiumProvider();
  const preferred = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  return preferred && isConfigured(preferred) ? preferred : pickStandardProvider();
}

async function handleChat(req, res) {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const clientSystem = typeof req.body?.system === "string" ? req.body.system.trim() : "";
  const requested = typeof req.body?.provider === "string" ? req.body.provider.trim().toLowerCase() : "auto";
  const mode = typeof req.body?.mode === "string" ? req.body.mode.trim().toLowerCase() : "";
  const premiumChoice = req.body?.quality === "premium";
  if (!prompt) return fail(res, 400, "prompt_required", "Prompt is required.");
  if (prompt.length > MAX_PROMPT) return fail(res, 413, "prompt_too_long", "Prompt is too long.");
  if (clientSystem.length > MAX_SYSTEM) return fail(res, 413, "system_too_long", "System prompt is too long.");

  // Older extensions can be asked to update, if (and only if) MIN_EXTENSION_VERSION is set.
  const update = updatePolicy();
  if (update.minVersion) {
    const version = header(req, "x-extension-version");
    if (!version || compareVersions(version, update.minVersion) < 0) {
      return fail(res, 426, "update_required", update.message, { minVersion: update.minVersion });
    }
  }

  let attachments;
  try {
    attachments = validateAttachments(req.body?.attachments);
  } catch (error) {
    if (error instanceof AttachmentError) return fail(res, error.status, error.code, error.message);
    throw error;
  }

  const entitlement = await entitlementFor(req);
  // A license that was sent but is not good is its own error, not a free visitor.
  if (entitlement.gated && !entitlement.entitled && entitlement.reason !== "missing") {
    const { status, body } = denial(entitlement.reason);
    return send(res, status, body);
  }
  const gated = entitlement.gated;
  const paid = gated && entitlement.entitled;
  // Premium requests: the Premium toggle, and anything a text-only model cannot read (images, PDFs).
  const wantsPremium = premiumChoice || needsVision(attachments);

  if (attachments.length && !paid) {
    return fail(res, 402, "attachments_paid", "Attaching files is a Premium feature. Upgrade to add images, PDFs and text files to your chat.", { upgradeUrl: upgradeUrl() });
  }
  if (wantsPremium && gated && !paid) {
    return fail(res, 402, "premium_required", "Premium requests are for Premium users. Upgrade to use them.", { upgradeUrl: upgradeUrl() });
  }

  // The server decides the prompt when it knows the mode; a client-supplied one is only a fallback.
  const intent = mode === "rewrite" ? intentInstruction(req.body?.intent) : "";
  const system = [MODE_PROMPTS[mode] || clientSystem || DEFAULT_SYSTEM, intent].filter(Boolean).join("\n\n");

  // Who is counted, and which provider answers.
  let who = null;
  if (gated) {
    if (!storeConfigured()) {
      if (paid) return fail(res, 503, "quota_unavailable", "Usage counting is not configured on the server.");
      const { status, body } = denial("missing");
      return send(res, status, body);
    }
    const found = await whoIs(req);
    who = found.who;
    if (!who) {
      const { status, body } = denial("missing");
      return send(res, status, body);
    }
  }

  let provider;
  if (!gated) {
    // Open mode (no Polar configured): nothing is counted, and a provider may be named for testing.
    provider = requested !== "auto" ? requested : openModeProvider(wantsPremium);
    if (provider && !PROVIDERS[provider]) return fail(res, 400, "unknown_provider", `Unknown provider "${requested}". Use one of: ${PROVIDER_IDS.join(", ")}.`);
  } else {
    if (wantsPremium && !premiumAvailable()) return fail(res, 503, "premium_unavailable", "Premium requests are not available right now. Standard messages still work.");
    provider = wantsPremium ? pickPremiumProvider() : pickStandardProvider();
  }
  if (!provider) return fail(res, 503, "not_configured", "No AI provider is configured on Vercel.", { upstreamCode: "not_configured", hint: "Set DEEPSEEK_API_KEY (and ANTHROPIC_API_KEY for premium) and redeploy." });
  if (!isConfigured(provider)) return notConfigured(res, provider);
  if (needsVision(attachments) && !canReadFiles(provider)) {
    return fail(res, 400, "attachments_unsupported", `${PROVIDERS[provider].label} cannot read images or PDFs.`, { provider, hint: "Premium requests need a provider that can read them (Anthropic or OpenAI)." });
  }

  // Reserve the message before spending anything; it is given back if the model call fails.
  let reservation = null;
  try {
    if (who) {
      try {
        reservation = await reserveChat(who, { premium: wantsPremium && who.plan === "pro" });
      } catch (error) {
        if (error instanceof QuotaError) return fail(res, 503, error.code, error.message);
        throw error;
      }
      if (!reservation.ok) {
        const failure = limitFailure(reservation.reason, reservation.quota);
        return send(res, 402, { ok: false, ...failure, quota: reservation.quota, upgradeUrl: who.plan === "free" ? upgradeUrl() : null });
      }
    }

    const result = await generate(provider, { system, prompt, attachments });
    return send(res, 200, { ok: true, ...result, ...(reservation ? { quota: reservation.quota } : {}) });
  } catch (error) {
    if (reservation?.ok) await refundChat(who, { premium: wantsPremium && who.plan === "pro" });
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
    if (queryParam(req, "config")) return handleConfig(res);
    if (queryParam(req, "info")) return handleInfo(res);
    if (queryParam(req, "quota")) return handleQuota(req, res);
    return handleHealth(req, res);
  }
  if (req.method === "POST") return handleChat(req, res);
  res.setHeader("Allow", "GET, POST, OPTIONS");
  return send(res, 405, { ok: false, error: "Method not allowed." });
}
