const HISTORY_KEY = "mycrew_chat_history";
const SELECTED_KEY = "mycrew_selected_persona";

function loadStoredHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

const state = {
  selectedPersona: null,
  personas: [],
  historyByPersona: loadStoredHistory(),
  activeFlowId: null,
  typingPersonaId: null,
  knowledgeFiles: [],
};

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.historyByPersona));
  } catch {
    /* ignore quota errors */
  }
}

function rememberSelected(personaId) {
  try {
    localStorage.setItem(SELECTED_KEY, personaId || "");
  } catch {
    /* ignore */
  }
}

const kpiRow = document.getElementById("kpi-row");
const stackList = document.getElementById("stack-list");
const stackCount = document.getElementById("stack-count");
const modelsList = document.getElementById("models-list");
const modelsCount = document.getElementById("models-count");
const agentsRail = document.getElementById("agents-rail");
const agentsRailCount = document.getElementById("agents-rail-count");
const personasBox = document.getElementById("personas-box");
const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const chatTitle = document.getElementById("chat-title");
const chatAvatar = document.getElementById("chat-avatar");
const chatModelBadge = document.getElementById("chat-model-badge");
const chatStatus = document.getElementById("chat-status");
const knowledgeResult = document.getElementById("knowledge-result");
const flowStatus = document.getElementById("flow-status");
const chatSwitcher = document.getElementById("chat-switcher");
const knowledgeAgent = document.getElementById("knowledge-agent");
const knowledgeTitle = document.getElementById("knowledge-title");
const knowledgeContent = document.getElementById("knowledge-content");
const knowledgeFilesInput = document.getElementById("knowledge-files");
const knowledgeBrowse = document.getElementById("knowledge-browse");
const knowledgeDropzone = document.getElementById("knowledge-dropzone");
const knowledgeFileList = document.getElementById("knowledge-file-list");
const stackHealth = document.getElementById("stack-health");
const stackDot = document.getElementById("stack-dot");
const stackSub = document.getElementById("stack-sub");
const agentSearch = document.getElementById("agent-search");
const linkQdrantDashboard = document.getElementById("link-qdrant-dashboard");
const linkPortainer = document.getElementById("link-portainer");
const linkDozzle = document.getElementById("link-dozzle");
const linkAider = document.getElementById("link-aider");
const linkLitellm = document.getElementById("link-litellm");
const linkWatchtower = document.getElementById("link-watchtower");
const dozzleFrame = document.getElementById("dozzle-frame");

function esc(value) {
  var s = String(value || "");
  return s
    .replace(/&/g, function() { return "&"; })
    .replace(/</g, function() { return "<"; })
    .replace(/>/g, function() { return ">"; })
    .replace(/"/g, function() { return '"'; })
    .replace(/'/g, function() { return "'"; });
}

function ensurePersonaSelected() {
  if (!state.selectedPersona) {
    throw new Error("Selecione um agente primeiro.");
  }
  return state.selectedPersona;
}

function setResult(el, value) {
  el.textContent = value;
}

function setActivePage(target) {
  const pages = document.querySelectorAll(".page");
  const navItems = document.querySelectorAll(".nav-item");

  pages.forEach((page) => page.classList.remove("active"));
  navItems.forEach((item) => item.classList.remove("active"));

  const targetPage = document.getElementById(`page-${target}`);
  const targetBtn = document.querySelector(`.nav-item[data-target='${target}']`);
  if (targetPage) targetPage.classList.add("active");
  if (targetBtn) targetBtn.classList.add("active");

  if (target === "monitor" && dozzleFrame && dozzleFrame.dataset.src && dozzleFrame.src === "about:blank") {
    dozzleFrame.src = dozzleFrame.dataset.src;
  }
}

function agentAvatarLabel(nome) {
  const parts = String(nome || "?").trim().split(/\s+/);
  const first = parts[0]?.[0] || "?";
  const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + second).toUpperCase();
}

function avatarInner(persona) {
  const label = esc(agentAvatarLabel(persona?.nome));
  if (persona && persona.avatar) {
    return `<span class='av-fallback'>${label}</span><img src='${esc(persona.avatar)}' alt='' onerror='this.remove()' />`;
  }
  return label;
}

function avatarHtml(persona, extraClass = "") {
  const cls = `agent-avatar ${extraClass}`.trim();
  return `<div class='${cls}'>${avatarInner(persona)}</div>`;
}

function agentStatus(persona) {
  const id = persona?.id;
  if (id && state.typingPersonaId === id) return { cls: "typing", label: "digitando…" };
  if (id && state.selectedPersona?.id === id) return { cls: "chatting", label: "em conversa" };
  return { cls: "online", label: "disponível" };
}

function renderKpis(data) {
  const c = data.counters || {};
  const cards = [
    { cls: "violet", label: "Agentes", value: String(c.openwebui_agents ?? 0), foot: "OpenWebUI + locais" },
    { cls: "green", label: "Serviços online", value: `${c.services_online ?? 0}<small>/${c.services_total ?? 0}</small>`, foot: "infra da stack" },
    { cls: "blue", label: "Modelos", value: String(c.models_total ?? 0), foot: "Ollama" },
    { cls: "amber", label: "Coleção Qdrant", value: esc(data.qdrant_collection || "-"), foot: "memória vetorial", small: true },
  ];
  kpiRow.innerHTML = cards.map((k) => `
      <div class='kpi ${k.cls}'>
        <div class='kpi-label'>${esc(k.label)}</div>
        <div class='kpi-value ${k.small ? "mono" : ""}' style='${k.small ? "font-size:16px" : ""}'>${k.value}</div>
        <div class='kpi-foot'>${esc(k.foot)}</div>
      </div>`).join("");
}

function renderStack(data) {
  const services = data.services || [];
  const c = data.counters || {};
  const ep = data.endpoints || {};
  stackCount.textContent = `${c.services_online ?? 0}/${services.length}`;
  stackList.innerHTML = services.length
    ? services.map((s) => `
      <div class='stack-item'>
        <span class='svc-logo'><img src='/logos/${esc(s.key)}.svg' alt='' onerror='this.remove()' /></span>
        <span class='dot ${s.online ? "online" : "offline"}'></span>
        <div class='si-main'>
          <div class='si-label'>${esc(s.label)}</div>
          <a class='si-addr' href='${esc(s.address)}' target='_blank' rel='noreferrer'>${esc(s.address)}</a>
          ${s.key === "qdrant" && ep.qdrant_dashboard ? `<a class='si-addr si-dash' href='${esc(ep.qdrant_dashboard)}' target='_blank' rel='noreferrer'>Dashboard ↗</a>` : ""}
        </div>
        <span class='badge ${s.online ? "on" : "off"}'>${s.online ? "ONLINE" : "OFFLINE"}</span>
      </div>`).join("")
    : "<div class='model-empty'>Sem serviços.</div>";
}

function getProviderIcon(provider) {
  const icons = {
    ollama: "●",
    openai: "🤖",
    openrouter: "🔀",
    gemini: "G",
    groq: "⚡",
    xai: "🚀",
    anthropic: "🦙",
  };
  return icons[provider] || "◆";
}

function renderModels(modelsData) {
  let models = [];
  if (Array.isArray(modelsData)) {
    models = modelsData.map(m => typeof m === "string" ? { id: m, name: m, provider: "ollama", origin: "local" } : m);
  } else if (modelsData && modelsData.models) {
    models = modelsData.models;
  }
  if (!models.length && modelsData && modelsData.ollama_models) {
    models = modelsData.ollama_models.map(m => ({ id: m, name: m, provider: "ollama", origin: "local" }));
  }
  modelsCount.textContent = String(models.length);
  if (models.length === 0) {
    modelsList.innerHTML = "<div class='model-empty'>Nenhum modelo disponível.</div>";
    return;
  }
  const byProvider = {};
  models.forEach(m => {
    const provider = m.provider || "unknown";
    if (!byProvider[provider]) byProvider[provider] = [];
    byProvider[provider].push(m);
  });
  const providerOrder = { ollama: 0, openai: 1, openrouter: 2, gemini: 3, groq: 4, xai: 5, anthropic: 6 };
  const sortedProviders = Object.keys(byProvider).sort((a, b) => {
    const orderA = providerOrder[a] ?? 99;
    const orderB = providerOrder[b] ?? 99;
    return orderA - orderB || a.localeCompare(b);
  });
  modelsList.innerHTML = sortedProviders.map(provider => {
    const providerModels = byProvider[provider];
    const info = getProviderInfo(provider);
    const originBadge = provider === "ollama" ? "LOCAL" : "API";
    return `
        <div class='provider-group'>
          <div class='provider-header'>
            <span class='provider-icon'>${getProviderIcon(provider)}</span>
            <span class='provider-name'>${esc(info.label)}</span>
            <span class='badge ${provider === "ollama" ? "local" : "api"}-badge'>${originBadge}</span>
            <span class='provider-count'>${providerModels.length}</span>
          </div>
          <div class='provider-models'>
            ${providerModels.map(m => `
              <div class='model-item' title='${esc(m.id)}'>
                <span class='model-name'>${esc(m.name)}</span>
                ${m.mode ? `<span class='model-mode' title='Modo'>${esc(m.mode)}</span>` : ""}
              </div>`).join("")}
          </div>
        </div>`;
  }).join("");
}

function getProviderInfo(provider) {
  const providerData = {
    ollama: { label: "Ollama (Local)", color: "green" },
    openai: { label: "OpenAI", color: "blue" },
    openrouter: { label: "OpenRouter", color: "violet" },
    gemini: { label: "Google", color: "amber" },
    groq: { label: "Groq", color: "cyan" },
    xai: { label: "Grok", color: "pink" },
    anthropic: { label: "Anthropic", color: "orange" },
  };
  return providerData[provider] || { label: provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "Desconhecido", color: "muted" };
}

function renderSidebarHealth(data) {
  const c = data.counters || {};
  const online = c.services_online ?? 0;
  const total = c.services_total ?? 0;
  const allOk = total > 0 && online === total;
  stackDot.className = `dot ${online > 0 ? "online" : "offline"}`;
  stackHealth.textContent = allOk ? "ONLINE" : online > 0 ? "PARCIAL" : "OFFLINE";
  stackSub.textContent = `${online}/${total} serviços · ${c.models_total ?? 0} modelos`;
}

function renderEndpoints(data) {
  const ep = data.endpoints || {};
  if (ep.qdrant_dashboard && linkQdrantDashboard) linkQdrantDashboard.href = ep.qdrant_dashboard;
  if (ep.portainer && linkPortainer) linkPortainer.href = ep.portainer;
  if (ep.aider && linkAider) linkAider.href = ep.aider;
  if (ep.litellm && linkLitellm) linkLitellm.href = ep.litellm;
  if (ep.watchtower && linkWatchtower) linkWatchtower.href = ep.watchtower;
  if (linkDozzle) linkDozzle.href = "/dozzle/";
  if (dozzleFrame) dozzleFrame.dataset.src = "/dozzle/";
}

function agentCardHtml(persona, index) {
  const st = agentStatus(persona);
  return `<div class='agent-card' data-index='${index}'>
    <div class='agent-top'>
      ${avatarHtml(persona)}
      <div class='agent-id'>
        <strong>${esc(persona.nome)}</strong>
        <span>${esc(persona.papel || "Agente")}</span>
      </div>
    </div>
    <div class='agent-badges'>
      <span class='src-badge'>${esc(persona.source || "open-webui")}</span>
      <span class='model-badge' title='Modelo associado'>◆ ${esc(persona.model || "modelo")}</span>
    </div>
    <div class='agent-meta'>
      <span class='agent-status'><span class='dot ${st.cls}'></span>${esc(st.label)}</span>
      <button class='agent-open' data-open='${index}'>Abrir chat ▷</button>
    </div>
  </div>`;
}

function railRowHtml(persona, index) {
  const st = agentStatus(persona);
  const selected = state.selectedPersona?.id === persona.id ? "selected" : "";
  return `<button class='rail-row ${selected}' data-open='${index}'>
    ${avatarHtml(persona, "sm")}
    <div class='rail-info'>
      <div class='rail-top'>
        <strong>${esc(persona.nome)}</strong>
        <span class='rail-status ${st.cls}'>${esc(st.label)}</span>
      </div>
      <span class='rail-model' title='${esc(persona.model || "")}'>◆ ${esc(persona.model || "modelo")}</span>
    </div>
  </button>`;
}

function chatChipHtml(persona, index) {
  const st = agentStatus(persona);
  const selected = state.selectedPersona?.id === persona.id ? "selected" : "";
  return `<button class='chat-chip ${selected}' data-open='${index}' title='${esc(persona.nome)} · ${esc(st.label)}'>
    ${avatarHtml(persona, "xs")}
    <span class='chip-name'>${esc(persona.nome)}</span>
    <span class='dot ${st.cls}'></span>
  </button>`;
}

function renderChatHeader() {
  const persona = state.selectedPersona;
  if (chatAvatar) chatAvatar.innerHTML = persona ? avatarInner(persona) : "?";
  if (chatTitle) chatTitle.textContent = persona ? persona.nome : "Conversas";
  if (chatModelBadge) {
    if (persona) {
      chatModelBadge.hidden = false;
      chatModelBadge.textContent = `◆ ${persona.model || "modelo"}`;
    } else {
      chatModelBadge.hidden = true;
    }
  }
  if (chatStatus) {
    if (persona) {
      const st = agentStatus(persona);
      chatStatus.innerHTML = `<span class='dot ${st.cls}'></span>${esc(st.label)}`;
    } else {
      chatStatus.innerHTML = "<span class='dot'></span>selecione um agente";
    }
  }
}

function renderChat() {
  renderChatHeader();
  const personaId = state.selectedPersona?.id;
  if (!personaId) {
    chatLog.innerHTML = "<div class='msg assistant'>Selecione um agente para iniciar.</div>";
    return;
  }
  const history = state.historyByPersona[personaId] || [];
  let html = history.length
    ? history.map((item) => `<div class='msg ${item.role === "user" ? "user" : "assistant"}'>${esc(item.content)}</div>`).join("")
    : "<div class='msg assistant'>Conversa iniciada. Pode mandar a primeira mensagem.</div>";
  if (state.typingPersonaId === personaId) {
    html += "<div class='msg assistant typing-bubble'><span></span><span></span><span></span></div>";
  }
  chatLog.innerHTML = html;
  chatLog.scrollTop = chatLog.scrollHeight;
}

function selectPersonaByIndex(index, jumpToChat = false) {
  const persona = state.personas[index];
  if (!persona) return;
  state.selectedPersona = persona;
  state.historyByPersona[persona.id] = state.historyByPersona[persona.id] || [];
  rememberSelected(persona.id);
  renderAgentContainers();
  renderChat();
  if (jumpToChat) {
    setActivePage("chat");
    chatInput.focus();
  }
}

async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    renderKpis(data);
    renderStack(data);
    renderModels(data);
    renderSidebarHealth(data);
    renderEndpoints(data);
  } catch (err) {
    stackHealth.textContent = "OFFLINE";
    stackSub.textContent = "Falha ao consultar a stack.";
    if (stackList) stackList.innerHTML = `<div class='model-empty'>Erro: ${esc(err.message)}</div>`;
  }
}

async function loadModels() {
  try {
    const res = await fetch("/api/models");
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    renderModels(data);
    if (data.counter) {
      stackSub.textContent = `${data.counter.local ?? 0} locais · ${data.counter.api ?? 0} APIs · ${data.total ?? 0} modelos`;
    }
  } catch (err) {
    console.warn("Erro ao carregar modelos do /api/models:", err.message);
  }
}

function renderAgentContainers() {
  const empty = "<div class='model-empty'>Nenhum agente encontrado.</div>";
  personasBox.innerHTML = state.personas.length
    ? state.personas.map((p, i) => agentCardHtml(p, i)).join("")
    : empty;
  if (agentsRail) {
    agentsRail.innerHTML = state.personas.length
      ? state.personas.map((p, i) => railRowHtml(p, i)).join("")
      : empty;
  }
  if (agentsRailCount) agentsRailCount.textContent = String(state.personas.length);
  if (chatSwitcher) chatSwitcher.innerHTML = state.personas.map((p, i) => chatChipHtml(p, i)).join("");
  renderKnowledgeAgentOptions();
  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectPersonaByIndex(Number(btn.getAttribute("data-open")), true);
    });
  });
  document.querySelectorAll(".agent-card").forEach((card) => {
    card.addEventListener("click", () => selectPersonaByIndex(Number(card.getAttribute("data-index")), false));
  });
}

function renderKnowledgeAgentOptions() {
  if (!knowledgeAgent) return;
  const current = knowledgeAgent.value || state.selectedPersona?.id || "";
  knowledgeAgent.innerHTML = state.personas.map((p) => `<option value='${esc(p.id)}'>${esc(p.nome)} · ${esc(p.model || "modelo")}</option>`).join("");
  const has = state.personas.some((p) => p.id === current);
  knowledgeAgent.value = has ? current : state.personas[0]?.id || "";
}

async function loadPersonas() {
  personasBox.innerHTML = "<div class='model-empty'>Carregando agentes...</div>";
  try {
    const res = await fetch("/api/personas");
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    state.personas = data.personas || [];
    renderAgentContainers();
    if (!state.personas.length) return;
    let storedId = "";
    try { storedId = localStorage.getItem(SELECTED_KEY) || ""; } catch { storedId = ""; }
    const targetId = state.selectedPersona?.id || storedId;
    const idx = state.personas.findIndex((p) => p.id === targetId);
    selectPersonaByIndex(idx >= 0 ? idx : 0, false);
  } catch (err) {
    personasBox.innerHTML = `<div class='model-empty'>Erro ao carregar agentes: ${esc(err.message)}</div>`;
  }
}

async function sendChat() {
  let persona;
  try { persona = ensurePersonaSelected(); } catch (err) { alert(err.message); return; }
  const text = chatInput.value.trim();
  if (!text) return;
  const personaId = persona.id;
  state.historyByPersona[personaId] = state.historyByPersona[personaId] || [];
  const history = state.historyByPersona[personaId];
  history.push({ role: "user", content: text });
  chatInput.value = "";
  saveHistory();
  state.typingPersonaId = personaId;
  renderChat();
  renderAgentContainers();
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: personaId, message: text, history, retrieve_knowledge: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || "erro no chat");
    history.push({ role: "assistant", content: data.reply || "" });
  } catch (err) {
    history.push({ role: "assistant", content: `Erro: ${err.message}` });
  } finally {
    state.typingPersonaId = null;
    saveHistory();
    renderChat();
    renderAgentContainers();
  }
}

function renderKnowledgeFiles() {
  if (!knowledgeFileList) return;
  const files = state.knowledgeFiles || [];
  knowledgeFileList.innerHTML = files.map((f, i) => `<span class='file-chip'>❒ ${esc(f.name)} <button type='button' data-rmfile='${i}' aria-label='remover'>✕</button></span>`).join("");
  knowledgeFileList.querySelectorAll("[data-rmfile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.knowledgeFiles.splice(Number(btn.getAttribute("data-rmfile")), 1);
      renderKnowledgeFiles();
    });
  });
}

function addKnowledgeFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;
  state.knowledgeFiles = (state.knowledgeFiles || []).concat(incoming);
  renderKnowledgeFiles();
}

async function attachKnowledge() {
  const personaId = knowledgeAgent?.value || state.selectedPersona?.id || "";
  if (!personaId) { alert("Selecione um agente."); return; }
  const title = String(knowledgeTitle?.value || "").trim();
  const content = String(knowledgeContent?.value || "").trim();
  const files = state.knowledgeFiles || [];
  if (!files.length && !content) { alert("Selecione arquivos ou cole um conteúdo."); return; }
  const items = [];
  for (const f of files) {
    let text = "";
    try { text = await f.text(); } catch { text = ""; }
    if (text.trim()) items.push({ title: title || f.name, source: f.name, content: text });
  }
  if (content) items.push({ title: title || "Conhecimento manual", source: "manual", content });
  if (!items.length) { setResult(knowledgeResult, "Nenhum conteúdo legível para anexar."); return; }
  setResult(knowledgeResult, `Anexando ${items.length} item(ns) para '${personaId}'...`);
  let ok = 0, totalChunks = 0, errors = [];
  for (const it of items) {
    try {
      const res = await fetch("/api/knowledge/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona_id: personaId, title: it.title, source: it.source, content: it.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "falha ao anexar");
      ok += 1; totalChunks += data.chunks || 0;
    } catch (err) { errors.push(`${it.source}: ${err.message}`); }
  }
  setResult(knowledgeResult, `Concluído para '${personaId}': ${ok}/${items.length} itens · ${totalChunks} chunks indexados.` + (errors.length ? `\nErros:\n${errors.join("\n")}` : ""));
  state.knowledgeFiles = []; renderKnowledgeFiles();
  if (knowledgeContent) knowledgeContent.value = "";
  if (knowledgeFilesInput) knowledgeFilesInput.value = "";
}

function bindKnowledge() {
  if (knowledgeBrowse && knowledgeFilesInput) {
    knowledgeBrowse.addEventListener("click", () => knowledgeFilesInput.click());
    knowledgeFilesInput.addEventListener("change", () => addKnowledgeFiles(knowledgeFilesInput.files));
  }
  if (knowledgeDropzone) {
    ["dragenter", "dragover"].forEach((ev) => knowledgeDropzone.addEventListener(ev, (e) => { e.preventDefault(); knowledgeDropzone.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((ev) => knowledgeDropzone.addEventListener(ev, (e) => { e.preventDefault(); knowledgeDropzone.classList.remove("dragover"); }));
    knowledgeDropzone.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files) addKnowledgeFiles(e.dataTransfer.files); });
  }
}

async function startFlow(flowType, message = "", payload = {}) {
  let persona;
  try { persona = ensurePersonaSelected(); } catch (err) { alert(err.message); return; }
  setResult(flowStatus, `Disparando fluxo '${flowType}' no n8n...`);
  try {
    const res = await fetch("/api/flows/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_type: flowType, persona_id: persona.id, message, payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || "falha ao iniciar fluxo");
    state.activeFlowId = data.flow_id;
    setResult(flowStatus, `Fluxo iniciado: ${data.flow_id}\nstatus: ${data.status}`);
    setActivePage("flows");
    pollFlowStatus(data.flow_id);
  } catch (err) {
    setResult(flowStatus, `Erro ao iniciar fluxo: ${err.message}`);
  }
}

async function pollFlowStatus(flowId) {
  if (!flowId) return;
  try {
    const res = await fetch(`/api/flows/${encodeURIComponent(flowId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || "erro ao consultar fluxo");
    const status = data.status || "running";
    const responseText = data.response ? JSON.stringify(data.response, null, 2) : "{}";
    setResult(flowStatus, `flow_id: ${data.flow_id}\ntipo: ${data.flow_type}\nstatus: ${status}\natualizado: ${data.updated_at || "-"}\n\nresposta:\n${responseText}`);
    if (status === "running") setTimeout(() => pollFlowStatus(flowId), 3000);
  } catch (err) {
    setResult(flowStatus, `Erro ao consultar fluxo: ${err.message}`);
  }
}

async function sendChatViaFlow() {
  const text = chatInput.value.trim();
  if (!text) { alert("Digite a mensagem antes de enviar via n8n."); return; }
  await startFlow("chat", text, { channel: "frontend" });
}

async function sendKnowledgeViaFlow() {
  const title = String(knowledgeTitle?.value || "").trim();
  const content = String(knowledgeContent?.value || "").trim();
  if (!title || !content) { alert("Preencha título e conteúdo para o fluxo de knowledge."); return; }
  await startFlow("knowledge", "", { title, source: "manual", content });
}

function bindMenu() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      if (!target) return;
      setActivePage(target);
    });
  });
}

function bindSearch() {
  if (!agentSearch) return;
  agentSearch.addEventListener("input", () => {
    const q = agentSearch.value.trim().toLowerCase();
    document.querySelectorAll("#personas-box .agent-card").forEach((card) => {
      const idx = Number(card.getAttribute("data-index"));
      const p = state.personas[idx];
      const hit = !q || (p && `${p.nome} ${p.papel} ${p.source}`.toLowerCase().includes(q));
      card.style.display = hit ? "" : "none";
    });
  });
}

function bindJumps() {
  document.querySelectorAll("[data-jump]").forEach((btn) => {
    btn.addEventListener("click", () => setActivePage(btn.getAttribute("data-jump")));
  });
}

// ===== SSH Terminal for IoT Devices =====
let sshWs = null;
let sshTerminal = null;
let sshFitAddon = null;

function initSSHTerminal() {
  const sshTerminalContainer = document.getElementById("ssh-terminal-container");
  if (!sshTerminal && sshTerminalContainer) {
    sshTerminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      theme: {
        background: "#0a0a0f",
        foreground: "#e7edf7",
        cursor: "#7c5cff",
        selectionBackground: "rgba(124, 92, 255, 0.3)",
        black: "#1c2b45",
        red: "#ff6b81",
        green: "#35d0a5",
        yellow: "#f2b34b",
        blue: "#4cc0ff",
        magenta: "#9d7bff",
        cyan: "#4cc0ff",
        white: "#e7edf7",
        brightBlack: "#5b6a86",
        brightRed: "#ff6b81",
        brightGreen: "#35d0a5",
        brightYellow: "#f2b34b",
        brightBlue: "#4cc0ff",
        brightMagenta: "#9d7bff",
        brightCyan: "#4cc0ff",
        brightWhite: "#e7edf7",
      },
    });
    const FitAddonClass = window.FitAddon?.FitAddon || window.FitAddon;
    sshFitAddon = new FitAddonClass();
    sshTerminal.loadAddon(sshFitAddon);
    sshTerminal.open(sshTerminalContainer);
    sshFitAddon.fit();
  }
}

let currentDeviceId = null;

async function updateDeviceStatus(deviceId, status) {
  if (!deviceId) return;
  try {
    await fetch(`/api/iot/devices/${deviceId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  } catch (err) {
    console.warn("Failed to update device status:", err);
  }
}

function openIoTTerminal(host, port, username, password, privateKey, keyType, deviceId) {
  currentDeviceId = deviceId || null;
  initSSHTerminal();
  sshTerminal.reset();
  const sshTerminalSection = document.getElementById("ssh-terminal-section");
  const sshTerminalInfo = document.getElementById("ssh-terminal-info");
  const wsUrl = window.location.protocol === "https:" 
    ? "wss://"+ window.location.host + "/api/iot/ssh/terminal" 
    : "ws://"+ window.location.host + "/api/iot/ssh/terminal";
  sshWs = new WebSocket(wsUrl);
  sshWs.onopen = () => {
    sshWs.send(JSON.stringify({ host, port, username, password: password || "", key_type: keyType || "password", private_key: privateKey || "", cols: sshTerminal.cols, rows: sshTerminal.rows }));
    if (sshTerminalInfo) sshTerminalInfo.textContent = `Conectado: ${username}@${host}:${port}`;
    if (sshTerminalSection) sshTerminalSection.style.display = "";
    sshTerminal.write(`\r\n\x1b[32m✅ Conectado a ${username}@${host}:${port}\x1b[0m\r\n`);
    updateDeviceStatus(currentDeviceId, "online");
  };
  sshWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.error) sshTerminal.write(`\r\n\x1b[31m❌ Erro: ${msg.error}\x1b[0m\r\n`);
      if (msg.data) sshTerminal.write(msg.data);
    } catch {}
  };
  sshWs.onerror = () => {
    sshTerminal.write(`\r\n\x1b[31m❌ Erro de conexão WebSocket\x1b[0m\r\n`);
    if (sshTerminalInfo) sshTerminalInfo.textContent = "Erro de conexão";
    updateDeviceStatus(currentDeviceId, "offline");
  };
  sshWs.onclose = () => {
    sshTerminal.write(`\r\n\x1b[33m🔌 Conexão encerrada.\x1b[0m\r\n`);
    if (sshTerminalInfo) sshTerminalInfo.textContent = "Desconectado";
    sshWs = null;
    updateDeviceStatus(currentDeviceId, "offline");
  };
  sshTerminal.onData((data) => {
    if (sshWs && sshWs.readyState === WebSocket.OPEN) sshWs.send(JSON.stringify({ input: data }));
  });
  const observer = new ResizeObserver(() => {
    if (sshFitAddon) {
      try {
        sshFitAddon.fit();
        if (sshWs && sshWs.readyState === WebSocket.OPEN) sshWs.send(JSON.stringify({ resize: { cols: sshTerminal.cols, rows: sshTerminal.rows }}));
      } catch {}
    }
  });
  const sshTerminalContainer = document.getElementById("ssh-terminal-container");
  if (sshTerminalContainer) observer.observe(sshTerminalContainer);
  sshTerminal._resizeObserver = observer;
}

function closeIoTTerminal() {
  if (sshWs) { sshWs.send(JSON.stringify({ disconnect: true })); sshWs.close(); sshWs = null; }
  if (sshTerminal) {
    if (sshTerminal._resizeObserver) { sshTerminal._resizeObserver.disconnect(); delete sshTerminal._resizeObserver; }
    sshTerminal.reset();
    sshTerminal.write("Terminal encerrado. Conecte-se novamente para interagir.\r\n");
  }
  const sshTerminalSection = document.getElementById("ssh-terminal-section");
  if (sshTerminalSection) sshTerminalSection.style.display = "none";
  const sshTerminalInfo = document.getElementById("ssh-terminal-info");
  if (sshTerminalInfo) sshTerminalInfo.textContent = "Desconectado";
}

// ===== IoT Device Management =====
const addDeviceBtn = document.getElementById("add-device-btn");
const deviceModal = document.getElementById("device-modal");
const deviceModalClose = document.getElementById("device-modal-close");
const deviceModalCancel = document.getElementById("device-modal-cancel");
const deviceModalSave = document.getElementById("device-modal-save");
const deviceModalTest = document.getElementById("device-modal-test");
const deviceModalTitle = document.getElementById("device-modal-title");
const deviceModalResult = document.getElementById("device-modal-result");
const devicesCards = document.getElementById("devices-cards");

// Device form fields
const deviceName = document.getElementById("device-name");
const deviceDescription = document.getElementById("device-description");
const deviceIp = document.getElementById("device-ip");
const devicePort = document.getElementById("device-port");
const deviceUsername = document.getElementById("device-username");
const deviceAuthMethod = document.getElementById("device-auth-method");
const devicePassword = document.getElementById("device-password");
const devicePrivateKey = document.getElementById("device-private-key");
const devicePasswordRow = document.getElementById("device-password-row");
const deviceKeyRow = document.getElementById("device-key-row");

let editingDeviceId = null;

function toggleDeviceAuthMethod() {
  const method = deviceAuthMethod.value;
  if (method === "password") { devicePasswordRow.style.display = ""; deviceKeyRow.style.display = "none"; }
  else { devicePasswordRow.style.display = "none"; deviceKeyRow.style.display = ""; }
}

if (deviceAuthMethod) deviceAuthMethod.addEventListener("change", toggleDeviceAuthMethod);

async function loadIoTDevices() {
  if (!devicesCards) return;
  devicesCards.innerHTML = "<div class='model-empty'>Carregando periféricos...</div>";
  try {
    const res = await fetch("/api/iot/devices");
    if (!res.ok) { devicesCards.innerHTML = `<div class='model-empty'>Erro ao carregar periféricos: ${res.status}</div>`; return; }
    const data = await res.json();
    renderIoTDevices(data.devices || []);
  } catch (err) {
    devicesCards.innerHTML = `<div class='model-empty'>Erro: ${err.message}</div>`;
  }
}

function renderIoTDevices(devices) {
  if (!devicesCards) return;
  if (devices.length === 0) {
    devicesCards.innerHTML = "<div class='model-empty'>Nenhum periférico cadastrado. Clique em '+ Adicionar Periférico' para cadastrar.</div>";
    return;
  }
  devicesCards.innerHTML = devices.map(device => `
    <div class='iot-device-card' data-id='${device.id}'>
      <div class='iot-device-header'>
        <span class='iot-device-icon'>🔌</span>
        <div class='iot-device-info'>
          <strong class='iot-device-name'>${esc(device.name)}</strong>
          <span class='iot-device-ip'>${esc(device.ip_address)}:${device.port}</span>
        </div>
        <span class='iot-device-status'>
          <span class='dot ${device.status === 'online' ? 'online' : 'offline'}'></span>
          ${device.status === 'online' ? 'Online' : 'Offline'}
        </span>
      </div>
      ${device.description ? `<p class='muted' style='margin:0;font-size:12px'>${esc(device.description)}</p>` : ''}
      <div class='iot-device-actions'>
        <button class='btn secondary device-check-btn' data-id='${device.id}' style='font-size:11px;padding:6px 10px'>⟳ Revalidar</button>
        <button class='btn secondary device-connect-btn' data-id='${device.id}' data-host='${esc(device.ip_address)}' data-port='${device.port}' data-user='${esc(device.username || "root")}' data-auth='${esc(device.auth_method || "password")}' data-key='${esc(device.private_key || "")}' style='font-size:11px;padding:6px 10px'>⌨ SSH</button>
        <button class='btn secondary device-edit-btn' data-id='${device.id}' style='font-size:11px;padding:6px 10px;background:linear-gradient(90deg, #f2b34b, #e0a035)'>✎</button>
        <button class='btn secondary device-delete-btn' data-id='${device.id}' style='font-size:11px;padding:6px 10px;background:linear-gradient(90deg, #ff6b81, #ff3d57)'>✕</button>
      </div>
    </div>`).join("");

  // Bind connect buttons - open SSH terminal directly
  devicesCards.querySelectorAll(".device-connect-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const host = btn.getAttribute("data-host");
      const port = parseInt(btn.getAttribute("data-port"), 10);
      const user = btn.getAttribute("data-user");
      const auth = btn.getAttribute("data-auth");
      const key = btn.getAttribute("data-key");
      const deviceId = btn.getAttribute("data-id");
      
      // If using password auth and no key is provided, fetch credentials from backend
      let password = "";
      let finalKey = key;
      let finalAuth = auth;
      
      if ((auth === "password" || !key) && deviceId) {
        try {
          const res = await fetch(`/api/iot/devices/${deviceId}/credentials`);
          if (res.ok) {
            const data = await res.json();
            password = data.password || "";
            finalKey = data.private_key || key;
            finalAuth = data.auth_method || auth;
            // Update display info
            if (sshTerminalInfo) sshTerminalInfo.textContent = `Conectado: ${data.username || user}@${data.host || host}:${port}`;
          }
        } catch (err) {
          console.warn("Failed to fetch device credentials:", err);
        }
      }
      
      openIoTTerminal(host, port, user, password, finalKey, finalAuth, deviceId);
    });
  });

  devicesCards.querySelectorAll(".device-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const deviceId = btn.getAttribute("data-id");
      const device = devices.find(d => String(d.id) === deviceId);
      if (device) openDeviceModal(device);
    });
  });

  devicesCards.querySelectorAll(".device-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const deviceId = btn.getAttribute("data-id");
      if (confirm("Tem certeza que deseja excluir este periférico?")) {
        try {
          const res = await fetch(`/api/iot/devices/${deviceId}`, { method: "DELETE" });
          const data = await res.json();
          if (res.ok) await loadIoTDevices();
          else alert(`Erro ao excluir: ${data.detail || data.error}`);
        } catch (err) { alert(`Erro: ${err.message}`); }
      }
    });
  });
}

function openDeviceModal(device = null) {
  editingDeviceId = device?.id || null;
  deviceModalTitle.textContent = device ? "Editar Periférico" : "Adicionar Periférico";
  if (device) {
    deviceName.value = device.name || "";
    deviceDescription.value = device.description || "";
    deviceIp.value = device.ip_address || "";
    devicePort.value = device.port || 22;
    deviceUsername.value = device.username || "root";
    deviceAuthMethod.value = device.auth_method || "password";
    devicePassword.value = "";
    devicePrivateKey.value = device.private_key || "";
  } else {
    deviceName.value = "";
    deviceDescription.value = "";
    deviceIp.value = "";
    devicePort.value = "22";
    deviceUsername.value = "root";
    deviceAuthMethod.value = "password";
    devicePassword.value = "";
    devicePrivateKey.value = "";
  }
  toggleDeviceAuthMethod();
  deviceModalResult.style.display = "none";
  deviceModal.style.display = "";
}

function closeDeviceModal() { deviceModal.style.display = "none"; editingDeviceId = null; }

async function saveDevice() {
  const payload = {
    name: deviceName.value.trim(),
    description: deviceDescription.value.trim(),
    ip_address: deviceIp.value.trim(),
    port: parseInt(devicePort.value, 10) || 22,
    username: deviceUsername.value.trim() || "root",
    auth_method: deviceAuthMethod.value,
    private_key: devicePrivateKey.value,
  };
  
  // Only include password if it's provided (for updates) or if it's a new device
  if (devicePassword.value) {
    payload.password = devicePassword.value;
  } else if (!editingDeviceId) {
    payload.password = "";
  }
  if (!payload.name || !payload.ip_address) {
    deviceModalResult.style.display = "";
    deviceModalResult.textContent = "Nome e IP são obrigatórios.";
    deviceModalResult.style.color = "var(--red)";
    return;
  }
  try {
    let res;
    if (editingDeviceId) {
      res = await fetch(`/api/iot/devices/${editingDeviceId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      res = await fetch("/api/iot/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    const result = await res.json();
    if (!res.ok) throw new Error(result.detail || result.error || "Erro ao salvar");
    closeDeviceModal();
    await loadIoTDevices();
  } catch (err) {
    deviceModalResult.style.display = "";
    deviceModalResult.textContent = `❌ ${err.message}`;
    deviceModalResult.style.color = "var(--red)";
  }
}

// Test SSH connection for device registration
async function testDeviceConnection() {
  const host = deviceIp.value.trim();
  const port = parseInt(devicePort.value, 10) || 22;
  const username = deviceUsername.value.trim() || "root";
  const password = devicePassword.value;
  const privateKey = devicePrivateKey.value;
  const keyType = deviceAuthMethod.value;
  if (!host) {
    deviceModalResult.style.display = "";
    deviceModalResult.textContent = "Informe o IP para testar conexão.";
    deviceModalResult.style.color = "var(--red)";
    return;
  }
  deviceModalResult.style.display = "";
  deviceModalResult.textContent = "Testando conexão...";
  deviceModalResult.style.color = "var(--ink)";
  try {
    const res = await fetch("/api/iot/ssh/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, port, username, password, private_key: privateKey, command: "echo 'SSH Test OK'", key_type: keyType }),
    });
    const data = await res.json();
    if (data.connected) {
      deviceModalResult.textContent = `✅ Conexão bem-sucedida: ${data.username}@${data.host}:${data.port}`;
      deviceModalResult.style.color = "var(--green)";
    } else {
      deviceModalResult.textContent = `❌ Falha na conexão: ${data.error}`;
      deviceModalResult.style.color = "var(--red)";
    }
  } catch (err) {
    deviceModalResult.textContent = `❌ Erro: ${err.message}`;
    deviceModalResult.style.color = "var(--red)";
  }
}

// Close terminal on disconnect button
document.getElementById("ssh-terminal-disconnect")?.addEventListener("click", closeIoTTerminal);

// Revalidate IoT device status
devicesCards?.addEventListener("click", async (ev) => {
  const btn = ev.target.closest(".device-check-btn");
  if (!btn) return;
  const deviceId = btn.getAttribute("data-id");
  if (!deviceId) return;
  btn.disabled = true;
  const prevText = btn.textContent;
  btn.textContent = "Verificando...";
  try {
    const res = await fetch(`/api/iot/devices/${deviceId}/check-status`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || res.status);
    btn.textContent = data.online ? "Online" : "Offline";
    btn.style.background = data.online
      ? "linear-gradient(90deg, #35d0a5, #29b892)"
      : "linear-gradient(90deg, #ff6b81, #ff3d57)";
    setTimeout(() => {
      btn.textContent = prevText;
      btn.style.background = "";
      loadIoTDevices();
    }, 1200);
  } catch (err) {
    alert(`Erro ao verificar status: ${err.message}`);
    btn.textContent = prevText;
    btn.style.background = "";
  } finally {
    btn.disabled = false;
  }
});

// Modal event bindings
if (addDeviceBtn) addDeviceBtn.addEventListener("click", () => openDeviceModal());
if (deviceModalClose) deviceModalClose.addEventListener("click", closeDeviceModal);
if (deviceModalCancel) deviceModalCancel.addEventListener("click", closeDeviceModal);
if (deviceModalSave) deviceModalSave.addEventListener("click", saveDevice);
if (deviceModalTest) deviceModalTest.addEventListener("click", testDeviceConnection);

// Close modal on overlay click
if (deviceModal) {
  deviceModal.addEventListener("click", (e) => { if (e.target === deviceModal) closeDeviceModal(); });
}

// Initialize
document.getElementById("refresh-status")?.addEventListener("click", () => { loadStatus(); loadModels(); loadPersonas(); });
document.getElementById("send-chat")?.addEventListener("click", sendChat);
document.getElementById("send-n8n-chat")?.addEventListener("click", sendChatViaFlow);
document.getElementById("attach-knowledge")?.addEventListener("click", attachKnowledge);
document.getElementById("attach-knowledge-flow")?.addEventListener("click", sendKnowledgeViaFlow);
chatInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); sendChat(); } });

bindMenu();
bindSearch();
bindJumps();
bindKnowledge();
loadStatus();
loadModels();
loadPersonas();
renderChat();
loadIoTDevices();
setInterval(loadStatus, 20000);