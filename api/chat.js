// Vercel Serverless Function — POST /api/chat
//
// The browser extension sends { prompt, system }. This function forwards it to
// the v0 Model API (OpenAI-compatible chat completions) using an API key read
// from an environment variable, then returns { text, usage }. The key never
// leaves the server, so it is never exposed in the extension bundle.
//
// Required environment variable (set in Vercel → Project → Settings →
// Environment Variables, or `vercel env add`):
//   V0_API_KEY   your v0 API key (from v0.app → Settings → API Keys)
// Optional:
//   AI_MODEL     model id (default: "v0-1.5-md"; also "v0-1.5-lg")
//
// Note: the v0 API requires a Premium or Team plan with usage-based billing
// enabled. Without it, v0 returns 404 for every request.

const V0_API_URL = "https://api.v0.dev/v1/chat/completions";

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

    // Optional system instruction, set by the extension's conversation modes.
    const system = req.body && typeof req.body.system === "string" ? req.body.system.trim() : "";

    const messages = [];
    if (system) {
        messages.push({ role: "system", content: system });
    }
    messages.push({ role: "user", content: prompt });

    const model = process.env.AI_MODEL || "v0-1.5-md";

    try {
        const upstream = await fetch(V0_API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ model, messages })
        });

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

        // Return token usage so the extension can show API consumption.
        return res.status(200).json({ text, usage: data.usage || null });
    } catch (err) {
        console.error("Proxy error:", err);
        return res.status(502).json({ error: "AI service unavailable" });
    }
}
