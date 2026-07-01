const $ = (selector) => document.querySelector(selector);
const storageKey = "ledger-financial-chat-v2";

const els = {
  chat: $("#chat"),
  messages: $("#messages"),
  welcome: $("#welcome"),
  form: $("#chat-form"),
  prompt: $("#prompt"),
  send: $("#send-button"),
  count: $("#character-count"),
  title: $("#chat-title"),
  modelLabel: $("#model-label"),
  conversations: $("#conversations"),
  status: $("#connection-status"),
  statusText: $("#status-text"),
  settings: $("#settings-dialog"),
  settingsForm: $("#settings-form"),
  provider: $("#provider"),
  baseUrl: $("#base-url"),
  model: $("#model"),
  temperature: $("#temperature"),
  temperatureValue: $("#temperature-value"),
  maxTokens: $("#max-tokens"),
  connectionTest: $("#connection-test"),
  toast: $("#toast"),
  sidebar: $("#sidebar")
};

let defaults;
let state = loadState();
let activeController = null;

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    if (parsed?.conversations && Array.isArray(parsed.conversations)) return parsed;
  } catch {}
  return { activeId: null, conversations: [], settings: null };
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function createConversation() {
  const conversation = {
    id: crypto.randomUUID(),
    title: "Nouvelle analyse",
    createdAt: Date.now(),
    messages: []
  };
  state.conversations.unshift(conversation);
  state.activeId = conversation.id;
  saveState();
  render();
  els.prompt.focus();
  return conversation;
}

function activeConversation() {
  return state.conversations.find((item) => item.id === state.activeId) || null;
}

function currentSettings() {
  const provider = state.settings?.provider || defaults.provider;
  return {
    provider,
    baseUrl: state.settings?.baseUrl || defaults.urls[provider],
    model: state.settings?.model || defaults.models[provider],
    temperature: Number(state.settings?.temperature ?? 0.7),
    maxTokens: Number(state.settings?.maxTokens ?? 512)
  };
}

function timeLabel(timestamp) {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function renderText(text) {
  const safe = escapeHtml(text);
  const blocks = safe.split(/```/);
  return blocks.map((block, index) => {
    if (index % 2) return `<pre><code>${block.replace(/^[^\n]*\n/, "")}</code></pre>`;
    return block
      .split(/\n{2,}/)
      .map((paragraph) => {
        const lines = paragraph.split("\n");
        if (lines.every((line) => /^[-*] /.test(line))) {
          return `<ul>${lines.map((line) => `<li>${line.slice(2)}</li>`).join("")}</ul>`;
        }
        return `<p>${paragraph.replace(/\n/g, "<br>").replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`;
      })
      .join("");
  }).join("");
}

function messageElement(message) {
  const fragment = $("#message-template").content.cloneNode(true);
  const article = fragment.querySelector(".message");
  const isUser = message.role === "user";
  article.classList.add(message.role);
  fragment.querySelector(".avatar").textContent = isUser ? "VO" : "L";
  fragment.querySelector(".message-author").textContent = isUser ? "Vous" : "Ledger";
  fragment.querySelector(".message-time").textContent = timeLabel(message.createdAt);
  const body = fragment.querySelector(".message-body");
  if (message.pending && !message.content) {
    body.innerHTML = '<span class="typing" aria-label="Génération en cours"><i></i><i></i><i></i></span>';
  } else {
    body.innerHTML = renderText(message.content);
  }
  const meta = fragment.querySelector(".message-meta");
  if (message.error) {
    meta.textContent = message.error;
    meta.style.color = "var(--danger)";
  } else if (message.metrics) {
    const details = [
      message.metrics.durationMs && `${(message.metrics.durationMs / 1000).toFixed(1)} s`,
      message.metrics.completionTokens && `${message.metrics.completionTokens} tokens`
    ].filter(Boolean);
    meta.textContent = details.join(" · ");
  }
  return fragment;
}

function renderMessages() {
  const conversation = activeConversation();
  els.messages.replaceChildren();
  const hasMessages = Boolean(conversation?.messages.length);
  els.welcome.classList.toggle("hidden", hasMessages);
  if (hasMessages) {
    conversation.messages.forEach((message) => els.messages.append(messageElement(message)));
  }
  requestAnimationFrame(() => { els.chat.scrollTop = els.chat.scrollHeight; });
}

function renderConversations() {
  els.conversations.replaceChildren();
  state.conversations.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `conversation-item${conversation.id === state.activeId ? " active" : ""}`;
    button.textContent = conversation.title;
    button.title = conversation.title;
    button.addEventListener("click", () => {
      state.activeId = conversation.id;
      saveState();
      render();
      closeSidebar();
    });
    els.conversations.append(button);
  });
}

function render() {
  const conversation = activeConversation();
  const settings = defaults ? currentSettings() : null;
  els.title.textContent = conversation?.title || "Nouvelle analyse";
  if (settings) {
    els.modelLabel.textContent = `${settings.provider.toUpperCase()} · ${settings.model}`;
  }
  renderConversations();
  renderMessages();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  setTimeout(() => els.toast.classList.remove("visible"), 2200);
}

function setStatus(kind, message) {
  els.status.className = `status-pill ${kind}`;
  els.statusText.textContent = message;
}

async function testConnection(settings = currentSettings(), updatePanel = false) {
  setStatus("checking", "Vérification…");
  if (updatePanel) {
    els.connectionTest.className = "connection-test checking";
    els.connectionTest.lastElementChild.textContent = "Test en cours…";
  }
  try {
    const response = await fetch("/api/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setStatus("online", `Connecté · ${data.latencyMs} ms`);
    if (updatePanel) {
      els.connectionTest.className = "connection-test online";
      els.connectionTest.lastElementChild.textContent = `Serveur disponible · ${data.latencyMs} ms`;
    }
    return true;
  } catch (error) {
    setStatus("offline", "Déconnecté");
    if (updatePanel) {
      els.connectionTest.className = "connection-test offline";
      els.connectionTest.lastElementChild.textContent = error.message;
    }
    return false;
  }
}

function settingsFromForm() {
  return {
    provider: els.provider.value,
    baseUrl: els.baseUrl.value.trim(),
    model: els.model.value.trim(),
    temperature: Number(els.temperature.value),
    maxTokens: Number(els.maxTokens.value)
  };
}

function fillSettings() {
  const settings = currentSettings();
  els.provider.value = settings.provider;
  els.baseUrl.value = settings.baseUrl;
  els.model.value = settings.model;
  els.temperature.value = settings.temperature;
  els.temperatureValue.textContent = settings.temperature.toFixed(1);
  els.maxTokens.value = settings.maxTokens;
}

function openSettings() {
  fillSettings();
  els.settings.showModal();
}

function resizePrompt() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 160)}px`;
  els.count.textContent = `${els.prompt.value.length.toLocaleString("fr-FR")} / 20 000`;
}

function parseEventBlock(block) {
  let type = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  return data ? { type, data: JSON.parse(data) } : null;
}

async function sendMessage(content) {
  const conversation = activeConversation() || createConversation();
  if (activeController) return;
  const userMessage = { role: "user", content, createdAt: Date.now() };
  const assistantMessage = { role: "assistant", content: "", createdAt: Date.now(), pending: true };
  conversation.messages.push(userMessage, assistantMessage);
  if (conversation.messages.length === 2) {
    conversation.title = content.length > 46 ? `${content.slice(0, 46)}…` : content;
  }
  saveState();
  render();

  activeController = new AbortController();
  els.send.disabled = true;
  try {
    const apiMessages = conversation.messages
      .filter((message) => !message.pending || message.content)
      .map(({ role, content: text }) => ({ role, content: text }));
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: currentSettings(), messages: apiMessages }),
      signal: activeController.signal
    });
    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Erreur HTTP ${response.status}`);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value.replace(/\r/g, "");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const event = parseEventBlock(block);
        if (!event) continue;
        if (event.type === "token") {
          assistantMessage.pending = false;
          assistantMessage.content += event.data.content;
          renderMessages();
        } else if (event.type === "done") {
          assistantMessage.metrics = event.data;
        } else if (event.type === "error") {
          throw new Error(event.data.message);
        }
      }
    }
    if (!assistantMessage.content) throw new Error("Le modèle a renvoyé une réponse vide.");
    setStatus("online", "Connecté");
  } catch (error) {
    if (error.name !== "AbortError") {
      assistantMessage.pending = false;
      assistantMessage.error = error.message;
      assistantMessage.content ||= "Impossible d’obtenir une réponse du modèle.";
      setStatus("offline", "Erreur serveur");
    }
  } finally {
    assistantMessage.pending = false;
    activeController = null;
    els.send.disabled = false;
    saveState();
    render();
  }
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
}

function exportConversation() {
  const conversation = activeConversation();
  if (!conversation?.messages.length) return showToast("Aucune conversation à exporter");
  const content = [
    `# ${conversation.title}`,
    "",
    `Exporté le ${new Date().toLocaleString("fr-FR")}`,
    "",
    ...conversation.messages.flatMap((message) => [
      `## ${message.role === "user" ? "Vous" : "Ledger"}`,
      "",
      message.content,
      ""
    ])
  ].join("\n");
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ledger-${conversation.id.slice(0, 8)}.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const content = els.prompt.value.trim();
  if (!content) return;
  els.prompt.value = "";
  resizePrompt();
  sendMessage(content);
});
els.prompt.addEventListener("input", resizePrompt);
els.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.form.requestSubmit();
  }
});
$("#suggestions").addEventListener("click", (event) => {
  const button = event.target.closest("[data-prompt]");
  if (button) sendMessage(button.dataset.prompt);
});
$("#new-chat").addEventListener("click", createConversation);
$("#export-chat").addEventListener("click", exportConversation);
$("#open-settings").addEventListener("click", openSettings);
els.status.addEventListener("click", () => testConnection());
$("#test-connection").addEventListener("click", () => testConnection(settingsFromForm(), true));
els.temperature.addEventListener("input", () => {
  els.temperatureValue.textContent = Number(els.temperature.value).toFixed(1);
});
els.provider.addEventListener("change", () => {
  els.baseUrl.value = defaults.urls[els.provider.value];
  els.model.value = defaults.models[els.provider.value];
});
els.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.settings = settingsFromForm();
  saveState();
  els.settings.close();
  render();
  testConnection();
  showToast("Paramètres enregistrés");
});
$("#menu-toggle").addEventListener("click", () => els.sidebar.classList.toggle("open"));

async function init() {
  try {
    const response = await fetch("/api/config");
    defaults = await response.json();
    if (!state.activeId && state.conversations.length) state.activeId = state.conversations[0].id;
    render();
    resizePrompt();
    testConnection();
  } catch {
    setStatus("offline", "Configuration indisponible");
  }
}

init();
