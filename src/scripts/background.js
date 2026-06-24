chrome.runtime.onInstalled.addListener(() => {
    console.log("AI Writing Assistant Extension Installed!");

    // Create a context menu item for text selection
    chrome.contextMenus.create({
        id: "aiWritingAssistant",
        title: "Send to AI Writing Assistant",
        contexts: ["selection"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "aiWritingAssistant") {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: sendSelectedTextToPopup,
            args: [info.selectionText]
        });
    }
});

function sendSelectedTextToPopup(text) {
    chrome.runtime.sendMessage({ action: "useSelectedText", text: text });
}
