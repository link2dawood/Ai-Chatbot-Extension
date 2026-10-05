// Chat attachments (images, PDFs and text files), a Premium feature.
//
// The limits live here so the extension and the server agree. Vercel rejects
// request bodies over 4.5 MB, and base64 adds a third, so the files together
// are capped at 3 MB.

export const MAX_FILES = 3;
export const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60000; // across all text files

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const PDF_TYPE = "application/pdf";
export const TEXT_TYPES = ["text/plain", "text/markdown", "text/csv", "application/json"];
export const ALLOWED_TYPES = [...IMAGE_TYPES, PDF_TYPE, ...TEXT_TYPES];

// What the file picker offers.
export const ACCEPT = [...ALLOWED_TYPES, ".txt", ".md", ".csv", ".json"].join(",");

export const isImage = (mime) => IMAGE_TYPES.includes(mime);
export const isPdf = (mime) => mime === PDF_TYPE;
export const isText = (mime) => TEXT_TYPES.includes(mime);
// Images and PDFs need a model that can read them; text is added to the prompt for every provider.
export const needsVision = (attachments) => (attachments || []).some(a => isImage(a.mime) || isPdf(a.mime));

// Browsers often leave the type empty for .md, .csv and .json files.
const BY_EXTENSION = { txt: "text/plain", md: "text/markdown", markdown: "text/markdown", csv: "text/csv", json: "application/json", pdf: PDF_TYPE, png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export function mimeOf(file) {
  if (ALLOWED_TYPES.includes(file.type)) return file.type;
  const ext = String(file.name || "").toLowerCase().split(".").pop();
  return BY_EXTENSION[ext] || file.type || "";
}

export function formatSize(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Checks a list of picked files against the limits. Returns an error message or null.
export function checkPicked(current, picked) {
  const all = [...current, ...picked];
  if (all.length > MAX_FILES) return `You can attach up to ${MAX_FILES} files per message.`;
  for (const file of picked) {
    if (!ALLOWED_TYPES.includes(mimeOf(file))) return `"${file.name}" is not supported. Attach images (PNG, JPEG, GIF, WebP), PDFs, or text, Markdown, CSV and JSON files.`;
  }
  const total = all.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_BYTES) return `Files can total up to ${formatSize(MAX_TOTAL_BYTES)} per message. These are ${formatSize(total)}.`;
  return null;
}

// Browser: File -> { name, mime, size, data (base64) }
export async function readAttachment(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: file.name, mime: mimeOf(file), size: file.size, data: btoa(binary) };
}
