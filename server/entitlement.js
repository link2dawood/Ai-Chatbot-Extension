// Paid-user entitlement via Polar license keys (https://polar.sh).
//
// A customer buys on Polar and receives a license key (a "License Keys"
// benefit on your product). The extension sends it in the X-License-Key
// header; the server asks Polar whether it is currently valid. Polar's
// validate endpoint is public, so no access token is needed:
//   POST {api}/v1/customer-portal/license-keys/validate  { key, organization_id }
//
// Gating is switched on by setting the organization id for the active Polar
// environment. Without it the API stays open, so a deployment without Polar is
// not locked out.
//
//   POLAR_ENV                       "sandbox" or "production" (default). The one switch
//                                   that decides which Polar the server talks to.
//   POLAR_ORGANIZATION_ID           production organization id (Polar → Settings)
//   POLAR_CHECKOUT_URL              production checkout link used by the Upgrade button
//   POLAR_SANDBOX_ORGANIZATION_ID   sandbox organization id (a separate id from production)
//   POLAR_SANDBOX_CHECKOUT_URL      sandbox checkout link
//
// Keep both sets in Vercel and flip POLAR_ENV to switch. In sandbox mode the
// sandbox values are used, falling back to the production names when a sandbox
// one is not set. POLAR_SERVER is the old name for POLAR_ENV and still works.

import { createHash } from "node:crypto";

const VALID_CACHE_MS = 5 * 60 * 1000;
const CHECK_TIMEOUT_MS = 8000;
const cache = new Map(); // sha256(key) → { until, result }

// "sandbox" or "production". Anything other than sandbox/test means production,
// so a typo can never silently send real customers to the sandbox.
export function polarEnvironment(env = process.env) {
  const value = (env.POLAR_ENV || env.POLAR_SERVER || "").trim().toLowerCase();
  return value === "sandbox" || value === "test" ? "sandbox" : "production";
}

function setting(env, sandboxName, productionName) {
  const live = env[productionName]?.trim() || null;
  if (polarEnvironment(env) !== "sandbox") return live;
  return env[sandboxName]?.trim() || live;
}

export function organizationId(env = process.env) {
  return setting(env, "POLAR_SANDBOX_ORGANIZATION_ID", "POLAR_ORGANIZATION_ID");
}

export function gatingEnabled(env = process.env) {
  return Boolean(organizationId(env));
}

// Only https links are handed to the extension.
export function upgradeUrl(env = process.env) {
  const url = setting(env, "POLAR_SANDBOX_CHECKOUT_URL", "POLAR_CHECKOUT_URL");
  try { return url && new URL(url).protocol === "https:" ? url : null; } catch { return null; }
}

function apiBase(env) {
  return polarEnvironment(env) === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
}

export function readLicenseKey(req) {
  const header = req.headers?.["x-license-key"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

export function clearLicenseCache() {
  cache.clear();
}

// Result: { valid, reason, status?, expiresAt? }
//   reason: "ok" | "missing" | "invalid" | "revoked" | "expired" | "unavailable"
export async function validateLicense(key, { env = process.env } = {}) {
  if (!key) return { valid: false, reason: "missing" };
  const orgId = organizationId(env);
  if (!orgId) return { valid: false, reason: "unavailable" };

  const id = createHash("sha256").update(`${polarEnvironment(env)}:${orgId}:${key}`).digest("hex");
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return hit.result;

  let response;
  try {
    response = await fetch(`${apiBase(env)}/v1/customer-portal/license-keys/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, organization_id: orgId }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
    });
  } catch (error) {
    console.error("[Smart Chat API] Polar validation unreachable", { name: error?.name, message: error?.message });
    return { valid: false, reason: "unavailable" };
  }

  // Polar answers 404 for a key it does not know and 422 for a malformed one.
  if (response.status === 404 || response.status === 422) return { valid: false, reason: "invalid" };
  if (!response.ok) {
    console.error("[Smart Chat API] Polar validation failed", { status: response.status });
    return { valid: false, reason: "unavailable" };
  }

  const data = await response.json().catch(() => ({}));
  const status = typeof data.status === "string" ? data.status : null;
  const expiresAt = data.expires_at || null;
  let result;
  if (status !== "granted") result = { valid: false, reason: status === "revoked" ? "revoked" : "invalid", status };
  else if (expiresAt && Date.parse(expiresAt) <= Date.now()) result = { valid: false, reason: "expired", status, expiresAt };
  else result = { valid: true, reason: "ok", status, expiresAt };

  // Cache only successes: a freshly bought key must work immediately, and a
  // revoked key stops working within VALID_CACHE_MS.
  if (result.valid) cache.set(id, { until: Date.now() + VALID_CACHE_MS, result });
  return result;
}

// Express-style entitlement for a request.
//   { gated: false }                          → open API, nothing to check
//   { gated: true, entitled, reason, ... }    → paid gate result
export async function entitlementFor(req, { env = process.env } = {}) {
  if (!gatingEnabled(env)) return { gated: false, entitled: true, reason: "open" };
  const license = await validateLicense(readLicenseKey(req), { env });
  return { gated: true, entitled: license.valid, reason: license.reason, expiresAt: license.expiresAt || null };
}

const MESSAGES = {
  missing: "This AI service is for paid users. Upgrade to continue, or add your own API key in Settings.",
  invalid: "That license key was not recognised. Check it and try again.",
  revoked: "That license has been cancelled. Renew your subscription to continue.",
  expired: "That license has expired. Renew your subscription to continue.",
  unavailable: "Could not verify your license right now. Please try again in a moment."
};

export function denial(reason, env = process.env) {
  return {
    status: reason === "unavailable" ? 503 : reason === "missing" ? 402 : 401,
    body: {
      ok: false,
      code: reason === "missing" ? "paid_required" : `license_${reason}`,
      error: MESSAGES[reason] || MESSAGES.invalid,
      upgradeUrl: upgradeUrl(env)
    }
  };
}
