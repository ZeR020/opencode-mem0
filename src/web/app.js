/* global lucide, getLanguage, setLanguage, t, jsonrepair, DOMPurify, marked */
const API_BASE = "";

const state = {
  tags: { project: [] },
  memories: [],
  currentPage: 1,
  pageSize: 20,
  totalPages: 1,
  totalItems: 0,
  selectedTag: "",
  currentView: "project",
  searchQuery: "",
  isSearching: false,
  selectedMemories: new Set(),
  autoRefreshInterval: null,
  userProfile: null,
  conflicts: [],
  transcripts: [],
  transcriptsPage: 1,
  transcriptsTotalPages: 1,
  transcriptsTotalItems: 0,
};

marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false,
});

function renderMarkdown(markdown) {
  const html = marked.parse(markdown);
  return DOMPurify.sanitize(html);
}

async function fetchAPI(endpoint, options = {}) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(API_BASE + endpoint, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await response.json();
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  } catch (error) {
    console.error("API Error:", error);
    return { success: false, error: error.message };
  }
}

async function loadTags() {
  const result = await fetchAPI("/api/tags");
  if (result.success) {
    state.tags = result.data;
    populateTagDropdowns();
  }
}

function populateTagDropdowns() {
  const tagFilter = document.getElementById("tag-filter");
  const addTag = document.getElementById("add-tag");

  tagFilter.innerHTML = `<option value="">${t("opt-all-tags")}</option>`;
  addTag.innerHTML = `<option value="">${t("opt-select-tag")}</option>`;

  const scopeTags = state.tags.project;

  scopeTags.forEach((tagInfo) => {
    const displayText = tagInfo.displayName || tagInfo.tag;
    const shortDisplay =
      displayText.length > 50 ? `${displayText.substring(0, 50)}...` : displayText;

    const option1 = document.createElement("option");
    option1.value = tagInfo.tag;
    option1.textContent = shortDisplay;
    tagFilter.appendChild(option1);

    const option2 = document.createElement("option");
    option2.value = tagInfo.tag;
    option2.textContent = shortDisplay;
    addTag.appendChild(option2);
  });
}

function renderMemories() {
  const container = document.getElementById("memories-list");

  if (state.memories.length === 0) {
    container.innerHTML = `<div class="empty-state">${t("empty-memories")}</div>`;
    return;
  }

  container.innerHTML = groupMemories(state.memories)
    .map((group) => {
      if (group.isPair) {
        return renderCombinedCard(group);
      } else if (group.type === "prompt") {
        return renderPromptCard(group.item);
      } else {
        return renderMemoryCard(group.item);
      }
    })
    .join("");

  document.querySelectorAll(".memory-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", handleCheckboxChange);
  });

  lucide.createIcons();
}

function groupMemories(items) {
  const map = new Map();
  const pairs = [];
  const processed = new Set();

  items.forEach((item) => map.set(item.id, item));

  items.forEach((item) => {
    if (processed.has(item.id)) return;

    if (item.type === "memory" && item.linkedPromptId && map.has(item.linkedPromptId)) {
      const prompt = map.get(item.linkedPromptId);
      pairs.push({ isPair: true, memory: item, prompt });
      processed.add(item.id);
      processed.add(prompt.id);
    } else if (item.type === "prompt" && item.linkedMemoryId && map.has(item.linkedMemoryId)) {
      const memory = map.get(item.linkedMemoryId);
      pairs.push({ isPair: true, memory, prompt: item });
      processed.add(item.id);
      processed.add(memory.id);
    } else {
      pairs.push({ isPair: false, type: item.type, item });
      processed.add(item.id);
    }
  });

  return pairs.sort((a, b) => {
    const timeA = a.isPair ? a.memory.createdAt : a.item.createdAt;
    const timeB = b.isPair ? b.memory.createdAt : b.item.createdAt;
    return new Date(timeB) - new Date(timeA);
  });
}

function renderCombinedCard(pair) {
  const { memory, prompt } = pair;
  const isSelected = state.selectedMemories.has(memory.id);
  const isPinned = memory.isPinned || false;
  const similarityHtml =
    memory.similarity === undefined
      ? ""
      : `<span class="similarity-score">${Math.round(memory.similarity * 100)}%</span>`;

  const tagsHtml =
    memory.tags && memory.tags.length > 0
      ? `<div class="tags-list">${memory.tags.map((t) => `<span class="tag-badge">${escapeHtml(t)}</span>`).join("")}</div>`
      : "";

  const pinButton = isPinned
    ? `<button class="btn-pin pinned" onclick="unpinMemory('${escapeJsString(memory.id)}')" title="Unpin"><i data-lucide="pin" class="icon icon-filled"></i></button>`
    : `<button class="btn-pin" onclick="pinMemory('${escapeJsString(memory.id)}')" title="Pin"><i data-lucide="pin" class="icon"></i></button>`;

  const createdDate = formatDate(memory.createdAt);
  const updatedDate =
    memory.updatedAt && memory.updatedAt !== memory.createdAt ? formatDate(memory.updatedAt) : null;

  const dateInfo = updatedDate
    ? `<span>${t("date-created")} ${createdDate}</span><span>${t("date-updated")} ${updatedDate}</span>`
    : `<span>${t("date-created")} ${createdDate}</span>`;
  return `
    <div class="combined-card ${isSelected ? "selected" : ""} ${isPinned ? "pinned" : ""}" data-id="${memory.id}">
      <div class="combined-prompt-section">
        <div class="combined-header">
          <span class="badge badge-prompt">${t("badge-prompt")}</span>
          <span class="prompt-date">${formatDate(prompt.createdAt)}</span>
        </div>
        <div class="prompt-content">${escapeHtml(prompt.content)}</div>
      </div>
      
      <div class="combined-divider">
        <i data-lucide="arrow-down" class="divider-icon"></i>
      </div>

      <div class="combined-memory-section">
        <div class="memory-header">
          <div class="meta">
            <input type="checkbox" class="memory-checkbox" data-id="${memory.id}" ${isSelected ? "checked" : ""} />
            <span class="badge badge-memory">${t("badge-memory")}</span>
            ${memory.memoryType ? `<span class="badge badge-type">${escapeHtml(memory.memoryType)}</span>` : ""}
            ${similarityHtml}
            ${isPinned ? `<span class="badge badge-pinned">${t("badge-pinned")}</span>` : ""}
            <span class="memory-display-name">${escapeHtml(memory.displayName || memory.id)}</span>
          </div>
          <div class="memory-actions">
            ${pinButton}
            <button class="btn-edit" onclick="editMemory('${escapeJsString(memory.id)}')"><i data-lucide="edit-3" class="icon"></i></button>
            <button class="btn-delete" onclick="deleteMemoryWithLink('${escapeJsString(memory.id)}', true)">
              <i data-lucide="trash-2" class="icon"></i> ${t("btn-delete-pair")}
            </button>
          </div>
        </div>
        ${tagsHtml}
        <div class="memory-content markdown-content">${renderMarkdown(memory.content)}</div>
        <div class="memory-footer">
          ${dateInfo}
          <span>ID: ${memory.id}</span>
        </div>
      </div>
    </div>
  `;
}

function renderPromptCard(prompt) {
  const isLinked = Boolean(prompt.linkedMemoryId);
  const isSelected = state.selectedMemories.has(prompt.id);
  const promptDate = formatDate(prompt.createdAt);

  return `
    <div class="prompt-card ${isSelected ? "selected" : ""}" data-id="${prompt.id}">
      <div class="prompt-header">
        <div class="meta">
          <input type="checkbox" class="memory-checkbox" data-id="${prompt.id}" ${isSelected ? "checked" : ""} />
          <i data-lucide="message-circle" class="icon"></i>
          <span class="badge badge-prompt">${t("badge-prompt")}</span>
          ${isLinked ? `<span class="badge badge-linked"><i data-lucide="link" class="icon-sm"></i> ${t("badge-linked")}</span>` : ""}
          <span class="prompt-date">${promptDate}</span>
        </div>
        <div class="prompt-actions">
          <button class="btn-delete" onclick="deletePromptWithLink('${escapeJsString(prompt.id)}', ${isLinked})">
            <i data-lucide="trash-2" class="icon"></i>
            ${isLinked ? t("btn-delete-pair") : t("btn-delete")}
          </button>
        </div>
      </div>
      <div class="prompt-content">
        ${escapeHtml(prompt.content)}
      </div>
      ${isLinked ? `<div class="link-indicator"><i data-lucide="arrow-down" class="icon-sm"></i> ${t("text-generated-above")} <i data-lucide="arrow-up" class="icon-sm"></i></div>` : ""}
    </div>
  `;
}

function getMemoryDisplayInfo(memory) {
  if (memory.projectPath) {
    const pathParts = memory.projectPath.replaceAll("\\", "/").split("/").filter(Boolean);
    return pathParts.at(-1) || memory.projectPath;
  }
  return memory.displayName || memory.id;
}

function getMemorySubtitle(memory) {
  return memory.projectPath
    ? `<span class="memory-subtitle">${escapeHtml(memory.projectPath)}</span>`
    : "";
}

function getPinButton(memory, isPinned) {
  return isPinned
    ? `<button class="btn-pin pinned" onclick="unpinMemory('${escapeJsString(memory.id)}')" title="Unpin"><i data-lucide="pin" class="icon icon-filled"></i></button>`
    : `<button class="btn-pin" onclick="pinMemory('${escapeJsString(memory.id)}')" title="Pin"><i data-lucide="pin" class="icon"></i></button>`;
}

function getMemoryDateInfo(memory) {
  const createdDate = formatDate(memory.createdAt);
  const updatedDate =
    memory.updatedAt && memory.updatedAt !== memory.createdAt ? formatDate(memory.updatedAt) : null;
  return updatedDate
    ? `<span>${t("date-created")} ${createdDate}</span><span>${t("date-updated")} ${updatedDate}</span>`
    : `<span>${t("date-created")} ${createdDate}</span>`;
}

function getMemoryTagsHtml(memory) {
  return memory.tags && memory.tags.length > 0
    ? `<div class="tags-list">${memory.tags.map((t) => `<span class="tag-badge">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";
}

function getMemoryBadges(memory, similarityHtml, isPinned, isLinked) {
  const badges = [];
  if (memory.memoryType)
    badges.push(`<span class="badge badge-type">${escapeHtml(memory.memoryType)}</span>`);
  if (isLinked)
    badges.push(
      `<span class="badge badge-linked"><i data-lucide="link" class="icon-sm"></i> ${t("badge-linked")}</span>`
    );
  if (similarityHtml) badges.push(similarityHtml);
  if (isPinned) badges.push(`<span class="badge badge-pinned">${t("badge-pinned")}</span>`);
  return badges.join("");
}

function renderMemoryCard(memory) {
  const isSelected = state.selectedMemories.has(memory.id);
  const isPinned = memory.isPinned || false;
  const isLinked = Boolean(memory.linkedPromptId);
  const similarityHtml =
    memory.similarity === undefined
      ? ""
      : `<span class="similarity-score">${memory.similarity}%</span>`;

  const displayInfo = getMemoryDisplayInfo(memory);
  const subtitle = getMemorySubtitle(memory);
  const pinButton = getPinButton(memory, isPinned);
  const dateInfo = getMemoryDateInfo(memory);
  const tagsHtml = getMemoryTagsHtml(memory);
  const badges = getMemoryBadges(memory, similarityHtml, isPinned, isLinked);

  return `
    <div class="memory-card ${isSelected ? "selected" : ""} ${isPinned ? "pinned" : ""}" data-id="${memory.id}">
      <div class="memory-header">
        <div class="meta">
          <input type="checkbox" class="memory-checkbox" data-id="${memory.id}" ${isSelected ? "checked" : ""} />
          ${badges}
          <span class="memory-display-name">${escapeHtml(displayInfo)}</span>
          ${subtitle}
        </div>
        <div class="memory-actions">
          ${pinButton}
          <button class="btn-edit" onclick="editMemory('${escapeJsString(memory.id)}')"><i data-lucide="edit-3" class="icon"></i></button>
          <button class="btn-delete" onclick="deleteMemoryWithLink('${escapeJsString(memory.id)}', ${isLinked})">
            <i data-lucide="trash-2" class="icon"></i>
            ${isLinked ? t("btn-delete-pair") : t("btn-delete")}
          </button>
        </div>
      </div>
      ${tagsHtml}
      <div class="memory-content markdown-content">${renderMarkdown(memory.content)}</div>
      ${isLinked ? `<div class="link-indicator"><i data-lucide="arrow-up" class="icon-sm"></i> ${t("text-from-below")} <i data-lucide="arrow-down" class="icon-sm"></i></div>` : ""}
      <div class="memory-footer">
        ${dateInfo}
        <span>ID: ${memory.id}</span>
      </div>
    </div>
  `;
}

function handleCheckboxChange(e) {
  const id = e.target.dataset.id;
  if (e.target.checked) {
    state.selectedMemories.add(id);
  } else {
    state.selectedMemories.delete(id);
  }
  updateBulkActions();
  updateCardSelection(id, e.target.checked);
}

function updateCardSelection(id, selected) {
  const card = document.querySelector(
    `.memory-card[data-id="${id}"], .prompt-card[data-id="${id}"]`
  );
  if (card) {
    if (selected) {
      card.classList.add("selected");
    } else {
      card.classList.remove("selected");
    }
  }
}

function updateBulkActions() {
  const bulkActions = document.getElementById("bulk-actions");
  const selectedCount = document.getElementById("selected-count");

  if (state.selectedMemories.size > 0) {
    bulkActions.classList.remove("hidden");
    selectedCount.textContent = t("text-selected", { count: state.selectedMemories.size });
  } else {
    bulkActions.classList.add("hidden");
  }
}

function updatePagination() {
  const pageInfo = t("text-page", { current: state.currentPage, total: state.totalPages });
  document.getElementById("page-info-top").textContent = pageInfo;
  document.getElementById("page-info-bottom").textContent = pageInfo;
  const hasPrev = state.currentPage > 1;
  const hasNext = state.currentPage < state.totalPages;

  document.getElementById("prev-page-top").disabled = !hasPrev;
  document.getElementById("next-page-top").disabled = !hasNext;
  document.getElementById("prev-page-bottom").disabled = !hasPrev;
  document.getElementById("next-page-bottom").disabled = !hasNext;
}

function updateSectionTitle() {
  const title = state.isSearching
    ? `└─ SEARCH RESULTS (${state.totalItems}) ──`
    : t("section-project", { count: state.totalItems });
  document.getElementById("section-title").textContent = title;
}

async function loadStats() {
  const result = await fetchAPI("/api/stats");
  if (result.success) {
    document.getElementById("stats-total").textContent = t("text-total", {
      count: result.data.total,
    });
  }

  // Also fetch conflict stats for badge
  const conflictResult = await fetchAPI("/api/conflicts/stats");
  if (conflictResult.success) {
    const badge = document.getElementById("conflict-badge");
    if (conflictResult.data.unresolved > 0) {
      badge.textContent = conflictResult.data.unresolved;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
}

async function addMemory(e) {
  e.preventDefault();

  const content = document.getElementById("add-content").value.trim();
  const containerTag = document.getElementById("add-tag").value;
  const type = document.getElementById("add-type").value;
  const tagsStr = document.getElementById("add-tags").value.trim();
  const tags = tagsStr
    ? tagsStr
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  if (!content || !containerTag) {
    showToast(t("toast-add-error"), "error");
    return;
  }

  const result = await fetchAPI("/api/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, containerTag, type: type || undefined, tags }),
  });

  if (result.success) {
    showToast(t("toast-add-success"), "success");
    document.getElementById("add-form").reset();
    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-add-failed"), "error");
  }
}

async function loadMemories() {
  showRefreshIndicator(true);

  let endpoint = `/api/memories?page=${state.currentPage}&pageSize=${state.pageSize}&includePrompts=true`;

  if (state.isSearching) {
    endpoint = `/api/search?q=${encodeURIComponent(state.searchQuery || "")}&page=${state.currentPage}&pageSize=${state.pageSize}`;
    if (state.selectedTag) {
      endpoint += `&tag=${encodeURIComponent(state.selectedTag)}`;
    }
  } else {
    if (state.selectedTag) {
      endpoint += `&tag=${encodeURIComponent(state.selectedTag)}`;
    }
  }

  const result = await fetchAPI(endpoint);

  showRefreshIndicator(false);

  if (result.success) {
    state.memories = result.data.items;
    state.totalPages = result.data.totalPages;
    state.totalItems = result.data.total;
    state.currentPage = result.data.page;

    renderMemories();
    updatePagination();
    updateSectionTitle();
  } else {
    showError(result.error || t("toast-update-failed"));
  }
}

// skipcq: JS-0128 — Used in HTML template literal: onclick="deleteMemoryWithLink(...)"
async function deleteMemoryWithLink(id, isLinked) {
  const message = isLinked ? t("confirm-delete-pair") : t("confirm-delete");
  if (!(await showConfirm(message))) return;

  const result = await fetchAPI(`/api/memories/${id}?cascade=true`, {
    method: "DELETE",
  });

  if (result.success) {
    showToast(t("toast-delete-success"), "success");

    state.selectedMemories.delete(id);
    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-delete-failed"), "error");
  }
}

// skipcq: JS-0128 — Used in HTML template literal: onclick="deletePromptWithLink(...)"
async function deletePromptWithLink(id, isLinked) {
  const message = isLinked ? t("confirm-delete-prompt") : t("confirm-delete");
  if (!(await showConfirm(message))) return;

  const result = await fetchAPI(`/api/prompts/${id}?cascade=true`, {
    method: "DELETE",
  });

  if (result.success) {
    showToast(t("toast-delete-success"), "success");

    state.selectedMemories.delete(id);
    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-delete-failed"), "error");
  }
}

async function bulkDelete() {
  if (state.selectedMemories.size === 0) return;

  const message = t("confirm-bulk-delete", { count: state.selectedMemories.size });
  if (!(await showConfirm(message))) return;

  const ids = Array.from(state.selectedMemories);

  const promptIds = ids.filter((id) => id.startsWith("prompt_"));
  const memoryIds = ids.filter((id) => !id.startsWith("prompt_"));

  let deletedCount = 0;
  let hadErrors = false;

  if (promptIds.length > 0) {
    const result = await fetchAPI("/api/prompts/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: promptIds, cascade: true }),
    });
    if (result.success) {
      deletedCount += result.data.deleted;
    } else {
      hadErrors = true;
      console.error("Bulk delete prompts failed", { error: result.error });
    }
  }

  if (memoryIds.length > 0) {
    const result = await fetchAPI("/api/memories/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: memoryIds, cascade: true }),
    });
    if (result.success) {
      deletedCount += result.data.deleted;
    } else {
      hadErrors = true;
      console.error("Bulk delete memories failed", { error: result.error });
    }
  }

  if (hadErrors) {
    showToast(`${t("toast-bulk-delete-partial")} (${deletedCount} deleted)`, "warning");
  } else {
    showToast(`${t("toast-bulk-delete-success")} (${deletedCount} deleted)`, "success");
  }
  state.selectedMemories.clear();
  await loadMemories();
  await loadStats();
  updateBulkActions();
}

function deselectAll() {
  state.selectedMemories.clear();
  document.querySelectorAll(".memory-checkbox").forEach((cb) => (cb.checked = false));
  document
    .querySelectorAll(".memory-card, .prompt-card")
    .forEach((card) => card.classList.remove("selected"));
  updateBulkActions();
}

function selectAllCurrentPage() {
  const checkboxes = document.querySelectorAll(".memory-checkbox");
  if (checkboxes.length === 0) return;

  checkboxes.forEach((cb) => {
    cb.checked = true;
    if (cb.dataset.id) {
      state.selectedMemories.add(cb.dataset.id);
      updateCardSelection(cb.dataset.id, true);
    }
  });

  updateBulkActions();
}

// skipcq: JS-0128 — Used in HTML template literal: onclick="editMemory(...)"
function editMemory(id) {
  const memory = state.memories.find((m) => m.id === id && m.type === "memory");
  if (!memory) return;

  document.getElementById("edit-id").value = memory.id;
  document.getElementById("edit-content").value = memory.content;

  document.getElementById("edit-modal").classList.remove("hidden");
}

async function saveEdit(e) {
  e.preventDefault();

  const id = document.getElementById("edit-id").value;
  const content = document.getElementById("edit-content").value.trim();

  if (!content) {
    showToast(t("toast-add-error"), "error");
    return;
  }

  const result = await fetchAPI(`/api/memories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (result.success) {
    showToast(t("toast-update-success"), "success");
    closeModal();
    await loadMemories();
  } else {
    showToast(result.error || t("toast-update-failed"), "error");
  }
}

function closeModal() {
  document.getElementById("edit-modal").classList.add("hidden");
}

function performSearch() {
  const query = document.getElementById("search-input").value.trim();

  if (!query) {
    clearSearch();
    return;
  }

  state.searchQuery = query;
  state.isSearching = true;
  state.currentPage = 1;

  document.getElementById("clear-search-btn").classList.remove("hidden");

  loadMemories();
}

function clearSearch() {
  state.searchQuery = "";
  state.isSearching = false;
  state.currentPage = 1;

  document.getElementById("search-input").value = "";
  document.getElementById("clear-search-btn").classList.add("hidden");

  loadMemories();
}

function changePage(delta) {
  const newPage = state.currentPage + delta;
  if (newPage < 1 || newPage > state.totalPages) return;

  state.currentPage = newPage;
  loadMemories();
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

function showError(message) {
  const container = document.getElementById("memories-list");
  container.innerHTML = `<div class="error-state">Error: ${escapeHtml(message)}</div>`;
}

let confirmResolve = null;

function showConfirm(message) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    const modal = document.getElementById("confirm-modal");
    const msgEl = document.getElementById("confirm-modal-message");
    msgEl.textContent = message;
    modal.classList.remove("hidden");
    lucide.createIcons();
  });
}

function closeConfirmModal(result) {
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
  document.getElementById("confirm-modal").classList.add("hidden");
}

function showRefreshIndicator(show) {
  const indicator = document.getElementById("refresh-indicator");
  if (show) {
    indicator.classList.remove("hidden");
  } else {
    indicator.classList.add("hidden");
  }
}

function formatDate(isoString) {
  const date = new Date(isoString);
  const locale = getLanguage() === "zh" ? "zh-CN" : "en-US";
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// skipcq: JS-0128 — Used in HTML template literal: onclick="pinMemory(...)"
async function pinMemory(id) {
  const result = await fetchAPI(`/api/memories/${id}/pin`, { method: "POST" });

  if (result.success) {
    showToast(t("toast-update-success"), "success");
    await loadMemories();
  } else {
    showToast(result.error || t("toast-update-failed"), "error");
  }
}

// skipcq: JS-0128 — Used in HTML template literal: onclick="unpinMemory(...)"
async function unpinMemory(id) {
  const result = await fetchAPI(`/api/memories/${id}/unpin`, { method: "POST" });

  if (result.success) {
    showToast(t("toast-update-success"), "success");
    await loadMemories();
  } else {
    showToast(result.error || t("toast-update-failed"), "error");
  }
}

async function runCleanup() {
  if (!(await showConfirm(t("confirm-cleanup")))) return;

  showToast(t("status-cleanup"), "info");
  const result = await fetchAPI("/api/cleanup", { method: "POST" });

  if (result.success) {
    showToast(t("toast-cleanup-success"), "success");
    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-cleanup-failed"), "error");
  }
}

async function runDeduplication() {
  if (!(await showConfirm(t("confirm-dedup")))) return;

  showToast(t("status-dedup"), "info");
  const result = await fetchAPI("/api/deduplicate", { method: "POST" });

  if (result.success) {
    showToast(t("toast-dedup-success"), "success");
    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-dedup-failed"), "error");
  }
}

function startAutoRefresh() {
  if (state.autoRefreshInterval) {
    clearInterval(state.autoRefreshInterval);
  }

  state.autoRefreshInterval = setInterval(() => {
    loadStats();
    if (!state.isSearching) {
      loadMemories();
    }
  }, 30000);
}

async function checkMigrationStatus() {
  const result = await fetchAPI("/api/migration/detect");
  if (result.success && result.data.needsMigration) {
    showMigrationWarning(result.data);
  }

  const tagResult = await fetchAPI("/api/migration/tags/detect");
  if (tagResult.success && tagResult.data.needsMigration) {
    showTagMigrationModal(tagResult.data.count);
  }
}

function showTagMigrationModal(count) {
  const overlay = document.getElementById("tag-migration-overlay");
  const status = document.getElementById("tag-migration-status");
  overlay.classList.remove("hidden");
  status.textContent = t("migration-found-tags", { count });

  document.getElementById("start-tag-migration-btn").onclick = runTagMigration;
}

async function runTagMigration() {
  const actions = document.getElementById("tag-migration-actions");
  const status = document.getElementById("tag-migration-status");
  const progress = document.getElementById("tag-migration-progress");

  actions.classList.add("hidden");
  status.textContent = t("status-migration-init");
  progress.style.width = "0%";

  let totalProcessed = 0;
  let hasMore = true;
  let attempts = 0;
  const maxAttempts = 1000;

  while (hasMore && attempts < maxAttempts) {
    attempts++;
    const result = await fetchAPI("/api/migration/tags/run-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchSize: 3 }),
    });

    if (!result.success) {
      status.textContent = `${t("toast-migration-failed")}: ${result.error}`;
      return;
    }

    totalProcessed = result.data.processed;
    hasMore = result.data.hasMore;
    const total = result.data.total;
    const percent = total > 0 ? Math.round((totalProcessed / total) * 100) : 0;

    progress.style.width = `${percent}%`;
    status.textContent = t("status-migration-progress", { current: totalProcessed, total });
    if (hasMore) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  if (attempts >= maxAttempts) {
    status.textContent = t("migration-stopped");
    return;
  }

  progress.style.width = "100%";
  status.textContent = t("toast-migration-success");
  showToast(t("toast-migration-success"), "success");
  setTimeout(() => {
    document.getElementById("tag-migration-overlay").classList.add("hidden");
    loadMemories();
    loadStats();
  }, 2000);
}

function showMigrationWarning(data) {
  const section = document.getElementById("migration-section");
  const message = document.getElementById("migration-message");
  section.classList.remove("hidden");

  const shardInfo =
    data.shardMismatches.length > 0
      ? t("migration-shards-mismatch", { count: data.shardMismatches.length })
      : t("migration-dimension-mismatch");

  message.textContent = t("migration-mismatch-details", {
    configDimensions: data.configDimensions,
    configModel: data.configModel,
    shardInfo,
  });

  lucide.createIcons();
}

function toggleMigrationButtons() {
  const checkbox = document.getElementById("migration-confirm-checkbox");
  const freshBtn = document.getElementById("migration-fresh-btn");
  const reembedBtn = document.getElementById("migration-reembed-btn");

  freshBtn.disabled = !checkbox.checked;
  reembedBtn.disabled = !checkbox.checked;
}

async function runMigration(strategy) {
  const checkbox = document.getElementById("migration-confirm-checkbox");

  if (!checkbox.checked) {
    showToast(t("toast-migration-failed"), "error");
    return;
  }

  const strategyName =
    strategy === "fresh-start" ? "Fresh Start (Delete All)" : "Re-embed (Preserve Data)";

  const migrationConfirmMessage = `Run ${strategyName} migration?\n\nThis operation is IRREVERSIBLE and will:\n${strategy === "fresh-start" ? "- DELETE all existing memories\n- Remove all shards" : "- Re-embed all memories with new model\n- This may take several minutes"}\n\nContinue?`;
  if (!(await showConfirm(migrationConfirmMessage))) {
    return;
  }

  showToast(t("status-migration-init"), "info");
  const result = await fetchAPI("/api/migration/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy }),
  });

  if (result.success) {
    const data = result.data;
    const duration = (data.duration / 1000).toFixed(2);
    const message =
      strategy === "fresh-start"
        ? `Deleted ${data.deletedShards} shard(s). Duration: ${duration}s`
        : `Re-embedded ${data.reEmbeddedMemories} memories. Duration: ${duration}s`;

    showToast(`${t("toast-migration-success")} ${message}`, "success");
    document.getElementById("migration-section").classList.add("hidden");
    document.getElementById("migration-confirm-checkbox").checked = false;

    await loadMemories();
    await loadStats();
  } else {
    showToast(result.error || t("toast-migration-failed"), "error");
  }
}

async function loadUserProfile() {
  const result = await fetchAPI("/api/user-profile");
  if (result.success) {
    state.userProfile = result.data;
    renderUserProfile();
  } else {
    showError(result.error || t("toast-update-failed"));
  }
}

function generateRadarChartSVG(data, size = 300) {
  if (!data || data.length < 3)
    return `<div class="empty-state">Not enough data for chart (need at least 3 dimensions)</div>`;

  const center = size / 2;
  const radius = (size / 2) * 0.8;
  const numAxes = data.length;
  const angleStep = (Math.PI * 2) / numAxes;

  // Calculate points for polygon
  const polygonPoints = data
    .map((d, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const value = Math.max(0, Math.min(1, d.value)); // normalized 0-1
      const x = center + radius * value * Math.cos(angle);
      const y = center + radius * value * Math.sin(angle);
      return `${x},${y}`;
    })
    .join(" ");

  // Generate grid levels
  const levels = [0.2, 0.4, 0.6, 0.8, 1.0];
  const gridHTML = levels
    .map((level) => {
      const points = data
        .map((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const x = center + radius * level * Math.cos(angle);
          const y = center + radius * level * Math.sin(angle);
          return `${x},${y}`;
        })
        .join(" ");
      return `<polygon points="${points}" fill="none" stroke="#ccc" stroke-dasharray="3,3" />`;
    })
    .join("");

  // Generate axes and labels
  const axesHTML = data
    .map((d, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const x2 = center + radius * Math.cos(angle);
      const y2 = center + radius * Math.sin(angle);

      // Label position slightly outside
      const lx = center + (radius + 20) * Math.cos(angle);
      const ly = center + (radius + 20) * Math.sin(angle);

      const textAnchor = lx > center + 10 ? "start" : lx < center - 10 ? "end" : "middle";

      return `
      <line x1="${center}" y1="${center}" x2="${x2}" y2="${y2}" stroke="#ccc" />
      <text x="${lx}" y="${ly}" text-anchor="${textAnchor}" alignment-baseline="middle" font-size="12" fill="#666">${escapeHtml(d.label)}</text>
    `;
    })
    .join("");

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${gridHTML}
      ${axesHTML}
      <polygon points="${polygonPoints}" fill="rgba(59, 130, 246, 0.3)" stroke="#3b82f6" stroke-width="2" />
      ${data
        .map((d, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const value = Math.max(0, Math.min(1, d.value));
          const x = center + radius * value * Math.cos(angle);
          const y = center + radius * value * Math.sin(angle);
          return `<circle cx="${x}" cy="${y}" r="4" fill="#3b82f6" />`;
        })
        .join("")}
    </svg>
  `;
}

function renderUserProfile() {
  const container = document.getElementById("profile-content");
  const profile = state.userProfile;

  if (!profile?.exists) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="user-x" class="icon-large"></i>
        <p>${escapeHtml(profile ? profile.message : "No profile data available")}</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  let data = profile.profileData;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.error("Failed to parse profileData string", e);
    }
  }

  const parseField = (field) => {
    if (!field) return [];
    let result = field;
    let lastResult = null;
    while (typeof result === "string" && result !== lastResult) {
      lastResult = result;
      try {
        result = JSON.parse(typeof jsonrepair === "function" ? jsonrepair(result) : result);
      } catch {
        break;
      }
    }
    if (!Array.isArray(result)) return [];
    const flattened = [];
    const walk = (item) => {
      if (Array.isArray(item)) item.forEach(walk);
      else if (item && typeof item === "object") flattened.push(item);
    };
    walk(result);
    return flattened;
  };

  const preferences = parseField(data.preferences);
  const patterns = parseField(data.patterns);
  const workflows = parseField(data.workflows);

  let preferencesHtml;
  if (preferences.length === 0) {
    preferencesHtml = `<p class="empty-text">${t("empty-preferences")}</p>`;
  } else {
    preferencesHtml = `
          <div class="cards-grid">
            ${preferences
              .toSorted((a, b) => (b.confidence || 0) - (a.confidence || 0))
              .map(
                (p) => `
              <div class="compact-card preference-card">
                <div class="card-top">
                  <span class="category-tag">${escapeHtml(p.category || "General")}</span>
                  <div class="confidence-ring" style="--p:${Math.round((p.confidence || 0) * 100)}">
                    <span>${Math.round((p.confidence || 0) * 100)}%</span>
                  </div>
                </div>
                <div class="card-body">
                  <p class="card-text">${escapeHtml(p.description || "")}</p>
                </div>
                ${
                  p.evidence && p.evidence.length > 0
                    ? `
                <div class="card-footer">
                  <span class="evidence-toggle" title="${escapeHtml(Array.isArray(p.evidence) ? p.evidence.join("\n") : p.evidence)}">
                    <i data-lucide="info" class="icon-xs"></i> ${Array.isArray(p.evidence) ? p.evidence.length : 1} evidence
                  </span>
                </div>`
                    : ""
                }
              </div>
            `
              )
              .join("")}
          </div>
        `;
  }

  let patternsHtml;
  if (patterns.length === 0) {
    patternsHtml = `<p class="empty-text">${t("empty-patterns")}</p>`;
  } else {
    patternsHtml = `
          <div class="cards-grid">
            ${patterns
              .map(
                (p) => `
              <div class="compact-card pattern-card">
                <div class="card-top">
                  <span class="category-tag">${escapeHtml(p.category || "General")}</span>
                </div>
                <div class="card-body">
                  <p class="card-text">${escapeHtml(p.description || "")}</p>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        `;
  }

  let workflowsHtml;
  if (workflows.length === 0) {
    workflowsHtml = `<p class="empty-text">${t("empty-workflows")}</p>`;
  } else {
    workflowsHtml = `
          <div class="workflows-grid">
            ${workflows
              .map(
                (w) => `
              <div class="workflow-row">
                <div class="workflow-title">${escapeHtml(w.description || "")}</div>
                <div class="workflow-steps-horizontal">
                  ${(w.steps || [])
                    .map(
                      (step, i) => `
                    <div class="step-node">
                      <span class="step-idx">${i + 1}</span>
                      <span class="step-content">${escapeHtml(step)}</span>
                    </div>
                    ${i < (w.steps || []).length - 1 ? '<i data-lucide="arrow-right" class="step-arrow"></i>' : ""}
                  `
                    )
                    .join("")}
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        `;
  }

  container.innerHTML = `
    <div class="profile-header">
      <div class="profile-info">
        <h3>${escapeHtml(profile.displayName || profile.userId)}</h3>
        <div class="profile-stats">
          <div class="stat-pill">
            <span class="label">${t("profile-version")}</span>
            <span class="value">${profile.version}</span>
          </div>
          <div class="stat-pill">
            <span class="label">${t("profile-prompts")}</span>
            <span class="value">${profile.totalPromptsAnalyzed}</span>
          </div>
          <div class="stat-pill">
            <span class="label">${t("profile-updated")}</span>
            <span class="value">${formatDate(profile.lastAnalyzedAt)}</span>
          </div>
        </div>
      </div>
      <button id="view-changelog-btn" class="btn-secondary compact">
        <i data-lucide="history" class="icon"></i> History
      </button>
    </div>

    <div class="dashboard-grid">
      <div class="dashboard-section radar-chart-section">
        <h4><i data-lucide="pie-chart" class="icon"></i> Behavioral Dimensions</h4>
        <div class="radar-chart-container" style="display: flex; justify-content: center; padding: 20px 0;">
          ${preferences.length >= 3 ? generateRadarChartSVG(preferences.map((p) => ({ label: p.category, value: p.confidence }))) : '<div class="empty-state">Not enough preference categories to chart</div>'}
        </div>
      </div>

      <div class="dashboard-section preferences-section">
        <h4><i data-lucide="heart" class="icon"></i> ${t("profile-preferences")} <span class="count">${preferences.length}</span></h4>
        ${preferencesHtml}
      </div>

      <div class="dashboard-section patterns-section">
        <h4><i data-lucide="activity" class="icon"></i> ${t("profile-patterns")} <span class="count">${patterns.length}</span></h4>
        ${patternsHtml}
      </div>

      <div class="dashboard-section workflows-section full-width">
        <h4><i data-lucide="workflow" class="icon"></i> ${t("profile-workflows")} <span class="count">${workflows.length}</span></h4>
        ${workflowsHtml}
      </div>
    </div>
  `;

  document.getElementById("view-changelog-btn")?.addEventListener("click", showChangelog);
  lucide.createIcons();
}

async function showChangelog() {
  const modal = document.getElementById("changelog-modal");
  const list = document.getElementById("changelog-list");

  modal.classList.remove("hidden");
  list.innerHTML = `<div class="loading">${t("loading-changelog")}</div>`;
  const result = await fetchAPI(
    `/api/user-profile/changelog?profileId=${state.userProfile.id}&limit=10`
  );

  if (result.success && result.data.length > 0) {
    list.innerHTML = result.data
      .map(
        (c) => `
      <div class="changelog-item">
        <div class="changelog-header">
          <span class="changelog-version">v${c.version}</span>
          <span class="changelog-type">${c.changeType}</span>
          <span class="changelog-date">${formatDate(c.createdAt)}</span>
        </div>
        <p class="changelog-summary">${escapeHtml(c.changeSummary)}</p>
      </div>
    `
      )
      .join("");
  } else {
    list.innerHTML = `<div class="empty-state">${t("empty-changelog")}</div>`;
  }
}

async function refreshProfile() {
  showToast(t("loading-profile"), "info");
  const result = await fetchAPI("/api/user-profile/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (result.success) {
    showToast(result.data.message, "success");
    await loadUserProfile();
  } else {
    showToast(result.error || t("toast-update-failed"), "error");
  }
}

function switchView(view) {
  state.currentView = view;

  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));

  const sections = ["project", "conflicts", "profile", "transcripts", "timeline"];
  sections.forEach((sec) => {
    const el = document.getElementById(`${sec}-section`);
    if (el) {
      if (sec === view) el.classList.remove("hidden");
      else el.classList.add("hidden");
    }
  });

  const controls = document.querySelector(".controls");
  const addSection = document.querySelector(".add-section");

  if (view === "project") {
    document.getElementById("tab-project").classList.add("active");
    if (controls) controls.classList.remove("hidden");
    if (addSection) addSection.classList.remove("hidden");
  } else {
    if (controls) controls.classList.add("hidden");
    if (addSection) addSection.classList.add("hidden");
  }

  if (view === "conflicts") {
    document.getElementById("tab-conflicts").classList.add("active");
    loadConflicts();
  } else if (view === "profile") {
    document.getElementById("tab-profile").classList.add("active");
    loadUserProfile();
  } else if (view === "transcripts") {
    document.getElementById("tab-transcripts").classList.add("active");
    loadTranscripts();
  } else if (view === "timeline") {
    document.getElementById("tab-timeline").classList.add("active");
    loadTimeline();
  }
}

async function loadConflicts() {
  const list = document.getElementById("conflicts-list");
  list.innerHTML = '<div class="loading">Loading conflicts...</div>';

  const result = await fetchAPI("/api/conflicts");
  const statsResult = await fetchAPI("/api/conflicts/stats");

  if (statsResult.success) {
    const stats = document.getElementById("conflicts-stats");
    stats.innerHTML = `
      <div class="conflict-stat-pill">
        <span class="label">Unresolved:</span>
        <span class="value ${statsResult.data.unresolved > 0 ? "warning" : ""}">${statsResult.data.unresolved}</span>
      </div>
      <div class="conflict-stat-pill">
        <span class="label">Resolved:</span>
        <span class="value">${statsResult.data.resolved}</span>
      </div>
    `;
    // Update badge
    const badge = document.getElementById("conflict-badge");
    if (statsResult.data.unresolved > 0) {
      badge.textContent = statsResult.data.unresolved;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  if (result.success) {
    state.conflicts = result.data;
    renderConflicts();
  } else {
    list.innerHTML = `<div class="error-state">Error: ${escapeHtml(result.error || "Failed to load conflicts")}</div>`;
  }
}

function renderConflicts() {
  const container = document.getElementById("conflicts-list");

  if (state.conflicts.length === 0) {
    container.innerHTML = '<div class="empty-state">No unresolved conflicts found. Great!</div>';
    return;
  }

  container.innerHTML = state.conflicts
    .map(
      (c) => `
    <div class="conflict-card" data-id="${c.id}">
      <div class="conflict-header">
        <span class="badge badge-conflict"><i data-lucide="alert-triangle" class="icon-sm"></i> CONFLICT</span>
        <span class="similarity-score">${Math.round(c.similarityScore * 100)}% similarity</span>
        <span class="conflict-date">${formatDate(c.detectedAt)}</span>
      </div>
      <div class="conflict-memories">
        <div class="conflict-memory">
          <div class="conflict-label">Memory A</div>
          <div class="conflict-content">${escapeHtml(c.memory1Content || "N/A")}</div>
        </div>
        <div class="conflict-divider">
          <i data-lucide="arrow-right-left" class="icon"></i>
        </div>
        <div class="conflict-memory">
          <div class="conflict-label">Memory B</div>
          <div class="conflict-content">${escapeHtml(c.memory2Content || "N/A")}</div>
        </div>
      </div>
      <div class="conflict-actions">
        <button class="btn-resolve" onclick="resolveConflictAction('${escapeJsString(c.id)}', 'keep_newer')">
          <i data-lucide="check" class="icon"></i> Keep Newer
        </button>
        <button class="btn-resolve" onclick="resolveConflictAction('${escapeJsString(c.id)}', 'keep_both')">
          <i data-lucide="git-merge" class="icon"></i> Keep Both
        </button>
        <button class="btn-resolve" onclick="showMergeModal('${escapeJsString(c.id)}')">
          <i data-lucide="combine" class="icon"></i> Merge
        </button>
        <button class="btn-resolve btn-manual" onclick="resolveConflictAction('${escapeJsString(c.id)}', 'manual')">
          <i data-lucide="flag" class="icon"></i> Flag for Review
        </button>
      </div>
    </div>
  `
    )
    .join("");

  lucide.createIcons();
}

// skipcq: JS-0128 — Used in HTML template literal: onclick="resolveConflictAction(...)"
async function resolveConflictAction(conflictId, strategy) {
  if (strategy === "merge") return;

  const result = await fetchAPI(`/api/conflicts/${conflictId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy }),
  });

  if (result.success) {
    showToast("Conflict resolved", "success");
    await loadConflicts();
    await loadStats();
  } else {
    showToast(result.error || "Failed to resolve conflict", "error");
  }
}

// skipcq: JS-0128 — Used in HTML template literal: onclick="showMergeModal(...)"
function showMergeModal(conflictId) {
  const conflict = state.conflicts.find((c) => c.id === conflictId);
  if (!conflict) return;

  const modal = document.getElementById("merge-modal");
  document.getElementById("merge-conflict-id").value = conflictId;
  document.getElementById("merge-content").value =
    `${conflict.memory1Content}\n\n---\n\n${conflict.memory2Content}`;
  modal.classList.remove("hidden");
}

function closeMergeModal() {
  document.getElementById("merge-modal").classList.add("hidden");
}

async function submitMerge(e) {
  e.preventDefault();
  const conflictId = document.getElementById("merge-conflict-id").value;
  const mergedContent = document.getElementById("merge-content").value.trim();

  if (!mergedContent) {
    showToast("Merged content is required", "error");
    return;
  }

  const result = await fetchAPI(`/api/conflicts/${conflictId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy: "merge", mergedContent }),
  });

  if (result.success) {
    showToast("Conflicts merged successfully", "success");
    closeMergeModal();
    await loadConflicts();
    await loadStats();
  } else {
    showToast(result.error || "Failed to merge conflicts", "error");
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeJsString(str) {
  return str.replace(/[\\'"]/g, "\\$&");
}

async function loadTranscripts() {
  const container = document.getElementById("transcripts-list");
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading transcripts...</div>';

  try {
    const result = await fetchAPI(`/api/transcripts/search?limit=20&page=${state.transcriptsPage}`);

    if (result.success) {
      state.transcripts = result.data.transcripts;
      state.transcriptsTotalItems = result.data.total;
      state.transcriptsTotalPages = result.data.totalPages || 1;
      renderTranscripts();
      updateTranscriptsPagination();
    } else {
      container.innerHTML = `<div class="error-state">Error: ${escapeHtml(result.error || "Failed to load transcripts")}</div>`;
    }
  } catch (error) {
    container.innerHTML = `<div class="error-state">Error: ${escapeHtml(String(error))}</div>`;
  }
}

function renderTranscripts() {
  const container = document.getElementById("transcripts-list");

  if (!state.transcripts || state.transcripts.length === 0) {
    container.innerHTML = '<div class="empty-state">No transcripts found.</div>';
    return;
  }

  container.innerHTML = state.transcripts
    .map((t) => {
      let preview = "";
      try {
        const msgs = JSON.parse(t.messages);
        if (Array.isArray(msgs) && msgs.length > 0) {
          preview = msgs
            .slice(0, 2)
            .map(
              (m) =>
                `<strong>${escapeHtml(m.role || "unknown")}:</strong> ${escapeHtml(typeof m.content === "string" ? m.content.substring(0, 200) : "...")}`
            )
            .join("<br/>");
          if (msgs.length > 2) preview += "<br/><em>...more...</em>";
        }
      } catch (e) {
        preview = escapeHtml(t.messages.substring(0, 200));
      }

      return `
      <div class="memory-card">
        <div class="memory-header">
          <span class="badge badge-feature"><i data-lucide="file-text" class="icon-sm"></i> SESSION ${escapeHtml(t.sessionId || "unknown")}</span>
          <span class="memory-date">${formatDate(t.createdAt)}</span>
        </div>
        <div class="memory-content markdown-body">
          ${preview}
        </div>
      </div>
    `;
    })
    .join("");

  lucide.createIcons();
}

function updateTranscriptsPagination() {
  const prevBtn = document.getElementById("prev-page-transcripts");
  const nextBtn = document.getElementById("next-page-transcripts");
  const pageInfo = document.getElementById("page-info-transcripts");

  if (!prevBtn || !nextBtn || !pageInfo) return;

  prevBtn.disabled = state.transcriptsPage <= 1;
  nextBtn.disabled = state.transcriptsPage >= state.transcriptsTotalPages;
  pageInfo.textContent = `Page ${state.transcriptsPage} of ${state.transcriptsTotalPages}`;
}

async function loadTimeline() {
  const container = document.getElementById("timeline-content");
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading timeline...</div>';

  try {
    const result = await fetchAPI(`/api/memories?page=1&pageSize=100&includePrompts=false`);
    if (result.success) {
      const items = result.data.items;
      if (items.length === 0) {
        container.innerHTML = '<div class="empty-state">No timeline events found.</div>';
        return;
      }

      // Group by day
      const groups = {};
      items.forEach((item) => {
        const date = new Date(item.createdAt || item.timestamp);
        const day = date.toLocaleDateString();
        if (!groups[day]) groups[day] = [];
        groups[day].push(item);
      });

      let html = '<div class="timeline-container">';
      Object.keys(groups)
        .sort((a, b) => new Date(b) - new Date(a))
        .forEach((day) => {
          html += `<div class="timeline-day">
          <h3 class="timeline-date">${escapeHtml(day)}</h3>
          <div class="timeline-events">`;
          groups[day].forEach((item) => {
            html += `
            <div class="timeline-event">
              <div class="timeline-time">${new Date(item.createdAt || item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              <div class="timeline-marker"></div>
              <div class="timeline-detail">
                <span class="badge badge-${item.type || "other"}">${escapeHtml(item.type || "other")}</span>
                <p>${escapeHtml(item.content)}</p>
              </div>
            </div>
          `;
          });
          html += `</div></div>`;
        });
      html += "</div>";

      container.innerHTML = html;
    } else {
      container.innerHTML = `<div class="error-state">Error: ${escapeHtml(result.error || "Failed to load timeline")}</div>`;
    }
  } catch (error) {
    container.innerHTML = `<div class="error-state">Error: ${escapeHtml(String(error))}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("tab-project").addEventListener("click", () => switchView("project"));
  document.getElementById("tab-conflicts").addEventListener("click", () => switchView("conflicts"));
  document.getElementById("tab-profile").addEventListener("click", () => switchView("profile"));
  document
    .getElementById("tab-transcripts")
    ?.addEventListener("click", () => switchView("transcripts"));
  document.getElementById("tab-timeline")?.addEventListener("click", () => switchView("timeline"));
  document.getElementById("refresh-profile-btn")?.addEventListener("click", refreshProfile);
  document.getElementById("refresh-conflicts-btn")?.addEventListener("click", loadConflicts);
  document.getElementById("changelog-close")?.addEventListener("click", () => {
    document.getElementById("changelog-modal").classList.add("hidden");
  });

  document.getElementById("prev-page-transcripts")?.addEventListener("click", () => {
    if (state.transcriptsPage > 1) {
      state.transcriptsPage--;
      loadTranscripts();
    }
  });

  document.getElementById("next-page-transcripts")?.addEventListener("click", () => {
    if (state.transcriptsPage < state.transcriptsTotalPages) {
      state.transcriptsPage++;
      loadTranscripts();
    }
  });

  document.getElementById("edit-profile-btn")?.addEventListener("click", () => {
    if (!state.userProfile || !state.userProfile.profileData) return;
    document.getElementById("edit-profile-modal").classList.remove("hidden");
    document.getElementById("edit-profile-content").value = JSON.stringify(
      state.userProfile.profileData,
      null,
      2
    );
  });

  document.getElementById("edit-profile-close")?.addEventListener("click", () => {
    document.getElementById("edit-profile-modal").classList.add("hidden");
  });

  document.getElementById("cancel-edit-profile")?.addEventListener("click", () => {
    document.getElementById("edit-profile-modal").classList.add("hidden");
  });

  document.getElementById("format-profile-json")?.addEventListener("click", () => {
    try {
      const content = document.getElementById("edit-profile-content").value;
      const parsed = jsonrepair(content);
      const formatted = JSON.stringify(JSON.parse(parsed), null, 2);
      document.getElementById("edit-profile-content").value = formatted;
    } catch (e) {
      showToast("Invalid JSON to format", "error");
    }
  });

  document.getElementById("edit-profile-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    let parsedData;
    try {
      const content = document.getElementById("edit-profile-content").value;
      parsedData = JSON.parse(jsonrepair(content));
    } catch (err) {
      showToast("Invalid JSON format", "error");
      return;
    }

    const result = await fetchAPI("/api/user-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: state.userProfile.userId, profileData: parsedData }),
    });

    if (result.success) {
      showToast("Profile updated successfully", "success");
      document.getElementById("edit-profile-modal").classList.add("hidden");
      loadUserProfile();
    } else {
      showToast(result.error || "Failed to update profile", "error");
    }
  });

  document.getElementById("lang-toggle").addEventListener("click", () => {
    const newLang = getLanguage() === "en" ? "zh" : "en";
    setLanguage(newLang);
    document.getElementById("lang-toggle").textContent = newLang.toUpperCase();
    // Re-render dynamic content
    loadMemories();
    loadStats();
    if (state.currentView === "profile") loadUserProfile();
  });

  document.getElementById("lang-toggle").textContent = getLanguage().toUpperCase();

  document.getElementById("tag-filter").addEventListener("change", () => {
    state.selectedTag = document.getElementById("tag-filter").value;
    state.currentPage = 1;
    state.isSearching = false;
    state.searchQuery = "";
    document.getElementById("search-input").value = "";
    document.getElementById("clear-search-btn").classList.add("hidden");
    loadMemories();
  });

  document.getElementById("search-btn").addEventListener("click", performSearch);
  document.getElementById("clear-search-btn").addEventListener("click", clearSearch);
  document.getElementById("search-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") performSearch();
  });

  document.getElementById("add-form").addEventListener("submit", addMemory);
  document.getElementById("edit-form").addEventListener("submit", saveEdit);
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("cancel-edit").addEventListener("click", closeModal);

  document.getElementById("prev-page-top").addEventListener("click", () => changePage(-1));
  document.getElementById("next-page-top").addEventListener("click", () => changePage(1));
  document.getElementById("prev-page-bottom").addEventListener("click", () => changePage(-1));
  document.getElementById("next-page-bottom").addEventListener("click", () => changePage(1));

  document.getElementById("bulk-delete-btn").addEventListener("click", bulkDelete);
  document.getElementById("select-all-btn").addEventListener("click", selectAllCurrentPage);
  document.getElementById("deselect-all-btn").addEventListener("click", deselectAll);

  document.getElementById("cleanup-btn").addEventListener("click", runCleanup);
  document.getElementById("deduplicate-btn").addEventListener("click", runDeduplication);

  document
    .getElementById("migration-confirm-checkbox")
    .addEventListener("change", toggleMigrationButtons);
  document
    .getElementById("migration-fresh-btn")
    .addEventListener("click", () => runMigration("fresh-start"));
  document
    .getElementById("migration-reembed-btn")
    .addEventListener("click", () => runMigration("re-embed"));

  document.getElementById("edit-modal").addEventListener("click", (e) => {
    if (e.target.id === "edit-modal") closeModal();
  });

  document.getElementById("merge-form")?.addEventListener("submit", submitMerge);
  document.getElementById("merge-modal-close")?.addEventListener("click", closeMergeModal);
  document.getElementById("cancel-merge")?.addEventListener("click", closeMergeModal);
  document.getElementById("merge-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "merge-modal") closeMergeModal();
  });

  document
    .getElementById("confirm-modal-ok")
    ?.addEventListener("click", () => closeConfirmModal(true));
  document
    .getElementById("confirm-modal-cancel")
    ?.addEventListener("click", () => closeConfirmModal(false));
  document
    .getElementById("confirm-modal-close")
    ?.addEventListener("click", () => closeConfirmModal(false));
  document.getElementById("confirm-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "confirm-modal") closeConfirmModal(false);
  });

  await loadTags();
  await loadMemories();
  await loadStats();
  await checkMigrationStatus();

  startAutoRefresh();

  lucide.createIcons();
});
