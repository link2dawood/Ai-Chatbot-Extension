chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "insertText") {
        let activeElement = document.activeElement;

        if (activeElement && (activeElement.tagName === "TEXTAREA" || activeElement.tagName === "INPUT")) {
            activeElement.value += message.text;
            activeElement.focus();
            sendResponse({ success: true });
        } else if (activeElement.isContentEditable) {
            document.execCommand("insertText", false, message.text);
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, error: "No active text field found." });
        }
        return true;
    }
});
