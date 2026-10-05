// The extension is a thin client. Plans, limits, prices, copy, the mode prompts, feature
// switches and the upgrade link all come from the server (GET /api/chat?config=1), so they can
// change with a server deploy and no new Web Store release. The extension ships with the
// DEFAULT_CONFIG below for the first run and for when the server can't be reached.
//
// What comes back is DATA only. Nothing here is ever run or evaluated: every value is checked
// and cut down to a known shape before use, text is only ever shown as text, and links must be https.

import { MODE_PROMPTS } from "./prompts.js";

// The newest server API this extension understands. A server that reports a higher apiVersion
// has changed in a way this version can't follow, so the extension asks for an update.
export const SUPPORTED_API_VERSION = 1;

export const DEFAULT_CONFIG = Object.freeze({
  apiVersion: SUPPORTED_API_VERSION,
  gated: false,
  environment: "production",
  upgradeUrl: null,
  usageCounted: false,
  plans: {
    free: { name: "Free", period: "day", limit: 10, premiumLimit: 0, perks: ["10 messages per day"] },
    pro: { name: "Premium Access", price: "", period: "month", limit: 500, premiumLimit: 0, perks: [] }
  },
  features: { attachments: true, ownKey: true, premium: false },
  intents: [
    ["agree", "Agree"], ["disagree", "Disagree"], ["clarify", "Ask for clarification"], ["negotiate", "Negotiate"],
    ["follow_up", "Follow up"], ["decline", "Decline"], ["apologize", "Apologize"], ["persuade", "Persuade"],
    ["escalate", "Escalate"], ["thank", "Thank"], ["request", "Request"], ["remind", "Remind"]
  ].map(([id, label]) => ({ id, label })),
  modes: {},
  minExtensionVersion: null,
  updateMessage: "Please update Smart Chat Assistant to keep using it.",
  incompatible: false
});

const MODE_IDS = Object.keys(MODE_PROMPTS);

const str = (value, fallback, max) => {
  const text = typeof value === "string" ? value.trim().slice(0, max) : "";
  return text || fallback;
};
const int = (value, fallback, max = 1_000_000) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : fallback;
};
const flag = (value, fallback) => (typeof value === "boolean" ? value : fallback);
const httpsUrl = (value) => {
  try { return typeof value === "string" && new URL(value).protocol === "https:" ? value : null; } catch { return null; }
};
const perks = (value, fallback) => {
  if (!Array.isArray(value)) return fallback;
  return value.filter(item => typeof item === "string" && item.trim()).slice(0, 6).map(item => item.trim().slice(0, 100));
};

function plan(raw, base) {
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    name: str(p.name, base.name, 40),
    price: str(p.price, base.price || "", 40),
    period: p.period === "day" || p.period === "month" ? p.period : base.period,
    limit: int(p.limit, base.limit),
    premiumLimit: int(p.premiumLimit, base.premiumLimit),
    perks: perks(p.perks, base.perks)
  };
}

// Turns whatever the server sent into a complete, safe config. Unknown fields are dropped.
export function normalizeConfig(raw) {
  const base = DEFAULT_CONFIG;
  if (!raw || typeof raw !== "object") return structuredClone(base);

  const apiVersion = Number(raw.apiVersion);
  if (Number.isFinite(apiVersion) && apiVersion > SUPPORTED_API_VERSION) {
    return { ...structuredClone(base), incompatible: true, updateMessage: str(raw.updateMessage, base.updateMessage, 200) };
  }

  const modes = {};
  for (const id of MODE_IDS) {
    const system = raw.modes?.[id]?.system;
    if (typeof system === "string" && system.trim()) modes[id] = { system: system.trim().slice(0, 4000) };
  }

  const seen = new Set();
  const intents = Array.isArray(raw.intents)
    ? raw.intents.flatMap(item => {
        const id = typeof item?.id === "string" && /^[a-z_]{1,30}$/.test(item.id) ? item.id : "";
        const label = str(item?.label, "", 30);
        if (!id || !label || seen.has(id)) return [];
        seen.add(id);
        return [{ id, label }];
      }).slice(0, 16)
    : structuredClone(base.intents);

  const features = raw.features && typeof raw.features === "object" ? raw.features : {};
  const min = typeof raw.minExtensionVersion === "string" && /^\d+(\.\d+){0,2}$/.test(raw.minExtensionVersion.trim()) ? raw.minExtensionVersion.trim() : null;
  return {
    apiVersion: Number.isFinite(apiVersion) ? apiVersion : base.apiVersion,
    gated: flag(raw.gated, base.gated),
    environment: raw.environment === "sandbox" ? "sandbox" : "production",
    upgradeUrl: httpsUrl(raw.upgradeUrl),
    usageCounted: flag(raw.usageCounted, base.usageCounted),
    plans: { free: plan(raw.plans?.free, base.plans.free), pro: plan(raw.plans?.pro, base.plans.pro) },
    features: {
      attachments: flag(features.attachments, base.features.attachments),
      ownKey: flag(features.ownKey, base.features.ownKey),
      premium: flag(features.premium, base.features.premium)
    },
    intents,
    modes,
    minExtensionVersion: min,
    updateMessage: str(raw.updateMessage, base.updateMessage, 200),
    incompatible: false
  };
}

// 2.10.0 is newer than 2.9.1. Missing parts count as 0.
export function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map(n => Number.parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

// Should this version of the extension ask the user to update?
export const needsUpdate = (config, version) =>
  Boolean(config.incompatible || (config.minExtensionVersion && version && compareVersions(version, config.minExtensionVersion) < 0));

// The prompt for a mode: the server's, if it sent one, otherwise the one shipped with the extension.
export const systemPromptFor = (config, mode) => config.modes?.[mode]?.system || MODE_PROMPTS[mode] || MODE_PROMPTS.chat;

// The text on Upgrade buttons, from the plan's price when there is one.
export const upgradeLabel = (config) => (config.plans.pro.price ? `Upgrade · ${config.plans.pro.price}` : "Upgrade to Premium");
