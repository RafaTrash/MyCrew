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
  // Novos estados para WebSocket
  chatWs: null,
  currentSessionId: null,
  pipelineActive: false,
  timelineItems: [],
  currentAgentPipeline: null,
  stepTelemetry: {},
  // Pipeline e telemetria por agente (nova estrutura)
  pipelineByAgent: {},
  telemetryByAgent: {},
  timelineSessionsByAgent: {},
  // Sessões de chat por agente
  sessionsByAgent: {},
  activeSessionId: null,
};

let knowledgeSelectedPersonaId = null;

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
const knowledgeAgentChips = document.getElementById("knowledge-agent-chips");
const knowledgeTitle = document.getElementById("knowledge-title");
const knowledgeContent = document.getElementById("knowledge-content");
const knowledgeTags = document.getElementById("knowledge-tags");
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

// Novos elementos
const executionPanel = document.getElementById("execution-panel");
const epTimeline = document.getElementById("ep-timeline");
const epMetrics = document.getElementById("ep-metrics");
const finalizeChatBtn = document.getElementById("finalize-chat-btn");
const finalizeModal = document.getElementById("finalize-modal");
const finalizeModalConfirm = document.getElementById("finalize-modal-confirm");
const finalizeSummary = document.getElementById("finalize-summary");
const finalizeSummaryContent = document.getElementById("finalize-summary-content");
const finalizeResult = document.getElementById("finalize-result");

// Elementos do novo layout
const pipelineSection = document.getElementById("pipeline-section");
const pipelineContainer = document.getElementById("pipeline-container");
const pipelineSubtitle = document.getElementById("pipeline-subtitle");
const telemetrySection = document.getElementById("telemetry-section");
const telemetryContainer = document.getElementById("telemetry-container");
const telemetrySubtitle = document.getElementById("telemetry-subtitle");
const agentsSidebar = document.getElementById("agents-sidebar");
const agentsSidebarList = document.getElementById("agents-sidebar-list");
const agentSearchSidebar = document.getElementById("agent-search-sidebar");
const sessionsSidebar = document.getElementById("sessions-sidebar");
const sessionsList = document.getElementById("sessions-list");
const newSessionBtn = document.getElementById("new-session-btn");

function esc(value) {
  var s = String(value || "");
  return s
    .replace(/&/g, function() { return "&" + "amp;"; })
    .replace(/</g, function() { return "&" + "lt;"; })
    .replace(/>/g, function() { return "&" + "gt;"; })
    .replace(/"/g, function() { return "&" + "quot;"; })
    .replace(/'/g, function() { return "&#" + "39;"; });
}

// ===== MARKDOWN RENDERER =====
function renderMarkdown(content) {
  if (!content) return "";
  // Sanitiza HTML básico antes do markdown
  var sanitized = content || "";
  // Remove script e iframe básicos
  sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  sanitized = sanitized.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "");
  // Remove handlers on* e javascript:
  sanitized = sanitized.replace(/on\w+\s*=\s*(["'][^"']*["']|[^>\s]*)/gi, "");
  sanitized = sanitized.replace(/javascript:\s*/gi, "");
  
  // Usa marked.js para renderizar markdown
  if (window.marked) {
    return window.marked.parse(sanitized);
  }
  // Fallback: escape simples
  return esc(sanitized);
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
  const qc = data.qdrant_collection || {};
  const qdrantValue = qc.online
    ? `${(qc.points_count ?? 0).toLocaleString("pt-BR")} pontos`
    : "offline";
  const qdrantFoot = qc.online
    ? `${esc(qc.name)} · ${qc.segments_count || 0} segmentos · ${esc(qc.status)}`
    : "memória vetorial";
  const cards = [
    { cls: "violet", label: "Agentes", value: String(c.openwebui_agents ?? 0), foot: "OpenWebUI + locais" },
    { cls: "green", label: "Serviços online", value: `${c.services_online ?? 0}<small>/${c.services_total ?? 0}</small>`, foot: "infra da stack" },
    { cls: "blue", label: "Modelos", value: String(c.models_total ?? 0), foot: "Ollama" },
    { cls: "amber", label: "Coleção Qdrant", value: qdrantValue, foot: qdrantFoot },
  ];
  kpiRow.innerHTML = cards.map((k) => `
      <div class='kpi ${k.cls}'>
        <div class='kpi-label'>${esc(k.label)}</div>
        <div class='kpi-value'>${k.value}</div>
        <div class='kpi-foot'>${k.foot}</div>
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

  const sessionTag = document.getElementById("session-tag");
  const sessionIdText = document.getElementById("session-id-text");
  if (sessionTag && sessionIdText) {
    if (state.currentSessionId) {
      sessionTag.style.display = "";
      sessionIdText.textContent = state.currentSessionId.slice(0, 8);
    } else {
      sessionTag.style.display = "none";
      sessionIdText.textContent = "";
    }
  }
}

function msgAvatarHtml(persona, extraClass = "") {
  const label = esc(agentAvatarLabel(persona?.nome || "?"));
  if (persona && persona.avatar) {
    return `<div class='msg-avatar ${extraClass}'><span class='av-fallback'>${label}</span><img src='${esc(persona.avatar)}' alt='' onerror='this.remove()' /></div>`;
  }
  return `<div class='msg-avatar ${extraClass}'>${label}</div>`;
}

function renderChat() {
  renderChatHeader();
  const personaId = state.selectedPersona?.id;
  const persona = state.selectedPersona;
  
  if (!personaId) {
    chatLog.innerHTML = "<div class='msg assistant'>Selecione um agente para iniciar.</div>";
    return;
  }
  const history = state.historyByPersona[personaId] || [];
  
  // Build chat messages with proper grouping
  let html = "";
  let lastRole = null;
  
  history.forEach((item) => {
    const role = item.role === "user" ? "user" : "assistant";
    const isFirstInGroup = role !== lastRole;
    
    // Add timestamp for the message
    const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : "";
    
    // For assistant messages, include avatar (uses same persona as sidebar)
    let avatarHtml = "";
    if (role === "assistant" && isFirstInGroup) {
      avatarHtml = msgAvatarHtml(persona);
    }
    
    // Use Markdown for assistant messages, plain text for user
    const content = role === "assistant" ? renderMarkdown(item.content) : esc(item.content);
    
    html += `
      <div class='msg ${role}' data-streaming='${item._streaming ? "true" : "false"}'>
        ${avatarHtml}
        <div class='bubble'>${content}${item._streaming ? "" : ""}</div>
        <div class='msg-time'>${timeStr}</div>
      </div>`;
    lastRole = role;
  });
  
  if (history.length === 0) {
    html = "<div class='msg assistant'>Conversa iniciada. Pode mandar a primeira mensagem.</div>";
  }
  if (state.typingPersonaId === personaId) {
    html += "<div class='msg assistant typing-bubble'><span></span><span></span><span></span></div>";
  }
  chatLog.innerHTML = html;
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderAgentsSidebar() {
  const empty = "<div class='model-empty'>Nenhum agente encontrado.</div>";
  agentsSidebarList.innerHTML = state.personas.length
    ? state.personas.map((p, i) => {
        const st = agentStatus(p);
        const selected = state.selectedPersona?.id === p.id ? "active" : "";
        const lastTime = state.historyByPersona[p.id]?.length
          ? formatTimeAgo(state.historyByPersona[p.id][state.historyByPersona[p.id].length - 1].timestamp)
          : "";
        return `<div class='agent-sidebar-card ${selected}' data-open='${i}'>
          <div class='agent-sidebar-top'>
            ${avatarHtml(p)}
            <div class='agent-sidebar-info'>
              <div class='agent-sidebar-name'>${esc(p.nome)}</div>
              <div class='agent-sidebar-role'>${esc(p.papel || "Agente")}</div>
            </div>
          </div>
          <div class='agent-sidebar-meta'>
            <span class='agent-sidebar-status'><span class='dot ${st.cls}'></span>${esc(st.label)}</span>
            <span class='agent-sidebar-model' title='${esc(p.model || "")}'>◆ ${esc(p.model || "modelo")}</span>
          </div>
          ${lastTime ? `<div class='agent-sidebar-time'>${esc(lastTime)}</div>` : ""}
        </div>`;
      }).join("")
    : empty;

  // Rebind events
  agentsSidebarList.querySelectorAll(".agent-sidebar-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectPersonaByIndex(Number(card.getAttribute("data-open")), true);
    });
  });
}

// ===== Session List Functions =====

function formatSessionTimeAgo(isoString) {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return "agora";
    if (minutes < 60) return `${minutes}min`;
    if (hours < 24) return `${hours}h`;
    if (days === 1) return "ontem";
    return `${days}d`;
  } catch {
    return "";
  }
}

function getSessionPreview(session) {
  // Get last message content as preview
  const messages = session.messages || [];
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return "Nova conversa";
  const content = lastMsg.content || "";
  return content.length > 60 ? content.slice(0, 60) + "…" : content;
}

function renderSessionsList() {
  if (!sessionsList) return;
  const personaId = state.selectedPersona?.id;
  const sessions = personaId ? (state.sessionsByAgent[personaId] || []) : [];
  
  if (!personaId) {
    sessionsList.innerHTML = "<div class='model-empty'>Selecione um agente para ver as sessões</div>";
    return;
  }
  
  if (sessions.length === 0) {
    sessionsList.innerHTML = "<div class='model-empty'>Nenhuma sessão ainda. Inicie uma nova conversa.</div>";
    return;
  }
  
  sessionsList.innerHTML = sessions.map((session) => {
    const isActive = session.session_id === state.currentSessionId;
    const statusCls = session.status === "active" ? "active" : "finalized";
    const shortId = session.session_id ? session.session_id.slice(0, 8) : "";
    
    return `<div class='session-item ${isActive ? "active" : ""}' data-session-id='${session.session_id}'>
      <div class='session-header'>
        <span class='session-id'>#${esc(shortId)}</span>
        <span class='session-status-badge ${statusCls}'>${session.status === "active" ? "Ativa" : "Finalizada"}</span>
      </div>
      <div class='session-preview'>${esc(getSessionPreview(session))}</div>
      <div class='session-time'>${formatSessionTimeAgo(session.started_at)}</div>
    </div>`;
  }).join("");
  
  // Bind click events to load session history
  sessionsList.querySelectorAll(".session-item").forEach((item) => {
    item.addEventListener("click", () => {
      const sessionId = item.getAttribute("data-session-id");
      loadSessionHistory(sessionId);
    });
  });
}

async function loadSessionsForAgent(personaId) {
  if (!personaId) return;
  try {
    const res = await fetch(`/api/chat/sessions/by-persona/${encodeURIComponent(personaId)}`);
    if (!res.ok) {
      console.warn("Failed to load sessions for agent:", personaId);
      return;
    }
    const data = await res.json();
    state.sessionsByAgent[personaId] = data || [];
    renderSessionsList();
  } catch (err) {
    console.warn("Error loading sessions:", err);
  }
}

async function createNewSession() {
  const persona = state.selectedPersona;
  if (!persona) return;
  
  // Create session in backend immediately
  try {
    const res = await fetch("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: persona.id, model: persona.model, temperature: 0.7 })
    });
    const data = await res.json();
    if (data.session_id) {
      state.currentSessionId = data.session_id;
    }
  } catch (e) {
    console.warn("Failed to create session in backend:", e);
  }
  
  state.historyByPersona[persona.id] = [];
  saveHistory();
  
  // Reset pipeline state
  state.typingPersonaId = null;
  state.timelineItems = [];
  state.timelineSessions = {};
  state.stepTelemetry = {};
  state.pipelineActive = false;
  
  renderChat();
  renderSessionsList();
  
  // Reload sessions to get updated list
  loadSessionsForAgent(persona.id);
}

function loadSessionHistory(sessionId) {
  // Load a session's history into the chat
  const session = state.sessionsByAgent[state.selectedPersona?.id]?.find(s => s.session_id === sessionId);
  if (!session) {
    console.warn("Session not found:", sessionId);
    return;
  }
  
  // Set the session as active
  state.currentSessionId = sessionId;
  
  // Load messages from the session
  if (session.messages && session.messages.length > 0) {
    state.historyByPersona[state.selectedPersona.id] = session.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    }));
  } else {
    state.historyByPersona[state.selectedPersona.id] = [];
  }
  saveHistory();
  
  renderChat();
  renderSessionsList();
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return "";
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}min`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

function renderTelemetryForStage(stage, event) {
  // Placeholder - can be enhanced later
}

function selectPersonaByIndex(index, jumpToChat = false) {
  const persona = state.personas[index];
  if (!persona) return;
  
  const previousPersona = state.selectedPersona;
  state.selectedPersona = persona;
  state.historyByPersona[persona.id] = state.historyByPersona[persona.id] || [];
  rememberSelected(persona.id);
  
  // Carrega sessões do agente selecionado
  if (previousPersona?.id !== persona.id) {
    loadSessionsForAgent(persona.id);
  }
  
  // Atualiza todas as visualizações de agentes
  renderAgentContainers();
  renderAgentsSidebar();
  renderChat();
  
  // Renderiza o pipeline do agente selecionado (sem reset)
  restoreAgentPipeline(persona.id);
  
  if (jumpToChat) {
    setActivePage("chat");
    chatInput.focus();
  }
}

function saveAgentPipeline() {
  if (!state.selectedPersona) return;
  const agentId = state.selectedPersona.id;
  state.pipelineByAgent[agentId] = {
    timelineItems: state.timelineItems,
    currentSessionId: state.currentSessionId,
    pipelineActive: state.pipelineActive,
    currentAgentPipeline: state.currentAgentPipeline,
  };
  state.telemetryByAgent[agentId] = { ...state.stepTelemetry };
  state.timelineSessionsByAgent[agentId] = { ...state.timelineSessions };
}

function restoreAgentPipeline(agentId) {
  const saved = state.pipelineByAgent[agentId];
  if (saved) {
    state.timelineItems = saved.timelineItems || [];
    state.currentSessionId = saved.currentSessionId || null;
    state.pipelineActive = saved.pipelineActive || false;
    state.currentAgentPipeline = saved.currentAgentPipeline || null;
  } else {
    state.timelineItems = [];
    state.currentSessionId = null;
    state.pipelineActive = false;
    state.currentAgentPipeline = null;
  }
  
  state.stepTelemetry = state.telemetryByAgent[agentId] || {};
  state.timelineSessions = state.timelineSessionsByAgent[agentId] || {};
  
  // Re-renderiza pipeline
  if (state.currentSessionId && state.timelineSessions[state.currentSessionId]) {
    renderNewPipeline(state.timelineSessions[state.currentSessionId]);
  } else if (pipelineContainer) {
    pipelineContainer.innerHTML = "<div class='pipeline-empty'>Nenhuma execução em andamento</div>";
  }
  
  // Re-renderiza telemetria
  if (telemetryContainer) {
    if (Object.keys(state.stepTelemetry).length > 0) {
      const lastTelemetry = Object.values(state.stepTelemetry)[0];
      renderTelemetryFromMetrics(lastTelemetry);
    } else {
      telemetryContainer.innerHTML = "<div class='telemetry-empty'>Selecione uma etapa para ver detalhes</div>";
    }
  }
}

function resetAgentPipeline() {
  if (!state.selectedPersona) return;
  const agentId = state.selectedPersona.id;
  state.pipelineByAgent[agentId] = {
    timelineItems: [],
    currentSessionId: null,
    pipelineActive: false,
    currentAgentPipeline: null,
  };
  state.telemetryByAgent[agentId] = {};
  state.timelineSessionsByAgent[agentId] = {};
  
  state.timelineItems = [];
  state.currentSessionId = null;
  state.pipelineActive = false;
  state.currentAgentPipeline = null;
  state.stepTelemetry = {};
  state.timelineSessions = {};
  
  if (pipelineContainer) {
    pipelineContainer.innerHTML = "<div class='pipeline-empty'>Nenhuma execução em andamento</div>";
  }
  if (telemetryContainer) {
    telemetryContainer.innerHTML = "<div class='telemetry-empty'>Selecione uma etapa para ver detalhes</div>";
  }
}

// Knowledge Agent Chip Functions
function knowledgeAgentChipHtml(persona, index) {
  const selected = knowledgeSelectedPersonaId === persona.id ? "selected" : "";
  return `<button class='knowledge-agent-chip ${selected}' data-kagent='${index}' title='${esc(persona.nome)} · ${esc(persona.papel || "Agente")}'>
    ${avatarHtml(persona, "sm")}
    <div class='chip-info'>
      <span class='chip-name'>${esc(persona.nome)}</span>
      <span class='chip-role'>${esc(persona.papel || "Agente")}</span>
      <span class='chip-model' title='${esc(persona.model || "")}'>◆ ${esc(persona.model || "modelo")}</span>
    </div>
    <div class='chip-badges'>
      <span class='src-badge'>${esc(persona.source || "open-webui")}</span>
    </div>
  </button>`;
}

function renderKnowledgeAgentOptions() {
  if (!knowledgeAgentChips) {
    console.warn("knowledgeAgentChips element not found");
    return;
  }
  if (!state.personas.length) {
    knowledgeAgentChips.innerHTML = "<div class='model-empty'>Carregando agentes...</div>";
    return;
  }
  knowledgeAgentChips.innerHTML = state.personas.map((p, i) => knowledgeAgentChipHtml(p, i)).join("");
  
  // Bind click events to agent chips
  knowledgeAgentChips.querySelectorAll(".knowledge-agent-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const idx = Number(chip.getAttribute("data-kagent"));
      const persona = state.personas[idx];
      if (persona) {
        knowledgeSelectedPersonaId = persona.id;
        renderKnowledgeAgentOptions(); // re-render to update selection
        if (knowledgeTitle) knowledgeTitle.value = "";
        console.log("Selected knowledge agent:", persona.nome, persona.id);
      }
    });
  });
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

async function loadPersonas() {
  personasBox.innerHTML = "<div class='model-empty'>Carregando agentes...</div>";
  try {
    const res = await fetch("/api/personas");
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    state.personas = data.personas || [];
    console.log("Loaded personas:", state.personas.length);
    renderAgentContainers();
    renderAgentsSidebar();
    if (!state.personas.length) return;
    let storedId = "";
    try { storedId = localStorage.getItem(SELECTED_KEY) || ""; } catch { storedId = ""; }
    const targetId = state.selectedPersona?.id || storedId;
    const idx = state.personas.findIndex((p) => p.id === targetId);
    selectPersonaByIndex(idx >= 0 ? idx : 0, false);
  } catch (err) {
    console.error("loadPersonas error:", err);
    personasBox.innerHTML = `<div class='model-empty'>Erro ao carregar agentes: ${esc(err.message)}</div>`;
  }
}

// ===== WebSocket Chat =====

function resetTimeline() {
  if (!state.selectedPersona) return;
  const agentId = state.selectedPersona.id;
  
  state.timelineItems = [];
  state.timelineSessions = {};
  state.stepTelemetry = {};
  state.currentSessionId = null;
  state.pipelineActive = false;
  
  // Persiste o reset no estado do agente
  state.pipelineByAgent[agentId] = {
    timelineItems: [],
    currentSessionId: null,
    pipelineActive: false,
    currentAgentPipeline: null,
  };
  state.telemetryByAgent[agentId] = {};
  state.timelineSessionsByAgent[agentId] = {};
  
  if (pipelineContainer) {
    pipelineContainer.innerHTML = "<div class='pipeline-empty'>Nenhuma execução em andamento</div>";
  }
  if (telemetryContainer) {
    telemetryContainer.innerHTML = "<div class='telemetry-empty'>Selecione uma etapa para ver detalhes</div>";
  }
}

function getOrCreateSession(sessionId) {
  if (!state.timelineSessions[sessionId]) {
    state.timelineSessions[sessionId] = {
      id: sessionId,
      startTime: Date.now(),
      stages: [],
      totalDuration: 0,
    };
  }
  return state.timelineSessions[sessionId];
}

function addTimelineEvent(stage, label, status, durationMs, metadata) {
  const session = getOrCreateSession(state.currentSessionId || "pending");
  
  const event = { stage, label, status, durationMs, metadata };
  session.stages.push(event);
  
  if (durationMs) {
    session.totalDuration += durationMs;
  }
  
  renderNewPipeline(session);
  renderTelemetryForStage(stage, event);
}

function renderNewPipeline(session) {
  if (!pipelineContainer) return;
  
  if (!session.stages || session.stages.length === 0) {
    pipelineContainer.innerHTML = `
      <div class='pipeline-empty'>
        <div class='pipeline-empty-icon'>○</div>
        <div>Aguardando etapas...</div>
      </div>
    `;
    pipelineSubtitle.textContent = 'Nenhuma etapa iniciada';
    return;
  }
  
  const stagesHtml = session.stages.map((s, idx) => {
    const statusClass = s.status === 'done' ? 'step-done' : s.status === 'error' ? 'step-error' : s.status === 'running' ? 'step-running' : 'step-waiting';
    
    // Render telemetria inline se existir
    const telemetryHtml = s.metadata && Object.keys(s.metadata).length > 0 ? `
      <div class='step-telemetry'>
        <div class='step-telemetry-header'>📊 Telemetria</div>
        ${Object.entries(s.metadata).map(([key, value]) => {
          const label = key.replace(/_/g, ' ');
          const displayValue = typeof value === 'number' ? value.toLocaleString() : value;
          return `<div class='step-telemetry-item'><span class='step-telemetry-label'>${esc(label)}</span><span class='step-telemetry-value'>${esc(displayValue)}</span></div>`;
        }).join('')}
      </div>
    ` : '';
    
    // Resumo da etapa
    const summary = getStageSummary(s.stage, s.metadata);
    
    return `
      <div class='pipeline-card ${statusClass}' data-stage='${s.stage}'>
        <div class='step-header'>
          <div class='step-header-left'>
            <span class='step-icon'>${getStageIcon(s.stage, s.status)}</span>
            <div>
              <div class='step-title'>${esc(s.label)}</div>
              ${summary ? `<div class='step-summary'>${esc(summary)}</div>` : ''}
            </div>
          </div>
          <span class='step-status status-${s.status}'>${getStatusLabel(s.status)}</span>
        </div>
        <div class='step-meta'>
          ${s.durationMs ? `<span class='step-duration'>⏱ ${s.durationMs.toFixed(0)}ms</span>` : ''}
          ${s.stage ? `<span class='step-badge'>${esc(s.stage)}</span>` : ''}
        </div>
        ${telemetryHtml}
      </div>
      ${idx < session.stages.length - 1 ? `<div class='pipeline-connector connector-${s.status}'><span class='pipeline-connector-arrow'>${s.status === 'done' ? '✓' : s.status === 'running' ? '●' : '→'}</span></div>` : ''}
    `;
  }).join('');
  
  const completed = session.stages.filter(s => s.status === 'done').length;
  const total = session.stages.length;
  const hasError = session.stages.some(s => s.status === 'error');
  
  const footerHtml = `
    <span class='session-progress'>✅ ${completed}/${total} etapas</span>
    ${session.totalDuration > 0 ? `<span class='session-total-time'>⏱️ ${formatDuration(session.totalDuration)}</span>` : ''}
    ${hasError ? `<span class='session-error'>⚠️ Com erros</span>` : ''}
  `;
  
  pipelineSubtitle.textContent = `${total} etapa(s) na sessão #${session.id.slice(0, 8)}`;
  
  pipelineContainer.innerHTML = `
    <div class='pipeline-track'>
      ${stagesHtml}
    </div>
    <div class='pipeline-footer'>
      <div class='pipeline-progress-bar'>
        <div class='pipeline-progress-fill' style='width:${total > 0 ? (completed / total * 100).toFixed(0) : 0}%'></div>
      </div>
      <div class='pipeline-progress-text'>
        ${footerHtml}
      </div>
    </div>
  `;
}

function getStageIcon(stage, status) {
  const icons = {
    memory: '🧠',
    vector_search: '🔍',
    redis_cache: '⚡',
    prompt_build: '📝',
    llm_call: '🤖',
    response: '💬',
  };
  if (status === 'done') return '✅';
  if (status === 'error') return '❌';
  if (status === 'running') return '⏳';
  return icons[stage] || '○';
}

function getStatusLabel(status) {
  const labels = {
    'done': 'Concluído',
    'error': 'Erro',
    'running': 'Executando',
    'waiting': 'Aguardando'
  };
  return labels[status] || status;
}

function getStageDescription(stage) {
  const descriptions = {
    memory: 'Verifica se essa pergunta (ou similar) já foi respondida antes, evitando reprocessamento.',
    vector_search: 'Recupera os documentos mais relevantes da base de conhecimento via similaridade de embeddings.',
    redis_cache: 'Verifica se uma resposta idêntica já está em cache para evitar chamada redundante ao modelo.',
    prompt_build: 'Monta o prompt final combinando system prompt, histórico e documentos recuperados.',
    llm_call: 'Envia o prompt final ao modelo selecionado e aguarda a geração da resposta.',
    response: 'Resposta final formatada e entregue ao usuário na interface de chat.',
  };
  return descriptions[stage] || 'Etapa de processamento.';
}

function getStageSummary(stage, metadata) {
  if (!metadata) return '';
  
  switch (stage) {
    case 'memory':
      return metadata.memory_found !== undefined 
        ? (metadata.memory_found ? 'Memória anterior encontrada' : 'Sem memória anterior')
        : '';
      
    case 'vector_search':
      const parts = [];
      if (metadata.documents_found !== undefined) parts.push(`${metadata.documents_found} documento(s)`);
      if (metadata.top_k) parts.push(`Top ${metadata.top_k}`);
      if (metadata.score !== undefined) parts.push(`Score: ${metadata.score.toFixed(3)}`);
      return parts.join(' · ');
      
    case 'redis_cache':
      return metadata.hit !== undefined ? (metadata.hit ? 'Cache HIT' : 'Cache MISS') : '';
      
    case 'prompt_build':
      const promptParts = [];
      if (metadata.context_chars) promptParts.push(`${metadata.context_chars.toLocaleString()} chars`);
      if (metadata.messages_count) promptParts.push(`${metadata.messages_count} msgs`);
      if (metadata.estimated_tokens) promptParts.push(`~${metadata.estimated_tokens.toLocaleString()} tokens`);
      return promptParts.join(' · ');
      
    case 'llm_call':
      const llmParts = [];
      if (metadata.model) llmParts.push(metadata.model);
      if (metadata.temperature) llmParts.push(`Temp: ${metadata.temperature}`);
      return llmParts.join(' · ');
      
    case 'response':
      return 'Processamento concluído';
      
    default:
      return '';
  }
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return "-";
  const msVal = Number(ms);
  if (msVal < 1000) return `${msVal.toFixed(0)}ms`;
  const seconds = msVal / 1000;
  if (seconds < 60) return `${msVal.toFixed(0)}ms | ${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - minutes * 60;
  return `${msVal.toFixed(0)}ms | ${minutes}m ${remainingSeconds.toFixed(1)}s`;
}

function updateMetrics(metrics) {
  if (!epMetrics) return;
  epMetrics.style.display = "";
  
  const setMetric = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  
  setMetric("m-total-time", formatDuration(metrics.total_duration_ms));
  setMetric("m-tokens-sent", metrics.tokens_sent?.toLocaleString() || "-");
  setMetric("m-tokens-recv", metrics.tokens_received?.toLocaleString() || "-");
  setMetric("m-docs", metrics.documents_found || "0");
  setMetric("m-cache", metrics.redis_cache_hit ? "✅ Hit" : "❌ Miss");
  setMetric("m-model", metrics.model_used || "-");
  setMetric("m-temp", metrics.temperature || "-");
  setMetric("m-latency", formatDuration(metrics.llm_latency_ms));
  setMetric("m-provider", metrics.provider ? `${esc(metrics.provider)}` : "-");
  setMetric("m-memory", metrics.memory_used ? "✅" : "❌");
  setMetric("m-embeddings", metrics.embeddings_queried || "-");
  setMetric("m-records", metrics.records_returned || "-");
}

function renderNewPipelineFromEvents() {
  if (!pipelineContainer || !state.currentSessionId) return;
  const session = state.timelineSessions[state.currentSessionId];
  if (!session) return;
  renderNewPipeline(session);
}

function renderTelemetryFromMetrics(metrics) {
  if (!telemetryContainer || !metrics) return;
  
  const stageName = metrics.stage || 'geral';
  const html = `
    <div class='telemetry-card'>
      <div class='telemetry-card-header'>
        <span class='telemetry-step-badge'>${esc(stageName)}</span>
        <span class='telemetry-step-time'>${new Date().toLocaleTimeString('pt-BR')}</span>
      </div>
      <div class='telemetry-metrics'>
        ${metrics.total_duration_ms ? `<div class='telemetry-metric'><span class='telemetry-metric-label'>Tempo</span><span class='telemetry-metric-value'>${formatDuration(metrics.total_duration_ms)}</span></div>` : ''}
        ${metrics.tokens_sent ? `<div class='telemetry-metric'><span class='telemetry-metric-label'>Tokens enviados</span><span class='telemetry-metric-value'>${metrics.tokens_sent.toLocaleString()}</span></div>` : ''}
        ${metrics.tokens_received ? `<div class='telemetry-metric'><span class='telemetry-metric-label'>Tokens recebidos</span><span class='telemetry-metric-value'>${metrics.tokens_received.toLocaleString()}</span></div>` : ''}
        ${metrics.documents_found ? `<div class='telemetry-metric'><span class='telemetry-metric-label'>Documentos</span><span class='telemetry-metric-value'>${metrics.documents_found}</span></div>` : ''}
        ${metrics.redis_cache_hit !== undefined ? `<div class='telemetry-metric'><span class='telemetry-metric-label'>Cache Redis</span><span class='telemetry-metric-value'>${metrics.redis_cache_hit ? '✅ Hit' : '❌ Miss'}</span></div>` : ''}
        ${metrics.model_used ? `<div class='telemetry-metric'><span class='telemetry-metric-label'>Modelo</span><span class='telemetry-metric-value'>${esc(metrics.model_used)}</span></div>` : ''}
        ${metrics.temperature ? `<div class='telemetry-metric'><span class='telemetry-metric-label'>Temperatura</span><span class='telemetry-metric-value'>${metrics.temperature}</span></div>` : ''}
        ${metrics.llm_latency_ms ? `<div class='telemetry-metric'><span class='telemetry-metric-label'>Latência LLM</span><span class='telemetry-metric-value'>${formatDuration(metrics.llm_latency_ms)}</span></div>` : ''}
      </div>
    </div>
  `;
  
  telemetryContainer.innerHTML = html;
}


function connectChatWebSocket(message) {
  if (state.chatWs) {
    state.chatWs.close();
    state.chatWs = null;
  }

  const persona = state.selectedPersona;
  if (!persona) return;

  const wsUrl = window.location.protocol === "https:" 
    ? `wss://${window.location.host}/api/chat/ws`
    : `ws://${window.location.host}/api/chat/ws`;

  state.pipelineActive = true;
  // Não reseta timeline ao conectar - preserva dados existentes do agente
  // Apenas cria nova sessão se necessário
  if (!state.currentSessionId) {
    resetTimeline();
  }

  const ws = new WebSocket(wsUrl);
  state.chatWs = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "send",
      persona_id: persona.id,
      message: message,
      model: persona.model || persona.id,
      temperature: 0.7,
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      
      switch (msg.type) {
        case "session_start":
          state.currentSessionId = msg.session_id;
          console.log("Session started:", msg.session_id);
          break;

          case "stage":
            addTimelineEvent(
              msg.stage,
              msg.label,
              msg.status,
              msg.metadata?.duration_ms,
              msg.metadata
            );
            break;

        case "token":
          // Append token to current assistant message - optimized streaming
          const personaId = state.selectedPersona?.id;
          if (personaId) {
            const history = state.historyByPersona[personaId] || [];
            const lastMsg = history[history.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              if (!lastMsg._streaming) {
                lastMsg._streaming = true;
                lastMsg.content = msg.content;
                renderChat();
              } else {
                lastMsg.content += msg.content;
                // Atualiza apenas o conteúdo da última bolha
                const lastBubble = chatLog.querySelector(".msg.assistant .bubble:last-of-type");
                if (lastBubble) {
                  lastBubble.innerHTML = renderMarkdown(lastMsg.content);
                  // Scroll suave se estiver perto do final
                  const { scrollTop, scrollHeight, clientHeight } = chatLog;
                  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 30;
                  if (isAtBottom) {
                    chatLog.scrollTop = scrollHeight;
                  }
                }
              }
            } else {
              history.push({ role: "assistant", content: msg.content, _streaming: true });
              renderChat();
            }
          }
          break;

        case "metrics":
          updateMetrics(msg.metrics);
          renderTelemetryFromMetrics(msg.metrics);
          break;

        case "timeline":
          if (msg.timeline) {
            msg.timeline.forEach(t => {
              addTimelineEvent(t.stage, t.label, t.status, t.duration_ms, t.metadata);
            });
          }
          break;

        case "done":
          state.pipelineActive = false;
          state.typingPersonaId = null;
          state.currentSessionId = msg.session_id;
          
          // Salva estado do pipeline
          saveAgentPipeline();
          
          // Finalize streaming message
          const pId = state.selectedPersona?.id;
          if (pId && msg.reply) {
            const history = state.historyByPersona[pId] || [];
            const lastMsg = history[history.length - 1];
            if (lastMsg && lastMsg.role === "assistant" && lastMsg._streaming) {
              lastMsg.content = msg.reply;
              delete lastMsg._streaming;
            } else {
              history.push({ role: "assistant", content: msg.reply });
            }
            saveHistory();
            renderChat();
          }
          break;

        case "error":
          console.error("WebSocket error:", msg.error);
          state.pipelineActive = false;
          state.typingPersonaId = null;
          const errPersonaId = state.selectedPersona?.id;
          if (errPersonaId) {
            const history = state.historyByPersona[errPersonaId] || [];
            history.push({ role: "assistant", content: `Erro: ${msg.error}` });
            saveHistory();
            renderChat();
          }
          break;

        case "finalized":
          state.currentSessionId = null;
          state.pipelineActive = false;
          saveAgentPipeline();
          if (finalizeResult) {
            finalizeResult.style.display = "";
            finalizeResult.textContent = JSON.stringify(msg, null, 2);
          }
          console.log("Session finalized:", msg);
          break;
      }
    } catch (e) {
      console.warn("WS message parse error:", e);
    }
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    state.pipelineActive = false;
    state.typingPersonaId = null;
  };

  ws.onclose = () => {
    if (state.chatWs === ws) {
      state.chatWs = null;
    }
    state.pipelineActive = false;
  };
}

async function sendChat() {
  let persona;
  try { persona = ensurePersonaSelected(); } catch (err) { alert(err.message); return; }
  const text = chatInput.value.trim();
  if (!text) return;
  
  const personaId = persona.id;
  state.historyByPersona[personaId] = state.historyByPersona[personaId] || [];
  const history = state.historyByPersona[personaId];
  
  // Add user message com timestamp
  history.push({ role: "user", content: text, timestamp: Date.now() });
  chatInput.value = "";
  saveHistory();
  state.typingPersonaId = personaId;
  renderChat();
  renderAgentContainers();
  renderAgentsSidebar();

  // Connect via WebSocket
  connectChatWebSocket(text);
}

// ===== Finalize Session =====

function openFinalizeModal() {
  if (!state.currentSessionId) {
    alert("Nenhuma sessão ativa para finalizar.");
    return;
  }
  
  if (state.pipelineActive) {
    alert("Aguarde a resposta do agente antes de finalizar.");
    return;
  }

  if (finalizeSummary) finalizeSummary.style.display = "none";
  if (finalizeResult) finalizeResult.style.display = "none";
  if (finalizeModal) finalizeModal.style.display = "";
  
  // Default to "discard"
  document.querySelectorAll(".finalize-option").forEach(opt => {
    opt.classList.toggle("selected", opt.dataset.option === "discard");
  });
}

function closeFinalizeModal() {
  if (finalizeModal) finalizeModal.style.display = "none";
}

async function confirmFinalize() {
  if (!state.currentSessionId) return;
  
  const selectedOption = document.querySelector(".finalize-option.selected");
  const option = selectedOption ? selectedOption.dataset.option : "discard";
  
  if (finalizeResult) {
    finalizeResult.style.display = "";
    finalizeResult.textContent = "Finalizando conversa...";
  }
  
  try {
    const res = await fetch("/api/chat/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: state.currentSessionId,
        option: option,
      }),
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.detail || data.error || "Erro ao finalizar");
    }
    
    if (finalizeResult) {
      finalizeResult.textContent = option === "discard" 
        ? "✅ Conversa encerrada. Contexto descartado."
        : option === "auto_save"
          ? `✅ Conversa finalizada. Memórias extraídas: ${data.memory?.saved || 0} salvas, ${data.memory?.indexed || 0} indexadas.`
          : `✅ Conversa finalizada. Resumo gerado para aprovação.`;
    }
    
    // Se for "approve", mostra o resumo
    if (option === "approve" && data.summary && finalizeSummary) {
      finalizeSummary.style.display = "";
      if (finalizeSummaryContent) finalizeSummaryContent.textContent = data.summary;
    }
    
    // Reseta estado do pipeline
    state.currentSessionId = null;
    state.pipelineActive = false;
    saveAgentPipeline();
    resetTimeline();
    
    // Fecha modal após 2 segundos
    setTimeout(closeFinalizeModal, 2000);
    
  } catch (err) {
    if (finalizeResult) {
      finalizeResult.textContent = `❌ Erro: ${err.message}`;
    }
  }
}

// Bind finalize modal events
if (finalizeChatBtn) {
  finalizeChatBtn.addEventListener("click", openFinalizeModal);
}

document.querySelectorAll(".finalize-option").forEach(opt => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".finalize-option").forEach(o => o.classList.remove("selected"));
    opt.classList.add("selected");
  });
});

document.getElementById("finalize-modal-close")?.addEventListener("click", closeFinalizeModal);
document.getElementById("finalize-modal-cancel")?.addEventListener("click", closeFinalizeModal);
if (finalizeModal) {
  finalizeModal.addEventListener("click", (e) => {
    if (e.target === finalizeModal) closeFinalizeModal();
  });
}
document.getElementById("finalize-modal-confirm")?.addEventListener("click", confirmFinalize);

// Toggle execution panel
document.getElementById("toggle-execution-panel")?.addEventListener("click", () => {
  if (executionPanel) {
    executionPanel.classList.toggle("collapsed");
    const toggle = document.getElementById("toggle-execution-panel");
    if (toggle) toggle.textContent = executionPanel.classList.contains("collapsed") ? "▷" : "▽";
  }
});

// Toggle metrics
document.getElementById("toggle-metrics")?.addEventListener("click", () => {
  const body = document.getElementById("ep-metrics-body");
  const toggle = document.getElementById("toggle-metrics");
  if (body) body.style.display = body.style.display === "none" ? "" : "none";
  if (toggle) toggle.textContent = body?.style.display === "none" ? "▷" : "▽";
});

// ===== Legacy sendChat (kept for backward compatibility) =====

async function sendChatViaFlow() {
  const text = chatInput.value.trim();
  if (!text) { alert("Digite a mensagem antes de enviar via n8n."); return; }
  await startFlow("chat", text, { channel: "frontend" });
}

// ===== Knowledge Functions =====

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
  const personaId = knowledgeSelectedPersonaId || state.selectedPersona?.id || "";
  if (!personaId) { alert("Selecione um agente."); return; }
  const title = String(knowledgeTitle?.value || "").trim();
  const content = String(knowledgeContent?.value || "").trim();
  const files = state.knowledgeFiles || [];
  const tagsRaw = String(knowledgeTags?.value || "").trim();
  const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(t => t) : [];
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
        body: JSON.stringify({ persona_id: personaId, title: it.title, source: it.source, content: it.content, tags }),
      });
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
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

// Busca na sidebar de agentes
if (agentSearchSidebar) {
  agentSearchSidebar.addEventListener("input", () => {
    const q = agentSearchSidebar.value.trim().toLowerCase();
    agentsSidebarList.querySelectorAll(".agent-sidebar-card").forEach((card) => {
      const idx = Number(card.getAttribute("data-open"));
      const p = state.personas[idx];
      const hit = !q || (p && `${p.nome} ${p.papel} ${p.model}`.toLowerCase().includes(q));
      card.style.display = hit ? "" : "none";
    });
  });
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

/* ===== Plan/Act visual toggle (sem lógica funcional) ===== */
(function () {
  const planBtn = document.getElementById("btn-plan");
  const actBtn = document.getElementById("btn-act");
  if (!planBtn || !actBtn) return;
  const activate = (btn) => {
    planBtn.classList.toggle("active", btn === planBtn);
    actBtn.classList.toggle("active", btn === actBtn);
  };
  planBtn.addEventListener("click", () => activate(planBtn));
  actBtn.addEventListener("click", () => activate(actBtn));
})();

// Bind new session button
if (newSessionBtn) {
  newSessionBtn.addEventListener("click", createNewSession);
}

loadStatus();
loadModels();
loadPersonas();
renderChat();
loadIoTDevices();
setInterval(loadStatus, 20000);
