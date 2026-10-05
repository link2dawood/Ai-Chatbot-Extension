// "My writing profile": how the user wants to sound. Stored only in this browser. When it is on,
// a short plain-text summary goes with Rewrite and Reply requests so the answer is in their voice.

export const PROFILE_CHOICES = {
  tone: ["", "Professional", "Professional but friendly", "Friendly", "Casual", "Warm", "Confident"],
  sentenceLength: ["", "Short", "Medium", "Long"],
  vocabulary: ["", "Simple", "Everyday", "Technical"],
  formality: ["", "Low", "Medium", "High"],
  personality: ["", "Direct", "Diplomatic", "Playful", "Reserved", "Enthusiastic"]
};
const LABELS = { tone: "Tone", sentenceLength: "Sentence length", vocabulary: "Vocabulary", formality: "Formality", personality: "Personality" };
const MAX_FREE = 400;
const MAX_LEARNED = 800;

export const EMPTY_PROFILE = Object.freeze({ enabled: false, tone: "", sentenceLength: "", vocabulary: "", formality: "", personality: "", avoid: "", learned: "" });

export function normalizeProfile(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const out = { ...EMPTY_PROFILE, enabled: p.enabled === true };
  for (const key of Object.keys(PROFILE_CHOICES)) out[key] = PROFILE_CHOICES[key].includes(p[key]) ? p[key] : "";
  out.avoid = typeof p.avoid === "string" ? p.avoid.trim().slice(0, MAX_FREE) : "";
  out.learned = typeof p.learned === "string" ? p.learned.trim().slice(0, MAX_LEARNED) : "";
  return out;
}

// The text sent with a request, or "" when the profile is off or empty.
export function profileText(profile) {
  const p = normalizeProfile(profile);
  if (!p.enabled) return "";
  const lines = Object.keys(PROFILE_CHOICES).filter(key => p[key]).map(key => `${LABELS[key]}: ${p[key]}`);
  if (p.avoid) lines.push(`Avoid: ${p.avoid.replace(/\s*\n\s*/g, "; ")}`);
  if (p.learned) lines.push(`Writing characteristics:\n${p.learned}`);
  return lines.join("\n");
}
