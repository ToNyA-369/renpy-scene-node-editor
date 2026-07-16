"use strict";

const SETTINGS_KEY = "scene-node-editor.settings";
const GRID_VISIBLE_KEY = "scene-node-editor.option-grid-visible";
const SNAP_ENABLED_KEY = "scene-node-editor.option-snap-enabled";
const DEFAULT_SHORTCUTS = {
  save: "mod+s",
  create: "mod+enter",
  sidebar: "mod+\\",
  cyclePrevious: "mod+shift+left",
  cycleNext: "mod+shift+right",
  leftPanel: "mod+[",
  rightPanel: "mod+]",
  tabNode: "mod+1",
  tabEvents: "mod+2",
  tabOptions: "mod+3",
  tabContent: "mod+4",
  tabScreens: "mod+5",
  tabStats: "mod+6",
  tabValidation: "mod+7",
  optionElements: "alt+1",
  optionInspector: "alt+2",
  grid: "g",
  snap: "s",
  sections: "mod+.",
  settings: "mod+,",
};
const SHORTCUT_LABELS = {
  save: "立即儲存",
  create: "新增目前功能項目",
  sidebar: "切換節點列表",
  cyclePrevious: "上一個功能區",
  cycleNext: "下一個功能區",
  leftPanel: "展開或收合左側欄位",
  rightPanel: "展開或收合右側欄位",
  tabNode: "前往節點",
  tabEvents: "前往事件",
  tabOptions: "前往選項",
  tabContent: "前往演出",
  tabScreens: "前往畫面",
  tabStats: "前往狀態",
  tabValidation: "前往檢查",
  optionElements: "切換選項元件列表",
  optionInspector: "切換選項屬性",
  grid: "顯示或隱藏格線",
  snap: "開啟或關閉吸附",
  sections: "展開或收合區塊",
  settings: "開啟編輯器設定",
};
const TAB_SHORTCUT_ACTIONS = {
  tabNode: "node",
  tabEvents: "events",
  tabOptions: "options",
  tabContent: "content",
  tabScreens: "screens",
  tabStats: "stats",
  tabValidation: "validation",
};
const TAB_ORDER = ["node", "events", "options", "content", "screens", "stats", "validation"];
const narrowOptionsMedia = window.matchMedia("(max-width: 760px)");

function readEditorSettings() {
  const fallback = { version: 4, autosave: true, autosaveDelay: 700, gridSize: 24, shortcuts: { ...DEFAULT_SHORTCUTS } };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const savedShortcuts = { ...(saved.shortcuts || {}) };
    const savedVersion = numberValue(saved.version, 1);
    if (savedVersion < 2) {
      if (savedShortcuts.optionElements === "mod+1") savedShortcuts.optionElements = "alt+1";
      if (savedShortcuts.optionInspector === "mod+2") savedShortcuts.optionInspector = "alt+2";
    }
    if (savedVersion < 3 && savedShortcuts.sidebar === "mod+b") {
      savedShortcuts.sidebar = DEFAULT_SHORTCUTS.sidebar;
    }
    if (savedVersion < 4) {
      if (savedShortcuts.sidebar === "mod+|") savedShortcuts.sidebar = DEFAULT_SHORTCUTS.sidebar;
      if (savedShortcuts.cyclePrevious === "mod+alt+left") savedShortcuts.cyclePrevious = DEFAULT_SHORTCUTS.cyclePrevious;
      if (savedShortcuts.cycleNext === "mod+alt+right") savedShortcuts.cycleNext = DEFAULT_SHORTCUTS.cycleNext;
    }
    const shortcuts = { ...DEFAULT_SHORTCUTS, ...savedShortcuts };
    [...Object.keys(TAB_SHORTCUT_ACTIONS), "create"].forEach((action) => {
      const conflictsWithSaved = Object.entries(savedShortcuts).some(([savedAction, value]) => savedAction !== action && value === shortcuts[action]);
      if (!Object.hasOwn(savedShortcuts, action) && conflictsWithSaved) shortcuts[action] = "";
    });
    return {
      version: 4,
      autosave: saved.autosave !== false,
      autosaveDelay: Math.max(200, numberValue(saved.autosaveDelay, fallback.autosaveDelay)),
      gridSize: Math.max(4, Math.min(160, numberValue(saved.gridSize, fallback.gridSize))),
      shortcuts,
    };
  } catch (_error) {
    return fallback;
  }
}

const state = {
  projectName: "",
  projectPath: "",
  rootNodeId: null,
  nodes: [],
  screens: [],
  images: [],
  stats: {},
  statsDraft: {},
  memories: {},
  memoriesDraft: {},
  issues: [],
  selectedNodePath: null,
  nodeDetail: null,
  selectedEventId: null,
  eventOriginalId: null,
  eventDraft: null,
  optionsDraft: null,
  selectedOptionElementId: null,
  selectedOptionItemId: null,
  optionInspectorTab: "content",
  optionResizeObserver: null,
  selectedContent: null,
  selectedContentDisplayName: "",
  contentSource: "",
  selectedScreen: null,
  selectedScreenDisplayName: "",
  screenSource: "",
  activeTab: "node",
  nameDialogKind: null,
  leftPanelHidden: { events: false, content: false, screens: false },
  optionElementsHidden: narrowOptionsMedia.matches,
  optionInspectorHidden: narrowOptionsMedia.matches,
  optionGridVisible: localStorage.getItem(GRID_VISIBLE_KEY) !== "false",
  optionSnapEnabled: localStorage.getItem(SNAP_ENABLED_KEY) !== "false",
  editorSettings: readEditorSettings(),
};

let autosaveTimer = null;
let pendingAutosave = null;
let failedAutosave = null;
let autosaveRetryTimer = null;
let autosaveQueuedCount = 0;
let autosaveInFlight = Promise.resolve(true);
let workspaceAnimationTimer = null;

const dom = {
  workspace: document.querySelector("#workspace"),
  tabbar: document.querySelector("#tabbar"),
  tabFocusIndicator: document.querySelector("#tabFocusIndicator"),
  nodeList: document.querySelector("#nodeList"),
  nodeSearch: document.querySelector("#nodeSearch"),
  nodeTitle: document.querySelector("#nodeTitle"),
  nodePath: document.querySelector("#nodePath"),
  projectName: document.querySelector("#projectName"),
  projectSummary: document.querySelector("#projectSummary"),
  saveState: document.querySelector("#saveState"),
  eventCount: document.querySelector("#eventCount"),
  issueCount: document.querySelector("#issueCount"),
  nodePanel: document.querySelector("#nodePanel"),
  eventsPanel: document.querySelector("#eventsPanel"),
  optionsPanel: document.querySelector("#optionsPanel"),
  contentPanel: document.querySelector("#contentPanel"),
  screensPanel: document.querySelector("#screensPanel"),
  statsPanel: document.querySelector("#statsPanel"),
  validationPanel: document.querySelector("#validationPanel"),
  nodeDialog: document.querySelector("#nodeDialog"),
  nodeDialogForm: document.querySelector("#nodeDialogForm"),
  nameDialog: document.querySelector("#nameDialog"),
  nameDialogForm: document.querySelector("#nameDialogForm"),
  nameDialogKicker: document.querySelector("#nameDialogKicker"),
  nameDialogTitle: document.querySelector("#nameDialogTitle"),
  nameDialogLabel: document.querySelector("#nameDialogLabel"),
  nameDialogInput: document.querySelector("#nameDialogInput"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  autosaveEnabled: document.querySelector("#autosaveEnabled"),
  autosaveDelay: document.querySelector("#autosaveDelay"),
  gridSize: document.querySelector("#gridSize"),
  shortcutList: document.querySelector("#shortcutList"),
  screenNames: document.querySelector("#screenNames"),
  statNames: document.querySelector("#statNames"),
  nodeNames: document.querySelector("#nodeNames"),
  contentNames: document.querySelector("#contentNames"),
  imageAssets: document.querySelector("#imageAssets"),
  toastRegion: document.querySelector("#toastRegion"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function generateId(prefix) {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setSaveState(message, kind = "", detail = "") {
  dom.saveState.textContent = message;
  dom.saveState.className = `save-state ${kind}`.trim();
  dom.saveState.title = detail;
}

function writeEditorSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.editorSettings));
}

function discardPendingAutosave() {
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  if (autosaveRetryTimer) window.clearTimeout(autosaveRetryTimer);
  autosaveTimer = null;
  autosaveRetryTimer = null;
  pendingAutosave = null;
  failedAutosave = null;
}

function scheduleAutosave(label, persist) {
  pendingAutosave = { label, persist };
  failedAutosave = null;
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  if (autosaveRetryTimer) window.clearTimeout(autosaveRetryTimer);
  autosaveRetryTimer = null;
  setSaveState(state.editorSettings.autosave ? "等待自動儲存" : "尚未儲存", "saving");
  if (!state.editorSettings.autosave) return;
  autosaveTimer = window.setTimeout(runPendingAutosave, state.editorSettings.autosaveDelay);
}

function retryFailedAutosave() {
  if (!state.editorSettings.autosave || pendingAutosave || !failedAutosave?.retryable) return;
  const task = failedAutosave;
  failedAutosave = null;
  pendingAutosave = task;
  setSaveState("重新連線中", "saving");
  runPendingAutosave();
}

function scheduleAutosaveRetry() {
  if (autosaveRetryTimer) window.clearTimeout(autosaveRetryTimer);
  autosaveRetryTimer = window.setTimeout(() => {
    autosaveRetryTimer = null;
    retryFailedAutosave();
  }, 3000);
}

async function runPendingAutosave() {
  if (!pendingAutosave || !state.editorSettings.autosave) return true;
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const task = pendingAutosave;
  pendingAutosave = null;
  setSaveState("自動儲存中", "saving");
  autosaveQueuedCount += 1;
  autosaveInFlight = autosaveInFlight.then(async () => {
    try {
      await task.persist();
      return true;
    } catch (error) {
      const connectionLost = error.code === "NETWORK_ERROR";
      task.retryable = connectionLost;
      if (!pendingAutosave) failedAutosave = task;
      setSaveState(connectionLost ? "連線中斷・重試中" : "自動儲存失敗", "error", error.message);
      if (!task.failureNotified) {
        toast(`${task.label}：${error.message}`, "error");
        task.failureNotified = true;
      }
      if (connectionLost && !pendingAutosave) scheduleAutosaveRetry();
      return false;
    } finally {
      autosaveQueuedCount = Math.max(0, autosaveQueuedCount - 1);
    }
  });
  const succeeded = await autosaveInFlight;
  if (pendingAutosave && state.editorSettings.autosave) {
    if (autosaveTimer) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(runPendingAutosave, state.editorSettings.autosaveDelay);
    setSaveState("等待自動儲存", "saving");
  } else if (succeeded) {
    setSaveState("已自動儲存");
  }
  return succeeded;
}

async function flushAutosave() {
  if (!state.editorSettings.autosave) return true;
  if (!pendingAutosave && failedAutosave) {
    if (autosaveRetryTimer) window.clearTimeout(autosaveRetryTimer);
    autosaveRetryTimer = null;
    pendingAutosave = failedAutosave;
    failedAutosave = null;
  }
  while (pendingAutosave) {
    if (!await runPendingAutosave()) return false;
  }
  return Boolean(await autosaveInFlight);
}

function toast(message, kind = "") {
  const item = document.createElement("div");
  item.className = `toast ${kind}`.trim();
  item.textContent = message;
  dom.toastRegion.append(item);
  window.setTimeout(() => item.remove(), 3200);
}

async function api(path, options = {}) {
  const request = { ...options };
  request.headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (request.body && typeof request.body !== "string") {
    request.body = JSON.stringify(request.body);
  }
  let response;
  try {
    response = await fetch(path, request);
  } catch (cause) {
    const error = new Error("無法連線到編輯器伺服器。請保持此頁開啟並重新啟動編輯器。");
    error.code = "NETWORK_ERROR";
    error.cause = cause;
    throw error;
  }
  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    data = {};
  }
  if (!response.ok) {
    const error = new Error(data.error || `請求失敗 (${response.status})`);
    error.code = "HTTP_ERROR";
    error.status = response.status;
    throw error;
  }
  return data;
}

function optionTags(items, current, label = (item) => item, value = (item) => item) {
  return items.map((item) => {
    const optionValue = String(value(item));
    const selected = optionValue === String(current ?? "") ? " selected" : "";
    return `<option value="${escapeHtml(optionValue)}"${selected}>${escapeHtml(label(item))}</option>`;
  }).join("");
}

function namedOptionTags(items, current, { includeNone = false } = {}) {
  const normalized = items.map((item) => ({ id: String(item.id), name: String(item.name || item.id) }));
  const known = new Set(normalized.map((item) => item.id));
  if (current && !known.has(String(current))) normalized.push({ id: String(current), name: `${current}（未找到）` });
  const none = includeNone ? '<option value="">None</option>' : "";
  return none + normalized.map((item) => {
    const selected = item.id === String(current || "") ? " selected" : "";
    return `<option value="${escapeHtml(item.id)}"${selected}>${escapeHtml(item.name)}</option>`;
  }).join("");
}

function actionTriggerName(trigger) {
  const value = String(trigger || "").trim();
  return value.startsWith("Action:") ? value.slice("Action:".length).trim() : value;
}

function actionTriggerValue(name) {
  const value = actionTriggerName(name);
  return value ? `Action:${value}` : "";
}

function statChoices() {
  return Object.entries(state.stats).map(([id, values]) => ({ id, name: values.Name || id }));
}

function memoryChoices() {
  return Object.entries(state.memories).map(([id, values]) => ({ id, name: values.Name || id }));
}

function defaultMemoryCondition() {
  const bank = memoryChoices()[0]?.id || "memory";
  return { type: "memory", bank, id: "新標籤", op: "has" };
}

function defaultMemoryEffect() {
  const bank = memoryChoices()[0]?.id || "memory";
  return { type: "memory", bank, id: "新標籤", op: "add" };
}

function defaultStatCondition() {
  const id = statChoices()[0]?.id;
  return id ? { type: "stat", id, op: ">=", value: 0 } : null;
}

function defaultStatEffect() {
  const id = statChoices()[0]?.id;
  return id ? { type: "stat", id, op: "+", value: 0 } : null;
}

function warnMissingStat(kind) {
  toast(`目前專案沒有任何 Stat。請先到「狀態」建立 Stat，再新增 Stat ${kind}。`, "error");
}

function nodeChoices() {
  return state.nodes.map((node) => ({ id: node.id, name: node.name || node.id }));
}

function screenChoices() {
  const choices = [];
  for (const file of state.screens) {
    const symbols = file.screens?.length ? file.screens : [file.name];
    for (const id of symbols) choices.push({ id, name: file.displayName || id });
  }
  return choices;
}

function contentChoices() {
  const choices = [];
  for (const file of state.nodeDetail?.contents || []) {
    const labels = file.labels?.length ? file.labels : [file.name];
    for (const id of labels) choices.push({ id, name: file.displayName || id });
  }
  return choices;
}

function updateDatalists() {
  const screenSymbols = new Set();
  for (const file of state.screens) {
    for (const name of file.screens || []) screenSymbols.add(name);
    if (!(file.screens || []).length) screenSymbols.add(file.name);
  }
  dom.screenNames.innerHTML = [...screenSymbols].sort().map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  dom.statNames.innerHTML = Object.keys(state.stats).sort().map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  dom.nodeNames.innerHTML = state.nodes.map((node) => `<option value="${escapeHtml(node.id)}"></option>`).join("");
  const labels = new Set();
  for (const file of state.nodeDetail?.contents || []) {
    for (const label of file.labels || []) labels.add(label);
  }
  dom.contentNames.innerHTML = [...labels].sort().map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  dom.imageAssets.innerHTML = state.images.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  const newNodeScreen = document.querySelector("#newNodeScreen");
  if (newNodeScreen) newNodeScreen.innerHTML = namedOptionTags(screenChoices(), newNodeScreen.value, { includeNone: true });
}

function updateHeader() {
  const node = state.nodeDetail?.node;
  dom.projectName.textContent = state.projectName || "Scene Node Editor";
  dom.projectSummary.textContent = `${state.nodes.length} 個節點`;
  dom.nodeTitle.textContent = node?.Name || node?.ID || "Scene Node Editor";
  dom.nodePath.textContent = state.selectedNodePath ? `SCENENODE/${state.selectedNodePath}` : state.projectPath || "尚未選擇節點";
  dom.eventCount.textContent = state.nodeDetail?.events?.length || 0;
  dom.issueCount.textContent = state.issues.length;
  dom.issueCount.classList.toggle("has-errors", state.issues.length > 0);
  syncShortcutTitles();
}

function updateEmptyState() {
  const needsNode = ["node", "events", "options", "content"].includes(state.activeTab);
  dom.workspace.classList.toggle("no-node", !state.nodeDetail && needsNode);
}

function renderNodeList() {
  const query = dom.nodeSearch.value.trim().toLocaleLowerCase();
  const nodes = state.nodes.filter((node) => {
    const haystack = `${node.name || ""} ${node.id} ${node.path}`.toLocaleLowerCase();
    return !query || haystack.includes(query);
  });
  if (!nodes.length) {
    dom.nodeList.innerHTML = `<div class="node-list-empty">${state.nodes.length ? "沒有符合的節點" : "尚未建立 Scene Node"}</div>`;
    return;
  }
  dom.nodeList.innerHTML = nodes.map((node) => `
    <button class="node-item ${node.path === state.selectedNodePath ? "active" : ""}" type="button" data-node-path="${escapeHtml(node.path)}">
      <span class="node-accent" aria-hidden="true"></span>
      <span class="node-item-copy">
        <strong>${escapeHtml(node.name || node.id)}${node.isRoot ? '<span class="root-node-badge is-compact">ROOT</span>' : ""}</strong>
        <span>${escapeHtml(node.path)}</span>
      </span>
      <span class="node-event-count" title="Event 數量">${node.eventCount}</span>
    </button>
  `).join("");
}

async function loadProject({ preserveNode = true } = {}) {
  setSaveState("掃描中", "saving");
  try {
    const previous = preserveNode ? state.selectedNodePath : null;
    const data = await api("/api/project");
    state.projectName = data.projectName;
    state.projectPath = data.projectPath;
    state.rootNodeId = data.rootNodeId || null;
    state.nodes = data.nodes || [];
    state.screens = data.screens || [];
    state.images = data.images || [];
    state.stats = data.stats || {};
    state.statsDraft = clone(state.stats);
    state.memories = data.memories || { memory: { Name: "Memory" } };
    state.memoriesDraft = clone(state.memories);
    state.issues = data.issues || [];
    const preferred = state.nodes.find((item) => item.path === previous)?.path || state.nodes[0]?.path || null;
    renderNodeList();
    if (preferred) {
      await selectNode(preferred, { preserveTab: true });
    } else {
      state.selectedNodePath = null;
      state.nodeDetail = null;
      state.selectedEventId = null;
      renderAll();
    }
    setSaveState("已同步");
  } catch (error) {
    setSaveState("讀取失敗", "error");
    toast(error.message, "error");
  }
}

async function selectNode(path, { preserveTab = false } = {}) {
  if (path !== state.selectedNodePath && !await flushAutosave()) return;
  const isSwitchingNode = Boolean(state.selectedNodePath && path !== state.selectedNodePath);
  setSaveState("讀取中", "saving");
  try {
    const detail = await api(`/api/node?path=${encodeURIComponent(path)}`);
    state.selectedNodePath = path;
    state.nodeDetail = detail;
    state.selectedEventId = detail.events[0]?.data?.ID || null;
    state.eventOriginalId = state.selectedEventId;
    state.eventDraft = state.selectedEventId ? clone(detail.events[0].data) : null;
    state.optionsDraft = clone(detail.options || defaultOptionsDraft());
    state.selectedOptionElementId = state.optionsDraft.Elements[0]?.ID || null;
    state.selectedOptionItemId = selectedOptionElement()?.Items?.[0]?.ID || null;
    state.selectedContent = detail.contents[0]?.name || null;
    state.selectedContentDisplayName = detail.contents[0]?.displayName || "";
    state.contentSource = "";
    if (!preserveTab && !state.activeTab) state.activeTab = "node";
    renderAll();
    if (state.selectedContent) await loadContent(state.selectedContent);
    closeSidebar();
    if (isSwitchingNode) playWorkspaceAnimation("node-switch-enter");
    setSaveState("已同步");
  } catch (error) {
    setSaveState("讀取失敗", "error");
    toast(error.message, "error");
  }
}

function renderAll() {
  updateHeader();
  updateDatalists();
  renderNodeList();
  renderNodePanel();
  renderEventsPanel();
  renderOptionsPanel();
  renderContentPanel();
  renderScreensPanel();
  renderStatsPanel();
  renderValidationPanel();
  switchTab(state.activeTab, { render: false });
  updateEmptyState();
  syncShortcutTitles();
}

function syncTabFocusIndicator({ immediate = false } = {}) {
  const indicator = dom.tabFocusIndicator;
  const activeTab = dom.tabbar?.querySelector(".tab.active");
  if (!indicator || !activeTab) return;
  if (immediate) indicator.classList.add("no-transition");
  indicator.style.width = `${activeTab.offsetWidth}px`;
  indicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
  indicator.classList.add("ready");
  if (immediate) {
    window.requestAnimationFrame(() => indicator.classList.remove("no-transition"));
  }
}

function playWorkspaceAnimation(className) {
  dom.workspace.classList.remove("tab-switch-enter", "node-switch-enter");
  void dom.workspace.offsetWidth;
  dom.workspace.classList.add(className);
  if (workspaceAnimationTimer) window.clearTimeout(workspaceAnimationTimer);
  workspaceAnimationTimer = window.setTimeout(() => {
    dom.workspace.classList.remove(className);
    workspaceAnimationTimer = null;
  }, 240);
}

function switchTab(tab, { render = true } = {}) {
  const isSwitchingTab = state.activeTab !== tab;
  state.activeTab = tab;
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
  syncTabFocusIndicator({ immediate: !dom.tabFocusIndicator?.classList.contains("ready") });
  if (render) {
    if (tab === "options") renderOptionsPanel();
    if (tab === "screens") renderScreensPanel();
    if (tab === "stats") renderStatsPanel();
    if (tab === "validation") renderValidationPanel();
  }
  updateEmptyState();
  if (isSwitchingTab) playWorkspaceAnimation("tab-switch-enter");
}

async function requestTabSwitch(tab, options = {}) {
  if (tab !== state.activeTab && !await flushAutosave()) return false;
  switchTab(tab, options);
  return true;
}

function renderNodePanel() {
  if (!state.nodeDetail) {
    dom.nodePanel.innerHTML = "";
    return;
  }
  const node = state.nodeDetail.node;
  const isRoot = node.ID === state.rootNodeId;
  dom.nodePanel.innerHTML = `
    <div class="panel-page node-panel-page">
      <div class="node-editor-shell">
        <div class="node-root-row">
          <div>
            <span class="root-node-badge">${isRoot ? "ROOT" : "NODE"}</span>
            <span>${isRoot ? "目前的遊戲起始節點" : "可設為遊戲起始節點"}</span>
          </div>
          ${isRoot ? "" : '<button class="quiet-button compact" id="setRootNodeButton" type="button">設為起始節點</button>'}
        </div>
        <form id="nodeForm" class="bento-form">
          <div class="form-section node-form-section node-identity-section">
            <div class="form-grid two-columns">
              <label class="field">
                <span>Name</span>
                <input name="Name" required value="${escapeHtml(node.Name || node.ID || "")}">
              </label>
              <label class="field">
                <span>ID</span>
                <input value="${escapeHtml(node.ID || "")}" disabled>
                <input name="ID" type="hidden" value="${escapeHtml(node.ID || "")}">
              </label>
            </div>
          </div>
          <div class="form-section node-form-section">
            <div class="form-grid two-columns">
              <label class="field">
                <span>Background</span>
                <input name="Background" value="${escapeHtml(node.Background || "")}" placeholder="請輸入背景資源 ID">
              </label>
              <label class="field">
                <span>Scene Screen</span>
                <select name="Screen">${namedOptionTags(screenChoices(), node.Screen || "", { includeNone: true })}</select>
              </label>
            </div>
          </div>
        </form>

        <div class="editor-danger-zone">
          <button class="danger-button" id="deleteNodeButton" type="button" ${isRoot ? 'disabled title="請先將其他節點設為起始節點"' : ""}>刪除節點</button>
        </div>
      </div>
    </div>
  `;
  const form = document.querySelector("#nodeForm");
  form?.addEventListener("submit", saveNode);
  form?.addEventListener("input", scheduleNodeAutosave);
  form?.addEventListener("change", scheduleNodeAutosave);
  document.querySelector("#setRootNodeButton")?.addEventListener("click", setSelectedNodeAsRoot);
  document.querySelector("#deleteNodeButton")?.addEventListener("click", deleteNode);
}

async function setSelectedNodeAsRoot() {
  if (!state.nodeDetail || !await flushAutosave()) return;
  const nodeId = state.nodeDetail.node.ID;
  setSaveState("設定起始節點中", "saving");
  try {
    const result = await api("/api/project/root", { method: "PUT", body: { nodeId } });
    state.rootNodeId = result.rootNodeId;
    state.nodes.forEach((node) => { node.isRoot = node.id === state.rootNodeId; });
    state.issues = (await api("/api/validate")).issues || [];
    renderNodeList();
    renderNodePanel();
    renderValidationPanel();
    updateHeader();
    setSaveState("已同步");
    toast(`${state.nodeDetail.node.Name || nodeId} 已設為起始節點`);
  } catch (error) {
    setSaveState("設定失敗", "error");
    toast(error.message, "error");
  }
}

function readNodeForm(form = document.querySelector("#nodeForm")) {
  if (!form) return null;
  const values = new FormData(form);
  return {
    path: state.selectedNodePath,
    node: {
      ID: values.get("ID"),
      Name: values.get("Name"),
      Background: values.get("Background"),
      Screen: values.get("Screen"),
    },
  };
}

async function persistNodeSnapshot(snapshot) {
  await api("/api/node", { method: "PUT", body: snapshot });
  if (state.selectedNodePath !== snapshot.path || !state.nodeDetail) return;
  state.nodeDetail.node = { ...state.nodeDetail.node, ...snapshot.node };
  const summary = state.nodes.find((node) => node.path === snapshot.path);
  if (summary) {
    summary.name = snapshot.node.Name || snapshot.node.ID;
    summary.id = snapshot.node.ID;
    summary.background = snapshot.node.Background;
    summary.screen = snapshot.node.Screen;
  }
  updateHeader();
  renderNodeList();
}

function scheduleNodeAutosave() {
  const snapshot = readNodeForm();
  if (snapshot) scheduleAutosave("節點設定未能儲存", () => persistNodeSnapshot(snapshot));
}

async function saveNode(event) {
  event.preventDefault();
  const snapshot = readNodeForm(event.currentTarget);
  discardPendingAutosave();
  await autosaveInFlight;
  setSaveState("儲存中", "saving");
  try {
    await persistNodeSnapshot(snapshot);
    await refreshAfterSave();
    toast("節點設定已儲存");
  } catch (error) {
    setSaveState("儲存失敗", "error");
    toast(error.message, "error");
  }
}

async function deleteNode() {
  if (!await flushAutosave()) return;
  const node = state.nodeDetail?.node;
  if (!node) return;
  try {
    const check = await api(`/api/node/references?path=${encodeURIComponent(state.selectedNodePath)}`);
    if (check.references.length) {
      const lines = check.references.slice(0, 8).map((reference) => `• ${reference.nodeName} / ${reference.eventName}`);
      window.alert(`目前仍有 ${check.references.length} 個 Event 指向「${node.Name || node.ID}」：\n\n${lines.join("\n")}\n\n請先修改這些 Next Node。`);
      return;
    }
    const eventCount = state.nodeDetail.events.length;
    const contentCount = state.nodeDetail.contents.length;
    const confirmed = window.confirm(`確定刪除「${node.Name || node.ID}」？\n\n${eventCount} 個 Event、${contentCount} 個 Content 將移至可復原區。`);
    if (!confirmed) return;
    const result = await api(`/api/nodes?path=${encodeURIComponent(state.selectedNodePath)}`, { method: "DELETE" });
    state.selectedNodePath = null;
    state.nodeDetail = null;
    await loadProject({ preserveNode: false });
    toast(`節點已移至可復原區：${result.backup}`);
  } catch (error) {
    setSaveState("儲存失敗", "error");
    toast(error.message, "error");
  }
}

function eventActionChoices(current = "") {
  const options = state.optionsDraft || state.nodeDetail?.options || defaultOptionsDraft();
  const choices = [];
  const seen = new Set();
  const addChoice = (trigger, name) => {
    const value = String(trigger || "").trim();
    if (!value || value === "Auto" || seen.has(value)) return;
    seen.add(value);
    choices.push({ id: value, name: String(name || actionTriggerName(value)) });
  };
  (options.Elements || []).forEach((element) => {
    if (element.Type === "TEXTBOX") {
      (element.Items || []).forEach((item) => addChoice(item.Trigger, item.Name || item.Text || item.ID));
    } else {
      addChoice(element.Trigger, element.Name || element.ID);
    }
  });
  const currentValue = String(current || "").trim();
  if (currentValue && currentValue !== "Auto" && !seen.has(currentValue)) {
    choices.push({ id: currentValue, name: `${actionTriggerName(currentValue)}（未找到）` });
  }
  return choices;
}

function defaultEvent(id = generateId("event")) {
  return {
    ID: id,
    Name: "新事件",
    Trigger: eventActionChoices()[0]?.id || "Auto",
    Priority: 5,
    Weight: 1,
    Once: false,
    Conditions: [],
    Effects: [],
    Content: null,
    "End up": "REDO",
    "Next Node": null,
  };
}

function eventListHtml() {
  const events = state.nodeDetail?.events || [];
  if (!events.length) return `<div class="node-list-empty">尚未建立 Event</div>`;
  return events.map((entry) => {
    const event = entry.data.ID === state.selectedEventId && state.eventDraft ? state.eventDraft : entry.data;
    return `
      <button class="subnav-item ${event.ID === state.selectedEventId ? "active" : ""}" type="button" data-event-id="${escapeHtml(event.ID)}">
        <span class="subnav-item-copy">
          <strong>${escapeHtml(event.Name || event.ID || entry.file)}</strong>
          <span>${escapeHtml(event.Trigger || "尚未設定 Trigger")}</span>
        </span>
        <span class="priority-badge" title="Priority">${escapeHtml(event.Priority ?? 5)}</span>
      </button>
    `;
  }).join("");
}

function captureEventPanelView() {
  const editor = document.querySelector("#eventEditorScroll");
  const eventList = dom.eventsPanel.querySelector(".subnav-list");
  const form = document.querySelector("#eventForm");
  const focused = form?.contains(document.activeElement) ? document.activeElement : null;
  const focusName = focused?.name || "";
  const focusIndex = focusName
    ? [...form.querySelectorAll(`[name="${focusName}"]`)].indexOf(focused)
    : -1;
  return {
    editorScrollTop: editor?.scrollTop || 0,
    editorScrollLeft: editor?.scrollLeft || 0,
    eventListScrollTop: eventList?.scrollTop || 0,
    sectionStates: [...(form?.querySelectorAll("details.collapsible-section") || [])].map((section) => section.open),
    focusName,
    focusIndex,
  };
}

function restoreEventPanelView(view) {
  const form = document.querySelector("#eventForm");
  [...(form?.querySelectorAll("details.collapsible-section") || [])].forEach((section, index) => {
    if (view.sectionStates[index] !== undefined) section.open = view.sectionStates[index];
  });
  if (form && view.focusName && view.focusIndex >= 0) {
    const candidates = [...form.querySelectorAll(`[name="${view.focusName}"]`)];
    candidates[view.focusIndex]?.focus({ preventScroll: true });
  }
  const editor = document.querySelector("#eventEditorScroll");
  if (editor) {
    editor.scrollTop = view.editorScrollTop;
    editor.scrollLeft = view.editorScrollLeft;
  }
  const eventList = dom.eventsPanel.querySelector(".subnav-list");
  if (eventList) eventList.scrollTop = view.eventListScrollTop;
}

function renderEventsPanel({ preserveView = false } = {}) {
  const view = preserveView ? captureEventPanelView() : null;
  if (!state.nodeDetail) {
    dom.eventsPanel.innerHTML = "";
    return;
  }
  const leftHidden = state.leftPanelHidden.events;
  dom.eventsPanel.innerHTML = `
    <div class="event-workspace ${leftHidden ? "left-panel-hidden" : ""}">
      <aside class="subnav">
        <div class="subnav-header">
          <div class="subnav-header-actions">
            <button class="icon-button add-button" id="newEventButton" type="button" title="新增 Event" aria-label="新增 Event">＋</button>
          </div>
        </div>
        <div class="subnav-list">${eventListHtml()}</div>
      </aside>
      <div class="editor-scroll" id="eventEditorScroll">
        ${state.eventDraft ? eventEditorHtml(state.eventDraft) : `
          <div class="editor-empty">
            <div>
              <p>這個節點還沒有 Event。</p>
              <button class="primary-button add-button" id="emptyNewEventButton" type="button">新增 Event</button>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
  bindEventPanel();
  if (view) restoreEventPanelView(view);
  syncShortcutTitles();
}

function conditionRowsHtml(conditions) {
  if (!conditions.length) return `<div class="row-empty">沒有條件，這個 Event 會作為無條件候選。</div>`;
  return conditions.map((condition, index) => {
    const type = condition.type === "tag" ? "memory" : (condition.type || "stat");
    const isMemory = type === "memory";
    return `
      <div class="repeat-row condition-row" data-index="${index}" data-condition-type="${escapeHtml(type)}">
        <label class="field"><span class="visually-hidden">類型</span><select name="conditionType" aria-label="條件類型">${optionTags(["stat", "memory"], type, (value) => value === "memory" ? "memory" : value)}</select></label>
        ${isMemory ? `
          <label class="field"><span class="visually-hidden">記憶庫</span><select name="conditionBank" aria-label="記憶庫">${namedOptionTags(memoryChoices(), condition.bank || "memory")}</select></label>
          <label class="field"><span class="visually-hidden">記憶標籤</span><input name="conditionId" aria-label="記憶標籤" value="${escapeHtml(condition.id || "")}" placeholder="標籤"></label>
          <label class="field"><span class="visually-hidden">判斷</span><select name="conditionOp" aria-label="判斷">${optionTags(["has", "not_has"], condition.op)}</select></label>
        ` : `
          <label class="field"><span class="visually-hidden">Stat</span><select name="conditionId" aria-label="Stat">${namedOptionTags(statChoices(), condition.id)}</select></label>
          <label class="field"><span class="visually-hidden">判斷</span><select name="conditionOp" aria-label="判斷">${optionTags([">", ">=", "<", "<=", "==", "!="], condition.op)}</select></label>
          <label class="field"><span class="visually-hidden">值</span><input name="conditionValue" aria-label="值" type="number" step="any" value="${escapeHtml(condition.value ?? 0)}"></label>
        `}
        <button class="row-button" type="button" data-remove-condition="${index}" title="移除條件" aria-label="移除條件">×</button>
      </div>
    `;
  }).join("");
}

function effectRowsHtml(effects) {
  if (!effects.length) return `<div class="row-empty">尚未設定 Effect。</div>`;
  return effects.map((effect, index) => {
    const type = effect.type === "tag" ? "memory" : (effect.type || "stat");
    const isStat = type === "stat";
    const isMemory = type === "memory";
    const opItems = isStat ? ["set", "+", "-", "*", "/"] : isMemory ? ["add", "remove", "clear"] : ["play", "stop"];
    const valueField = isStat
      ? `<label class="field"><span class="visually-hidden">值</span><input name="effectValue" aria-label="值" type="number" step="any" value="${escapeHtml(effect.value ?? 0)}"></label>`
      : isMemory
        ? `<label class="field"><span class="visually-hidden">記憶標籤</span><input name="effectId" aria-label="記憶標籤" value="${escapeHtml(effect.id || "")}" placeholder="${effect.op === "clear" ? "清空整個記憶庫" : "標籤"}" ${effect.op === "clear" ? "disabled" : ""}></label>`
        : `<label class="checkbox-field"><input name="effectPersistent" type="checkbox" ${effect.persistent ? "checked" : ""}><span>Persistent</span></label>`;
    return `
      <div class="repeat-row effect-row" data-index="${index}" data-effect-type="${escapeHtml(type)}">
        <label class="field"><span class="visually-hidden">類型</span><select name="effectType" aria-label="效果類型">${optionTags(["stat", "memory", "bgm", "se"], type)}</select></label>
        <label class="field"><span class="visually-hidden">${isStat ? "Stat" : isMemory ? "記憶庫" : "資源 ID"}</span>${isStat ? `<select name="effectId" aria-label="Stat">${namedOptionTags(statChoices(), effect.id)}</select>` : isMemory ? `<select name="effectBank" aria-label="記憶庫">${namedOptionTags(memoryChoices(), effect.bank || "memory")}</select>` : `<input name="effectId" aria-label="資源 ID" value="${escapeHtml(effect.id || "")}">`}</label>
        <label class="field"><span class="visually-hidden">操作</span><select name="effectOp" aria-label="操作">${optionTags(opItems, effect.op)}</select></label>
        ${valueField}
        <button class="row-button" type="button" data-remove-effect="${index}" title="移除 Effect" aria-label="移除 Effect">×</button>
      </div>
    `;
  }).join("");
}

function choiceEntries(value) {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") return [[value, 1]];
  return Object.entries(value);
}

function weightedRowsHtml(value, kind) {
  const rows = choiceEntries(value);
  if (!rows.length) return `<div class="row-empty">尚未加入權重項目。</div>`;
  const choices = kind === "content" ? contentChoices() : nodeChoices();
  return rows.map(([id, weight], index) => `
    <div class="repeat-row weight-row" data-index="${index}">
      <label class="field"><span class="visually-hidden">Name</span><select name="${kind}WeightedId" aria-label="${kind === "content" ? "Content 名稱" : "節點名稱"}">${namedOptionTags(choices, id)}</select></label>
      <label class="field"><span class="visually-hidden">Weight</span><input name="${kind}WeightedValue" aria-label="權重" type="number" min="0.0001" step="any" value="${escapeHtml(weight)}"></label>
      <button class="row-button" type="button" data-remove-weighted="${kind}:${index}" title="移除項目" aria-label="移除項目">×</button>
    </div>
  `).join("");
}

function choiceBlockHtml(value, kind) {
  const representation = typeof value === "string" ? "single" : "weighted";
  return `
    <div class="weighted-choice-table">
      <input name="${kind}Representation" type="hidden" value="${representation}">
      <div class="repeat-list">${weightedRowsHtml(value, kind)}</div>
    </div>
  `;
}

function eventEditorHtml(event) {
  const triggerMode = event.Trigger === "Auto" ? "Auto" : "Action";
  return `
    <form class="editor-page" id="eventForm">
      <div class="form-section event-primary-section">
        <div class="form-grid event-primary-name-grid">
          <label class="field"><span>Name</span><input name="Name" required value="${escapeHtml(event.Name || event.ID || "")}"></label>
          <div class="field event-trigger-field">
            <span>Trigger</span>
            <div class="event-trigger-control ${triggerMode === "Auto" ? "is-auto" : "is-action"}">
              <select name="TriggerMode" aria-label="Trigger 模式">${optionTags(["Auto", "Action"], triggerMode)}</select>
              ${triggerMode === "Action"
                ? `<select name="Trigger" aria-label="Action 選項" required>${namedOptionTags(eventActionChoices(event.Trigger), event.Trigger)}</select>`
                : '<input name="Trigger" type="hidden" value="Auto">'}
            </div>
          </div>
        </div>
        <div class="form-grid event-primary-settings-grid">
          <label class="field"><span>Priority</span><input name="Priority" type="number" min="0" max="5" step="1" value="${escapeHtml(event.Priority ?? 5)}"></label>
          <label class="field"><span>Weight</span><input name="Weight" type="number" min="0.0001" step="any" value="${escapeHtml(event.Weight ?? 1)}"></label>
          <label class="field event-once-field">
            <span>Once</span>
            <span class="boolean-control">
              <input name="Once" type="checkbox" ${event.Once ? "checked" : ""}>
              <span class="boolean-display" data-off="False" data-on="True" aria-hidden="true"><i></i></span>
            </span>
          </label>
        </div>
        <input name="ID" type="hidden" value="${escapeHtml(event.ID || "")}">
      </div>

      <details class="form-section collapsible-section" open>
        <summary class="form-section-header">
          <div><h3>Conditions</h3><span>${event.Conditions?.length || 0} 個條件</span></div>
          <button class="icon-button section-add-button add-button" id="addConditionButton" type="button" title="新增條件" aria-label="新增條件">＋</button>
        </summary>
        <div class="collapsible-section-body"><div class="repeat-list" id="conditionList">${conditionRowsHtml(event.Conditions || [])}</div></div>
      </details>

      <details class="form-section collapsible-section" open>
        <summary class="form-section-header">
          <div><h3>Effects</h3><span>${event.Effects?.length || 0} 個效果</span></div>
          <button class="icon-button section-add-button add-button" id="addEffectButton" type="button" title="新增 Effect" aria-label="新增 Effect">＋</button>
        </summary>
        <div class="collapsible-section-body"><div class="repeat-list" id="effectList">${effectRowsHtml(event.Effects || [])}</div></div>
      </details>

      <details class="form-section collapsible-section event-choice-section" open>
        <summary class="form-section-header">
          <div><h3>Content</h3><span>${choiceEntries(event.Content).length} 個演出</span></div>
          <button class="icon-button section-add-button add-button" type="button" data-add-weighted="content" title="新增演出" aria-label="新增演出">＋</button>
        </summary>
        <div class="collapsible-section-body">${choiceBlockHtml(event.Content, "content")}</div>
      </details>

      <details class="form-section collapsible-section event-choice-section" open>
        <summary class="form-section-header">
          <div><h3>End up</h3><span>${escapeHtml(event["End up"] || "REDO")}</span></div>
          ${event["End up"] === "GOTO" ? '<button class="icon-button section-add-button add-button" type="button" data-add-weighted="next" title="新增節點" aria-label="新增節點">＋</button>' : ""}
        </summary>
        <div class="collapsible-section-body">
          <div class="end-up-control">
            <label class="field"><span class="visually-hidden">End up</span><select name="EndUp" aria-label="End up">${optionTags(["REDO", "GOTO", "EXIT"], event["End up"] || "REDO")}</select></label>
          </div>
          <div id="nextNodeBlock">${event["End up"] === "GOTO" ? choiceBlockHtml(event["Next Node"], "next") : ""}</div>
        </div>
      </details>

      ${state.eventOriginalId ? '<div class="editor-danger-zone"><button class="danger-button" id="deleteEventButton" type="button">刪除事件</button></div>' : ""}
    </form>
  `;
}

function readWeighted(form, kind) {
  const result = {};
  const ids = [...form.querySelectorAll(`[name="${kind}WeightedId"]`)];
  const weights = [...form.querySelectorAll(`[name="${kind}WeightedValue"]`)];
  ids.forEach((input, index) => {
    const id = input.value.trim();
    if (id) result[id] = numberValue(weights[index]?.value, 1);
  });
  return result;
}

function readChoice(form, kind) {
  const value = readWeighted(form, kind);
  const entries = Object.entries(value);
  if (!entries.length) return null;
  const representation = form.elements[`${kind}Representation`]?.value;
  if (representation === "single" && entries.length === 1 && entries[0][1] === 1) return entries[0][0];
  return value;
}

function readEventForm() {
  const form = document.querySelector("#eventForm");
  if (!form) return state.eventDraft || defaultEvent();
  const conditions = [...form.querySelectorAll(".condition-row")].map((row) => {
    const type = row.querySelector('[name="conditionType"]').value;
    const result = {
      type,
      id: row.querySelector('[name="conditionId"]').value.trim(),
      op: row.querySelector('[name="conditionOp"]').value,
    };
    if (type === "stat") result.value = numberValue(row.querySelector('[name="conditionValue"]').value);
    if (type === "memory") result.bank = row.querySelector('[name="conditionBank"]').value;
    return result;
  });
  const effects = [...form.querySelectorAll(".effect-row")].map((row) => {
    const type = row.querySelector('[name="effectType"]').value;
    const result = {
      type,
      op: row.querySelector('[name="effectOp"]').value,
    };
    if (type === "stat") {
      result.id = row.querySelector('[name="effectId"]').value.trim();
      result.value = numberValue(row.querySelector('[name="effectValue"]').value);
    } else if (type === "memory") {
      result.bank = row.querySelector('[name="effectBank"]').value;
      if (result.op !== "clear") result.id = row.querySelector('[name="effectId"]').value.trim();
    } else {
      result.id = row.querySelector('[name="effectId"]').value.trim();
      result.persistent = row.querySelector('[name="effectPersistent"]').checked;
    }
    return result;
  });
  const endUp = form.elements.EndUp.value;
  return {
    ID: form.elements.ID.value.trim(),
    Name: form.elements.Name.value.trim(),
    Trigger: form.elements.Trigger.value.trim(),
    Priority: Math.trunc(numberValue(form.elements.Priority.value, 5)),
    Weight: numberValue(form.elements.Weight.value, 1),
    Once: form.elements.Once.checked,
    Conditions: conditions,
    Effects: effects,
    Content: readChoice(form, "content"),
    "End up": endUp,
    "Next Node": endUp === "GOTO" ? readChoice(form, "next") : null,
  };
}

function bindEventPanel() {
  document.querySelectorAll("[data-event-id]").forEach((button) => button.addEventListener("click", () => selectEvent(button.dataset.eventId)));
  document.querySelector("#newEventButton")?.addEventListener("click", createEventDraft);
  document.querySelector("#emptyNewEventButton")?.addEventListener("click", createEventDraft);
  const form = document.querySelector("#eventForm");
  if (!form) return;
  form.addEventListener("submit", saveEvent);
  document.querySelector("#deleteEventButton")?.addEventListener("click", deleteEvent);
  document.querySelector("#addConditionButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const condition = defaultStatCondition() || defaultMemoryCondition();
    state.eventDraft = readEventForm();
    state.eventDraft.Conditions.push(condition);
    scheduleEventAutosave({ useDraft: true });
    renderEventsPanel({ preserveView: true });
  });
  document.querySelector("#addEffectButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const effect = defaultStatEffect() || defaultMemoryEffect();
    state.eventDraft = readEventForm();
    state.eventDraft.Effects.push(effect);
    scheduleEventAutosave({ useDraft: true });
    renderEventsPanel({ preserveView: true });
  });
  form.addEventListener("click", (event) => {
    const conditionIndex = event.target.dataset.removeCondition;
    const effectIndex = event.target.dataset.removeEffect;
    const weighted = event.target.dataset.removeWeighted;
    const addWeighted = event.target.dataset.addWeighted;
    if (addWeighted) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (conditionIndex !== undefined) {
      state.eventDraft = readEventForm();
      state.eventDraft.Conditions.splice(Number(conditionIndex), 1);
    } else if (effectIndex !== undefined) {
      state.eventDraft = readEventForm();
      state.eventDraft.Effects.splice(Number(effectIndex), 1);
    } else if (weighted) {
      state.eventDraft = readEventForm();
      const [kind, indexText] = weighted.split(":");
      const key = kind === "content" ? "Content" : "Next Node";
      const entries = choiceEntries(state.eventDraft[key]);
      entries.splice(Number(indexText), 1);
      state.eventDraft[key] = Object.fromEntries(entries);
    } else if (addWeighted) {
      state.eventDraft = readEventForm();
      const key = addWeighted === "content" ? "Content" : "Next Node";
      const current = Object.fromEntries(choiceEntries(state.eventDraft[key]));
      const available = addWeighted === "content" ? contentChoices() : nodeChoices();
      let id = available.find((item) => !Object.hasOwn(current, item.id))?.id || (addWeighted === "content" ? "missingContent" : "missingNode");
      current[id] = 1;
      state.eventDraft[key] = current;
    }
    if (conditionIndex !== undefined || effectIndex !== undefined || weighted || addWeighted) {
      scheduleEventAutosave({ useDraft: true });
      renderEventsPanel({ preserveView: true });
    }
  });
  form.addEventListener("change", (event) => {
    if (event.target.name === "TriggerMode") {
      const draft = readEventForm();
      if (event.target.value === "Action") {
        const action = eventActionChoices()[0]?.id;
        if (!action) {
          event.target.value = "Auto";
          toast("目前節點尚未建立可供 Event 使用的選項。", "error");
          return;
        }
        draft.Trigger = action;
      } else {
        draft.Trigger = "Auto";
      }
      state.eventDraft = draft;
      scheduleEventAutosave({ useDraft: true });
      renderEventsPanel({ preserveView: true });
      return;
    } else if (event.target.name === "conditionType") {
      const row = event.target.closest(".condition-row");
      const index = Number(row.dataset.index);
      const condition = event.target.value === "memory"
        ? defaultMemoryCondition()
        : defaultStatCondition();
      if (!condition) {
        event.target.value = row.dataset.conditionType;
        state.eventDraft = readEventForm();
        warnMissingStat("Condition");
        renderEventsPanel({ preserveView: true });
        scheduleEventAutosave({ useDraft: true });
        return;
      }
      event.target.value = row.dataset.conditionType;
      state.eventDraft = readEventForm();
      state.eventDraft.Conditions[index] = condition;
      renderEventsPanel({ preserveView: true });
    } else if (event.target.name === "effectType") {
      const row = event.target.closest(".effect-row");
      const index = Number(row.dataset.index);
      const type = event.target.value;
      const effect = type === "stat"
        ? defaultStatEffect()
        : type === "memory"
          ? defaultMemoryEffect()
          : { type, id: "", op: "play", persistent: false };
      if (!effect) {
        event.target.value = row.dataset.effectType;
        state.eventDraft = readEventForm();
        warnMissingStat("Effect");
        renderEventsPanel({ preserveView: true });
        scheduleEventAutosave({ useDraft: true });
        return;
      }
      event.target.value = row.dataset.effectType;
      state.eventDraft = readEventForm();
      state.eventDraft.Effects[index] = effect;
      renderEventsPanel({ preserveView: true });
    } else if (event.target.name === "effectOp" && event.target.closest(".effect-row")?.dataset.effectType === "memory") {
      state.eventDraft = readEventForm();
      renderEventsPanel({ preserveView: true });
    } else if (event.target.name === "EndUp") {
      state.eventDraft = readEventForm();
      state.eventDraft["End up"] = event.target.value;
      state.eventDraft["Next Node"] = event.target.value === "GOTO" ? (state.nodes[0]?.id || "") : null;
      renderEventsPanel({ preserveView: true });
    }
    scheduleEventAutosave();
  });
  form.addEventListener("input", (event) => {
    if (["conditionType", "effectType", "EndUp"].includes(event.target.name)) return;
    scheduleEventAutosave();
  });
}

async function selectEvent(id) {
  if (id !== state.selectedEventId && !await flushAutosave()) return;
  const entry = state.nodeDetail.events.find((item) => item.data.ID === id);
  if (!entry) return;
  state.selectedEventId = id;
  state.eventOriginalId = id;
  state.eventDraft = clone(entry.data);
  renderEventsPanel();
}

async function createEventDraft() {
  if (!await flushAutosave()) return;
  const id = generateId("event");
  state.selectedEventId = null;
  state.eventOriginalId = null;
  state.eventDraft = defaultEvent(id);
  renderEventsPanel();
  scheduleEventAutosave();
  document.querySelector('[name="Name"]')?.focus();
}

async function persistEventSnapshot(snapshot) {
  const saved = await api("/api/events", {
    method: "POST",
    body: { node: snapshot.node, originalId: snapshot.originalId, event: snapshot.event },
  });
  if (state.selectedNodePath !== snapshot.node || !state.nodeDetail) return saved;
  const originalId = snapshot.originalId || snapshot.event.ID;
  const index = state.nodeDetail.events.findIndex((item) => item.data.ID === originalId);
  const entry = { file: `${saved.ID}.json`, data: clone(saved) };
  if (index >= 0) state.nodeDetail.events[index] = entry;
  else state.nodeDetail.events.push(entry);
  if (state.eventDraft?.ID === snapshot.event.ID) {
    state.selectedEventId = saved.ID;
    state.eventOriginalId = saved.ID;
  }
  updateHeader();
  return saved;
}

function scheduleEventAutosave({ useDraft = false } = {}) {
  if (!document.querySelector("#eventForm") && !state.eventDraft) return;
  if (!useDraft) state.eventDraft = readEventForm();
  const snapshot = {
    node: state.selectedNodePath,
    originalId: state.eventOriginalId,
    event: clone(state.eventDraft),
  };
  if (!state.eventOriginalId) state.eventOriginalId = snapshot.event.ID;
  scheduleAutosave("Event 未能儲存", () => persistEventSnapshot(snapshot));
}

async function saveEvent(event) {
  event.preventDefault();
  const draft = readEventForm();
  const snapshot = { node: state.selectedNodePath, originalId: state.eventOriginalId, event: clone(draft) };
  discardPendingAutosave();
  await autosaveInFlight;
  setSaveState("儲存中", "saving");
  try {
    const saved = await persistEventSnapshot(snapshot);
    state.selectedEventId = saved.ID;
    state.eventOriginalId = saved.ID;
    await refreshAfterSave();
    selectEvent(saved.ID);
    toast("Event 已儲存");
  } catch (error) {
    setSaveState("儲存失敗", "error");
    toast(error.message, "error");
  }
}

async function deleteEvent() {
  if (!await flushAutosave()) return;
  if (!state.eventOriginalId || !window.confirm(`確定刪除 Event「${state.eventOriginalId}」？`)) return;
  try {
    await api(`/api/events?node=${encodeURIComponent(state.selectedNodePath)}&id=${encodeURIComponent(state.eventOriginalId)}`, { method: "DELETE" });
    state.selectedEventId = null;
    state.eventOriginalId = null;
    state.eventDraft = null;
    await refreshAfterSave();
    toast("Event 已刪除");
  } catch (error) {
    setSaveState("儲存失敗", "error");
    toast(error.message, "error");
  }
}

function defaultOptionsDraft() {
  return {
    Version: 1,
    Canvas: { Width: 1920, Height: 1080, "Preview Background": "" },
    Elements: [],
  };
}

function defaultOptionItem(index = 1) {
  return {
    ID: generateId("option"),
    Name: `新選項 ${index}`,
    Text: `新選項 ${index}`,
    Trigger: `Action:新選項${index}`,
    "Visible Conditions": [],
    "Enabled Conditions": [],
    Tooltip: "",
    Icon: "",
    "Style Override": {},
  };
}

function defaultOptionElement(type) {
  const offset = (state.optionsDraft?.Elements?.length || 0) * 24;
  const base = {
    ID: generateId("option_element"),
    Name: type === "TEXTBOX" ? "選項清單" : type === "PICTURE" ? "圖片選項" : "互動區域",
    Type: type,
    Layout: { X: 690 + offset, Y: 360 + offset, Width: 540, Height: type === "TEXTBOX" ? 352 : 180, "Z Order": 10 },
    "Visible Conditions": [],
    "Enabled Conditions": [],
  };
  if (type === "TEXTBOX") {
    base.List = {
      "Max Visible Items": 4,
      "Item Height": 72,
      "Item Spacing": 12,
      Padding: 16,
      Scrollbar: "AUTO",
      "Scrollbar Width": 18,
      "Scrollbar Side": "RIGHT",
      Mousewheel: true,
      Draggable: true,
      "Remember Scroll": "RESET",
    };
    base.Style = {
      Background: "#0b1118",
      "Item Background": "#20302a",
      "Item Hover Background": "#2d8068",
      "Item Disabled Background": "#29312e",
      "Text Color": "#ffffff",
      "Text Hover Color": "#ffffff",
      "Text Disabled Color": "#8b948f",
      "Text Size": 30,
      "Text Align": 0.5,
    };
    base.Items = [defaultOptionItem(1)];
  } else if (type === "PICTURE") {
    base.Trigger = "Action:新圖片選項";
    base.Tooltip = "";
    base.Picture = { Idle: "", Hover: "", Pressed: "", Disabled: "", Fit: "CONTAIN", "Keep Aspect": true, "Alpha Hit Test": false, Opacity: 1, Tint: "#ffffff", "Hover Scale": 1 };
    base["Hover Sound"] = "";
    base["Click Sound"] = "";
  } else {
    base.Trigger = "Action:新互動區域";
    base.Tooltip = "";
    base.Hitbox = { "Editor Color": "#28a47d", "Editor Opacity": 0.24, "Hover Image": "", Cursor: "pointer" };
    base["Hover Sound"] = "";
    base["Click Sound"] = "";
  }
  return base;
}

function selectedOptionElement() {
  return state.optionsDraft?.Elements?.find((element) => element.ID === state.selectedOptionElementId) || null;
}

function selectedOptionItem() {
  return selectedOptionElement()?.Items?.find((item) => item.ID === state.selectedOptionItemId) || null;
}

function getNested(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setNested(object, path, value) {
  const keys = path.split(".");
  let target = object;
  keys.slice(0, -1).forEach((key) => {
    if (!target[key] || typeof target[key] !== "object") target[key] = {};
    target = target[key];
  });
  target[keys[keys.length - 1]] = value;
}

function controlValue(control) {
  if (control.type === "checkbox") return control.checked;
  if (control.type === "number" || control.type === "range") return numberValue(control.value);
  return control.value;
}

function optionTypeLabel(type) {
  return ({ TEXTBOX: "Text Box", PICTURE: "Picture", HITBOX: "Hitbox" })[type] || type;
}

function safeColor(value, fallback = "#20302a") {
  const color = String(value || "");
  return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color) ? color : fallback;
}

function colorOpacity(value, fallback = "#20302a") {
  const color = safeColor(value, fallback);
  return color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1;
}

function colorWithOpacity(value, opacity, fallback = "#20302a") {
  const color = safeColor(value, fallback).slice(0, 7);
  const alpha = Math.round(Math.max(0, Math.min(1, numberValue(opacity, 1))) * 255);
  return alpha === 255 ? color : `${color}${alpha.toString(16).padStart(2, "0")}`;
}

function formatSliderValue(value, format = "", suffix = "") {
  const numeric = numberValue(value);
  if (format === "percent") return `${Math.round(numeric * 100)}%`;
  const rounded = Number(numeric.toFixed(2));
  return `${rounded}${suffix}`;
}

function rangeField(label, path, value, { min, max, step = 1, suffix = "", format = "", itemField = false } = {}) {
  const pathAttribute = itemField ? "data-option-item-path" : "data-option-path";
  const current = numberValue(value, min);
  const scale = format === "percent" ? 100 : 1;
  const controlValue = Number((current * scale).toFixed(4));
  const controlMin = Number((min * scale).toFixed(4));
  const controlMax = Number((max * scale).toFixed(4));
  const controlStep = Number((step * scale).toFixed(4));
  const display = formatSliderValue(current, format, suffix);
  const metadata = `data-range-format="${escapeHtml(format)}" data-range-suffix="${escapeHtml(suffix)}" data-range-scale="${scale}"`;
  return `
    <div class="field slider-field">
      <span class="slider-field-heading"><span>${escapeHtml(label)}</span><output>${escapeHtml(display)}</output></span>
      <span class="slider-control">
        <input ${pathAttribute}="${escapeHtml(path)}" ${metadata} type="range" min="${controlMin}" max="${controlMax}" step="${controlStep}" value="${escapeHtml(controlValue)}" aria-label="${escapeHtml(label)}">
        <input ${pathAttribute}="${escapeHtml(path)}" ${metadata} class="slider-number" type="number" min="${controlMin}" max="${controlMax}" step="${controlStep}" value="${escapeHtml(controlValue)}" aria-label="${escapeHtml(label)}精確值">
      </span>
    </div>
  `;
}

function transparentColorField(label, path, value, fallback, itemField = false) {
  const color = safeColor(value, fallback);
  const opaqueColor = color.slice(0, 7);
  const opacity = Math.round(colorOpacity(color, fallback) * 100);
  const colorPath = itemField ? "data-option-item-color-path" : "data-option-color-path";
  return `
    <div class="field transparent-color-field">
      <span>${escapeHtml(label)}</span>
      <span class="transparent-color-control">
        <input ${colorPath}="${escapeHtml(path)}" type="color" value="${escapeHtml(opaqueColor)}" aria-label="${escapeHtml(label)}顏色">
        <span class="color-opacity-control">
          <span class="color-opacity-heading"><span>不透明度</span><output>${opacity}%</output></span>
          <input ${colorPath}="${escapeHtml(path)}" type="range" min="0" max="100" step="1" value="${opacity}" aria-label="${escapeHtml(label)}不透明度">
        </span>
      </span>
    </div>
  `;
}

function assetUrl(path) {
  return path ? `/api/asset?path=${encodeURIComponent(path)}` : "";
}

function customOptionScreenName() {
  const screen = state.nodeDetail?.node?.["Option Screen"] || "";
  if (screen && screen !== "scene_option_renderer") return screen;
  const sourceMatch = state.nodeDetail?.optionSource?.match(/^\s*screen\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m);
  return sourceMatch?.[1] || `option_${state.nodeDetail?.node?.ID || "custom"}`;
}

function textBoxMetrics(element, useMaximum = false) {
  const settings = element.List || {};
  const itemHeight = Math.max(24, numberValue(settings["Item Height"], 72));
  const spacing = Math.max(0, numberValue(settings["Item Spacing"], 12));
  const padding = Math.max(0, numberValue(settings.Padding, 16));
  const maximum = Math.max(1, Math.trunc(numberValue(settings["Max Visible Items"], 4)));
  const actual = Math.max(1, element.Items?.length || 0);
  const rows = useMaximum ? maximum : Math.min(actual, maximum);
  const contentHeight = rows * itemHeight + Math.max(0, rows - 1) * spacing;
  return { itemHeight, spacing, padding, maximum, rows, contentHeight, height: contentHeight + padding * 2 };
}

function markOptionsDirty() {
  scheduleOptionsAutosave();
}

function optionElementListHtml() {
  const elements = state.optionsDraft?.Elements || [];
  if (!elements.length) return `<div class="node-list-empty">尚未建立選項元件</div>`;
  return elements.map((element) => `
    <button class="subnav-item option-element-list-item ${element.ID === state.selectedOptionElementId ? "active" : ""}" type="button" data-option-element-select="${escapeHtml(element.ID)}">
      <span class="subnav-item-copy">
        <strong>${escapeHtml(element.Name || element.ID)}</strong>
        <span>${escapeHtml(optionTypeLabel(element.Type))}${element.Type === "TEXTBOX" ? ` · ${element.Items?.length || 0} 項` : ""}</span>
      </span>
    </button>
  `).join("");
}

function optionStageElementHtml(element) {
  const layout = element.Layout || {};
  const selected = element.ID === state.selectedOptionElementId;
  const width = Math.max(24, numberValue(layout.Width, 100));
  const x = numberValue(layout.X);
  const y = numberValue(layout.Y);
  const z = Math.trunc(numberValue(layout["Z Order"], 10));
  let height = Math.max(24, numberValue(layout.Height, 100));
  let body = "";

  if (element.Type === "TEXTBOX") {
    const metrics = textBoxMetrics(element);
    height = metrics.height;
    const style = element.Style || {};
    const scrollbar = element.List?.Scrollbar || "AUTO";
    const overflowClass = scrollbar === "HIDDEN" ? "scrollbar-hidden" : "";
    const overflowStyle = scrollbar === "ALWAYS" ? "scroll" : "auto";
    const items = element.Items || [];
    body = `
      <div class="option-textbox-preview" style="padding:${metrics.padding}px;background:${safeColor(style.Background, "#0b1118")}">
        <div class="option-scroll-preview ${overflowClass}" style="max-height:${metrics.contentHeight}px;overflow-y:${overflowStyle};gap:${metrics.spacing}px">
          ${items.length ? items.map((item) => `
            <button class="option-text-item ${item.ID === state.selectedOptionItemId ? "selected" : ""}" type="button" data-option-item-select="${escapeHtml(item.ID)}" style="height:${metrics.itemHeight}px;background:${safeColor(style["Item Background"])};color:${safeColor(style["Text Color"], "#ffffff")};font-size:${numberValue(style["Text Size"], 30)}px;text-align:${numberValue(style["Text Align"], 0.5) === 0 ? "left" : numberValue(style["Text Align"], 0.5) === 1 ? "right" : "center"}">
              ${escapeHtml(item.Text || item.Name || item.ID)}
            </button>
          `).join("") : `<div class="option-empty-row" style="height:${metrics.itemHeight}px">尚未建立 Item</div>`}
        </div>
      </div>
    `;
  } else if (element.Type === "PICTURE") {
    const picture = element.Picture || {};
    const idle = picture.Idle || "";
    const fit = picture["Keep Aspect"] === false || picture.Fit === "STRETCH" ? "fill" : picture.Fit === "COVER" ? "cover" : "contain";
    body = idle
      ? `<img class="option-picture-preview" src="${escapeHtml(assetUrl(idle))}" alt="" draggable="false" style="object-fit:${fit};opacity:${numberValue(picture.Opacity, 1)};--picture-hover-scale:${numberValue(picture["Hover Scale"], 1)}">`
      : `<div class="option-picture-placeholder"><span>PICTURE</span><small>選擇 Idle 圖片</small></div>`;
  } else {
    const hitbox = element.Hitbox || {};
    body = `<div class="option-hitbox-preview" style="--hitbox-color:${safeColor(hitbox["Editor Color"], "#28a47d")};--hitbox-opacity:${numberValue(hitbox["Editor Opacity"], 0.24)};cursor:${escapeHtml(hitbox.Cursor || "pointer")}"><span>${escapeHtml(element.Name || "Hitbox")}</span></div>`;
  }

  const handles = selected ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((direction) => `<span class="resize-handle ${direction}" data-option-resize="${direction}"></span>`).join("") : "";
  return `
    <div class="option-stage-element ${selected ? "selected" : ""} type-${element.Type.toLocaleLowerCase()}" data-option-stage-element="${escapeHtml(element.ID)}" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${z}">
      ${body}
      <span class="option-element-caption" data-option-drag-handle>${escapeHtml(element.Name || optionTypeLabel(element.Type))}</span>
      ${handles}
    </div>
  `;
}

function optionStageHtml() {
  const options = state.optionsDraft || defaultOptionsDraft();
  const canvas = options.Canvas || {};
  const width = Math.max(320, numberValue(canvas.Width, 1920));
  const height = Math.max(180, numberValue(canvas.Height, 1080));
  const background = canvas["Preview Background"] || "";
  const elements = [...(options.Elements || [])].sort((a, b) => numberValue(a.Layout?.["Z Order"], 10) - numberValue(b.Layout?.["Z Order"], 10));
  return `
    <div class="option-stage-shell" id="optionStageShell" style="aspect-ratio:${width} / ${height}">
      <div class="option-stage" id="optionStage" style="width:${width}px;height:${height}px">
        ${background ? `<img class="option-stage-background" src="${escapeHtml(assetUrl(background))}" alt="" draggable="false">` : `<div class="option-stage-background option-stage-blank"></div>`}
        <div class="option-stage-grid ${state.optionGridVisible ? "" : "hidden"}" style="background-size:${state.editorSettings.gridSize}px ${state.editorSettings.gridSize}px"></div>
        ${elements.map(optionStageElementHtml).join("")}
      </div>
    </div>
  `;
}

function optionConditionRowsHtml(conditions, scope) {
  if (!conditions?.length) return `<div class="row-empty compact-empty">無條件</div>`;
  return conditions.map((condition, index) => {
    const type = condition.type === "tag" ? "memory" : (condition.type || "stat");
    const isMemory = type === "memory";
    return `
      <div class="option-condition-row" data-option-condition-scope="${escapeHtml(scope)}" data-index="${index}">
        <select data-option-condition-part="type">${optionTags(["stat", "memory"], type)}</select>
        ${isMemory ? `
          <select data-option-condition-part="bank" aria-label="記憶庫">${namedOptionTags(memoryChoices(), condition.bank || "memory")}</select>
          <input data-option-condition-part="id" aria-label="記憶標籤" value="${escapeHtml(condition.id || "")}" placeholder="標籤">
          <select data-option-condition-part="op">${optionTags(["has", "not_has"], condition.op)}</select>
        ` : `
          <select data-option-condition-part="id">${namedOptionTags(statChoices(), condition.id)}</select>
          <select data-option-condition-part="op">${optionTags([">", ">=", "<", "<=", "==", "!="], condition.op)}</select>
          <input data-option-condition-part="value" type="number" step="any" value="${escapeHtml(condition.value ?? 0)}">
        `}
        <button class="row-button" type="button" data-remove-option-condition="${escapeHtml(scope)}:${index}" title="移除條件" aria-label="移除條件">×</button>
      </div>
    `;
  }).join("");
}

function optionConditionSectionHtml(title, conditions, scope) {
  return `
    <div class="option-condition-section">
      <div class="mini-section-heading"><strong>${escapeHtml(title)}</strong><button class="quiet-button compact add-button" type="button" data-add-option-condition="${escapeHtml(scope)}">＋ 新增</button></div>
      <div class="option-condition-list">${optionConditionRowsHtml(conditions || [], scope)}</div>
    </div>
  `;
}

function textBoxItemsHtml(element) {
  const items = element.Items || [];
  return `
    <div class="option-items-list">
      ${items.map((item, index) => `
        <div class="option-item-row">
          <div class="option-item-entry ${item.ID === state.selectedOptionItemId ? "active" : ""}">
            <button type="button" data-option-item-select="${escapeHtml(item.ID)}"><strong>${escapeHtml(item.Name || item.Text || item.ID)}</strong><span>${escapeHtml(actionTriggerName(item.Trigger))}</span></button>
            <button class="option-item-delete" type="button" data-delete-option-item="${escapeHtml(item.ID)}" title="刪除選項" aria-label="刪除選項">×</button>
          </div>
          <div class="option-item-order">
            <button type="button" data-move-option-item="${index}:-1" title="上移" aria-label="上移" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" data-move-option-item="${index}:1" title="下移" aria-label="下移" ${index === items.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </div>
      `).join("") || `<div class="row-empty compact-empty">尚未建立 Item</div>`}
    </div>
  `;
}

function optionInspectorTabsHtml() {
  const tabs = [
    ["content", "內容"],
    ["layout", "版面"],
    ["appearance", "外觀"],
    ["rules", "規則"],
    ["more", "更多"],
  ];
  return `
    <div class="option-inspector-menu" role="tablist" aria-label="選項功能">
      ${tabs.map(([id, label]) => `
        <button class="${state.optionInspectorTab === id ? "active" : ""}" type="button" role="tab" aria-selected="${state.optionInspectorTab === id}" data-option-inspector-tab="${id}">${label}</button>
      `).join("")}
    </div>
  `;
}

function optionInspectorHtml() {
  const element = selectedOptionElement();
  if (!element) {
    return `<div class="option-inspector-empty"><strong>選擇或新增元件</strong></div>`;
  }
  const layout = element.Layout || {};
  const tab = state.optionInspectorTab;
  const common = tab === "content" ? `
      <div class="inspector-section option-menu-section">
        <div class="mini-section-heading"><strong>元件</strong></div>
        <label class="field"><span>名稱</span><input data-option-path="Name" value="${escapeHtml(element.Name || "")}"></label>
      </div>
    ` : tab === "layout" ? `
      <div class="inspector-section option-menu-section">
        <div class="mini-section-heading"><strong>位置與尺寸</strong></div>
        <div class="form-grid two-columns compact-grid">
          <label class="field"><span>X</span><input data-option-path="Layout.X" type="number" value="${escapeHtml(layout.X ?? 0)}"></label>
          <label class="field"><span>Y</span><input data-option-path="Layout.Y" type="number" value="${escapeHtml(layout.Y ?? 0)}"></label>
        </div>
        <div class="form-grid ${element.Type === "TEXTBOX" ? "" : "two-columns"} compact-grid">
          <label class="field"><span>寬度</span><input data-option-path="Layout.Width" type="number" min="24" value="${escapeHtml(layout.Width ?? 100)}"></label>
          ${element.Type === "TEXTBOX" ? "" : `<label class="field"><span>高度</span><input data-option-path="Layout.Height" type="number" min="24" value="${escapeHtml(layout.Height ?? 100)}"></label>`}
        </div>
        <label class="field"><span>圖層順序</span><input data-option-path="Layout.Z Order" type="number" value="${escapeHtml(layout["Z Order"] ?? 10)}"></label>
      </div>
    ` : "";

  let specific = "";
  if (element.Type === "TEXTBOX") {
    const list = element.List || {};
    const style = element.Style || {};
    const item = selectedOptionItem();
    const itemOverride = item?.["Style Override"] || {};
    const hasItemOverride = Object.keys(itemOverride).length > 0;
    if (tab === "content") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>清單項目</strong><button class="quiet-button compact add-button" id="addOptionItem" type="button">＋ 新增</button></div>
          ${textBoxItemsHtml(element)}
        </div>
        ${item ? `
          <div class="inspector-section option-menu-section selected-item-editor">
            <div class="mini-section-heading"><strong>目前選項</strong></div>
            <label class="field"><span>名稱</span><input data-option-item-path="Name" value="${escapeHtml(item.Name || "")}"></label>
            <label class="field"><span>顯示文字</span><input data-option-item-path="Text" value="${escapeHtml(item.Text || "")}"></label>
            <label class="field"><span>Trigger</span><input data-option-item-path="Trigger" value="${escapeHtml(actionTriggerName(item.Trigger))}"></label>
            <label class="field"><span>Tooltip</span><input data-option-item-path="Tooltip" value="${escapeHtml(item.Tooltip || "")}"></label>
            <label class="field"><span>Icon</span><input data-option-item-path="Icon" list="imageAssets" value="${escapeHtml(item.Icon || "")}"></label>
          </div>
        ` : ""}
      `;
    } else if (tab === "layout") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>清單尺寸</strong></div>
          ${rangeField("最多顯示", "List.Max Visible Items", list["Max Visible Items"] ?? 4, { min: 1, max: 20 })}
          ${rangeField("Item 高度", "List.Item Height", list["Item Height"] ?? 72, { min: 24, max: 240, suffix: " px" })}
          ${rangeField("Item 間距", "List.Item Spacing", list["Item Spacing"] ?? 12, { min: 0, max: 120, suffix: " px" })}
          ${rangeField("Padding", "List.Padding", list.Padding ?? 16, { min: 0, max: 160, suffix: " px" })}
        </div>
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>捲動方式</strong></div>
          <label class="field"><span>Scrollbar</span><select data-option-path="List.Scrollbar">${optionTags(["AUTO", "HIDDEN", "ALWAYS"], list.Scrollbar || "AUTO")}</select></label>
          ${rangeField("Scrollbar 寬度", "List.Scrollbar Width", list["Scrollbar Width"] ?? 18, { min: 4, max: 64, suffix: " px" })}
          <label class="field"><span>位置</span><select data-option-path="List.Scrollbar Side">${optionTags(["LEFT", "RIGHT"], list["Scrollbar Side"] || "RIGHT")}</select></label>
          <label class="field"><span>記住位置</span><select data-option-path="List.Remember Scroll">${optionTags(["RESET", "NODE"], list["Remember Scroll"] || "RESET", (value) => value === "RESET" ? "每次重設" : "節點內保留")}</select></label>
          <div class="form-grid two-columns compact-grid">
            <label class="checkbox-field"><input data-option-path="List.Mousewheel" type="checkbox" ${list.Mousewheel !== false ? "checked" : ""}><span>滑鼠滾輪</span></label>
            <label class="checkbox-field"><input data-option-path="List.Draggable" type="checkbox" ${list.Draggable !== false ? "checked" : ""}><span>拖曳捲動</span></label>
          </div>
        </div>
      `;
    } else if (tab === "appearance") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>背景</strong></div>
          <div class="form-grid compact-grid color-grid option-opacity-colors">
            ${transparentColorField("容器", "Style.Background", style.Background, "#0b1118")}
            ${transparentColorField("Item", "Style.Item Background", style["Item Background"], "#20302a")}
            ${transparentColorField("Hover", "Style.Item Hover Background", style["Item Hover Background"], "#2d8068")}
            ${transparentColorField("停用", "Style.Item Disabled Background", style["Item Disabled Background"], "#29312e")}
          </div>
        </div>
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>文字</strong></div>
          <div class="form-grid two-columns compact-grid color-grid">
            <label class="field"><span>一般</span><input data-option-path="Style.Text Color" type="color" value="${safeColor(style["Text Color"], "#ffffff").slice(0, 7)}"></label>
            <label class="field"><span>Hover</span><input data-option-path="Style.Text Hover Color" type="color" value="${safeColor(style["Text Hover Color"], "#ffffff").slice(0, 7)}"></label>
            <label class="field"><span>停用</span><input data-option-path="Style.Text Disabled Color" type="color" value="${safeColor(style["Text Disabled Color"], "#8b948f").slice(0, 7)}"></label>
          </div>
          ${rangeField("字體大小", "Style.Text Size", style["Text Size"] ?? 30, { min: 8, max: 160, suffix: " px" })}
          <label class="field"><span>文字對齊</span><select data-option-path="Style.Text Align">${optionTags([0, 0.5, 1], style["Text Align"] ?? 0.5, (value) => ({ 0: "靠左", 0.5: "置中", 1: "靠右" })[value])}</select></label>
        </div>
        ${item ? `
          <div class="inspector-section option-menu-section">
            <div class="mini-section-heading"><strong>目前選項</strong></div>
            <label class="checkbox-field"><input id="itemStyleOverrideEnabled" type="checkbox" ${hasItemOverride ? "checked" : ""}><span>使用獨立樣式</span></label>
            ${hasItemOverride ? `
              <div class="form-grid compact-grid color-grid option-opacity-colors">
                ${transparentColorField("背景", "Style Override.Item Background", itemOverride["Item Background"], style["Item Background"] || "#20302a", true)}
                ${transparentColorField("Hover", "Style Override.Item Hover Background", itemOverride["Item Hover Background"], style["Item Hover Background"] || "#2d8068", true)}
                <label class="field"><span>文字</span><input data-option-item-path="Style Override.Text Color" type="color" value="${safeColor(itemOverride["Text Color"], style["Text Color"]).slice(0, 7)}"></label>
              </div>
              ${rangeField("字體大小", "Style Override.Text Size", itemOverride["Text Size"] ?? style["Text Size"] ?? 30, { min: 8, max: 160, suffix: " px", itemField: true })}
              <label class="field"><span>文字對齊</span><select data-option-item-path="Style Override.Text Align">${optionTags([0, 0.5, 1], itemOverride["Text Align"] ?? style["Text Align"] ?? 0.5, (value) => ({ 0: "靠左", 0.5: "置中", 1: "靠右" })[value])}</select></label>
            ` : ""}
          </div>
        ` : ""}
      `;
    } else if (tab === "rules") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>元件規則</strong></div>
          ${optionConditionSectionHtml("顯示條件", element["Visible Conditions"], "element-visible")}
          ${optionConditionSectionHtml("可用條件", element["Enabled Conditions"], "element-enabled")}
        </div>
        ${item ? `
          <div class="inspector-section option-menu-section">
            <div class="mini-section-heading"><strong>目前選項規則</strong></div>
            ${optionConditionSectionHtml("顯示條件", item["Visible Conditions"], "item-visible")}
            ${optionConditionSectionHtml("可用條件", item["Enabled Conditions"], "item-enabled")}
          </div>
        ` : ""}
      `;
    }
  } else if (element.Type === "PICTURE") {
    const picture = element.Picture || {};
    if (tab === "content") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>圖片與動作</strong></div>
          <label class="field"><span>Trigger</span><input data-option-path="Trigger" value="${escapeHtml(actionTriggerName(element.Trigger))}"></label>
          <label class="field"><span>Idle 圖片</span><input data-option-path="Picture.Idle" list="imageAssets" value="${escapeHtml(picture.Idle || "")}"></label>
          <label class="field"><span>Hover 圖片</span><input data-option-path="Picture.Hover" list="imageAssets" value="${escapeHtml(picture.Hover || "")}"></label>
          <label class="field"><span>Pressed 圖片</span><input data-option-path="Picture.Pressed" list="imageAssets" value="${escapeHtml(picture.Pressed || "")}"></label>
          <label class="field"><span>Disabled 圖片</span><input data-option-path="Picture.Disabled" list="imageAssets" value="${escapeHtml(picture.Disabled || "")}"></label>
          <label class="field"><span>Tooltip</span><input data-option-path="Tooltip" value="${escapeHtml(element.Tooltip || "")}"></label>
        </div>
      `;
    } else if (tab === "layout") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>圖片填充</strong></div>
          <label class="field"><span>填充方式</span><select data-option-path="Picture.Fit">${optionTags(["CONTAIN", "COVER", "STRETCH"], picture.Fit || "CONTAIN")}</select></label>
          <label class="checkbox-field"><input data-option-path="Picture.Keep Aspect" type="checkbox" ${picture["Keep Aspect"] !== false ? "checked" : ""}><span>保持長寬比</span></label>
        </div>
      `;
    } else if (tab === "appearance") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>顯示效果</strong></div>
          ${rangeField("不透明度", "Picture.Opacity", picture.Opacity ?? 1, { min: 0, max: 1, step: 0.01, format: "percent" })}
          ${rangeField("Hover Scale", "Picture.Hover Scale", picture["Hover Scale"] ?? 1, { min: 0.1, max: 5, step: 0.05, suffix: "×" })}
          <label class="field"><span>Tint</span><input data-option-path="Picture.Tint" type="color" value="${safeColor(picture.Tint, "#ffffff").slice(0, 7)}"></label>
          <label class="checkbox-field"><input data-option-path="Picture.Alpha Hit Test" type="checkbox" ${picture["Alpha Hit Test"] ? "checked" : ""}><span>只讓不透明部分可點擊</span></label>
        </div>
      `;
    } else if (tab === "rules") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>圖片規則</strong></div>
          ${optionConditionSectionHtml("顯示條件", element["Visible Conditions"], "element-visible")}
          ${optionConditionSectionHtml("可用條件", element["Enabled Conditions"], "element-enabled")}
        </div>
      `;
    } else if (tab === "more") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>聲音</strong></div>
          <label class="field"><span>Hover Sound</span><input data-option-path="Hover Sound" value="${escapeHtml(element["Hover Sound"] || "")}"></label>
          <label class="field"><span>Click Sound</span><input data-option-path="Click Sound" value="${escapeHtml(element["Click Sound"] || "")}"></label>
        </div>
      `;
    }
  } else {
    const hitbox = element.Hitbox || {};
    if (tab === "content") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>互動內容</strong></div>
          <label class="field"><span>Trigger</span><input data-option-path="Trigger" value="${escapeHtml(actionTriggerName(element.Trigger))}"></label>
          <label class="field"><span>Tooltip</span><input data-option-path="Tooltip" value="${escapeHtml(element.Tooltip || "")}"></label>
        </div>
      `;
    } else if (tab === "appearance") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>編輯器預覽</strong></div>
          <label class="field"><span>顏色</span><input data-option-path="Hitbox.Editor Color" type="color" value="${safeColor(hitbox["Editor Color"], "#28a47d").slice(0, 7)}"></label>
          ${rangeField("不透明度", "Hitbox.Editor Opacity", hitbox["Editor Opacity"] ?? 0.24, { min: 0, max: 1, step: 0.01, format: "percent" })}
          <label class="field"><span>Hover 圖片</span><input data-option-path="Hitbox.Hover Image" list="imageAssets" value="${escapeHtml(hitbox["Hover Image"] || "")}"></label>
          <label class="field"><span>Cursor</span><input data-option-path="Hitbox.Cursor" value="${escapeHtml(hitbox.Cursor || "pointer")}"></label>
        </div>
      `;
    } else if (tab === "rules") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>互動規則</strong></div>
          ${optionConditionSectionHtml("顯示條件", element["Visible Conditions"], "element-visible")}
          ${optionConditionSectionHtml("可用條件", element["Enabled Conditions"], "element-enabled")}
        </div>
      `;
    } else if (tab === "more") {
      specific = `
        <div class="inspector-section option-menu-section">
          <div class="mini-section-heading"><strong>聲音</strong></div>
          <label class="field"><span>Hover Sound</span><input data-option-path="Hover Sound" value="${escapeHtml(element["Hover Sound"] || "")}"></label>
          <label class="field"><span>Click Sound</span><input data-option-path="Click Sound" value="${escapeHtml(element["Click Sound"] || "")}"></label>
        </div>
      `;
    }
  }
  const optionMode = state.nodeDetail.node["Option Mode"] || "DATA";
  const custom = tab === "more" ? `
    <div class="inspector-section option-menu-section option-custom-editor-section">
      <div class="mini-section-heading"><strong>選項來源</strong></div>
      <label class="field"><span>模式</span><select id="optionMode">${optionTags(["DATA", "CUSTOM"], optionMode, (value) => value === "DATA" ? "資料化選項" : "自訂 RPY")}</select></label>
      ${optionMode === "CUSTOM" ? `
        <label class="field"><span>Custom Screen</span><input id="customOptionScreen" value="${escapeHtml(customOptionScreenName())}" placeholder="scene_option_custom"></label>
        <textarea class="raw-option-editor" id="optionEditor" spellcheck="false">${escapeHtml(state.nodeDetail.optionSource || "")}</textarea>
      ` : ""}
    </div>
  ` : "";
  return `
    ${optionInspectorTabsHtml()}
    <div class="option-inspector-pane" role="tabpanel" data-option-inspector-pane="${escapeHtml(tab)}">
      ${common}${specific}${custom}
      ${tab === "more" ? `<div class="inspector-danger-zone"><button class="danger-button compact" id="deleteOptionElement" type="button">刪除元件</button></div>` : ""}
    </div>
  `;
}

function captureOptionsPanelView() {
  const builder = dom.optionsPanel.querySelector(".option-builder");
  if (!builder) return null;
  const inspector = builder.querySelector(".option-inspector");
  const elementList = builder.querySelector(".option-element-sidebar .subnav-list");
  const canvas = builder.querySelector(".option-canvas-scroll");
  return {
    nodePath: builder.dataset.nodePath || "",
    elementId: builder.dataset.elementId || "",
    inspectorScrollTop: inspector?.scrollTop || 0,
    elementListScrollTop: elementList?.scrollTop || 0,
    canvasScrollTop: canvas?.scrollTop || 0,
    canvasScrollLeft: canvas?.scrollLeft || 0,
  };
}

function restoreOptionsPanelView(view) {
  if (!view || view.nodePath !== state.selectedNodePath) return;
  const builder = dom.optionsPanel.querySelector(".option-builder");
  const elementList = builder?.querySelector(".option-element-sidebar .subnav-list");
  const canvas = builder?.querySelector(".option-canvas-scroll");
  if (elementList) elementList.scrollTop = view.elementListScrollTop;
  if (canvas) {
    canvas.scrollTop = view.canvasScrollTop;
    canvas.scrollLeft = view.canvasScrollLeft;
  }
  if (view.elementId === state.selectedOptionElementId) {
    const inspector = builder?.querySelector(".option-inspector");
    if (inspector) inspector.scrollTop = view.inspectorScrollTop;
  }
}

function renderOptionsPanel() {
  const view = captureOptionsPanelView();
  if (!state.nodeDetail) {
    dom.optionsPanel.innerHTML = "";
    return;
  }
  if (!state.optionsDraft) state.optionsDraft = clone(state.nodeDetail.options || defaultOptionsDraft());
  const canvas = state.optionsDraft.Canvas || {};
  const layoutClasses = [
    state.optionElementsHidden ? "elements-hidden" : "",
    state.optionInspectorHidden ? "inspector-hidden" : "",
  ].filter(Boolean).join(" ");
  dom.optionsPanel.innerHTML = `
    <div class="option-builder ${layoutClasses}" data-node-path="${escapeHtml(state.selectedNodePath || "")}" data-element-id="${escapeHtml(state.selectedOptionElementId || "")}">
      <aside class="option-element-sidebar">
        <div class="option-add-buttons">
          <button class="quiet-button compact add-button" type="button" data-add-option-element="TEXTBOX">Text Box</button>
          <button class="quiet-button compact add-button" type="button" data-add-option-element="PICTURE">Picture</button>
          <button class="quiet-button compact add-button" type="button" data-add-option-element="HITBOX">Hitbox</button>
        </div>
        <div class="subnav-list">${optionElementListHtml()}</div>
      </aside>
      <section class="option-canvas-column">
        <div class="option-builder-toolbar">
          <div class="option-view-controls" aria-label="工作區面板">
            <button class="toggle-button ${state.optionGridVisible ? "active" : ""}" id="toggleOptionGrid" type="button" title="顯示或隱藏格線（${shortcutDisplay(state.editorSettings.shortcuts.grid)}）">格線</button>
            <button class="toggle-button ${state.optionSnapEnabled ? "active" : ""}" id="toggleOptionSnap" type="button" title="開啟或關閉吸附（${shortcutDisplay(state.editorSettings.shortcuts.snap)}）">吸附</button>
          </div>
          <label class="field inline-field canvas-path-field"><input data-canvas-path="Preview Background" aria-label="預覽底圖路徑" list="imageAssets" value="${escapeHtml(canvas["Preview Background"] || "")}" placeholder="images/room.png"></label>
          <span class="canvas-size-label">${escapeHtml(canvas.Width || 1920)} × ${escapeHtml(canvas.Height || 1080)}</span>
        </div>
        <div class="option-canvas-scroll">${optionStageHtml()}</div>
      </section>
      <aside class="option-inspector">${optionInspectorHtml()}</aside>
    </div>
  `;
  bindOptionsPanel();
  restoreOptionsPanelView(view);
}

function optionConditionTarget(scope) {
  const element = selectedOptionElement();
  const item = selectedOptionItem();
  if (!element) return null;
  if (scope === "element-visible") return element["Visible Conditions"];
  if (scope === "element-enabled") return element["Enabled Conditions"];
  if (scope === "item-visible") return item?.["Visible Conditions"];
  if (scope === "item-enabled") return item?.["Enabled Conditions"];
  return null;
}

function refreshOptionStage() {
  const oldStage = document.querySelector("#optionStageShell");
  if (!oldStage) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = optionStageHtml();
  oldStage.replaceWith(wrapper.firstElementChild);
  bindOptionStageInteractions();
  updateOptionStageScale();
}

function updateOptionStageScale() {
  const shell = document.querySelector("#optionStageShell");
  const stage = document.querySelector("#optionStage");
  const scroll = document.querySelector(".option-canvas-scroll");
  if (!shell || !stage || !scroll) return;
  const width = Math.max(320, numberValue(state.optionsDraft?.Canvas?.Width, 1920));
  const height = Math.max(180, numberValue(state.optionsDraft?.Canvas?.Height, 1080));
  const scrollStyle = getComputedStyle(scroll);
  const availableWidth = scroll.clientWidth - parseFloat(scrollStyle.paddingLeft) - parseFloat(scrollStyle.paddingRight);
  const availableHeight = scroll.clientHeight - parseFloat(scrollStyle.paddingTop) - parseFloat(scrollStyle.paddingBottom);
  const targetWidth = Math.max(320, Math.min(availableWidth, availableHeight * width / height));
  shell.style.width = `${targetWidth}px`;
  shell.style.height = `${targetWidth * height / width}px`;
  stage.style.transform = `scale(${targetWidth / width})`;
}

function addOptionElement(type) {
  const element = defaultOptionElement(type);
  state.optionsDraft.Elements.push(element);
  state.selectedOptionElementId = element.ID;
  state.selectedOptionItemId = element.Items?.[0]?.ID || null;
  state.optionInspectorTab = "content";
  markOptionsDirty();
  renderOptionsPanel();
}

function deleteOptionElement() {
  const element = selectedOptionElement();
  if (!element || !window.confirm(`確定刪除「${element.Name}」？`)) return;
  const index = state.optionsDraft.Elements.findIndex((item) => item.ID === element.ID);
  state.optionsDraft.Elements.splice(index, 1);
  const next = state.optionsDraft.Elements[Math.min(index, state.optionsDraft.Elements.length - 1)] || null;
  state.selectedOptionElementId = next?.ID || null;
  state.selectedOptionItemId = next?.Items?.[0]?.ID || null;
  markOptionsDirty();
  renderOptionsPanel();
}

function addOptionItem() {
  const element = selectedOptionElement();
  if (!element || element.Type !== "TEXTBOX") return;
  const item = defaultOptionItem(element.Items.length + 1);
  element.Items.push(item);
  state.selectedOptionItemId = item.ID;
  markOptionsDirty();
  renderOptionsPanel();
}

function deleteOptionItem(itemId = state.selectedOptionItemId) {
  const element = selectedOptionElement();
  const item = element?.Items?.find((entry) => entry.ID === itemId);
  if (!element || !item || !window.confirm(`確定刪除「${item.Name}」？`)) return;
  const index = element.Items.findIndex((entry) => entry.ID === item.ID);
  element.Items.splice(index, 1);
  state.selectedOptionItemId = element.Items[Math.min(index, element.Items.length - 1)]?.ID || null;
  markOptionsDirty();
  renderOptionsPanel();
}

function moveOptionItem(index, direction) {
  const element = selectedOptionElement();
  if (!element?.Items) return;
  const next = index + direction;
  if (next < 0 || next >= element.Items.length) return;
  [element.Items[index], element.Items[next]] = [element.Items[next], element.Items[index]];
  markOptionsDirty();
  renderOptionsPanel();
}

function updateOptionField(control, itemField = false) {
  const target = itemField ? selectedOptionItem() : selectedOptionElement();
  const path = itemField ? control.dataset.optionItemPath : control.dataset.optionPath;
  if (!target || !path) return;
  const sliderControl = control.closest(".slider-control");
  let value = controlValue(control);
  if (sliderControl) {
    sliderControl.querySelectorAll("input").forEach((input) => {
      if (input !== control) input.value = control.value;
    });
    const output = sliderControl.closest(".slider-field")?.querySelector("output");
    const scale = Math.max(1, numberValue(control.dataset.rangeScale, 1));
    if (output) output.textContent = formatSliderValue(numberValue(control.value) / scale, control.dataset.rangeFormat, control.dataset.rangeSuffix);
    value /= scale;
  }
  setNested(target, path, path === "Trigger" ? actionTriggerValue(value) : value);
  if (target.Type === "TEXTBOX") target.Layout.Height = textBoxMetrics(target).height;
  markOptionsDirty();
  refreshOptionStage();
}

function updateOptionColor(control, itemField = false) {
  const target = itemField ? selectedOptionItem() : selectedOptionElement();
  const path = itemField ? control.dataset.optionItemColorPath : control.dataset.optionColorPath;
  if (!target || !path) return;
  const group = control.closest(".transparent-color-control");
  const colorControl = group?.querySelector('input[type="color"]');
  const opacityControl = group?.querySelector('input[type="range"]');
  const opacity = numberValue(opacityControl?.value, 100) / 100;
  setNested(target, path, colorWithOpacity(colorControl?.value || "#000000", opacity));
  const output = group?.querySelector("output");
  if (output) output.textContent = `${Math.round(opacity * 100)}%`;
  markOptionsDirty();
  refreshOptionStage();
}

function updateConditionControl(control) {
  const row = control.closest("[data-option-condition-scope]");
  if (!row) return;
  const conditions = optionConditionTarget(row.dataset.optionConditionScope);
  const condition = conditions?.[Number(row.dataset.index)];
  if (!condition) return;
  const part = control.dataset.optionConditionPart;
  condition[part] = part === "value" ? numberValue(control.value) : control.value;
  if (part === "type") {
    if (control.value === "memory") {
      condition.bank = memoryChoices()[0]?.id || "memory";
      condition.id = "新標籤";
      condition.op = "has";
      delete condition.value;
    } else {
      delete condition.bank;
      condition.id = statChoices()[0]?.id || "";
      condition.op = ">=";
      condition.value = 0;
    }
    markOptionsDirty();
    renderOptionsPanel();
  } else {
    markOptionsDirty();
  }
}

function bindOptionsPanel() {
  document.querySelector("#saveOptionsButton")?.addEventListener("click", saveOptions);
  document.querySelector("#toggleOptionElementsPanel")?.addEventListener("click", toggleActiveLeftPanel);
  document.querySelector("#closeOptionElementsPanel")?.addEventListener("click", toggleActiveLeftPanel);
  document.querySelector("#toggleOptionInspectorPanel")?.addEventListener("click", toggleActiveRightPanel);
  document.querySelector("#closeOptionInspectorPanel")?.addEventListener("click", toggleActiveRightPanel);
  document.querySelector("#toggleOptionGrid")?.addEventListener("click", toggleOptionGrid);
  document.querySelector("#toggleOptionSnap")?.addEventListener("click", toggleOptionSnap);
  const inspectorTabs = [...document.querySelectorAll("[data-option-inspector-tab]")];
  inspectorTabs.forEach((button, index) => {
    button.addEventListener("click", () => {
      state.optionInspectorTab = button.dataset.optionInspectorTab;
      renderOptionsPanel();
      const inspector = dom.optionsPanel.querySelector(".option-inspector");
      if (inspector) inspector.scrollTop = 0;
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? inspectorTabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + inspectorTabs.length) % inspectorTabs.length;
      const nextTab = inspectorTabs[nextIndex].dataset.optionInspectorTab;
      state.optionInspectorTab = nextTab;
      renderOptionsPanel();
      requestAnimationFrame(() => document.querySelector(`[data-option-inspector-tab="${nextTab}"]`)?.focus());
    });
  });
  document.querySelectorAll("[data-add-option-element]").forEach((button) => button.addEventListener("click", () => addOptionElement(button.dataset.addOptionElement)));
  document.querySelectorAll("[data-option-element-select]").forEach((button) => button.addEventListener("click", () => {
    state.selectedOptionElementId = button.dataset.optionElementSelect;
    state.selectedOptionItemId = selectedOptionElement()?.Items?.[0]?.ID || null;
    renderOptionsPanel();
  }));
  document.querySelector("#deleteOptionElement")?.addEventListener("click", deleteOptionElement);
  document.querySelector("#addOptionItem")?.addEventListener("click", addOptionItem);
  document.querySelectorAll("[data-delete-option-item]").forEach((button) => button.addEventListener("click", () => deleteOptionItem(button.dataset.deleteOptionItem)));
  document.querySelector("#itemStyleOverrideEnabled")?.addEventListener("change", (event) => {
    const item = selectedOptionItem();
    const style = selectedOptionElement()?.Style || {};
    if (!item) return;
    item["Style Override"] = event.target.checked ? {
      "Item Background": style["Item Background"] || "#20302a",
      "Item Hover Background": style["Item Hover Background"] || "#2d8068",
      "Text Color": style["Text Color"] || "#ffffff",
      "Text Size": style["Text Size"] ?? 30,
      "Text Align": style["Text Align"] ?? 0.5,
    } : {};
    state.optionInspectorTab = "appearance";
    markOptionsDirty();
    renderOptionsPanel();
  });
  document.querySelectorAll(".option-inspector [data-option-item-select]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    state.selectedOptionItemId = button.dataset.optionItemSelect;
    renderOptionsPanel();
  }));
  document.querySelectorAll("[data-move-option-item]").forEach((button) => button.addEventListener("click", () => {
    const [index, direction] = button.dataset.moveOptionItem.split(":").map(Number);
    moveOptionItem(index, direction);
  }));
  document.querySelectorAll("[data-add-option-condition]").forEach((button) => button.addEventListener("click", () => {
    const conditions = optionConditionTarget(button.dataset.addOptionCondition);
    if (!conditions) return;
    conditions.push(defaultStatCondition() || defaultMemoryCondition());
    state.optionInspectorTab = "rules";
    markOptionsDirty();
    renderOptionsPanel();
  }));
  document.querySelectorAll("[data-remove-option-condition]").forEach((button) => button.addEventListener("click", () => {
    const [scope, rawIndex] = button.dataset.removeOptionCondition.split(":");
    optionConditionTarget(scope)?.splice(Number(rawIndex), 1);
    state.optionInspectorTab = "rules";
    markOptionsDirty();
    renderOptionsPanel();
  }));

  dom.optionsPanel.querySelectorAll("[data-option-path]").forEach((control) => {
    control.addEventListener("input", () => updateOptionField(control));
  });
  dom.optionsPanel.querySelectorAll("[data-option-item-path]").forEach((control) => {
    control.addEventListener("input", () => updateOptionField(control, true));
  });
  dom.optionsPanel.querySelectorAll("[data-option-color-path]").forEach((control) => {
    control.addEventListener("input", () => updateOptionColor(control));
  });
  dom.optionsPanel.querySelectorAll("[data-option-item-color-path]").forEach((control) => {
    control.addEventListener("input", () => updateOptionColor(control, true));
  });
  dom.optionsPanel.querySelectorAll("[data-option-condition-part]").forEach((control) => {
    control.addEventListener("change", () => updateConditionControl(control));
    if (["id", "value"].includes(control.dataset.optionConditionPart)) {
      control.addEventListener("input", () => updateConditionControl(control));
    }
  });
  dom.optionsPanel.querySelector("[data-canvas-path]")?.addEventListener("input", (event) => {
    state.optionsDraft.Canvas[event.target.dataset.canvasPath] = event.target.value;
    markOptionsDirty();
    refreshOptionStage();
  });
  document.querySelector("#optionMode")?.addEventListener("change", (event) => {
    state.nodeDetail.node["Option Mode"] = event.target.value;
    if (event.target.value === "DATA") {
      state.nodeDetail.node["Option Screen"] = "scene_option_renderer";
    } else if (state.nodeDetail.node["Option Screen"] === "scene_option_renderer") {
      state.nodeDetail.node["Option Screen"] = customOptionScreenName();
    }
    markOptionsDirty();
    renderOptionsPanel();
  });
  document.querySelector("#customOptionScreen")?.addEventListener("input", (event) => {
    state.nodeDetail.node["Option Screen"] = event.target.value;
    markOptionsDirty();
  });
  document.querySelector("#optionEditor")?.addEventListener("input", (event) => {
    state.nodeDetail.optionSource = event.target.value;
    markOptionsDirty();
  });
  bindOptionStageInteractions();
  requestAnimationFrame(updateOptionStageScale);
  if (state.optionResizeObserver) state.optionResizeObserver.disconnect();
  state.optionResizeObserver = new ResizeObserver(updateOptionStageScale);
  const canvas = document.querySelector(".option-canvas-scroll");
  if (canvas) state.optionResizeObserver.observe(canvas);
}

function bindOptionStageInteractions() {
  document.querySelectorAll("#optionStage [data-option-item-select]").forEach((button) => button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    state.selectedOptionItemId = button.dataset.optionItemSelect;
    renderOptionsPanel();
  }));
  document.querySelectorAll("#optionStage [data-option-stage-element]").forEach((elementNode) => elementNode.addEventListener("pointerdown", beginOptionPointer));
}

function beginOptionPointer(event) {
  if (event.button !== 0 || event.target.closest("[data-option-item-select]")) return;
  event.preventDefault();
  const node = event.currentTarget;
  const element = state.optionsDraft.Elements.find((item) => item.ID === node.dataset.optionStageElement);
  if (!element) return;
  state.selectedOptionElementId = element.ID;
  if (element.Type === "TEXTBOX" && !state.selectedOptionItemId) state.selectedOptionItemId = element.Items?.[0]?.ID || null;
  const direction = event.target.dataset.optionResize || (event.target.closest("[data-option-drag-handle]") || element.Type !== "TEXTBOX" ? "move" : null);
  if (!direction) return;
  const shell = document.querySelector("#optionStageShell");
  const scale = shell.clientWidth / Math.max(320, numberValue(state.optionsDraft.Canvas.Width, 1920));
  try {
    node.setPointerCapture?.(event.pointerId);
  } catch (_error) {
    // Synthetic pointer events used by editor tests do not own a browser pointer.
  }
  const start = { x: event.clientX, y: event.clientY, layout: clone(element.Layout), maxVisible: element.List?.["Max Visible Items"] || 4 };
  let moved = false;

  const onMove = (moveEvent) => {
    const dx = (moveEvent.clientX - start.x) / scale;
    const dy = (moveEvent.clientY - start.y) / scale;
    const canvasWidth = numberValue(state.optionsDraft.Canvas.Width, 1920);
    const canvasHeight = numberValue(state.optionsDraft.Canvas.Height, 1080);
    const layout = element.Layout;
    if (direction === "move") {
      const height = element.Type === "TEXTBOX" ? textBoxMetrics(element).height : numberValue(layout.Height, 100);
      layout.X = clampOptionValue(start.layout.X + dx, 0, canvasWidth - layout.Width);
      layout.Y = clampOptionValue(start.layout.Y + dy, 0, canvasHeight - height);
    } else {
      if (direction.includes("e")) layout.Width = clampOptionValue(start.layout.Width + dx, 24, canvasWidth - start.layout.X);
      if (direction.includes("w")) {
        const right = start.layout.X + start.layout.Width;
        layout.X = clampOptionValue(start.layout.X + dx, 0, right - 24);
        layout.Width = Math.round(right - layout.X);
      }
      if (element.Type === "TEXTBOX" && (direction.includes("n") || direction.includes("s"))) {
        const metrics = textBoxMetrics(element, true);
        const startHeight = start.maxVisible * metrics.itemHeight + Math.max(0, start.maxVisible - 1) * metrics.spacing + metrics.padding * 2;
        const desired = direction.includes("s") ? startHeight + dy : startHeight - dy;
        const rows = Math.max(1, Math.min(20, Math.round((desired - metrics.padding * 2 + metrics.spacing) / (metrics.itemHeight + metrics.spacing))));
        element.List["Max Visible Items"] = rows;
        layout.Height = textBoxMetrics(element).height;
        if (direction.includes("n")) layout.Y = clampOptionValue(start.layout.Y + startHeight - textBoxMetrics(element, true).height, 0, canvasHeight - textBoxMetrics(element).height);
      } else if (element.Type !== "TEXTBOX") {
        if (direction.includes("s")) layout.Height = clampOptionValue(start.layout.Height + dy, 24, canvasHeight - start.layout.Y);
        if (direction.includes("n")) {
          const bottom = start.layout.Y + start.layout.Height;
          layout.Y = clampOptionValue(start.layout.Y + dy, 0, bottom - 24);
          layout.Height = Math.round(bottom - layout.Y);
        }
      }
    }
    moved = true;
    node.style.left = `${layout.X}px`;
    node.style.top = `${layout.Y}px`;
    node.style.width = `${layout.Width}px`;
    node.style.height = `${element.Type === "TEXTBOX" ? textBoxMetrics(element).height : layout.Height}px`;
    document.querySelectorAll("[data-option-path]").forEach((control) => {
      const value = getNested(element, control.dataset.optionPath);
      if (value !== undefined && control.type !== "checkbox" && document.activeElement !== control) control.value = value;
    });
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    try {
      node.releasePointerCapture?.(event.pointerId);
    } catch (_error) {
      // The pointer may already have been released when focus leaves the canvas.
    }
    if (moved) markOptionsDirty();
    if (moved || !node.classList.contains("selected")) renderOptionsPanel();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
}

function clampOptionValue(value, minimum, maximum) {
  const clamped = Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
  const grid = Math.max(1, numberValue(state.editorSettings.gridSize, 24));
  return Math.round(state.optionSnapEnabled ? Math.round(clamped / grid) * grid : clamped);
}

function toggleOptionGrid() {
  state.optionGridVisible = !state.optionGridVisible;
  localStorage.setItem(GRID_VISIBLE_KEY, String(state.optionGridVisible));
  renderOptionsPanel();
}

function toggleOptionSnap() {
  state.optionSnapEnabled = !state.optionSnapEnabled;
  localStorage.setItem(SNAP_ENABLED_KEY, String(state.optionSnapEnabled));
  renderOptionsPanel();
}

function optionsSnapshot() {
  const mode = state.nodeDetail?.node?.["Option Mode"] || "DATA";
  const customScreen = state.nodeDetail?.node?.["Option Screen"] || "";
  return {
    node: state.selectedNodePath,
    options: clone(state.optionsDraft),
    source: state.nodeDetail?.optionSource || "",
    optionMode: mode,
    optionScreen: mode === "DATA" ? "scene_option_renderer" : customScreen,
  };
}

async function persistOptionsSnapshot(snapshot) {
  const saved = await api("/api/options", { method: "PUT", body: snapshot });
  if (state.selectedNodePath !== snapshot.node || !state.nodeDetail) return saved;
  state.nodeDetail.options = clone(saved.options || snapshot.options);
  if (saved.node) state.nodeDetail.node = saved.node;
  return saved;
}

function scheduleOptionsAutosave() {
  if (!state.nodeDetail || !state.optionsDraft) return;
  const snapshot = optionsSnapshot();
  scheduleAutosave("選項設定未能儲存", () => persistOptionsSnapshot(snapshot));
}

async function saveOptions() {
  const snapshot = optionsSnapshot();
  discardPendingAutosave();
  await autosaveInFlight;
  setSaveState("儲存中", "saving");
  try {
    const saved = await persistOptionsSnapshot(snapshot);
    state.optionsDraft = clone(saved.options);
    state.nodeDetail.options = clone(saved.options);
    if (saved.node) state.nodeDetail.node = saved.node;
    setSaveState("已同步");
    toast("Options.json 已儲存");
    renderOptionsPanel();
  } catch (error) {
    setSaveState("儲存失敗", "error");
    toast(error.message, "error");
  }
}

function fileListHtml(files, selected, dataName) {
  if (!files.length) return `<div class="node-list-empty">尚未建立文件</div>`;
  return files.map((file) => {
    const symbols = [...(file.labels || []), ...(file.screens || [])];
    return `
      <button class="subnav-item ${file.name === selected ? "active" : ""}" type="button" data-${dataName}="${escapeHtml(file.name)}">
        <span class="subnav-item-copy">
          <strong>${escapeHtml(file.displayName || file.name)}</strong>
          <span>${escapeHtml(file.name)}.rpy · ${escapeHtml(symbols.join(", ") || "尚未偵測到宣告")}</span>
        </span>
      </button>
    `;
  }).join("");
}

function renderContentPanel() {
  if (!state.nodeDetail) {
    dom.contentPanel.innerHTML = "";
    return;
  }
  const files = state.nodeDetail.contents || [];
  dom.contentPanel.innerHTML = `
    <div class="file-workspace content-workspace ${state.leftPanelHidden.content ? "left-panel-hidden" : ""}">
      <aside class="subnav">
        <div class="subnav-header"><strong>CONTENT</strong><div class="subnav-header-actions"><button class="icon-button add-button" id="newContentButton" type="button" title="新增 Content" aria-label="新增 Content">＋</button></div></div>
        <div class="subnav-list">${fileListHtml(files, state.selectedContent, "content-file")}</div>
      </aside>
      <div class="editor-scroll">
        ${state.selectedContent ? `
          <div class="code-toolbar">
            <label class="field" style="width:min(320px,60%)"><span class="visually-hidden">Content 名稱</span><input id="contentDisplayName" value="${escapeHtml(state.selectedContentDisplayName || state.selectedContent)}"></label>
            <button class="danger-button compact content-delete-button" id="deleteContentButton" type="button">刪除演出</button>
          </div>
          <div class="code-editor-wrap"><textarea class="code-editor" id="contentEditor" spellcheck="false">${escapeHtml(state.contentSource)}</textarea></div>
        ` : `<div class="editor-empty"><div><p>選擇或新增 Content 文件。</p><button class="primary-button add-button" id="emptyNewContentButton" type="button">新增 Content</button></div></div>`}
      </div>
    </div>
  `;
  document.querySelectorAll("[data-content-file]").forEach((button) => button.addEventListener("click", () => loadContent(button.dataset.contentFile)));
  document.querySelector("#newContentButton")?.addEventListener("click", () => openNameDialog("content"));
  document.querySelector("#emptyNewContentButton")?.addEventListener("click", () => openNameDialog("content"));
  document.querySelector("#saveContentButton")?.addEventListener("click", saveContent);
  document.querySelector("#deleteContentButton")?.addEventListener("click", deleteContent);
  document.querySelector("#contentDisplayName")?.addEventListener("input", scheduleContentAutosave);
  document.querySelector("#contentEditor")?.addEventListener("input", scheduleContentAutosave);
  syncShortcutTitles();
}

async function loadContent(name, rerender = true) {
  if (name !== state.selectedContent && !await flushAutosave()) return;
  try {
    const data = await api(`/api/content?node=${encodeURIComponent(state.selectedNodePath)}&name=${encodeURIComponent(name)}`);
    state.selectedContent = data.name;
    state.selectedContentDisplayName = data.displayName || data.name;
    state.contentSource = data.source;
    if (rerender) renderContentPanel();
    updateDatalists();
  } catch (error) {
    toast(error.message, "error");
  }
}

function contentSnapshot() {
  return {
    node: state.selectedNodePath,
    originalName: state.selectedContent,
    id: state.selectedContent,
    displayName: document.querySelector("#contentDisplayName")?.value.trim() || state.selectedContentDisplayName,
    source: document.querySelector("#contentEditor")?.value ?? state.contentSource,
  };
}

async function persistContentSnapshot(snapshot) {
  const saved = await api("/api/content", { method: "POST", body: snapshot });
  if (state.selectedNodePath !== snapshot.node || state.selectedContent !== snapshot.originalName) return saved;
  state.selectedContent = saved.name;
  state.selectedContentDisplayName = saved.displayName;
  state.contentSource = snapshot.source;
  const entry = state.nodeDetail?.contents?.find((file) => file.name === snapshot.originalName);
  if (entry) {
    entry.name = saved.name;
    entry.displayName = saved.displayName;
  }
  return saved;
}

function scheduleContentAutosave() {
  if (!state.selectedContent) return;
  const snapshot = contentSnapshot();
  state.selectedContentDisplayName = snapshot.displayName;
  state.contentSource = snapshot.source;
  scheduleAutosave("Content 未能儲存", () => persistContentSnapshot(snapshot));
}

async function saveContent() {
  const snapshot = contentSnapshot();
  discardPendingAutosave();
  await autosaveInFlight;
  setSaveState("儲存中", "saving");
  try {
    const saved = await persistContentSnapshot(snapshot);
    state.selectedContent = saved.name;
    state.selectedContentDisplayName = saved.displayName;
    await refreshAfterSave();
    await loadContent(saved.name);
    toast("Content 已儲存");
  } catch (error) {
    setSaveState("儲存失敗", "error");
    toast(error.message, "error");
  }
}

async function deleteContent() {
  if (!await flushAutosave()) return;
  if (!state.selectedContent || !window.confirm(`確定刪除 Content「${state.selectedContent}.rpy」？`)) return;
  try {
    await api(`/api/content?node=${encodeURIComponent(state.selectedNodePath)}&name=${encodeURIComponent(state.selectedContent)}`, { method: "DELETE" });
    state.selectedContent = null;
    state.selectedContentDisplayName = "";
    state.contentSource = "";
    await refreshAfterSave();
    toast("Content 已刪除");
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderScreensPanel() {
  const files = state.screens || [];
  dom.screensPanel.innerHTML = `
    <div class="file-workspace ${state.leftPanelHidden.screens ? "left-panel-hidden" : ""}">
      <aside class="subnav">
        <div class="subnav-header"><strong>SCENESCREEN</strong><div class="subnav-header-actions"><button class="icon-button add-button" id="newScreenButton" type="button" title="新增 Scene Screen" aria-label="新增 Scene Screen">＋</button></div></div>
        <div class="subnav-list">${fileListHtml(files, state.selectedScreen, "screen-file")}</div>
      </aside>
      <div class="editor-scroll">
        ${state.selectedScreen ? `
          <div class="code-toolbar">
            <label class="field" style="width:min(320px,60%)"><span class="visually-hidden">Scene Screen 名稱</span><input id="screenDisplayName" value="${escapeHtml(state.selectedScreenDisplayName || state.selectedScreen)}"></label>
          </div>
          <div class="code-editor-wrap"><textarea class="code-editor" id="screenEditor" spellcheck="false">${escapeHtml(state.screenSource)}</textarea></div>
          <div class="editor-danger-zone"><button class="danger-button compact" id="deleteScreenButton" type="button">刪除畫面</button></div>
        ` : `<div class="editor-empty"><div><p>選擇或新增 Scene Screen 文件。</p><button class="primary-button add-button" id="emptyNewScreenButton" type="button">新增 Scene Screen</button></div></div>`}
      </div>
    </div>
  `;
  document.querySelectorAll("[data-screen-file]").forEach((button) => button.addEventListener("click", () => loadScreen(button.dataset.screenFile)));
  document.querySelector("#newScreenButton")?.addEventListener("click", () => openNameDialog("screen"));
  document.querySelector("#emptyNewScreenButton")?.addEventListener("click", () => openNameDialog("screen"));
  document.querySelector("#saveScreenButton")?.addEventListener("click", saveScreen);
  document.querySelector("#deleteScreenButton")?.addEventListener("click", deleteScreen);
  document.querySelector("#screenDisplayName")?.addEventListener("input", scheduleScreenAutosave);
  document.querySelector("#screenEditor")?.addEventListener("input", scheduleScreenAutosave);
  syncShortcutTitles();
}

async function loadScreen(name) {
  if (name !== state.selectedScreen && !await flushAutosave()) return;
  try {
    const data = await api(`/api/screen?name=${encodeURIComponent(name)}`);
    state.selectedScreen = data.name;
    state.selectedScreenDisplayName = data.displayName || data.name;
    state.screenSource = data.source;
    renderScreensPanel();
  } catch (error) {
    toast(error.message, "error");
  }
}

function screenSnapshot() {
  return {
    originalName: state.selectedScreen,
    id: state.selectedScreen,
    displayName: document.querySelector("#screenDisplayName")?.value.trim() || state.selectedScreenDisplayName,
    source: document.querySelector("#screenEditor")?.value ?? state.screenSource,
  };
}

async function persistScreenSnapshot(snapshot) {
  const saved = await api("/api/screens", { method: "POST", body: snapshot });
  if (state.selectedScreen !== snapshot.originalName) return saved;
  state.selectedScreen = saved.name;
  state.selectedScreenDisplayName = saved.displayName;
  state.screenSource = snapshot.source;
  const entry = state.screens.find((file) => file.name === snapshot.originalName);
  if (entry) {
    entry.name = saved.name;
    entry.displayName = saved.displayName;
  }
  return saved;
}

function scheduleScreenAutosave() {
  if (!state.selectedScreen) return;
  const snapshot = screenSnapshot();
  state.selectedScreenDisplayName = snapshot.displayName;
  state.screenSource = snapshot.source;
  scheduleAutosave("Scene Screen 未能儲存", () => persistScreenSnapshot(snapshot));
}

async function saveScreen() {
  const snapshot = screenSnapshot();
  discardPendingAutosave();
  await autosaveInFlight;
  setSaveState("儲存中", "saving");
  try {
    const saved = await persistScreenSnapshot(snapshot);
    state.selectedScreen = saved.name;
    state.selectedScreenDisplayName = saved.displayName;
    await refreshAfterSave();
    await loadScreen(saved.name);
    toast("Scene Screen 已儲存");
  } catch (error) {
    setSaveState("儲存失敗", "error");
    toast(error.message, "error");
  }
}

async function deleteScreen() {
  if (!await flushAutosave()) return;
  if (!state.selectedScreen || !window.confirm(`確定刪除 Scene Screen「${state.selectedScreen}.rpy」？`)) return;
  try {
    await api(`/api/screens?name=${encodeURIComponent(state.selectedScreen)}`, { method: "DELETE" });
    state.selectedScreen = null;
    state.selectedScreenDisplayName = "";
    state.screenSource = "";
    await refreshAfterSave();
    toast("Scene Screen 已刪除");
  } catch (error) {
    toast(error.message, "error");
  }
}

function statsRowsHtml() {
  const entries = Object.entries(state.statsDraft);
  if (!entries.length) return `<tr><td colspan="5"><div class="row-empty">尚未建立 Stat。</div></td></tr>`;
  return entries.map(([id, values], index) => `
    <tr class="stat-row" data-stat-index="${index}" data-stat-id="${escapeHtml(id)}">
      <td><input name="statName" value="${escapeHtml(values.Name || id)}"></td>
      <td><input name="statMin" type="number" step="any" value="${escapeHtml(values.Min)}"></td>
      <td><input name="statInit" type="number" step="any" value="${escapeHtml(values.Init)}"></td>
      <td><input name="statMax" type="number" step="any" value="${escapeHtml(values.Max)}"></td>
      <td class="action-cell"><button class="row-button" type="button" data-remove-stat="${index}" title="移除 Stat" aria-label="移除 Stat">×</button></td>
    </tr>
  `).join("");
}

function memoryRowsHtml() {
  const entries = Object.entries(state.memoriesDraft);
  return entries.map(([id, values], index) => {
    const isDefault = id === "memory";
    return `
      <tr class="memory-row" data-memory-index="${index}" data-memory-id="${escapeHtml(id)}">
        <td><input name="memoryName" aria-label="記憶庫名稱" value="${escapeHtml(values.Name || id)}" ${isDefault ? "disabled" : ""}></td>
        <td class="action-cell">${isDefault ? '<span class="default-memory-badge">預設</span>' : `<button class="row-button" type="button" data-remove-memory="${index}" title="移除記憶庫" aria-label="移除記憶庫">×</button>`}</td>
      </tr>
    `;
  }).join("");
}

function renderStatsPanel() {
  const hasEqualRowCounts = Object.keys(state.statsDraft).length === Object.keys(state.memoriesDraft).length;
  dom.statsPanel.innerHTML = `
    <div class="panel-page wide state-definitions-page ${hasEqualRowCounts ? "equal-row-counts" : ""}" id="stateDefinitionsPage">
      <section class="state-definition-section">
        <div class="state-section-heading">
          <div><h2>Stats</h2></div>
          <button class="state-add-button add-button" id="addStatButton" type="button" title="新增 Stat" aria-label="新增 Stat">＋</button>
        </div>
        <div class="state-table-wrap">
          <table class="data-table state-data-table stats-table">
            <thead><tr><th>Name</th><th>Min</th><th>Init</th><th>Max</th><th></th></tr></thead>
            <tbody id="statsBody">${statsRowsHtml()}</tbody>
          </table>
        </div>
      </section>

      <section class="state-definition-section">
        <div class="state-section-heading">
          <div><h2>Memory</h2></div>
          <button class="state-add-button add-button" id="addMemoryButton" type="button" title="新增記憶庫" aria-label="新增記憶庫">＋</button>
        </div>
        <div class="state-table-wrap">
          <table class="data-table state-data-table memory-table" aria-label="Memory Banks">
            <thead class="memory-table-spacer" aria-hidden="true"><tr><th>Name</th><th></th></tr></thead>
            <tbody id="memoriesBody">${memoryRowsHtml()}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
  document.querySelector("#addStatButton")?.addEventListener("click", addStat);
  document.querySelector("#addMemoryButton")?.addEventListener("click", addMemory);
  document.querySelectorAll("[data-remove-stat]").forEach((button) => button.addEventListener("click", () => removeStat(Number(button.dataset.removeStat))));
  document.querySelectorAll("[data-remove-memory]:not([disabled])").forEach((button) => button.addEventListener("click", () => removeMemory(Number(button.dataset.removeMemory))));
  document.querySelector("#stateDefinitionsPage")?.addEventListener("input", scheduleStatsAutosave);
}

function readStatsForm() {
  const result = {};
  document.querySelectorAll(".stat-row").forEach((row) => {
    const id = row.dataset.statId;
    if (!id) return;
    result[id] = {
      Name: row.querySelector('[name="statName"]').value.trim() || id,
      Min: numberValue(row.querySelector('[name="statMin"]').value),
      Init: numberValue(row.querySelector('[name="statInit"]').value),
      Max: numberValue(row.querySelector('[name="statMax"]').value),
    };
  });
  return result;
}

function readMemoriesForm() {
  const result = {};
  document.querySelectorAll(".memory-row").forEach((row) => {
    const id = row.dataset.memoryId;
    if (!id) return;
    result[id] = {
      Name: id === "memory" ? "Memory" : (row.querySelector('[name="memoryName"]').value.trim() || id),
    };
  });
  return result;
}

function addStat() {
  state.statsDraft = readStatsForm();
  state.memoriesDraft = readMemoriesForm();
  const id = generateId("stat");
  state.statsDraft[id] = { Name: "新數值", Min: 0, Init: 0, Max: 100 };
  renderStatsPanel();
  scheduleStatsAutosave();
  const inputs = document.querySelectorAll('[name="statName"]');
  inputs[inputs.length - 1]?.select();
}

function removeStat(index) {
  state.statsDraft = readStatsForm();
  state.memoriesDraft = readMemoriesForm();
  const entries = Object.entries(state.statsDraft);
  entries.splice(index, 1);
  state.statsDraft = Object.fromEntries(entries);
  renderStatsPanel();
  scheduleStatsAutosave();
}

function addMemory() {
  state.statsDraft = readStatsForm();
  state.memoriesDraft = readMemoriesForm();
  const id = generateId("memory");
  state.memoriesDraft[id] = { Name: "新記憶庫" };
  renderStatsPanel();
  scheduleStatsAutosave();
  const inputs = document.querySelectorAll('[name="memoryName"]:not([disabled])');
  inputs[inputs.length - 1]?.select();
}

function removeMemory(index) {
  state.statsDraft = readStatsForm();
  state.memoriesDraft = readMemoriesForm();
  const entries = Object.entries(state.memoriesDraft);
  if (entries[index]?.[0] === "memory") return;
  entries.splice(index, 1);
  state.memoriesDraft = Object.fromEntries(entries);
  renderStatsPanel();
  scheduleStatsAutosave();
}

async function persistStatsSnapshot(stats, memories) {
  const data = await api("/api/state", { method: "PUT", body: { stats, memories } });
  state.stats = clone(data.stats);
  state.statsDraft = clone(data.stats);
  state.memories = clone(data.memories);
  state.memoriesDraft = clone(data.memories);
  updateDatalists();
  return data;
}

function scheduleStatsAutosave() {
  const stats = readStatsForm();
  const memories = readMemoriesForm();
  state.statsDraft = clone(stats);
  state.memoriesDraft = clone(memories);
  scheduleAutosave("狀態定義未能儲存", () => persistStatsSnapshot(stats, memories));
}

async function saveStats() {
  const stats = readStatsForm();
  const memories = readMemoriesForm();
  discardPendingAutosave();
  await autosaveInFlight;
  setSaveState("儲存中", "saving");
  try {
    await persistStatsSnapshot(stats, memories);
    await refreshAfterSave();
    toast("狀態定義已儲存");
  } catch (error) {
    setSaveState("儲存失敗", "error");
    toast(error.message, "error");
  }
}

function renderValidationPanel() {
  const errors = state.issues.filter((issue) => issue.level === "error").length;
  const warnings = state.issues.filter((issue) => issue.level !== "error").length;
  dom.validationPanel.innerHTML = `
    <div class="panel-page wide">
      <div class="section-heading">
        <div><span class="section-kicker">PROJECT CHECK</span><h2>專案檢查</h2><p>${errors} 個錯誤，${warnings} 個提醒。</p></div>
        <div class="section-actions"><button class="primary-button" id="runValidationButton" type="button">重新檢查</button></div>
      </div>
      ${state.issues.length ? `
        <div class="validation-list">${state.issues.map((issue) => `
          <div class="issue-row ${escapeHtml(issue.level)}">
            <span class="issue-level">${issue.level === "error" ? "錯誤" : "提醒"}</span>
            <span class="issue-location" title="${escapeHtml(issue.location)}">${escapeHtml(issue.location)}</span>
            <span class="issue-message">${escapeHtml(issue.message)}</span>
          </div>
        `).join("")}</div>
      ` : `<div class="success-state">目前沒有發現格式或引用問題。</div>`}
    </div>
  `;
  document.querySelector("#runValidationButton")?.addEventListener("click", runValidation);
}

async function runValidation() {
  if (!await flushAutosave()) return;
  try {
    const data = await api("/api/validate");
    state.issues = data.issues || [];
    updateHeader();
    renderValidationPanel();
    toast(state.issues.length ? `找到 ${state.issues.length} 個項目` : "專案檢查通過");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function refreshAfterSave() {
  const selectedPath = state.selectedNodePath;
  const project = await api("/api/project");
  state.nodes = project.nodes || [];
  state.screens = project.screens || [];
  state.images = project.images || [];
  state.stats = project.stats || {};
  state.statsDraft = clone(state.stats);
  state.memories = project.memories || { memory: { Name: "Memory" } };
  state.memoriesDraft = clone(state.memories);
  state.issues = project.issues || [];
  if (selectedPath && state.nodes.some((node) => node.path === selectedPath)) {
    state.nodeDetail = await api(`/api/node?path=${encodeURIComponent(selectedPath)}`);
    state.optionsDraft = clone(state.nodeDetail.options || defaultOptionsDraft());
    if (!state.optionsDraft.Elements.some((element) => element.ID === state.selectedOptionElementId)) {
      state.selectedOptionElementId = state.optionsDraft.Elements[0]?.ID || null;
    }
    if (!selectedOptionElement()?.Items?.some((item) => item.ID === state.selectedOptionItemId)) {
      state.selectedOptionItemId = selectedOptionElement()?.Items?.[0]?.ID || null;
    }
  }
  setSaveState("已同步");
  renderAll();
}

function openNameDialog(kind) {
  state.nameDialogKind = kind;
  const isContent = kind === "content";
  dom.nameDialogKicker.textContent = isContent ? "CONTENT" : "SCENESCREEN";
  dom.nameDialogTitle.textContent = isContent ? "新增 Content" : "新增 Scene Screen";
  dom.nameDialogLabel.textContent = isContent ? "檔名與 Label" : "檔名與 Screen 名稱";
  dom.nameDialogInput.value = "";
  dom.nameDialogInput.placeholder = isContent ? "buyWaterNormal" : "basicScene";
  dom.nameDialog.showModal();
  window.setTimeout(() => dom.nameDialogInput.focus(), 0);
}

async function createNamedFile(name) {
  if (state.nameDialogKind === "content") {
    const id = generateId("content");
    const source = `label ${id}:\n    \"在這裡撰寫演出。\"\n    return\n`;
    await api("/api/content", { method: "POST", body: { node: state.selectedNodePath, id, displayName: name, source } });
    state.selectedContent = id;
    state.selectedContentDisplayName = name;
    await refreshAfterSave();
    await loadContent(id);
    switchTab("content");
  } else {
    const id = generateId("screen");
    const source = `screen ${id}():\n    text \"\"\n`;
    await api("/api/screens", { method: "POST", body: { id, displayName: name, source } });
    state.selectedScreen = id;
    state.selectedScreenDisplayName = name;
    await refreshAfterSave();
    await loadScreen(id);
    switchTab("screens");
  }
}

function openNodeDialog() {
  dom.nodeDialogForm.reset();
  updateDatalists();
  dom.nodeDialog.showModal();
  window.setTimeout(() => dom.nodeDialogForm.elements.name.focus(), 0);
}

async function createNodeFromDialog() {
  const form = new FormData(dom.nodeDialogForm);
  const payload = {
    name: form.get("name"),
    background: form.get("background"),
    screen: form.get("screen"),
  };
  setSaveState("建立中", "saving");
  try {
    const created = await api("/api/nodes", { method: "POST", body: payload });
    dom.nodeDialog.close();
    await loadProject({ preserveNode: false });
    await selectNode(created.path);
    switchTab("node");
    toast("Scene Node 已建立");
  } catch (error) {
    setSaveState("建立失敗", "error");
    toast(error.message, "error");
  }
}

function syncSidebarLayout() {
  const open = document.body.classList.contains("sidebar-open");
  const button = document.querySelector("#openSidebar");
  if (button) button.setAttribute("aria-expanded", String(open));
}

function toggleSidebar() {
  document.body.classList.toggle("sidebar-open");
  syncSidebarLayout();
  if (document.body.classList.contains("sidebar-open")) {
    dom.nodeSearch.focus({ preventScroll: true });
  }
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  syncSidebarLayout();
}

function shortcutFromEvent(event) {
  const physicalKey = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Backslash: event.shiftKey ? "|" : "\\",
  }[event.code];
  const rawKey = physicalKey || event.key.toLocaleLowerCase();
  if (["control", "meta", "alt", "shift"].includes(rawKey)) return "";
  const key = ({ " ": "space", escape: "esc", arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right" })[rawKey] || rawKey;
  const parts = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey && key !== "|") parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

function shortcutDisplay(shortcut) {
  if (!shortcut) return "未設定";
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return shortcut.split("+").map((part) => {
    if (part === "mod") return isMac ? "⌘" : "Ctrl";
    if (part === "alt") return isMac ? "⌥" : "Alt";
    if (part === "shift") return isMac ? "⇧" : "Shift";
    if (part === "space") return "Space";
    if (part === "esc") return "Esc";
    if (part === "left") return "←";
    if (part === "right") return "→";
    if (part === "up") return "↑";
    if (part === "down") return "↓";
    return part.length === 1 ? part.toLocaleUpperCase() : part;
  }).join(isMac ? "" : "+");
}

function renderShortcutSettings() {
  dom.shortcutList.innerHTML = Object.entries(SHORTCUT_LABELS).map(([action, label]) => `
    <label class="shortcut-row">
      <span>${escapeHtml(label)}</span>
      <input data-shortcut-action="${escapeHtml(action)}" value="${escapeHtml(shortcutDisplay(state.editorSettings.shortcuts[action]))}" readonly aria-label="${escapeHtml(label)}">
    </label>
  `).join("");
  dom.shortcutList.querySelectorAll("[data-shortcut-action]").forEach((input) => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const action = input.dataset.shortcutAction;
      if (event.key === "Escape") {
        input.blur();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        state.editorSettings.shortcuts[action] = "";
      } else {
        const shortcut = shortcutFromEvent(event);
        if (!shortcut) return;
        const conflict = Object.entries(state.editorSettings.shortcuts).find(([key, value]) => key !== action && value === shortcut);
        if (conflict) {
          toast(`快捷鍵已用於「${SHORTCUT_LABELS[conflict[0]]}」`, "error");
          return;
        }
        state.editorSettings.shortcuts[action] = shortcut;
      }
      writeEditorSettings();
      renderShortcutSettings();
      syncShortcutTitles();
    });
  });
}

function openSettings() {
  dom.autosaveEnabled.checked = state.editorSettings.autosave;
  dom.autosaveDelay.value = String(state.editorSettings.autosaveDelay);
  dom.gridSize.value = state.editorSettings.gridSize;
  renderShortcutSettings();
  if (!dom.settingsDialog.open) dom.settingsDialog.showModal();
}

function syncShortcutTitles() {
  const settingsButton = document.querySelector("#settingsButton");
  const sidebarButton = document.querySelector("#openSidebar");
  if (settingsButton) settingsButton.title = `編輯器設定（${shortcutDisplay(state.editorSettings.shortcuts.settings)}）`;
  if (sidebarButton) sidebarButton.title = `切換節點列表（${shortcutDisplay(state.editorSettings.shortcuts.sidebar)}）`;
  Object.entries(TAB_SHORTCUT_ACTIONS).forEach(([action, tab]) => {
    const button = document.querySelector(`[data-tab="${tab}"]`);
    if (button) button.title = `${button.textContent.trim()}（${shortcutDisplay(state.editorSettings.shortcuts[action])}）`;
  });
  const createShortcut = shortcutDisplay(state.editorSettings.shortcuts.create);
  [
    ["#newNodeButton", "新增節點"],
    ["#emptyNewNodeButton", "新增節點"],
    ["#newEventButton", "新增 Event"],
    ["#emptyNewEventButton", "新增 Event"],
    ["#newContentButton", "新增 Content"],
    ["#emptyNewContentButton", "新增 Content"],
    ["#newScreenButton", "新增 Scene Screen"],
    ["#emptyNewScreenButton", "新增 Scene Screen"],
  ].forEach(([selector, label]) => {
    const button = document.querySelector(selector);
    if (button) button.title = `${label}（${createShortcut}）`;
  });
}

function toggleActiveSections() {
  const panel = document.querySelector(`.tab-panel[data-panel="${state.activeTab}"]`);
  const sections = [...(panel?.querySelectorAll("details") || [])];
  if (!sections.length) return;
  const open = sections.some((details) => !details.open);
  sections.forEach((details) => { details.open = open; });
}

function saveActiveEditor() {
  const active = state.activeTab;
  if (active === "node") document.querySelector("#nodeForm")?.requestSubmit();
  if (active === "events") document.querySelector("#eventForm")?.requestSubmit();
  if (active === "options") saveOptions();
  if (active === "content" && state.selectedContent) saveContent();
  if (active === "screens" && state.selectedScreen) saveScreen();
  if (active === "stats") saveStats();
}

function cycleActiveTab(direction) {
  const currentIndex = TAB_ORDER.indexOf(state.activeTab);
  const nextIndex = (currentIndex + direction + TAB_ORDER.length) % TAB_ORDER.length;
  requestTabSwitch(TAB_ORDER[nextIndex]);
}

function syncOptionPanelVisibility() {
  const builder = document.querySelector(".option-builder");
  if (!builder) return false;
  builder.classList.toggle("elements-hidden", state.optionElementsHidden);
  builder.classList.toggle("inspector-hidden", state.optionInspectorHidden);
  return true;
}

function toggleActiveLeftPanel() {
  if (state.activeTab === "options") {
    state.optionElementsHidden = !state.optionElementsHidden;
    if (narrowOptionsMedia.matches && !state.optionElementsHidden) state.optionInspectorHidden = true;
    syncOptionPanelVisibility();
    return true;
  }
  if (!Object.hasOwn(state.leftPanelHidden, state.activeTab)) return false;
  state.leftPanelHidden[state.activeTab] = !state.leftPanelHidden[state.activeTab];
  const workspace = state.activeTab === "events"
    ? document.querySelector(".event-workspace")
    : document.querySelector(`.tab-panel[data-panel="${state.activeTab}"] .file-workspace`);
  workspace?.classList.toggle("left-panel-hidden", state.leftPanelHidden[state.activeTab]);
  return true;
}

function toggleActiveRightPanel() {
  if (state.activeTab !== "options") return false;
  state.optionInspectorHidden = !state.optionInspectorHidden;
  if (narrowOptionsMedia.matches && !state.optionInspectorHidden) state.optionElementsHidden = true;
  syncOptionPanelVisibility();
  return true;
}

function createInActiveTab() {
  if (document.querySelector("dialog[open]")) return false;
  if (state.activeTab === "node") {
    openNodeDialog();
  } else if (state.activeTab === "events") {
    if (!state.nodeDetail) {
      toast("請先建立或選擇節點", "error");
      return true;
    }
    createEventDraft();
  } else if (state.activeTab === "content") {
    if (!state.nodeDetail) {
      toast("請先建立或選擇節點", "error");
      return true;
    }
    openNameDialog("content");
  } else if (state.activeTab === "screens") {
    openNameDialog("screen");
  } else if (state.activeTab === "options") {
    toast("選項具有多種元件類型，請使用左側新增按鈕");
  } else if (state.activeTab === "stats") {
    toast("狀態具有 Stats 與 Memory，請使用各區新增按鈕");
  } else {
    toast("目前功能區沒有可新增的項目");
  }
  return true;
}

function runShortcut(action) {
  if (TAB_SHORTCUT_ACTIONS[action]) requestTabSwitch(TAB_SHORTCUT_ACTIONS[action]);
  else if (action === "cyclePrevious") cycleActiveTab(-1);
  else if (action === "cycleNext") cycleActiveTab(1);
  else if (action === "save") saveActiveEditor();
  else if (action === "create") return createInActiveTab();
  else if (action === "sidebar") toggleSidebar();
  else if (action === "settings") openSettings();
  else if (action === "sections") toggleActiveSections();
  else if (action === "leftPanel") return toggleActiveLeftPanel();
  else if (action === "rightPanel") return toggleActiveRightPanel();
  else if (state.activeTab === "options" && action === "optionElements") {
    toggleActiveLeftPanel();
  } else if (state.activeTab === "options" && action === "optionInspector") {
    toggleActiveRightPanel();
  } else if (state.activeTab === "options" && action === "grid") toggleOptionGrid();
  else if (state.activeTab === "options" && action === "snap") toggleOptionSnap();
  else return false;
  return true;
}

function bindDialogEnter(form) {
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || event.target.matches("textarea, select, button")) return;
    const submitButton = form.querySelector('button[type="submit"]');
    if (!submitButton) return;
    event.preventDefault();
    form.requestSubmit(submitButton);
  });
}

function handleSidebarNodeNavigation(event) {
  if (!document.body.classList.contains("sidebar-open") || event.isComposing) return false;
  const nodeItems = [...dom.nodeList.querySelectorAll("[data-node-path]")];
  if (!nodeItems.length) return false;
  const isArrowDown = event.key === "ArrowDown" || event.code === "ArrowDown";
  const isArrowUp = event.key === "ArrowUp" || event.code === "ArrowUp";

  if (isArrowDown || isArrowUp) {
    const focusedIndex = nodeItems.indexOf(document.activeElement);
    const keyboardIndex = nodeItems.findIndex((item) => item.classList.contains("keyboard-focus"));
    const selectedIndex = nodeItems.findIndex((item) => item.classList.contains("active"));
    const direction = isArrowDown ? 1 : -1;
    const baseIndex = focusedIndex >= 0 ? focusedIndex : keyboardIndex >= 0 ? keyboardIndex : selectedIndex;
    const nextIndex = baseIndex < 0
      ? (direction > 0 ? 0 : nodeItems.length - 1)
      : (baseIndex + direction + nodeItems.length) % nodeItems.length;
    event.preventDefault();
    event.stopPropagation();
    nodeItems.forEach((item, index) => item.classList.toggle("keyboard-focus", index === nextIndex));
    nodeItems[nextIndex].focus();
    nodeItems[nextIndex].scrollIntoView({ block: "nearest" });
    return true;
  }

  if ((event.key === "Enter" || event.code === "Enter") && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const focusedNode = document.activeElement?.closest?.("[data-node-path]")
      || dom.nodeList.querySelector(".node-item.keyboard-focus");
    if (!focusedNode || !dom.nodeList.contains(focusedNode)) return false;
    event.preventDefault();
    event.stopPropagation();
    focusedNode.click();
    return true;
  }
  return false;
}

function bindGlobalEvents() {
  narrowOptionsMedia.addEventListener?.("change", (event) => {
    state.optionElementsHidden = event.matches;
    state.optionInspectorHidden = event.matches;
    if (state.activeTab === "options") syncOptionPanelVisibility();
  });
  document.querySelector("#newNodeButton").addEventListener("click", openNodeDialog);
  document.querySelector("#emptyNewNodeButton").addEventListener("click", openNodeDialog);
  document.querySelector("#refreshProject").addEventListener("click", async () => { if (await flushAutosave()) await loadProject(); });
  document.querySelector("#validateButton")?.addEventListener("click", async () => { if (await requestTabSwitch("validation")) await runValidation(); });
  document.querySelector("#settingsButton").addEventListener("click", openSettings);
  dom.nodeSearch.addEventListener("input", renderNodeList);
  dom.nodeList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-node-path]");
    if (button) selectNode(button.dataset.nodePath);
  });
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => requestTabSwitch(button.dataset.tab)));
  document.querySelector("#openSidebar").addEventListener("click", toggleSidebar);
  document.querySelector("#closeSidebar")?.addEventListener("click", closeSidebar);
  document.querySelector("#sidebarScrim").addEventListener("click", closeSidebar);
  window.addEventListener("resize", () => syncTabFocusIndicator({ immediate: true }));
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => {
    document.querySelector(`#${button.dataset.closeDialog}`)?.close();
  }));
  [dom.nodeDialogForm, dom.nameDialogForm, dom.settingsForm].forEach(bindDialogEnter);

  dom.autosaveEnabled.addEventListener("change", async (event) => {
    state.editorSettings.autosave = event.target.checked;
    writeEditorSettings();
    if (state.editorSettings.autosave && pendingAutosave) await runPendingAutosave();
  });
  dom.autosaveDelay.addEventListener("change", (event) => {
    state.editorSettings.autosaveDelay = numberValue(event.target.value, 700);
    writeEditorSettings();
  });
  dom.gridSize.addEventListener("change", (event) => {
    state.editorSettings.gridSize = Math.max(4, Math.min(160, numberValue(event.target.value, 24)));
    event.target.value = state.editorSettings.gridSize;
    writeEditorSettings();
    if (state.activeTab === "options") renderOptionsPanel();
  });
  document.querySelector("#resetShortcuts").addEventListener("click", () => {
    state.editorSettings.shortcuts = { ...DEFAULT_SHORTCUTS };
    writeEditorSettings();
    renderShortcutSettings();
    syncShortcutTitles();
  });

  dom.nodeDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createNodeFromDialog();
  });

  dom.nameDialogForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = dom.nameDialogInput.value.trim();
    if (!name) return;
    try {
      await createNamedFile(name);
      dom.nameDialog.close();
      toast("文件已建立");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.target.matches?.("[data-shortcut-action]")) return;
    if (handleSidebarNodeNavigation(event)) return;
    if (event.key === "Tab" && event.target.matches("textarea.code-editor")) {
      event.preventDefault();
      const editor = event.target;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.setRangeText("    ", start, end, "end");
      if (state.activeTab === "content") scheduleContentAutosave();
      if (state.activeTab === "screens") scheduleScreenAutosave();
      return;
    }
    const shortcut = shortcutFromEvent(event);
    const action = Object.entries(state.editorSettings.shortcuts).find(([, value]) => value && value === shortcut)?.[0];
    const isTyping = event.target.matches("input, textarea, select, [contenteditable='true']");
    if (!action || (isTyping && !event.metaKey && !event.ctrlKey && !event.altKey)) return;
    if (runShortcut(action)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  window.addEventListener("beforeunload", (event) => {
    if (!pendingAutosave && !failedAutosave && autosaveQueuedCount === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
  window.addEventListener("online", retryFailedAutosave);
  window.addEventListener("focus", retryFailedAutosave);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) retryFailedAutosave();
  });
}

async function init() {
  writeEditorSettings();
  syncSidebarLayout();
  syncShortcutTitles();
  bindGlobalEvents();
  await loadProject();
}

init();
