// What the product is, as data. The extension reads this from GET /api/chat?config=1
// and builds its screens from it, so plans, limits, copy, prompts and feature switches
// can change on the server without a new extension release. It is data only: the
// extension never runs anything it receives.
//
// Routing
//   STANDARD_PROVIDER   serves every ordinary message, free and paid  (default: deepseek, else openai, else anthropic)
//   PREMIUM_PROVIDER    serves "premium" requests (the Premium toggle, images and PDFs) (default: anthropic, else openai)
//   DISABLED_PROVIDERS  providers switched off, comma separated      (default: v0)
//   OPENAI_API_KEY      kept for utility jobs (routing, titles); it does not serve chats unless it is the only provider
// FREE_PROVIDER is the old name for STANDARD_PROVIDER and still works.

import { MODE_IDS, MODE_PROMPTS } from "../src/lib/prompts.js";
import { INTENTS, REPLY_INTENTS } from "./intents.js";
import { featureOn, limits, planNames, updatePolicy } from "./settings.js";
import { isConfigured } from "./providers.js";
import { gatingEnabled, polarEnvironment, upgradeUrl } from "./entitlement.js";
import { storeConfigured } from "./quota.js";

// Bump only for a change an older extension cannot understand. Additions do not need it.
export const API_VERSION = 1;

const STANDARD_ORDER = ["deepseek", "openai", "anthropic"];
const PREMIUM_ORDER = ["anthropic", "openai"];

const pick = (named, order, env) => {
  const wanted = String(named || "").trim().toLowerCase();
  if (wanted && isConfigured(wanted, env)) return wanted;
  return order.find(id => isConfigured(id, env)) || null;
};

export const pickStandardProvider = (env = process.env) => pick(env.STANDARD_PROVIDER || env.FREE_PROVIDER, STANDARD_ORDER, env);
export const pickPremiumProvider = (env = process.env) => pick(env.PREMIUM_PROVIDER, PREMIUM_ORDER, env);

// Premium exists only when it has a quota and a provider that differs from the standard one.
export function premiumAvailable(env = process.env) {
  const premium = pickPremiumProvider(env);
  return limits(env).proPremiumMonthly > 0 && Boolean(premium) && premium !== pickStandardProvider(env);
}

export function publicConfig(env = process.env) {
  const l = limits(env);
  const names = planNames(env);
  const update = updatePolicy(env);
  const premium = premiumAvailable(env);
  const attachments = featureOn("ATTACHMENTS", env);
  const gated = gatingEnabled(env);

  return {
    ok: true,
    apiVersion: API_VERSION,
    gated,
    environment: polarEnvironment(env),
    upgradeUrl: upgradeUrl(env),
    usageCounted: gated && storeConfigured(env),
    plans: {
      free: { name: names.free, period: "day", limit: l.freeDaily, premiumLimit: 0, perks: [`${l.freeDaily} messages per day`] },
      pro: {
        name: names.pro,
        price: names.proPrice,
        period: "month",
        limit: l.proMonthly,
        premiumLimit: premium ? l.proPremiumMonthly : 0,
        perks: [
          `${l.proMonthly} AI messages per month`,
          ...(premium ? [`${l.proPremiumMonthly} premium (Claude) requests per month`] : []),
          ...(attachments ? ["Attach images, PDFs and text files"] : [])
        ]
      }
    },
    features: { attachments, ownKey: featureOn("OWN_KEY", env), premium },
    intents: INTENTS.map(({ id, label }) => ({ id, label })),
    replyIntents: REPLY_INTENTS.map(({ id, label }) => ({ id, label })),
    modes: Object.fromEntries(MODE_IDS.map(id => [id, { system: MODE_PROMPTS[id] }])),
    minExtensionVersion: update.minVersion,
    updateMessage: update.message
  };
}

const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// The words shown when a limit is reached. They live here, with the numbers, so they are never out of date.
export function limitFailure(reason, quota) {
  switch (reason) {
    case "daily":
      return { code: "free_limit_reached", error: `You have used your ${quota.limit} free messages for today. They come back at midnight UTC.` };
    case "ip":
      return { code: "free_limit_ip", error: "Too many free messages have been used from this network today. Try again tomorrow, or upgrade." };
    case "monthly":
      return { code: "pro_limit_reached", error: `You have used all ${quota.limit} messages for this month. They come back on ${day(quota.resetsAt)}.` };
    default:
      return { code: "premium_limit_reached", error: `You have used all ${quota.premium.limit} premium requests for this month. Standard messages still work, and they come back on ${day(quota.resetsAt)}.` };
  }
}
