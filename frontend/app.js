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
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

  // Carrega o iframe do Dozzle apenas quando a aba Monitor eh aberta.
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
  kpiRow.innerHTML = cards
    .map(
      (k) => `
      <div class='kpi ${k.cls}'>
        <div class='kpi-label'>${esc(k.label)}</div>
        <div class='kpi-value ${k.small ? "mono" : ""}' style='${k.small ? "font-size:16px" : ""}'>${k.value}</div>
        <div class='kpi-foot'>${esc(k.foot)}</div>
      </div>`
    )
    .join("");
}

function renderStack(data) {
  const services = data.services || [];
  const c = data.counters || {};
  const ep = data.endpoints || {};
  stackCount.textContent = `${c.services_online ?? 0}/${services.length}`;
  stackList.innerHTML = services.length
    ? services
        .map(
          (s) => `
      <div class='stack-item'>
        <span class='svc-logo'><img src='/logos/${esc(s.key)}.svg' alt='' onerror='this.remove()' /></span>
        <span class='dot ${s.online ? "online" : "offline"}'></span>
        <div class='si-main'>
          <div class='si-label'>${esc(s.label)}</div>
          <a class='si-addr' href='${esc(s.address)}' target='_blank' rel='noreferrer'>${esc(s.address)}</a>
          ${s.key === "qdrant" && ep.qdrant_dashboard ? `<a class='si-addr si-dash' href='${esc(ep.qdrant_dashboard)}' target='_blank' rel='noreferrer'>Dashboard ↗</a>` : ""}
        </div>
        <span class='badge ${s.online ? "on" : "off"}'>${s.online ? "ONLINE" : "OFFLINE"}</span>
      </div>`
        )
        .join("")
    : "<div class='model-empty'>Sem serviços.</div>";
}

function renderModels(data) {
  const models = data.ollama_models || [];
  modelsCount.textContent = String(models.length);
  modelsList.innerHTML = models.length
    ? models.map((m) => `<div class='model-item'><span class='mi-ico'>◆</span>${esc(m)}</div>`).join("")
    : "<div class='model-empty'>Nenhum modelo carregado no Ollama.</div>";
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
  if (ep.qdrant_dashboard) {
    if (linkQdrantDashboard) linkQdrantDashboard.href = ep.qdrant_dashboard;
  }
  if (ep.portainer && linkPortainer) linkPortainer.href = ep.portainer;
  if (ep.aider && linkAider) linkAider.href = ep.aider;
  if (ep.litellm && linkLitellm) linkLitellm.href = ep.litellm;
  if (ep.watchtower && linkWatchtower) linkWatchtower.href = ep.watchtower;
  // Dozzle e servido pelo nginx do frontend em /dozzle/ (mesma origem),
  // para permitir o embed via iframe sem bloqueio de X-Frame-Options.
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
    ? history
        .map((item) => `<div class='msg ${item.role === "user" ? "user" : "assistant"}'>${esc(item.content)}</div>`)
        .join("")
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
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
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

  if (chatSwitcher) {
    chatSwitcher.innerHTML = state.personas.map((p, i) => chatChipHtml(p, i)).join("");
  }

  renderKnowledgeAgentOptions();

  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectPersonaByIndex(Number(btn.getAttribute("data-open")), true);
    });
  });

  document.querySelectorAll(".agent-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectPersonaByIndex(Number(card.getAttribute("data-index")), false);
    });
  });
}

function renderKnowledgeAgentOptions() {
  if (!knowledgeAgent) return;
  const current = knowledgeAgent.value || state.selectedPersona?.id || "";
  knowledgeAgent.innerHTML = state.personas
    .map((p) => `<option value='${esc(p.id)}'>${esc(p.nome)} · ${esc(p.model || "modelo")}</option>`)
    .join("");
  const has = state.personas.some((p) => p.id === current);
  knowledgeAgent.value = has ? current : state.personas[0]?.id || "";
}

async function loadPersonas() {
  personasBox.innerHTML = "<div class='model-empty'>Carregando agentes...</div>";
  try {
    const res = await fetch("/api/personas");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    state.personas = data.personas || [];

    renderAgentContainers();

    if (!state.personas.length) return;

    let storedId = "";
    try {
      storedId = localStorage.getItem(SELECTED_KEY) || "";
    } catch {
      storedId = "";
    }
    const targetId = state.selectedPersona?.id || storedId;
    const idx = state.personas.findIndex((p) => p.id === targetId);
    selectPersonaByIndex(idx >= 0 ? idx : 0, false);
  } catch (err) {
    personasBox.innerHTML = `<div class='model-empty'>Erro ao carregar agentes: ${esc(err.message)}</div>`;
  }
}

async function sendChat() {
  let persona;
  try {
    persona = ensurePersonaSelected();
  } catch (err) {
    alert(err.message);
    return;
  }

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
      body: JSON.stringify({
        persona_id: personaId,
        message: text,
        history,
        retrieve_knowledge: true,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.error || "erro no chat");
    }

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
  knowledgeFileList.innerHTML = files
    .map(
      (f, i) => `<span class='file-chip'>❒ ${esc(f.name)} <button type='button' data-rmfile='${i}' aria-label='remover'>✕</button></span>`
    )
    .join("");
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
  if (!personaId) {
    alert("Selecione um agente.");
    return;
  }

  const title = String(knowledgeTitle?.value || "").trim();
  const content = String(knowledgeContent?.value || "").trim();
  const files = state.knowledgeFiles || [];

  if (!files.length && !content) {
    alert("Selecione arquivos ou cole um conteúdo.");
    return;
  }

  const items = [];
  for (const f of files) {
    let text = "";
    try {
      text = await f.text();
    } catch {
      text = "";
    }
    if (text.trim()) items.push({ title: title || f.name, source: f.name, content: text });
  }
  if (content) items.push({ title: title || "Conhecimento manual", source: "manual", content });

  if (!items.length) {
    setResult(knowledgeResult, "Nenhum conteúdo legível para anexar.");
    return;
  }

  setResult(knowledgeResult, `Anexando ${items.length} item(ns) para '${personaId}'...`);

  let ok = 0;
  let totalChunks = 0;
  const errors = [];
  for (const it of items) {
    try {
      const res = await fetch("/api/knowledge/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona_id: personaId, title: it.title, source: it.source, content: it.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "falha ao anexar");
      ok += 1;
      totalChunks += data.chunks || 0;
    } catch (err) {
      errors.push(`${it.source}: ${err.message}`);
    }
  }

  setResult(
    knowledgeResult,
    `Concluído para '${personaId}': ${ok}/${items.length} itens · ${totalChunks} chunks indexados.` +
      (errors.length ? `\nErros:\n${errors.join("\n")}` : "")
  );

  state.knowledgeFiles = [];
  renderKnowledgeFiles();
  if (knowledgeContent) knowledgeContent.value = "";
  if (knowledgeFilesInput) knowledgeFilesInput.value = "";
}

function bindKnowledge() {
  if (knowledgeBrowse && knowledgeFilesInput) {
    knowledgeBrowse.addEventListener("click", () => knowledgeFilesInput.click());
    knowledgeFilesInput.addEventListener("change", () => addKnowledgeFiles(knowledgeFilesInput.files));
  }
  if (knowledgeDropzone) {
    ["dragenter", "dragover"].forEach((ev) =>
      knowledgeDropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        knowledgeDropzone.classList.add("dragover");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      knowledgeDropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        knowledgeDropzone.classList.remove("dragover");
      })
    );
    knowledgeDropzone.addEventListener("drop", (e) => {
      if (e.dataTransfer && e.dataTransfer.files) addKnowledgeFiles(e.dataTransfer.files);
    });
  }
}

async function startFlow(flowType, message = "", payload = {}) {
  let persona;
  try {
    persona = ensurePersonaSelected();
  } catch (err) {
    alert(err.message);
    return;
  }

  setResult(flowStatus, `Disparando fluxo '${flowType}' no n8n...`);

  try {
    const res = await fetch("/api/flows/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flow_type: flowType,
        persona_id: persona.id,
        message,
        payload,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.error || "falha ao iniciar fluxo");
    }

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
    if (!res.ok) {
      throw new Error(data.detail || data.error || "erro ao consultar fluxo");
    }

    const status = data.status || "running";
    const responseText = data.response ? JSON.stringify(data.response, null, 2) : "{}";
    setResult(
      flowStatus,
      `flow_id: ${data.flow_id}\ntipo: ${data.flow_type}\nstatus: ${status}\natualizado: ${data.updated_at || "-"}\n\nresposta:\n${responseText}`
    );

    if (status === "running") {
      setTimeout(() => pollFlowStatus(flowId), 3000);
    }
  } catch (err) {
    setResult(flowStatus, `Erro ao consultar fluxo: ${err.message}`);
  }
}

async function sendChatViaFlow() {
  const text = chatInput.value.trim();
  if (!text) {
    alert("Digite a mensagem antes de enviar via n8n.");
    return;
  }
  await startFlow("chat", text, { channel: "frontend" });
}

async function sendKnowledgeViaFlow() {
  const title = String(knowledgeTitle?.value || "").trim();
  const content = String(knowledgeContent?.value || "").trim();

  if (!title || !content) {
    alert("Preencha título e conteúdo para o fluxo de knowledge.");
    return;
  }

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

// === Interactive SSH Terminal (WebSocket + xterm.js) ===
let sshTerminal = null;
let sshFitAddon = null;
let sshWs = null;
let sshConnectedHost = null;
let sshConnectedPort = null;
let sshConnectedUser = null;

const sshHost = document.getElementById("ssh-host");
const sshPort = document.getElementById("ssh-port");
const sshUser = document.getElementById("ssh-user");
const sshAuthMethod = document.getElementById("ssh-auth-method");
const sshPassword = document.getElementById("ssh-password");
const sshPrivateKey = document.getElementById("ssh-private-key");
const sshCommand = document.getElementById("ssh-command");
const sshConnectBtn = document.getElementById("ssh-connect-btn");
const sshClearBtn = document.getElementById("ssh-clear-btn");
const sshResult = document.getElementById("ssh-result");
const sshPasswordRow = document.getElementById("ssh-password-row");
const sshKeyRow = document.getElementById("ssh-key-row");
const sshTerminalSection = document.getElementById("ssh-terminal-section");
const sshTerminalContainer = document.getElementById("ssh-terminal-container");
const sshTerminalInfo = document.getElementById("ssh-terminal-info");
const sshTerminalDisconnect = document.getElementById("ssh-terminal-disconnect");

function setSshResult(value, isError = false) {
  sshResult.textContent = value;
  sshResult.style.color = isError ? "var(--red)" : "var(--ink)";
}

function toggleSshAuthMethod() {
  const method = sshAuthMethod.value;
  if (method === "password") {
    sshPasswordRow.style.display = "";
    sshKeyRow.style.display = "none";
  } else {
    sshPasswordRow.style.display = "none";
    sshKeyRow.style.display = "";
  }
}

sshAuthMethod.addEventListener("change", toggleSshAuthMethod);

function initTerminal() {
  if (!sshTerminal) {
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
    // The xterm-addon-fit UMD bundle wraps the class in { FitAddon: class },
    // so window.FitAddon is an object, not the constructor directly.
    const FitAddonClass = window.FitAddon?.FitAddon || window.FitAddon;
    sshFitAddon = new FitAddonClass();
    sshTerminal.loadAddon(sshFitAddon);
    sshTerminal.open(sshTerminalContainer);
    sshFitAddon.fit();
  }
}

function openInteractiveTerminal(host, port, username, password, privateKey, keyType) {
  initTerminal();

  // Clear terminal
  sshTerminal.reset();

  // Build WebSocket URL - use same origin through nginx proxy
  // This ensures WebSocket goes through nginx which proxies to backend
  const wsUrl = window.location.protocol === "https:" 
    ? "wss://"+ window.location.host + "/api/iot/ssh/terminal" 
    : "ws://"+ window.location.host + "/api/iot/ssh/terminal";

  sshWs = new WebSocket(wsUrl);

  sshWs.onopen = () => {
    // Send connection parameters
    const params = {
      host,
      port,
      username,
      password: password || "",
      key_type: keyType || "password",
      private_key: privateKey || "",
      cols: sshTerminal.cols,
      rows: sshTerminal.rows,
    };
    sshWs.send(JSON.stringify(params));

    sshConnectedHost = host;
    sshConnectedPort = port;
    sshConnectedUser = username;
    sshTerminalInfo.textContent = `Conectado: ${username}@${host}:${port}`;
    sshTerminalSection.style.display = "";

    // Show connection in result box
    setSshResult(`✅ Terminal interativo conectado a ${username}@${host}:${port}\nDigite comandos no terminal abaixo.`);
  };

  sshWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.error) {
        sshTerminal.write(`\r\n\x1b[31m❌ Erro: ${msg.error}\x1b[0m\r\n`);
        setSshResult(`❌ ${msg.error}`, true);
        return;
      }
      if (msg.connected) {
        sshTerminal.write(`\r\n\x1b[32m✅ Conectado a ${msg.username}@${msg.host}:${msg.port}\x1b[0m\r\n`);
        return;
      }
      if (msg.data) {
        sshTerminal.write(msg.data);
      }
    } catch {
      // Ignore parse errors
    }
  };

  sshWs.onerror = () => {
    sshTerminal.write(`\r\n\x1b[31m❌ Erro de conexão WebSocket\x1b[0m\r\n`);
    setSshResult("❌ Erro de conexão WebSocket", true);
  };

  sshWs.onclose = () => {
    sshTerminal.write(`\r\n\x1b[33m🔌 Conexão encerrada.\x1b[0m\r\n`);
    sshTerminalInfo.textContent = "Desconectado";
    sshWs = null;
  };

  // Send terminal input to WebSocket
  sshTerminal.onData((data) => {
    if (sshWs && sshWs.readyState === WebSocket.OPEN) {
      sshWs.send(JSON.stringify({ input: data }));
    }
  });

  // Handle terminal resize
  const observer = new ResizeObserver(() => {
    if (sshFitAddon) {
      try {
        sshFitAddon.fit();
        if (sshWs && sshWs.readyState === WebSocket.OPEN) {
          sshWs.send(JSON.stringify({
            resize: { cols: sshTerminal.cols, rows: sshTerminal.rows }
          }));
        }
      } catch {
        // ignore
      }
    }
  });
  observer.observe(sshTerminalContainer);

  // Store observer ref for cleanup
  sshTerminal._resizeObserver = observer;
}

function closeInteractiveTerminal() {
  if (sshWs) {
    sshWs.send(JSON.stringify({ disconnect: true }));
    sshWs.close();
    sshWs = null;
  }
  if (sshTerminal) {
    if (sshTerminal._resizeObserver) {
      sshTerminal._resizeObserver.disconnect();
      delete sshTerminal._resizeObserver;
    }
    sshTerminal.reset();
    sshTerminal.write("Terminal encerrado. Conecte-se novamente para interagir.\r\n");
  }
  sshTerminalSection.style.display = "none";
  sshTerminalInfo.textContent = "Desconectado";
  sshConnectedHost = null;
}

sshConnectBtn.addEventListener("click", async () => {
  const host = sshHost.value.trim();
  if (!host) {
    setSshResult("Erro: informe o endereço IP do dispositivo.", true);
    return;
  }

  const port = parseInt(sshPort.value, 10) || 22;
  const username = sshUser.value.trim() || "root";
  const password = sshPassword.value;
  const private_key = sshPrivateKey.value;
  const command = sshCommand.value.trim();
  const key_type = sshAuthMethod.value;

  // If a command was provided, use the one-shot HTTP mode (existing behavior)
  if (command) {
    setSshResult(`Conectando a ${username}@${host}:${port}...`);

    const body = { host, port, username, password, private_key, command, key_type };

    try {
      const res = await fetch("/api/iot/ssh/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.connected) {
        const lines = [
          `✅ Conectado a ${data.username}@${data.host}:${data.port}`,
          "",
          data.output,
        ];
        setSshResult(lines.join("\n"));
      } else {
        setSshResult(`❌ Falha na conexão:\n${data.error}`, true);
      }
    } catch (err) {
      setSshResult(`❌ Erro de rede: ${err.message}`, true);
    }
    return;
  }

  // No command → open interactive WebSocket terminal
  closeInteractiveTerminal();
  openInteractiveTerminal(host, port, username, password, private_key, key_type);
});

sshTerminalDisconnect.addEventListener("click", () => {
  closeInteractiveTerminal();
});

sshClearBtn.addEventListener("click", () => {
  closeInteractiveTerminal();
  sshHost.value = "";
  sshPort.value = "22";
  sshUser.value = "root";
  sshPassword.value = "";
  sshPrivateKey.value = "";
  sshCommand.value = "";
  sshAuthMethod.value = "password";
  toggleSshAuthMethod();
  setSshResult('Pronto para conectar. Insira o IP do dispositivo e clique em "Conectar SSH".');
});

document.getElementById("refresh-status").addEventListener("click", () => {
  loadStatus();
  loadPersonas();
});
document.getElementById("send-chat").addEventListener("click", sendChat);
document.getElementById("send-n8n-chat").addEventListener("click", sendChatViaFlow);
document.getElementById("attach-knowledge").addEventListener("click", attachKnowledge);
document.getElementById("attach-knowledge-flow").addEventListener("click", sendKnowledgeViaFlow);

chatInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    sendChat();
  }
});

bindMenu();
bindSearch();
bindJumps();
bindKnowledge();
loadStatus();
loadPersonas();
renderChat();
setInterval(loadStatus, 20000);
