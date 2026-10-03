import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/chat.js";
import { checkProvider, detectKeyMismatch, readKey, resolveProvider } from "../server/providers.js";

const KEY_VARS = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "V0_API_KEY", "AI_PROVIDER",
  "OPENAI_MODEL", "DEEPSEEK_MODEL", "ANTHROPIC_MODEL", "V0_MODEL", "ANTHROPIC_EFFORT"];
// Built at runtime so secret scanners don't mistake the fixture for a real key.
const FAKE_DEEPSEEK_KEY = ["sk", "0123456789abcdef".repeat(2)].join("-");
const realFetch = globalThis.fetch;
let saved;
let calls;

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

// routes: array of [predicate(url, init), responder(url, init)]
function stubFetch(routes) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    for (const [match, respond] of routes) if (match(url, init)) return respond(url, init);
    throw new Error(`Unexpected fetch ${url}`);
  };
}

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
}

async function call(req) {
  const res = fakeRes();
  await handler({ query: {}, ...req }, res);
  return res;
}

beforeEach(() => {
  saved = Object.fromEntries(KEY_VARS.map(k => [k, process.env[k]]));
  KEY_VARS.forEach(k => delete process.env[k]);
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  KEY_VARS.forEach(k => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
});

test("health check lists every provider and reports missing keys", async () => {
  const res = await call({ method: "GET" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(Object.keys(res.body.providers).sort(), ["anthropic", "deepseek", "openai", "v0"]);
  for (const result of Object.values(res.body.providers)) {
    assert.equal(result.configured, false);
    assert.equal(result.ok, false);
    assert.match(result.hint, /Environment Variables/);
  }
  assert.equal(calls.length, 0, "no network calls without keys");
});

test("OpenAI check verifies the model, then sends a test request", async () => {
  process.env.OPENAI_API_KEY = "sk-proj-abc";
  stubFetch([
    [url => url === "https://api.openai.com/v1/models/gpt-5-nano", () => json(200, { id: "gpt-5-mini" })],
    [url => url === "https://api.openai.com/v1/responses", () => json(200, { status: "incomplete", output: [] })]
  ]);
  const res = await call({ method: "GET", query: { provider: "openai", verify: "1" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.providers.openai.ok, true);
  assert.equal(res.body.providers.openai.verified, true);
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-proj-abc");
});

test("a rejected key reports the stage, status and a fix", async () => {
  process.env.DEEPSEEK_API_KEY = FAKE_DEEPSEEK_KEY;
  stubFetch([[url => url.startsWith("https://api.deepseek.com/"), () => json(401, { error: { message: "Authentication Fails", type: "authentication_error" } })]]);
  const result = await checkProvider("deepseek", { verify: true });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "auth");
  assert.equal(result.upstreamStatus, 401);
  assert.match(result.hint, /DEEPSEEK_API_KEY/);
});

test("DeepSeek check flags a model that is not in the account's list", async () => {
  process.env.DEEPSEEK_API_KEY = FAKE_DEEPSEEK_KEY;
  process.env.DEEPSEEK_MODEL = "deepseek-typo";
  stubFetch([[url => url === "https://api.deepseek.com/models", () => json(200, { data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] })]]);
  const result = await checkProvider("deepseek");
  assert.equal(result.ok, false);
  assert.equal(result.upstreamCode, "model_not_found");
  assert.match(result.error, /deepseek-flash/);
});

test("DeepSeek verify surfaces insufficient balance (402)", async () => {
  process.env.DEEPSEEK_API_KEY = FAKE_DEEPSEEK_KEY;
  stubFetch([
    [url => url === "https://api.deepseek.com/models", () => json(200, { data: [{ id: "deepseek-flash" }] })],
    [url => url === "https://api.deepseek.com/chat/completions", () => json(402, { error: { message: "Insufficient Balance", type: "unknown_error" } })]
  ]);
  const result = await checkProvider("deepseek", { verify: true });
  assert.equal(result.stage, "verify");
  assert.match(result.hint, /no balance/);
});

test("Anthropic check uses the SDK headers and retrieves the model", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.ANTHROPIC_MODEL = "claude-opus-5-5";
  stubFetch([
    [url => url.startsWith("https://api.anthropic.com/v1/models/claude-opus-5-5"), () => json(200, { id: "claude-opus-5-5", type: "model" })],
    [url => url.startsWith("https://api.anthropic.com/v1/messages"), (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.fallbacks, "default");
      return json(200, { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } });
    }]
  ]);
  const result = await checkProvider("anthropic", { verify: true });
  assert.equal(result.ok, true, result.error);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("x-api-key"), "sk-ant-test");
  assert.ok(headers.get("anthropic-version"));
  assert.match(new Headers(calls[1].init.headers).get("anthropic-beta") || "", /server-side-fallback-2026-07-01/);
});

test("Anthropic authentication errors are normalized", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-bad";
  stubFetch([[url => url.startsWith("https://api.anthropic.com/"), () => json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })]]);
  const result = await checkProvider("anthropic");
  assert.equal(result.ok, false);
  assert.equal(result.upstreamStatus, 401);
  assert.equal(result.upstreamCode, "authentication_error");
  assert.match(result.hint, /ANTHROPIC_API_KEY/);
});

test("v0 404 explains the plan requirement", async () => {
  process.env.V0_API_KEY = "v0-key";
  stubFetch([[url => url.startsWith("https://api.v0.dev/"), () => json(404, { error: "Not found" })]]);
  const result = await checkProvider("v0");
  assert.equal(result.ok, false);
  assert.match(result.hint, /Premium or Team/);
});

test("network failures are reported without throwing", async () => {
  process.env.OPENAI_API_KEY = "sk-proj-abc";
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  const result = await checkProvider("openai");
  assert.equal(result.ok, false);
  assert.equal(result.upstreamCode, "network");
});

test("POST routes to the requested provider", async () => {
  process.env.OPENAI_API_KEY = "sk-proj-abc";
  process.env.DEEPSEEK_API_KEY = FAKE_DEEPSEEK_KEY;
  stubFetch([[url => url === "https://api.deepseek.com/chat/completions", (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].content, "hello");
    return json(200, { model: "deepseek-flash", choices: [{ message: { content: "Hi there" } }] });
  }]]);
  const res = await call({ method: "POST", body: { prompt: "hello", provider: "deepseek" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, "deepseek");
  assert.equal(res.body.text, "Hi there");
});

test("POST passes upstream 4xx through with a hint", async () => {
  process.env.OPENAI_API_KEY = "sk-proj-abc";
  stubFetch([[() => true, () => json(429, { error: { message: "You exceeded your current quota", code: "insufficient_quota" } }, { "retry-after": "20" })]]);
  const res = await call({ method: "POST", body: { prompt: "hello" } });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.provider, "openai");
  assert.equal(res.body.upstreamCode, "insufficient_quota");
  assert.match(res.body.hint, /billing/);
  assert.equal(res.headers["retry-after"], "20");
});

test("OpenAI empty output caused by reasoning budget is explained", async () => {
  process.env.OPENAI_API_KEY = "sk-proj-abc";
  stubFetch([[() => true, () => json(200, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "reasoning" }] })]]);
  const res = await call({ method: "POST", body: { prompt: "hello", provider: "openai" } });
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /reasoning/);
});

test("POST rejects unknown or unconfigured providers", async () => {
  process.env.OPENAI_API_KEY = "sk-proj-abc";
  let res = await call({ method: "POST", body: { prompt: "hi", provider: "gemini" } });
  assert.equal(res.statusCode, 400);
  res = await call({ method: "POST", body: { prompt: "hi", provider: "anthropic" } });
  assert.equal(res.statusCode, 503);
  assert.match(res.body.hint, /ANTHROPIC_API_KEY/);
});

test("resolveProvider honours AI_PROVIDER, else first configured", () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-x";
  process.env.DEEPSEEK_API_KEY = FAKE_DEEPSEEK_KEY;
  assert.equal(resolveProvider("auto"), "deepseek");
  process.env.AI_PROVIDER = "anthropic";
  assert.equal(resolveProvider("auto"), "anthropic");
  process.env.AI_PROVIDER = "openai"; // not configured → fall back
  assert.equal(resolveProvider("auto"), "deepseek");
});

test("keys are cleaned and misplaced keys are detected", () => {
  const { key, warnings } = readKey("openai", { OPENAI_API_KEY: ' "sk-ant-abc" \n' });
  assert.equal(key, "sk-ant-abc");
  assert.equal(warnings.length, 3);
  assert.match(detectKeyMismatch("openai", FAKE_DEEPSEEK_KEY), /DeepSeek/);
  assert.match(detectKeyMismatch("deepseek", "sk-proj-123"), /OpenAI/);
  assert.equal(detectKeyMismatch("anthropic", "sk-ant-123"), null);
});

test("Anthropic defaults to Haiku and omits effort and fallbacks it does not support", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.ANTHROPIC_EFFORT = "high";
  stubFetch([[url => url.startsWith("https://api.anthropic.com/v1/messages"), (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, "claude-haiku-4-5");
    assert.equal(body.fallbacks, undefined);
    assert.equal(body.output_config, undefined);
    return json(200, { id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } });
  }]]);
  const res = await call({ method: "POST", body: { prompt: "hello", provider: "anthropic" } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.text, "Hi");
});

test("DeepSeek defaults to deepseek-flash", async () => {
  process.env.DEEPSEEK_API_KEY = FAKE_DEEPSEEK_KEY;
  stubFetch([
    [url => url === "https://api.deepseek.com/models", () => json(200, { data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] })],
    [url => url === "https://api.deepseek.com/chat/completions", (url, init) => {
      assert.equal(JSON.parse(init.body).model, "deepseek-flash");
      return json(200, { choices: [{ message: { content: "OK" } }] });
    }]
  ]);
  const result = await checkProvider("deepseek", { verify: true });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.model, "deepseek-flash");
});

test("v0 reports an unavailable model when its model list says so, and ignores an unavailable list", async () => {
  process.env.V0_API_KEY = "v0-key";
  stubFetch([
    [url => url === "https://api.v0.dev/v1/rate-limits", () => json(200, {})],
    [url => url === "https://api.v0.dev/v1/models", () => json(200, { data: [{ id: "v0-2-md" }] })]
  ]);
  let result = await checkProvider("v0");
  assert.equal(result.ok, false);
  assert.equal(result.upstreamCode, "model_not_found");
  assert.match(result.error, /v0-2-md/);

  stubFetch([
    [url => url === "https://api.v0.dev/v1/rate-limits", () => json(200, {})],
    [url => url === "https://api.v0.dev/v1/models", () => json(404, { error: "Not found" })]
  ]);
  result = await checkProvider("v0");
  assert.equal(result.ok, true, "a missing model list must not fail the check");
});
