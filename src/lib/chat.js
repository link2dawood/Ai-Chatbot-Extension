// Pure helpers for the chat request/response cycle. Kept free of DOM and
// browser APIs so they can be unit-tested with Node's built-in test runner.

// Conversation modes — each maps to a system instruction sent to the API.
export const MODES = {
    chat: "",
    writing: "You are a writing assistant. Improve the clarity, flow, grammar, and tone of the user's text while preserving its meaning. Return only the improved text.",
    grammar: "You are a grammar and spelling corrector. Fix grammar, spelling, and punctuation in the user's text. Return only the corrected text, with no commentary.",
    summarize: "Summarize the following text clearly and concisely, capturing the key points.",
    explain: "Explain the following clearly and simply, as if to a curious beginner."
};

// Build the JSON body the extension POSTs to the Vercel function.
export function buildRequestBody(prompt, system) {
    return { prompt: prompt, system: system || "" };
}

// Extract the reply text from the API response, or throw if it is missing.
// Never returns an empty/whitespace string — callers can rely on a usable value.
export function parseChatResponse(data) {
    const text = data && typeof data.text === "string" ? data.text.trim() : "";
    if (!text) {
        throw new Error("Empty response from AI service.");
    }
    return text;
}

// Rough heuristic when the API does not return usage (~4 chars/token).
export function estimateTokens(text) {
    return Math.ceil((text || "").length / 4);
}

// Prefer real usage from the API; fall back to an estimate of in + out text.
export function tokensFromResponse(data, inputText, outputText) {
    if (data && data.usage && Number.isFinite(data.usage.total_tokens)) {
        return data.usage.total_tokens;
    }
    return estimateTokens(inputText) + estimateTokens(outputText);
}

// --- Rate limiting (v0 /v1/rate-limits) --------------------------------------
// The /v1/rate-limits endpoint returns, e.g.:
//   { remaining, limit, reset, dailyLimit: { remaining, limit, reset, isWithinGracePeriod } }

// True when either the overall or the daily allowance is exhausted.
export function isRateLimited(rate) {
    if (!rate || typeof rate !== "object") return false;
    const overall = Number.isFinite(rate.remaining) ? rate.remaining : Infinity;
    const daily = rate.dailyLimit && Number.isFinite(rate.dailyLimit.remaining)
        ? rate.dailyLimit.remaining
        : Infinity;
    return overall <= 0 || daily <= 0;
}

// Normalize the rate-limit payload into a small, stable shape for clients.
export function summarizeRateLimit(rate) {
    if (!rate || typeof rate !== "object") return null;
    const daily = rate.dailyLimit || {};
    return {
        remaining: rate.remaining,
        limit: rate.limit,
        dailyRemaining: daily.remaining,
        dailyLimit: daily.limit,
        reset: daily.reset != null ? daily.reset : (rate.reset != null ? rate.reset : null)
    };
}
