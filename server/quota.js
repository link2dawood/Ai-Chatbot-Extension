// Usage counting, on the server.
//
// Two plans are counted, both in a Redis store so clearing the extension (or sharing
// it) does not reset anything:
//   free  per device per UTC day   (FREE_DAILY_LIMIT), plus a per-IP daily cap (FREE_IP_DAILY_LIMIT)
//   pro   per license per UTC month (PRO_MONTHLY_LIMIT), plus a premium-request count (PRO_PREMIUM_MONTHLY_LIMIT)
// Limits and names live in server/settings.js.
//
// Who is counted: free visitors by a random id the extension makes on first run
// (X-Client-Id). Anyone can make a new id by reinstalling, so each IP address also has
// a daily cap, which limits what a script can get by resetting. That is a speed bump,
// not an identity check. Paid users are counted by their license key, so sharing a key
// shares one allowance.
//
// A message is reserved before the model is called and given back if the call fails.
// Ids, IPs and keys are stored only as keyed hashes, never raw.
//
// Storage: Upstash Redis over its REST API (no dependency). In Vercel add
// Storage → Upstash Redis; it sets these variables:
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (or the KV_REST_API_URL / KV_REST_API_TOKEN names,
//   with or without a prefix such as chat_assistant_db_)
//   QUOTA_SALT            optional secret used to hash ids, IPs and keys (defaults to the store token)

import { createHmac } from "node:crypto";
import { limits, periodKey, resetsAt } from "./settings.js";

const TIMEOUT_MS = 6000;
const DAY_SECONDS = 2 * 24 * 60 * 60;
const MONTH_SECONDS = 40 * 24 * 60 * 60;

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class QuotaError extends Error {
  constructor(message) { super(message); this.code = "quota_unavailable"; }
}

// Finds the Redis REST URL and token. Plain names win; otherwise a prefixed pair is used,
// because Vercel's Upstash integration can add a prefix (for example a database called
// chat-assistant-db gives chat_assistant_db_KV_REST_API_URL). The read-only token is never used.
function store(env) {
  const clean = (value) => (typeof value === "string" ? value.trim() : "");
  for (const [urlName, tokenName] of [["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"], ["KV_REST_API_URL", "KV_REST_API_TOKEN"]]) {
    if (clean(env[urlName]) && clean(env[tokenName])) return { url: clean(env[urlName]).replace(/\/$/, ""), token: clean(env[tokenName]) };
  }
  for (const key of Object.keys(env).sort()) {
    const match = key.match(/^(.+_)(KV_REST_API_URL|UPSTASH_REDIS_REST_URL)$/);
    if (!match) continue;
    const tokenName = match[1] + (match[2] === "KV_REST_API_URL" ? "KV_REST_API_TOKEN" : "UPSTASH_REDIS_REST_TOKEN");
    if (clean(env[key]) && clean(env[tokenName])) return { url: clean(env[key]).replace(/\/$/, ""), token: clean(env[tokenName]) };
  }
  return null;
}

export const storeConfigured = (env = process.env) => Boolean(store(env));

export function readClientId(req) {
  const header = req.headers?.["x-client-id"];
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  return value && CLIENT_ID.test(value) ? value.toLowerCase() : null;
}

export function readIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return req.headers?.["x-real-ip"] || first || req.socket?.remoteAddress || "unknown";
}

// The hash is keyed with a secret (QUOTA_SALT, or the store's own token), because a hash with
// a public key can be brute-forced for IPv4 addresses.
const hash = (env, value) => createHmac("sha256", env.QUOTA_SALT || store(env)?.token || "smart-chat").update(String(value)).digest("hex").slice(0, 32);

async function pipeline(env, commands) {
  const s = store(env);
  if (!s) throw new QuotaError("Usage counting is not configured.");
  let response;
  try {
    response = await fetch(`${s.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    console.error("[Smart Chat API] Quota store unreachable", { name: error?.name, message: error?.message });
    throw new QuotaError("Usage counting is unavailable right now. Please try again in a moment.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data) || data.some(item => item?.error)) {
    console.error("[Smart Chat API] Quota store error", { status: response.status, error: Array.isArray(data) ? data.find(i => i?.error)?.error : null });
    throw new QuotaError("Usage counting is unavailable right now. Please try again in a moment.");
  }
  return data.map(item => item.result);
}

// ---- who is counted, and which counters apply ----
//   who = { plan: "free", clientId, ip }  or  { plan: "pro", license }

function counters(who, { premium = false, env, now }) {
  const l = limits(env);
  if (who.plan === "pro") {
    const month = periodKey("pro", now);
    const id = hash(env, `license:${who.license}`);
    return [
      { name: "monthly", key: `pm:${id}:${month}`, limit: l.proMonthly, ttl: MONTH_SECONDS },
      ...(premium ? [{ name: "premium", key: `pp:${id}:${month}`, limit: l.proPremiumMonthly, ttl: MONTH_SECONDS }] : [])
    ];
  }
  const day = periodKey("free", now);
  return [
    { name: "daily", key: `fd:${hash(env, who.clientId)}:${day}`, limit: l.freeDaily, ttl: DAY_SECONDS },
    { name: "ip", key: `fip:${hash(env, who.ip)}:${day}`, limit: l.freeIpDaily, ttl: DAY_SECONDS }
  ];
}

const clamp = (n, limit) => Math.max(0, Math.min(Number(n) || 0, limit));
const dimension = (used, limit) => ({ used: clamp(used, limit), limit, remaining: Math.max(0, limit - clamp(used, limit)) });

// What the extension shows. `counts` maps counter name → number used.
function quotaFor(who, counts, { env, now }) {
  const l = limits(env);
  if (who.plan === "pro") {
    return { plan: "pro", period: "month", resetsAt: resetsAt("pro", now), ...dimension(counts.monthly, l.proMonthly), premium: dimension(counts.premium, l.proPremiumMonthly) };
  }
  return { plan: "free", period: "day", resetsAt: resetsAt("free", now), ...dimension(counts.daily, l.freeDaily) };
}

// Reads the current counts without using anything.
export async function usageFor(who, { env = process.env, now = new Date() } = {}) {
  const entries = counters(who, { premium: true, env, now }).filter(e => e.name !== "ip");
  const values = await pipeline(env, entries.map(e => ["GET", e.key]));
  const counts = Object.fromEntries(entries.map((e, i) => [e.name, Number(values[i]) || 0]));
  return quotaFor(who, counts, { env, now });
}

// Takes one message before the model is called.
//   { ok: true, quota }                                  it is reserved
//   { ok: false, reason: "daily"|"ip"|"monthly"|"premium", quota }   a limit was reached; nothing is used
export async function reserveChat(who, { premium = false, env = process.env, now = new Date() } = {}) {
  const entries = counters(who, { premium, env, now });
  const commands = entries.flatMap(e => [["INCR", e.key], ["EXPIRE", e.key, e.ttl]]);
  const results = await pipeline(env, commands);
  const used = Object.fromEntries(entries.map((e, i) => [e.name, Number(results[i * 2])]));

  const over = entries.find(e => used[e.name] > e.limit);
  if (over) {
    await pipeline(env, entries.map(e => ["DECR", e.key])).catch(() => {});
    const before = Object.fromEntries(entries.map(e => [e.name, used[e.name] - 1]));
    return { ok: false, reason: over.name, quota: quotaFor(who, before, { env, now }) };
  }
  return { ok: true, quota: quotaFor(who, used, { env, now }) };
}

// Gives the message back when the model call failed, so a failure costs nothing.
export async function refundChat(who, { premium = false, env = process.env, now = new Date() } = {}) {
  const entries = counters(who, { premium, env, now });
  await pipeline(env, entries.map(e => ["DECR", e.key])).catch(() => {});
}

// Is the store reachable and answering? Used by the connection report.
export async function ping({ env = process.env } = {}) {
  try {
    const [reply] = await pipeline(env, [["PING"]]);
    return reply === "PONG";
  } catch {
    return false;
  }
}
