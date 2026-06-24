// Vercel Serverless Function — POST /api/chat
//
// The browser extension sends { prompt }. This function forwards it to the
// Vercel AI Gateway using an API key read from an environment variable, then
// returns { text }. The key never leaves the server, so it is never exposed
// in the extension bundle.
//
// Required environment variable (set in Vercel → Project → Settings →
// Environment Variables, or `vercel env add`):
//   AI_GATEWAY_API_KEY   your Vercel AI Gateway key
// Optional:
//   AI_MODEL             model id (default: "openai/gpt-4o-mini")

module.exports = async (req, res) => {
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

    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) {
        console.error("Missing AI_GATEWAY_API_KEY environment variable");
        return res.status(500).json({ error: "Server is not configured with an API key" });
    }

    const prompt = req.body && req.body.prompt;
    if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Missing 'prompt' in request body" });
    }

    const model = process.env.AI_MODEL || "openai/gpt-4o-mini";

    try {
        const upstream = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: prompt }]
            })
        });

        if (!upstream.ok) {
            const detail = await upstream.text();
            console.error("AI Gateway error:", upstream.status, detail);
            return res.status(502).json({ error: "AI provider returned an error" });
        }

        const data = await upstream.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (!text) {
            return res.status(502).json({ error: "Empty response from AI provider" });
        }

        return res.status(200).json({ text });
    } catch (err) {
        console.error("Proxy error:", err);
        return res.status(502).json({ error: "AI service unavailable" });
    }
};
