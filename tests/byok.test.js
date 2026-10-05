import { test } from "node:test";
import assert from "node:assert/strict";
import { BYOK_PROVIDERS, OwnKeyError, explainOwnKeyError, keyProblem, maskKey, sendOwnKeyRequest, testOwnKey } from "../src/lib/byok.js";

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// A fetch stub that records each call and answers with `reply` (a fresh copy each time, like a real fetch).
function stub(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return typeof reply === "function" ? reply(String(url), init) : reply.clone(); };
  return { calls, fetchImpl };
}

test("OpenAI: Responses API request shape and text extraction", async () => {
  const { calls, fetchImpl } = stub(json(200, { model: "gpt-5-nano", output: [{ type: "reasoning" }, { content: [{ type: "output_text", text: "Hello there" }] }] }));
  const result = await sendOwnKeyRequest({ provider: "openai", key: "  sk-proj-abc ", prompt: "hi", system: "Be brief.", fetchImpl });
  assert.equal(result.text, "Hello there");
  assert.equal(result.provider, "openai");
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-proj-abc");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual([body.model, body.instructions, body.input], ["gpt-5-nano", "Be brief.", "hi"]);
});

test("DeepSeek: chat completions request shape, default model and a custom model", async () => {
  const { calls, fetchImpl } = stub(json(200, { choices: [{ message: { content: "Hi" } }] }));
  await sendOwnKeyRequest({ provider: "deepseek", key: "sk-x", prompt: "hello", system: "S", fetchImpl });
  assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
  let body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "deepseek-flash");
  assert.deepEqual(body.messages, [{ role: "system", content: "S" }, { role: "user", content: "hello" }]);
  await sendOwnKeyRequest({ provider: "deepseek", key: "sk-x", model: " deepseek-v4-pro ", prompt: "hello", fetchImpl });
  body = JSON.parse(calls[1].init.body);
  assert.equal(body.model, "deepseek-v4-pro");
  assert.deepEqual(body.messages, [{ role: "user", content: "hello" }]);
});

test("Anthropic: Messages API headers and body, text extraction, refusal", async () => {
  const { calls, fetchImpl } = stub(json(200, { model: "claude-haiku-4-5-20251001", stop_reason: "end_turn", content: [{ type: "text", text: "Part one. " }, { type: "text", text: "Part two." }] }));
  const result = await sendOwnKeyRequest({ provider: "anthropic", key: "sk-ant-abc", prompt: "hi", system: "S", fetchImpl });
  assert.equal(result.text, "Part one. Part two.");
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  const h = calls[0].init.headers;
  assert.equal(h["x-api-key"], "sk-ant-abc");
  assert.equal(h["anthropic-version"], "2023-06-01");
  assert.equal(h["anthropic-dangerous-direct-browser-access"], "true");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual([body.model, body.system, body.messages], ["claude-haiku-4-5", "S", [{ role: "user", content: "hi" }]]);
  assert.equal(body.fallbacks, undefined, "Haiku does not take the fallback parameter");

  const refused = stub(json(200, { stop_reason: "refusal", content: [] }));
  await assert.rejects(() => sendOwnKeyRequest({ provider: "anthropic", key: "sk-ant-abc", prompt: "x", fetchImpl: refused.fetchImpl }), /declined/);
});

test("the key is only ever sent to the chosen provider's own host", async () => {
  for (const [provider, origin] of [["openai", "https://api.openai.com/"], ["deepseek", "https://api.deepseek.com/"], ["anthropic", "https://api.anthropic.com/"]]) {
    const { calls, fetchImpl } = stub(json(200, { output: [{ content: [{ type: "output_text", text: "x" }] }], choices: [{ message: { content: "x" } }], content: [{ type: "text", text: "x" }] }));
    await sendOwnKeyRequest({ provider, key: "SECRET-KEY-VALUE", prompt: "p", fetchImpl });
    assert.ok(calls.every(c => c.url.startsWith(origin)), provider);
    assert.ok(BYOK_PROVIDERS[provider].origin.startsWith(origin));
  }
});

test("errors are turned into plain advice", async () => {
  const cases = [
    ["openai", 401, { error: { message: "Incorrect API key", code: "invalid_api_key" } }, /rejected the key/],
    ["openai", 429, { error: { message: "You exceeded your current quota", code: "insufficient_quota" } }, /rate limiting|no balance/],
    ["deepseek", 402, { error: { message: "Insufficient Balance" } }, /no balance/],
    ["anthropic", 404, { type: "error", error: { type: "not_found_error", message: "model: nope" } }, /does not have this model/],
    ["anthropic", 400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } }, /no balance/]
  ];
  for (const [provider, status, body, expected] of cases) {
    const { fetchImpl } = stub(json(status, body));
    await assert.rejects(() => sendOwnKeyRequest({ provider, key: "k", prompt: "p", fetchImpl }), error => {
      assert.ok(error instanceof OwnKeyError);
      assert.equal(error.status, status);
      assert.match(error.message, expected, `${provider} ${status}`);
      return true;
    });
  }
  assert.match(explainOwnKeyError("openai", 500), /having problems/);
});

test("network failures mention Chrome's permission", async () => {
  const fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(() => sendOwnKeyRequest({ provider: "openai", key: "k", prompt: "p", fetchImpl }), error => {
    assert.equal(error.status, 0);
    assert.match(error.message, /permission/);
    return true;
  });
});

test("OpenAI reasoning that uses the whole budget is explained", async () => {
  const { fetchImpl } = stub(json(200, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "reasoning" }] }));
  await assert.rejects(() => sendOwnKeyRequest({ provider: "openai", key: "k", prompt: "p", fetchImpl }), /whole token budget/);
});

test("testOwnKey sends a tiny request and reports the model", async () => {
  const { calls, fetchImpl } = stub(json(200, { model: "deepseek-flash", choices: [{ message: { content: "OK" } }] }));
  const result = await testOwnKey({ provider: "deepseek", key: "sk-x", fetchImpl });
  assert.deepEqual(result, { ok: true, model: "deepseek-flash" });
  assert.match(JSON.parse(calls[0].init.body).messages.at(-1).content, /Reply with OK/);
});

test("keyProblem catches empty keys, spaces and a key for the wrong provider", () => {
  assert.match(keyProblem("openai", ""), /Paste/);
  assert.match(keyProblem("openai", "sk-proj-a b"), /spaces/);
  assert.match(keyProblem("openai", "sk-ant-abc"), /Anthropic key/);
  assert.match(keyProblem("anthropic", "sk-proj-abc"), /sk-ant-/);
  assert.match(keyProblem("deepseek", "sk-proj-abc"), /OpenAI key/);
  assert.equal(keyProblem("openai", "sk-proj-abc"), null);
  assert.equal(keyProblem("anthropic", "sk-ant-abc"), null);
});

test("maskKey shows only the last four characters", () => {
  assert.equal(maskKey("sk-proj-abcdefgh1234"), "...1234");
  assert.equal(maskKey("short"), "saved");
});
