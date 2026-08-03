/* mem0 — OpenCode Memory web UI
   Zero-dependency vanilla SPA. Terminal-native, mono, hairlines.
   All server state lives in `state`; views re-render after every mutation. */

// ── Constants ──────────────────────────────────────────────────────────────

const API_KEY_STORAGE_KEY = "opencodeMemApiKey";
const PAGE_SIZE_KEY = "mem0-page-size";
const THEME_KEY = "mem0-theme";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "layout-dashboard", marker: "[=]" },
  { id: "memories", label: "Memories", icon: "database", marker: "[+]" },
  { id: "search", label: "Search", icon: "search", marker: "[?]" },
  { id: "timeline", label: "Timeline", icon: "history", marker: "[~]" },
  { id: "profile", label: "Profile", icon: "user-round", marker: "[@]" },
  { id: "conflicts", label: "Conflicts", icon: "git-compare-arrows", marker: "[!]" },
  { id: "maintenance", label: "Maintenance", icon: "wrench", marker: "[*]" },
  { id: "settings", label: "Settings", icon: "settings", marker: "[.]" },
];

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  view: "dashboard",
  loading: false,
  error: null,

  status: null, // GET /api/status
  stats: null, // GET /api/stats
  transcriptTotal: null,
  tags: [], // container TagInfo[]
  conflictBadge: 0,

  // memories
  memFilter: "all", // all | memories
  memTag: "",
  memories: [],
  memPage: 1,
  memTotalPages: 1,
  memTotal: 0,
  selected: new Set(),

  // search
  searchQuery: "",
  searchTag: "",
  searchItems: [],
  searchPage: 1,
  searchTotalPages: 1,
  searchTotal: 0,
  searchRan: false,

  // timeline
  txQuery: "",
  transcripts: [],
  txPage: 1,
  txTotalPages: 1,

  // profile
  profile: null,
  changelogs: [],

  // conflicts
  conflicts: [],
  conflictStats: null,
  conflictView: "unresolved", // unresolved | resolved

  // maintenance
  embeddingCache: null,
  migration: null,
  tagMigration: null,
  tagMigrationBusy: false,
  tagMigrationProgress: null,

  // llm extraction config (GET/PUT /api/config)
  config: null,
  configError: null,

  pageSize: Number(localStorage.getItem(PAGE_SIZE_KEY)) || 20,
};

// ── Utils ──────────────────────────────────────────────────────────────────

const $ = (sel, root = document) => root.querySelector(sel);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Accepts ISO strings, epoch ms, or epoch s. */
function toDate(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? (value < 1e11 ? value * 1000 : value) : Date.parse(value);
  if (Number.isNaN(n)) return null;
  return new Date(n);
}

function fmtDate(value) {
  const d = toDate(value);
  if (!d) return "—";
  return (
    d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

function relTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(value);
}

function renderMarkdown(text) {
  if (window.marked && window.DOMPurify) {
    return DOMPurify.sanitize(marked.parse(String(text ?? ""), { breaks: true }));
  }
  return `<pre>${esc(text)}</pre>`;
}

/** Parse loose JSON-ish API payloads for display. */
function prettyJson(raw) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return String(raw ?? "");
  }
}

function itemText(item) {
  return item?.content ?? item?.memory ?? "";
}

function itemTypeBadge(item) {
  if (item?.type === "prompt") return `<span class="badge prompt">prompt</span>`;
  const mt = item?.memoryType || item?.type;
  return (
    `<span class="badge memory">memory</span>` +
    (mt && mt !== "memory" ? ` <span class="badge type">${esc(mt)}</span>` : "")
  );
}

/**
 * Final barrier for every HTML string that hits a DOM sink. Per-value esc()
 * plus DOMPurify for markdown, already covers interpolation; sanitizing again
 * at the sink is defense-in-depth (and what CodeQL recognizes as an XSS
 * barrier). Falls back to the raw string when DOMPurify hasn't loaded
 * (e.g. unit smoke harness without vendor scripts).
 */
function sanitizeHtml(html) {
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}

// ── API client ─────────────────────────────────────────────────────────────

function apiHeaders(options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const key = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (key && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${key}`);
  return headers;
}

async function api(endpoint, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(endpoint, {
      ...options,
      headers: apiHeaders(options),
      signal: controller.signal,
    });
    if (res.status === 401) {
      return { success: false, error: "Unauthorized — set your API key in Settings", auth: true };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        success: false,
        error: `HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`,
      };
    }
    return await res.json();
  } catch (err) {
    return { success: false, error: err.name === "AbortError" ? "Request timed out" : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

const apiGet = (url) => api(url);
const apiPost = (url, body) =>
  api(url, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const apiPut = (url, body) => api(url, { method: "PUT", body: JSON.stringify(body) });
const apiDel = (url) => api(url, { method: "DELETE" });

// ── Toast & modal ──────────────────────────────────────────────────────────

function toast(message, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast${type === "error" ? " error" : ""}`;
  el.setAttribute("role", "status");
  el.textContent = message;
  $("#toast-root").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

let modalPrevFocus = null;

function openModal({ title, body, wide = false, danger = false, actions = [] }) {
  modalPrevFocus = document.activeElement;
  const root = $("#modal-root");
  const id = `m-${Date.now()}`;
  root.innerHTML = sanitizeHtml(`
    <div class="modal-overlay" data-overlay>
      <div class="modal-content ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${id}">
        <div class="modal-header">
          <h3 id="${id}"><span class="row-marker ${danger ? "danger" : ""}">${danger ? "[!]" : "[>]"}</span> ${esc(title)}</h3>
          <button class="btn btn-ghost btn-icon" data-modal-close aria-label="Close dialog"><i data-lucide="x" class="icon"></i></button>
        </div>
        <div class="modal-body">${body}</div>
        ${
          actions.length
            ? `<div class="modal-actions" style="padding: 0 var(--sp-4) var(--sp-4);">${actions
                .map(
                  (a, i) =>
                    `<button class="btn ${a.kind || ""}" data-modal-action="${i}">${a.icon ? `<i data-lucide="${a.icon}" class="icon"></i>` : ""}${esc(a.label)}</button>`
                )
                .join("")}</div>`
            : ""
        }
      </div>
    </div>`);
  const overlay = root.firstElementChild;
  overlay.addEventListener("click", (e) => {
    if (e.target.dataset.overlay !== undefined) closeModal();
  });
  overlay.querySelector("[data-modal-close]").addEventListener("click", closeModal);
  overlay.querySelectorAll("[data-modal-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = actions[Number(btn.dataset.modalAction)];
      if (action.onClick) action.onClick();
      if (!action.keepOpen) closeModal();
    });
  });
  window.lucide?.createIcons();
  overlay.querySelector("[data-modal-close]").focus();
  return overlay;
}

function closeModal() {
  $("#modal-root").innerHTML = "";
  modalPrevFocus?.focus?.();
  modalPrevFocus = null;
}

function confirmModal(title, message, { danger = true, confirmLabel = "Confirm" } = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      danger,
      body: `<p class="row-text">${message}</p>`,
      actions: [
        { label: "Cancel", kind: "", onClick: () => resolve(false) },
        {
          label: confirmLabel,
          kind: danger ? "btn-danger" : "btn-primary",
          onClick: () => resolve(true),
        },
      ],
    });
  });
}

// ── Shared UI fragments ────────────────────────────────────────────────────

function sectionLabel(text) {
  return `<div class="section-label"><span class="marker">▸</span>${esc(text)}</div>`;
}

function skeleton(lines = 4) {
  return `<div class="card"><div class="skeleton">${Array.from({ length: lines })
    .map((_, i) => `<div class="line ${i % 2 ? "w70" : "w40"}"></div>`)
    .join("")}</div></div>`;
}

function empty(glyph, text, hint = "") {
  return `<div class="empty"><span class="glyph">${esc(glyph)}</span>${esc(text)}${hint ? `<div class="mt-2">${esc(hint)}</div>` : ""}</div>`;
}

function errorCard(message) {
  return `<div class="card"><div class="empty"><span class="glyph text-danger">[x]</span><span class="text-danger">${esc(message)}</span>
    <div class="mt-3"><button class="btn btn-sm" data-action="reload-view"><i data-lucide="refresh-cw" class="icon"></i>Retry</button></div></div></div>`;
}

function pagination(page, totalPages, action) {
  if (totalPages <= 1) return "";
  return `<div class="pagination">
    <button class="btn btn-sm" data-action="${action}" data-delta="-1" ${page <= 1 ? "disabled" : ""}><i data-lucide="chevron-left" class="icon"></i>prev</button>
    <span class="mono-nums">${page} / ${totalPages}</span>
    <button class="btn btn-sm" data-action="${action}" data-delta="1" ${page >= totalPages ? "disabled" : ""}>next<i data-lucide="chevron-right" class="icon"></i></button>
  </div>`;
}

function simMeter(similarity) {
  if (similarity == null) return "";
  const pct = Math.round(similarity * 100);
  return `<span class="sim"><span class="bar"><span style="width:${pct}%"></span></span>${pct}%</span>`;
}

function statusDot(cls, text) {
  return `<span class="sys-status"><span class="status-dot ${cls}"></span>${esc(text)}</span>`;
}

function tagSelectOptions(active) {
  return (
    `<option value="">all containers</option>` +
    state.tags
      .map((t) => {
        const label = t.displayName || t.projectName || t.tag;
        return `<option value="${esc(t.tag)}" ${t.tag === active ? "selected" : ""}>${esc(label)}</option>`;
      })
      .join("")
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────

function renderShell() {
  const navHtml = NAV.map((n) => {
    const badge =
      n.id === "conflicts" && state.conflictBadge > 0
        ? `<span class="nav-badge">${state.conflictBadge}</span>`
        : "";
    return `<a class="nav-link ${state.view === n.id ? "active" : ""}" href="#/${n.id}" data-nav>
      <i data-lucide="${n.icon}" class="icon"></i><span class="row-marker muted" style="width:3ch">${n.marker}</span>${n.label}${badge}</a>`;
  }).join("");

  const s = state.status;
  const dot = !s
    ? statusDot("", "connecting…")
    : s.ready
      ? statusDot("ok", `${s.mode} · ready`)
      : statusDot("warn", s.warmedUp ? "not ready" : "warming up");

  const title = NAV.find((n) => n.id === state.view)?.label || state.view;

  return `
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <span class="brand-glyph">▚</span>
        <div><span class="brand-name">mem0</span><span class="brand-sub">opencode memory</span></div>
      </div>
      <nav class="nav" aria-label="Views">${navHtml}</nav>
      <div class="sidebar-foot">
        ${dot}
        <button class="btn btn-ghost btn-icon" data-action="theme-toggle" aria-label="Toggle theme" title="Toggle theme">
          <i data-lucide="${currentTheme() === "dark" ? "sun" : "moon"}" class="icon"></i>
        </button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn btn-ghost btn-icon nav-toggle" data-action="toggle-sidebar" aria-label="Toggle navigation"><i data-lucide="menu" class="icon"></i></button>
        <div class="topbar-title"><span class="crumb">mem0 /</span> ${esc(title)}</div>
        <div class="topbar-actions">
          <button class="btn btn-ghost btn-icon" data-action="reload-view" aria-label="Reload view" title="Reload view">
            <i data-lucide="refresh-cw" class="icon ${state.loading ? "spin" : ""}"></i>
          </button>
        </div>
      </header>
      <main class="content" id="view">${renderView()}</main>
    </div>
  </div>`;
}

function render() {
  $("#app").innerHTML = sanitizeHtml(renderShell());
  window.lucide?.createIcons();
}

// ── View: Dashboard ────────────────────────────────────────────────────────

async function loadDashboard() {
  const [stats, tx, tags, profile] = await Promise.all([
    apiGet("/api/stats"),
    apiGet("/api/transcripts?page=1&pageSize=500"),
    loadTags(),
    apiGet("/api/user-profile"),
  ]);
  state.error = stats.success ? null : stats.error;
  state.stats = stats.success ? stats.data : null;
  state.transcriptTotal = tx.success ? (tx.data?.total ?? null) : null;
  state.profile = profile.success ? profile.data : null;
  const mem = await apiGet("/api/memories?page=1&pageSize=5");
  state.memories = mem.success ? mem.data.items : [];
}

function viewDashboard() {
  if (state.loading && !state.stats) return skeleton(5);
  const st = state.stats;
  const p = state.profile;
  const jobs = st?.backgroundJobs || {};
  const scope = st?.byScope || { user: 0, project: 0 };

  const statsGrid = `
    <div class="stats-grid">
      ${statCard("database", "memories", st?.total, state.stats ? `${scope.user} user · ${scope.project} project` : "")}
      ${statCard("terminal", "prompts analyzed", p ? p.totalPromptsAnalyzed : undefined, p?.exists === false ? "no profile yet" : "")}
      ${statCard("tag", "projects", state.tags.length || undefined, "")}
      ${statCard("file-text", "transcripts", state.transcriptTotal ?? undefined, "")}
    </div>`;

  const jobsCard = Object.keys(jobs).length
    ? `${sectionLabel("background jobs")}
      <div class="card"><div class="rows">${Object.entries(jobs)
        .map(
          ([name, j]) => `
          <div class="row">
            <span class="row-marker">[*]</span>
            <div class="row-main">
              <div class="row-title">${esc(name)}</div>
              <div class="row-meta"><span>last run ${j.lastDurationMs != null ? `${j.lastDurationMs}ms` : "—"}</span><span>${j.skippedCycles ?? 0} skipped cycles</span></div>
            </div>
          </div>`
        )
        .join("")}</div></div>`
    : "";

  const recent = state.memories.length
    ? `${sectionLabel("recent")}
      <div class="card"><div class="rows">${state.memories.map(memoryRow).join("")}</div></div>`
    : "";

  const addForm = `
    ${sectionLabel("quick add")}
    <div class="card"><div class="card-body">
      <form data-form="add-memory">
        <div class="field"><label for="qa-content">content</label>
          <textarea id="qa-content" class="textarea" name="content" required placeholder="something worth remembering…"></textarea></div>
        <div class="toolbar">
          <div class="field grow"><label for="qa-tag">project tag</label>
            <input id="qa-tag" class="input" name="containerTag" required list="container-tags" placeholder="project or user tag" />
            <datalist id="container-tags">${state.tags.map((t) => `<option value="${esc(t.tag)}">${esc(t.displayName || t.projectName || "")}</option>`).join("")}</datalist></div>
          <div class="field"><label for="qa-type">type</label>
            <input id="qa-type" class="input" name="type" list="type-suggestions" placeholder="fact" />
            <datalist id="type-suggestions"><option value="fact"></option><option value="preference"></option><option value="decision"></option><option value="context"></option></datalist></div>
          <div class="field"><label for="qa-tags">tags (csv)</label>
            <input id="qa-tags" class="input" name="tags" placeholder="api, auth" /></div>
          <div class="field"><label>&nbsp;</label>
            <button class="btn btn-primary" type="submit"><i data-lucide="plus" class="icon"></i>add memory</button></div>
        </div>
      </form>
    </div></div>`;

  return `
    <div class="hero">
      <div class="flex items-center gap-3">
        <span class="brand-glyph" style="font-size:22px">▚ mem0</span>
        <span class="text-dim">— persistent memory for your agent</span>
      </div>
      <div class="hero-line">
        <span>status <b>${state.status?.ready ? "ready" : "warming"}</b></span>
        <span>mode <b>${esc(state.status?.mode || "…")}</b></span>
        <span>embeddings <b>${state.status?.warmedUp ? "warm" : "cold"}</b></span>
        ${st ? `<span>types <b>${Object.keys(st.byType || {}).length}</b></span>` : ""}
      </div>
    </div>
    ${state.error ? errorCard(state.error) : ""}
    ${sectionLabel("overview")}
    ${statsGrid}
    ${jobsCard}
    ${recent}
    ${addForm}`;
}

function statCard(icon, label, value, note) {
  return `<div class="stat-card">
    <div class="stat-key"><i data-lucide="${icon}" class="icon"></i>${esc(label)}</div>
    <div class="stat-value mono-nums">${value ?? "—"}</div>
    ${note ? `<div class="stat-note">${esc(note)}</div>` : ""}
  </div>`;
}

// ── View: Memories ─────────────────────────────────────────────────────────

async function loadMemories(page = state.memPage) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(state.pageSize));
  if (state.memTag) params.set("tag", state.memTag);
  if (state.memFilter === "memories") params.set("includePrompts", "false");
  const res = await apiGet(`/api/memories?${params}`);
  state.error = res.success ? null : res.error;
  if (res.success) {
    state.memories = res.data.items || [];
    state.memPage = res.data.page;
    state.memTotalPages = res.data.totalPages;
    state.memTotal = res.data.total;
    state.selected.clear();
  }
}

async function loadTags() {
  const res = await apiGet("/api/tags");
  if (res.success) state.tags = res.data?.project || [];
  return res;
}

async function loadConfig() {
  const res = await apiGet("/api/config");
  if (res.success) {
    state.config = res.data;
    state.configError = null;
  } else {
    state.configError = res.error || "failed to load config";
  }
  return res;
}

function memoryRow(item) {
  const isPrompt = item.type === "prompt";
  const checked = state.selected.has(item.id);
  const tags = Array.isArray(item.tags)
    ? item.tags
    : String(item.tags || "")
        .split(",")
        .filter(Boolean);
  return `
  <div class="row ${checked ? "selected" : ""}" data-id="${esc(item.id)}">
    <input type="checkbox" class="checkbox" data-action="select-item" data-id="${esc(item.id)}" ${checked ? "checked" : ""} aria-label="Select item" />
    <span class="row-marker ${isPrompt ? "prompt" : ""}">${isPrompt ? "[?]" : "[+]"}</span>
    <div class="row-main">
      <div class="row-text clamp">${esc(itemText(item)).slice(0, 400)}</div>
      <div class="row-meta">
        ${itemTypeBadge(item)}
        ${item.isPinned ? `<span class="badge pinned"><i data-lucide="pin" class="icon" style="width:10px;height:10px"></i>pinned</span>` : ""}
        ${tags.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join("")}
        <span>${esc(item.displayName || item.projectName || item.userName || "")}</span>
        <span title="${esc(fmtDate(item.createdAt))}">${relTime(item.createdAt)}</span>
      </div>
    </div>
    <div class="row-actions">
      <button class="btn btn-ghost btn-icon" data-action="view-item" data-id="${esc(item.id)}" aria-label="View detail" title="View"><i data-lucide="eye" class="icon"></i></button>
      ${!isPrompt ? `<button class="btn btn-ghost btn-icon" data-action="pin-item" data-id="${esc(item.id)}" data-pinned="${item.isPinned ? 1 : 0}" aria-label="${item.isPinned ? "Unpin" : "Pin"}" title="${item.isPinned ? "Unpin" : "Pin"}"><i data-lucide="${item.isPinned ? "pin-off" : "pin"}" class="icon"></i></button>` : ""}
      ${!isPrompt ? `<button class="btn btn-ghost btn-icon" data-action="edit-item" data-id="${esc(item.id)}" aria-label="Edit" title="Edit"><i data-lucide="pencil" class="icon"></i></button>` : ""}
      <button class="btn btn-ghost btn-icon" data-action="delete-item" data-id="${esc(item.id)}" data-type="${esc(item.type)}" data-linked="${item.linkedMemoryId ? 1 : 0}" aria-label="Delete" title="Delete"><i data-lucide="trash-2" class="icon"></i></button>
    </div>
  </div>`;
}

function viewMemories() {
  const chips = `
    <div class="chips" role="group" aria-label="Item filter">
      <button class="chip ${state.memFilter === "all" ? "active" : ""}" data-action="mem-filter" data-filter="all">all</button>
      <button class="chip ${state.memFilter === "memories" ? "active" : ""}" data-action="mem-filter" data-filter="memories">memories only</button>
    </div>`;

  const bulk = state.selected.size
    ? `<div class="flex gap-2 mb-3">
        <button class="btn btn-sm btn-danger" data-action="bulk-delete"><i data-lucide="trash-2" class="icon"></i>delete ${state.selected.size} selected</button>
        <button class="btn btn-sm" data-action="select-none"><i data-lucide="x" class="icon"></i>clear</button>
      </div>`
    : "";

  const list = state.loading
    ? skeleton(6)
    : state.error
      ? errorCard(state.error)
      : state.memories.length
        ? `<div class="card"><div class="rows">${state.memories.map(memoryRow).join("")}</div>${pagination(state.memPage, state.memTotalPages, "mem-page")}</div>`
        : `<div class="card">${empty("[ ]", "no memories yet", "Add one below or keep coding — your agent stores as it learns.")}</div>`;

  return `
    ${sectionLabel("browse")}
    <div class="toolbar mb-3">
      ${chips}
      <div class="field"><label for="mem-tag-filter">container</label>
        <select id="mem-tag-filter" class="select" data-action-change="mem-tag">${tagSelectOptions(state.memTag)}</select></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" data-action="open-add-modal"><i data-lucide="plus" class="icon"></i>add memory</button>
    </div>
    ${bulk}
    ${list}
    <div class="text-dim" style="font-size:10.5px">${state.memTotal ? `${state.memTotal} items in this view · page ${state.memPage}/${state.memTotalPages}` : ""}</div>`;
}

// ── View: Search ───────────────────────────────────────────────────────────

async function runSearch(page = 1) {
  const q = state.searchQuery.trim();
  if (!q) return;
  const params = new URLSearchParams({ q, page: String(page), pageSize: String(state.pageSize) });
  if (state.searchTag) params.set("tag", state.searchTag);
  const res = await apiGet(`/api/search?${params}`);
  state.searchRan = true;
  state.error = res.success ? null : res.error;
  if (res.success) {
    state.searchItems = res.data.items || [];
    state.searchPage = res.data.page;
    state.searchTotalPages = res.data.totalPages;
    state.searchTotal = res.data.total;
  }
}

function viewSearch() {
  let results;
  if (state.loading) results = skeleton(6);
  else if (state.error) results = errorCard(state.error);
  else if (!state.searchRan)
    results = `<div class="card">${empty("[?]", "semantic search across memories & prompts", "Natural language works — the embedding model does the matching.")}</div>`;
  else if (!state.searchItems.length)
    results = `<div class="card">${empty("[0]", "no matches", "Try different phrasing or clear the container filter.")}</div>`;
  else
    results = `<div class="card"><div class="rows">${state.searchItems.map((item, i) => searchRow(item, i)).join("")}</div>${pagination(state.searchPage, state.searchTotalPages, "search-page")}</div>`;

  return `
    ${sectionLabel("query")}
    <div class="card"><div class="card-body">
      <form data-form="search">
        <div class="toolbar">
          <div class="field grow"><label for="search-q">query</label>
            <input id="search-q" class="input" name="q" value="${esc(state.searchQuery)}" placeholder="how does the auth flow work?" autocomplete="off" /></div>
          <div class="field"><label for="search-tag">container</label>
            <select id="search-tag" class="select" name="tag">${tagSelectOptions(state.searchTag)}</select></div>
          <div class="field"><label>&nbsp;</label>
            <button class="btn btn-primary" type="submit"><i data-lucide="search" class="icon"></i>search</button></div>
        </div>
      </form>
    </div></div>
    ${sectionLabel(state.searchRan ? `results — ${state.searchTotal} match${state.searchTotal === 1 ? "" : "es"}` : "results")}
    ${results}`;
}

function searchRow(item, i) {
  return `
  <div class="row">
    <span class="row-marker ${item.type === "prompt" ? "prompt" : ""}">${item.type === "prompt" ? "[?]" : "[+]"}</span>
    <div class="row-main">
      <div class="row-text clamp">${esc(itemText(item)).slice(0, 400)}</div>
      <div class="row-meta">
        ${itemTypeBadge(item)}
        ${simMeter(item.similarity)}
        <span>${esc(item.displayName || item.projectName || "")}</span>
        <span>${relTime(item.createdAt)}</span>
      </div>
    </div>
    <div class="row-actions">
      <button class="btn btn-ghost btn-icon" data-action="view-search-item" data-idx="${i}" aria-label="View detail" title="View"><i data-lucide="eye" class="icon"></i></button>
    </div>
  </div>`;
}

// ── View: Timeline ─────────────────────────────────────────────────────────

async function loadTranscripts(page = state.txPage) {
  const q = state.txQuery.trim();
  const params = new URLSearchParams({ page: String(page), limit: String(state.pageSize) });
  const endpoint = q
    ? `/api/transcripts/search?q=${encodeURIComponent(q)}&${params}`
    : `/api/transcripts?${params}&pageSize=${state.pageSize}`;
  const res = await apiGet(endpoint);
  state.error = res.success ? null : res.error;
  if (res.success) {
    state.transcripts = res.data.transcripts || [];
    state.txPage = res.data.page;
    state.txTotalPages = res.data.totalPages;
  }
}

function viewTimeline() {
  const list = state.loading
    ? skeleton(6)
    : state.error
      ? errorCard(state.error)
      : state.transcripts.length
        ? `<div class="card"><div class="rows">${state.transcripts.map((tx, i) => txRow(tx, i)).join("")}</div>${pagination(state.txPage, state.txTotalPages, "tx-page")}</div>`
        : `<div class="card">${empty("[~]", "no transcripts", state.txQuery ? "No session transcript matches that query." : "Transcripts appear once sessions are recorded.")}</div>`;

  return `
    ${sectionLabel("session transcripts")}
    <div class="card"><div class="card-body">
      <form data-form="tx-search">
        <div class="toolbar">
          <div class="field grow"><label for="tx-q">filter transcripts</label>
            <input id="tx-q" class="input" name="q" value="${esc(state.txQuery)}" placeholder="full-text search across transcripts…" autocomplete="off" /></div>
          <div class="field"><label>&nbsp;</label>
            <button class="btn btn-primary" type="submit"><i data-lucide="search" class="icon"></i>search</button></div>
          ${state.txQuery ? `<div class="field"><label>&nbsp;</label><button class="btn" data-action="tx-clear"><i data-lucide="x" class="icon"></i>clear</button></div>` : ""}
        </div>
      </form>
    </div></div>
    ${list}`;
}

function txRow(tx, i) {
  return `
  <div class="row">
    <span class="row-marker muted">[~]</span>
    <div class="row-main">
      <div class="row-title">${esc(tx.projectPath || "unknown project")}</div>
      <div class="row-meta">
        <span>session ${esc(String(tx.sessionId || "").slice(0, 12))}</span>
        <span class="mono-nums">${tx.tokenCount ?? "?"} tokens</span>
        <span>${fmtDate(tx.createdAt)}</span>
      </div>
    </div>
    <div class="row-actions">
      <button class="btn btn-ghost btn-icon" data-action="view-tx" data-idx="${i}" aria-label="View transcript" title="View"><i data-lucide="eye" class="icon"></i></button>
    </div>
  </div>`;
}

// ── View: Profile ──────────────────────────────────────────────────────────

async function loadProfile() {
  const res = await apiGet("/api/user-profile");
  state.error = res.success ? null : res.error;
  state.profile = res.success ? res.data : null;
  if (state.profile?.exists && state.profile.id) {
    const cl = await apiGet(
      `/api/user-profile/changelog?profileId=${encodeURIComponent(state.profile.id)}&limit=20`
    );
    state.changelogs = cl.success ? cl.data || [] : [];
  } else {
    state.changelogs = [];
  }
}

function profileSection(title, items, marker, renderItem) {
  return `${sectionLabel(title)}
    <div class="card"><div class="rows">${
      items?.length
        ? items
            .slice(0, 12)
            .map(
              (it) =>
                `<div class="row"><span class="row-marker">${marker}</span><div class="row-main">${renderItem(it)}</div></div>`
            )
            .join("")
        : empty("[ ]", `no ${title} learned yet`)
    }</div></div>`;
}

function viewProfile() {
  if (state.loading && !state.profile) return skeleton(5);
  const p = state.profile;
  if (state.error) return errorCard(state.error);
  if (!p || p.exists === false) {
    return `<div class="card">${empty("[@]", p?.message || "no profile yet", "Profiles are learned automatically from auto-captured sessions — needs a memory provider and 10+ prompts.")}</div>`;
  }
  const data = p.profileData || {};

  return `
    ${sectionLabel("identity")}
    <div class="card"><div class="card-body">
      <div class="flex items-center gap-3 wrap">
        <strong style="font-size:15px">${esc(p.displayName || p.userName || p.userId || "anonymous")}</strong>
        ${p.userEmail ? `<span class="text-dim">${esc(p.userEmail)}</span>` : ""}
        <span class="spacer"></span>
        <button class="btn btn-sm" data-action="refresh-profile"><i data-lucide="sparkles" class="icon"></i>re-analyze</button>
      </div>
      <dl class="kv mt-3">
        <dt>user id</dt><dd>${esc(p.userId || "default")}</dd>
        <dt>version</dt><dd class="mono-nums">v${esc(p.version ?? "—")}</dd>
        <dt>prompts analyzed</dt><dd class="mono-nums">${p.totalPromptsAnalyzed ?? 0}</dd>
        <dt>last analyzed</dt><dd>${fmtDate(p.lastAnalyzedAt)}</dd>
        <dt>created</dt><dd>${fmtDate(p.createdAt)}</dd>
        ${p.decayApplied ? `<dt>decay</dt><dd class="text-accent">applied this read</dd>` : ""}
      </dl>
    </div></div>
    ${profileSection("preferences", data.preferences, "[+]", (x) => `<div class="row-text">${esc(x.content ?? x.description ?? "")}</div>${x.category ? `<div class="row-meta"><span class="tag-chip">${esc(x.category)}</span></div>` : ""}`)}
    ${profileSection("patterns", data.patterns, "[-]", (x) => `<div class="row-text">${esc(x.description ?? x.content ?? "")}</div>`)}
    ${profileSection("workflows", data.workflows, "[x]", (x) => `<div class="row-title">${esc(x.name ?? "workflow")}</div><div class="row-meta"><span>${(x.steps || []).length ? `${x.steps.length} steps` : ""}</span></div>${(x.steps || []).length ? `<div class="row-text">${x.steps.map((s, i) => `${i + 1}. ${esc(typeof s === "string" ? s : s.description || s.name || "")}`).join("<br>")}</div>` : ""}`)}
    ${sectionLabel("changelog")}
    <div class="card"><div class="rows">${
      state.changelogs.length
        ? state.changelogs.map(changelogRow).join("")
        : empty("[ ]", "no changelog entries")
    }</div></div>`;
}

function changelogRow(c) {
  return `
  <div class="row">
    <span class="row-marker muted">[#]</span>
    <div class="row-main">
      <div class="row-title">v${esc(c.version)} · ${esc(c.changeType || "change")}</div>
      <div class="row-text clamp">${esc(c.changeSummary || "")}</div>
      <div class="row-meta"><span>${fmtDate(c.createdAt)}</span></div>
    </div>
    <div class="row-actions">
      <button class="btn btn-ghost btn-icon" data-action="view-snapshot" data-id="${esc(c.id || c.changelogId || "")}" aria-label="View snapshot" title="Snapshot"><i data-lucide="camera" class="icon"></i></button>
    </div>
  </div>`;
}

// ── View: Conflicts ────────────────────────────────────────────────────────

async function loadConflicts() {
  const resolved = state.conflictView === "resolved" ? "true" : "false";
  const [list, stats] = await Promise.all([
    apiGet(`/api/conflicts?resolved=${resolved}&limit=100`),
    apiGet("/api/conflicts/stats"),
  ]);
  state.error = list.success ? null : list.error;
  state.conflicts = list.success ? list.data || [] : [];
  state.conflictStats = stats.success ? stats.data : null;
  state.conflictBadge = state.conflictStats?.unresolved ?? state.conflicts.length;
}

function viewConflicts() {
  const cs = state.conflictStats;
  const isResolved = state.conflictView === "resolved";
  const header = `
    <div class="stats-grid">
      ${statCard("alert-triangle", "unresolved", cs?.unresolved, "")}
      ${statCard("check", "resolved", cs?.resolved, "")}
    </div>`;
  const chips = `
    <div class="chips" role="group" aria-label="Conflict filter">
      <button class="chip ${!isResolved ? "active" : ""}" data-action="conflict-view" data-filter="unresolved">unresolved</button>
      <button class="chip ${isResolved ? "active" : ""}" data-action="conflict-view" data-filter="resolved">resolved</button>
    </div>`;

  const list = state.loading
    ? skeleton(4)
    : state.error
      ? errorCard(state.error)
      : state.conflicts.length
        ? state.conflicts.map((c) => conflictCard(c, isResolved)).join("")
        : `<div class="card">${
            isResolved
              ? empty("[#]", "no resolved conflicts yet")
              : empty(
                  "[✓]",
                  "no unresolved conflicts",
                  "New writes that contradict existing memories show up here."
                )
          }</div>`;

  return `${sectionLabel("conflicts")}${header}<div class="mt-3">${chips}</div><div class="mt-4 flex" style="flex-direction:column;gap:var(--sp-4)">${list}</div>`;
}

function conflictCard(c, readOnly = false) {
  const pct = Math.round((c.similarityScore ?? 0) * 100);
  const actions = readOnly
    ? ""
    : `<div class="modal-actions" style="padding-top: var(--sp-3)">
        <button class="btn btn-sm" data-action="resolve-conflict" data-id="${esc(c.id)}" data-strategy="keep_newer"><i data-lucide="arrow-up" class="icon"></i>keep newer</button>
        <button class="btn btn-sm" data-action="resolve-conflict" data-id="${esc(c.id)}" data-strategy="keep_both"><i data-lucide="copy" class="icon"></i>keep both</button>
        <button class="btn btn-sm btn-primary" data-action="merge-conflict" data-id="${esc(c.id)}"><i data-lucide="git-merge" class="icon"></i>merge…</button>
      </div>`;
  const resolution = readOnly
    ? `<span class="badge type">${esc(c.resolutionType || "resolved")}</span><span>${relTime(c.resolvedAt)}</span>`
    : "";
  return `
  <div class="card">
    <div class="card-head">
      <span class="row-marker danger">[!]</span>
      <span class="mono-nums">${pct}% similar</span>
      <span class="sub">${relTime(c.detectedAt)}</span>
      ${resolution}
      <span class="spacer"></span>
      <span class="sim"><span class="bar"><span style="width:${pct}%"></span></span></span>
    </div>
    <div class="card-body">
      <div class="compare">
        <div><div class="side-label">memory A · ${esc(String(c.memoryId1 || "").slice(0, 10))}</div><div class="row-text">${esc(c.memory1Content || "—")}</div></div>
        <div><div class="side-label">memory B · ${esc(String(c.memoryId2 || "").slice(0, 10))}</div><div class="row-text">${esc(c.memory2Content || "—")}</div></div>
      </div>
      ${actions}
    </div>
  </div>`;
}

// ── View: Maintenance ──────────────────────────────────────────────────────

async function loadMaintenance() {
  const [cache, mig, tagMig] = await Promise.all([
    apiGet("/api/embedding-cache"),
    apiGet("/api/migration/detect"),
    apiGet("/api/migration/tags/detect"),
  ]);
  state.embeddingCache = cache.success ? cache.data : null;
  state.migration = mig.success ? mig.data : null;
  state.tagMigration = tagMig.success ? tagMig.data : null;
  state.error = cache.success || mig.success ? null : cache.error || mig.error;
}

function viewMaintenance() {
  const c = state.embeddingCache;
  const m = state.migration;
  const tm = state.tagMigration;
  const tp = state.tagMigrationProgress;
  const s = state.status;

  return `
    ${sectionLabel("system")}
    <div class="stats-grid">
      ${statCard("cpu", "embedding mode", s ? s.mode : undefined, s ? (s.warmedUp ? "model warm" : "model cold") : "")}
      ${statCard("zap", "cache hit rate", c ? `${Math.round((c.rate ?? 0) * 100)}%` : undefined, c ? `${c.hits} hits · ${c.misses} misses · ${c.size}/${c.maxSize} entries` : "")}
    </div>

    ${sectionLabel("dimension migration")}
    <div class="card"><div class="card-body">
      <div class="row-text">${
        m
          ? m.needsMigration
            ? `<span class="text-danger">${m.shardMismatches?.length ?? 0} shard(s) don't match the configured model</span> — ${esc(m.configModel || "")} @ ${m.configDimensions ?? "?"} dims`
            : `<span class="text-ok">all shards match ${esc(m.configModel || "the configured model")} (${m.configDimensions ?? "?"} dims)</span>`
          : "…"
      }</div>
      ${
        m?.needsMigration
          ? `
        <div class="toolbar mt-3">
          <div class="field"><label for="mig-strategy">strategy</label>
            <select id="mig-strategy" class="select">
              <option value="re-embed">re-embed (keep content, rebuild vectors)</option>
              <option value="fresh-start">fresh start (delete mismatched shards)</option>
            </select></div>
          <div class="field"><label>&nbsp;</label>
            <button class="btn btn-danger" data-action="run-migration"><i data-lucide="alert-triangle" class="icon"></i>run migration</button></div>
        </div>`
          : ""
      }
    </div></div>

    ${sectionLabel("tag backfill")}
    <div class="card"><div class="card-body">
      <div class="row-text">${
        tm
          ? tm.needsMigration
            ? `<span class="text-accent">${tm.count}</span> memories are missing tags`
            : `<span class="text-ok">nothing to backfill</span>`
          : "…"
      }</div>
      ${
        tp
          ? `<div class="progress mt-3"><span style="width:${tp.total ? Math.round((tp.processed / tp.total) * 100) : 0}%"></span></div>
        <div class="row-meta mt-2"><span class="mono-nums">${tp.processed}/${tp.total}</span></div>`
          : ""
      }
      ${tm?.needsMigration && !state.tagMigrationBusy ? `<div class="modal-actions" style="padding-top:var(--sp-3)"><button class="btn btn-primary" data-action="run-tag-migration"><i data-lucide="wand-sparkles" class="icon"></i>backfill tags</button></div>` : ""}
      ${state.tagMigrationBusy ? `<div class="row-meta mt-3"><span><i data-lucide="loader-circle" class="icon spin"></i> backfilling…</span></div>` : ""}
    </div></div>

    ${sectionLabel("housekeeping")}
    <div class="card"><div class="rows">
      <div class="row">
        <span class="row-marker">[*]</span>
        <div class="row-main"><div class="row-title">cleanup</div><div class="row-text">Remove deprecated and decayed memories.</div></div>
        <div class="row-actions" style="opacity:1"><button class="btn btn-sm" data-action="run-cleanup"><i data-lucide="trash" class="icon"></i>run</button></div>
      </div>
      <div class="row">
        <span class="row-marker">[*]</span>
        <div class="row-main"><div class="row-title">deduplicate</div><div class="row-text">Collapse memories that say the same thing twice.</div></div>
        <div class="row-actions" style="opacity:1"><button class="btn btn-sm" data-action="run-dedup"><i data-lucide="git-branch" class="icon"></i>run</button></div>
      </div>
    </div></div>`;
}

// ── View: Settings ─────────────────────────────────────────────────────────

function viewSettings() {
  const key = localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  const cfg = state.config;
  const llmSection = `
    ${sectionLabel("llm extraction")}
    <div class="card"><div class="card-body" style="max-width:560px">
      ${
        state.configError
          ? errorCard(state.configError)
          : cfg === null
            ? skeleton(5)
            : `
      <form data-form="save-llm-config">
        <div class="field"><label for="llm-provider">memory provider</label>
          <select id="llm-provider" class="select" name="memoryProvider">
            <option value="openai-chat" ${cfg.memoryProvider === "openai-chat" ? "selected" : ""}>openai (chat completions)</option>
            <option value="openai-responses" ${cfg.memoryProvider === "openai-responses" ? "selected" : ""}>openai (responses api)</option>
            <option value="anthropic" ${cfg.memoryProvider === "anthropic" ? "selected" : ""}>anthropic</option>
            <option value="google-gemini" ${cfg.memoryProvider === "google-gemini" ? "selected" : ""}>google gemini</option>
          </select>
          <div class="hint">LLM used to extract memories from chats.</div></div>
        <div class="field"><label for="llm-model">memory model</label>
          <input id="llm-model" class="input" name="memoryModel" value="${esc(cfg.memoryModel ?? "")}" placeholder="gpt-4o-mini / claude-haiku-4-5 / gemini-2.0-flash" autocomplete="off" /></div>
        <div class="field"><label for="llm-url">memory api url</label>
          <input id="llm-url" class="input" name="memoryApiUrl" value="${esc(cfg.memoryApiUrl ?? "")}" placeholder="https://api.openai.com/v1" autocomplete="off" /></div>
        <div class="field"><label for="llm-key">memory api key</label>
          <input id="llm-key" class="input" type="password" name="memoryApiKey" value="" placeholder="${esc(cfg.memoryApiKeyMasked || "not set")}" autocomplete="new-password" />
          <div class="hint">leave empty to keep the current key; type CLEAR (uppercase) to remove it</div></div>
        <div class="field"><label for="llm-temp">temperature</label>
          <input id="llm-temp" class="input" type="number" name="memoryTemperature" step="0.1" min="0" max="2" value="${cfg.memoryTemperature ?? ""}" />
          <div class="hint">empty = server default</div></div>
        <div class="field"><label for="llm-oc-provider">opencode provider</label>
          <input id="llm-oc-provider" class="input" name="opencodeProvider" value="${esc(cfg.opencodeProvider ?? "")}" placeholder="e.g. openai" autocomplete="off" /></div>
        <div class="field"><label for="llm-oc-model">opencode model</label>
          <input id="llm-oc-model" class="input" name="opencodeModel" value="${esc(cfg.opencodeModel ?? "")}" placeholder="e.g. gpt-4o" autocomplete="off" />
          <div class="hint">alternative: use a provider already connected in opencode — overrides the external API above when set</div></div>
        <div class="field"><label for="llm-auto">auto-capture memories from chats</label>
          <input id="llm-auto" class="checkbox" type="checkbox" name="autoCaptureEnabled" ${cfg.autoCaptureEnabled ? "checked" : ""} /></div>
        <div class="modal-actions" style="padding-top:0">
          <button class="btn btn-primary btn-sm" type="submit"><i data-lucide="check" class="icon"></i>save llm settings</button>
        </div>
      </form>
      ${cfg.configFile ? `<div class="hint" style="margin-top:var(--sp-3)">config file: ${esc(cfg.configFile)}</div>` : ""}`
      }
    </div></div>`;

  return `
    ${llmSection}
    ${sectionLabel("connection")}
    <div class="card"><div class="card-body" style="max-width:560px">
      <form data-form="save-key">
        <div class="field"><label for="set-key">API key</label>
          <input id="set-key" class="input" type="password" name="key" value="${esc(key)}" placeholder="webServerApiKey (only needed for remote/locked-down servers)" autocomplete="off" />
          <div class="hint">Sent as an Authorization: Bearer header. Stored in localStorage of this origin only.</div></div>
        <div class="modal-actions" style="padding-top:0">
          ${key ? `<button type="button" class="btn btn-danger btn-sm" data-action="clear-key"><i data-lucide="x" class="icon"></i>clear</button>` : ""}
          <button class="btn btn-primary btn-sm" type="submit"><i data-lucide="check" class="icon"></i>save key</button>
        </div>
      </form>
    </div></div>

    ${sectionLabel("interface")}
    <div class="card"><div class="card-body" style="max-width:560px">
      <form data-form="save-prefs">
        <div class="field"><label for="set-pagesize">rows per page</label>
          <input id="set-pagesize" class="input" type="number" name="pageSize" min="5" max="100" value="${state.pageSize}" /></div>
        <div class="field"><label for="set-theme">theme</label>
          <select id="set-theme" class="select" data-action-change="set-theme">
            <option value="dark" ${currentTheme() === "dark" ? "selected" : ""}>terminal (dark)</option>
            <option value="light" ${currentTheme() === "light" ? "selected" : ""}>paper (light)</option>
          </select></div>
        <div class="modal-actions" style="padding-top:0">
          <button class="btn btn-primary btn-sm" type="submit"><i data-lucide="check" class="icon"></i>save prefs</button>
        </div>
      </form>
    </div></div>

    ${sectionLabel("about")}
    <div class="card"><div class="card-body">
      <dl class="kv">
        <dt>server</dt><dd>${esc(location.origin)}</dd>
        <dt>mode</dt><dd>${esc(state.status?.mode || "—")}</dd>
        <dt>status</dt><dd>${state.status?.ready ? "ready" : "not ready"}</dd>
      </dl>
    </div></div>`;
}

// ── View router ────────────────────────────────────────────────────────────

const VIEW_LOADERS = {
  dashboard: loadDashboard,
  memories: async () => Promise.all([loadTags(), loadMemories()]),
  search: loadTags,
  timeline: () => loadTranscripts(1),
  profile: loadProfile,
  conflicts: loadConflicts,
  maintenance: loadMaintenance,
  settings: async () => Promise.all([loadConfig()]),
};

function renderView() {
  switch (state.view) {
    case "memories":
      return viewMemories();
    case "search":
      return viewSearch();
    case "timeline":
      return viewTimeline();
    case "profile":
      return viewProfile();
    case "conflicts":
      return viewConflicts();
    case "maintenance":
      return viewMaintenance();
    case "settings":
      return viewSettings();
    default:
      return viewDashboard();
  }
}

async function loadView(view) {
  state.loading = true;
  state.error = null;
  render();
  try {
    await VIEW_LOADERS[view]();
  } catch (err) {
    state.error = String(err);
  }
  state.loading = false;
  render();
}

function navigate() {
  const view = location.hash.replace(/^#\//, "") || "dashboard";
  state.view = NAV.some((n) => n.id === view) ? view : "dashboard";
  $("#sidebar")?.classList.remove("open");
  if (state.view === "search" && state.tags.length) {
    // Tag list already warm — skip refetch.
    state.loading = false;
    render();
    return;
  }
  loadView(state.view);
}

// ── Item modals & mutations ────────────────────────────────────────────────

function openAddModal() {
  openModal({
    title: "add memory",
    body: `
      <form data-form="add-memory" id="add-form">
        <div class="field"><label for="am-content">content</label>
          <textarea id="am-content" class="textarea" name="content" required autofocus placeholder="something worth remembering…"></textarea></div>
        <div class="field"><label for="am-tag">project tag</label>
          <input id="am-tag" class="input" name="containerTag" required list="container-tags" placeholder="project or user tag" /></div>
        <div class="toolbar">
          <div class="field"><label for="am-type">type</label>
            <input id="am-type" class="input" name="type" list="type-suggestions" placeholder="fact" /></div>
          <div class="field"><label for="am-tags">tags (csv)</label>
            <input id="am-tags" class="input" name="tags" placeholder="api, auth" /></div>
        </div>
      </form>`,
    actions: [
      { label: "cancel" },
      {
        label: "add",
        kind: "btn-primary",
        icon: "plus",
        keepOpen: true,
        onClick: () => $("#add-form")?.requestSubmit(),
      },
    ],
  });
}

async function submitAddMemory(form) {
  const fd = new FormData(form);
  const body = {
    content: String(fd.get("content") || "").trim(),
    containerTag: String(fd.get("containerTag") || "").trim(),
    type: String(fd.get("type") || "").trim() || undefined,
    tags: String(fd.get("tags") || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
  if (!body.content || !body.containerTag) {
    toast("content and project tag are required", "error");
    return false;
  }
  const res = await apiPost("/api/memories", body);
  if (!res.success) {
    toast(res.error || "add failed", "error");
    return false;
  }
  toast(res.data?.duplicate ? "already known — duplicate skipped" : "memory stored");
  return true;
}

async function openEditModal(id) {
  const res = await apiGet(`/api/memories/${encodeURIComponent(id)}`);
  if (!res.success) {
    toast(res.error || "not found", "error");
    return;
  }
  const m = res.data;
  const tags = Array.isArray(m.tags) ? m.tags.join(", ") : m.tags || "";
  openModal({
    title: "edit memory",
    wide: true,
    body: `
      <form data-form="edit-memory" id="edit-form" data-id="${esc(id)}">
        <div class="field"><label for="em-content">content</label>
          <textarea id="em-content" class="textarea" name="content" style="min-height:140px">${esc(itemText(m))}</textarea></div>
        <div class="toolbar">
          <div class="field"><label for="em-type">type</label>
            <input id="em-type" class="input" name="type" value="${esc(m.memoryType || "")}" /></div>
          <div class="field grow"><label for="em-tags">tags (csv)</label>
            <input id="em-tags" class="input" name="tags" value="${esc(tags)}" /></div>
        </div>
        <div class="hint">Editing re-embeds this memory.</div>
      </form>`,
    actions: [
      { label: "cancel" },
      {
        label: "save",
        kind: "btn-primary",
        icon: "check",
        keepOpen: true,
        onClick: () => $("#edit-form")?.requestSubmit(),
      },
    ],
  });
}

async function submitEditMemory(form) {
  const id = form.dataset.id;
  const fd = new FormData(form);
  const body = {
    content: String(fd.get("content") || "").trim() || undefined,
    type: String(fd.get("type") || "").trim() || undefined,
    tags: String(fd.get("tags") || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
  const res = await apiPut(`/api/memories/${encodeURIComponent(id)}`, body);
  if (!res.success) {
    toast(res.error || "save failed", "error");
    return false;
  }
  toast("memory updated");
  return true;
}

function openItemModal(item) {
  const isPrompt = item.type === "prompt";
  const kv = [
    ["id", item.id],
    ["container", item.containerTag],
    isPrompt ? ["session", item.sessionId] : null,
    item.memoryType ? ["type", item.memoryType] : null,
    item.projectPath ? ["project", item.projectPath] : null,
    item.userName ? ["user", item.userName] : null,
    ["created", fmtDate(item.createdAt)],
    item.updatedAt ? ["updated", fmtDate(item.updatedAt)] : null,
  ].filter(Boolean);
  openModal({
    title: isPrompt ? "prompt detail" : "memory detail",
    wide: true,
    body: `
      <div class="md mb-3">${renderMarkdown(itemText(item))}</div>
      <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v ?? "—")}</dd>`).join("")}</dl>`,
  });
}

function openTranscriptModal(tx) {
  openModal({
    title: `transcript — ${tx.projectPath || "session"}`,
    wide: true,
    body: `
      <div class="row-meta mb-3">
        <span>session ${esc(String(tx.sessionId || "").slice(0, 16))}</span>
        <span class="mono-nums">${tx.tokenCount ?? "?"} tokens</span>
        <span>${fmtDate(tx.createdAt)}</span>
      </div>
      <pre class="md" style="max-height:50vh;overflow:auto;border:var(--border-w) solid var(--border);border-radius:var(--radius);padding:var(--sp-3)">${esc(prettyJson(tx.messages))}</pre>`,
  });
}

async function openSnapshotModal(changelogId) {
  if (!changelogId) {
    toast("no snapshot id on this entry", "error");
    return;
  }
  const res = await apiGet(
    `/api/user-profile/snapshot?changelogId=${encodeURIComponent(changelogId)}`
  );
  if (!res.success) {
    toast(res.error || "snapshot failed", "error");
    return;
  }
  openModal({
    title: "profile snapshot",
    wide: true,
    body: `<pre class="md" style="max-height:50vh;overflow:auto;border:var(--border-w) solid var(--border);border-radius:var(--radius);padding:var(--sp-3)">${esc(JSON.stringify(res.data, null, 2))}</pre>`,
  });
}

function openMergeModal(c) {
  openModal({
    title: "merge conflict",
    wide: true,
    danger: true,
    body: `
      <p class="row-text mb-3">Edit the merged memory below — it replaces the conflicting pair.</p>
      <form data-form="merge-conflict" id="merge-form" data-id="${esc(c.id)}">
        <div class="field"><label for="mc-content">merged content</label>
          <textarea id="mc-content" class="textarea" name="mergedContent" style="min-height:160px">${esc(`${c.memory1Content || ""}\n\n${c.memory2Content || ""}`.trim())}</textarea></div>
      </form>`,
    actions: [
      { label: "cancel" },
      {
        label: "merge",
        kind: "btn-primary",
        icon: "git-merge",
        keepOpen: true,
        onClick: () => $("#merge-form")?.requestSubmit(),
      },
    ],
  });
}

// ── Actions ────────────────────────────────────────────────────────────────

async function withBusy(fn, okMsg) {
  const res = await fn();
  if (!res || res.success === false) {
    toast(res?.error || "request failed", "error");
    return false;
  }
  if (okMsg) toast(okMsg);
  return true;
}

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}

const ACTIONS = {
  "theme-toggle": () => {
    setTheme(currentTheme() === "dark" ? "light" : "dark");
    render();
  },
  "toggle-sidebar": () => $("#sidebar")?.classList.toggle("open"),
  "reload-view": () => loadView(state.view),

  "mem-filter": (el) => {
    state.memFilter = el.dataset.filter;
    loadView("memories");
  },

  "conflict-view": (el) => {
    state.conflictView = el.dataset.filter === "resolved" ? "resolved" : "unresolved";
    loadView("conflicts");
  },
  "mem-page": async (el) => {
    const next = state.memPage + Number(el.dataset.delta);
    if (next < 1 || next > state.memTotalPages) return;
    state.loading = true;
    render();
    await loadMemories(next);
    state.loading = false;
    render();
  },
  "open-add-modal": openAddModal,
  "select-all": () => {
    state.memories.forEach((m) => state.selected.add(m.id));
    render();
  },
  "select-none": () => {
    state.selected.clear();
    render();
  },

  "view-item": (el) => {
    const item = state.memories.find((m) => m.id === el.dataset.id);
    if (item) openItemModal(item);
  },
  "view-search-item": (el) => {
    const item = state.searchItems[Number(el.dataset.idx)];
    if (item) openItemModal(item);
  },
  "view-tx": (el) => {
    const tx = state.transcripts[Number(el.dataset.idx)];
    if (tx) openTranscriptModal(tx);
  },
  "view-snapshot": (el) => openSnapshotModal(el.dataset.id),

  "edit-item": (el) => openEditModal(el.dataset.id),

  "pin-item": async (el) => {
    const pinned = el.dataset.pinned === "1";
    const ok = await withBusy(
      () =>
        apiPost(`/api/memories/${encodeURIComponent(el.dataset.id)}/${pinned ? "unpin" : "pin"}`),
      pinned ? "unpinned" : "pinned"
    );
    if (ok) {
      const item = state.memories.find((m) => m.id === el.dataset.id);
      if (item) item.isPinned = pinned ? 0 : 1;
      render();
    }
  },

  "delete-item": async (el) => {
    const isPrompt = el.dataset.type === "prompt";
    const linked = el.dataset.linked === "1";
    const msg =
      isPrompt && linked
        ? "This prompt created a memory. Cascade deletes the linked memory too — delete both?"
        : `Delete this ${isPrompt ? "prompt" : "memory"}?`;
    if (!(await confirmModal(`delete ${isPrompt ? "prompt" : "memory"}`, msg))) return;
    const url = isPrompt
      ? `/api/prompts/${encodeURIComponent(el.dataset.id)}${linked ? "?cascade=true" : ""}`
      : `/api/memories/${encodeURIComponent(el.dataset.id)}`;
    if (await withBusy(() => apiDel(url), "deleted")) {
      state.selected.delete(el.dataset.id);
      state.memories = state.memories.filter((m) => m.id !== el.dataset.id);
      render();
    }
  },

  "bulk-delete": async () => {
    const ids = [...state.selected];
    if (!ids.length) return;
    if (
      !(await confirmModal(
        "bulk delete",
        `Delete ${ids.length} selected item${ids.length === 1 ? "" : "s"}? This cannot be undone.`
      ))
    )
      return;
    const promptIds = ids.filter(
      (id) => state.memories.find((m) => m.id === id)?.type === "prompt"
    );
    const memoryIds = ids.filter((id) => !promptIds.includes(id));
    let ok = true;
    if (memoryIds.length)
      ok =
        (await withBusy(
          () => apiPost("/api/memories/bulk-delete", { ids: memoryIds }),
          `deleted ${memoryIds.length} memories`
        )) && ok;
    if (promptIds.length)
      ok =
        (await withBusy(
          () => apiPost("/api/prompts/bulk-delete", { ids: promptIds }),
          `deleted ${promptIds.length} prompts`
        )) && ok;
    if (ok) await loadView("memories");
  },

  "search-page": async () => {
    state.loading = true;
    render();
    await runSearch(
      state.searchPage + Number(event?.target?.closest("button")?.dataset.delta || 1)
    );
    state.loading = false;
    render();
  },

  "tx-page": async (el) => {
    state.loading = true;
    render();
    await loadTranscripts(state.txPage + Number(el.dataset.delta));
    state.loading = false;
    render();
  },
  "tx-clear": () => {
    state.txQuery = "";
    loadView("timeline");
  },

  "refresh-profile": async () => {
    if (
      await withBusy(() => apiPost("/api/user-profile/refresh", {}), "profile re-analysis started")
    )
      await loadView("profile");
  },

  "resolve-conflict": async (el) => {
    const strategy = el.dataset.strategy;
    const label =
      strategy === "keep_newer"
        ? "Keep the newer memory and deprecate the older one?"
        : "Keep both memories and clear the conflict?";
    if (
      !(await confirmModal("resolve conflict", esc(label), {
        danger: false,
        confirmLabel: el.textContent.trim(),
      }))
    )
      return;
    if (
      await withBusy(
        () => apiPost(`/api/conflicts/${encodeURIComponent(el.dataset.id)}`, { strategy }),
        "conflict resolved"
      )
    )
      await loadView("conflicts");
  },
  "merge-conflict": (el) => {
    const c = state.conflicts.find((x) => x.id === el.dataset.id);
    if (c) openMergeModal(c);
  },

  "run-cleanup": async () => {
    const res = await apiPost("/api/cleanup");
    if (res.success) showResultModal("cleanup", res.data);
    else toast(res.error || "cleanup failed", "error");
  },
  "run-dedup": async () => {
    const res = await apiPost("/api/deduplicate");
    if (res.success) showResultModal("deduplication", res.data);
    else toast(res.error || "dedup failed", "error");
  },
  "run-migration": async () => {
    const strategy = $("#mig-strategy")?.value || "re-embed";
    const warn =
      strategy === "fresh-start"
        ? "FRESH START deletes mismatched shards. Memories in them are gone for good. Continue?"
        : "Re-embed all mismatched shards with the configured model? This can take a while.";
    if (!(await confirmModal("run migration", esc(warn)))) return;
    const res = await apiPost("/api/migration/run", { strategy });
    if (res.success) {
      showResultModal("migration", res.data);
      await loadView("maintenance");
    } else toast(res.error || "migration failed", "error");
  },
  "run-tag-migration": async () => {
    state.tagMigrationBusy = true;
    state.tagMigrationProgress = null;
    render();
    let guard = 0;
    let res;
    do {
      res = await apiPost("/api/migration/tags/run-batch", { batchSize: 100 });
      if (!res.success) break;
      state.tagMigrationProgress = res.data;
      render();
    } while (res.data?.hasMore && ++guard < 200);
    state.tagMigrationBusy = false;
    if (res?.success && !res.data?.hasMore) toast("tag backfill complete");
    else if (!res?.success) toast(res?.error || "backfill failed", "error");
    await loadView("maintenance");
  },

  "clear-key": async () => {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    toast("API key cleared");
    await loadView("settings");
  },
};

function showResultModal(title, data) {
  openModal({
    title: `${title} — result`,
    body: `<pre class="md" style="max-height:40vh;overflow:auto;border:var(--border-w) solid var(--border);border-radius:var(--radius);padding:var(--sp-3)">${esc(JSON.stringify(data ?? {}, null, 2))}</pre>`,
    actions: [{ label: "done", kind: "btn-primary" }],
  });
}

// ── Global listeners ───────────────────────────────────────────────────────

document.addEventListener("click", (e) => {
  const navLink = e.target.closest("[data-nav]");
  if (navLink) $("#sidebar")?.classList.remove("open");

  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  ACTIONS[el.dataset.action]?.(el, e);
});

document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-action-change]");
  if (!el) return;
  const action = el.dataset.actionChange;
  if (action === "mem-tag") {
    state.memTag = el.value;
    loadView("memories");
  }
  if (action === "set-theme") {
    setTheme(el.value);
    render();
  }
});

document.addEventListener("change", (e) => {
  const cb = e.target.closest('[data-action="select-item"]');
  if (!cb) return;
  if (cb.checked) state.selected.add(cb.dataset.id);
  else state.selected.delete(cb.dataset.id);
  render();
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;

  if (kind === "add-memory") {
    if (await submitAddMemory(form)) {
      closeModal();
      await loadView(state.view);
    }
  } else if (kind === "edit-memory") {
    if (await submitEditMemory(form)) {
      closeModal();
      await loadView("memories");
    }
  } else if (kind === "merge-conflict") {
    const fd = new FormData(form);
    const mergedContent = String(fd.get("mergedContent") || "").trim();
    if (!mergedContent) {
      toast("merged content is empty", "error");
      return;
    }
    const res = await apiPost(`/api/conflicts/${encodeURIComponent(form.dataset.id)}`, {
      strategy: "merge",
      mergedContent,
    });
    if (!res.success) {
      toast(res.error || "merge failed", "error");
      return;
    }
    toast("conflict merged");
    closeModal();
    await loadView("conflicts");
  } else if (kind === "search") {
    const fd = new FormData(form);
    state.searchQuery = String(fd.get("q") || "");
    state.searchTag = String(fd.get("tag") || "");
    state.loading = true;
    render();
    await runSearch(1);
    state.loading = false;
    render();
  } else if (kind === "tx-search") {
    state.txQuery = String(new FormData(form).get("q") || "");
    loadView("timeline");
  } else if (kind === "save-llm-config") {
    const fd = new FormData(form);
    const body = {};
    const provider = String(fd.get("memoryProvider") || "");
    if (provider) body.memoryProvider = provider;
    const model = String(fd.get("memoryModel") || "").trim();
    if (model) body.memoryModel = model;
    const url = String(fd.get("memoryApiUrl") || "").trim();
    if (url) body.memoryApiUrl = url;
    const key = String(fd.get("memoryApiKey") || "");
    if (key === "CLEAR") body.memoryApiKey = "";
    else if (key) body.memoryApiKey = key;
    const temp = String(fd.get("memoryTemperature") || "").trim();
    if (temp !== "") {
      const t = Number(temp);
      if (!Number.isNaN(t)) body.memoryTemperature = t;
    }
    const ocProvider = String(fd.get("opencodeProvider") || "").trim();
    if (ocProvider) body.opencodeProvider = ocProvider;
    const ocModel = String(fd.get("opencodeModel") || "").trim();
    if (ocModel) body.opencodeModel = ocModel;
    body.autoCaptureEnabled = fd.get("autoCaptureEnabled") === "on";
    const res = await apiPut("/api/config", body);
    if (!res.success) {
      toast(res.error || "failed to save llm settings", "error");
      return;
    }
    toast("llm settings saved (applied instantly)");
    await loadConfig();
    render();
  } else if (kind === "save-key") {
    const key = String(new FormData(form).get("key") || "").trim();
    if (key) localStorage.setItem(API_KEY_STORAGE_KEY, key);
    else localStorage.removeItem(API_KEY_STORAGE_KEY);
    toast(key ? "API key saved" : "API key cleared");
    render();
  } else if (kind === "save-prefs") {
    const size = Math.min(100, Math.max(5, Number(new FormData(form).get("pageSize")) || 20));
    state.pageSize = size;
    localStorage.setItem(PAGE_SIZE_KEY, String(size));
    toast("preferences saved");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("#modal-root")?.firstElementChild) closeModal();
    else $("#sidebar")?.classList.remove("open");
  }
});

window.addEventListener("hashchange", navigate);

// ── Boot ───────────────────────────────────────────────────────────────────

(async function init() {
  render();
  navigate(); // resolves hash → view, loads data
  apiGet("/api/status").then((res) => {
    if (res.success) {
      state.status = res.data;
      render();
    }
  });
  apiGet("/api/conflicts/stats").then((res) => {
    if (res.success) {
      state.conflictBadge = res.data?.unresolved ?? 0;
      render();
    }
  });
})();
