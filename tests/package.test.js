import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { buildPackage, collectFiles } from "../scripts/package.mjs";

const REPO = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// A throwaway copy of the extension files, so tests can break things safely.
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "pkg-"));
  for (const entry of ["manifest.json", "background.js", "package.json", "public", "src", "assets"]) cpSync(join(REPO, entry), join(root, entry), { recursive: true });
  return root;
}

function editManifest(root, change) {
  const path = join(root, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  change(manifest);
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

// Reads the zip's central directory without any zip library.
function readZip(file) {
  const buf = readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    entries[name] = method === 8 ? inflateRawSync(raw) : raw;
    p += 46 + nameLen;
  }
  return entries;
}

test("the real extension packages cleanly and contains only extension files", () => {
  const root = sandbox();
  const result = buildPackage({ root });
  assert.equal(result.ok, true, result.errors?.join("\n"));
  const entries = readZip(result.outFile);
  const names = Object.keys(entries);
  assert.ok(names.includes("manifest.json") && names.includes("background.js") && names.includes("public/sidebar.html"));
  assert.ok(names.includes("src/lib/prompts.js"));
  for (const name of names) assert.ok(!/^(api|server|node_modules|tests|docs|examples|scripts|dist)\//.test(name), name);
  assert.ok(!names.some(name => /screenshot|icon-512/.test(name)), "store-only artwork stays out of the package");
  assert.equal(JSON.parse(entries["manifest.json"]).version, JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
  assert.match(result.outFile, /smart-chat-assistant-v\d+\.\d+\.\d+\.zip$/);
  rmSync(root, { recursive: true, force: true });
});

test("zip contents are byte-for-byte the source files and the output is reproducible", () => {
  const root = sandbox();
  const first = buildPackage({ root });
  const bytes = readFileSync(first.outFile);
  const entries = readZip(first.outFile);
  for (const name of collectFiles(root)) assert.deepEqual(entries[name], readFileSync(join(root, name)), name);
  const second = buildPackage({ root });
  assert.deepEqual(readFileSync(second.outFile), bytes);
  rmSync(root, { recursive: true, force: true });
});

test("an unapproved permission blocks packaging and writes nothing", () => {
  const root = sandbox();
  editManifest(root, m => { m.permissions.push("contextMenus"); });
  const result = buildPackage({ root });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /"contextMenus" is not approved/);
  assert.equal(existsSync(join(root, "dist")), false);
  rmSync(root, { recursive: true, force: true });
});

test("a host that is not the backend blocks packaging", () => {
  const root = sandbox();
  editManifest(root, m => { m.host_permissions.push("https://generativelanguage.googleapis.com/*"); });
  const result = buildPackage({ root });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /host_permissions must be exactly/);
  rmSync(root, { recursive: true, force: true });
});

test("remote scripts, eval and missing files are caught", () => {
  const root = sandbox();
  const html = join(root, "public/sidebar.html");
  writeFileSync(html, readFileSync(html, "utf8").replace("</body>", '<script src="https://cdn.example.com/x.js"></script><script src="../src/missing.js"></script></body>'));
  writeFileSync(join(root, "src/lib/bad.js"), "export const f = (s) => eval(s);\n");
  editManifest(root, m => { m.background.service_worker = "gone.js"; });
  const result = buildPackage({ root });
  assert.equal(result.ok, false);
  const text = result.errors.join("\n");
  assert.match(text, /loads "https:\/\/cdn\.example\.com\/x\.js" from the network/);
  assert.match(text, /"\.\.\/src\/missing\.js", which is not in the package/);
  assert.match(text, /uses eval\(\)/);
  assert.match(text, /"gone\.js", which is not in the package/);
  rmSync(root, { recursive: true, force: true });
});

test("a manifest and package.json version mismatch is caught", () => {
  const root = sandbox();
  editManifest(root, m => { m.version = "9.9.9"; });
  const result = buildPackage({ root });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /versions? .*differ|differ/);
  rmSync(root, { recursive: true, force: true });
});
