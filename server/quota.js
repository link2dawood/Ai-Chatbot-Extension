// Server-side free allowance.
//
// With paid-only access on, a visitor without a license gets a small number of
// chats on one cheap model. The count lives on the server, in a Redis store, so
// clearing the extension's data does not reset it.
//
// Who is counted: the extension makes a random id on first run and sends it as
// X-Client-Id. Anyone can make a new id by reinstalling, so a second counter
// limits each IP address per day, which caps what a script can get by resetting.
// This is a speed bump, not an identity check. Real accounts would be needed for
// a hard limit.
//
// Storage: Upstash Redis over its REST API (no dependency). In Vercel add
// Storage → Upstash Redis; it sets these variables:
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (or the KV_REST_API_URL / KV_REST_API_TOKEN names)
//
// Settings:
//   FREE_CHAT_LIMIT       free chats per device, for life (default 10)
//   FREE_IP_DAILY_LIMIT   free chats per IP address per day (default 40)
//   FREE_PROVIDER         provider that serves free chats (default: first configured of deepseek, openai, anthropic)
//   QUOTA_SALT            optional secret used to hash ids and IPs (defaults to the store token)

import { createHmac } from "node:crypto";

const TIMEOUT_MS = 6000;
const DAY_SECONDS = 2 * 24 * 60 * 60;
export const FREE_PROVIDER_ORDER = ["deepseek", "openai", "anthropic"];

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class QuotaError extends Error {
  constructor(message) { super(message); this.code = "quota_unavailable"; }
}

function store(env) {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "").trim().replace(/\/$/, "");
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

export const storeConfigured = (env = process.env) => Boolean(store(env));

const intSetting = (value, fallback) => { const n = Number.parseInt(value, 10); return Number.isFinite(n) && n >= 0 ? n : fallback; };
export const freeLimit = (env = process.env) => intSetting(env.FREE_CHAT_LIMIT, 10);
const ipDailyLimit = (env) => intSetting(env.FREE_IP_DAILY_LIMIT, 40);

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

// Ids and IPs are never stored raw. The hash is keyed with a secret (QUOTA_SALT, or the
// store's own token), because a hash with a public key can be brute-forced for IPv4 addresses.
const hash = (env, value) => createHmac("sha256", env.QUOTA_SALT || store(env)?.token || "smart-chat").update(String(value)).digest("hex").slice(0, 32);
const today = () => new Date().toISOString().slice(0, 10);

async function pipeline(env, commands) {
  const s = store(env);
  if (!s) throw new QuotaError("The free allowance is not configured.");
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
    throw new QuotaError("The free allowance is unavailable right now.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data) || data.some(item => item?.error)) {
    console.error("[Smart Chat API] Quota store error", { status: response.status, error: Array.isArray(data) ? data.find(i => i?.error)?.error : null });
    throw new QuotaError("The free allowance is unavailable right now.");
  }
  return data.map(item => item.result);
}

const deviceKey = (env, clientId) => `fq:${hash(env, clientId)}`;
const ipKey = (env, ip) => `fip:${hash(env, ip)}:${today()}`;

// How many free chats this device has used.
export async function usage(clientId, { env = process.env } = {}) {
  const [used] = await pipeline(env, [["GET", deviceKey(env, clientId)]]);
  const limit = freeLimit(env);
  const n = Math.max(0, Number(used) || 0);
  return { used: Math.min(n, limit), limit, remaining: Math.max(0, limit - n) };
}

// Takes one free chat before the model is called. { ok: true, used, limit, remaining }
// or { ok: false, reason: "limit" | "ip", used, limit, remaining }.
export async function reserve(clientId, ip, { env = process.env } = {}) {
  const limit = freeLimit(env);
  const dKey = deviceKey(env, clientId);
  const iKey = ipKey(env, ip);
  const [deviceCount, ipCount] = await pipeline(env, [["INCR", dKey], ["INCR", iKey], ["EXPIRE", iKey, DAY_SECONDS]]);
  const used = Number(deviceCount);

  const over = used > limit ? "limit" : Number(ipCount) > ipDailyLimit(env) ? "ip" : null;
  if (over) {
    await pipeline(env, [["DECR", dKey], ["DECR", iKey]]).catch(() => {});
    return { ok: false, reason: over, used: Math.min(used - 1, limit), limit, remaining: 0 };
  }
  return { ok: true, used, limit, remaining: limit - used };
}

// Gives the chat back when the model call failed, so a failure costs nothing.
export async function refund(clientId, ip, { env = process.env } = {}) {
  await pipeline(env, [["DECR", deviceKey(env, clientId)], ["DECR", ipKey(env, ip)]]).catch(() => {});
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

// Which provider serves free chats: FREE_PROVIDER if configured, else the cheapest one with a key.
export function pickFreeProvider(isConfigured, env = process.env) {
  const named = (env.FREE_PROVIDER || "").trim().toLowerCase();
  if (named && isConfigured(named)) return named;
  return FREE_PROVIDER_ORDER.find(isConfigured) || null;
}
