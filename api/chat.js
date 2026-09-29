const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Client-Id");
  res.setHeader("Cache-Control", "no-store");
}

function send(res, status, body) {
  cors(res);
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return send(res, 503, {
      ok: false,
      vercel: true,
      openai: false,
      error: "OPENAI_API_KEY is not configured on Vercel."
    });
  }

  if (req.method === "GET") {
    try {
      const upstream = await fetch(OPENAI_MODELS_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        console.error("[Smart Chat API] OpenAI health check failed", {
          status: upstream.status,
          statusText: upstream.statusText,
          code: data?.error?.code || data?.error?.type || null,
          message: data?.error?.message || null
        });
      }
      return send(res, upstream.ok ? 200 : upstream.status, {
        ok: upstream.ok,
        vercel: true,
        openai: upstream.ok,
        model: MODEL,
        upstreamStatus: upstream.status,
        upstreamCode: data?.error?.code || null,
        error: upstream.ok ? null : (data?.error?.message || `OpenAI health check failed (${upstream.status}).`)
      });
    } catch (error) {
      console.error("[Smart Chat API] OpenAI health check network error", {
        name: error?.name,
        message: error?.message
      });
      return send(res, 502, {
        ok: false,
        vercel: true,
        openai: false,
        error: "Vercel is running, but OpenAI could not be reached."
      });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return send(res, 405, { ok: false, error: "Method not allowed." });
  }

  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const system = typeof req.body?.system === "string" ? req.body.system.trim() : "";
  if (!prompt) return send(res, 400, { ok: false, error: "Prompt is required." });
  if (prompt.length > 6000) return send(res, 413, { ok: false, error: "Prompt is too long." });

  try {
    const upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: system || "Be concise, practical, and natural.",
        input: prompt,
        max_output_tokens: 1200
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const retryAfter = upstream.headers.get("retry-after");
      console.error("[Smart Chat API] OpenAI request failed", {
        status: upstream.status,
        statusText: upstream.statusText,
        code: data?.error?.code || data?.error?.type || null,
        message: data?.error?.message || null,
        retryAfter
      });
      if (retryAfter) res.setHeader("Retry-After", retryAfter);
      return send(res, upstream.status, {
        ok: false,
        provider: "openai",
        upstreamStatus: upstream.status,
        upstreamCode: data?.error?.code || data?.error?.type || null,
        error: data?.error?.message || `OpenAI request failed (${upstream.status}).`
      });
    }

    const text = data.output_text || data.output?.flatMap(item => item.content || [])
      .find(part => part.type === "output_text")?.text || "";

    if (!text.trim()) return send(res, 502, { ok: false, error: "OpenAI returned an empty response." });

    return send(res, 200, {
      ok: true,
      text: text.trim(),
      usage: data.usage || null,
      model: data.model || MODEL
    });
  } catch (error) {
    console.error("[Smart Chat API] OpenAI network/request exception", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    });
    return send(res, 502, { ok: false, error: "Unable to reach OpenAI." });
  }
}
