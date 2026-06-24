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

    // ---------------------------------------------------------------------
    // Configuration — the extension works out of the box, no user setup.
    // The AI provider key lives in a Vercel environment variable (server-side),
    // so end users never need an API key of their own.
    //
    // Set this to your deployed Vercel function URL once, before publishing.
    const API_ENDPOINT = "https://your-app.vercel.app/api/chat";
    const MAX_CHARS = 2000;
    // ---------------------------------------------------------------------

    // Conversation modes — each maps to a system instruction sent to the API.
    const MODES = {
        chat: "",
        writing: "You are a writing assistant. Improve the clarity, flow, grammar, and tone of the user's text while preserving its meaning. Return only the improved text.",
        grammar: "You are a grammar and spelling corrector. Fix grammar, spelling, and punctuation in the user's text. Return only the corrected text, with no commentary.",
        summarize: "Summarize the following text clearly and concisely, capturing the key points.",
        explain: "Explain the following clearly and simply, as if to a curious beginner."
    };

    // Running token total for this session (persisted so it accumulates).
    let sessionTokens = parseInt(localStorage.getItem("tokenTotal") || "0", 10) || 0;

    // Restore selected mode.
    modeSelect.value = localStorage.getItem("mode") || "chat";
    modeSelect.addEventListener("change", function () {
        localStorage.setItem("mode", modeSelect.value);
    });

    // Load previous chat messages, then render counters.
    loadChatHistory();
    updateCharCounter();
    updateTokenCounter();

    // Toggle Dark Mode (Save to Local Storage)
    themeToggle.addEventListener("click", function () {
        document.body.classList.toggle("dark-mode");
        let icon = themeToggle.querySelector("i");
        icon.classList.toggle("fa-moon");
        icon.classList.toggle("fa-sun");

        localStorage.setItem("darkMode", document.body.classList.contains("dark-mode"));
    });

    // Check Dark Mode Preference
    if (localStorage.getItem("darkMode") === "true") {
        document.body.classList.add("dark-mode");
    }

    // Live character counter + limit enforcement
    inputText.addEventListener("input", updateCharCounter);

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

    function estimateTokens(text) {
        // Rough heuristic when the API doesn't return usage (~4 chars/token).
        return Math.ceil((text || "").length / 4);
    }

    // Send message
    sendBtn.addEventListener("click", function () {
        let userInput = inputText.value.trim();
        if (!userInput) return;

        if (userInput.length > MAX_CHARS) {
            alert(`Your message is ${userInput.length} characters, but the limit is ${MAX_CHARS}. Please shorten it.`);
            return;
        }

        addMessage(userInput, "user");
        inputText.value = "";
        updateCharCounter();

        generateResponse(userInput, MODES[modeSelect.value] || "");
    });

    // Copy last AI response (raw text)
    copyBtn.addEventListener("click", function () {
        let bubbles = chatBox.querySelectorAll(".ai-message .bubble");
        if (bubbles.length === 0) {
            alert("No text to copy!");
            return;
        }

        let last = bubbles[bubbles.length - 1];
        let lastResponse = last.dataset.raw || last.innerText;
        navigator.clipboard.writeText(lastResponse)
            .then(() => alert("Copied!"))
            .catch(err => console.error("Failed to copy:", err));
    });

    // Inject last AI response into active input field (raw text)
    injectBtn.addEventListener("click", function () {
        let bubbles = chatBox.querySelectorAll(".ai-message .bubble");
        if (bubbles.length === 0) {
            alert("No text to inject!");
            return;
        }

        let last = bubbles[bubbles.length - 1];
        let lastResponse = last.dataset.raw || last.innerText;
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

    // Export conversation as Markdown
    exportBtn.addEventListener("click", function () {
        let saved = JSON.parse(localStorage.getItem("chatHistory") || "[]");
        if (saved.length === 0) {
            alert("No conversation to export.");
            return;
        }
        let md = "# AI Writing Assistant — Conversation\n\n";
        saved.forEach(function (m) {
            md += (m.sender === "user" ? "**You:**\n\n" : "**AI:**\n\n") + m.text + "\n\n---\n\n";
        });
        let blob = new Blob([md], { type: "text/markdown" });
        let url = URL.createObjectURL(blob);
        let a = document.createElement("a");
        a.href = url;
        a.download = "conversation.md";
        a.click();
        URL.revokeObjectURL(url);
    });

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
        let messageDiv = document.createElement("div");
        messageDiv.classList.add("message", sender === "user" ? "user-message" : "ai-message");

        let bubble = document.createElement("div");
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

    // Function to fetch AI-generated response
    async function generateResponse(input, system) {
        let typingMessage = document.createElement("div");
        typingMessage.classList.add("message", "ai-message", "typing");
        typingMessage.innerHTML = '<div class="bubble">AI is thinking...</div>';
        chatBox.appendChild(typingMessage);
        chatBox.scrollTop = chatBox.scrollHeight;

        try {
            const response = await fetch(API_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ prompt: input, system: system || "" })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            // Parse defensively — never fail silently.
            let data;
            try {
                data = await response.json();
            } catch (parseErr) {
                throw new Error("Could not parse AI response as JSON.");
            }

            const aiResponse = data && typeof data.text === "string" ? data.text.trim() : "";
            if (!aiResponse) {
                throw new Error("Empty response from AI service.");
            }

            typingMessage.remove(); // Remove typing indicator
            addMessage(aiResponse, "ai");

            // Track token usage (real if the API returned it, else estimate).
            const used = data.usage && Number.isFinite(data.usage.total_tokens)
                ? data.usage.total_tokens
                : estimateTokens(input) + estimateTokens(aiResponse);
            addTokens(used);
        } catch (error) {
            console.error("Error fetching response:", error);
            typingMessage.remove();
            addMessage("AI service is unavailable. Please check your API key.", "ai");
        }
    }

    // Save chat history to local storage (raw text).
    function saveChatHistory() {
        let messages = [];
        document.querySelectorAll(".message:not(.typing)").forEach(msg => {
            let bubble = msg.querySelector(".bubble");
            messages.push({
                text: bubble.dataset.raw != null ? bubble.dataset.raw : bubble.innerText,
                sender: msg.classList.contains("user-message") ? "user" : "ai"
            });
        });
        localStorage.setItem("chatHistory", JSON.stringify(messages));
    }

    // Load chat history from local storage
    function loadChatHistory() {
        let savedMessages = JSON.parse(localStorage.getItem("chatHistory") || "[]");
        savedMessages.forEach(msg => addMessage(msg.text, msg.sender));
    }

    // --- Minimal, XSS-safe Markdown renderer -------------------------------
    // Supports: code blocks, inline code, bold, italic, headings, ordered and
    // unordered lists, paragraphs. All input is HTML-escaped first, so only the
    // tags we generate are ever inserted.
    function escapeHtml(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function renderInline(s) {
        return s
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/__([^_]+)__/g, "<strong>$1</strong>")
            .replace(/\*([^*]+)\*/g, "<em>$1</em>")
            .replace(/(^|[\s(])_([^_]+)_/g, "$1<em>$2</em>");
    }

    function renderMarkdown(text) {
        const lines = escapeHtml(text).split("\n");
        let html = "";
        let inCode = false;
        let codeBuffer = [];
        let listType = null;
        let paraBuffer = [];

        function flushPara() {
            if (paraBuffer.length) {
                html += `<p>${renderInline(paraBuffer.join(" "))}</p>`;
                paraBuffer = [];
            }
        }
        function closeList() {
            if (listType) { html += `</${listType}>`; listType = null; }
        }

        for (let line of lines) {
            if (line.trim().startsWith("```")) {
                if (!inCode) {
                    flushPara(); closeList();
                    inCode = true; codeBuffer = [];
                } else {
                    html += `<pre><code>${codeBuffer.join("\n")}</code></pre>`;
                    inCode = false;
                }
                continue;
            }
            if (inCode) { codeBuffer.push(line); continue; }

            const ul = line.match(/^\s*[-*]\s+(.*)$/);
            const ol = line.match(/^\s*\d+\.\s+(.*)$/);
            const h = line.match(/^(#{1,3})\s+(.*)$/);

            if (ul) {
                flushPara();
                if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; }
                html += `<li>${renderInline(ul[1])}</li>`;
            } else if (ol) {
                flushPara();
                if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; }
                html += `<li>${renderInline(ol[1])}</li>`;
            } else if (h) {
                flushPara(); closeList();
                html += `<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`;
            } else if (line.trim() === "") {
                flushPara(); closeList();
            } else {
                closeList();
                paraBuffer.push(line);
            }
        }
        if (inCode) { html += `<pre><code>${codeBuffer.join("\n")}</code></pre>`; }
        flushPara(); closeList();
        return html;
    }
});
