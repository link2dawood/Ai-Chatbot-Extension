document.addEventListener("DOMContentLoaded", function () {
    const chatBox = document.getElementById("chatBox");
    const inputText = document.getElementById("inputText");
    const sendBtn = document.getElementById("sendBtn");
    const copyBtn = document.getElementById("copyBtn");
    const injectBtn = document.getElementById("injectBtn");
    const themeToggle = document.getElementById("themeToggle");
    const charCounter = document.getElementById("charCounter");
    const openOptions = document.getElementById("openOptions");

    // Defaults — overridable from the options page (chrome.storage.sync).
    // The AI provider key lives in a Vercel environment variable, never here.
    const DEFAULT_ENDPOINT = "https://your-app.vercel.app/api/chat";
    const DEFAULT_MAX_CHARS = 2000;

    let settings = { endpoint: DEFAULT_ENDPOINT, maxChars: DEFAULT_MAX_CHARS };

    // Load saved settings, then render the counter.
    chrome.storage.sync.get(["endpoint", "maxChars"], function (res) {
        if (res.endpoint) settings.endpoint = res.endpoint;
        if (Number.isInteger(res.maxChars) && res.maxChars > 0) settings.maxChars = res.maxChars;
        updateCharCounter();
    });

    // Pick up changes made on the options page while the popup is open.
    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== "sync") return;
        if (changes.endpoint) settings.endpoint = changes.endpoint.newValue || DEFAULT_ENDPOINT;
        if (changes.maxChars) settings.maxChars = changes.maxChars.newValue || DEFAULT_MAX_CHARS;
        updateCharCounter();
    });

    // Load previous chat messages from local storage
    loadChatHistory();

    // Open the settings/options page
    if (openOptions) {
        openOptions.addEventListener("click", function (e) {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
        });
    }

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
        const max = settings.maxChars;
        charCounter.textContent = `${len} / ${max}`;
        const over = len > max;
        charCounter.classList.toggle("over", over);
        // Disable send when empty or over the limit.
        sendBtn.disabled = over || len === 0;
    }

    // Send message
    sendBtn.addEventListener("click", function () {
        let userInput = inputText.value.trim();
        if (!userInput) return;

        if (userInput.length > settings.maxChars) {
            alert(`Your message is ${userInput.length} characters, but the limit is ${settings.maxChars}. Please shorten it.`);
            return;
        }

        addMessage(userInput, "user");
        inputText.value = "";
        updateCharCounter();

        generateResponse(userInput);
    });

    // Copy last AI response
    copyBtn.addEventListener("click", function () {
        let messages = chatBox.querySelectorAll(".ai-message .bubble");
        if (messages.length === 0) {
            alert("No text to copy!");
            return;
        }

        let lastResponse = messages[messages.length - 1].innerText;
        navigator.clipboard.writeText(lastResponse)
            .then(() => alert("Copied!"))
            .catch(err => console.error("Failed to copy:", err));
    });

    // Inject last AI response into active input field
    injectBtn.addEventListener("click", function () {
        let messages = chatBox.querySelectorAll(".ai-message .bubble");
        if (messages.length === 0) {
            alert("No text to inject!");
            return;
        }

        let lastResponse = messages[messages.length - 1].innerText;
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                function: insertText,
                args: [lastResponse]
            });
        });
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

    // Function to add messages to chat
    function addMessage(text, sender) {
        let messageDiv = document.createElement("div");
        messageDiv.classList.add("message", sender === "user" ? "user-message" : "ai-message");

        let bubble = document.createElement("div");
        bubble.classList.add("bubble");
        bubble.innerText = text;

        messageDiv.appendChild(bubble);
        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight;

        // Save message to history
        saveChatHistory();
    }

    // Function to fetch AI-generated response
    async function generateResponse(input) {
        let typingMessage = document.createElement("div");
        typingMessage.classList.add("message", "ai-message", "typing");
        typingMessage.innerHTML = '<div class="bubble">AI is thinking...</div>';
        chatBox.appendChild(typingMessage);
        chatBox.scrollTop = chatBox.scrollHeight;

        try {
            const response = await fetch(settings.endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ prompt: input })
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
        } catch (error) {
            console.error("Error fetching response:", error);
            typingMessage.remove();
            addMessage("AI service is unavailable. Please check your API key.", "ai");
        }
    }

    // Save chat history to local storage
    function saveChatHistory() {
        let messages = [];
        document.querySelectorAll(".message").forEach(msg => {
            messages.push({
                text: msg.querySelector(".bubble").innerText,
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
});
