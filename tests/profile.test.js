import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PROFILE, normalizeProfile, profileText } from "../src/lib/profile.js";
import { REPLY_INTENTS, intentInstruction, styleInstruction } from "../server/intents.js";

test("profile: off or empty sends nothing; on sends a short plain-text summary", () => {
  assert.equal(profileText(undefined), "");
  assert.equal(profileText({ ...EMPTY_PROFILE, tone: "Friendly" }), "", "off means nothing is sent");
  const text = profileText({ enabled: true, tone: "Professional but friendly", sentenceLength: "Short", avoid: "Corporate buzzwords\nHope you're doing well", learned: "- Uses contractions" });
  assert.equal(text, "Tone: Professional but friendly\nSentence length: Short\nAvoid: Corporate buzzwords; Hope you're doing well\nWriting characteristics:\n- Uses contractions");
});

test("profile: unknown choices and wrong types are dropped, long text is cut", () => {
  const p = normalizeProfile({ enabled: "yes", tone: "Evil", formality: "High", avoid: "x".repeat(900), learned: 5 });
  assert.equal(p.enabled, false);
  assert.equal(p.tone, "");
  assert.equal(p.formality, "High");
  assert.equal(p.avoid.length, 400);
  assert.equal(p.learned, "");
  assert.deepEqual(normalizeProfile(null), EMPTY_PROFILE);
});

test("server: reply options and the style instruction", () => {
  assert.match(intentInstruction("close", "reply"), /wraps up the conversation/);
  assert.match(intentInstruction("close", "rewrite"), /the user's own words/, "a reply id is not a rewrite intent");
  assert.equal(REPLY_INTENTS.length, 4);
  assert.equal(styleInstruction(""), "");
  const s = styleInstruction("Tone: Direct\n" + "y".repeat(5000));
  assert.match(s, /style preferences only/);
  assert.ok(s.length < 1500);
});
