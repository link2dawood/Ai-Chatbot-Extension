// Vercel Serverless Function — POST /api/chat
//
// The browser extension sends { prompt, system }. This function forwards it to
// the v0 Model API (OpenAI-compatible chat completions) using an API key read
// from an environment variable, then returns { text, usage, rateLimit }. The
// key never leaves the server, so it is never exposed in the extension bundle.
//
// Required environment variable (set in Vercel → Project → Settings →
// Environment Variables, or `vercel env add`):
//   V0_API_KEY   your v0 API key (from v0.app → Settings → API Keys)
// Optional:
//   AI_MODEL     model id (default: "v0-1.5-md"; also "v0-1.5-lg")
//
// Note: the v0 API requires a Premium/Team plan with usage-based billing
// enabled. Without it, v0 returns 404 for the completions endpoint.

import { isRateLimited, summarizeRateLimit } from "../src/lib/chat.js";

const V0_API_BASE = "https://api.v0.dev/v1";
const V0_CHAT_URL = `${V0_API_BASE}/chat/completions`;
const V0_RATELIMIT_URL = `${V0_API_BASE}/rate-limits`;

// v0's models are tuned for UI/code generation. Force plain prose so the
// extension behaves like a writing assistant, not an app generator.
const BASE_SYSTEM =
    "You are a helpful writing assistant. Always reply in plain, conversational text. " +
    "Do not generate code, code blocks, components, apps, or UI unless the user explicitly asks for code.";

export default async function handler(req, res) {
    // CORS — allow the browser extension to call this endpoint.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.V0_API_KEY;
    if (!apiKey) {
        console.error("Missing V0_API_KEY environment variable");
        return res.status(500).json({ error: "Server is not configured with an API key" });
    }

    const prompt = req.body && req.body.prompt;
    if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Missing 'prompt' in request body" });
    }

    // Mode instruction from the extension, combined with the plain-text base.
    const modeSystem = req.body && typeof req.body.system === "string" ? req.body.system.trim() : "";
    const system = [BASE_SYSTEM, modeSystem].filter(Boolean).join("\n\n");

    const messages = [
        { role: "system", content: system },
        { role: "user", content: prompt }
    ];

    const model = process.env.AI_MODEL || "v0-1.5-md";

    // Rate limiting — check v0's /v1/rate-limits before spending a request.
    // If the check itself fails, don't block the user; just proceed.
    let rate = null;
    try {
        const rl = await fetch(V0_RATELIMIT_URL, {
            headers: { "Authorization": `Bearer ${apiKey}` }
        });
        if (rl.ok) {
            rate = await rl.json();
        }
    } catch (err) {
        console.error("Rate-limit check failed:", err);
    }

    if (isRateLimited(rate)) {
        const summary = summarizeRateLimit(rate);
        if (summary && summary.reset) {
            const secs = Math.max(1, Math.ceil((summary.reset - Date.now()) / 1000));
            res.setHeader("Retry-After", String(secs));
        }
        return res.status(429).json({
            error: "Rate limit reached. Please try again later.",
            rateLimit: summary
        });
    }

    try {
        const upstream = await fetch(V0_CHAT_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ model, messages })
        });

        // Surface upstream rate limiting as a 429 too.
        if (upstream.status === 429) {
            return res.status(429).json({
                error: "Rate limit reached. Please try again later.",
                rateLimit: summarizeRateLimit(rate)
            });
        }

        if (!upstream.ok) {
            const detail = await upstream.text();
            console.error("v0 API error:", upstream.status, detail);
            return res.status(502).json({ error: "AI provider returned an error" });
        }

        const data = await upstream.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (!text) {
            return res.status(502).json({ error: "Empty response from AI provider" });
        }

        // Return token usage and remaining rate limit so the extension can show them.
        return res.status(200).json({
            text,
            usage: data.usage || null,
            rateLimit: summarizeRateLimit(rate)
        });
    } catch (err) {
        console.error("Proxy error:", err);
        return res.status(502).json({ error: "AI service unavailable" });
    }
}
