const translations = {
  en: {
    title: "OpenCode Memory Dashboard",
    "nav-dashboard": "Dashboard",
    "nav-memories": "Memories",
    "nav-search": "Search",
    "nav-timeline": "Timeline",
    "nav-profile": "Profile",
    "nav-maintenance": "Maintenance",
    "nav-conflicts": "Conflicts",
    "nav-settings": "Settings",
    "aria-theme-toggle": "Toggle theme",
    "aria-lang-toggle": "Toggle language",
    "aria-menu-toggle": "Toggle navigation menu",
    "label-tag": "Tag:",
    "label-content": "Content:",
    "label-semantic-query": "Semantic query",
    "label-api-key": "API key",
    "label-page-size": "Page size",
    "btn-add-memory": "Add Memory",
    "btn-search": "Search",
    "btn-edit": "Edit",
    "btn-pin": "Pin",
    "btn-unpin": "Unpin",
    "btn-delete": "Delete",
    "btn-cancel": "Cancel",
    "btn-save": "Save Changes",
    "btn-refresh": "Refresh",
    "btn-bulk-delete": "Delete Selected",
    "btn-deselect": "Deselect",
    "btn-keep-newer": "Keep Newer",
    "btn-keep-older": "Keep Older",
    "btn-merge": "Merge",
    "btn-run-cleanup": "Run Cleanup",
    "btn-run-dedup": "Run Deduplication",
    "btn-run-migration": "Run Migration",
    "btn-run-tag-migration": "Run Tag Migration",
    "opt-all-tags": "All Tags",
    "opt-none": "None",
    "placeholder-content": "Enter memory content...",
    "placeholder-semantic": "Describe what you are looking for...",
    "placeholder-api-key": "Web server API key",
    "modal-add-memory": "Add Memory",
    "modal-edit-memory": "Edit Memory",
    "maint-cleanup": "Cleanup",
    "maint-dedup": "Deduplicate",
    "maint-migration": "Migrate",
    "desc-cleanup":
      "Remove memories that are no longer relevant based on the configured retention policy.",
    "desc-dedup": "Merge duplicate or highly similar memories to reduce noise.",
    "desc-migration": "Re-vectorize memories or migrate legacy tags when the schema changes.",
    "dash-stats": "[+] Dashboard Stats",
    "dash-recent": "[+] Recent Memories",
    "dash-profile": "[+] Profile Snapshot",
    "stat-total-memories": "Total Memories",
    "stat-total-prompts": "Total Prompts",
    "stat-total-tags": "Total Tags",
    "stat-total-transcripts": "Transcripts",
    "memories-title": "[+] Memories",
    "search-title": "[+] Semantic Search",
    "timeline-title": "[+] Timeline",
    "profile-title": "[+] User Profile",
    "profile-changelog": "Profile Changelog",
    "profile-preferences": "PREFERENCES",
    "profile-patterns": "PATTERNS",
    "profile-workflows": "WORKFLOWS",
    "profile-anonymous": "Anonymous user",
    "settings-title": "[+] Settings",
    "maintenance-title": "[+] Maintenance",
    "conflicts-title": "[+] Conflicts",
    "stat-unresolved": "Unresolved",
    "stat-total-conflicts": "Total Conflicts",
    "conflict-unresolved": "UNRESOLVED",
    "empty-memories": "No memories found",
    "empty-search": "No results found",
    "empty-search-prompt": "Enter a query above to search memories",
    "empty-timeline": "No transcript entries yet",
    "empty-preferences": "No preferences learned yet",
    "empty-patterns": "No patterns detected yet",
    "empty-workflows": "No workflows identified yet",
    "empty-changelog": "No changelog available",
    "empty-conflicts": "No unresolved conflicts",
    loading: "Loading...",
    "error-content-required": "Content is required",
    "error-save-failed": "Failed to save",
    "error-delete-failed": "Failed to delete",
    "error-search-failed": "Search failed",
    "error-action-failed": "Action failed",
    "toast-memory-added": "Memory added",
    "toast-memory-updated": "Memory updated",
    "toast-memory-deleted": "Memory deleted",
    "toast-bulk-deleted": "Selected memories deleted",
    "toast-pinned": "Memory pinned",
    "toast-unpinned": "Memory unpinned",
    "toast-cleanup-done": "Cleanup completed",
    "toast-dedup-done": "Deduplication completed",
    "toast-migration-done": "Migration completed",
    "toast-tag-migration-done": "Tag migration completed",
    "toast-conflict-resolved": "Conflict resolved",
    "toast-profile-refreshed": "Profile refreshed",
    "toast-settings-saved": "Settings saved",
    "confirm-delete-memory": "Delete this memory?",
    "confirm-bulk-delete": "Delete {count} selected memories?",
    "confirm-cleanup": "Run cleanup? This may remove old memories.",
    "confirm-dedup": "Run deduplication? This merges similar memories.",
    "confirm-migration": "Run migration? This may change stored data.",
    "confirm-tag-migration": "Run tag migration?",
    "prompt-merge-content": "Enter merged content:",
    "prompt-api-key": "Enter web server API key:",
    "pagination-page": "Page {page} of {total}",
  },
  zh: {
    title: "OpenCode Memory Dashboard",
    "nav-dashboard": "仪表盘",
    "nav-memories": "记忆",
    "nav-search": "搜索",
    "nav-timeline": "时间线",
    "nav-profile": "画像",
    "nav-maintenance": "维护",
    "nav-conflicts": "冲突",
    "nav-settings": "设置",
    "aria-theme-toggle": "切换主题",
    "aria-lang-toggle": "切换语言",
    "aria-menu-toggle": "切换导航菜单",
    "label-tag": "标签:",
    "label-content": "内容:",
    "label-semantic-query": "语义查询",
    "label-api-key": "API 密钥",
    "label-page-size": "每页数量",
    "btn-add-memory": "添加记忆",
    "btn-search": "搜索",
    "btn-edit": "编辑",
    "btn-pin": "置顶",
    "btn-unpin": "取消置顶",
    "btn-delete": "删除",
    "btn-cancel": "取消",
    "btn-save": "保存更改",
    "btn-refresh": "刷新",
    "btn-bulk-delete": "删除选中",
    "btn-deselect": "取消选中",
    "btn-keep-newer": "保留较新",
    "btn-keep-older": "保留较旧",
    "btn-merge": "合并",
    "btn-run-cleanup": "运行清理",
    "btn-run-dedup": "运行去重",
    "btn-run-migration": "运行迁移",
    "btn-run-tag-migration": "运行标签迁移",
    "opt-all-tags": "所有标签",
    "opt-none": "无",
    "placeholder-content": "输入记忆内容...",
    "placeholder-semantic": "描述你想查找的内容...",
    "placeholder-api-key": "Web 服务器 API 密钥",
    "modal-add-memory": "添加记忆",
    "modal-edit-memory": "编辑记忆",
    "maint-cleanup": "清理",
    "maint-dedup": "去重",
    "maint-migration": "迁移",
    "desc-cleanup": "根据保留策略移除不再相关的记忆。",
    "desc-dedup": "合并重复或高度相似的记忆，减少噪音。",
    "desc-migration": "在模式变化时重新向量化记忆或迁移旧标签。",
    "dash-stats": "[+] 仪表盘统计",
    "dash-recent": "[+] 最近记忆",
    "dash-profile": "[+] 画像快照",
    "stat-total-memories": "记忆总数",
    "stat-total-prompts": "提示词总数",
    "stat-total-tags": "标签总数",
    "stat-total-transcripts": "会话记录",
    "memories-title": "[+] 记忆",
    "search-title": "[+] 语义搜索",
    "timeline-title": "[+] 时间线",
    "profile-title": "[+] 用户画像",
    "profile-changelog": "画像更新日志",
    "profile-preferences": "偏好设置",
    "profile-patterns": "行为模式",
    "profile-workflows": "工作流程",
    "profile-anonymous": "匿名用户",
    "settings-title": "[+] 设置",
    "maintenance-title": "[+] 维护",
    "conflicts-title": "[+] 冲突",
    "stat-unresolved": "未解决",
    "stat-total-conflicts": "冲突总数",
    "conflict-unresolved": "未解决",
    "empty-memories": "未找到记忆",
    "empty-search": "未找到结果",
    "empty-search-prompt": "在上方输入查询以搜索记忆",
    "empty-timeline": "暂无会话记录",
    "empty-preferences": "尚未学习到偏好设置",
    "empty-patterns": "尚未检测到行为模式",
    "empty-workflows": "尚未识别出工作流程",
    "empty-changelog": "暂无更新日志",
    "empty-conflicts": "没有未解决的冲突",
    loading: "加载中...",
    "error-content-required": "内容为必填项",
    "error-save-failed": "保存失败",
    "error-delete-failed": "删除失败",
    "error-search-failed": "搜索失败",
    "error-action-failed": "操作失败",
    "toast-memory-added": "记忆已添加",
    "toast-memory-updated": "记忆已更新",
    "toast-memory-deleted": "记忆已删除",
    "toast-bulk-deleted": "已删除选中的记忆",
    "toast-pinned": "记忆已置顶",
    "toast-unpinned": "记忆已取消置顶",
    "toast-cleanup-done": "清理完成",
    "toast-dedup-done": "去重完成",
    "toast-migration-done": "迁移完成",
    "toast-tag-migration-done": "标签迁移完成",
    "toast-conflict-resolved": "冲突已解决",
    "toast-profile-refreshed": "画像已刷新",
    "toast-settings-saved": "设置已保存",
    "confirm-delete-memory": "删除这条记忆？",
    "confirm-bulk-delete": "删除选中的 {count} 条记忆？",
    "confirm-cleanup": "运行清理？这可能会移除旧记忆。",
    "confirm-dedup": "运行去重？这会合并相似记忆。",
    "confirm-migration": "运行迁移？这可能会改变存储的数据。",
    "confirm-tag-migration": "运行标签迁移？",
    "prompt-merge-content": "输入合并后的内容：",
    "prompt-api-key": "输入 Web 服务器 API 密钥：",
    "pagination-page": "第 {page} 页，共 {total} 页",
  },
};

function getLanguage() {
  return localStorage.getItem("opencode-mem0-lang") || "en";
}

function setLanguage(lang) {
  localStorage.setItem("opencode-mem0-lang", lang);
  applyLanguage();
}

function t(key, params = {}) {
  const lang = getLanguage();
  let text = translations[lang]?.[key] || translations.en[key] || key;

  for (const [k, v] of Object.entries(params)) {
    text = text.split(`{${k}}`).join(v);
  }

  return text;
}

function applyLanguage() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const translated = t(key);

    // If element has child nodes (like icons), we need to replace only the text nodes
    if (el.children.length > 0) {
      let textNodeFound = false;
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== "") {
          node.textContent = ` ${translated} `;
          textNodeFound = true;
        }
      }
      if (!textNodeFound) {
        el.appendChild(document.createTextNode(` ${translated}`));
      }
    } else {
      el.textContent = translated;
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    el.setAttribute("placeholder", t(key));
  });
}

globalThis.t = t;
globalThis.getLanguage = getLanguage;
globalThis.setLanguage = setLanguage;
globalThis.applyLanguage = applyLanguage;
