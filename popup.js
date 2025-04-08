document.addEventListener("DOMContentLoaded", function () {
    const chatBox = document.getElementById("chatBox");
    const inputText = document.getElementById("inputText");
    const sendBtn = document.getElementById("sendBtn");
    const copyBtn = document.getElementById("copyBtn");
    const injectBtn = document.getElementById("injectBtn");
    const themeToggle = document.getElementById("themeToggle");

    // Load previous chat messages from local storage
    loadChatHistory();

    // API Key & URL
    const API_KEY = "AIzaSyBb1X84RkeJRbrYMptHocPEB8PxPg2gltc"; 
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

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

    // Send message
    sendBtn.addEventListener("click", function () {
        let userInput = inputText.value.trim();
        if (!userInput) return;

        addMessage(userInput, "user");
        inputText.value = "";

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
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ contents: [{ parts: [{ text: input }] }] })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI couldn't generate a response.";

            typingMessage.remove(); // Remove typing indicator
            addMessage(aiResponse, "ai");
        } catch (error) {
            console.error("Error fetching response:", error);
            typingMessage.remove();
            addMessage("Error generating response. Please try again.", "ai");
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
