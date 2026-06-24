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
