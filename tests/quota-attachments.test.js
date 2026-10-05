import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/chat.js";
import { clearLicenseCache } from "../server/entitlement.js";
import { validateAttachments, promptWithTextFiles } from "../server/attachments.js";
import { resolveProvider } from "../server/providers.js";

const PREFIXED = ["chat_assistant_db_KV_REST_API_URL", "chat_assistant_db_KV_REST_API_TOKEN", "chat_assistant_db_KV_REST_API_READ_ONLY_TOKEN", "chat_assistant_db_KV_URL", "chat_assistant_db_REDIS_URL"];
const VARS = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "V0_API_KEY", "AI_PROVIDER", "POLAR_ORGANIZATION_ID", "POLAR_CHECKOUT_URL",
  "POLAR_ENV", "POLAR_SERVER", "POLAR_SANDBOX_ORGANIZATION_ID", "POLAR_SANDBOX_CHECKOUT_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL", "KV_REST_API_TOKEN", ...PREFIXED, "FREE_CHAT_LIMIT", "FREE_IP_DAILY_LIMIT", "FREE_PROVIDER", "QUOTA_SALT", "OPENAI_MODEL", "ANTHROPIC_MODEL"];
const ORG = "11111111-2222-3333-4444-555555555555";
const DEVICE = "3f0c9a52-6b1d-4e1a-9a55-0d6f5b1c2e77";
const OTHER_DEVICE = "9a7e3c10-2d4b-4f6e-8c11-5a2b7d9e0f34";
const realFetch = globalThis.fetch;
let saved, calls, redis, redisDown, polarStatus;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A tiny in-memory stand-in for Upstash's REST pipeline (GET, INCR, DECR, EXPIRE).
function runPipeline(commands) {
  return commands.map(([cmd, key, arg]) => {
    if (cmd === "GET") return { result: redis.has(key) ? String(redis.get(key)) : null };
    if (cmd === "INCR") { redis.set(key, (redis.get(key) || 0) + 1); return { result: redis.get(key) }; }
    if (cmd === "DECR") { redis.set(key, (redis.get(key) || 0) - 1); return { result: redis.get(key) }; }
    if (cmd === "EXPIRE") return { result: 1 };
    if (cmd === "PING") return { result: "PONG" };
    return { error: `unknown command ${cmd}` };
  });
}

function stub({ openai, deepseek, anthropic } = {}) {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://redis.example.com/pipeline")) {
      if (redisDown) throw new TypeError("fetch failed");
      return json(200, runPipeline(JSON.parse(init.body)));
    }
    if (url.includes("/license-keys/validate")) return polarStatus === 404 ? json(404, {}) : json(200, { status: "granted", expires_at: null });
    if (url === "https://api.openai.com/v1/responses") return openai ? openai(init) : json(200, { model: "gpt-5-nano", output: [{ content: [{ type: "output_text", text: "OpenAI answer" }] }] });
    if (url === "https://api.deepseek.com/chat/completions") return deepseek ? deepseek(init) : json(200, { model: "deepseek-flash", choices: [{ message: { content: "DeepSeek answer" } }] });
    if (url.startsWith("https://api.anthropic.com/v1/messages")) return anthropic ? anthropic(init) : json(200, { id: "m", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [{ type: "text", text: "Claude answer" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    throw new Error(`Unexpected fetch ${url}`);
  };
}

function fakeRes() {
  return { statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
}
async function call(req) { const res = fakeRes(); await handler({ query: {}, headers: {}, ...req }, res); return res; }

// Real file bytes, so the server's signature checks pass.
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = b64(Buffer.from("%PDF-1.4\n%fake\n"));
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2]);
const text = (s) => Buffer.from(s).toString("base64");
const file = (name, mime, data) => ({ name, mime, data });

beforeEach(() => {
  saved = Object.fromEntries(VARS.map(k => [k, process.env[k]]));
  VARS.forEach(k => delete process.env[k]);
  Object.assign(process.env, { OPENAI_API_KEY: "sk-proj-abc", DEEPSEEK_API_KEY: "ds-key", ANTHROPIC_API_KEY: "sk-ant-abc", POLAR_ORGANIZATION_ID: ORG,
    POLAR_CHECKOUT_URL: "https://buy.polar.sh/polar_cl_x", UPSTASH_REDIS_REST_URL: "https://redis.example.com", UPSTASH_REDIS_REST_TOKEN: "tok" });
  calls = []; redis = new Map(); redisDown = false; polarStatus = 200;
  clearLicenseCache(); stub();
});
afterEach(() => { globalThis.fetch = realFetch; VARS.forEach(k => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))); });

const freeChat = (extra = {}, device = DEVICE) => call({ method: "POST", headers: { "x-client-id": device, "x-forwarded-for": "203.0.113.7" }, body: { prompt: "hello", system: "Be brief.", ...extra } });
const paidChat = (body, headers = {}) => call({ method: "POST", headers: { "x-license-key": "LIC", ...headers }, body: { prompt: "hello", system: "S", ...body } });
const providerCalls = () => calls.filter(c => /api\.(openai|deepseek|anthropic)\.com/.test(c.url));

// ---------- free allowance ----------

test("a free visitor is served by the cheap provider and counted on the server", async () => {
  const res = await freeChat({ provider: "anthropic" }); // the request asks for Anthropic, but free chats use DeepSeek
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, "deepseek");
  assert.equal(res.body.text, "DeepSeek answer");
  assert.deepEqual(res.body.quota, { used: 1, limit: 10, remaining: 9 });
  assert.equal(providerCalls().length, 1);
  assert.match(providerCalls()[0].url, /deepseek/);
});

test("the 11th free chat is refused before any provider is called", async () => {
  for (let i = 0; i < 10; i++) assert.equal((await freeChat()).statusCode, 200, `chat ${i + 1}`);
  calls = [];
  const res = await freeChat();
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, "free_limit_reached");
  assert.deepEqual(res.body.quota, { used: 10, limit: 10, remaining: 0 });
  assert.equal(res.body.upgradeUrl, "https://buy.polar.sh/polar_cl_x");
  assert.equal(providerCalls().length, 0);
  // a refused attempt is not counted
  assert.equal((await call({ method: "GET", query: { quota: "1" }, headers: { "x-client-id": DEVICE } })).body.used, 10);
});

test("each device has its own count and FREE_CHAT_LIMIT is respected", async () => {
  process.env.FREE_CHAT_LIMIT = "2";
  await freeChat(); await freeChat();
  assert.equal((await freeChat()).statusCode, 402);
  assert.equal((await freeChat({}, OTHER_DEVICE)).statusCode, 200);
});

test("a failed model call gives the free chat back", async () => {
  stub({ deepseek: () => json(500, { error: { message: "boom" } }) });
  const failed = await freeChat();
  assert.equal(failed.statusCode, 502);
  const usage = await call({ method: "GET", query: { quota: "1" }, headers: { "x-client-id": DEVICE } });
  assert.deepEqual([usage.body.used, usage.body.remaining], [0, 10]);
});

test("an IP address has a daily cap that new device ids cannot get around", async () => {
  process.env.FREE_IP_DAILY_LIMIT = "3";
  const ids = ["aaaaaaaa-1111-4111-8111-000000000001", "aaaaaaaa-1111-4111-8111-000000000002", "aaaaaaaa-1111-4111-8111-000000000003", "aaaaaaaa-1111-4111-8111-000000000004"];
  for (const id of ids.slice(0, 3)) assert.equal((await freeChat({}, id)).statusCode, 200);
  const res = await freeChat({}, ids[3]);
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, "free_limit_ip");
  // the refused attempt did not leave the new device with a used chat
  assert.equal((await call({ method: "GET", query: { quota: "1" }, headers: { "x-client-id": ids[3] } })).body.used, 0);
});

test("without the counter store, or without a client id, a visitor gets the paid-only message", async () => {
  let res = await call({ method: "POST", headers: {}, body: { prompt: "hi" } });
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, "paid_required");
  delete process.env.UPSTASH_REDIS_REST_URL;
  res = await freeChat();
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, "paid_required");
  assert.equal(providerCalls().length, 0);
});

test("the KV_REST_API_* names work for the store, and a bad client id is ignored", async () => {
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.KV_REST_API_URL = "https://redis.example.com"; process.env.KV_REST_API_TOKEN = "tok";
  assert.equal((await freeChat()).statusCode, 200);
  assert.equal((await freeChat({}, "not-a-uuid")).body.code, "paid_required");
});

test("if the store is down the free allowance fails closed", async () => {
  redisDown = true;
  const res = await freeChat();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "quota_unavailable");
  assert.equal(providerCalls().length, 0);
});

test("a license that was sent but is not valid gets a license error, not the free allowance", async () => {
  polarStatus = 404;
  const res = await call({ method: "POST", headers: { "x-license-key": "BAD", "x-client-id": DEVICE }, body: { prompt: "hi" } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "license_invalid");
});

test("paid users are not counted and can choose any provider", async () => {
  const res = await paidChat({ provider: "anthropic" }, { "x-client-id": DEVICE });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, "anthropic");
  assert.equal(res.body.quota, undefined);
  assert.equal(redis.size, 0);
});

test("the info endpoint tells the extension whether a server free allowance exists", async () => {
  let res = await call({ method: "GET", query: { info: "1" } });
  assert.deepEqual([res.body.freeQuota, res.body.freeLimit], [true, 10]);
  delete process.env.UPSTASH_REDIS_REST_URL;
  res = await call({ method: "GET", query: { info: "1" } });
  assert.deepEqual([res.body.freeQuota, res.body.freeLimit], [false, null]);
  assert.equal((await call({ method: "GET", query: { quota: "1" } })).body.enabled, false);
});

test("the quota endpoint needs a client id", async () => {
  assert.equal((await call({ method: "GET", query: { quota: "1" } })).statusCode, 400);
});

test("with paid-only access off, nothing is counted or restricted", async () => {
  delete process.env.POLAR_ORGANIZATION_ID;
  const res = await call({ method: "POST", headers: {}, body: { prompt: "hi", provider: "openai" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, "openai");
  assert.equal(redis.size, 0);
});

// ---------- attachments ----------

test("attachments are refused for free visitors and unlicensed callers, before anything is called", async () => {
  const body = { attachments: [file("a.png", "image/png", PNG)] };
  let res = await freeChat(body);
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, "attachments_paid");
  assert.equal(res.body.upgradeUrl, "https://buy.polar.sh/polar_cl_x");
  delete process.env.POLAR_ORGANIZATION_ID; // open server: still no attachments without a verified license
  res = await call({ method: "POST", headers: {}, body: { prompt: "hi", ...body } });
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, "attachments_paid");
  assert.equal(providerCalls().length, 0);
  assert.equal(redis.size, 0, "a refused attachment request does not use a free chat");
});

test("OpenAI receives images and PDFs as input_image and input_file", async () => {
  let sent;
  stub({ openai: (init) => { sent = JSON.parse(init.body); return json(200, { output: [{ content: [{ type: "output_text", text: "I see it" }] }] }); } });
  const res = await paidChat({ provider: "openai", attachments: [file("pic.png", "image/png", PNG), file("doc.pdf", "application/pdf", PDF)] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, "I see it");
  const content = sent.input[0].content;
  assert.deepEqual(content[0], { type: "input_text", text: "hello" });
  assert.deepEqual(content[1], { type: "input_image", image_url: `data:image/png;base64,${PNG}` });
  assert.deepEqual(content[2], { type: "input_file", filename: "doc.pdf", file_data: `data:application/pdf;base64,${PDF}` });
});

test("Anthropic receives image and document blocks before the text", async () => {
  let sent;
  stub({ anthropic: (init) => { sent = JSON.parse(init.body); return json(200, { id: "m", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [{ type: "text", text: "Read it" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }); } });
  const res = await paidChat({ provider: "anthropic", attachments: [file("doc.pdf", "application/pdf", PDF), file("p.jpg", "image/jpeg", JPEG)] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const content = sent.messages[0].content;
  assert.deepEqual(content[0], { type: "document", source: { type: "base64", media_type: "application/pdf", data: PDF }, title: "doc.pdf" });
  assert.deepEqual(content[1], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPEG } });
  assert.deepEqual(content[2], { type: "text", text: "hello" });
});

test("text files are added to the prompt and work with every provider", async () => {
  let sent;
  stub({ deepseek: (init) => { sent = JSON.parse(init.body); return json(200, { choices: [{ message: { content: "Summarised" } }] }); } });
  const res = await paidChat({ provider: "deepseek", attachments: [file("notes.md", "text/markdown", text("# Plan\nShip it"))] });
  assert.equal(res.statusCode, 200);
  assert.match(sent.messages.at(-1).content, /Attached file "notes\.md":\n"""\n# Plan\nShip it\n"""\n\nhello/);
});

test("images and PDFs with a text-only provider are refused with advice; auto picks one that can read them", async () => {
  const attachments = [file("pic.png", "image/png", PNG)];
  const refused = await paidChat({ provider: "deepseek", attachments });
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.body.code, "attachments_unsupported");
  assert.match(refused.body.hint, /OpenAI or Anthropic/);
  assert.equal(providerCalls().length, 0);

  process.env.AI_PROVIDER = "deepseek";
  const auto = await paidChat({ provider: "auto", attachments });
  assert.equal(auto.statusCode, 200);
  assert.equal(auto.body.provider, "openai", "auto skips DeepSeek and uses a provider that can read images");
  assert.equal(resolveProvider("auto", { DEEPSEEK_API_KEY: "k" }, { needsFiles: true }), null);
});

test("files are checked: real bytes must match the type, and the limits hold", async () => {
  const bad = async (attachments) => paidChat({ provider: "openai", attachments });
  let res = await bad([file("fake.png", "image/png", text("this is not a png"))]);
  assert.equal(res.statusCode, 400); assert.equal(res.body.code, "type_mismatch");
  res = await bad([file("fake.pdf", "application/pdf", text("not a pdf"))]);
  assert.equal(res.body.code, "type_mismatch");
  res = await bad([file("x.exe", "application/x-msdownload", text("MZ"))]);
  assert.equal(res.body.code, "unsupported_type");
  res = await bad([file("bin.txt", "text/plain", b64([0xff, 0xfe, 0x00, 0x01]))]);
  assert.equal(res.body.code, "type_mismatch");
  res = await bad(Array.from({ length: 4 }, (_, i) => file(`${i}.txt`, "text/plain", text("x"))));
  assert.equal(res.statusCode, 400);
  res = await bad([file("big.pdf", "application/pdf", b64(Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(3 * 1024 * 1024)])))]);
  assert.equal(res.statusCode, 413); assert.equal(res.body.code, "attachments_too_large");
  res = await bad([file("long.txt", "text/plain", text("a".repeat(60001)))]);
  assert.equal(res.statusCode, 413);
  res = await bad("not a list");
  assert.equal(res.statusCode, 400);
  assert.equal(providerCalls().length, 0);
});

test("validateAttachments cleans file names and promptWithTextFiles leaves plain prompts alone", () => {
  const [clean] = validateAttachments([file('a/b"c\\d.txt', "text/plain", text("hi"))]);
  assert.equal(clean.name, "a_b_c_d.txt");
  assert.equal(promptWithTextFiles("q", []), "q");
  assert.equal(promptWithTextFiles("q", validateAttachments([file("i.png", "image/png", PNG)])), "q");
  assert.deepEqual(validateAttachments(undefined), []);
});

test("neither device ids nor IP addresses are ever written to the store in the clear", async () => {
  await freeChat();
  const sent = calls.filter(c => c.url.includes("redis.example.com")).map(c => c.init.body).join(" ");
  assert.ok(sent.includes("fq:") && sent.includes("fip:"));
  assert.ok(!sent.includes(DEVICE), "raw device id leaked");
  assert.ok(!sent.includes("203.0.113.7"), "raw IP leaked");
  const keys = [...redis.keys()];
  assert.equal(keys.length, 2);
  assert.ok(keys.every(k => !k.includes(DEVICE) && !k.includes("203.0.113.7")));
  // the same id always lands on the same key, and a different secret gives different keys
  const before = keys.sort().join();
  redis = new Map(); await freeChat();
  assert.equal([...redis.keys()].sort().join(), before);
  redis = new Map(); process.env.QUOTA_SALT = "another-secret"; await freeChat();
  assert.notEqual([...redis.keys()].sort().join(), before);
});

test("the connection report shows whether the free allowance's store is connected, before paid-only access is on", async () => {
  delete process.env.POLAR_ORGANIZATION_ID; // paid-only access still off
  let res = await call({ method: "GET", query: { provider: "openai" } });
  assert.deepEqual(res.body.freeAllowance, { configured: true, reachable: true, limit: 10, provider: "deepseek", activeNow: false });

  process.env.POLAR_ORGANIZATION_ID = ORG;
  res = await call({ method: "GET", query: { provider: "openai" } });
  assert.equal(res.body.freeAllowance.activeNow, true);

  redisDown = true;
  res = await call({ method: "GET", query: { provider: "openai" } });
  assert.deepEqual([res.body.freeAllowance.configured, res.body.freeAllowance.reachable], [true, false]);

  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  res = await call({ method: "GET", query: { provider: "openai" } });
  assert.deepEqual([res.body.freeAllowance.configured, res.body.freeAllowance.reachable, res.body.freeAllowance.activeNow], [false, null, false]);
  assert.equal(JSON.stringify(res.body).includes("tok"), false, "the store token is never in the report");
});

test("Vercel's prefixed Redis variables are found, and the read-only token is never used", async () => {
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  Object.assign(process.env, {
    chat_assistant_db_KV_REST_API_URL: "https://redis.example.com",
    chat_assistant_db_KV_REST_API_TOKEN: "write-token",
    chat_assistant_db_KV_REST_API_READ_ONLY_TOKEN: "read-only-token",
    chat_assistant_db_KV_URL: "rediss://default:secret@redis.example.com:6379",
    chat_assistant_db_REDIS_URL: "rediss://default:secret@redis.example.com:6379"
  });
  const res = await freeChat();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const redisCalls = calls.filter(c => c.url.includes("redis.example.com"));
  assert.ok(redisCalls.length > 0);
  assert.ok(redisCalls.every(c => c.init.headers.Authorization === "Bearer write-token"), "must use the read-write token");
  const report = await call({ method: "GET", query: { provider: "openai" } });
  assert.deepEqual([report.body.freeAllowance.configured, report.body.freeAllowance.reachable], [true, true]);
  assert.ok(!JSON.stringify(report.body).includes("write-token") && !JSON.stringify(report.body).includes("secret@"), "no store credentials in the report");
});

test("plain names take priority over a prefixed pair, and a prefixed URL without its token is not enough", async () => {
  process.env.chat_assistant_db_KV_REST_API_URL = "https://other.example.com";
  process.env.chat_assistant_db_KV_REST_API_TOKEN = "other-token";
  await freeChat();
  assert.ok(calls.filter(c => c.url.includes("/pipeline")).every(c => c.url.startsWith("https://redis.example.com")), "the plain pair wins");

  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.chat_assistant_db_KV_REST_API_TOKEN;
  process.env.chat_assistant_db_KV_REST_API_READ_ONLY_TOKEN = "read-only-token";
  const res = await call({ method: "GET", query: { info: "1" } });
  assert.equal(res.body.freeQuota, false, "a URL with only a read-only token must not count as configured");
});
