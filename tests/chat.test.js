import { test } from "node:test";
import assert from "node:assert/strict";
import {
    MODES,
    buildRequestBody,
    parseChatResponse,
    estimateTokens,
    tokensFromResponse
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
