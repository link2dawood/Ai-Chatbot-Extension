import { renderMarkdown, escapeHtml } from "../lib/markdown.js";
import { MODES, buildRequestBody, parseChatResponse, tokensFromResponse, quotaStatus, formatReset } from "../lib/chat.js";

document.addEventListener("DOMContentLoaded", function () {
    const chatBox = document.getElementById("chatBox");
    const inputText = document.getElementById("inputText");
    const sendBtn = document.getElementById("sendBtn");
    const copyBtn = document.getElementById("copyBtn");
    const injectBtn = document.getElementById("injectBtn");
    const themeToggle = document.getElementById("themeToggle");
    const charCounter = document.getElementById("charCounter");
    const tokenCounter = document.getElementById("tokenCounter");
    const modeSelect = document.getElementById("modeSelect");
    const clearBtn = document.getElementById("clearBtn");
    const exportBtn = document.getElementById("exportBtn");
    const exportMenu = document.getElementById("exportMenu");
    const quotaBar = document.getElementById("quotaBar");
    const quotaFill = document.getElementById("quotaFill");
    const quotaText = document.getElementById("quotaText");
    const quotaModal = document.getElementById("quotaModal");
    const quotaModalText = document.getElementById("quotaModalText");
    const quotaModalClose = document.getElementById("quotaModalClose");

    // ---------------------------------------------------------------------
    // Configuration — the extension works out of the box, no user setup.
    // The AI provider key lives in a Vercel environment variable (server-side),
    // so end users never need an API key of their own.
    //
    // Set this to your deployed Vercel function URL once, before publishing.
    const API_ENDPOINT = "https://ai-chatbot-extension.vercel.app/api/chat";
    const MAX_CHARS = 2000;
    // ---------------------------------------------------------------------

    const MOON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    const SUN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

    // Running token total for this session (persisted so it accumulates).
    let sessionTokens = parseInt(localStorage.getItem("tokenTotal") || "0", 10) || 0;

    // Last request, so the Retry button can re-run it after a failure.
    let lastRequest = null;

    // Guards against sending another request while one is in flight.
    let isLoading = false;

    // Latest known v0 quota (summarized rateLimit) — drives the bar + enforcement.
    let currentQuota = null;

    // Restore selected mode.
    modeSelect.value = localStorage.getItem("mode") || "chat";
    modeSelect.addEventListener("change", function () {
        localStorage.setItem("mode", modeSelect.value);
    });

    // Load previous chat messages, then render counters.
    loadChatHistory();
    updateCharCounter();
    updateTokenCounter();

    // Quota: show cached value immediately, then refresh from the server.
    try {
        const cachedQuota = JSON.parse(localStorage.getItem("quota") || "null");
        if (cachedQuota) { currentQuota = cachedQuota; renderQuota(); }
    } catch (e) { /* ignore */ }
    fetchQuota();

    quotaModalClose.addEventListener("click", function () {
        quotaModal.classList.add("hidden");
    });

    // Dark mode (persisted) — swaps the moon/sun SVG.
    if (localStorage.getItem("darkMode") === "true") {
        document.body.classList.add("dark-mode");
    }
    applyThemeIcon();

    themeToggle.addEventListener("click", function () {
        document.body.classList.toggle("dark-mode");
        localStorage.setItem("darkMode", document.body.classList.contains("dark-mode"));
        applyThemeIcon();
    });

    function applyThemeIcon() {
        themeToggle.innerHTML = document.body.classList.contains("dark-mode") ? SUN_SVG : MOON_SVG;
    }

    // Live character counter + limit enforcement
    inputText.addEventListener("input", updateCharCounter);

    // Enter sends; Shift+Enter inserts a newline.
    inputText.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    function updateCharCounter() {
        const len = inputText.value.length;
        charCounter.textContent = `${len} / ${MAX_CHARS}`;
        const over = len > MAX_CHARS;
        charCounter.classList.toggle("over", over);
        sendBtn.disabled = over || len === 0;
    }

    function updateTokenCounter() {
        tokenCounter.textContent = `~${sessionTokens.toLocaleString()} tokens`;
    }

    function addTokens(n) {
        if (Number.isFinite(n) && n > 0) {
            sessionTokens += Math.round(n);
            localStorage.setItem("tokenTotal", String(sessionTokens));
            updateTokenCounter();
        }
    }

    // --- Quota (v0 real rate limit) ---------------------------------------
    function setQuota(summary) {
        currentQuota = summary || null;
        if (currentQuota) {
            localStorage.setItem("quota", JSON.stringify(currentQuota));
        }
        renderQuota();
    }

    function renderQuota() {
        const status = quotaStatus(currentQuota);
        if (status.level === "unknown") {
            quotaBar.classList.add("hidden");
            return;
        }
        quotaBar.classList.remove("hidden");
        quotaFill.style.width = `${status.percent}%`;
        quotaFill.classList.remove("green", "yellow", "red");
        quotaFill.classList.add(status.level);
        const reset = currentQuota && currentQuota.reset ? formatReset(currentQuota.reset, Date.now()) : "";
        quotaText.textContent = `${status.used}/${status.total} today${reset ? " · " + reset : ""}`;
    }

    async function fetchQuota() {
        // Best-effort: a GET returns only the current rate-limit/quota status.
        try {
            const res = await fetch(API_ENDPOINT, { method: "GET" });
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.rateLimit) setQuota(data.rateLimit);
        } catch (e) {
            /* quota display is non-critical */
        }
    }

    function showQuotaModal() {
        const reset = currentQuota && currentQuota.reset ? formatReset(currentQuota.reset, Date.now()) : "";
        quotaModalText.textContent = reset
            ? `You've used your daily request limit. It ${reset}.`
            : "You've used your daily request limit. Please try again later.";
        quotaModal.classList.remove("hidden");
    }

    // Shared by the send button and the Enter key.
    function sendMessage() {
        if (isLoading) return;

        const userInput = inputText.value.trim();
        if (!userInput) return;

        // Block when the v0 daily allowance is exhausted.
        if (quotaStatus(currentQuota).exhausted) {
            showQuotaModal();
            return;
        }

        if (userInput.length > MAX_CHARS) {
            alert(`Your message is ${userInput.length} characters, but the limit is ${MAX_CHARS}. Please shorten it.`);
            return;
        }

        addMessage(userInput, "user");
        inputText.value = "";
        updateCharCounter();

        generateResponse(userInput, MODES[modeSelect.value] || "");
    }

    sendBtn.addEventListener("click", sendMessage);

    // Copy last AI response (raw text)
    copyBtn.addEventListener("click", function () {
        const bubbles = chatBox.querySelectorAll(".ai-message:not(.error-message) .bubble");
        if (bubbles.length === 0) {
            alert("No text to copy!");
            return;
        }

        const last = bubbles[bubbles.length - 1];
        const lastResponse = last.dataset.raw || last.innerText;
        navigator.clipboard.writeText(lastResponse)
            .then(() => alert("Copied!"))
            .catch(err => console.error("Failed to copy:", err));
    });

    // Inject last AI response into active input field (raw text)
    injectBtn.addEventListener("click", function () {
        const bubbles = chatBox.querySelectorAll(".ai-message:not(.error-message) .bubble");
        if (bubbles.length === 0) {
            alert("No text to inject!");
            return;
        }

        const last = bubbles[bubbles.length - 1];
        const lastResponse = last.dataset.raw || last.innerText;
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                function: insertText,
                args: [lastResponse]
            });
        });
    });

    // Clear conversation
    clearBtn.addEventListener("click", function () {
        if (chatBox.children.length === 0) return;
        if (!confirm("Clear the entire conversation and reset the token counter?")) return;
        chatBox.innerHTML = "";
        localStorage.removeItem("chatHistory");
        sessionTokens = 0;
        localStorage.setItem("tokenTotal", "0");
        updateTokenCounter();
    });

    // Export menu (Text / Markdown / PDF)
    exportBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        exportMenu.classList.toggle("hidden");
    });

    exportMenu.addEventListener("click", function (e) {
        const btn = e.target.closest("button[data-format]");
        if (!btn) return;
        exportMenu.classList.add("hidden");

        const saved = JSON.parse(localStorage.getItem("chatHistory") || "[]");
        if (saved.length === 0) {
            alert("No conversation to export.");
            return;
        }

        const format = btn.dataset.format;
        if (format === "txt") {
            downloadFile("conversation.txt", buildText(saved), "text/plain");
        } else if (format === "md") {
            downloadFile("conversation.md", buildMarkdown(saved), "text/markdown");
        } else if (format === "pdf") {
            exportPdf(saved);
        }
    });

    // Close the export menu when clicking elsewhere.
    document.addEventListener("click", function () {
        exportMenu.classList.add("hidden");
    });

    function buildText(saved) {
        return saved.map(m => `${m.sender === "user" ? "You" : "AI"}: ${m.text}`).join("\n\n");
    }

    function buildMarkdown(saved) {
        let md = "# AI Writing Assistant — Conversation\n\n";
        saved.forEach(function (m) {
            md += (m.sender === "user" ? "**You:**\n\n" : "**AI:**\n\n") + m.text + "\n\n---\n\n";
        });
        return md;
    }

    function downloadFile(filename, content, mime) {
        const url = URL.createObjectURL(new Blob([content], { type: mime }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Print-to-PDF: open a clean printable page and trigger the print dialog.
    // CSP-safe — print() is called from this window, not via an inline script.
    function exportPdf(saved) {
        const body = saved.map(m =>
            `<div class="role">${m.sender === "user" ? "You" : "AI"}</div>` +
            `<div class="msg">${escapeHtml(m.text)}</div>`
        ).join("");
        const html = '<!doctype html><html><head><meta charset="utf-8"><title>Conversation</title>' +
            '<style>body{font-family:Arial,Helvetica,sans-serif;padding:32px;line-height:1.5;color:#222}' +
            'h1{font-size:20px}.role{font-weight:bold;margin-top:16px}.msg{white-space:pre-wrap;margin:4px 0 12px}</style>' +
            '</head><body><h1>AI Writing Assistant — Conversation</h1>' + body + '</body></html>';
        const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        const win = window.open(url, "_blank");
        if (win) {
            win.addEventListener("load", function () { win.focus(); win.print(); });
        }
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    }

    // Function to insert text into the active tab
    function insertText(text) {
        let activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === "TEXTAREA" || activeElement.tagName === "INPUT")) {
            activeElement.value += text;
            activeElement.focus();
        } else {
            alert("No active text field found.");
        }
    }

    // Add a message to the chat. AI messages render Markdown; the raw text is
    // kept on the element so copy/inject/export use the original.
    function addMessage(text, sender) {
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message", sender === "user" ? "user-message" : "ai-message");

        const bubble = document.createElement("div");
        bubble.classList.add("bubble");
        bubble.dataset.raw = text;

        if (sender === "ai") {
            bubble.innerHTML = renderMarkdown(text);
        } else {
            bubble.textContent = text;
        }

        messageDiv.appendChild(bubble);
        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight;

        saveChatHistory();
    }

    // Animated loading skeleton shown while awaiting a response.
    function showSkeleton() {
        const div = document.createElement("div");
        div.classList.add("message", "ai-message", "typing");
        div.innerHTML = '<div class="bubble"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>';
        chatBox.appendChild(div);
        chatBox.scrollTop = chatBox.scrollHeight;
        return div;
    }

    // Error bubble with a Retry button (not saved to history).
    function showError(message) {
        const div = document.createElement("div");
        div.classList.add("message", "ai-message", "error-message");

        const bubble = document.createElement("div");
        bubble.classList.add("bubble", "error-bubble");

        const span = document.createElement("span");
        span.textContent = message;

        const retry = document.createElement("button");
        retry.className = "retry-btn";
        retry.textContent = "Retry";
        retry.addEventListener("click", function () {
            div.remove();
            if (lastRequest) generateResponse(lastRequest.input, lastRequest.system);
        });

        bubble.appendChild(span);
        bubble.appendChild(retry);
        div.appendChild(bubble);
        chatBox.appendChild(div);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Map a non-OK HTTP status to an actionable message.
    function httpErrorMessage(status, serverError) {
        if (status === 404) {
            return "AI endpoint not found (404). Set API_ENDPOINT in popup.js to your deployed Vercel URL.";
        }
        if (status === 401 || status === 403) {
            return "Not authorized by the AI provider — check the V0_API_KEY on your server.";
        }
        if (status === 500) {
            return serverError || "Server isn't configured (missing V0_API_KEY).";
        }
        if (status === 502) {
            return "The AI provider rejected the request. If you use v0, enable usage-based billing.";
        }
        return serverError ? `${serverError} (HTTP ${status})` : `The AI service returned an error (HTTP ${status}).`;
    }

    // Fetch an AI-generated response from the Vercel function.
    async function generateResponse(input, system) {
        lastRequest = { input: input, system: system };
        isLoading = true;
        sendBtn.disabled = true;
        const skeleton = showSkeleton();

        try {
            const response = await fetch(API_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildRequestBody(input, system))
            });

            // Rate limited — update the quota and show the exceeded modal.
            if (response.status === 429) {
                let body = {};
                try { body = await response.json(); } catch (e) { /* ignore */ }
                skeleton.remove();
                if (body.rateLimit) setQuota(body.rateLimit);
                if (quotaStatus(currentQuota).exhausted) {
                    showQuotaModal();
                } else {
                    showError(body.error || "Rate limit reached. Please try again later.");
                }
                return;
            }

            if (!response.ok) {
                // Read the function's JSON error (if any) for a specific reason.
                let serverError = "";
                try {
                    const body = await response.json();
                    if (body && body.error) serverError = body.error;
                } catch (e) { /* non-JSON error page */ }
                throw new Error(httpErrorMessage(response.status, serverError));
            }

            let data;
            try {
                data = await response.json();
            } catch (parseErr) {
                throw new Error("Could not parse AI response as JSON.");
            }

            const aiResponse = parseChatResponse(data); // throws if empty/non-string

            skeleton.remove();
            addMessage(aiResponse, "ai");
            addTokens(tokensFromResponse(data, input, aiResponse));
            if (data.rateLimit) setQuota(data.rateLimit);
        } catch (error) {
            console.error("Error fetching response:", error);
            skeleton.remove();
            const msg = error instanceof TypeError
                ? "Couldn't reach the AI service. Check the endpoint URL / your connection."
                : (error.message || "The AI service didn't respond properly. Please try again.");
            showError(msg);
        } finally {
            isLoading = false;
            updateCharCounter();
        }
    }

    // Save chat history to local storage (raw text). Skeleton and error bubbles
    // are transient and excluded.
    function saveChatHistory() {
        const messages = [];
        document.querySelectorAll(".message:not(.typing):not(.error-message)").forEach(msg => {
            const bubble = msg.querySelector(".bubble");
            messages.push({
                text: bubble.dataset.raw != null ? bubble.dataset.raw : bubble.innerText,
                sender: msg.classList.contains("user-message") ? "user" : "ai"
            });
        });
        localStorage.setItem("chatHistory", JSON.stringify(messages));
    }

    // Load chat history from local storage
    function loadChatHistory() {
        const savedMessages = JSON.parse(localStorage.getItem("chatHistory") || "[]");
        savedMessages.forEach(msg => addMessage(msg.text, msg.sender));
    }
});
