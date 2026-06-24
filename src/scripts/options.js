document.addEventListener("DOMContentLoaded", function () {
    const endpointInput = document.getElementById("endpoint");
    const maxCharsInput = document.getElementById("maxChars");
    const saveBtn = document.getElementById("saveBtn");
    const status = document.getElementById("status");

    // Keep in sync with the defaults in popup.js.
    const DEFAULT_ENDPOINT = "https://your-app.vercel.app/api/chat";
    const DEFAULT_MAX_CHARS = 2000;

    // Load saved settings into the form.
    chrome.storage.sync.get(["endpoint", "maxChars"], function (res) {
        endpointInput.value = res.endpoint || DEFAULT_ENDPOINT;
        maxCharsInput.value = Number.isInteger(res.maxChars) ? res.maxChars : DEFAULT_MAX_CHARS;
    });

    saveBtn.addEventListener("click", function () {
        const endpoint = endpointInput.value.trim();
        const maxChars = parseInt(maxCharsInput.value, 10);

        if (!endpoint) {
            showStatus("Endpoint URL is required.", true);
            return;
        }
        try {
            // Throws on an invalid URL.
            new URL(endpoint);
        } catch (e) {
            showStatus("Please enter a valid URL.", true);
            return;
        }
        if (!Number.isInteger(maxChars) || maxChars < 1) {
            showStatus("Max characters must be a positive whole number.", true);
            return;
        }

        chrome.storage.sync.set({ endpoint: endpoint, maxChars: maxChars }, function () {
            if (chrome.runtime.lastError) {
                showStatus("Could not save: " + chrome.runtime.lastError.message, true);
            } else {
                showStatus("Settings saved.", false);
            }
        });
    });

    function showStatus(message, isError) {
        status.textContent = message;
        status.classList.toggle("error", isError);
        status.classList.toggle("ok", !isError);
    }
});
