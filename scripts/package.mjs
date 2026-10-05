// Builds the Chrome Web Store upload: dist/smart-chat-assistant-v<version>.zip
//
//   npm run package
//
// The zip holds only the extension (manifest.json, background.js, public/,
// src/, assets/), never the Vercel backend (api/, server/), node_modules,
// tests or docs. Before writing it, the script runs the checks that most often
// get a store submission rejected: unapproved permissions, hosts that don't
// match the backend, remote code, and files the manifest points to that are
// missing. If any check fails, no zip is written.
//
// No dependencies: the ZIP is written with Node's built-in zlib.

import { deflateRawSync } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Keep in step with the permission justifications entered in the Chrome Web
// Store dashboard (Privacy tab). Adding a permission here without writing a
// justification, or leaving an unused one in the manifest, risks rejection.
export const ALLOWED_PERMISSIONS = ["sidePanel", "storage", "activeTab", "scripting"];

// Hosts the extension may ask the user for at runtime, only when they add their
// own API key for that provider (see src/lib/byok.js). Keep in step with the
// "optional host permissions" justification in the store dashboard.
export const ALLOWED_OPTIONAL_HOSTS = ["https://api.openai.com/*", "https://api.deepseek.com/*", "https://api.anthropic.com/*"];

const INCLUDE = ["manifest.json", "background.js", "public", "src", "assets"];
const EXCLUDE = [/^assets\/screenshot-/, /^assets\/icon-512\.png$/, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/];
const MAX_BYTES = 10 * 1024 * 1024;

// ---------- file collection ----------

function walk(root, rel) {
  const full = join(root, rel);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  if (statSync(full).isFile()) return [rel.split(sep).join("/")];
  return readdirSync(full).sort().flatMap(name => walk(root, join(rel, name)));
}

export function collectFiles(root) {
  return INCLUDE.flatMap(entry => walk(root, entry)).filter(file => !EXCLUDE.some(re => re.test(file)));
}

// ---------- checks ----------

export function validate(root, files) {
  const errors = [];
  const fail = (message) => errors.push(message);
  const set = new Set(files);
  const read = (file) => readFileSync(join(root, file), "utf8");

  let manifest;
  try {
    manifest = JSON.parse(read("manifest.json"));
  } catch (error) {
    return { errors: [`manifest.json is missing or not valid JSON: ${error.message}`], manifest: null };
  }

  if (manifest.manifest_version !== 3) fail("manifest_version must be 3.");

  // Version must agree with package.json so the zip name is trustworthy.
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (pkg.version !== manifest.version) fail(`package.json version (${pkg.version}) and manifest.json version (${manifest.version}) differ.`);
  } catch { /* package.json is optional for the check */ }

  for (const permission of manifest.permissions || []) {
    if (!ALLOWED_PERMISSIONS.includes(permission)) {
      fail(`Permission "${permission}" is not approved. Remove it, or add it to ALLOWED_PERMISSIONS in scripts/package.mjs and write its justification in the store dashboard.`);
    }
  }
  for (const permission of manifest.optional_permissions || []) fail(`optional_permissions "${permission}": declare optional permissions deliberately; none are approved.`);
  for (const host of manifest.optional_host_permissions || []) {
    if (!ALLOWED_OPTIONAL_HOSTS.includes(host)) fail(`optional_host_permissions "${host}" is not approved. Remove it, or add it to ALLOWED_OPTIONAL_HOSTS in scripts/package.mjs and update the store justification.`);
  }
  if (manifest.content_scripts?.length) fail("content_scripts are not used by this extension and add host-permission review. Remove them.");

  // Hosts: exactly the backend the code calls.
  let apiHost = null;
  try {
    const apiSource = read("src/lib/api.js");
    const endpoint = apiSource.match(/API_ENDPOINT\s*=\s*"([^"]+)"/)?.[1];
    apiHost = endpoint ? new URL(endpoint).host : null;
  } catch { /* reported below */ }
  if (!apiHost) fail("Could not read API_ENDPOINT from src/lib/api.js.");
  const hosts = manifest.host_permissions || [];
  if (apiHost) {
    const expected = `https://${apiHost}/*`;
    if (hosts.length !== 1 || hosts[0] !== expected) fail(`host_permissions must be exactly ["${expected}"] (the backend in src/lib/api.js). Found ${JSON.stringify(hosts)}.`);
  }

  // Files the manifest points to must be in the package.
  const referenced = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {})
  ].filter(Boolean);
  for (const file of referenced) if (!set.has(file)) fail(`manifest.json refers to "${file}", which is not in the package.`);

  // HTML pages: local resources only, and every one must exist.
  for (const page of files.filter(file => file.endsWith(".html"))) {
    const html = read(page);
    for (const match of html.matchAll(/<(script|link|img)\b[^>]*?\b(src|href)\s*=\s*["']([^"']+)["']/gi)) {
      const [, tag, , url] = match;
      if (/^(https?:)?\/\//i.test(url)) {
        fail(`${page}: <${tag}> loads "${url}" from the network. Remote code and assets are not allowed; bundle it.`);
      } else if (!/^(data:|#)/.test(url)) {
        const target = posix.normalize(posix.join(posix.dirname(page), url.split(/[?#]/)[0]));
        if (!set.has(target)) fail(`${page}: <${tag}> refers to "${url}", which is not in the package.`);
      }
    }
    if (/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html)) fail(`${page}: inline <script> is blocked by the extension's content security policy.`);
  }

  // JavaScript: no eval-style code and no imports from the network.
  for (const file of files.filter(f => f.endsWith(".js"))) {
    const code = read(file);
    if (/\beval\s*\(/.test(code)) fail(`${file}: uses eval().`);
    if (/\bnew\s+Function\s*\(/.test(code)) fail(`${file}: uses new Function().`);
    if (/(?:import\s*\(|from\s+|import\s+)["']https?:\/\//.test(code)) fail(`${file}: imports a script from the network.`);
  }

  return { errors, manifest };
}

// ---------- minimal ZIP writer ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed timestamp (2020-01-01 00:00) so the same sources always give the same zip.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------- build ----------

export function buildPackage({ root, outDir = join(root, "dist") } = {}) {
  const files = collectFiles(root);
  const { errors, manifest } = validate(root, files);
  if (errors.length) return { ok: false, errors };

  const zip = buildZip(files.map(name => ({ name, data: readFileSync(join(root, name)) })));
  if (zip.length > MAX_BYTES) return { ok: false, errors: [`The zip is ${(zip.length / 1048576).toFixed(1)} MB, over the ${MAX_BYTES / 1048576} MB limit.`] };

  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `smart-chat-assistant-v${manifest.version}.zip`);
  writeFileSync(outFile, zip);
  return { ok: true, outFile, files, bytes: zip.length, manifest };
}

// ---------- CLI ----------

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = buildPackage({ root });
  if (!result.ok) {
    console.error("\nNot packaged. Fix these first:\n");
    for (const error of result.errors) console.error(`  x ${error}`);
    console.error("");
    process.exit(1);
  }
  console.log(`\nPackaged ${result.manifest.name} v${result.manifest.version}`);
  console.log(`  ${relative(root, result.outFile)}  (${(result.bytes / 1024).toFixed(1)} KB, ${result.files.length} files)`);
  console.log(`  permissions: ${(result.manifest.permissions || []).join(", ") || "none"}`);
  console.log(`  hosts:       ${(result.manifest.host_permissions || []).join(", ") || "none"}\n`);
  for (const file of result.files) console.log(`  ${file}`);
  console.log("\nUpload this zip in the Chrome Web Store dashboard -> Package.\n");
}
