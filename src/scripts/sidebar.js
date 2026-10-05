import { renderMarkdown } from "../lib/markdown.js";
import { MODE_PROMPTS } from "../lib/prompts.js";
import { sendAssistantRequest, checkProviders, fetchQuota, fetchServerInfo, PROVIDER_OPTIONS } from "../lib/api.js";
import { ACCEPT, checkPicked, formatSize, needsVision, readAttachment } from "../lib/attachments.js";
import { BYOK_PROVIDERS, BYOK_IDS, keyProblem, maskKey, sendOwnKeyRequest, testOwnKey } from "../lib/byok.js";

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
let byok = null; // { provider, key, model, enabled }: the user's own API key, kept only in this browser
let serverInfo = null; // { gated, environment, upgradeUrl, freeQuota } from the server
let serverQuota = null; // { used, limit, remaining }: the free allowance as counted by the server (null = not counted there)
let clientId = ""; // random id made on first run; the server counts free chats against it
let pendingFiles = []; // files attached to the message being written (Premium)
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
  const stored = await storageGet(["settings", "chatHistory", "freeChatsUsed", "byok", "clientId"]);
  clientId = typeof stored.clientId === "string" && stored.clientId ? stored.clientId : crypto.randomUUID();
  if (clientId !== stored.clientId) await storageSet({ clientId });
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  byok = stored.byok?.key && BYOK_PROVIDERS[stored.byok.provider] ? stored.byok : null;
  history = Array.isArray(stored.chatHistory) ? stored.chatHistory.slice(-50) : [];
  freeChatsUsed = Math.max(0, Number(stored.freeChatsUsed) || 0);
  applySettingsToUI();
  renderHistory();
  renderByokCard();
  updateQuotaUI();
  updateComposer();
  bindEvents();
  fetchServerInfo().then(applyServerInfo);
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
    if (event.target.closest("[data-open-own-key]")) openOwnKeySettings();
  });

  $("#settingsToggle").addEventListener("click", openSettings);
  $("#settingsClose").addEventListener("click", closeSettings);
  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#testConnection").addEventListener("click", testConnection);
  $("#saveLicense").addEventListener("click", saveLicense);
  $("#ownKeyBtn").addEventListener("click", openOwnKeySettings);
  $("#fileInput").accept = ACCEPT;
  $("#attachBtn").addEventListener("click", onAttachClick);
  $("#fileInput").addEventListener("change", onFilesPicked);
  $("#attachList").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-attachment]");
    if (!remove) return;
    pendingFiles.splice(Number(remove.dataset.removeAttachment), 1);
    renderAttachments();
  });
  $("#saveByok").addEventListener("click", saveByok);
  $("#removeByok").addEventListener("click", removeByok);
  $("#byokProvider").addEventListener("change", () => { $("#byokKey").value = ""; setByokStatus("", ""); fillByokFields(); });
  $("#byokEnabled").addEventListener("change", async () => {
    if (!byok) return;
    byok.enabled = $("#byokEnabled").checked;
    await storageSet({ byok });
    updateQuotaUI();
  });
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

// The Upgrade buttons appear as soon as the server tells us where to send people.
function showUpgrade(url) {
  if (url) serverInfo = { ...(serverInfo || { gated: false, environment: "production" }), upgradeUrl: url };
  const target = serverInfo?.upgradeUrl || null;
  for (const id of ["#upgradeLink", "#upgradeBtn"]) {
    const link = $(id);
    if (target) link.href = target;
    link.hidden = !target;
  }
}

function applyServerInfo(info) {
  if (!info) return;
  serverInfo = info;
  showUpgrade(info.upgradeUrl);
  $("#envNote").hidden = info.environment !== "sandbox";
  if (info.freeQuota && !unlimited()) fetchQuota({ clientId }).then(quota => { serverQuota = quota; updateQuotaUI(); });
}

// Free chats left: the server's count when it keeps one, otherwise this browser's.
const freeLimit = () => serverQuota?.limit ?? FREE_CHAT_LIMIT;
const freeRemaining = () => serverQuota ? serverQuota.remaining : Math.max(0, FREE_CHAT_LIMIT - freeChatsUsed);

// ---- attachments (Premium) ----

function renderAttachments() {
  const list = $("#attachList");
  list.hidden = !pendingFiles.length;
  list.innerHTML = pendingFiles.map((file, i) => `
    <span class="attach-chip"><span title="${escapeAttr(file.name)}">${escapeText(file.name)}</span><small>${formatSize(file.size)}</small><button type="button" data-remove-attachment="${i}" aria-label="Remove ${escapeAttr(file.name)}">×</button></span>`).join("");
  updateComposer();
}

function onAttachClick() {
  if (!hasLicense()) {
    showLimitCard({ title: "Attachments are a Premium feature", body: "Upgrade to add images, PDFs and text files to your chat.", ownKey: false });
    return;
  }
  $("#fileInput").click();
}

async function onFilesPicked(event) {
  const picked = [...event.target.files];
  event.target.value = "";
  if (!picked.length) return;
  const problem = checkPicked(pendingFiles, picked);
  if (problem) return toast(problem);
  try {
    for (const file of picked) pendingFiles.push(await readAttachment(file));
  } catch {
    toast("Could not read that file.");
  }
  renderAttachments();
}

// ---- your own API key ----

const hasOwnKey = () => Boolean(byok?.key && byok.enabled !== false);
const hasLicense = () => Boolean(settings.licenseKey);
// Chats with your own key, or with a Premium license, are not limited by the free allowance.
const unlimited = () => hasOwnKey() || hasLicense();

function openOwnKeySettings() {
  openSettings();
  $("#ownKeyCard").scrollIntoView({ block: "start" });
  $("#byokKey").focus();
}

function setByokStatus(message, type) {
  const el = $("#byokStatus");
  el.textContent = message;
  el.className = `settings-status${type ? ` ${type}` : ""}`;
}

function fillByokFields() {
  const id = $("#byokProvider").value;
  const info = BYOK_PROVIDERS[id];
  $("#byokModel").placeholder = info.defaultModel;
  $("#byokKey").placeholder = byok?.provider === id ? `Key saved (${maskKey(byok.key)}). Paste a new one to replace it.` : info.keyPlaceholder;
  $("#byokModel").value = byok?.provider === id ? byok.model || "" : "";
  const link = $("#byokGetKey");
  link.href = info.keyUrl;
  link.textContent = `Get a ${info.label} key`;
}

function renderByokCard() {
  const select = $("#byokProvider");
  select.innerHTML = BYOK_IDS.map(id => `<option value="${id}">${escapeText(BYOK_PROVIDERS[id].label)}</option>`).join("");
  select.value = byok?.provider || "openai";
  fillByokFields();
  $("#byokEnabledRow").hidden = !byok;
  $("#removeByok").hidden = !byok;
  $("#byokEnabled").checked = byok ? byok.enabled !== false : false;
  if (byok) setByokStatus(`Saved: ${BYOK_PROVIDERS[byok.provider].label} key ${maskKey(byok.key)}. ${byok.enabled !== false ? "Your chats use it." : "Turned off."}`, "success");
}

async function saveByok() {
  const button = $("#saveByok");
  const provider = $("#byokProvider").value;
  const info = BYOK_PROVIDERS[provider];
  const typed = $("#byokKey").value.trim();
  const key = typed || (byok?.provider === provider ? byok.key : "");
  const model = $("#byokModel").value.trim();

  const problem = keyProblem(provider, key);
  if (problem) return setByokStatus(problem, "error");

  button.disabled = true;
  setByokStatus("Asking Chrome for permission…", "");
  try {
    // Must be the first await in the click handler so Chrome treats it as a user action.
    const granted = await chrome.permissions.request({ origins: [info.origin] });
    if (!granted) throw new Error(`Chrome needs your permission to contact ${info.label}. Press Save again and choose Allow.`);
    setByokStatus(`Testing your ${info.label} key…`, "");
    const result = await testOwnKey({ provider, key, model });
    byok = { provider, key, model, enabled: true };
    await storageSet({ byok });
    $("#byokKey").value = "";
    renderByokCard();
    setByokStatus(`Your ${info.label} key works (${result.model}). Your chats now use it, with no limit.`, "success");
    updateQuotaUI();
  } catch (error) {
    console.error("[Smart Chat] Own-key test failed", { provider, status: error?.status, code: error?.code, message: error?.message });
    setByokStatus(error.message || "Could not test the key.", "error");
  } finally {
    button.disabled = false;
  }
}

async function removeByok() {
  if (!byok) return;
  const origin = BYOK_PROVIDERS[byok.provider].origin;
  byok = null;
  await new Promise(resolve => chrome.storage.local.remove("byok", resolve));
  try { await chrome.permissions.remove({ origins: [origin] }); } catch { /* the permission may already be gone */ }
  $("#byokKey").value = "";
  renderByokCard();
  setByokStatus("Your key was removed from this browser.", "");
  updateQuotaUI();
}

// A card in the chat that explains a limit and offers the way past it.
function showLimitCard({ title, body, ownKey = true } = {}) {
  $("#limitCard")?.remove();
  const card = document.createElement("div");
  card.id = "limitCard";
  card.className = "limit-card";
  const upgrade = serverInfo?.upgradeUrl;
  card.innerHTML = `
    <strong>${escapeText(title || `You have used your ${freeLimit()} free chats`)}</strong>
    <p>${escapeText(body || "Keep going with Premium Access, or add your own API key for unlimited chats.")}</p>
    <div class="plan-actions">
      ${upgrade ? `<a class="plan-btn primary" href="${escapeAttr(upgrade)}" target="_blank" rel="noopener">Upgrade to Premium</a>` : ""}
      ${ownKey ? '<button class="plan-btn" type="button" data-open-own-key>Use your own key</button>' : ""}
    </div>`;
  chatBox.append(card);
  scrollToBottom();
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
  history.forEach(item => addMessageToDOM(item.role, item.text, false, item.error, item.files));
  lastAssistantText = [...history].reverse().find(item => item.role === "assistant" && !item.error)?.text || "";
  scrollToBottom();
}

function addMessageToDOM(role, text, animate = true, error = false, files = []) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}${error ? " error" : ""}`;
  if (!animate) wrapper.style.animation = "none";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = role === "assistant" ? renderMarkdown(text) : escapeText(text).replace(/\n/g, "<br>");
  wrapper.append(bubble);
  if (role === "user" && files?.length) {
    const tags = document.createElement("div");
    tags.className = "file-tags";
    tags.innerHTML = files.map(name => `<span>${escapeText(name)}</span>`).join("");
    wrapper.append(tags);
  }
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
  const files = [...pendingFiles];
  const typed = inputText.value.trim();
  const text = typed || (files.length ? "Please look at the attached file(s)." : "");
  if (!text || isLoading) return;
  if (!unlimited() && freeRemaining() <= 0) {
    showLimitCard();
    updateQuotaUI();
    return;
  }
  if (needsVision(files) && ["deepseek", "v0"].includes(settings.provider)) {
    return toast(`${providerLabel(settings.provider)} cannot read images or PDFs. Choose Auto, OpenAI or Anthropic.`);
  }
  $("#limitCard")?.remove();

  isLoading = true;
  inputText.value = "";
  pendingFiles = [];
  renderAttachments();
  autoSizeInput();
  updateComposer();
  const fileNames = files.map(file => file.name);
  chatBox.querySelector(".starter-list")?.remove(); // the suggestions are for an empty chat
  history.push({ role: "user", text, ...(fileNames.length ? { files: fileNames } : {}), at: Date.now() });
  const userMessage = addMessageToDOM("user", text, true, false, fileNames);
  await persistHistory();
  showTyping();
  connectionLabel.textContent = "Working…";

  try {
    const mode = MODES[settings.mode] || MODES.chat;
    // Attachments are a hosted, Premium feature, so they always go through our server.
    const useOwnKey = hasOwnKey() && !files.length;
    const result = useOwnKey
      ? await sendOwnKeyRequest({ provider: byok.provider, key: byok.key, model: byok.model, prompt: text, system: mode.system })
      : await sendAssistantRequest({ prompt: text, system: mode.system, provider: settings.provider, licenseKey: settings.licenseKey, clientId, attachments: files });
    removeTyping();
    lastAssistantText = result.text;
    history.push({ role: "assistant", text: result.text, at: Date.now() });
    // The server counts free chats when it can; otherwise this browser does.
    if (result.quota) serverQuota = result.quota;
    else if (!useOwnKey && !hasLicense()) freeChatsUsed += 1;
    addMessageToDOM("assistant", result.text);
    await Promise.all([persistHistory(), persistQuota()]);
    updateQuotaUI();
    connectionLabel.textContent = "Connected";
  } catch (error) {
    console.error("[Smart Chat] Chat request error", {
      message: error?.message,
      status: error?.status,
      code: error?.code,
      upstreamStatus: error?.upstreamStatus,
      upstreamCode: error?.upstreamCode,
      provider: error?.provider,
      retryAfter: error?.retryAfter
    });
    removeTyping();
    if (error.code === "free_limit_reached" || error.code === "free_limit_ip") {
      // Not an error to keep in the chat: take the message back and offer the way forward.
      if (error.quota) serverQuota = error.quota;
      history.pop();
      userMessage.remove();
      await persistHistory();
      if (!history.length) renderEmptyState();
      inputText.value = typed;
      pendingFiles = files;
      renderAttachments();
      autoSizeInput();
      showLimitCard(error.code === "free_limit_ip" ? { body: error.message } : {});
      updateQuotaUI();
      connectionLabel.textContent = "Limit reached";
      return;
    }
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
  if (error.code === "paid_required" || error.code === "attachments_paid" || String(error.code || "").startsWith("license_")) {
    showUpgrade(error.upgradeUrl);
    return error.message;
  }
  if (error.status === 413 && !error.code) return "The files are too large to send. Keep them under 3 MB in total.";
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
  const remaining = freeRemaining();
  const usedPercent = Math.min(100, Math.round(((freeLimit() - remaining) / freeLimit()) * 100));
  if (hasOwnKey()) {
    $("#quotaLabel").textContent = "Your key";
    $("#quotaText").textContent = `${BYOK_PROVIDERS[byok.provider].label}, unlimited`;
    $("#quotaFill").style.width = "0%";
  } else if (hasLicense()) {
    $("#quotaLabel").textContent = "Premium";
    $("#quotaText").textContent = "Unlimited chats";
    $("#quotaFill").style.width = "0%";
  } else {
    $("#quotaLabel").textContent = "Free plan";
    $("#quotaText").textContent = remaining === 1 ? "1 chat left" : `${remaining} chats left`;
    $("#quotaFill").style.width = `${usedPercent}%`;
  }
  document.body.classList.toggle("quota-empty", !unlimited() && remaining === 0);
  $("#planActions").hidden = unlimited();
  updateComposer();
}

function updateComposer() {
  charCounter.textContent = `${inputText.value.length} / 6000`;
  const hasInput = Boolean(inputText.value.trim()) || pendingFiles.length > 0;
  sendBtn.disabled = isLoading || !hasInput || (!unlimited() && freeRemaining() <= 0);
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
