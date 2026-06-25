import { test } from "node:test";
import assert from "node:assert/strict";
import {
    MODES,
    buildRequestBody,
    parseChatResponse,
    estimateTokens,
    tokensFromResponse,
    isRateLimited,
    summarizeRateLimit,
    quotaStatus,
    formatReset
} from "../src/lib/chat.js";

test("buildRequestBody includes prompt and system", () => {
    assert.deepEqual(buildRequestBody("hi", "be brief"), { prompt: "hi", system: "be brief" });
});

test("buildRequestBody defaults system to empty string", () => {
    assert.deepEqual(buildRequestBody("hi"), { prompt: "hi", system: "" });
});

test("parseChatResponse returns trimmed text", () => {
    assert.equal(parseChatResponse({ text: "  hello  " }), "hello");
});

test("parseChatResponse throws on empty text", () => {
    assert.throws(() => parseChatResponse({ text: "   " }), /Empty response/);
});

test("parseChatResponse throws on missing/non-string text", () => {
    assert.throws(() => parseChatResponse({}), /Empty response/);
    assert.throws(() => parseChatResponse({ text: 42 }), /Empty response/);
    assert.throws(() => parseChatResponse(null), /Empty response/);
});

test("estimateTokens approximates ~4 chars per token", () => {
    assert.equal(estimateTokens("12345678"), 2);
    assert.equal(estimateTokens(""), 0);
});

test("tokensFromResponse prefers real usage when present", () => {
    assert.equal(tokensFromResponse({ usage: { total_tokens: 123 } }, "in", "out"), 123);
});

test("tokensFromResponse falls back to an estimate when usage is absent", () => {
    // "input" (5) + "output text" (11) => ceil(5/4)=2 + ceil(11/4)=3 => 5
    assert.equal(tokensFromResponse({}, "input", "output text"), 5);
});

test("MODES exposes the expected modes", () => {
    assert.deepEqual(Object.keys(MODES).sort(), ["chat", "explain", "grammar", "summarize", "writing"]);
    assert.equal(MODES.chat, "");
});

test("isRateLimited: false when allowance remains", () => {
    assert.equal(isRateLimited({ remaining: 150, dailyLimit: { remaining: 7 } }), false);
});

test("isRateLimited: true when overall or daily is exhausted", () => {
    assert.equal(isRateLimited({ remaining: 0, dailyLimit: { remaining: 7 } }), true);
    assert.equal(isRateLimited({ remaining: 150, dailyLimit: { remaining: 0 } }), true);
});

test("isRateLimited: false when data is missing/unknown", () => {
    assert.equal(isRateLimited(null), false);
    assert.equal(isRateLimited({}), false);
});

test("summarizeRateLimit normalizes the payload", () => {
    const rate = { remaining: 150, limit: 150, reset: 111, dailyLimit: { remaining: 7, limit: 7, reset: 222 } };
    assert.deepEqual(summarizeRateLimit(rate), {
        remaining: 150,
        limit: 150,
        dailyRemaining: 7,
        dailyLimit: 7,
        reset: 222
    });
    assert.equal(summarizeRateLimit(null), null);
});

test("quotaStatus prefers the daily allowance and sets the level", () => {
    const s = quotaStatus({ dailyLimit: 7, dailyRemaining: 7, limit: 150, remaining: 150 });
    assert.equal(s.scope, "daily");
    assert.equal(s.used, 0);
    assert.equal(s.total, 7);
    assert.equal(s.percent, 0);
    assert.equal(s.level, "green");
    assert.equal(s.exhausted, false);
});

test("quotaStatus level thresholds: yellow >=50%, red >=80%, exhausted at 0", () => {
    assert.equal(quotaStatus({ dailyLimit: 10, dailyRemaining: 5 }).level, "yellow"); // 50%
    assert.equal(quotaStatus({ dailyLimit: 10, dailyRemaining: 2 }).level, "red");    // 80%
    const done = quotaStatus({ dailyLimit: 7, dailyRemaining: 0 });
    assert.equal(done.percent, 100);
    assert.equal(done.exhausted, true);
});

test("quotaStatus falls back to overall, then unknown", () => {
    assert.equal(quotaStatus({ limit: 150, remaining: 75 }).scope, "overall");
    assert.equal(quotaStatus(null).level, "unknown");
    assert.equal(quotaStatus({}).level, "unknown");
});

test("formatReset renders a human countdown", () => {
    const now = 1_000_000_000_000;
    assert.equal(formatReset(now + 30 * 60000, now), "resets in 30m");
    assert.equal(formatReset(now + 6 * 3600000, now), "resets in 6h");
    assert.equal(formatReset(now + (2 * 3600000 + 15 * 60000), now), "resets in 2h 15m");
    assert.equal(formatReset(now - 1, now), "resetting…");
    assert.equal(formatReset(undefined, now), "");
});
