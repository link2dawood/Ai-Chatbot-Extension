// Server-side checks for chat attachments. The browser's claims are not trusted:
// each file's real bytes must match its declared type, and the limits are
// enforced again here.

import { ALLOWED_TYPES, MAX_FILES, MAX_TEXT_CHARS, MAX_TOTAL_BYTES, isImage, isPdf, isText } from "../src/lib/attachments.js";

export class AttachmentError extends Error {
  constructor(message, { status = 400, code = "invalid_attachment" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const startsWith = (bytes, signature, offset = 0) => signature.every((b, i) => bytes[offset + i] === b);

// True when the bytes really look like the declared type.
function signatureMatches(mime, bytes) {
  switch (mime) {
    case "image/png": return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg": return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/gif": return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
    case "image/webp": return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case "application/pdf": return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    default: return true; // text types are checked by decoding them
  }
}

const cleanName = (name) => String(name || "file").replace(/[\u0000-\u001f"\\/]/g, "_").slice(0, 120) || "file";

// Returns [{ name, mime, kind: "image"|"pdf"|"text", data (base64), text? (for text files), bytes }]
export function validateAttachments(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new AttachmentError("attachments must be a list.");
  if (input.length > MAX_FILES) throw new AttachmentError(`You can attach up to ${MAX_FILES} files per message.`);

  let total = 0;
  let textChars = 0;
  return input.map((item) => {
    const name = cleanName(item?.name);
    const mime = typeof item?.mime === "string" ? item.mime : "";
    if (!ALLOWED_TYPES.includes(mime)) throw new AttachmentError(`"${name}" is not a supported file type.`, { code: "unsupported_type" });
    if (typeof item.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new AttachmentError(`"${name}" could not be read.`);

    const bytes = Buffer.from(item.data, "base64");
    total += bytes.length;
    if (!bytes.length) throw new AttachmentError(`"${name}" is empty.`);
    if (total > MAX_TOTAL_BYTES) throw new AttachmentError("The files are too large. Together they can be up to 3 MB.", { status: 413, code: "attachments_too_large" });
    if (!signatureMatches(mime, bytes)) throw new AttachmentError(`"${name}" is not a valid ${mime.split("/")[1].toUpperCase()} file.`, { code: "type_mismatch" });

    const kind = isImage(mime) ? "image" : isPdf(mime) ? "pdf" : "text";
    if (kind !== "text") return { name, mime, kind, data: item.data, bytes: bytes.length };

    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new AttachmentError(`"${name}" is not a text file.`, { code: "type_mismatch" }); }
    if (text.includes("\u0000")) throw new AttachmentError(`"${name}" is not a text file.`, { code: "type_mismatch" });
    textChars += text.length;
    if (textChars > MAX_TEXT_CHARS) throw new AttachmentError(`Text files can total up to ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters.`, { status: 413, code: "attachments_too_large" });
    return { name, mime, kind, data: item.data, text, bytes: bytes.length };
  });
}

// Text files are added to the prompt, so every provider can use them.
export function promptWithTextFiles(prompt, attachments) {
  const files = attachments.filter(a => a.kind === "text");
  if (!files.length) return prompt;
  const blocks = files.map(f => `Attached file "${f.name}":\n"""\n${f.text}\n"""`);
  return `${blocks.join("\n\n")}\n\n${prompt}`;
}
