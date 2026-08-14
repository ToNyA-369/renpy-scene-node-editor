"use strict";

(function exposeEditorSettings(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEditorSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SETTINGS_VERSION = 12;
  const DEFAULT_SHORTCUTS = Object.freeze({
    undo: "mod+z", save: "mod+s", create: "mod+enter", delete: "mod+backspace", sidebar: "mod+\\",
    cyclePrevious: "mod+shift+left", cycleNext: "mod+shift+right",
    leftPanel: "mod+[", rightPanel: "mod+]", tabNode: "mod+1",
    tabEvents: "mod+2", tabOptions: "mod+3", tabContent: "mod+4",
    tabStats: "mod+5", tabGraph: "mod+6", tabValidation: "mod+7",
    grid: "g", snap: "s", sections: "mod+.", settings: "mod+,",
  });
  const SHORTCUT_LABELS = Object.freeze({
    undo: "返回上一步", save: "立即儲存", create: "新增目前功能項目", delete: "刪除目前功能項目", sidebar: "切換節點列表",
    cyclePrevious: "上一個功能區", cycleNext: "下一個功能區",
    leftPanel: "展開或收合左側欄位", rightPanel: "展開或收合右側欄位",
    tabNode: "前往節點", tabEvents: "前往事件", tabOptions: "前往選項",
    tabContent: "前往演出", tabStats: "前往狀態", tabGraph: "前往關聯圖",
    tabValidation: "前往檢查", grid: "顯示或隱藏格線", snap: "開啟或關閉吸附",
    sections: "展開或收合區塊", settings: "開啟編輯器設定",
  });
  const TAB_SHORTCUT_ACTIONS = Object.freeze({
    tabNode: "node", tabEvents: "events", tabOptions: "options", tabContent: "content",
    tabStats: "stats", tabGraph: "graph", tabValidation: "validation",
  });
  const TAB_ORDER = Object.freeze(["node", "events", "options", "content", "stats", "graph", "validation"]);

  function normalizeTabOrder(value) {
    const saved = Array.isArray(value) ? value.map(String) : [];
    const known = saved.filter((tab, index) => TAB_ORDER.includes(tab) && saved.indexOf(tab) === index);
    return [...known, ...TAB_ORDER.filter((tab) => !known.includes(tab))];
  }

  function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeLanguage(value) {
    if (value === "en" || value === "zh-Hant") return value;
    return "zh-Hant";
  }

  function normalizeEditorSettings(saved = {}) {
    const fallback = {
      version: SETTINGS_VERSION,
      language: "zh-Hant",
      autosave: true,
      autosaveDelay: 700,
      gridSize: 24,
      tabOrder: [...TAB_ORDER],
      shortcuts: { ...DEFAULT_SHORTCUTS },
    };
    try {
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return fallback;
      const savedShortcuts = { ...(saved.shortcuts || {}) };
      const savedVersion = numberValue(saved.version, 1);
      if (savedVersion < 2) {
        if (savedShortcuts.optionElements === "mod+1") savedShortcuts.optionElements = "alt+1";
        if (savedShortcuts.optionInspector === "mod+2") savedShortcuts.optionInspector = "alt+2";
      }
      if (savedVersion < 3 && savedShortcuts.sidebar === "mod+b") savedShortcuts.sidebar = DEFAULT_SHORTCUTS.sidebar;
      if (savedVersion < 4) {
        if (savedShortcuts.sidebar === "mod+|") savedShortcuts.sidebar = DEFAULT_SHORTCUTS.sidebar;
        if (savedShortcuts.cyclePrevious === "mod+alt+left") savedShortcuts.cyclePrevious = DEFAULT_SHORTCUTS.cyclePrevious;
        if (savedShortcuts.cycleNext === "mod+alt+right") savedShortcuts.cycleNext = DEFAULT_SHORTCUTS.cycleNext;
      }
      if (savedVersion < 5) {
        delete savedShortcuts.tabScreens;
        if (savedShortcuts.tabStats === "mod+6") savedShortcuts.tabStats = DEFAULT_SHORTCUTS.tabStats;
        if (savedShortcuts.tabValidation === "mod+7") savedShortcuts.tabValidation = DEFAULT_SHORTCUTS.tabValidation;
      }
      if (savedVersion < 6 && savedShortcuts.tabValidation === "mod+6") {
        savedShortcuts.tabValidation = DEFAULT_SHORTCUTS.tabValidation;
      }
      if (savedVersion < 7) {
        delete savedShortcuts.optionElements;
        delete savedShortcuts.optionInspector;
      }
      if (savedVersion < 8) {
        delete savedShortcuts.optionFormMode;
        delete savedShortcuts.optionCanvasMode;
      }
      const shortcuts = { ...DEFAULT_SHORTCUTS, ...savedShortcuts };
      [...Object.keys(TAB_SHORTCUT_ACTIONS), "create", "delete", "undo"].forEach((action) => {
        const conflictsWithSaved = Object.entries(savedShortcuts)
          .some(([savedAction, value]) => savedAction !== action && value === shortcuts[action]);
        if (!Object.hasOwn(savedShortcuts, action) && conflictsWithSaved) shortcuts[action] = "";
      });
      return {
        version: SETTINGS_VERSION,
        language: normalizeLanguage(saved.language),
        autosave: saved.autosave !== false,
        autosaveDelay: Math.max(200, numberValue(saved.autosaveDelay, fallback.autosaveDelay)),
        gridSize: Math.max(4, Math.min(160, numberValue(saved.gridSize, fallback.gridSize))),
        tabOrder: normalizeTabOrder(saved.tabOrder),
        shortcuts,
      };
    } catch (_error) {
      return fallback;
    }
  }

  return {
    DEFAULT_SHORTCUTS,
    SETTINGS_VERSION,
    SHORTCUT_LABELS,
    TAB_ORDER,
    TAB_SHORTCUT_ACTIONS,
    normalizeTabOrder,
    normalizeEditorSettings,
  };
});
