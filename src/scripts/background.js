// Background service worker.
//
// Opens the extension's side panel when the toolbar icon is clicked. The side
// panel stays open until the user closes it — unlike a toolbar popup, which the
// browser force-closes whenever it loses focus.
chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((err) => console.error("Failed to set side panel behavior:", err));
});
