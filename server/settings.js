// Every plan, limit and switch the server reads from the environment, in one place.
// Changing any of these in Vercel (then redeploying) changes the product for every
// extension version, with no new submission to the Chrome Web Store.
//
// Plans
//   FREE_DAILY_LIMIT              free messages per device per day            (default 10)
//   FREE_IP_DAILY_LIMIT           free messages per IP address per day        (default 40)
//   PRO_MONTHLY_LIMIT             Premium messages per license per month      (default 500)
//   PRO_PREMIUM_MONTHLY_LIMIT     premium (Claude) requests per month         (default 30)
//   PRO_PLAN_NAME                 name shown for the paid plan                (default "Premium Access")
//   PRO_PRICE_LABEL               price shown for the paid plan, e.g. "$2/month" (default none)
// Features (set to "false" or "0" to switch off)
//   FEATURE_ATTACHMENTS           file attachments for paid users             (default on)
//   FEATURE_OWN_KEY               users adding their own API key              (default on)
// Extension versions
//   MIN_EXTENSION_VERSION         older extensions are asked to update        (default none)
//   UPDATE_MESSAGE                text shown with that request

const intSetting = (value, fallback) => {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function limits(env = process.env) {
  return {
    freeDaily: intSetting(env.FREE_DAILY_LIMIT ?? env.FREE_CHAT_LIMIT, 10), // FREE_CHAT_LIMIT is the old name
    freeIpDaily: intSetting(env.FREE_IP_DAILY_LIMIT, 40),
    proMonthly: intSetting(env.PRO_MONTHLY_LIMIT, 500),
    proPremiumMonthly: intSetting(env.PRO_PREMIUM_MONTHLY_LIMIT, 30)
  };
}

const text = (value, fallback, max = 60) => {
  const t = typeof value === "string" ? value.trim().slice(0, max) : "";
  return t || fallback;
};

export function planNames(env = process.env) {
  return { free: "Free", pro: text(env.PRO_PLAN_NAME, "Premium Access"), proPrice: text(env.PRO_PRICE_LABEL, "", 40) };
}

export function featureOn(name, env = process.env) {
  const value = String(env[`FEATURE_${name}`] ?? "").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(value);
}

export function updatePolicy(env = process.env) {
  const min = String(env.MIN_EXTENSION_VERSION || "").trim();
  return {
    minVersion: /^\d+(\.\d+){0,2}$/.test(min) ? min : null,
    message: text(env.UPDATE_MESSAGE, "Please update Smart Chat Assistant to keep using it.", 200)
  };
}

// 2.10.0 > 2.9.1. Missing parts count as 0.
export function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map(n => Number.parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

// UTC calendar periods: free allowances reset at midnight, paid ones on the 1st.
export function periodKey(plan, now = new Date()) {
  const iso = now.toISOString();
  return plan === "pro" ? iso.slice(0, 7) : iso.slice(0, 10);
}

export function resetsAt(plan, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return (plan === "pro" ? new Date(Date.UTC(y, m + 1, 1)) : new Date(Date.UTC(y, m, now.getUTCDate() + 1))).toISOString();
}
