/* global lucide, getLanguage, setLanguage, t, jsonrepair, DOMPurify, marked */

const API_BASE = "";
const API_KEY_STORAGE_KEY = "opencodeMemApiKey";
const STORAGE_KEY_THEME = "mem0-theme";
const STORAGE_KEY_LANG = "opencodeMem0-lang";

const VIEWS = {
  DASHBOARD: "dashboard",
  MEMORIES: "memories",
  SEARCH: "search",
  TIMELINE: "timeline",
  PROFILE: "profile",
  SETTINGS: "settings",
  MAINTENANCE: "maintenance",
  CONFLICTS: "conflicts",
};

const state = {
  view: VIEWS.DASHBOARD,
  theme: "light",
  language: "en",
  tags: { project: [] },
  memories: [],
  totalMemories: 0,
  currentPage: 1,
  pageSize: 20,
  totalPages: 1,
  selectedTag: "",
  searchQuery: "",
  searchResults: [],
  searchCurrentPage: 1,
  searchTotalPages: 1,
  stats: null,
  userProfile: null,
  conflicts: [],
  conflictStats: null,
  selectedMemories: new Set(),
  loading: false,
  migration: { detected: 0, tagMigration: 0 },
  transcripts: [],
  transcriptTotalPages: 1,
  transcriptCurrentPage: 1,
  changelogs: [],
};

// ============================================================================
// Theme & i18n
// ============================================================================

function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY_THEME);
  const html = document.documentElement;
  if (saved) {
    state.theme = saved;
    html.setAttribute("data-theme", saved);
  } else {
    state.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
}

function toggleTheme() {
  const html = document.documentElement;
  const isDark =
    html.getAttribute("data-theme") === "dark" ||
    (!html.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const next = isDark ? "light" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem(STORAGE_KEY_THEME, next);
  state.theme = next;
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const icon = btn.querySelector("i");
  if (icon) {
    icon.setAttribute("data-lucide", state.theme === "dark" ? "moon" : "sun");
  }
  createIcons();
}

function toggleLanguage() {
  const next = getLanguage() === "en" ? "zh" : "en";
  setLanguage(next);
  state.language = next;
  renderApp();
  loadView(state.view);
}

function initLanguage() {
  state.language = getLanguage();
}

// ============================================================================
// Markdown & icons
// ============================================================================

if (typeof marked !== "undefined" && marked.setOptions) {
  marked.setOptions({ gfm: true, breaks: true });
}

function renderMarkdown(md) {
  if (!md || typeof md !== "string") return "";
  if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
    return escapeHtml(md);
  }
  return DOMPurify.sanitize(marked.parse(md));
}

function createIcons() {
  if (typeof lucide !== "undefined" && lucide.createIcons) {
    lucide.createIcons();
  }
}

function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(state.language, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================================
// API
// ============================================================================

function buildApiHeaders(options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("content-type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const apiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (apiKey && !headers.has("authorization") && !headers.has("x-opencode-mem-key")) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

function requestApiKey() {
  const key = window.prompt(t("prompt-api-key"));
  if (key) {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  }
  return key;
}

async function fetchAPI(endpoint, options = {}) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    const requestOptions = {
      ...options,
      headers: buildApiHeaders(options),
      signal: controller.signal,
    };

    let response = await fetch(API_BASE + endpoint, requestOptions);
    if (response.status === 401 && requestApiKey()) {
      response = await fetch(API_BASE + endpoint, {
        ...requestOptions,
        headers: buildApiHeaders(options),
      });
    }

    clearTimeout(timeoutId);
    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return await response.json();
  } catch (error) {
    console.error("API Error:", error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Notifications
// ============================================================================

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function showError(message) {
  showToast(message, "error");
}

// ============================================================================
// Modal
// ============================================================================

function openModal(title, bodyHtml, actionsHtml = "") {
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml + actionsHtml;
  modal.classList.remove("hidden");
  createIcons();
  const firstInput = modal.querySelector("input, textarea, select, button");
  if (firstInput) firstInput.focus();
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
  document.getElementById("modal-body").innerHTML = "";
}

// ============================================================================
// Components
// ============================================================================

function wordmark() {
  return `
    <a href="#" class="wordmark" data-view="dashboard" aria-label="OpenCode Memory Dashboard">
      ▗▄▄▖ ▗▄▄▖ ▗▄▄▄ ▗▄▄▖  ▗▄▄▖▗▄▄▄▖ ▗▄▄▖
      ▐▌ ▐▌▐▌ ▐▌▐▌  █▐▌ ▐▌▐▌   ▐▌  ▐▌
      ▐▌ ▐▌▐▛▀▚▖▐▌  █▐▛▀▚▖▐▌   ▐▛▀▀▘ ▝▀▚▖
      ▝▚▄▞▘▐▌ ▐▌▐▙▄▄▀▐▌ ▐▌▝▚▄▄▖▐▙▄▄▖▗▄▄▞▘
    </a>
  `;
}

function navLinks() {
  const items = [
    [VIEWS.DASHBOARD, t("nav-dashboard")],
    [VIEWS.MEMORIES, t("nav-memories")],
    [VIEWS.SEARCH, t("nav-search")],
    [VIEWS.TIMELINE, t("nav-timeline")],
    [VIEWS.PROFILE, t("nav-profile")],
    [VIEWS.MAINTENANCE, t("nav-maintenance")],
    [VIEWS.CONFLICTS, t("nav-conflicts")],
    [VIEWS.SETTINGS, t("nav-settings")],
  ];
  return items
    .map(
      ([view, label]) => `
        <button class="nav-link ${state.view === view ? "active" : ""}" data-view="${view}">
          ${escapeHtml(label)}
        </button>
      `
    )
    .join("");
}

function tagOptions(selected = "") {
  const tags = state.tags.project || [];
  return tags
    .map(
      (tagInfo) => `
        <option value="${escapeHtml(tagInfo.tag)}" ${selected === tagInfo.tag ? "selected" : ""}>
          ${escapeHtml(tagInfo.displayName || tagInfo.tag)}
        </option>
      `
    )
    .join("");
}

function badge(text, variant = "default") {
  const color =
    {
      pinned: "var(--warning)",
      linked: "var(--accent)",
      conflict: "var(--danger)",
      success: "var(--success)",
    }[variant] || "var(--mute)";
  return `<span class="tag-badge" style="color:${color};border:1px solid ${color}">${escapeHtml(text)}</span>`;
}

function memoryCard(memory) {
  const isPinned = memory.isPinned || memory.pinned;
  const isSelected = state.selectedMemories.has(memory.id);
  const tags = (memory.tags || [])
    .map((tag) => `<span class="tag-badge">${escapeHtml(tag)}</span>`)
    .join("");
  const badges = [];
  if (isPinned) badges.push(badge("PINNED", "pinned"));
  if (memory.linkedMemoryId) badges.push(badge("LINKED", "linked"));
  if (memory.hasConflict) badges.push(badge("CONFLICT", "conflict"));

  return `
    <article class="memory-card ${isPinned ? "pinned" : ""} ${isSelected ? "selected" : ""}" data-id="${escapeHtml(memory.id)}">
      <div class="memory-header">
        <label class="memory-title flex gap-sm" style="cursor:pointer;">
          <input type="checkbox" class="memory-checkbox" data-id="${escapeHtml(memory.id)}" ${isSelected ? "checked" : ""}>
          <span>${escapeHtml(memory.displayName || String(memory.id || "").slice(0, 8))}</span>
        </label>
        <div class="memory-meta">
          ${badges.join("")}
          <span>${escapeHtml(formatDate(memory.createdAt || memory.updatedAt))}</span>
        </div>
      </div>
      <div class="memory-content markdown-content">${renderMarkdown(memory.content)}</div>
      <div class="tag-list">${tags}</div>
      <div class="memory-actions">
        <button class="btn btn-sm btn-secondary" data-action="edit" data-id="${escapeHtml(memory.id)}">
          <i data-lucide="pencil" class="icon-sm"></i> ${t("btn-edit")}
        </button>
        <button class="btn btn-sm btn-secondary" data-action="pin" data-id="${escapeHtml(memory.id)}" data-pinned="${isPinned}">
          <i data-lucide="${isPinned ? "pin-off" : "pin"}" class="icon-sm"></i> ${isPinned ? t("btn-unpin") : t("btn-pin")}
        </button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${escapeHtml(memory.id)}">
          <i data-lucide="trash-2" class="icon-sm"></i> ${t("btn-delete")}
        </button>
      </div>
    </article>
  `;
}

function pagination(currentPage, totalPages, handlerName) {
  if (totalPages <= 1) return "";
  return `
    <div class="pagination" role="group" aria-label="Pagination">
      <button class="btn btn-sm btn-secondary" data-action="${handlerName}" data-delta="-1" ${currentPage <= 1 ? "disabled" : ""}>
        <i data-lucide="chevron-left" class="icon-sm"></i>
      </button>
      <span>${t("pagination-page", { page: currentPage, total: totalPages })}</span>
      <button class="btn btn-sm btn-secondary" data-action="${handlerName}" data-delta="1" ${currentPage >= totalPages ? "disabled" : ""}>
        <i data-lucide="chevron-right" class="icon-sm"></i>
      </button>
    </div>
  `;
}

function sectionLabel(title) {
  return `<h2 class="section-label">${escapeHtml(title)}</h2><hr class="section-rule">`;
}

function listRow(marker, label, description) {
  return `
    <div class="list-row">
      <span class="list-marker">${escapeHtml(marker)}</span>
      <div>
        <span class="text-strong">${escapeHtml(label)}</span>
        ${description ? `<span class="text-body"> ${escapeHtml(description)}</span>` : ""}
      </div>
    </div>
  `;
}

// ============================================================================
// App shell
// ============================================================================

function renderApp() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <nav class="primary-nav" role="navigation" aria-label="Primary">
      <div class="container">
        ${wordmark()}
        <div class="nav-links" id="nav-links">
          ${navLinks()}
        </div>
        <div class="nav-actions">
          <button id="theme-toggle" class="btn btn-icon btn-secondary" aria-label="${t("aria-theme-toggle")}">
            <i data-lucide="${state.theme === "dark" ? "moon" : "sun"}" class="icon-sm"></i>
          </button>
          <button id="lang-toggle" class="btn btn-sm btn-secondary" aria-label="${t("aria-lang-toggle")}">
            ${state.language.toUpperCase()}
          </button>
          <button id="nav-menu" class="nav-menu-btn" aria-label="${t("aria-menu-toggle")}" aria-expanded="false">
            <i data-lucide="menu" class="icon-sm"></i>
          </button>
        </div>
      </div>
    </nav>
    <main id="main" class="container" style="flex:1;padding:var(--sp-lg) 0 var(--sp-section);">
      ${renderCurrentView()}
    </main>
    <footer class="app-footer" role="contentinfo">
      <div class="container">
        <div class="footer-links">
          <a class="footer-link" href="https://github.com/ZeR020/opencode-mem0" target="_blank" rel="noopener">GitHub</a>
          <a class="footer-link" href="https://github.com/ZeR020/opencode-mem0#readme" target="_blank" rel="noopener">Docs</a>
          <a class="footer-link" href="https://github.com/ZeR020/opencode-mem0/blob/main/docs/CHANGELOG.md" target="_blank" rel="noopener">Changelog</a>
          <a class="footer-link" href="https://github.com/ZeR020/opencode-mem0/issues" target="_blank" rel="noopener">Issues</a>
          <a class="footer-link" href="https://github.com/ZeR020/opencode-mem0/blob/main/LICENSE" target="_blank" rel="noopener">License</a>
        </div>
        <div class="footer-bottom">
          <span>©2026 ZeR020 · OpenCode Memory Dashboard</span>
        </div>
      </div>
    </footer>
  `;
  bindShellEvents();
  createIcons();
}

function bindShellEvents() {
  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
  document.getElementById("lang-toggle")?.addEventListener("click", toggleLanguage);
  document.getElementById("modal-close")?.addEventListener("click", closeModal);
  document.getElementById("nav-menu")?.addEventListener("click", toggleMobileNav);
  document.querySelectorAll(".nav-link, .wordmark").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const view = el.dataset.view;
      if (view) switchView(view);
    });
  });
}

function toggleMobileNav() {
  const nav = document.getElementById("nav-links");
  const btn = document.getElementById("nav-menu");
  const isOpen = nav.classList.toggle("open");
  btn.setAttribute("aria-expanded", String(isOpen));
}

function switchView(view) {
  state.view = view;
  state.currentPage = 1;
  state.searchCurrentPage = 1;
  state.transcriptCurrentPage = 1;
  state.selectedMemories.clear();
  renderApp();
  loadView(view);
}

function renderCurrentView() {
  if (state.loading) {
    return `<div class="loading-state" role="status"><p>${t("loading")}</p></div>`;
  }
  switch (state.view) {
    case VIEWS.DASHBOARD:
      return renderDashboard();
    case VIEWS.MEMORIES:
      return renderMemories();
    case VIEWS.SEARCH:
      return renderSearch();
    case VIEWS.TIMELINE:
      return renderTimeline();
    case VIEWS.PROFILE:
      return renderProfile();
    case VIEWS.SETTINGS:
      return renderSettings();
    case VIEWS.MAINTENANCE:
      return renderMaintenance();
    case VIEWS.CONFLICTS:
      return renderConflicts();
    default:
      return renderDashboard();
  }
}

// ============================================================================
// Views
// ============================================================================

function renderDashboard() {
  const stats = state.stats || {};
  const recent = state.memories.slice(0, 5);
  const profile = state.userProfile || {};
  const preferences = (profile.preferences || []).slice(0, 3);

  return `
    <section class="hero-tui" aria-label="OpenCode Terminal">
      <div class="container">
        <div class="tui-wordmark" role="img" aria-label="OpenCode">
          ▗▄▄▖ ▗▄▄▖ ▗▄▄▄ ▗▄▄▖  ▗▄▄▖▗▄▄▄▖ ▗▄▄▖
          ▐▌ ▐▌▐▌ ▐▌▐▌  █▐▌ ▐▌▐▌   ▐▌  ▐▌
          ▐▌ ▐▌▐▛▀▚▖▐▌  █▐▛▀▚▖▐▌   ▐▛▀▀▘ ▝▀▚▖
          ▝▚▄▞▘▐▌ ▐▌▐▙▄▄▀▐▌ ▐▌▝▚▄▄▖▐▙▄▄▖▗▄▄▞▘
        </div>
        <div class="tui-prompt-row" role="img" aria-label="TUI prompt">
          <span>|</span>
          <span style="color:var(--accent)">Build</span>
          <span>Claude Opus 4.5</span>
          <span style="color:var(--on-dark-mute)">OpenCode Memory</span>
        </div>
        <div class="tui-hints">
          <span>tab switch agent</span>
          <span>ctrl-p commands</span>
          <span>esc close</span>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="dash-stats">
      <div class="container">
        ${sectionLabel(t("dash-stats"))}
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${stats.totalMemories ?? "—"}</div>
            <div class="stat-label">${t("stat-total-memories")}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.totalPrompts ?? "—"}</div>
            <div class="stat-label">${t("stat-total-prompts")}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(stats.totalTags ?? 0) + (stats.totalPromptTags ?? 0)}</div>
            <div class="stat-label">${t("stat-total-tags")}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.totalTranscripts ?? "—"}</div>
            <div class="stat-label">${t("stat-total-transcripts")}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="dash-recent">
      <div class="container">
        ${sectionLabel(t("dash-recent"))}
        <div class="memory-list">
          ${recent.length ? recent.map(memoryCard).join("") : `<div class="empty-state">${t("empty-memories")}</div>`}
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="dash-profile">
      <div class="container">
        ${sectionLabel(t("dash-profile"))}
        <div class="card card-soft">
          ${
            preferences.length
              ? preferences.map((p) => listRow("[+]", p.category, p.content)).join("")
              : `<div class="empty-state">${t("empty-preferences")}</div>`
          }
        </div>
      </div>
    </section>
  `;
}

function renderMemories() {
  const list = state.memories.map(memoryCard).join("");
  const bulkActions = state.selectedMemories.size
    ? `
        <div class="flex gap-sm mt-md">
          <button class="btn btn-sm btn-danger" data-action="bulk-delete">
            <i data-lucide="trash-2" class="icon-sm"></i> ${t("btn-bulk-delete")} (${state.selectedMemories.size})
          </button>
          <button class="btn btn-sm btn-secondary" data-action="deselect-all">${t("btn-deselect")}</button>
        </div>
      `
    : "";

  return `
    <section class="section" aria-labelledby="memories-title">
      <div class="container">
        ${sectionLabel(t("memories-title"))}

        <div class="controls-bar">
          <div class="form-group">
            <label for="tag-filter">${t("label-tag")}</label>
            <select id="tag-filter" class="select">
              <option value="">${t("opt-all-tags")}</option>
              ${tagOptions(state.selectedTag)}
            </select>
          </div>
          <button class="btn btn-primary" data-action="switch-search">${t("btn-search")}</button>
          <button class="btn btn-secondary" data-action="add-memory">${t("btn-add-memory")}</button>
        </div>

        ${bulkActions}

        <div class="memory-list">
          ${list || `<div class="empty-state">${t("empty-memories")}</div>`}
        </div>

        ${pagination(state.currentPage, state.totalPages, "page-memories")}
      </div>
    </section>
  `;
}

function renderSearch() {
  const results = state.searchResults
    .map((item) => {
      const memory = item.memory || item;
      const score = item.score
        ? `<span class="tag-badge" style="color:var(--accent)">${Math.round(item.score * 100)}%</span>`
        : "";
      return memoryCard(memory).replace(
        "</article>",
        `<div class="memory-meta mt-md">${score} similarity</div></article>`
      );
    })
    .join("");

  return `
    <section class="section" aria-labelledby="search-title">
      <div class="container">
        ${sectionLabel(t("search-title"))}

        <div class="controls-bar">
          <div class="form-group" style="flex:2 1 300px;">
            <label for="semantic-query">${t("label-semantic-query")}</label>
            <input id="semantic-query" class="input" type="text" placeholder="${t("placeholder-semantic")}" value="${escapeHtml(state.searchQuery)}">
          </div>
          <div class="form-group">
            <label for="search-tag">${t("label-tag")}</label>
            <select id="search-tag" class="select">
              <option value="">${t("opt-all-tags")}</option>
              ${tagOptions()}
            </select>
          </div>
          <button class="btn btn-primary" data-action="semantic-search">${t("btn-search")}</button>
        </div>

        <div class="memory-list">
          ${results || `<div class="empty-state">${state.searchQuery ? t("empty-search") : t("empty-search-prompt")}</div>`}
        </div>

        ${pagination(state.searchCurrentPage, state.searchTotalPages, "page-search")}
      </div>
    </section>
  `;
}

function renderTimeline() {
  const list = state.transcripts
    .map(
      (tx) => `
        <div class="list-row">
          <span class="list-marker">[-]</span>
          <div class="w-full">
            <div class="text-strong">${escapeHtml(formatDate(tx.createdAt))}</div>
            <div class="text-body">${escapeHtml(tx.content?.substring(0, 200) || "")}${tx.content?.length > 200 ? "..." : ""}</div>
          </div>
        </div>
      `
    )
    .join("");

  return `
    <section class="section" aria-labelledby="timeline-title">
      <div class="container">
        ${sectionLabel(t("timeline-title"))}
        <div class="list-rows">
          ${list || `<div class="empty-state">${t("empty-timeline")}</div>`}
        </div>
        ${pagination(state.transcriptCurrentPage, state.transcriptTotalPages, "page-timeline")}
      </div>
    </section>
  `;
}

function renderProfile() {
  const resp = state.userProfile;
  if (!resp) {
    return `<section class="section"><div class="container"><div class="empty-state">${t("loading")}</div></div></section>`;
  }
  if (resp.exists === false) {
    return `<section class="section"><div class="container">${sectionLabel(t("profile-title"))}<div class="empty-state">${escapeHtml(resp.message || t("empty-preferences"))}</div></div></section>`;
  }
  const profile = resp.profileData || {};
  const preferences = (profile.preferences || []).slice(0, 6);
  const patterns = (profile.patterns || []).slice(0, 6);
  const workflows = (profile.workflows || []).slice(0, 4);
  return `
    <section class="section" aria-labelledby="profile-title">
      <div class="container">
        ${sectionLabel(t("profile-title"))}

        <div class="card" style="margin-bottom:var(--sp-lg);">
          <div class="card-header">
            <h3 class="card-title">${escapeHtml(resp.userId || t("profile-anonymous"))}</h3>
            <button class="btn btn-sm btn-secondary" data-action="refresh-profile">${t("btn-refresh")}</button>
          </div>
          <div class="memory-meta">
            <span>${t("profile-preferences")}: ${profile.preferences?.length ?? 0}</span>
            <span>${t("profile-patterns")}: ${profile.patterns?.length ?? 0}</span>
            <span>${t("profile-workflows")}: ${profile.workflows?.length ?? 0}</span>
            ${resp.version ? `<span>v${escapeHtml(String(resp.version))}</span>` : ""}
          </div>
        </div>

        <div class="card card-soft" style="margin-bottom:var(--sp-lg);">
          <div class="card-header"><h3 class="card-title">${t("profile-preferences")}</h3></div>
          ${
            preferences.length
              ? preferences.map((p) => listRow("[+]", p.category, p.content)).join("")
              : `<div class="empty-state">${t("empty-preferences")}</div>`
          }
        </div>

        <div class="card card-soft" style="margin-bottom:var(--sp-lg);">
          <div class="card-header"><h3 class="card-title">${t("profile-patterns")}</h3></div>
          ${
            patterns.length
              ? patterns.map((p) => listRow("[-]", p.category, p.description || p.content)).join("")
              : `<div class="empty-state">${t("empty-patterns")}</div>`
          }
        </div>

        <div class="card card-soft" style="margin-bottom:var(--sp-lg);">
          <div class="card-header"><h3 class="card-title">${t("profile-workflows")}</h3></div>
          ${
            workflows.length
              ? workflows
                  .map((w) => listRow("[x]", w.name, `${w.steps?.length ?? 0} steps`))
                  .join("")
              : `<div class="empty-state">${t("empty-workflows")}</div>`
          }
        </div>

        <div class="card card-soft">
          <div class="card-header"><h3 class="card-title">${t("profile-changelog")}</h3></div>
          ${
            state.changelogs.length
              ? state.changelogs
                  .map(
                    (c) => `
                      <div class="list-row">
                        <span class="list-marker">[+]</span>
                        <div class="w-full">
                          <div class="text-strong">${escapeHtml(c.version)} · ${escapeHtml(c.changeType)}</div>
                          <div class="text-body">${escapeHtml(c.changeSummary || "")}</div>
                          <div class="text-caption">${escapeHtml(formatDate(c.createdAt))}</div>
                        </div>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="empty-state">${t("empty-changelog")}</div>`
          }
        </div>
      </div>
    </section>
  `;
}

function renderSettings() {
  const apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  return `
    <section class="section" aria-labelledby="settings-title">
      <div class="container">
        ${sectionLabel(t("settings-title"))}

        <div class="card" style="max-width:640px;">
          <div class="form-group" style="margin-bottom:var(--sp-md);">
            <label for="settings-api-key">${t("label-api-key")}</label>
            <input id="settings-api-key" class="input" type="password" value="${escapeHtml(apiKey)}" placeholder="${t("placeholder-api-key")}">
          </div>
          <div class="form-group" style="margin-bottom:var(--sp-md);">
            <label for="settings-page-size">${t("label-page-size")}</label>
            <input id="settings-page-size" class="input" type="number" min="5" max="100" value="${state.pageSize}">
          </div>
          <div class="modal-actions" style="padding-top:0;">
            <button class="btn btn-primary" data-action="save-settings">${t("btn-save")}</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMaintenance() {
  const migration = state.migration;
  return `
    <section class="section" aria-labelledby="maintenance-title">
      <div class="container">
        ${sectionLabel(t("maintenance-title"))}

        <div class="card" style="margin-bottom:var(--sp-lg);">
          <div class="card-header"><h3 class="card-title">${t("maint-cleanup")}</h3></div>
          <p class="text-body">${t("desc-cleanup")}</p>
          <div class="mt-md">
            <button class="btn btn-primary" data-action="run-cleanup">${t("btn-run-cleanup")}</button>
          </div>
        </div>

        <div class="card" style="margin-bottom:var(--sp-lg);">
          <div class="card-header"><h3 class="card-title">${t("maint-dedup")}</h3></div>
          <p class="text-body">${t("desc-dedup")}</p>
          <div class="mt-md">
            <button class="btn btn-primary" data-action="run-dedup">${t("btn-run-dedup")}</button>
          </div>
        </div>

        <div class="card" style="margin-bottom:var(--sp-lg);">
          <div class="card-header"><h3 class="card-title">${t("maint-migration")}</h3></div>
          <p class="text-body">${t("desc-migration")}</p>
          <div class="mt-md">
            <button class="btn btn-primary" data-action="run-migration">${t("btn-run-migration")}</button>
            ${
              migration.tagMigration > 0
                ? `<button class="btn btn-secondary" data-action="run-tag-migration">${t("btn-run-tag-migration")} (${migration.tagMigration})</button>`
                : ""
            }
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderConflicts() {
  const stats = state.conflictStats || {};
  const list = state.conflicts
    .map(
      (conflict) => `
        <div class="card" style="margin-bottom:var(--sp-md);">
          <div class="card-header">
            <h3 class="card-title">${escapeHtml(String(conflict.id || "").slice(0, 12))}</h3>
            <span class="tag-badge" style="color:var(--danger)">${t("conflict-unresolved")}</span>
          </div>
          <div class="memory-meta">
            <span>${formatDate(conflict.createdAt)}</span>
            <span>${escapeHtml(conflict.type || "unknown")}</span>
          </div>
          <div class="mt-md flex gap-sm">
            <button class="btn btn-sm btn-primary" data-action="resolve-conflict" data-id="${escapeHtml(conflict.id)}" data-strategy="keep-newer">${t("btn-keep-newer")}</button>
            <button class="btn btn-sm btn-secondary" data-action="resolve-conflict" data-id="${escapeHtml(conflict.id)}" data-strategy="keep-older">${t("btn-keep-older")}</button>
            <button class="btn btn-sm btn-danger" data-action="resolve-conflict" data-id="${escapeHtml(conflict.id)}" data-strategy="merge">${t("btn-merge")}</button>
          </div>
        </div>
      `
    )
    .join("");

  return `
    <section class="section" aria-labelledby="conflicts-title">
      <div class="container">
        ${sectionLabel(t("conflicts-title"))}

        <div class="stats-grid" style="margin-bottom:var(--sp-lg);">
          <div class="stat-card">
            <div class="stat-value">${stats.unresolved ?? "—"}</div>
            <div class="stat-label">${t("stat-unresolved")}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.total ?? "—"}</div>
            <div class="stat-label">${t("stat-total-conflicts")}</div>
          </div>
        </div>

        <div>
          ${list || `<div class="empty-state">${t("empty-conflicts")}</div>`}
        </div>
      </div>
    </section>
  `;
}

// ============================================================================
// Data loading
// ============================================================================

async function loadView(view) {
  state.loading = true;
  renderApp();

  switch (view) {
    case VIEWS.DASHBOARD:
      await Promise.all([loadStats(), loadTags(), loadMemories(1), loadUserProfile()]);
      break;
    case VIEWS.MEMORIES:
      await Promise.all([loadTags(), loadMemories(state.currentPage)]);
      break;
    case VIEWS.SEARCH:
      await loadTags();
      if (state.searchQuery) await performSemanticSearch();
      break;
    case VIEWS.TIMELINE:
      await loadTranscripts();
      break;
    case VIEWS.PROFILE:
      await loadUserProfile();
      await loadChangelog();
      break;
    case VIEWS.MAINTENANCE:
      await checkMigrationStatus();
      break;
    case VIEWS.CONFLICTS:
      await loadConflicts();
      break;
    case VIEWS.SETTINGS:
      break;
  }

  state.loading = false;
  renderApp();
}

async function loadStats() {
  const result = await fetchAPI("/api/stats");
  if (result.success) {
    state.stats = result.data;
  }
}

async function loadTags() {
  const result = await fetchAPI("/api/tags");
  if (result.success) {
    state.tags = result.data || { project: [] };
  }
}

async function loadMemories(page = 1) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(state.pageSize));
  if (state.selectedTag) params.set("tag", state.selectedTag);

  const result = await fetchAPI(`/api/memories?${params.toString()}`);
  if (result.success) {
    state.memories = result.data?.items || [];
    state.totalMemories = result.data?.total || 0;
    state.totalPages = result.data?.totalPages || 1;
    state.currentPage = result.data?.page || 1;
  }
}

async function loadUserProfile() {
  const result = await fetchAPI("/api/user-profile");
  if (result.success) {
    state.userProfile = result.data;
  }
}

async function loadConflicts() {
  const [listResult, statsResult] = await Promise.all([
    fetchAPI("/api/conflicts?resolved=false&limit=100"),
    fetchAPI("/api/conflicts/stats"),
  ]);
  if (listResult.success) {
    state.conflicts = listResult.data || [];
  }
  if (statsResult.success) {
    state.conflictStats = statsResult.data;
  }
}

async function loadTranscripts() {
  const params = new URLSearchParams();
  params.set("page", String(state.transcriptCurrentPage));
  params.set("pageSize", String(state.pageSize));
  const result = await fetchAPI(`/api/transcripts?${params.toString()}`);
  if (result.success) {
    state.transcripts = result.data?.transcripts || [];
    state.transcriptTotalPages = result.data?.totalPages || 1;
    state.transcriptCurrentPage = result.data?.page || 1;
  }
}

async function loadChangelog() {
  const profile = state.userProfile;
  if (!profile || profile.exists === false || !profile.id) {
    state.changelogs = [];
    return;
  }
  const params = new URLSearchParams();
  params.set("profileId", String(profile.id));
  params.set("limit", "10");
  const result = await fetchAPI(`/api/user-profile/changelog?${params.toString()}`);
  if (result.success) {
    state.changelogs = result.data || [];
  }
}

async function checkMigrationStatus() {
  const [detect, tagDetect] = await Promise.all([
    fetchAPI("/api/migration/detect"),
    fetchAPI("/api/migration/tags/detect"),
  ]);
  state.migration = {
    detected: detect.success ? detect.data?.count || 0 : 0,
    tagMigration: tagDetect.success ? tagDetect.data?.count || 0 : 0,
  };
}

// ============================================================================
// Actions
// ============================================================================

async function addMemory() {
  openModal(
    t("modal-add-memory"),
    `
      <div class="form-group">
        <label for="add-content">${t("label-content")}</label>
        <textarea id="add-content" class="textarea" rows="6" placeholder="${t("placeholder-content")}"></textarea>
      </div>
      <div class="form-group">
        <label for="add-tag">${t("label-tag")}</label>
        <select id="add-tag" class="select"><option value="">${t("opt-none")}</option>${tagOptions()}</select>
      </div>
    `,
    `
      <div class="modal-actions">
        <button class="btn btn-secondary" data-action="close-modal">${t("btn-cancel")}</button>
        <button class="btn btn-primary" data-action="submit-add">${t("btn-save")}</button>
      </div>
    `
  );
}

async function submitAddMemory() {
  const content = document.getElementById("add-content").value.trim();
  const tag = document.getElementById("add-tag").value;
  if (!content) {
    showError(t("error-content-required"));
    return;
  }
  const body = { content, tags: tag ? [tag] : [] };
  const result = await fetchAPI("/api/memories", { method: "POST", body: JSON.stringify(body) });
  if (result.success) {
    closeModal();
    showToast(t("toast-memory-added"));
    switchView(VIEWS.MEMORIES);
  } else {
    showError(result.error || t("error-save-failed"));
  }
}

function editMemory(id) {
  const memory = state.memories.find((m) => m.id === id);
  if (!memory) return;
  const tags = Array.isArray(memory.tags) ? memory.tags : [];
  const tag = tags[0] || "";
  openModal(
    t("modal-edit-memory"),
    `
      <div class="form-group">
        <label for="edit-content">${t("label-content")}</label>
        <textarea id="edit-content" class="textarea" rows="8">${escapeHtml(memory.content)}</textarea>
      </div>
      <div class="form-group">
        <label for="edit-tag">${t("label-tag")}</label>
        <select id="edit-tag" class="select"><option value="">${t("opt-none")}</option>${tagOptions(tag)}</select>
      </div>
    `,
    `
      <div class="modal-actions">
        <button class="btn btn-secondary" data-action="close-modal">${t("btn-cancel")}</button>
        <button class="btn btn-primary" data-action="submit-edit" data-id="${escapeHtml(id)}">${t("btn-save")}</button>
      </div>
    `
  );
}

async function submitEditMemory(id) {
  const content = document.getElementById("edit-content").value.trim();
  const tag = document.getElementById("edit-tag").value;
  if (!content) {
    showError(t("error-content-required"));
    return;
  }
  const body = { content, tags: tag ? [tag] : [] };
  const result = await fetchAPI(`/api/memories/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (result.success) {
    closeModal();
    showToast(t("toast-memory-updated"));
    loadView(state.view);
  } else {
    showError(result.error || t("error-save-failed"));
  }
}

async function deleteMemory(id) {
  if (!confirm(t("confirm-delete-memory"))) return;
  const result = await fetchAPI(`/api/memories/${id}`, { method: "DELETE" });
  if (result.success) {
    showToast(t("toast-memory-deleted"));
    loadView(state.view);
  } else {
    showError(result.error || t("error-delete-failed"));
  }
}

async function bulkDeleteMemories() {
  const ids = Array.from(state.selectedMemories);
  if (!ids.length) return;
  if (!confirm(t("confirm-bulk-delete", { count: ids.length }))) return;
  const result = await fetchAPI("/api/memories/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids, cascade: true }),
  });
  if (result.success) {
    state.selectedMemories.clear();
    showToast(t("toast-bulk-deleted"));
    loadView(state.view);
  } else {
    showError(result.error || t("error-delete-failed"));
  }
}

async function togglePin(id, isPinned) {
  const endpoint = isPinned ? `/api/memories/${id}/unpin` : `/api/memories/${id}/pin`;
  const result = await fetchAPI(endpoint, { method: "POST" });
  if (result.success) {
    showToast(isPinned ? t("toast-unpinned") : t("toast-pinned"));
    loadView(state.view);
  } else {
    showError(result.error || t("error-action-failed"));
  }
}

async function performSemanticSearch() {
  const query = document.getElementById("semantic-query").value.trim();
  const tag = document.getElementById("search-tag")?.value || "";
  if (!query) {
    state.searchResults = [];
    renderApp();
    return;
  }
  state.searchQuery = query;
  const params = new URLSearchParams();
  params.set("q", query);
  if (tag) params.set("tag", tag);
  params.set("page", String(state.searchCurrentPage));
  params.set("pageSize", String(state.pageSize));
  const result = await fetchAPI(`/api/search?${params.toString()}`);
  if (result.success) {
    state.searchResults = result.data?.items || [];
    state.searchTotalPages = result.data?.totalPages || 1;
  } else {
    state.searchResults = [];
    showError(result.error || t("error-search-failed"));
  }
  renderApp();
}

async function changePage(delta, handler) {
  if (handler === "page-memories") {
    state.currentPage = Math.max(1, Math.min(state.totalPages, state.currentPage + delta));
    await loadMemories(state.currentPage);
  } else if (handler === "page-search") {
    state.searchCurrentPage = Math.max(
      1,
      Math.min(state.searchTotalPages, state.searchCurrentPage + delta)
    );
    await performSemanticSearch();
  } else if (handler === "page-timeline") {
    state.transcriptCurrentPage = Math.max(
      1,
      Math.min(state.transcriptTotalPages, state.transcriptCurrentPage + delta)
    );
    await loadTranscripts();
  }
  renderApp();
}

async function runCleanup() {
  if (!confirm(t("confirm-cleanup"))) return;
  const result = await fetchAPI("/api/cleanup", { method: "POST" });
  if (result.success) {
    showToast(t("toast-cleanup-done", result.data || {}));
  } else {
    showError(result.error || t("error-action-failed"));
  }
}

async function runDeduplication() {
  if (!confirm(t("confirm-dedup"))) return;
  const result = await fetchAPI("/api/deduplicate", { method: "POST" });
  if (result.success) {
    showToast(t("toast-dedup-done", result.data || {}));
  } else {
    showError(result.error || t("error-action-failed"));
  }
}

async function runMigration() {
  if (!confirm(t("confirm-migration"))) return;
  const result = await fetchAPI("/api/migration/run", {
    method: "POST",
    body: JSON.stringify({ strategy: "fresh-start" }),
  });
  if (result.success) {
    showToast(t("toast-migration-done"));
    await checkMigrationStatus();
    renderApp();
  } else {
    showError(result.error || t("error-action-failed"));
  }
}

async function runTagMigration() {
  if (!confirm(t("confirm-tag-migration"))) return;
  const result = await fetchAPI("/api/migration/tags/run-batch", {
    method: "POST",
    body: JSON.stringify({ batchSize: 10 }),
  });
  if (result.success) {
    showToast(t("toast-tag-migration-done"));
    await checkMigrationStatus();
    renderApp();
  } else {
    showError(result.error || t("error-action-failed"));
  }
}

async function resolveConflict(id, strategy) {
  let mergedContent = "";
  if (strategy === "merge") {
    mergedContent = window.prompt(t("prompt-merge-content")) || "";
  }
  const result = await fetchAPI(`/api/conflicts/${id}`, {
    method: "POST",
    body: JSON.stringify({ strategy, mergedContent }),
  });
  if (result.success) {
    showToast(t("toast-conflict-resolved"));
    loadView(VIEWS.CONFLICTS);
  } else {
    showError(result.error || t("error-action-failed"));
  }
}

async function refreshProfile() {
  const result = await fetchAPI("/api/user-profile/refresh", { method: "POST" });
  if (result.success) {
    showToast(t("toast-profile-refreshed"));
    await loadUserProfile();
    renderApp();
  } else {
    showError(result.error || t("error-action-failed"));
  }
}

async function saveSettings() {
  const apiKey = document.getElementById("settings-api-key").value.trim();
  const pageSize = Number.parseInt(document.getElementById("settings-page-size").value, 10);
  if (apiKey) {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }
  if (pageSize > 0 && pageSize <= 100) {
    state.pageSize = pageSize;
  }
  showToast(t("toast-settings-saved"));
}

// ============================================================================
// Event delegation
// ============================================================================

function handleAction(e) {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;

  switch (action) {
    case "switch-view":
      switchView(target.dataset.view);
      break;
    case "add-memory":
      addMemory();
      break;
    case "submit-add":
      submitAddMemory();
      break;
    case "edit":
      editMemory(id);
      break;
    case "submit-edit":
      submitEditMemory(id);
      break;
    case "delete":
      deleteMemory(id);
      break;
    case "pin":
      togglePin(id, target.dataset.pinned === "true");
      break;
    case "switch-search":
      state.searchQuery = "";
      switchView(VIEWS.SEARCH);
      break;
    case "semantic-search":
      performSemanticSearch();
      break;
    case "page-memories":
    case "page-search":
      changePage(Number(target.dataset.delta), action);
      break;
    case "bulk-delete":
      bulkDeleteMemories();
      break;
    case "deselect-all":
      state.selectedMemories.clear();
      renderApp();
      break;
    case "close-modal":
      closeModal();
      break;
    case "run-cleanup":
      runCleanup();
      break;
    case "run-dedup":
      runDeduplication();
      break;
    case "run-migration":
      runMigration();
      break;
    case "run-tag-migration":
      runTagMigration();
      break;
    case "resolve-conflict":
      resolveConflict(id, target.dataset.strategy);
      break;
    case "refresh-profile":
      refreshProfile();
      break;
    case "save-settings":
      saveSettings();
      break;
  }
}

function handleCheckboxChange(e) {
  const checkbox = e.target.closest(".memory-checkbox");
  if (!checkbox) return;
  const id = checkbox.dataset.id;
  if (checkbox.checked) {
    state.selectedMemories.add(id);
  } else {
    state.selectedMemories.delete(id);
  }
  const card = checkbox.closest(".memory-card");
  card?.classList.toggle("selected", checkbox.checked);
  updateBulkActions();
}

function updateBulkActions() {
  const existing = document.querySelector("[data-action='bulk-delete']")?.closest(".flex");
  if (state.selectedMemories.size && !existing) {
    renderApp();
  } else if (!state.selectedMemories.size && existing) {
    renderApp();
  }
}

function handleTagFilter(e) {
  const select = e.target.closest("#tag-filter");
  if (!select) return;
  state.selectedTag = select.value;
  state.currentPage = 1;
  loadMemories(1).then(renderApp);
}

function handleKeydown(e) {
  if (e.key === "Escape") {
    closeModal();
    const nav = document.getElementById("nav-links");
    if (nav?.classList.contains("open")) toggleMobileNav();
  }
  if (e.key === "Enter" && e.target?.id === "semantic-query") {
    performSemanticSearch();
  }
}

function bindGlobalEvents() {
  document.body.addEventListener("click", handleAction);
  document.body.addEventListener("change", handleCheckboxChange);
  document.body.addEventListener("change", handleTagFilter);
  document.body.addEventListener("keydown", handleKeydown);
  document.getElementById("modal")?.addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });
}

// ============================================================================
// Init
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initLanguage();
  renderApp();
  bindGlobalEvents();
  loadView(VIEWS.DASHBOARD);
});
