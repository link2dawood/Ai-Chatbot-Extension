import { renderMarkdown } from "../lib/markdown.js";
import { MODE_PROMPTS } from "../lib/prompts.js";
import { sendAssistantRequest, checkProviders, PROVIDER_OPTIONS } from "../lib/api.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const FREE_CHAT_LIMIT = 10;

const MODES = {
  chat: {
    kicker: "GENERAL ASSISTANT",
    title: "What can I help with?",
    description: "Ask a question or work through something without leaving the page.",
    placeholder: "Ask anything…",
    system: MODE_PROMPTS.chat,
    starters: [
      ["Draft a reply", "Help me write a clear reply to this message: "],
      ["Make a plan", "Turn this into a simple action plan: "],
      ["Brainstorm", "Give me practical ideas for: "]
    ]
  },
  rewrite: {
    kicker: "REWRITE",
    title: "Make it sound better.",
    description: "Improve clarity, tone and flow while keeping the original meaning.",
    placeholder: "Paste text to rewrite…",
    system: MODE_PROMPTS.rewrite,
    starters: [
      ["Professional", "Rewrite this to sound professional and natural: "],
      ["Friendly", "Rewrite this to sound warm and friendly: "],
      ["Shorter", "Rewrite this to be shorter and clearer: "]
    ]
  },
  grammar: {
    kicker: "GRAMMAR",
    title: "Clean up the writing.",
    description: "Fix grammar, spelling and punctuation without changing your voice.",
    placeholder: "Paste text to correct…",
    system: MODE_PROMPTS.grammar,
    starters: [
      ["Fix grammar", "Correct the grammar in this text without changing my tone: "],
      ["Polish wording", "Fix grammar and smooth any awkward wording: "],
      ["Business tone", "Correct this and keep it suitable for work: "]
    ]
  },
  summarize: {
    kicker: "SUMMARIZE",
    title: "Pull out what matters.",
    description: "Turn long text into a concise summary you can scan quickly.",
    placeholder: "Paste text to summarize…",
    system: MODE_PROMPTS.summarize,
    starters: [
      ["5 bullets", "Summarize this in 5 concise bullets: "],
      ["Key takeaways", "Give me the key takeaways from this: "],
      ["One paragraph", "Summarize this in one short paragraph: "]
    ]
  },
  explain: {
    kicker: "EXPLAIN",
    title: "Make it easier to understand.",
    description: "Break down confusing text or ideas in plain language.",
    placeholder: "Paste or ask what to explain…",
    system: MODE_PROMPTS.explain,
    starters: [
      ["Simple terms", "Explain this in simple terms: "],
      ["Step by step", "Explain this step by step: "],
      ["With example", "Explain this and give one practical example: "]
    ]
  }
};

const DEFAULT_SETTINGS = { theme: "light", mode: "chat", provider: "auto", licenseKey: "" };
let settings = { ...DEFAULT_SETTINGS };
let history = [];
let freeChatsUsed = 0;
let isLoading = false;
let lastAssistantText = "";
let toastTimer = null;

const chatBox = $("#chatBox");
const inputText = $("#inputText");
const sendBtn = $("#sendBtn");
const charCounter = $("#charCounter");
const connectionLabel = $("#connectionLabel");
const settingsPanel = $("#settingsPanel");
const providerSelect = $("#providerSelect");

function storageGet(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); }
function storageSet(data) { return new Promise(resolve => chrome.storage.local.set(data, resolve)); }

async function init() {
  const stored = await storageGet(["settings", "chatHistory", "freeChatsUsed"]);
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  history = Array.isArray(stored.chatHistory) ? stored.chatHistory.slice(-50) : [];
  freeChatsUsed = Math.max(0, Number(stored.freeChatsUsed) || 0);
  applySettingsToUI();
  renderHistory();
  updateQuotaUI();
  updateComposer();
  bindEvents();
}

function bindEvents() {
  sendBtn.addEventListener("click", sendCurrentMessage);
  inputText.addEventListener("input", () => { autoSizeInput(); updateComposer(); });
  inputText.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });

  $$(".mode-pill").forEach(button => button.addEventListener("click", async () => {
    await setMode(button.dataset.mode);
  }));

  chatBox.addEventListener("click", (event) => {
    const starter = event.target.closest("[data-starter]");
    if (starter) {
      inputText.value = starter.dataset.starter || "";
      inputText.focus();
      autoSizeInput();
      updateComposer();
    }
    const copy = event.target.closest("[data-copy-message]");
    if (copy) copyText(copy.dataset.copyMessage || "");
  });

  $("#settingsToggle").addEventListener("click", openSettings);
  $("#settingsClose").addEventListener("click", closeSettings);
  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#testConnection").addEventListener("click", testConnection);
  $("#saveLicense").addEventListener("click", saveLicense);
  providerSelect.addEventListener("change", async () => {
    settings.provider = providerSelect.value;
    await persistSettings();
    $("#providerResults").innerHTML = "";
    setSettingsStatus("", "");
    updateConnectionButton();
  });
  $("#copyBtn").addEventListener("click", copyLastReply);
  $("#insertBtn").addEventListener("click", insertLastReply);
  $("#clearBtn").addEventListener("click", clearChat);
  $("#exportBtn").addEventListener("click", exportChat);
}

async function setMode(mode) {
  if (!MODES[mode]) return;
  settings.mode = mode;
  $$(".mode-pill").forEach(item => item.classList.toggle("is-active", item.dataset.mode === mode));
  updateModeUI();
  await persistSettings();
  inputText.focus();
}

function applySettingsToUI() {
  document.body.classList.toggle("dark", settings.theme === "dark");
  updateThemeIcon();
  updateModeUI();
  providerSelect.innerHTML = PROVIDER_OPTIONS
    .map(option => `<option value="${escapeAttr(option.id)}">${escapeText(option.label)}</option>`)
    .join("");
  if (!PROVIDER_OPTIONS.some(option => option.id === settings.provider)) settings.provider = "auto";
  providerSelect.value = settings.provider;
  updateConnectionButton();
  $("#licenseInput").value = settings.licenseKey || "";
  connectionLabel.textContent = "Ready";
}

function providerLabel(id) {
  return PROVIDER_OPTIONS.find(option => option.id === id)?.label || id;
}

function updateConnectionButton() {
  $("#testConnection").textContent = settings.provider === "auto"
    ? "Check all connections"
    : `Check ${providerLabel(settings.provider)} connection`;
}

function updateModeUI() {
  const mode = MODES[settings.mode] || MODES.chat;
  $$(".mode-pill").forEach(item => item.classList.toggle("is-active", item.dataset.mode === settings.mode));
  $("#modeKicker").textContent = mode.kicker;
  $("#modeTitle").textContent = mode.title;
  $("#modeDescription").textContent = mode.description;
  inputText.placeholder = mode.placeholder;
  if (!history.length) renderEmptyState();
}

function renderEmptyState() {
  const mode = MODES[settings.mode] || MODES.chat;
  chatBox.innerHTML = `
    <div class="starter-list">
      ${mode.starters.map(([label, prompt]) => `
        <button type="button" class="starter-item" data-starter="${escapeAttr(prompt)}">
          <span>${escapeText(label)}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </button>`).join("")}
    </div>`;
}

function updateThemeIcon() {
  const isDark = document.body.classList.contains("dark");
  $("#themeToggle").innerHTML = isDark
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M20.3 14.2A8.5 8.5 0 0 1 9.8 3.7a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>';
}

async function toggleTheme() {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  document.body.classList.toggle("dark", settings.theme === "dark");
  updateThemeIcon();
  await persistSettings();
}

function openSettings() {
  settingsPanel.classList.add("is-open");
  settingsPanel.setAttribute("aria-hidden", "false");
}
function closeSettings() {
  settingsPanel.classList.remove("is-open");
  settingsPanel.setAttribute("aria-hidden", "true");
}

function setLicenseStatus(message, type) {
  const el = $("#licenseStatus");
  el.textContent = message;
  el.className = `settings-status${type ? ` ${type}` : ""}`;
}

function showUpgrade(url) {
  const link = $("#upgradeLink");
  if (url) link.href = url;
  link.hidden = !url;
}

async function saveLicense() {
  const button = $("#saveLicense");
  settings.licenseKey = $("#licenseInput").value.trim();
  await persistSettings();
  if (!settings.licenseKey) return setLicenseStatus("License removed.", "");
  button.disabled = true;
  setLicenseStatus("Verifying…", "");
  try {
    // The unverified health check reports whether this license is accepted.
    const report = await checkProviders({ verify: false, licenseKey: settings.licenseKey });
    if (!report.gated) setLicenseStatus("Paid gating is off on this server; every user has access.", "");
    else if (report.entitled) setLicenseStatus("License verified. Paid access is active.", "success");
    else setLicenseStatus("That license was not accepted. Check the key, or that the subscription is active.", "error");
  } catch (error) {
    setLicenseStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function testConnection() {
  const button = $("#testConnection");
  const list = $("#providerResults");
  button.disabled = true;
  button.textContent = "Checking…";
  list.innerHTML = "";
  setSettingsStatus("Checking keys and sending a small test request…", "");
  try {
    const report = await checkProviders({ provider: settings.provider, verify: true, licenseKey: settings.licenseKey });
    const results = Object.values(report.providers);
    list.innerHTML = results.map(renderProviderResult).join("");

    const passed = results.filter(result => result.ok);
    if (settings.provider !== "auto") {
      const result = report.providers[settings.provider];
      if (!result?.ok) throw new Error(`${providerLabel(settings.provider)} is not connected.`);
      setSettingsStatus(`Connected and verified: ${result.label} · ${result.model}`, "success");
    } else if (passed.length) {
      const fallback = report.defaultProvider ? ` Auto uses ${providerLabel(report.defaultProvider)}.` : "";
      setSettingsStatus(`${passed.length} of ${results.length} providers connected.${fallback}`, "success");
    } else {
      throw new Error(report.error || "No provider is connected.");
    }
    connectionLabel.textContent = "Connected";
  } catch (error) {
    console.error("[Smart Chat] Connection test error", error);
    setSettingsStatus(error.message || "Could not reach the Vercel endpoint.", "error");
  } finally {
    button.disabled = false;
    updateConnectionButton();
  }
}

function renderProviderResult(result) {
  const state = result.ok ? "ok" : (result.configured ? "fail" : "off");
  const status = result.ok
    ? (result.verified ? "Verified" : "Key accepted")
    : (result.configured ? "Failed" : "Not set");
  const timing = Number.isFinite(result.latencyMs) ? `${result.latencyMs} ms` : "";
  const details = [];
  if (result.ok) {
    details.push(`<p>Model ${escapeText(result.model)}</p>`);
  } else if (result.configured) {
    const where = result.stage ? `${result.stage} step: ` : "";
    details.push(`<p class="provider-error">${escapeText(where + (result.error || "Unknown error"))}</p>`);
  } else {
    details.push(`<p>Add ${escapeText(result.keyEnv)} on Vercel to enable.</p>`);
  }
  if (result.hint && result.configured) details.push(`<p>${escapeText(result.hint)}</p>`);
  (result.warnings || []).forEach(warning => details.push(`<p>${escapeText(warning)}</p>`));
  return `
    <li class="provider-result ${state}">
      <div class="provider-result-head">
        <span class="provider-dot" aria-hidden="true"></span>
        <span>${escapeText(result.label)}</span>
        <span class="provider-tag">${escapeText(status)}</span>
        <small>${escapeText(timing)}</small>
      </div>
      ${details.join("")}
    </li>`;
}

function setSettingsStatus(message, type) {
  const el = $("#settingsStatus");
  el.textContent = message;
  el.className = `settings-status${type ? ` ${type}` : ""}`;
}

async function persistSettings() { await storageSet({ settings }); }
async function persistHistory() { await storageSet({ chatHistory: history.slice(-50) }); }
async function persistQuota() { await storageSet({ freeChatsUsed }); }

function renderHistory() {
  chatBox.innerHTML = "";
  if (!history.length) return renderEmptyState();
  history.forEach(item => addMessageToDOM(item.role, item.text, false, item.error));
  lastAssistantText = [...history].reverse().find(item => item.role === "assistant" && !item.error)?.text || "";
  scrollToBottom();
}

function addMessageToDOM(role, text, animate = true, error = false) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}${error ? " error" : ""}`;
  if (!animate) wrapper.style.animation = "none";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = role === "assistant" ? renderMarkdown(text) : escapeText(text).replace(/\n/g, "<br>");
  wrapper.append(bubble);
  if (role === "assistant" && !error) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.dataset.copyMessage = text;
    actions.append(copy);
    wrapper.append(actions);
  }
  chatBox.append(wrapper);
  scrollToBottom();
  return wrapper;
}

function showTyping() {
  const wrapper = document.createElement("div");
  wrapper.className = "message assistant";
  wrapper.id = "typingMessage";
  wrapper.innerHTML = '<div class="bubble typing-bubble"><span></span><span></span><span></span></div>';
  chatBox.append(wrapper);
  scrollToBottom();
}
function removeTyping() { $("#typingMessage")?.remove(); }

async function sendCurrentMessage() {
  const text = inputText.value.trim();
  if (!text || isLoading) return;
  if (freeChatsUsed >= FREE_CHAT_LIMIT) {
    toast("You have used your 10 free chats");
    updateQuotaUI();
    return;
  }

  isLoading = true;
  inputText.value = "";
  autoSizeInput();
  updateComposer();
  history.push({ role: "user", text, at: Date.now() });
  addMessageToDOM("user", text);
  await persistHistory();
  showTyping();
  connectionLabel.textContent = "Working…";

  try {
    const mode = MODES[settings.mode] || MODES.chat;
    const result = await sendAssistantRequest({ prompt: text, system: mode.system, provider: settings.provider, licenseKey: settings.licenseKey });
    removeTyping();
    lastAssistantText = result.text;
    history.push({ role: "assistant", text: result.text, at: Date.now() });
    freeChatsUsed += 1;
    addMessageToDOM("assistant", result.text);
    await Promise.all([persistHistory(), persistQuota()]);
    updateQuotaUI();
    connectionLabel.textContent = "Connected";
  } catch (error) {
    console.error("[Smart Chat] Chat request error", {
      message: error?.message,
      status: error?.status,
      upstreamStatus: error?.upstreamStatus,
      upstreamCode: error?.upstreamCode,
      provider: error?.provider,
      retryAfter: error?.retryAfter,
      error
    });
    removeTyping();
    const message = friendlyError(error);
    history.push({ role: "assistant", text: message, at: Date.now(), error: true });
    addMessageToDOM("assistant", message, true, true);
    await persistHistory();
    connectionLabel.textContent = error.status === 429 ? "Limit reached" : "Connection issue";
  } finally {
    isLoading = false;
    updateComposer();
  }
}

function friendlyError(error) {
  if (error.code === "paid_required" || String(error.code || "").startsWith("license_")) {
    showUpgrade(error.upgradeUrl);
    return error.message;
  }
  const name = error.provider ? providerLabel(error.provider) : "The AI service";
  if (error.status === 0) return error.message;
  if (error.status === 429 && !error.hint) {
    return `${name} is rate limited right now.${error.retryAfter ? ` Try again in about ${error.retryAfter} seconds.` : " Please try again shortly."}`;
  }
  const message = error.message || `Something went wrong while contacting ${name}.`;
  const prefix = error.provider && !message.includes(name) ? `${name}: ` : "";
  return error.hint ? `${prefix}${message}\n\n${error.hint}` : `${prefix}${message}`;
}

function updateQuotaUI() {
  const remaining = Math.max(0, FREE_CHAT_LIMIT - freeChatsUsed);
  const usedPercent = Math.min(100, Math.round((freeChatsUsed / FREE_CHAT_LIMIT) * 100));
  $("#quotaText").textContent = remaining === 1 ? "1 chat left" : `${remaining} chats left`;
  $("#quotaFill").style.width = `${usedPercent}%`;
  document.body.classList.toggle("quota-empty", remaining === 0);
  updateComposer();
}

function updateComposer() {
  charCounter.textContent = `${inputText.value.length} / 6000`;
  sendBtn.disabled = isLoading || !inputText.value.trim() || freeChatsUsed >= FREE_CHAT_LIMIT;
}

function autoSizeInput() {
  inputText.style.height = "auto";
  inputText.style.height = `${Math.min(148, inputText.scrollHeight)}px`;
}

async function copyText(text) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  toast("Copied");
}
async function copyLastReply() {
  if (!lastAssistantText) return toast("No reply to copy yet");
  await copyText(lastAssistantText);
}

async function insertLastReply() {
  if (!lastAssistantText) return toast("No reply to insert yet");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [lastAssistantText],
      func: (value) => {
        const el = document.activeElement;
        if (!el) return false;
        if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|email|url|tel)$/i.test(el.type))) {
          const start = el.selectionStart ?? el.value.length;
          const end = el.selectionEnd ?? el.value.length;
          el.setRangeText(value, start, end, "end");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
        if (el.isContentEditable) {
          document.execCommand("insertText", false, value);
          return true;
        }
        return false;
      }
    });
    toast(results?.[0]?.result ? "Inserted into page" : "Click a text field on the page first");
  } catch {
    toast("Chrome blocked insertion on this page");
  }
}

async function clearChat() {
  if (!history.length) return;
  if (!confirm("Clear this conversation? Your free-chat usage will not reset.")) return;
  history = [];
  lastAssistantText = "";
  await persistHistory();
  renderHistory();
}

function exportChat() {
  if (!history.length) return toast("Nothing to export yet");
  const body = history.map(item => `${item.role === "user" ? "You" : "Assistant"}\n${item.text}`).join("\n\n---\n\n");
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `smart-chat-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeText(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
function escapeAttr(text) { return escapeText(text).replace(/"/g, "&quot;"); }
function scrollToBottom() { requestAnimationFrame(() => { chatBox.scrollTop = chatBox.scrollHeight; }); }
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

init().catch(error => {
  console.error(error);
  connectionLabel.textContent = "Unable to initialize";
});
