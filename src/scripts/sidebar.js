import { renderMarkdown } from "../lib/markdown.js";
import { fetchConfig, fetchQuota, sendAssistantRequest, setClientVersion } from "../lib/api.js";
import { DEFAULT_CONFIG, needsUpdate, normalizeConfig, systemPromptFor, upgradeLabel } from "../lib/config.js";
import { ACCEPT, checkPicked, formatSize, needsVision, readAttachment } from "../lib/attachments.js";
import { BYOK_PROVIDERS, BYOK_IDS, keyProblem, maskKey, sendOwnKeyRequest, testOwnKey } from "../lib/byok.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const MODES = {
  chat: {
    kicker: "GENERAL ASSISTANT",
    title: "What can I help with?",
    description: "Ask a question or work through something without leaving the page.",
    placeholder: "Ask anything…",
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
    starters: [
      ["Simple terms", "Explain this in simple terms: "],
      ["Step by step", "Explain this step by step: "],
      ["With example", "Explain this and give one practical example: "]
    ]
  }
};

const DEFAULT_SETTINGS = { theme: "light", mode: "chat", quality: "standard", licenseKey: "" };
let settings = { ...DEFAULT_SETTINGS };
let history = [];
let config = DEFAULT_CONFIG; // plans, limits, copy, prompts and switches: from the server, with built-in defaults
let quota = null; // this browser's usage as the server counts it: { plan, period, used, limit, remaining, resetsAt, premium? }
let byok = null; // { provider, key, model, enabled }: the user's own API key, kept only in this browser
let clientId = ""; // random id made on first run; the server counts free messages against it
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

function storageGet(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); }
function storageSet(data) { return new Promise(resolve => chrome.storage.local.set(data, resolve)); }

async function init() {
  const stored = await storageGet(["settings", "chatHistory", "byok", "clientId", "configCache"]);
  clientId = typeof stored.clientId === "string" && stored.clientId ? stored.clientId : crypto.randomUUID();
  if (clientId !== stored.clientId) await storageSet({ clientId });
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  byok = stored.byok?.key && BYOK_PROVIDERS[stored.byok.provider] ? stored.byok : null;
  history = Array.isArray(stored.chatHistory) ? stored.chatHistory.slice(-50) : [];
  setClientVersion(extensionVersion());
  // The last settings the server sent (or the built-in ones), so the panel is right immediately.
  config = normalizeConfig(stored.configCache);
  applySettingsToUI();
  renderHistory();
  renderByokCard();
  applyConfig();
  updateComposer();
  bindEvents();
  refreshConfig(); // the server's current settings, in the background
}

const extensionVersion = () => { try { return chrome.runtime.getManifest().version; } catch { return ""; } };

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
  $("#qualityBtn").addEventListener("click", onQualityClick);
  $("#copyBtn").addEventListener("click", copyLastReply);
  $("#insertBtn").addEventListener("click", insertLastReply);
  $("#intentCustom").addEventListener("input", () => {
    if ($("#intentCustom").value && intentId) { intentId = ""; renderIntents(); }
  });
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
  $("#licenseInput").value = settings.licenseKey || "";
  connectionLabel.textContent = "Ready";
}

let intentId = ""; // the chosen intent chip, or "" for none (the custom field is separate)

function renderIntents() {
  const row = $("#intentRow");
  row.hidden = settings.mode !== "rewrite";
  const chips = $("#intentChips");
  chips.innerHTML = "";
  for (const { id, label } of config.intents || []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `intent-chip${id === intentId ? " is-on" : ""}`;
    chip.textContent = label;
    chip.setAttribute("aria-pressed", String(id === intentId));
    chip.addEventListener("click", () => {
      intentId = intentId === id ? "" : id;
      if (intentId) $("#intentCustom").value = "";
      renderIntents();
    });
    chips.append(chip);
  }
}

// What the server (or the own-key prompt) is told the rewrite should do.
function currentIntent() {
  if (settings.mode !== "rewrite") return { value: "", label: "" };
  const custom = $("#intentCustom").value.trim();
  if (custom) return { value: custom, label: custom };
  const chosen = (config.intents || []).find(item => item.id === intentId);
  return chosen ? { value: chosen.id, label: chosen.label } : { value: "", label: "" };
}

function updateModeUI() {
  const mode = MODES[settings.mode] || MODES.chat;
  $$(".mode-pill").forEach(item => item.classList.toggle("is-active", item.dataset.mode === settings.mode));
  $("#modeKicker").textContent = mode.kicker;
  $("#modeTitle").textContent = mode.title;
  $("#modeDescription").textContent = mode.description;
  inputText.placeholder = mode.placeholder;
  renderIntents();
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

// ---- the server's settings ----

// Loads the server's current settings, remembers them for next time, and applies them.
async function refreshConfig() {
  const raw = await fetchConfig();
  if (!raw) return false;
  config = normalizeConfig(raw);
  await storageSet({ configCache: config });
  applyConfig();
  return true;
}

// Builds everything that depends on the settings. Safe to call at any time.
function applyUpgradeLinks() {
  const url = config.upgradeUrl;
  for (const id of ["#upgradeLink", "#upgradeBtn"]) {
    const link = $(id);
    if (url) link.href = url;
    link.hidden = !url;
  }
  $("#upgradeBtn").textContent = upgradeLabel(config);
}

function applyConfig() {
  applyUpgradeLinks();
  renderIntents();
  $("#envNote").hidden = config.environment !== "sandbox";

  const outdated = needsUpdate(config, extensionVersion());
  $("#updateBanner").hidden = !outdated;
  $("#updateBanner").textContent = outdated ? config.updateMessage : "";

  // Feature switches the server can flip without an extension release.
  $("#attachBtn").hidden = !config.features.attachments;
  $("#qualityBtn").hidden = !config.features.premium;
  $("#ownKeyCard").hidden = !config.features.ownKey;
  $("#ownKeyBtn").hidden = !config.features.ownKey;

  renderQualityButton();
  renderUsageCard();
  updateQuotaUI();
  if (config.usageCounted) refreshQuota();
}

// This browser's usage as the server counts it. Returns the result so callers can react to it.
async function refreshQuota() {
  const result = await fetchQuota({ clientId, licenseKey: settings.licenseKey });
  quota = result.status === "ok" ? result.quota : null;
  renderUsageCard();
  updateQuotaUI();
  renderQualityButton();
  return result;
}

const hasOwnKey = () => Boolean(config.features.ownKey && byok?.key && byok.enabled !== false);
const hasLicense = () => Boolean(settings.licenseKey);
// Premium requests (Claude) are on when the user is paid, the server offers them, and the toggle is on.
const premiumOn = () => hasLicense() && config.features.premium && settings.quality === "premium";

const shortDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }); } catch { return ""; } };
const meterPercent = (q) => (q.limit > 0 ? Math.min(100, Math.round((q.used / q.limit) * 100)) : 100);

function renderQualityButton() {
  const on = premiumOn();
  const left = quota?.premium?.remaining;
  $("#qualityBtn").classList.toggle("is-on", on);
  $("#qualityBtn").setAttribute("aria-pressed", String(on));
  $("#qualityLabel").textContent = on ? (Number.isFinite(left) ? `Premium · ${left} left` : "Premium on") : "Premium";
  $("#qualityBtn").title = on ? "Premium requests are on. Click to switch back to standard." : "Use a premium request (Claude) for your messages";
}

async function onQualityClick() {
  if (!hasLicense()) {
    showLimitCard({ title: "Premium requests are a Premium feature", body: `Upgrade to ${config.plans.pro.name} to use them.`, ownKey: false, perks: config.plans.pro.perks });
    return;
  }
  settings.quality = premiumOn() ? "standard" : "premium";
  await persistSettings();
  renderQualityButton();
}

// What the quota row and the plan card say, from the server's numbers.
function updateQuotaUI() {
  const { free, pro } = config.plans;
  const q = quota;
  let pct = 0;
  if (hasOwnKey()) {
    $("#quotaLabel").textContent = "Your key";
    $("#quotaText").textContent = `${BYOK_PROVIDERS[byok.provider].label}, no limit`;
  } else if (hasLicense()) {
    $("#quotaLabel").textContent = pro.name;
    if (q?.plan === "pro") { $("#quotaText").textContent = `${q.remaining} of ${q.limit} left`; pct = meterPercent(q); }
    else $("#quotaText").textContent = "Active";
  } else {
    $("#quotaLabel").textContent = free.name;
    if (q?.plan === "free") { $("#quotaText").textContent = `${q.remaining} of ${q.limit} left today`; pct = meterPercent(q); }
    else $("#quotaText").textContent = free.perks[0] || "";
  }
  $("#quotaFill").style.width = `${pct}%`;
  document.body.classList.toggle("quota-empty", !hasOwnKey() && Boolean(q) && q.remaining === 0);
  $("#planActions").hidden = hasOwnKey() || hasLicense();
  updateComposer();
}

function renderUsageCard() {
  const { free, pro } = config.plans;
  const q = quota;
  const paid = hasLicense();
  $("#usagePlan").textContent = paid ? pro.name : free.name;
  const lines = [];
  if (paid && q?.plan === "pro") {
    lines.push(`${q.used} of ${q.limit} messages used this month${q.premium?.limit ? `, ${q.premium.used} of ${q.premium.limit} premium requests` : ""}. Resets ${shortDate(q.resetsAt)}.`);
  } else if (paid) {
    lines.push("Your license is saved. Your usage appears here once the service answers.");
  } else if (q?.plan === "free") {
    lines.push(`${q.used} of ${q.limit} messages used today. They come back at midnight UTC.`);
  } else {
    lines.push(free.perks[0] || "");
  }
  if (hasOwnKey()) lines.push("Chats with your own key are not counted here.");
  if (!paid && pro.perks.length) lines.push(`${pro.name}${pro.price ? ` (${pro.price})` : ""} includes:`);
  $("#usageDetail").textContent = lines.filter(Boolean).join(" ");
  $("#usagePerks").innerHTML = pro.perks.map(perk => `<li>${escapeText(perk)}</li>`).join("");
}

// ---- attachments (Premium) ----

function renderAttachments() {
  const list = $("#attachList");
  list.hidden = !pendingFiles.length;
  const chips = pendingFiles.map((file, i) => `
    <span class="attach-chip"><span title="${escapeAttr(file.name)}">${escapeText(file.name)}</span><small>${formatSize(file.size)}</small><button type="button" data-remove-attachment="${i}" aria-label="Remove ${escapeAttr(file.name)}">×</button></span>`).join("");
  // Images and PDFs need a premium model, so they use a premium request.
  const left = quota?.premium?.remaining;
  const note = needsVision(pendingFiles) ? `<span class="attach-note">Images and PDFs use 1 premium request${Number.isFinite(left) ? ` (${left} left)` : ""}.</span>` : "";
  list.innerHTML = chips + note;
  updateComposer();
}

function onAttachClick() {
  if (!hasLicense()) {
    showLimitCard({ title: "Attachments are a Premium feature", body: `Upgrade to ${config.plans.pro.name} to add images, PDFs and text files to your chat.`, ownKey: false, perks: config.plans.pro.perks });
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
function showLimitCard({ title, body, upgrade = true, ownKey = true, perks = [] } = {}) {
  $("#limitCard")?.remove();
  const card = document.createElement("div");
  card.id = "limitCard";
  card.className = "limit-card";
  const url = upgrade ? config.upgradeUrl : null;
  const actions = [
    url ? `<a class="plan-btn primary" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeText(upgradeLabel(config))}</a>` : "",
    ownKey && config.features.ownKey ? '<button class="plan-btn" type="button" data-open-own-key>Use your own key</button>' : ""
  ].filter(Boolean).join("");
  card.innerHTML = `
    <strong>${escapeText(title)}</strong>
    <p>${escapeText(body)}</p>
    ${perks.length ? `<ul class="perk-list">${perks.map(perk => `<li>${escapeText(perk)}</li>`).join("")}</ul>` : ""}
    ${actions ? `<div class="plan-actions">${actions}</div>` : ""}`;
  chatBox.append(card);
  scrollToBottom();
}

// The server refuses a message with a code and its own wording (the numbers are always current).
// Here is only how each refusal is presented.
const REFUSALS = {
  free_limit_reached: { title: "Daily limit reached", upgrade: true, ownKey: true, perks: true },
  free_limit_ip: { title: "Limit reached on this network", upgrade: true, ownKey: true, perks: true },
  pro_limit_reached: { title: "Monthly limit reached", upgrade: false, ownKey: true },
  premium_limit_reached: { title: "Premium requests used", upgrade: false, ownKey: false },
  premium_required: { title: "Premium feature", upgrade: true, ownKey: false, perks: true },
  attachments_paid: { title: "Premium feature", upgrade: true, ownKey: false, perks: true },
  update_required: { title: "Update needed", upgrade: false, ownKey: false }
};

async function saveLicense() {
  const button = $("#saveLicense");
  settings.licenseKey = $("#licenseInput").value.trim();
  await persistSettings();
  quota = null;
  if (!settings.licenseKey) {
    setLicenseStatus("License removed.", "");
    updateQuotaUI();
    renderUsageCard();
    renderQualityButton();
    refreshQuota();
    return;
  }
  button.disabled = true;
  setLicenseStatus("Verifying…", "");
  try {
    const result = await refreshQuota();
    if (result.status === "ok") setLicenseStatus(`License verified. ${config.plans.pro.name} is active.`, "success");
    else if (result.status === "off") setLicenseStatus("Paid plans are not switched on yet, so everyone has access for now.", "");
    else if (result.status === "denied") setLicenseStatus("That license was not accepted. Check the key, or that the subscription is active.", "error");
    else setLicenseStatus("Could not check the license right now. Please try again.", "error");
  } finally {
    button.disabled = false;
    updateQuotaUI();
  }
}

// Reloads the server's settings and shows a clear message about whether the service answered.
async function testConnection() {
  const button = $("#testConnection");
  button.disabled = true;
  button.textContent = "Checking…";
  setSettingsStatus("", "");
  try {
    const ok = await refreshConfig();
    if (!ok) throw new Error("Could not reach the service. Check your internet connection and try again.");
    setSettingsStatus(`Connected. Settings loaded for the ${config.plans.free.name} and ${config.plans.pro.name} plans.`, "success");
    connectionLabel.textContent = "Connected";
  } catch (error) {
    console.error("[Smart Chat] Connection test error", error);
    setSettingsStatus(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Check connection";
  }
}

function setSettingsStatus(message, type) {
  const el = $("#settingsStatus");
  el.textContent = message;
  el.className = `settings-status${type ? ` ${type}` : ""}`;
}

async function persistSettings() { await storageSet({ settings }); }
async function persistHistory() { await storageSet({ chatHistory: history.slice(-50) }); }

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
    const intent = currentIntent();
    const system = systemPromptFor(config, settings.mode) + (intent.label ? `\n\nIntent for this rewrite: ${intent.label.slice(0, 200)}` : "");
    // Premium requests and attachments are hosted features, so they always go through our server.
    const useOwnKey = hasOwnKey() && !files.length && !premiumOn();
    const result = useOwnKey
      ? await sendOwnKeyRequest({ provider: byok.provider, key: byok.key, model: byok.model, prompt: text, system })
      : await sendAssistantRequest({ prompt: text, system, mode: settings.mode, intent: intent.value, quality: premiumOn() ? "premium" : "standard", licenseKey: settings.licenseKey, clientId, attachments: files });
    removeTyping();
    lastAssistantText = result.text;
    history.push({ role: "assistant", text: result.text, at: Date.now() });
    if (result.quota) quota = result.quota; // the server's count, after this message
    addMessageToDOM("assistant", result.text);
    await persistHistory();
    updateQuotaUI();
    renderUsageCard();
    renderQualityButton();
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
    const refusal = REFUSALS[error.code];
    if (refusal) {
      // Not an error to keep in the chat: take the message back and show the way forward.
      if (error.quota) quota = error.quota;
      if (error.upgradeUrl && /^https:\/\//.test(error.upgradeUrl)) config = { ...config, upgradeUrl: error.upgradeUrl };
      if (error.code === "premium_limit_reached") { settings.quality = "standard"; await persistSettings(); }
      if (error.code === "update_required") { $("#updateBanner").textContent = error.message; $("#updateBanner").hidden = false; }
      history.pop();
      userMessage.remove();
      await persistHistory();
      if (!history.length) renderEmptyState();
      inputText.value = typed;
      pendingFiles = files;
      renderAttachments();
      autoSizeInput();
      showLimitCard({ title: refusal.title, body: error.message, upgrade: refusal.upgrade, ownKey: refusal.ownKey, perks: refusal.perks ? config.plans.pro.perks : [] });
      applyUpgradeLinks();
      updateQuotaUI();
      renderUsageCard();
      renderQualityButton();
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
  if (error.status === 0) return error.message;
  if (error.status === 413 && !error.code) return "The files are too large to send. Keep them under 3 MB in total.";
  if (error.status === 429 && !error.hint) {
    return `The AI service is rate limited right now.${error.retryAfter ? ` Try again in about ${error.retryAfter} seconds.` : " Please try again shortly."}`;
  }
  const message = error.message || "Something went wrong while contacting the AI service.";
  return error.hint ? `${message}\n\n${error.hint}` : message;
}

function updateComposer() {
  charCounter.textContent = `${inputText.value.length} / 6000`;
  // The server decides what is allowed and says why, so the button is only off while there is nothing to send.
  sendBtn.disabled = isLoading || !(inputText.value.trim() || pendingFiles.length);
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
