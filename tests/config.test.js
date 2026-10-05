import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, SUPPORTED_API_VERSION, compareVersions, needsUpdate, normalizeConfig, systemPromptFor, upgradeLabel } from "../src/lib/config.js";
import { MODE_PROMPTS } from "../src/lib/prompts.js";
import { publicConfig } from "../server/plans.js";

const ENV = { DEEPSEEK_API_KEY: "k", ANTHROPIC_API_KEY: "k", POLAR_ORGANIZATION_ID: "org", POLAR_CHECKOUT_URL: "https://buy.polar.sh/x", UPSTASH_REDIS_REST_URL: "https://r.example.com", UPSTASH_REDIS_REST_TOKEN: "t", PRO_PRICE_LABEL: "$2/month" };

test("the server's real config passes through the extension's checks unchanged", () => {
  const sent = publicConfig(ENV);
  const got = normalizeConfig(JSON.parse(JSON.stringify(sent)));
  assert.deepEqual(got.plans, { free: { price: "", ...sent.plans.free }, pro: sent.plans.pro });
  assert.deepEqual(got.features, sent.features);
  assert.deepEqual([got.gated, got.environment, got.upgradeUrl, got.usageCounted], [sent.gated, sent.environment, sent.upgradeUrl, sent.usageCounted]);
  assert.equal(got.modes.rewrite.system, MODE_PROMPTS.rewrite);
  assert.equal(got.incompatible, false);
});

test("nothing, junk, or the wrong types give the built-in defaults", () => {
  for (const junk of [undefined, null, "text", 42, [], { plans: "x", features: 3, modes: [], perks: {} }]) {
    const c = normalizeConfig(junk);
    assert.equal(c.plans.free.limit, 10);
    assert.deepEqual(c.features, DEFAULT_CONFIG.features);
    assert.equal(c.upgradeUrl, null);
  }
  const a = normalizeConfig(null); a.plans.free.name = "changed";
  assert.equal(DEFAULT_CONFIG.plans.free.name, "Free", "the built-in defaults can't be changed by accident");
});

test("only https links are accepted for the upgrade button", () => {
  for (const bad of ["javascript:alert(1)", "http://x.com", "data:text/html,<b>", "//x.com", "not a url", 5, null]) {
    assert.equal(normalizeConfig({ upgradeUrl: bad }).upgradeUrl, null, String(bad));
  }
  assert.equal(normalizeConfig({ upgradeUrl: "https://buy.polar.sh/x" }).upgradeUrl, "https://buy.polar.sh/x");
});

test("text and numbers are cut down to safe sizes, and markup stays plain text", () => {
  const c = normalizeConfig({ plans: { pro: { name: "A".repeat(500), price: "$<b>2</b>", limit: -5, premiumLimit: "abc", period: "year", perks: ["ok", "", 7, "x".repeat(500), "3", "4", "5", "6", "7", "8"] } }, updateMessage: "U".repeat(999) });
  assert.equal(c.plans.pro.name.length, 40);
  assert.equal(c.plans.pro.price, "$<b>2</b>"); // kept as text; the panel only ever shows it as text
  assert.equal(c.plans.pro.limit, 500, "a bad number falls back to the default");
  assert.equal(c.plans.pro.period, "month");
  assert.equal(c.plans.pro.perks.length, 6);
  assert.ok(c.plans.pro.perks.every(p => typeof p === "string" && p.length <= 100));
  assert.equal(c.updateMessage.length, 200);
});

test("mode prompts: only known modes, only strings, and the shipped prompt is the fallback", () => {
  const c = normalizeConfig({ modes: { rewrite: { system: "  Server rewrite prompt " }, hacked: { system: "x" }, chat: { system: 5 }, grammar: { system: "" } } });
  assert.deepEqual(Object.keys(c.modes), ["rewrite"]);
  assert.equal(systemPromptFor(c, "rewrite"), "Server rewrite prompt");
  assert.equal(systemPromptFor(c, "chat"), MODE_PROMPTS.chat);
  assert.equal(systemPromptFor(c, "nonsense"), MODE_PROMPTS.chat);
  assert.equal(normalizeConfig({ modes: { chat: { system: "s".repeat(9000) } } }).modes.chat.system.length, 4000);
});

test("a server on a newer API version is treated as incompatible and the user is asked to update", () => {
  const c = normalizeConfig({ apiVersion: SUPPORTED_API_VERSION + 1, plans: { pro: { name: "New shape" } }, updateMessage: "Please update." });
  assert.equal(c.incompatible, true);
  assert.equal(c.updateMessage, "Please update.");
  assert.equal(c.plans.pro.name, DEFAULT_CONFIG.plans.pro.name, "a shape this version doesn't understand is not used");
  assert.equal(needsUpdate(c, "2.6.0"), true);
  assert.equal(normalizeConfig({ apiVersion: SUPPORTED_API_VERSION }).incompatible, false);
});

test("needsUpdate compares versions properly", () => {
  const cfg = (min) => normalizeConfig({ minExtensionVersion: min });
  assert.equal(needsUpdate(cfg("2.6.0"), "2.5.9"), true);
  assert.equal(needsUpdate(cfg("2.6.0"), "2.6.0"), false);
  assert.equal(needsUpdate(cfg("2.6.0"), "2.10.0"), false);
  assert.equal(needsUpdate(cfg(null), "1.0.0"), false);
  assert.equal(needsUpdate(cfg("2.6"), "2.6.0"), false);
  assert.equal(needsUpdate(cfg("garbage"), "1.0.0"), false, "a malformed minimum is ignored");
  assert.equal(compareVersions("2.10.0", "2.9.9"), 1);
});

test("the upgrade button text follows the plan's price", () => {
  assert.equal(upgradeLabel(normalizeConfig({ plans: { pro: { price: "$2/month" } } })), "Upgrade · $2/month");
  assert.equal(upgradeLabel(normalizeConfig({})), "Upgrade to Premium");
});
