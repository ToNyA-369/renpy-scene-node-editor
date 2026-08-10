"use strict";

const SETTINGS_KEY = "scene-node-editor.settings";
const GRID_VISIBLE_KEY = "scene-node-editor.option-grid-visible";
const SNAP_ENABLED_KEY = "scene-node-editor.option-snap-enabled";
const GLOBAL_NODE_ID = "__global__";
const GLOBAL_NODE_PATH = "@global";
const GRAPH_NAME_FADE_START = 2.2;
const GRAPH_NAME_FADE_END = 3.2;
const {
  DEFAULT_LOCALE,
  EN_DICTIONARY,
  SUPPORTED_LOCALES,
  getLocale,
  interpolate,
  normalizeLocale,
  setLocale,
  t,
  translateDocument,
} = SceneI18n;
const {
  DEFAULT_SHORTCUTS,
  SHORTCUT_LABELS,
  TAB_ORDER,
  TAB_SHORTCUT_ACTIONS,
  normalizeEditorSettings,
} = SceneEditorSettings;
const {
  AUTO_TRIGGER_CHOICES,
  END_UP_CHOICES,
  EVENT_TRIGGER_MODES,
  MOUSE_TRIGGER_CHOICES,
  actionTriggerName,
  actionTriggerValue,
  endUpUsesNextNode,
  eventTriggerDisplayName,
  eventTriggerMode,
  isLifecycleTrigger,
  keyboardKeysymDisplay,
  keyboardKeysymFromEvent,
  keyboardTriggerKeysym,
} = SceneEventContract;
function readEditorSettings() {
  try {
    return normalizeEditorSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch (_error) {
    return normalizeEditorSettings();
  }
}

const state = {
  projectName: "",
  projectPath: "",
  rootNodeId: null,
  globalNode: null,
  nodes: [],
  graph: { edges: [] },
  graphViewBox: null,
  graphLayoutSignature: "",
  graphSearch: "",
  graphStopLayoutAnimation: null,
  images: [],
  audio: [],
  optionTargets: [],
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
  optionWorkspaceMode: "form",
  optionWorkspaceTransitioning: false,
  optionResizeObserver: null,
  selectedContent: null,
  selectedContentDisplayName: "",
  contentSource: "",
  activeTab: "node",
  leftPanelHidden: { events: false, content: false },
  optionGridVisible: localStorage.getItem(GRID_VISIBLE_KEY) !== "false",
  optionSnapEnabled: localStorage.getItem(SNAP_ENABLED_KEY) !== "false",
  editorSettings: readEditorSettings(),
};

let editorSettingsSave = Promise.resolve(true);
let editorSettingsSaveFailureNotified = false;
let workspaceAnimationTimer = null;
let pendingTabPreview = null;
let pendingEventGroupFocus = null;
let pendingStatGroupFocus = null;
let eventGroupDragController = null;
let statGroupDragController = null;

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
  statsPanel: document.querySelector("#statsPanel"),
  graphPanel: document.querySelector("#graphPanel"),
  validationPanel: document.querySelector("#validationPanel"),
  nodeDialog: document.querySelector("#nodeDialog"),
  nodeDialogForm: document.querySelector("#nodeDialogForm"),
  nameDialog: document.querySelector("#nameDialog"),
  nameDialogForm: document.querySelector("#nameDialogForm"),
  nameDialogInput: document.querySelector("#nameDialogInput"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  autosaveEnabled: document.querySelector("#autosaveEnabled"),
  autosaveDelay: document.querySelector("#autosaveDelay"),
  editorLanguage: document.querySelector("#editorLanguage"),
  gridSize: document.querySelector("#gridSize"),
  shortcutList: document.querySelector("#shortcutList"),
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
  dom.saveState.textContent = t(message);
  dom.saveState.className = `save-state ${kind}`.trim();
  dom.saveState.title = detail;
}

const autosaveCoordinator = SceneAutosave.createAutosaveCoordinator({
  isEnabled: () => state.editorSettings.autosave,
  getDelay: () => state.editorSettings.autosaveDelay,
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (timer) => window.clearTimeout(timer),
  onState: setSaveState,
  onFailure: (label, error) => toast(t("{label}：{message}", { label: t(label), message: error.message }), "error"),
});

function writeEditorSettings({ notifyFailure = true } = {}) {
  const snapshot = clone(state.editorSettings);
  editorSettingsSave = editorSettingsSave.then(async () => {
    const previousLocalStorage = localStorage.getItem(SETTINGS_KEY);
    try {
      await api("/api/editor-settings", { method: "PUT", body: snapshot });
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
      editorSettingsSaveFailureNotified = false;
      return true;
    } catch (error) {
      if (previousLocalStorage !== null) {
        localStorage.setItem(SETTINGS_KEY, previousLocalStorage);
      } else {
        localStorage.removeItem(SETTINGS_KEY);
      }
      if (notifyFailure && !editorSettingsSaveFailureNotified) {
        toast(t("編輯器設定未能儲存：{message}", { message: error.message }), "error");
        editorSettingsSaveFailureNotified = true;
      }
      return false;
    }
  });
  return editorSettingsSave;
}

async function loadEditorSettings() {
  try {
    const saved = await api("/api/editor-settings");
    if (saved && typeof saved === "object" && Object.keys(saved).length) {
      state.editorSettings = normalizeEditorSettings(saved);
    }
  } catch (_error) {
    // The current-origin local copy remains a fallback for older installations.
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.editorSettings));
}

async function cancelAutosaveAndWait() {
  await autosaveCoordinator.cancelAndWait();
}

function scheduleAutosave(label, persist) {
  return autosaveCoordinator.schedule(label, persist);
}

function isCurrentAutosaveTask(task) {
  return autosaveCoordinator.isCurrent(task);
}

function retryFailedAutosave() {
  return autosaveCoordinator.retry();
}

async function flushAutosave() {
  return autosaveCoordinator.flush();
}

function toast(message, kind = "") {
  const item = document.createElement("div");
  item.className = `toast ${kind}`.trim();
  item.textContent = t(message);
  dom.toastRegion.append(item);
  window.setTimeout(() => item.remove(), 3200);
}

const api = SceneEditorApi.createApiClient();

function optionTags(items, current, label = (item) => item, value = (item) => item) {
  return items.map((item) => {
    const optionValue = String(value(item));
    const selected = optionValue === String(current ?? "") ? " selected" : "";
    return `<option value="${escapeHtml(optionValue)}"${selected}>${escapeHtml(label(item))}</option>`;
  }).join("");
}

function namedOptionTags(items, current, { includeNone = false, translateLabels = false } = {}) {
  const normalized = items.map((item) => ({
    id: String(item.id),
    name: translateLabels ? t(String(item.name || item.id)) : String(item.name || item.id),
    pickerPath: item.pickerPath ? String(item.pickerPath) : "",
  }));
  const known = new Set(normalized.map((item) => item.id));
  if (current && !known.has(String(current))) normalized.push({ id: String(current), name: t("{name}（未找到）", { name: current }) });
  const none = includeNone ? '<option value="">None</option>' : "";
  return none + normalized.map((item) => {
    const selected = item.id === String(current || "") ? " selected" : "";
    const pickerPath = item.pickerPath ? ` data-picker-path="${escapeHtml(item.pickerPath)}"` : "";
    return `<option value="${escapeHtml(item.id)}"${pickerPath}${selected}>${escapeHtml(item.name)}</option>`;
  }).join("");
}

function leafName(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts[parts.length - 1] || String(path || "");
}

function assetOptionTags(paths, current = "", directory = "", leading = []) {
  const prefix = `${directory.toLocaleLowerCase()}/`;
  const assets = paths.filter((path) => String(path).toLocaleLowerCase().startsWith(prefix));
  const known = new Set([...leading.map((item) => String(item.id)), ...assets.map(String)]);
  const leadingTags = leading.map((item) => {
    const id = String(item.id);
    const selected = id === String(current || "") ? " selected" : "";
    return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(item.name)}</option>`;
  }).join("");
  const assetTags = assets.map((path) => {
    const value = String(path);
    const relative = value.slice(directory.length + 1);
    const selected = value === String(current || "") ? " selected" : "";
    return `<option value="${escapeHtml(value)}" data-picker-path="${escapeHtml(relative)}"${selected}>${escapeHtml(leafName(value))}</option>`;
  }).join("");
  const missing = current && !known.has(String(current))
    ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(t("{name}（未找到）", { name: leafName(current) }))}</option>`
    : "";
  return leadingTags + assetTags + missing;
}

function imageOptionTags(current = "", leading = []) {
  return assetOptionTags(state.images, current, "images", leading);
}

function audioOptionTags(current = "", leading = []) {
  return assetOptionTags(state.audio, current, "audio", leading);
}

function canvasBackgroundOptionTags(current = "") {
  return imageOptionTags(current, [{ id: "", name: "None" }]);
}

function isGlobalNode() {
  return Boolean(state.nodeDetail?.isGlobal || state.selectedNodePath === GLOBAL_NODE_PATH);
}

function eventTriggerModeChoices() {
  return EVENT_TRIGGER_MODES;
}

function eventEffectTypeChoices() {
  return SceneStateRuleContract.EFFECT_TYPES;
}

function statChoices() {
  return SceneStateEditor.statChoices(state.stats);
}

function memoryChoices() {
  return Object.entries(state.memories).map(([id, values]) => ({ id, name: values.Name || id }));
}

function warnMissingStat(kind) {
  toast(t("目前專案沒有任何 Stat。請先到「狀態」建立 Stat，再新增 Stat {kind}。", { kind: t(kind) }), "error");
}

function warnMissingOptionTarget() {
  toast(t("目前作用域沒有 CONTROLLED Option。請先在「選項」把 Element 或 Item 的 Availability 設為 CONTROLLED。"), "error");
}

function nodeChoices() {
  return state.nodes.map((node) => ({ id: node.id, name: node.name || node.id }));
}

function optionEffectTargetValue(target) {
  const value = {
    target: target.target,
    node: target.node,
    element: target.element,
  };
  if (target.target === "item") value.item = target.item;
  return JSON.stringify(value);
}

function optionEffectTargetFromEntry(entry) {
  const target = {
    target: entry.target,
    node: entry.nodeId,
    element: entry.elementId,
  };
  if (entry.target === "item") target.item = entry.itemId;
  return target;
}

function optionEffectChoices() {
  const currentNodeId = String(state.nodeDetail?.node?.ID || "");
  return (state.optionTargets || [])
    .filter((entry) => (
      entry.nodeId === currentNodeId
      && entry.availability === "CONTROLLED"
    ))
    .map((entry) => {
      const target = optionEffectTargetFromEntry(entry);
      const elementName = String(entry.elementName || entry.elementId).replaceAll("/", "／");
      const leaf = entry.target === "item"
        ? String(entry.itemName || entry.itemId).replaceAll("/", "／")
        : entry.elementType === "TEXTBOX" ? t("整個選項列") : elementName;
      const pickerPath = entry.target === "item" || entry.elementType === "TEXTBOX"
        ? `${elementName}/${leaf}`
        : leaf;
      return { target, value: optionEffectTargetValue(target), name: leaf, pickerPath };
    });
}

function optionEffectOptionTags(effect) {
  const currentTarget = {
    target: effect.target || "element",
    node: effect.node || "",
    element: effect.element || "",
  };
  if (currentTarget.target === "item") currentTarget.item = effect.item || "";
  const current = optionEffectTargetValue(currentTarget);
  const choices = optionEffectChoices();
  const known = choices.some((choice) => choice.value === current);
  const tags = choices.map((choice) => {
    const selected = choice.value === current ? " selected" : "";
    return `<option value="${escapeHtml(choice.value)}" data-picker-path="${escapeHtml(choice.pickerPath)}"${selected}>${escapeHtml(choice.name)}</option>`;
  }).join("");
  if (known || !effect.node) return tags;
  const missingName = [effect.node, effect.element, effect.item].filter(Boolean).join(" / ");
  return tags + `<option value="${escapeHtml(current)}" selected>${escapeHtml(t("{name}（未找到）", { name: missingName }))}</option>`;
}

function contentChoices() {
  const choices = [];
  for (const file of state.nodeDetail?.contents || []) {
    for (const id of file.labels || []) {
      choices.push({ id, name: contentLabelDisplayName(file, id), file: contentFileDisplayName(file) });
    }
  }
  return choices;
}

function contentFileDisplayName(file) {
  return String(file?.displayName || leafName(file?.file || `${file?.name || "Content"}.rpy`));
}

function contentLabelDisplayName(file, label) {
  const labels = file?.labels || [];
  if (labels.length === 1) return contentFileDisplayName(file);
  return String(label || t("尚未選擇"));
}

function contentLabelFile(label) {
  return (state.nodeDetail?.contents || []).find((file) => (file.labels || []).includes(label)) || null;
}

const selectChoicePicker = SceneChoicePicker.createChoicePicker({
  escapeHtml,
  generateId,
  beforeOpen: () => closeContentPickers(),
});
const {
  menuWidth: SELECT_MENU_WIDTH,
  submenuGap: SUBMENU_GAP,
} = SceneChoicePicker.LAYOUT;
const {
  clearSubmenuClose,
  directMenuItems,
  focusRelativeMenuItem,
  scheduleSubmenuClose,
  setSubmenuOpen,
} = selectChoicePicker.hierarchy;

function closeSelectPickers(except = null) {
  selectChoicePicker.close(except);
}

function syncSelectPicker(select) {
  selectChoicePicker.sync(select);
}

function enhanceSelects(root = document) {
  selectChoicePicker.enhanceAll(root);
}

function observeSelects() {
  return selectChoicePicker.observe();
}

function contentPickerHtml(label, index) {
  const selectedFile = contentLabelFile(label);
  const selectedName = selectedFile
    ? contentLabelDisplayName(selectedFile, label)
    : (label ? t("{name}（未找到）", { name: leafName(label) }) : t("尚未選擇"));
  const files = state.nodeDetail?.contents || [];
  const fileRows = files.map((file) => {
    const fileName = contentFileDisplayName(file);
    const labels = file.labels || [];
    if (!labels.length) {
      return `<button class="content-file-choice is-disabled" type="button" disabled><span>${escapeHtml(fileName)}</span><small>${escapeHtml(t("沒有 label"))}</small></button>`;
    }
    if (labels.length === 1) {
      return `
        <button class="content-file-choice" type="button" role="menuitem" data-content-label-choice="${escapeHtml(labels[0])}">
          <span>${escapeHtml(contentLabelDisplayName(file, labels[0]))}</span>
        </button>
      `;
    }
    return `
      <div class="content-file-branch">
        <button class="content-file-choice" type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false" data-content-file-expand>
          <span>${escapeHtml(fileName)}</span><i aria-hidden="true">›</i>
        </button>
        <div class="content-label-submenu" role="menu" aria-label="${escapeHtml(fileName)} labels">
          ${labels.map((item) => `
            <button type="button" role="menuitem" data-content-label-choice="${escapeHtml(item)}">${escapeHtml(contentLabelDisplayName(file, item))}</button>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
  return `
    <div class="field content-choice-field">
      <span class="visually-hidden">Content label</span>
      <input name="contentWeightedId" type="hidden" value="${escapeHtml(label)}">
      <div class="content-choice-picker" data-content-picker-index="${index}">
        <button class="content-choice-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-content-picker-toggle>
          <span><strong>${escapeHtml(selectedName)}</strong></span><i aria-hidden="true">⌄</i>
        </button>
        <div class="content-choice-menu" role="menu">
          ${fileRows || `<div class="content-choice-empty">${escapeHtml(t("目前節點沒有 Content 文件。"))}</div>`}
        </div>
      </div>
    </div>
  `;
}

const eventEditor = SceneEventEditor.createEventEditor({
  contentPickerHtml,
  effectTypeChoices: eventEffectTypeChoices,
  escapeHtml,
  memoryChoices,
  namedOptionTags,
  nodeChoices,
  numberValue,
  optionEffectChoices,
  optionEffectOptionTags,
  optionTags,
  stateRuleContract: SceneStateRuleContract,
  statChoices,
});
const {
  choiceBlockHtml,
  conditionRowsHtml,
  effectRowsHtml,
  newRule: newStateRule,
  readChoice,
  readRules,
  replaceRuleType,
} = eventEditor;
const {
  DEFAULT_EVENT_GROUP,
  addWeightedChoice,
  choiceEntries,
  eventPoolBlocks,
  normalizeEventGroup,
  removeWeightedChoice,
} = SceneEventEditor;

function closeContentPickers(except = null) {
  document.querySelectorAll(".content-choice-picker.open").forEach((picker) => {
    if (picker === except) return;
    picker.classList.remove("open");
    picker.querySelector("[data-content-picker-toggle]")?.setAttribute("aria-expanded", "false");
    picker.querySelectorAll(".content-file-branch").forEach((branch) => {
      clearSubmenuClose(branch);
      branch.classList.remove("submenu-open");
      branch.querySelector(":scope > [data-content-file-expand]")?.setAttribute("aria-expanded", "false");
    });
  });
}

function positionContentSubmenu(branch) {
  const trigger = branch?.querySelector(":scope > [data-content-file-expand]");
  const submenu = branch?.querySelector(":scope > .content-label-submenu");
  if (!trigger || !submenu) return;
  const rect = trigger.getBoundingClientRect();
  const parentRect = branch.parentElement.getBoundingClientRect();
  const edge = 12;
  const gap = SUBMENU_GAP;
  const width = Math.min(SELECT_MENU_WIDTH, window.innerWidth - edge * 2);
  const height = Math.min(submenu.scrollHeight || 320, 320);
  const fitsRight = parentRect.right + gap + width <= window.innerWidth - edge;
  submenu.classList.toggle("opens-left", !fitsRight);
  submenu.style.width = `${width}px`;
  submenu.style.left = `${fitsRight ? parentRect.right + gap : Math.max(edge, parentRect.left - gap - width)}px`;
  submenu.style.top = `${Math.max(edge, Math.min(rect.top - 7, window.innerHeight - height - edge))}px`;
}

function positionContentMenu(picker) {
  const trigger = picker?.querySelector(":scope > [data-content-picker-toggle]");
  const menu = picker?.querySelector(":scope > .content-choice-menu");
  if (!trigger || !menu) return;
  const rect = trigger.getBoundingClientRect();
  const edge = 12;
  const width = Math.min(SELECT_MENU_WIDTH, window.innerWidth - edge * 2);
  const height = Math.min(menu.scrollHeight, 320);
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge))}px`;
  menu.style.top = `${rect.bottom + 7}px`;
  if (rect.bottom + 7 + height > window.innerHeight - edge && rect.top > height + edge) {
    menu.style.top = `${rect.top - height - 7}px`;
  }
}

function updateDatalists() {
  dom.statNames.innerHTML = Object.keys(state.stats).sort().map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  dom.nodeNames.innerHTML = state.nodes.map((node) => `<option value="${escapeHtml(node.id)}"></option>`).join("");
  const labels = new Set();
  for (const file of state.nodeDetail?.contents || []) {
    for (const label of file.labels || []) labels.add(label);
  }
  dom.contentNames.innerHTML = [...labels].sort().map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  dom.imageAssets.innerHTML = state.images.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
}

function updateHeader() {
  const node = state.nodeDetail?.node;
  dom.projectName.textContent = state.projectName || "Scene Node Editor";
  dom.projectSummary.textContent = t("{count} 個節點", { count: state.nodes.length });
  dom.nodeTitle.textContent = node?.Name || node?.ID || "Scene Node Editor";
  dom.nodePath.textContent = isGlobalNode()
    ? "GLOBALNODE"
    : state.selectedNodePath
      ? `SCENENODE/${state.selectedNodePath}`
      : state.projectPath || t("尚未選擇節點");
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
  const globalNode = state.globalNode;
  const globalMatches = globalNode && (
    !query
    || `${globalNode.name || ""} ${globalNode.id} global globalnode 全局`.toLocaleLowerCase().includes(query)
  );
  const nodes = state.nodes.filter((node) => {
    const haystack = `${node.name || ""} ${node.id} ${node.path}`.toLocaleLowerCase();
    return !query || haystack.includes(query);
  });
  if (!nodes.length && !globalMatches) {
    dom.nodeList.innerHTML = `<div class="node-list-empty">${state.nodes.length ? escapeHtml(t("沒有符合的節點")) : escapeHtml(t("尚未建立 Scene Node"))}</div>`;
    return;
  }
  const globalHtml = globalMatches ? `
    <div class="global-node-slot">
      <button class="node-item global-node-item ${globalNode.path === state.selectedNodePath ? "active" : ""}" type="button" data-node-path="${escapeHtml(globalNode.path)}">
        <span class="node-item-copy">
          <strong>${escapeHtml(globalNode.name || "GLOBAL")}<span class="global-node-badge">GLOBAL</span></strong>
          <span>${escapeHtml(t("所有 Scene Node 的事件與選項作用域"))}</span>
        </span>
        <span class="node-event-count" title="${escapeHtml(t("Global Event 數量"))}">${globalNode.eventCount}</span>
      </button>
    </div>
  ` : "";
  const nodesHtml = nodes.map((node) => `
    <button class="node-item ${node.path === state.selectedNodePath ? "active" : ""}" type="button" data-node-path="${escapeHtml(node.path)}">
      <span class="node-accent" aria-hidden="true"></span>
      <span class="node-item-copy">
        <strong>${escapeHtml(node.name || node.id)}${node.isRoot ? '<span class="root-node-badge is-compact">ROOT</span>' : ""}</strong>
        <span>${escapeHtml(node.path)}</span>
      </span>
      <span class="node-event-count" title="${escapeHtml(t("Event 數量"))}">${node.eventCount}</span>
    </button>
  `).join("");
  dom.nodeList.innerHTML = globalHtml + nodesHtml;
}

async function loadProject({ preserveNode = true } = {}) {
  setSaveState("掃描中", "saving");
  try {
    const previous = preserveNode ? state.selectedNodePath : null;
    const data = await api("/api/project");
    state.projectName = data.projectName;
    state.projectPath = data.projectPath;
    state.rootNodeId = data.rootNodeId || null;
    state.globalNode = data.globalNode || null;
    state.nodes = data.nodes || [];
    state.graph = data.graph || { edges: [] };
    state.images = data.images || [];
    state.audio = data.audio || [];
    state.optionTargets = data.optionTargets || [];
    state.stats = SceneStateEditor.withStatOrders(data.stats || {});
    state.statsDraft = clone(state.stats);
    state.memories = data.memories || { memory: { Name: "Memory" } };
    state.memoriesDraft = clone(state.memories);
    state.issues = data.issues || [];
    const preferred = previous === state.globalNode?.path
      ? previous
      : state.nodes.find((item) => item.path === previous)?.path || state.nodes[0]?.path || state.globalNode?.path || null;
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
    detail.events = normalizeEventEntries(detail.events);
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
  const optionsTab = dom.tabbar?.querySelector('[data-tab="options"]');
  if (optionsTab) {
    optionsTab.disabled = false;
    optionsTab.title = "";
  }
  updateHeader();
  updateDatalists();
  renderNodeList();
  renderNodePanel();
  renderEventsPanel();
  renderOptionsPanel();
  renderContentPanel();
  renderStatsPanel();
  renderGraphPanel();
  renderValidationPanel();
  switchTab(state.activeTab, { render: false });
  updateEmptyState();
  syncShortcutTitles();
}

function syncTabFocusIndicator({ immediate = false, targetTab = null } = {}) {
  const indicator = dom.tabFocusIndicator;
  const activeTab = targetTab || dom.tabbar?.querySelector(".tab.active");
  if (!indicator || !activeTab) return;
  if (immediate) indicator.classList.add("no-transition");
  indicator.style.left = `${activeTab.offsetLeft}px`;
  indicator.style.width = `${activeTab.offsetWidth}px`;
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
    if (tab === "stats") renderStatsPanel();
    if (tab === "graph") renderGraphPanel();
    if (tab === "validation") renderValidationPanel();
  }
  updateEmptyState();
  if (isSwitchingTab) playWorkspaceAnimation("tab-switch-enter");
}

async function refreshGraphSnapshot() {
  const project = await api("/api/project");
  state.rootNodeId = project.rootNodeId || null;
  state.globalNode = project.globalNode || null;
  state.nodes = project.nodes || [];
  state.graph = project.graph || { edges: [] };
  updateHeader();
  updateDatalists();
  renderNodeList();
  renderNodePanel();
}

async function requestTabSwitch(tab, options = {}) {
  const isSwitchingTab = tab !== state.activeTab;
  if (isSwitchingTab && !await flushAutosave()) return false;
  if (isSwitchingTab && tab === "graph") {
    setSaveState(t("讀取中"), "saving");
    try {
      await refreshGraphSnapshot();
      setSaveState(t("已同步"));
    } catch (error) {
      setSaveState(t("讀取失敗"), "error");
      toast(error.message, "error");
      return false;
    }
  }
  switchTab(tab, options);
  return true;
}

function renderNodePanel() {
  if (!state.nodeDetail) {
    dom.nodePanel.innerHTML = "";
    return;
  }
  const node = state.nodeDetail.node;
  const isGlobal = isGlobalNode();
  const isRoot = node.ID === state.rootNodeId;
  const events = (state.nodeDetail.events || []).map((entry) => entry.data || {});
  const optionsCount = state.nodeDetail.options?.Elements?.length || 0;
  const labelCount = (state.nodeDetail.contents || []).reduce((total, content) => total + (content.labels?.length || 0), 0);
  const outgoing = (state.graph?.edges || []).filter((edge) => String(edge.source) === String(node.ID));
  const incoming = (state.graph?.edges || []).filter((edge) => String(edge.target) === String(node.ID));
  const nodeName = (nodeId) => (
    String(state.globalNode?.id) === String(nodeId)
      ? state.globalNode.name
      : state.nodes.find((item) => String(item.id) === String(nodeId))?.name
  ) || nodeId;
  const groupConnections = (items, direction) => {
    const grouped = new Map();
    items.forEach((edge) => {
      const relatedNode = direction === "out" ? edge.target : edge.source;
      const endUp = edge.endUp || "GOTO";
      const key = `${relatedNode}\u0000${endUp}`;
      if (!grouped.has(key)) grouped.set(key, { relatedNode, endUp, count: 0 });
      grouped.get(key).count += 1;
    });
    return [...grouped.values()];
  };
  const incomingConnections = groupConnections(incoming, "in");
  const outgoingConnections = groupConnections(outgoing, "out");
  const connectionChips = (items) => {
    if (!items.length) return '<span class="node-flow-empty">None</span>';
    return items.map((connection) => `
      <span class="node-flow-chip is-${String(connection.endUp).toLocaleLowerCase()}">
        ${escapeHtml(nodeName(connection.relatedNode))}
        <small>${escapeHtml(connection.endUp)}${connection.count > 1 ? ` ×${connection.count}` : ""}</small>
      </span>
    `).join("");
  };
  const lifecycleCount = (trigger) => events.filter((event) => event.Trigger === trigger).length;
  dom.nodePanel.innerHTML = `
    <div class="panel-page node-panel-page">
      <div class="node-editor-shell">
        <div class="node-root-row">
          <div>
            <span class="root-node-badge ${isGlobal ? "is-global" : ""}">${isGlobal ? "GLOBAL" : isRoot ? "ROOT" : "NODE"}</span>
            <span>${escapeHtml(isGlobal ? t("套用至所有 Scene Node 的全域事件與選項作用域") : isRoot ? t("目前的遊戲起始節點") : t("可設為遊戲起始節點"))}</span>
          </div>
          ${isGlobal || isRoot ? "" : `<button class="quiet-button compact" id="setRootNodeButton" type="button">${escapeHtml(t("設為起始節點"))}</button>`}
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
        </form>

        <section class="node-overview" aria-label="Node overview">
          <div class="node-overview-metrics">
            <article><span>Events</span><strong>${events.length}</strong></article>
            <article><span>Options</span><strong>${optionsCount}</strong></article>
            <article><span>Content Labels</span><strong>${labelCount}</strong></article>
            <article><span>Flow Links</span><strong>${outgoingConnections.length}</strong></article>
          </div>
          <div class="node-overview-details">
            <article class="node-overview-card">
              <header><span>FLOW</span><strong>${isGlobal ? "Contextual Transitions" : "Node Connections"}</strong></header>
              <div class="node-flow-row">
                <span>Incoming</span>
                <div>${connectionChips(incomingConnections)}</div>
              </div>
              <div class="node-flow-row">
                <span>Outgoing</span>
                <div>${connectionChips(outgoingConnections)}</div>
              </div>
            </article>
            <article class="node-overview-card">
              <header><span>LIFECYCLE</span><strong>Event Phases</strong></header>
              <div class="node-lifecycle-grid">
                <div><span>On Enter</span><strong>${lifecycleCount("Auto:Enter")}</strong></div>
                <div><span>On Node</span><strong>${lifecycleCount("Auto:Node")}</strong></div>
                <div><span>On Exit</span><strong>${lifecycleCount("Auto:Exit")}</strong></div>
              </div>
            </article>
          </div>
        </section>

        ${isGlobal ? "" : `<div class="editor-danger-zone">
          <button class="danger-button" id="deleteNodeButton" type="button" ${isRoot ? `disabled title="${escapeHtml(t("請先將其他節點設為起始節點"))}"` : ""}>${escapeHtml(t("刪除節點"))}</button>
        </div>`}
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
  if (isGlobalNode()) {
    toast(t("Global Node 不可設為起始節點。"), "error");
    return;
  }
  const nodeId = state.nodeDetail.node.ID;
  setSaveState(t("儲存中..."), "saving");
  try {
    const result = await api("/api/project/root", { method: "PUT", body: { nodeId } });
    state.rootNodeId = result.rootNodeId;
    state.nodes.forEach((node) => { node.isRoot = node.id === state.rootNodeId; });
    state.issues = (await api("/api/validate")).issues || [];
    renderNodeList();
    renderNodePanel();
    renderValidationPanel();
    updateHeader();
    setSaveState(t("已同步"));
    toast(t("{name} 已設為起始節點", { name: state.nodeDetail.node.Name || nodeId }));
  } catch (error) {
    setSaveState(t("儲存失敗"), "error");
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
    },
  };
}

async function persistNodeSnapshot(snapshot, task = null) {
  await api("/api/node", { method: "PUT", body: snapshot });
  if (task && !isCurrentAutosaveTask(task)) return;
  if (state.selectedNodePath !== snapshot.path || !state.nodeDetail) return;
  state.nodeDetail.node = { ...state.nodeDetail.node, ...snapshot.node };
  const summary = state.nodes.find((node) => node.path === snapshot.path);
  if (summary) {
    summary.name = snapshot.node.Name || snapshot.node.ID;
    summary.id = snapshot.node.ID;
  } else if (snapshot.path === state.globalNode?.path) {
    state.globalNode.name = snapshot.node.Name || GLOBAL_NODE_ID;
    state.globalNode.id = GLOBAL_NODE_ID;
  }
  updateHeader();
  renderNodeList();
}

function scheduleNodeAutosave() {
  const snapshot = readNodeForm();
  if (snapshot) scheduleAutosave(t("編輯器設定未能儲存"), (task) => persistNodeSnapshot(snapshot, task));
}

async function saveNode(event) {
  event.preventDefault();
  const snapshot = readNodeForm(event.currentTarget);
  await cancelAutosaveAndWait();
  setSaveState(t("儲存中..."), "saving");
  try {
    await persistNodeSnapshot(snapshot);
    await refreshAfterSave();
    toast(t("節點設定已儲存"));
  } catch (error) {
    setSaveState(t("儲存失敗"), "error");
    toast(error.message, "error");
  }
}

async function deleteNode() {
  const node = state.nodeDetail?.node;
  if (!node) return;
  if (isGlobalNode()) {
    toast(t("Global Node 不可刪除。"), "error");
    return;
  }
  try {
    const check = await api(`/api/node/references?path=${encodeURIComponent(state.selectedNodePath)}`);
    if (check.references.length) {
      const lines = check.references.slice(0, 8).map((reference) => `• ${reference.nodeName} / ${reference.eventName}`);
      window.alert(t("目前仍有 {count} 個 Event 指向「{name}」：\n\n{lines}\n\n請先修改這些 Next Node。", { count: check.references.length, name: node.Name || node.ID, lines: lines.join("\n") }));
      return;
    }
    const eventCount = state.nodeDetail.events.length;
    const contentCount = state.nodeDetail.contents.length;
    const confirmed = window.confirm(t("確定刪除「{name}」？\n\n{events} 個 Event、{contents} 個 Content 將移至可復原區。", { name: node.Name || node.ID, events: eventCount, contents: contentCount }));
    if (!confirmed) return;
    await cancelAutosaveAndWait();
    const result = await api(`/api/nodes?path=${encodeURIComponent(state.selectedNodePath)}`, { method: "DELETE" });
    state.selectedNodePath = null;
    state.nodeDetail = null;
    await loadProject({ preserveNode: false });
    toast(t("節點已移至可復原區：{id}", { id: result.backup }));
  } catch (error) {
    setSaveState(t("儲存失敗"), "error");
    toast(error.message, "error");
  }
}

function eventActionChoices(current = "") {
  const options = state.optionsDraft || state.nodeDetail?.options || defaultOptionsDraft();
  const choices = [];
  const seen = new Set();
  const addChoice = (trigger) => {
    const value = String(trigger || "").trim();
    if (!value || value.startsWith("Auto:") || seen.has(value)) return;
    seen.add(value);
    choices.push({ id: value, name: actionTriggerName(value) });
  };
  (options.Elements || []).forEach((element) => {
    if (element.Type === "TEXTBOX") {
      (element.Items || []).forEach((item) => addChoice(item.Trigger));
    } else {
      addChoice(element.Trigger);
    }
  });
  const currentValue = String(current || "").trim();
  if (currentValue && !currentValue.startsWith("Auto:") && !seen.has(currentValue)) {
    choices.push({ id: currentValue, name: t("{name}（未找到）", { name: actionTriggerName(currentValue) }) });
  }
  return choices;
}

function defaultEvent(id = generateId("event")) {
  const nextOrder = Math.max(-1, ...eventPoolItems().map((event) => numberValue(event.Order, -1))) + 1;
  return {
    ID: id,
    Name: "新事件",
    Group: DEFAULT_EVENT_GROUP,
    Order: nextOrder,
    Trigger: eventActionChoices()[0]?.id || "Auto:Node",
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

function eventPoolItems() {
  const items = (state.nodeDetail?.events || []).map((entry, index) => {
    const event = entry.data.ID === state.selectedEventId && state.eventDraft ? state.eventDraft : entry.data;
    return { ...event, Order: Number.isInteger(event.Order) ? event.Order : index, _file: entry.file };
  });
  if (state.eventDraft && !items.some((event) => event.ID === state.eventDraft.ID)) {
    items.push({ ...state.eventDraft, _file: `${state.eventDraft.ID}.json` });
  }
  return items.sort((left, right) => left.Order - right.Order || String(left.ID).localeCompare(String(right.ID)));
}

function normalizeEventEntries(entries) {
  return (entries || [])
    .map((entry, index) => ({
      ...entry,
      data: {
        ...(entry.data || {}),
        Order: Number.isInteger(entry.data?.Order) && entry.data.Order >= 0 ? entry.data.Order : index,
      },
      fallbackOrder: index,
    }))
    .sort((left, right) => (
      left.data.Order - right.data.Order
      || left.fallbackOrder - right.fallbackOrder
    ))
    .map(({ fallbackOrder: _fallbackOrder, ...entry }, index) => ({
      ...entry,
      data: { ...entry.data, Order: index },
    }));
}

function eventListItemHtml(event, group) {
  return `
    <button class="subnav-item group-drag-item ${event.ID === state.selectedEventId ? "active" : ""}" type="button" aria-grabbed="false" data-event-id="${escapeHtml(event.ID)}" data-group-item-id="${escapeHtml(event.ID)}" data-group-item-group="${escapeHtml(group)}">
      <span class="subnav-item-copy">
        <strong>${escapeHtml(event.Name || event.ID || event._file)}</strong>
        <span>${escapeHtml(eventTriggerDisplayName(event.Trigger))}</span>
      </span>
      <span class="priority-badge" title="Priority">${escapeHtml(event.Priority ?? 5)}</span>
    </button>
  `;
}

function eventListHtml() {
  const events = eventPoolItems();
  if (!events.length) return `<div class="node-list-empty">${escapeHtml(t("尚未建立 Event"))}</div>`;
  return `
    <div class="event-pool-flow" data-group-drop="${DEFAULT_EVENT_GROUP}" data-event-ungrouped-drop>
      ${eventPoolBlocks(events).map((block) => block.type === "item"
        ? eventListItemHtml(block.event, DEFAULT_EVENT_GROUP)
        : `
          <section class="event-group" data-group-drop="${escapeHtml(block.name)}">
            <div class="event-group-header">
              <input class="event-group-name" data-event-group-name="${escapeHtml(block.name)}" aria-label="${escapeHtml(t("群組名稱"))}" maxlength="80" value="${escapeHtml(block.name)}">
              <div class="group-block-drag-space event-group-drag-space" title="${escapeHtml(t("拖移群組"))}" aria-label="${escapeHtml(t("拖移群組"))}"></div>
              <span class="event-group-count" aria-hidden="true">${block.events.length}</span>
            </div>
            <div class="event-group-items-shell">
              <div class="event-group-items">
                ${block.events.map((event) => eventListItemHtml(event, block.name)).join("")}
              </div>
            </div>
          </section>
        `).join("")}
      <div class="group-loose-drop-tail event-loose-drop-tail" aria-hidden="true"></div>
    </div>
  `;
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
  eventGroupDragController?.destroy();
  eventGroupDragController = null;
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
            <button class="icon-button add-button" id="newEventButton" type="button" title="${escapeHtml(t("新增 Event"))}" aria-label="${escapeHtml(t("新增 Event"))}">＋</button>
          </div>
        </div>
        <div class="subnav-list">${eventListHtml()}</div>
      </aside>
      <div class="editor-scroll" id="eventEditorScroll">
        ${state.eventDraft ? eventEditorHtml(state.eventDraft) : `
          <div class="editor-empty">
            <div>
              <p>${escapeHtml(t("這個節點還沒有 Event。"))}</p>
              <button class="primary-button add-button" id="emptyNewEventButton" type="button">${escapeHtml(t("新增 Event"))}</button>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
  bindEventPanel();
  if (view) restoreEventPanelView(view);
  if (pendingEventGroupFocus) {
    const input = document.querySelector(`[data-event-group-name="${CSS.escape(pendingEventGroupFocus)}"]`);
    pendingEventGroupFocus = null;
    input?.focus({ preventScroll: true });
    input?.select();
  }
  syncShortcutTitles();
}

function eventEditorHtml(event) {
  const triggerMode = eventTriggerMode(event.Trigger);
  const lifecycle = isLifecycleTrigger(event.Trigger);
  const triggerInput = triggerMode === "Action"
    ? `<select name="Trigger" aria-label="${escapeHtml(t("Option 選項"))}" required>${namedOptionTags(eventActionChoices(event.Trigger), event.Trigger)}</select>`
    : triggerMode === "Keyboard"
      ? `<input class="keyboard-trigger-recorder" data-keyboard-trigger readonly aria-label="${escapeHtml(t("Keyboard 按鍵"))}" value="${escapeHtml(keyboardKeysymDisplay(keyboardTriggerKeysym(event.Trigger)))}" title="${escapeHtml(t("聚焦後直接按下按鍵或按鍵組合"))}">
         <input name="Trigger" type="hidden" value="${escapeHtml(event.Trigger)}">`
      : triggerMode === "Mouse"
        ? `<select name="Trigger" aria-label="${escapeHtml(t("Mouse 按鍵"))}" required>${namedOptionTags(MOUSE_TRIGGER_CHOICES, event.Trigger, { translateLabels: true })}</select>`
        : `<select name="Trigger" aria-label="${escapeHtml(t("Auto 時機"))}" required>${namedOptionTags(AUTO_TRIGGER_CHOICES, event.Trigger, { translateLabels: true })}</select>`;
  return `
    <form class="editor-page" id="eventForm">
      <div class="form-section event-primary-section">
        <div class="form-grid event-primary-name-grid">
          <label class="field"><span>Name</span><input name="Name" required value="${escapeHtml(event.Name || event.ID || "")}"></label>
          <div class="field event-trigger-field">
            <span>Trigger</span>
            <div class="event-trigger-control is-${triggerMode.toLocaleLowerCase()}">
              <select name="TriggerMode" aria-label="${escapeHtml(t("Trigger 模式"))}">${namedOptionTags(eventTriggerModeChoices(), triggerMode, { translateLabels: true })}</select>
              ${triggerInput}
            </div>
          </div>
        </div>
        <div class="form-grid event-primary-settings-grid ${lifecycle ? "is-lifecycle" : ""}">
          <label class="field"><span>Priority</span><input name="Priority" type="number" min="0" max="5" step="1" value="${escapeHtml(event.Priority ?? 5)}"></label>
          ${lifecycle ? "" : `<label class="field"><span>Weight</span><input name="Weight" type="number" min="0.0001" step="any" value="${escapeHtml(event.Weight ?? 1)}"></label>`}
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
          <div><h3>Conditions</h3><span>${escapeHtml(t("{count} 個條件", { count: event.Conditions?.length || 0 }))}</span></div>
          <button class="icon-button section-add-button add-button" id="addConditionButton" type="button" title="${escapeHtml(t("新增條件"))}" aria-label="${escapeHtml(t("新增條件"))}">＋</button>
        </summary>
        <div class="collapsible-section-body"><div class="repeat-list" id="conditionList">${conditionRowsHtml(event.Conditions || [])}</div></div>
      </details>

      <details class="form-section collapsible-section" open>
        <summary class="form-section-header">
          <div><h3>Effects</h3><span>${escapeHtml(t("{count} 個效果", { count: event.Effects?.length || 0 }))}</span></div>
          <button class="icon-button section-add-button add-button" id="addEffectButton" type="button" title="${escapeHtml(t("新增 Effect"))}" aria-label="${escapeHtml(t("新增 Effect"))}">＋</button>
        </summary>
        <div class="collapsible-section-body"><div class="repeat-list" id="effectList">${effectRowsHtml(event.Effects || [])}</div></div>
      </details>

      <details class="form-section collapsible-section event-choice-section" open>
        <summary class="form-section-header">
          <div><h3>Content</h3><span>${escapeHtml(t("{count} 個演出", { count: choiceEntries(event.Content).length }))}</span></div>
          <button class="icon-button section-add-button add-button" type="button" data-add-weighted="content" title="${escapeHtml(t("新增演出"))}" aria-label="${escapeHtml(t("新增演出"))}">＋</button>
        </summary>
        <div class="collapsible-section-body">${choiceBlockHtml(event.Content, "content")}</div>
      </details>

      ${lifecycle ? "" : `<details class="form-section collapsible-section event-choice-section" open>
        <summary class="form-section-header">
          <div><h3>End up</h3><span>${escapeHtml(event["End up"] || "REDO")}</span></div>
          ${endUpUsesNextNode(event["End up"]) ? `<button class="icon-button section-add-button add-button" type="button" data-add-weighted="next" title="${escapeHtml(t("新增節點"))}" aria-label="${escapeHtml(t("新增節點"))}">＋</button>` : ""}
        </summary>
        <div class="collapsible-section-body">
          <div class="end-up-control">
            <label class="field"><span class="visually-hidden">End up</span><select name="EndUp" aria-label="End up">${optionTags(END_UP_CHOICES, event["End up"] || "REDO")}</select></label>
          </div>
          <div id="nextNodeBlock">${endUpUsesNextNode(event["End up"]) ? choiceBlockHtml(event["Next Node"], "next") : ""}</div>
        </div>
      </details>`}

      ${state.eventOriginalId ? `<div class="editor-danger-zone"><button class="danger-button" id="deleteEventButton" type="button">${escapeHtml(t("刪除事件"))}</button></div>` : ""}
    </form>
  `;
}

function readEventForm() {
  const form = document.querySelector("#eventForm");
  if (!form) return state.eventDraft || defaultEvent();
  const { conditions, effects } = readRules(form);
  const trigger = form.elements.Trigger.value.trim();
  const lifecycle = isLifecycleTrigger(trigger);
  const result = {
    ID: form.elements.ID.value.trim(),
    Name: form.elements.Name.value.trim(),
    Group: normalizeEventGroup(state.eventDraft?.Group),
    Order: Math.max(0, Math.trunc(numberValue(state.eventDraft?.Order, 0))),
    Trigger: trigger,
    Priority: Math.trunc(numberValue(form.elements.Priority.value, 5)),
    Once: form.elements.Once.checked,
    Conditions: conditions,
    Effects: effects,
    Content: readChoice(form, "content"),
  };
  if (lifecycle) return result;
  const endUp = form.elements.EndUp?.value || state.eventDraft?.["End up"] || "REDO";
  result.Weight = numberValue(form.elements.Weight?.value ?? state.eventDraft?.Weight, 1);
  result["End up"] = endUp;
  result["Next Node"] = endUpUsesNextNode(endUp) ? readChoice(form, "next") : null;
  return result;
}

function bindEventPanel() {
  document.querySelectorAll("[data-event-id]").forEach((button) => button.addEventListener("click", () => selectEvent(button.dataset.eventId)));
  document.querySelector("#newEventButton")?.addEventListener("click", () => createEventDraft());
  document.querySelector("#emptyNewEventButton")?.addEventListener("click", () => createEventDraft());
  document.querySelectorAll("[data-event-group-name]").forEach((input) => {
    const source = input.dataset.eventGroupName;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        input.value = source;
        input.blur();
      }
    });
    input.addEventListener("change", async () => {
      const target = input.value.trim();
      if (!target) {
        input.value = source;
        return;
      }
      await renameEventGroup(source, target);
    });
  });
  eventGroupDragController = SceneGroupDrag.createController({
    root: dom.eventsPanel.querySelector(".event-pool-flow"),
    itemSelector: "[data-group-item-id]",
    groupSelector: ".event-group[data-group-drop]",
    ungroupedSelector: "[data-event-ungrouped-drop]",
    groupHandleSelector: ".event-group-drag-space",
    listSelector: ".event-group-items",
    onDrop: applyEventGroupDrop,
    onGroupDrop: applyEventGroupBlockDrop,
    onError: (error) => toast(error.message, "error"),
  });
  const form = document.querySelector("#eventForm");
  if (!form) return;
  form.addEventListener("submit", saveEvent);
  const keyboardTriggerInput = form.querySelector("[data-keyboard-trigger]");
  keyboardTriggerInput?.addEventListener("focus", () => keyboardTriggerInput.select());
  keyboardTriggerInput?.addEventListener("keydown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const keysym = keyboardKeysymFromEvent(event);
    if (!keysym) return;
    form.elements.Trigger.value = `Keyboard:${keysym}`;
    keyboardTriggerInput.value = keyboardKeysymDisplay(keysym);
    state.eventDraft = readEventForm();
    scheduleEventAutosave({ useDraft: true });
  });
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.closest(".content-choice-picker")) {
      closeContentPickers();
      event.target.closest(".content-choice-picker")?.querySelector("[data-content-picker-toggle]")?.focus();
      event.preventDefault();
      return;
    }
    const picker = event.target.closest(".content-choice-picker");
    const pickerToggle = event.target.closest("[data-content-picker-toggle]");
    const fileExpand = event.target.closest("[data-content-file-expand]");
    const labelChoice = event.target.closest("[data-content-label-choice]");
    if (pickerToggle && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      if (!picker.classList.contains("open")) pickerToggle.click();
      const items = directMenuItems(
        picker.querySelector(":scope > .content-choice-menu"),
        "[data-content-file-expand]",
        "[data-content-label-choice]",
      );
      items[event.key === "ArrowDown" ? 0 : items.length - 1]?.focus();
      event.preventDefault();
    } else if (fileExpand && ["ArrowRight", "Enter", " "].includes(event.key)) {
      const branch = event.target.closest(".content-file-branch");
      setSubmenuOpen(branch, true, positionContentSubmenu);
      directMenuItems(
        branch.querySelector(":scope > .content-label-submenu"),
        "[data-content-file-expand]",
        "[data-content-label-choice]",
      )[0]?.focus();
      event.preventDefault();
    } else if (event.key === "ArrowLeft" && event.target.closest(".content-label-submenu")) {
      const branch = event.target.closest(".content-label-submenu").parentElement;
      setSubmenuOpen(branch, false, positionContentSubmenu);
      branch.querySelector(":scope > [data-content-file-expand]")?.focus();
      event.preventDefault();
    } else if ((fileExpand || labelChoice) && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      focusRelativeMenuItem(
        event.target,
        event.key,
        "[data-content-file-expand]",
        "[data-content-label-choice]",
      );
      event.preventDefault();
    } else if (labelChoice && ["Enter", " "].includes(event.key)) {
      labelChoice.click();
      event.preventDefault();
    }
  });
  form.addEventListener("pointerover", (event) => {
    let branch = event.target.closest(".content-file-branch");
    while (branch && form.contains(branch)) {
      clearSubmenuClose(branch);
      branch = branch.parentElement?.closest(".content-file-branch");
    }
    const fileExpand = event.target.closest("[data-content-file-expand]");
    if (fileExpand) setSubmenuOpen(fileExpand.closest(".content-file-branch"), true, positionContentSubmenu);
  });
  form.addEventListener("pointerout", (event) => {
    const branch = event.target.closest(".content-file-branch");
    if (branch && !branch.contains(event.relatedTarget)) scheduleSubmenuClose(branch);
  });
  form.addEventListener("focusin", (event) => {
    const branch = event.target.closest(".content-file-branch");
    if (branch) setSubmenuOpen(branch, true, positionContentSubmenu);
  });
  document.querySelector("#deleteEventButton")?.addEventListener("click", deleteEvent);
  document.querySelector("#addConditionButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const condition = newStateRule("condition", "stat") || newStateRule("condition", "memory");
    state.eventDraft = readEventForm();
    state.eventDraft.Conditions.push(condition);
    scheduleEventAutosave({ useDraft: true });
    renderEventsPanel({ preserveView: true });
  });
  document.querySelector("#addEffectButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const effect = newStateRule("effect", "stat") || newStateRule("effect", "memory");
    state.eventDraft = readEventForm();
    state.eventDraft.Effects.push(effect);
    scheduleEventAutosave({ useDraft: true });
    renderEventsPanel({ preserveView: true });
  });
  form.addEventListener("click", (event) => {
    const pickerToggle = event.target.closest("[data-content-picker-toggle]");
    const fileExpand = event.target.closest("[data-content-file-expand]");
    const labelChoice = event.target.closest("[data-content-label-choice]");
    if (pickerToggle) {
      const picker = pickerToggle.closest(".content-choice-picker");
      const opening = !picker.classList.contains("open");
      closeContentPickers(opening ? picker : null);
      picker.classList.toggle("open", opening);
      pickerToggle.setAttribute("aria-expanded", String(opening));
      if (opening) positionContentMenu(picker);
      event.preventDefault();
      return;
    }
    if (fileExpand) {
      const branch = fileExpand.closest(".content-file-branch");
      setSubmenuOpen(branch, true, positionContentSubmenu);
      event.preventDefault();
      return;
    }
    if (labelChoice) {
      const picker = labelChoice.closest(".content-choice-picker");
      const input = picker?.closest(".content-choice-field")?.querySelector('[name="contentWeightedId"]');
      if (input) input.value = labelChoice.dataset.contentLabelChoice;
      state.eventDraft = readEventForm();
      scheduleEventAutosave({ useDraft: true });
      renderEventsPanel({ preserveView: true });
      event.preventDefault();
      return;
    }
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
      state.eventDraft[key] = removeWeightedChoice(state.eventDraft[key], indexText);
    } else if (addWeighted) {
      state.eventDraft = readEventForm();
      const key = addWeighted === "content" ? "Content" : "Next Node";
      const available = addWeighted === "content" ? contentChoices() : nodeChoices();
      if (!available.length) {
        toast(addWeighted === "content" ? t("目前節點沒有可用的 Content label。") : t("目前專案沒有 Scene Node。"), "error");
        return;
      }
      state.eventDraft[key] = addWeightedChoice(
        state.eventDraft[key],
        available,
        addWeighted === "content" ? "missingContent" : "missingNode",
      );
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
          draft.Trigger = "Auto:Node";
          draft.Weight ??= 1;
          draft["End up"] ??= "REDO";
          draft["Next Node"] ??= null;
          state.eventDraft = draft;
          scheduleEventAutosave({ useDraft: true });
          renderEventsPanel({ preserveView: true });
          toast(t("目前節點尚未建立可供 Event 使用的選項。"), "error");
          return;
        }
        draft.Trigger = action;
      } else if (event.target.value === "Keyboard") {
        draft.Trigger = "Keyboard:K_SPACE";
      } else if (event.target.value === "Mouse") {
        draft.Trigger = MOUSE_TRIGGER_CHOICES[0].id;
      } else {
        draft.Trigger = "Auto:Node";
      }
      draft.Weight ??= 1;
      draft["End up"] ??= "REDO";
      draft["Next Node"] ??= null;
      state.eventDraft = draft;
      scheduleEventAutosave({ useDraft: true });
      renderEventsPanel({ preserveView: true });
      return;
    } else if (event.target.name === "Trigger" && eventTriggerMode(event.target.value) === "Auto") {
      const draft = readEventForm();
      if (isLifecycleTrigger(draft.Trigger)) {
        delete draft.Weight;
        delete draft["End up"];
        delete draft["Next Node"];
      } else {
        draft.Weight ??= 1;
        draft["End up"] ??= "REDO";
        draft["Next Node"] ??= null;
      }
      state.eventDraft = draft;
      scheduleEventAutosave({ useDraft: true });
      renderEventsPanel({ preserveView: true });
      return;
    } else if (event.target.name === "Group") {
      state.eventDraft = readEventForm();
      scheduleEventAutosave({ useDraft: true });
      renderEventsPanel({ preserveView: true });
      return;
    } else if (event.target.name === "conditionType") {
      const row = event.target.closest(".condition-row");
      const index = Number(row.dataset.index);
      const type = event.target.value;
      event.target.value = row.dataset.conditionType;
      state.eventDraft = readEventForm();
      if (!replaceRuleType(state.eventDraft, "condition", index, type)) {
        warnMissingStat("Condition");
        renderEventsPanel({ preserveView: true });
        scheduleEventAutosave({ useDraft: true });
        return;
      }
      renderEventsPanel({ preserveView: true });
    } else if (event.target.name === "effectType") {
      const row = event.target.closest(".effect-row");
      const index = Number(row.dataset.index);
      const type = event.target.value;
      event.target.value = row.dataset.effectType;
      state.eventDraft = readEventForm();
      if (!replaceRuleType(state.eventDraft, "effect", index, type)) {
        if (type === "option") warnMissingOptionTarget();
        else warnMissingStat("Effect");
        renderEventsPanel({ preserveView: true });
        scheduleEventAutosave({ useDraft: true });
        return;
      }
      renderEventsPanel({ preserveView: true });
    } else if (event.target.name === "effectOp" && event.target.closest(".effect-row")?.dataset.effectType === "memory") {
      state.eventDraft = readEventForm();
      renderEventsPanel({ preserveView: true });
    } else if (event.target.name === "EndUp") {
      state.eventDraft = readEventForm();
      state.eventDraft["End up"] = event.target.value;
      state.eventDraft["Next Node"] = endUpUsesNextNode(event.target.value) ? (state.nodes[0]?.id || "") : null;
      renderEventsPanel({ preserveView: true });
    }
    scheduleEventAutosave();
  });
  form.addEventListener("input", (event) => {
    if (["Trigger", "conditionType", "effectType", "EndUp"].includes(event.target.name)) return;
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

async function createEventDraft(group = DEFAULT_EVENT_GROUP) {
  if (!await flushAutosave()) return;
  const id = generateId("event");
  state.selectedEventId = id;
  state.eventOriginalId = null;
  state.eventDraft = defaultEvent(id);
  state.eventDraft.Group = normalizeEventGroup(group);
  renderEventsPanel();
  scheduleEventAutosave();
  document.querySelector('[name="Name"]')?.focus();
}

async function renameEventGroup(source, target) {
  const normalizedTarget = normalizeEventGroup(target);
  if (source === normalizedTarget) return true;
  if (!await flushAutosave()) return false;
  setSaveState(t("儲存中..."), "saving");
  try {
    const result = await api("/api/event-groups", {
      method: "PUT",
      body: { node: state.selectedNodePath, source, target: normalizedTarget },
    });
    const updates = new Map((result.events || []).map((event) => [event.ID, event]));
    state.nodeDetail.events.forEach((entry) => {
      if (updates.has(entry.data.ID)) entry.data = clone(updates.get(entry.data.ID));
    });
    if (state.eventDraft && updates.has(state.eventDraft.ID)) {
      state.eventDraft = clone(updates.get(state.eventDraft.ID));
    }
    renderEventsPanel({ preserveView: true });
    setSaveState(t("已同步"));
    toast(source === normalizedTarget ? t("Event 群組未變更") : t("Event 群組已更新"));
    return true;
  } catch (error) {
    setSaveState(t("儲存失敗"), "error");
    toast(error.message, "error");
    return false;
  }
}

async function assignEventGroups(assignments, { focusGroup = null, order = null, message = null, notify = true } = {}) {
  if (!Object.keys(assignments || {}).length && !order) return true;
  if (!await flushAutosave()) return false;
  setSaveState(t("儲存中..."), "saving");
  try {
    const result = await api("/api/event-groups", {
      method: "PUT",
      body: { node: state.selectedNodePath, assignments, order },
    });
    const updates = new Map((result.events || []).map((event) => [event.ID, event]));
    state.nodeDetail.events.forEach((entry) => {
      if (updates.has(entry.data.ID)) entry.data = clone(updates.get(entry.data.ID));
    });
    if (order) {
      const indexes = new Map(order.map((id, index) => [id, index]));
      state.nodeDetail.events.sort((left, right) => indexes.get(left.data.ID) - indexes.get(right.data.ID));
    }
    if (state.eventDraft && updates.has(state.eventDraft.ID)) state.eventDraft = clone(updates.get(state.eventDraft.ID));
    pendingEventGroupFocus = focusGroup;
    renderEventsPanel({ preserveView: true });
    setSaveState(t("已同步"));
    if (notify) toast(message || (focusGroup ? t("群組已建立") : t("Event 排序已更新")));
    return true;
  } catch (error) {
    setSaveState(t("儲存失敗"), "error");
    toast(error.message, "error");
    return false;
  }
}

async function applyEventGroupDrop({ mode, sourceId, targetId, targetGroup, position }) {
  const items = eventPoolItems().map((event) => ({ id: event.ID, group: event.Group }));
  const settings = { sourceId, targetId, targetGroup, position, defaultGroup: DEFAULT_EVENT_GROUP };
  const plan = mode === "group"
    ? SceneGroupDrag.planGroupDrop(items, { ...settings, newGroupName: t("新群組") })
    : SceneGroupDrag.planReorder(items, settings);
  if (!plan) return false;
  return assignEventGroups(plan.assignments, {
    focusGroup: plan.createdGroup,
    order: plan.order,
    notify: false,
  });
}

async function applyEventGroupBlockDrop({ sourceGroup, targetId, position }) {
  const items = eventPoolItems().map((event) => ({ id: event.ID, group: event.Group }));
  const plan = SceneGroupDrag.planGroupBlockReorder(items, {
    sourceGroup,
    targetId,
    position,
    defaultGroup: DEFAULT_EVENT_GROUP,
  });
  if (!plan) return false;
  return assignEventGroups({}, { order: plan.order, notify: false });
}

async function persistEventSnapshot(snapshot, task = null) {
  const saved = await api("/api/events", {
    method: "POST",
    body: { node: snapshot.node, originalId: snapshot.originalId, event: snapshot.event },
  });
  if (task && !isCurrentAutosaveTask(task)) return saved;
  if (state.selectedNodePath !== snapshot.node || !state.nodeDetail) return saved;
  const originalId = snapshot.originalId || snapshot.event.ID;
  const index = state.nodeDetail.events.findIndex((item) => item.data.ID === originalId);
  const isNewEvent = index < 0;
  const entry = { file: `${saved.ID}.json`, data: clone(saved) };
  if (index >= 0) state.nodeDetail.events[index] = entry;
  else state.nodeDetail.events.push(entry);
  if (state.eventDraft?.ID === snapshot.event.ID) {
    state.selectedEventId = saved.ID;
    state.eventOriginalId = saved.ID;
  }
  updateHeader();
  if (isNewEvent) renderEventsPanel({ preserveView: true });
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
  scheduleAutosave(t("Event 未能儲存"), (task) => persistEventSnapshot(snapshot, task));
}

async function saveEvent(event) {
  event.preventDefault();
  const draft = readEventForm();
  const snapshot = { node: state.selectedNodePath, originalId: state.eventOriginalId, event: clone(draft) };
  await cancelAutosaveAndWait();
  setSaveState(t("儲存中..."), "saving");
  try {
    const saved = await persistEventSnapshot(snapshot);
    state.selectedEventId = saved.ID;
    state.eventOriginalId = saved.ID;
    await refreshAfterSave();
    selectEvent(saved.ID);
    toast(t("Event 已儲存"));
  } catch (error) {
    setSaveState(t("儲存失敗"), "error");
    toast(error.message, "error");
  }
}

async function deleteEvent() {
  if (!state.eventOriginalId || !window.confirm(t("確定刪除 Event「{id}」？", { id: state.eventOriginalId }))) return;
  try {
    await cancelAutosaveAndWait();
    await api(`/api/events?node=${encodeURIComponent(state.selectedNodePath)}&id=${encodeURIComponent(state.eventOriginalId)}`, { method: "DELETE" });
    state.selectedEventId = null;
    state.eventOriginalId = null;
    state.eventDraft = null;
    await refreshAfterSave();
    toast(t("Event 已刪除"));
  } catch (error) {
    setSaveState(t("儲存失敗"), "error");
    toast(error.message, "error");
  }
}

function defaultOptionsDraft() {
  return {
    Version: 2,
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
    Availability: "ALWAYS",
    "Style Override": {},
  };
}

function defaultOptionElement(type) {
  const offset = (state.optionsDraft?.Elements?.length || 0) * 24;
  const base = {
    ID: generateId("option_element"),
    Name: type === "TEXTBOX" ? "選項清單" : type === "PICTURE" ? "圖片選項" : "互動區域",
    Type: type,
    Availability: "ALWAYS",
    Layout: { X: 690 + offset, Y: 360 + offset, Width: 540, Height: type === "TEXTBOX" ? 352 : 180, "Z Order": 10 },
    Hover: { Enabled: true, Color: "#ffffff18" },
    "Hover Sound": "",
    "Click Sound": "",
  };
  if (type === "TEXTBOX") {
    base.List = {
      "Max Visible Items": 4,
      "Item Height": 72,
      "Item Spacing": 12,
      Padding: 16,
      "Show Scrollbar": true,
    };
    base.Style = {
      Background: "#0b1118",
      "Item Background": "#20302a",
      "Text Color": "#ffffff",
      "Text Size": 30,
      "Text Align": 0.5,
    };
    base.Items = [defaultOptionItem(1)];
  } else if (type === "PICTURE") {
    base.Trigger = "Action:新圖片選項";
    base.Picture = { Idle: "", Hover: "", Fit: "CONTAIN", "Keep Aspect": true, "Alpha Hit Test": false, Opacity: 1, Tint: "#ffffff" };
  } else {
    base.Trigger = "Action:新互動區域";
    base.Hitbox = { "Editor Color": "#28a47d", "Editor Opacity": 0.24 };
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

function rangeField(label, path, value, { min = 0, max = 100, step = 1, format = "number", suffix = "", itemField = false } = {}) {
  const displayLabel = t(label);
  const rawNumber = numberValue(value, min);
  const scale = format === "percent" ? 100 : 1;
  const controlMin = min * scale;
  const controlMax = max * scale;
  const controlStep = step * scale;
  const controlValue = Math.round(rawNumber * scale);
  const display = format === "percent" ? `${controlValue}%` : `${rawNumber}${suffix}`;
  const pathAttribute = itemField ? "data-option-item-path" : "data-option-path";
  const metadata = `data-range-format="${escapeHtml(format)}" data-range-suffix="${escapeHtml(suffix)}" data-range-scale="${scale}"`;
  return `
    <div class="field slider-field">
      <span class="slider-field-heading"><span>${escapeHtml(displayLabel)}</span><output>${escapeHtml(display)}</output></span>
      <span class="slider-control">
        <input ${pathAttribute}="${escapeHtml(path)}" ${metadata} type="range" min="${controlMin}" max="${controlMax}" step="${controlStep}" value="${escapeHtml(controlValue)}" aria-label="${escapeHtml(displayLabel)}">
        <input ${pathAttribute}="${escapeHtml(path)}" ${metadata} class="slider-number" type="number" min="${controlMin}" max="${controlMax}" step="${controlStep}" value="${escapeHtml(controlValue)}" aria-label="${escapeHtml(`${displayLabel} ${t("精確值")}`)}">
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
        <input ${colorPath}="${escapeHtml(path)}" type="color" value="${escapeHtml(opaqueColor)}" aria-label="${escapeHtml(`${label} ${t("顏色")}`)}">
        <span class="color-opacity-control">
          <span class="color-opacity-heading"><span>${escapeHtml(t("不透明度"))}</span><output>${opacity}%</output></span>
          <input ${colorPath}="${escapeHtml(path)}" type="range" min="0" max="100" step="1" value="${opacity}" aria-label="${escapeHtml(`${label} ${t("不透明度")}`)}">
        </span>
      </span>
    </div>
  `;
}

function assetUrl(path) {
  return path ? `/api/asset?path=${encodeURIComponent(path)}` : "";
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
  if (!elements.length) return `<div class="node-list-empty">${escapeHtml(t("尚未建立選項"))}</div>`;
  return elements.map((element) => `
    <button class="subnav-item option-element-list-item ${element.ID === state.selectedOptionElementId ? "active" : ""}" type="button" data-option-element-select="${escapeHtml(element.ID)}">
      <span class="subnav-item-copy">
        <strong>${escapeHtml(element.Name || element.ID)}</strong>
        <span>${escapeHtml(optionTypeLabel(element.Type))}${element.Type === "TEXTBOX" ? ` · ${escapeHtml(t("{count} 項", { count: element.Items?.length || 0 }))}` : ""}${element.Availability === "CONTROLLED" ? " · Controlled" : ""}</span>
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
    const hover = element.Hover || {};
    const hoverClass = hover.Enabled !== false ? "hover-effect-enabled" : "";
    const overflowClass = element.List?.["Show Scrollbar"] === false ? "scrollbar-hidden" : "";
    const items = element.Items || [];
    body = `
      <div class="option-textbox-preview" style="padding:${metrics.padding}px;background:${safeColor(style.Background, "#0b1118")}">
        <div class="option-scroll-preview ${overflowClass}" style="max-height:${metrics.contentHeight}px;overflow-y:auto;gap:${metrics.spacing}px">
          ${items.length ? items.map((item) => `
            <button class="option-text-item ${hoverClass} ${item.ID === state.selectedOptionItemId ? "selected" : ""}" type="button" data-option-item-select="${escapeHtml(item.ID)}" style="height:${metrics.itemHeight}px;--option-item-background:${safeColor(style["Item Background"])};--option-hover-color:${safeColor(hover.Color, "#ffffff18")};background:var(--option-item-background);color:${safeColor(style["Text Color"], "#ffffff")};font-size:${numberValue(style["Text Size"], 30)}px;text-align:${numberValue(style["Text Align"], 0.5) === 0 ? "left" : numberValue(style["Text Align"], 0.5) === 1 ? "right" : "center"}">
              ${escapeHtml(item.Text || item.Name || item.ID)}${item.Availability === "CONTROLLED" ? '<span class="visually-hidden">（Controlled）</span>' : ""}
            </button>
          `).join("") : `<div class="option-empty-row" style="height:${metrics.itemHeight}px">${escapeHtml(t("尚未建立 Item"))}</div>`}
        </div>
      </div>
    `;
  } else if (element.Type === "PICTURE") {
    const picture = element.Picture || {};
    const hover = element.Hover || {};
    const idle = picture.Idle || "";
    const hoverImage = hover.Enabled !== false ? picture.Hover || "" : "";
    const fit = picture["Keep Aspect"] === false || picture.Fit === "STRETCH" ? "fill" : picture.Fit === "COVER" ? "cover" : "contain";
    body = idle
      ? `<div class="option-picture-preview ${hover.Enabled !== false ? "hover-effect-enabled" : ""}" style="--picture-opacity:${numberValue(picture.Opacity, 1)};--option-hover-color:${safeColor(hover.Color, "#ffffff18")}">
          <img class="option-picture-idle" src="${escapeHtml(assetUrl(idle))}" alt="" draggable="false" style="object-fit:${fit}">
          ${hoverImage ? `<img class="option-picture-hover" src="${escapeHtml(assetUrl(hoverImage))}" alt="" draggable="false" style="object-fit:${fit}">` : ""}
          <span class="option-picture-hover-color"></span>
        </div>`
      : `<div class="option-picture-placeholder"><span>PICTURE</span><small>${escapeHtml(t("選擇 Idle 圖片"))}</small></div>`;
  } else {
    const hitbox = element.Hitbox || {};
    const hover = element.Hover || {};
    body = `<div class="option-hitbox-preview ${hover.Enabled !== false ? "hover-effect-enabled" : ""}" style="--hitbox-color:${safeColor(hitbox["Editor Color"], "#28a47d")};--hitbox-opacity:${numberValue(hitbox["Editor Opacity"], 0.24)};--option-hover-color:${safeColor(hover.Color, "#ffffff18")}"><span>${escapeHtml(element.Name || "Hitbox")}</span></div>`;
  }

  const handles = selected ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((direction) => `<span class="resize-handle ${direction}" data-option-resize="${direction}"></span>`).join("") : "";
  return `
    <div class="option-stage-element ${selected ? "selected" : ""} type-${element.Type.toLocaleLowerCase()}" data-option-stage-element="${escapeHtml(element.ID)}" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${z}">
      ${body}
      <span class="option-element-caption" data-option-drag-handle>${escapeHtml(element.Name || optionTypeLabel(element.Type))}${element.Availability === "CONTROLLED" ? " · Controlled" : ""}</span>
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

function textBoxItemsHtml(element) {
  const items = element.Items || [];
  return `
    <div class="option-items-list">
      ${items.map((item, index) => `
        <div class="option-item-row">
          <div class="option-item-entry ${item.ID === state.selectedOptionItemId ? "active" : ""}">
            <button type="button" data-option-item-select="${escapeHtml(item.ID)}"><strong>${escapeHtml(item.Name || item.Text || item.ID)}</strong><span>${escapeHtml(actionTriggerName(item.Trigger))}${item.Availability === "CONTROLLED" ? " · Controlled" : ""}</span></button>
            <button class="option-item-delete" type="button" data-delete-option-item="${escapeHtml(item.ID)}" title="${escapeHtml(t("刪除選項"))}" aria-label="${escapeHtml(t("刪除選項"))}">×</button>
          </div>
          <div class="option-item-order">
            <button type="button" data-move-option-item="${index}:-1" title="${escapeHtml(t("上移"))}" aria-label="${escapeHtml(t("上移"))}" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" data-move-option-item="${index}:1" title="${escapeHtml(t("下移"))}" aria-label="${escapeHtml(t("下移"))}" ${index === items.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </div>
      `).join("") || `<div class="row-empty compact-empty">${escapeHtml(t("尚未建立 Item"))}</div>`}
    </div>
  `;
}

function optionBooleanField(label, attributes, checked) {
  return `
    <label class="field option-boolean-field">
      <span>${escapeHtml(label)}</span>
      <span class="boolean-control">
        <input ${attributes} type="checkbox" ${checked ? "checked" : ""}>
        <span class="boolean-display" data-off="False" data-on="True" aria-hidden="true"><i></i></span>
      </span>
    </label>
  `;
}

function optionHoverFields(element, { picture = false } = {}) {
  const hover = element.Hover || {};
  const hoverEnabled = hover.Enabled !== false;
  const pictureData = element.Picture || {};
  return `
    ${optionBooleanField(t("Hover 效果"), 'data-option-path="Hover.Enabled"', hoverEnabled)}
    ${hoverEnabled ? `
      ${transparentColorField(t("Hover 顏色"), "Hover.Color", hover.Color, "#ffffff18")}
      ${picture ? `<label class="field"><span>${escapeHtml(t("Hover 圖片"))}</span><select data-option-path="Picture.Hover" aria-label="${escapeHtml(t("Hover 圖片"))}">${imageOptionTags(pictureData.Hover || "", [{ id: "", name: "None" }])}</select></label>` : ""}
    ` : ""}
  `;
}

function optionSoundSection(element) {
  return `
    <div class="form-section option-sound-section">
      <div class="form-grid two-columns option-field-grid">
        <label class="field"><span>Hover Sound</span><select data-option-path="Hover Sound" aria-label="Hover Sound">${audioOptionTags(element["Hover Sound"] || "", [{ id: "", name: "None" }])}</select></label>
        <label class="field"><span>Click Sound</span><select data-option-path="Click Sound" aria-label="Click Sound">${audioOptionTags(element["Click Sound"] || "", [{ id: "", name: "None" }])}</select></label>
      </div>
    </div>
  `;
}

function optionCollapsibleSection(title, summary, body, extraClass = "") {
  const displayTitle = t(title);
  const displaySummary = summary ? t(summary) : "";
  return `
    <details class="form-section collapsible-section option-collapsible-section ${extraClass}" data-option-section="${escapeHtml(title)}">
      <summary class="form-section-header">
        <div><h3>${escapeHtml(displayTitle)}</h3>${displaySummary ? `<span>${escapeHtml(displaySummary)}</span>` : ""}</div>
      </summary>
      <div class="collapsible-section-body">${body}</div>
    </details>
  `;
}

function optionInspectorHtml() {
  const element = selectedOptionElement();
  if (!element) {
    return `
      <div class="option-inspector-empty">
        <strong>${escapeHtml(state.optionWorkspaceMode === "canvas" ? t("畫布上尚無可調整的選項") : t("選擇或新增選項"))}</strong>
        ${state.optionWorkspaceMode === "canvas" ? `<span>${escapeHtml(t("向左拖曳分隔把手即可回到表單新增。"))}</span>` : ""}
      </div>
    `;
  }
  const layout = element.Layout || {};
  const isCanvas = state.optionWorkspaceMode === "canvas";
  const positionFields = `
    <div class="form-grid two-columns option-field-grid">
      <label class="field"><span>X</span><input data-option-path="Layout.X" type="number" value="${escapeHtml(layout.X ?? 0)}"></label>
      <label class="field"><span>Y</span><input data-option-path="Layout.Y" type="number" value="${escapeHtml(layout.Y ?? 0)}"></label>
    </div>
    <div class="form-grid ${element.Type === "TEXTBOX" ? "" : "two-columns"} option-field-grid">
      <label class="field"><span>${escapeHtml(t("寬度"))}</span><input data-option-path="Layout.Width" type="number" min="24" value="${escapeHtml(layout.Width ?? 100)}"></label>
      ${element.Type === "TEXTBOX" ? "" : `<label class="field"><span>${escapeHtml(t("高度"))}</span><input data-option-path="Layout.Height" type="number" min="24" value="${escapeHtml(layout.Height ?? 100)}"></label>`}
    </div>
  `;
  const zOrderField = `<label class="field"><span>${escapeHtml(t("圖層順序"))}</span><input data-option-path="Layout.Z Order" type="number" value="${escapeHtml(layout["Z Order"] ?? 10)}"></label>`;
  let primary = "";
  let sections = "";

  if (element.Type === "TEXTBOX") {
    const list = element.List || {};
    const style = element.Style || {};
    const item = selectedOptionItem();
    const itemOverride = item?.["Style Override"] || {};
    const hasItemOverride = Object.keys(itemOverride).length > 0;
    if (!isCanvas) {
      primary = `
        <div class="form-grid two-columns option-field-grid">
          <label class="field"><span>Name</span><input data-option-path="Name" value="${escapeHtml(element.Name || "")}"></label>
          <label class="field"><span>Availability</span><select data-option-path="Availability">${optionTags(["ALWAYS", "CONTROLLED"], element.Availability || "ALWAYS", (value) => value === "ALWAYS" ? "Always" : "Controlled")}</select></label>
        </div>
      `;
      sections += `
        <div class="form-section option-textbox-items-section selected-item-editor">
          <div class="form-section-header option-static-header">
            <div><h3>Items</h3><span>${escapeHtml(t("{count} 個選項", { count: element.Items?.length || 0 }))}</span></div>
            <button class="icon-button section-add-button add-button" id="addOptionItem" type="button" title="${escapeHtml(t("新增選項"))}" aria-label="${escapeHtml(t("新增選項"))}">＋</button>
          </div>
          ${textBoxItemsHtml(element)}
          ${item ? `<div class="option-primary-block option-item-fields">
            <div class="form-grid two-columns option-field-grid">
              <label class="field"><span>Name</span><input data-option-item-path="Name" value="${escapeHtml(item.Name || "")}"></label>
              <label class="field"><span>Availability</span><select data-option-item-path="Availability">${optionTags(["ALWAYS", "CONTROLLED"], item.Availability || "ALWAYS", (value) => value === "ALWAYS" ? "Always" : "Controlled")}</select></label>
              <label class="field"><span>Text</span><input data-option-item-path="Text" value="${escapeHtml(item.Text || "")}"></label>
              <label class="field"><span>Trigger</span><input data-option-item-path="Trigger" value="${escapeHtml(actionTriggerName(item.Trigger))}"></label>
            </div>
          </div>` : ""}
        </div>
      `;
      sections += optionSoundSection(element);
    } else {
      primary = positionFields;
      sections += optionCollapsibleSection("版面細節", "", `
        ${zOrderField}
        <div class="option-section-group">
          ${rangeField(t("最多顯示"), "List.Max Visible Items", list["Max Visible Items"] ?? 4, { min: 1, max: 20 })}
          ${rangeField(t("Item 高度"), "List.Item Height", list["Item Height"] ?? 72, { min: 24, max: 240, suffix: " px" })}
          ${rangeField(t("Item 間距"), "List.Item Spacing", list["Item Spacing"] ?? 12, { min: 0, max: 120, suffix: " px" })}
          ${rangeField(t("Padding"), "List.Padding", list.Padding ?? 16, { min: 0, max: 160, suffix: " px" })}
        </div>
        ${optionBooleanField(t("內容超出時顯示滑桿"), 'data-option-path="List.Show Scrollbar"', list["Show Scrollbar"] !== false)}
      `);
      sections += optionCollapsibleSection("外觀", "", `
        <div class="option-section-group">
          ${optionHoverFields(element)}
        </div>
        <div class="option-section-group">
          <h4>${escapeHtml(t("背景"))}</h4>
          <div class="form-grid compact-grid color-grid option-opacity-colors">
            ${transparentColorField(t("容器"), "Style.Background", style.Background, "#0b1118")}
            ${transparentColorField(t("Item"), "Style.Item Background", style["Item Background"], "#20302a")}
          </div>
        </div>
        <div class="option-section-group">
          <h4>${escapeHtml(t("文字"))}</h4>
          <div class="form-grid two-columns compact-grid color-grid">
            <label class="field"><span>${escapeHtml(t("一般"))}</span><input data-option-path="Style.Text Color" type="color" value="${safeColor(style["Text Color"], "#ffffff").slice(0, 7)}"></label>
          </div>
          ${rangeField(t("字體大小"), "Style.Text Size", style["Text Size"] ?? 30, { min: 8, max: 160, suffix: " px" })}
          <label class="field"><span>${escapeHtml(t("文字對齊"))}</span><select data-option-path="Style.Text Align">${optionTags([0, 0.5, 1], style["Text Align"] ?? 0.5, (value) => ({ 0: t("靠左"), 0.5: t("置中"), 1: t("靠右") })[value])}</select></label>
        </div>
        ${item ? `
          <div class="option-section-group">
            ${optionBooleanField(t("使用獨立樣式"), 'id="itemStyleOverrideEnabled"', hasItemOverride)}
            ${hasItemOverride ? `
              <div class="form-grid compact-grid color-grid option-opacity-colors">
                ${transparentColorField(t("背景"), "Style Override.Item Background", itemOverride["Item Background"], style["Item Background"] || "#20302a", true)}
                <label class="field"><span>${escapeHtml(t("文字"))}</span><input data-option-item-path="Style Override.Text Color" type="color" value="${safeColor(itemOverride["Text Color"], style["Text Color"]).slice(0, 7)}"></label>
              </div>
              ${rangeField(t("字體大小"), "Style Override.Text Size", itemOverride["Text Size"] ?? style["Text Size"] ?? 30, { min: 8, max: 160, suffix: " px", itemField: true })}
              <label class="field"><span>${escapeHtml(t("文字對齊"))}</span><select data-option-item-path="Style Override.Text Align">${optionTags([0, 0.5, 1], itemOverride["Text Align"] ?? style["Text Align"] ?? 0.5, (value) => ({ 0: t("靠左"), 0.5: t("置中"), 1: t("靠右") })[value])}</select></label>
            ` : ""}
          </div>
        ` : ""}
      `);
    }
  } else if (element.Type === "PICTURE") {
    const picture = element.Picture || {};
    if (!isCanvas) {
      primary = `
        <div class="form-grid two-columns option-field-grid">
          <label class="field"><span>Name</span><input data-option-path="Name" value="${escapeHtml(element.Name || "")}"></label>
          <label class="field"><span>Availability</span><select data-option-path="Availability">${optionTags(["ALWAYS", "CONTROLLED"], element.Availability || "ALWAYS", (value) => value === "ALWAYS" ? "Always" : "Controlled")}</select></label>
          <label class="field option-wide-field"><span>Trigger</span><input data-option-path="Trigger" value="${escapeHtml(actionTriggerName(element.Trigger))}"></label>
        </div>
      `;
      sections += `
        <div class="form-section option-picture-source-section">
          <div class="form-grid two-columns option-field-grid">
            <label class="field"><span>${escapeHtml(t("Idle 圖片"))}</span><select data-option-path="Picture.Idle" aria-label="${escapeHtml(t("Idle 圖片"))}">${imageOptionTags(picture.Idle || "", [{ id: "", name: "None" }])}</select></label>
            ${optionBooleanField(t("只讓不透明部分可點擊"), 'data-option-path="Picture.Alpha Hit Test"', Boolean(picture["Alpha Hit Test"]))}
          </div>
        </div>
      `;
      sections += optionSoundSection(element);
    } else {
      primary = positionFields;
      sections += optionCollapsibleSection("版面細節", "", `
        ${zOrderField}
        <label class="field"><span>${escapeHtml(t("填充方式"))}</span><select data-option-path="Picture.Fit">${optionTags(["CONTAIN", "COVER", "STRETCH"], picture.Fit || "CONTAIN")}</select></label>
        ${optionBooleanField(t("保持長寬比"), 'data-option-path="Picture.Keep Aspect"', picture["Keep Aspect"] !== false)}
      `);
      sections += optionCollapsibleSection("外觀", "", `
        <div class="option-section-group">
          ${optionHoverFields(element, { picture: true })}
        </div>
        <div class="option-section-group">
          <h4>${escapeHtml(t("顯示效果"))}</h4>
          ${rangeField(t("不透明度"), "Picture.Opacity", picture.Opacity ?? 1, { min: 0, max: 1, step: 0.01, format: "percent" })}
          <label class="field"><span>Tint</span><input data-option-path="Picture.Tint" type="color" value="${safeColor(picture.Tint, "#ffffff").slice(0, 7)}"></label>
        </div>
      `);
    }
  } else {
    const hitbox = element.Hitbox || {};
    if (!isCanvas) {
      primary = `
        <div class="form-grid two-columns option-field-grid">
          <label class="field"><span>Name</span><input data-option-path="Name" value="${escapeHtml(element.Name || "")}"></label>
          <label class="field"><span>Availability</span><select data-option-path="Availability">${optionTags(["ALWAYS", "CONTROLLED"], element.Availability || "ALWAYS", (value) => value === "ALWAYS" ? "Always" : "Controlled")}</select></label>
          <label class="field option-wide-field"><span>Trigger</span><input data-option-path="Trigger" value="${escapeHtml(actionTriggerName(element.Trigger))}"></label>
        </div>
      `;
      sections += optionSoundSection(element);
    } else {
      primary = positionFields;
      sections += optionCollapsibleSection("版面細節", "", zOrderField);
      sections += optionCollapsibleSection("外觀", "", `
        <div class="option-section-group">
          ${optionHoverFields(element)}
        </div>
        <div class="option-section-group">
          <label class="field"><span>${escapeHtml(t("顏色"))}</span><input data-option-path="Hitbox.Editor Color" type="color" value="${safeColor(hitbox["Editor Color"], "#28a47d").slice(0, 7)}"></label>
          ${rangeField(t("不透明度"), "Hitbox.Editor Opacity", hitbox["Editor Opacity"] ?? 0.24, { min: 0, max: 1, step: 0.01, format: "percent" })}
        </div>
      `);
    }
  }

  return `
    <div class="editor-page option-editor-page option-editor-${isCanvas ? "canvas" : "form"}">
      <div class="form-section option-primary-section">${primary}</div>
      ${sections}
      ${isCanvas ? "" : `<div class="editor-danger-zone"><button class="danger-button" id="deleteOptionElement" type="button">${escapeHtml(t("刪除"))}</button></div>`}
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
    workspaceMode: builder.dataset.workspaceMode || "form",
    inspectorScrollTop: inspector?.scrollTop || 0,
    elementListScrollTop: elementList?.scrollTop || 0,
    canvasScrollTop: canvas?.scrollTop || 0,
    canvasScrollLeft: canvas?.scrollLeft || 0,
    sectionStates: Object.fromEntries([...builder.querySelectorAll("details.option-collapsible-section")].map((section) => [section.dataset.optionSection, section.open])),
  };
}

function restoreOptionsPanelView(view) {
  if (!view || view.nodePath !== state.selectedNodePath || view.workspaceMode !== state.optionWorkspaceMode) return;
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
    [...(builder?.querySelectorAll("details.option-collapsible-section") || [])].forEach((section) => {
      const open = view.sectionStates?.[section.dataset.optionSection];
      if (open !== undefined) section.open = open;
    });
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
  const isFormMode = state.optionWorkspaceMode === "form";
  const elementSidebar = `
    <aside class="option-element-sidebar">
      <div class="option-add-buttons" aria-label="${escapeHtml(t("新增選項"))}">
        <button class="quiet-button compact add-button" type="button" data-add-option-element="TEXTBOX">Text Box</button>
        <button class="quiet-button compact add-button" type="button" data-add-option-element="PICTURE">Picture</button>
        <button class="quiet-button compact add-button" type="button" data-add-option-element="HITBOX">Hitbox</button>
      </div>
      <div class="subnav-list">${optionElementListHtml()}</div>
    </aside>
  `;
  const divider = `
    <button class="option-workspace-divider" type="button" role="separator" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${isFormMode ? 0 : 100}" aria-label="${escapeHtml(t("拖曳切換表單與畫布"))}" title="${escapeHtml(t("拖曳切換表單與畫布；也可按 Enter 或方向鍵"))}">
      <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
    </button>
  `;
  const canvasColumn = `
    <section class="option-canvas-column">
      <div class="option-builder-toolbar">
        <div class="option-view-controls" aria-label="${escapeHtml(t("畫布設定"))}">
          <button class="toggle-button ${state.optionGridVisible ? "active" : ""}" id="toggleOptionGrid" type="button" title="${escapeHtml(t("顯示或隱藏格線（{shortcut}）", { shortcut: shortcutDisplay(state.editorSettings.shortcuts.grid) }))}">${escapeHtml(t("格線"))}</button>
          <button class="toggle-button ${state.optionSnapEnabled ? "active" : ""}" id="toggleOptionSnap" type="button" title="${escapeHtml(t("開啟或關閉吸附（{shortcut}）", { shortcut: shortcutDisplay(state.editorSettings.shortcuts.snap) }))}">${escapeHtml(t("吸附"))}</button>
        </div>
        <label class="field inline-field canvas-path-field"><select data-canvas-path="Preview Background" aria-label="${escapeHtml(t("預覽底圖"))}">${canvasBackgroundOptionTags(canvas["Preview Background"] || "")}</select></label>
        <span class="canvas-size-label">${escapeHtml(canvas.Width || 1920)} × ${escapeHtml(canvas.Height || 1080)}</span>
      </div>
      <div class="option-canvas-scroll">${optionStageHtml()}</div>
    </section>
  `;
  dom.optionsPanel.innerHTML = `
    <div class="options-workspace">
      <div class="option-builder option-${escapeHtml(state.optionWorkspaceMode)}-mode" data-workspace-mode="${escapeHtml(state.optionWorkspaceMode)}" data-node-path="${escapeHtml(state.selectedNodePath || "")}" data-element-id="${escapeHtml(state.selectedOptionElementId || "")}">
        ${isFormMode ? `${elementSidebar}${divider}<section class="option-inspector option-form-column">${optionInspectorHtml()}</section>` : `${canvasColumn}${divider}<aside class="option-inspector option-visual-inspector">${optionInspectorHtml()}</aside>`}
      </div>
    </div>
  `;
  bindOptionsPanel();
  restoreOptionsPanelView(view);
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

function updateOptionStageScale(force = false) {
  if (!force && state.optionWorkspaceTransitioning) return;
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

function cloneOptionTransitionPanel(source) {
  const clone = source.cloneNode(true);
  const sourceNodes = [source, ...source.querySelectorAll("*")];
  const cloneNodes = [clone, ...clone.querySelectorAll("*")];
  sourceNodes.forEach((node, index) => {
    if (node.scrollTop) cloneNodes[index].scrollTop = node.scrollTop;
    if (node.scrollLeft) cloneNodes[index].scrollLeft = node.scrollLeft;
  });
  clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  clone.querySelectorAll("button, input, select, textarea").forEach((node) => node.setAttribute("tabindex", "-1"));
  return clone;
}

function beginOptionWorkspaceTransition(mode, builder = dom.optionsPanel.querySelector(".option-builder")) {
  if (!['form', 'canvas'].includes(mode) || state.optionWorkspaceMode === mode || state.optionWorkspaceTransitioning || !builder) return null;
  const currentMode = state.optionWorkspaceMode;
  const oldSources = [builder.children[0], builder.children[2]];
  if (oldSources.some((panel) => !panel)) return null;
  const oldRects = oldSources.map((panel) => panel.getBoundingClientRect());
  const oldClones = oldSources.map(cloneOptionTransitionPanel);

  state.optionWorkspaceTransitioning = true;
  state.optionWorkspaceMode = mode;
  renderOptionsPanel();
  const nextBuilder = dom.optionsPanel.querySelector(".option-builder");
  const workspace = nextBuilder?.closest(".options-workspace");
  const nextSources = nextBuilder ? [nextBuilder.children[0], nextBuilder.children[2]] : [];
  if (!nextBuilder || !workspace || nextSources.some((panel) => !panel)) {
    state.optionWorkspaceMode = currentMode;
    state.optionWorkspaceTransitioning = false;
    renderOptionsPanel();
    return null;
  }
  updateOptionStageScale(true);
  const nextRects = nextSources.map((panel) => panel.getBoundingClientRect());
  const nextClones = nextSources.map(cloneOptionTransitionPanel);
  const workspaceRect = workspace.getBoundingClientRect();
  nextBuilder.classList.add("option-transition-base");

  const overlay = document.createElement("div");
  overlay.className = "option-transition-overlay";
  overlay.setAttribute("aria-hidden", "true");
  const masks = oldRects.map((_rect, index) => {
    const mask = document.createElement("div");
    mask.className = "option-transition-mask";
    const oldLayer = document.createElement("div");
    oldLayer.className = `option-transition-layer option-${currentMode}-mode`;
    const nextLayer = document.createElement("div");
    nextLayer.className = `option-transition-layer option-${mode}-mode`;
    oldLayer.append(oldClones[index]);
    nextLayer.append(nextClones[index]);
    mask.append(oldLayer, nextLayer);
    overlay.append(mask);
    return { mask, oldLayer, nextLayer, oldPanel: oldClones[index], nextPanel: nextClones[index] };
  });
  const handle = document.createElement("div");
  handle.className = "option-transition-handle";
  handle.innerHTML = '<span></span><span></span><span></span>';
  overlay.append(handle);
  workspace.append(overlay);

  let progress = 0;
  let finished = false;
  let animationFrame = 0;
  const relativeRect = (rect) => ({
    left: rect.left - workspaceRect.left,
    top: rect.top - workspaceRect.top,
    width: rect.width,
    height: rect.height,
  });
  const oldRelative = oldRects.map(relativeRect);
  const nextRelative = nextRects.map(relativeRect);
  const interpolate = (start, end, value) => start + (end - start) * value;

  const setProgress = (value) => {
    progress = Math.max(0, Math.min(1, value));
    let dividerPosition = 0;
    masks.forEach((entry, index) => {
      const oldRect = oldRelative[index];
      const nextRect = nextRelative[index];
      const current = {
        left: interpolate(oldRect.left, nextRect.left, progress),
        top: interpolate(oldRect.top, nextRect.top, progress),
        width: interpolate(oldRect.width, nextRect.width, progress),
        height: interpolate(oldRect.height, nextRect.height, progress),
      };
      Object.assign(entry.mask.style, {
        left: `${current.left}px`,
        top: `${current.top}px`,
        width: `${current.width}px`,
        height: `${current.height}px`,
      });
      Object.assign(entry.oldPanel.style, {
        left: `${oldRect.left - current.left}px`,
        top: `${oldRect.top - current.top}px`,
        width: `${oldRect.width}px`,
        height: `${oldRect.height}px`,
      });
      Object.assign(entry.nextPanel.style, {
        left: `${nextRect.left - current.left}px`,
        top: `${nextRect.top - current.top}px`,
        width: `${nextRect.width}px`,
        height: `${nextRect.height}px`,
      });
      entry.oldLayer.style.opacity = String(1 - progress);
      entry.nextLayer.style.opacity = String(progress);
      if (index === 0) dividerPosition = current.left + current.width;
    });
    Object.assign(handle.style, {
      left: `${dividerPosition}px`,
      top: "0px",
      height: `${workspaceRect.height}px`,
    });
  };

  const animateTo = (target, maximumDuration = 380) => new Promise((resolve) => {
    window.cancelAnimationFrame(animationFrame);
    const start = progress;
    const distance = Math.abs(target - start);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reducedMotion ? 1 : Math.max(80, maximumDuration * distance);
    const startedAt = performance.now();
    const tick = (now) => {
      const elapsed = Math.min(1, (now - startedAt) / duration);
      const eased = elapsed < 0.5
        ? 4 * Math.pow(elapsed, 3)
        : 1 - Math.pow(-2 * elapsed + 2, 3) / 2;
      setProgress(interpolate(start, target, eased));
      if (elapsed < 1 && overlay.isConnected) {
        animationFrame = window.requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    animationFrame = window.requestAnimationFrame(tick);
  });

  const finish = (commit) => {
    if (finished) return;
    finished = true;
    window.cancelAnimationFrame(animationFrame);
    if (commit) {
      nextBuilder.classList.add("option-transition-handoff");
      nextBuilder.classList.remove("option-transition-base");
      overlay.remove();
      window.requestAnimationFrame(() => {
        if (nextBuilder.isConnected) nextBuilder.classList.remove("option-transition-handoff");
      });
    } else {
      overlay.remove();
      state.optionWorkspaceMode = currentMode;
      renderOptionsPanel();
    }
    state.optionWorkspaceTransitioning = false;
    updateOptionStageScale();
  };

  setProgress(0);
  return {
    currentMode,
    targetMode: mode,
    startDivider: oldRelative[0].left + oldRelative[0].width,
    targetDivider: nextRelative[0].left + nextRelative[0].width,
    get progress() { return progress; },
    setProgress,
    animateTo,
    finish,
  };
}

function setOptionWorkspaceMode(mode) {
  const transition = beginOptionWorkspaceTransition(mode);
  if (!transition) return;
  transition.animateTo(1).then(() => transition.finish(true));
}

function bindOptionWorkspaceDivider() {
  const divider = document.querySelector(".option-workspace-divider");
  if (!divider) return;

  const switchMode = (mode) => {
    if (mode === state.optionWorkspaceMode) return;
    setOptionWorkspaceMode(mode);
  };

  divider.addEventListener("click", () => {
    switchMode(state.optionWorkspaceMode === "form" ? "canvas" : "form");
  });

  divider.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft" || event.key === "Home") switchMode("form");
    else if (event.key === "ArrowRight" || event.key === "End") switchMode("canvas");
    else switchMode(state.optionWorkspaceMode === "form" ? "canvas" : "form");
  });

  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || window.matchMedia("(max-width: 760px)").matches) return;
    event.preventDefault();
    const builder = divider.closest(".option-builder");
    if (!builder) return;
    const targetMode = state.optionWorkspaceMode === "form" ? "canvas" : "form";
    const transition = beginOptionWorkspaceTransition(targetMode, builder);
    if (!transition) return;

    const startX = event.clientX;
    const travel = transition.targetDivider - transition.startDivider;
    let moved = false;
    let settled = false;
    let dragFrame = 0;
    let latestX = startX;

    document.body.classList.add("option-workspace-dragging");

    const updateLatestX = (pointerEvent) => {
      const coalescedEvents = pointerEvent.getCoalescedEvents?.() || [];
      const latestEvent = coalescedEvents[coalescedEvents.length - 1] || pointerEvent;
      latestX = latestEvent.clientX;
    };

    const renderDragFrame = () => {
      dragFrame = 0;
      const distance = latestX - startX;
      moved = moved || Math.abs(distance) > 4;
      transition.setProgress(travel ? distance / travel : 0);
    };

    const onMove = (moveEvent) => {
      updateLatestX(moveEvent);
      if (!dragFrame) dragFrame = window.requestAnimationFrame(renderDragFrame);
    };

    const removeListeners = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.cancelAnimationFrame(dragFrame);
      document.body.classList.remove("option-workspace-dragging");
    };

    const settle = (commit) => {
      if (settled) return;
      settled = true;
      removeListeners();
      transition.animateTo(commit ? 1 : 0, 220).then(() => transition.finish(commit));
    };

    const onUp = (upEvent) => {
      updateLatestX(upEvent);
      window.cancelAnimationFrame(dragFrame);
      renderDragFrame();
      settle(moved ? transition.progress >= 0.5 : true);
    };

    const onCancel = () => settle(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  });
}

function addOptionElement(type) {
  const element = defaultOptionElement(type);
  state.optionsDraft.Elements.push(element);
  state.selectedOptionElementId = element.ID;
  state.selectedOptionItemId = element.Items?.[0]?.ID || null;
  state.optionWorkspaceMode = "form";
  markOptionsDirty();
  renderOptionsPanel();
}

async function deleteOptionElement() {
  const element = selectedOptionElement();
  if (!element || !await flushAutosave()) return;
  try {
    const data = await api(`/api/options/references?node=${encodeURIComponent(state.selectedNodePath)}&element=${encodeURIComponent(element.ID)}`);
    if (data.references?.length) {
      toast(t("無法刪除「{name}」：仍被 {count} 個 Event Effect 引用。", { name: element.Name, count: data.references.length }), "error");
      return;
    }
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  if (!window.confirm(t("確定刪除「{name}」？", { name: element.Name }))) return;
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

async function deleteOptionItem(itemId = state.selectedOptionItemId) {
  const element = selectedOptionElement();
  const item = element?.Items?.find((entry) => entry.ID === itemId);
  if (!element || !item || !await flushAutosave()) return;
  try {
    const data = await api(`/api/options/references?node=${encodeURIComponent(state.selectedNodePath)}&element=${encodeURIComponent(element.ID)}&item=${encodeURIComponent(item.ID)}`);
    if (data.references?.length) {
      toast(t("無法刪除「{name}」：仍被 {count} 個 Event Effect 引用。", { name: item.Name, count: data.references.length }), "error");
      return;
    }
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  if (!window.confirm(t("確定刪除「{name}」？", { name: item.Name }))) return;
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
  if (path === "Hover.Enabled" || path === "Availability") {
    renderOptionsPanel();
    return;
  }
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

function bindOptionsPanel() {
  document.querySelector("#saveOptionsButton")?.addEventListener("click", saveOptions);
  bindOptionWorkspaceDivider();
  document.querySelector("#toggleOptionGrid")?.addEventListener("click", toggleOptionGrid);
  document.querySelector("#toggleOptionSnap")?.addEventListener("click", toggleOptionSnap);
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
      "Text Color": style["Text Color"] || "#ffffff",
      "Text Size": style["Text Size"] ?? 30,
      "Text Align": style["Text Align"] ?? 0.5,
    } : {};
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
  dom.optionsPanel.querySelector("[data-canvas-path]")?.addEventListener("input", (event) => {
    state.optionsDraft.Canvas[event.target.dataset.canvasPath] = event.target.value;
    markOptionsDirty();
    refreshOptionStage();
  });
  bindOptionStageInteractions();
  requestAnimationFrame(() => updateOptionStageScale());
  if (state.optionResizeObserver) state.optionResizeObserver.disconnect();
  state.optionResizeObserver = new ResizeObserver(() => updateOptionStageScale());
  const canvas = document.querySelector(".option-canvas-scroll");
  if (canvas) state.optionResizeObserver.observe(canvas);
}

function bindOptionStageInteractions() {
  document.querySelectorAll("#optionStage [data-option-item-select]").forEach((button) => button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    state.selectedOptionElementId = button.closest("[data-option-stage-element]")?.dataset.optionStageElement || state.selectedOptionElementId;
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
  if (!direction) {
    if (!node.classList.contains("selected")) renderOptionsPanel();
    return;
  }
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
  return {
    node: state.selectedNodePath,
    options: clone(state.optionsDraft),
  };
}

async function persistOptionsSnapshot(snapshot, task = null) {
  const saved = await api("/api/options", { method: "PUT", body: snapshot });
  if (task && !isCurrentAutosaveTask(task)) return saved;
  if (saved.optionTargets) state.optionTargets = saved.optionTargets;
  if (state.selectedNodePath !== snapshot.node || !state.nodeDetail) return saved;
  state.nodeDetail.options = clone(saved.options || snapshot.options);
  if (saved.node) state.nodeDetail.node = saved.node;
  return saved;
}

function scheduleOptionsAutosave() {
  if (!state.nodeDetail || !state.optionsDraft) return;
  const snapshot = optionsSnapshot();
  scheduleAutosave(t("選項設定未能儲存"), (task) => persistOptionsSnapshot(snapshot, task));
}

async function saveOptions() {
  const snapshot = optionsSnapshot();
  await cancelAutosaveAndWait();
  setSaveState(t("儲存中..."), "saving");
  try {
    const saved = await persistOptionsSnapshot(snapshot);
    state.optionsDraft = clone(saved.options);
    state.nodeDetail.options = clone(saved.options);
    if (saved.node) state.nodeDetail.node = saved.node;
    setSaveState(t("已同步"));
    toast(t("Options.json 已儲存"));
    renderOptionsPanel();
  } catch (error) {
    setSaveState(t("儲存失敗"), "error");
    toast(error.message, "error");
  }
}

function fileListHtml(files, selected, dataName) {
  if (!files.length) return `<div class="node-list-empty">${t("尚未建立文件")}</div>`;
  return files.map((file) => {
    const symbols = file.labels || [];
    return `
      <button class="subnav-item ${file.name === selected ? "active" : ""}" type="button" data-${dataName}="${escapeHtml(file.name)}">
        <span class="subnav-item-copy">
          <strong>${escapeHtml(file.displayName || file.name)}</strong>
          <span>${symbols.length ? t("{count} 個 label", { count: symbols.length }) : t("尚未偵測到 label")}</span>
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
        <div class="subnav-header"><strong>CONTENT</strong><div class="subnav-header-actions"><button class="icon-button add-button" id="newContentButton" type="button" title="${t("新增 Content")}" aria-label="${t("新增 Content")}">＋</button></div></div>
        <div class="subnav-list">${fileListHtml(files, state.selectedContent, "content-file")}</div>
      </aside>
      <div class="editor-scroll">
        ${state.selectedContent ? `
          <div class="code-toolbar">
            <label class="field" style="width:min(320px,60%)"><span class="visually-hidden">${t("Content 名稱")}</span><input id="contentDisplayName" value="${escapeHtml(state.selectedContentDisplayName || state.selectedContent)}"></label>
            <button class="danger-button compact content-delete-button" id="deleteContentButton" type="button">${t("刪除演出")}</button>
          </div>
          <div class="code-editor-wrap"><textarea class="code-editor" id="contentEditor" spellcheck="false">${escapeHtml(state.contentSource)}</textarea></div>
        ` : `<div class="editor-empty"><div><p>${t("選擇或新增 Content 文件。")}</p><button class="primary-button add-button" id="emptyNewContentButton" type="button">${t("新增 Content")}</button></div></div>`}
      </div>
    </div>
  `;
  document.querySelectorAll("[data-content-file]").forEach((button) => button.addEventListener("click", () => loadContent(button.dataset.contentFile)));
  document.querySelector("#newContentButton")?.addEventListener("click", openNameDialog);
  document.querySelector("#emptyNewContentButton")?.addEventListener("click", openNameDialog);
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

async function persistContentSnapshot(snapshot, task = null) {
  const saved = await api("/api/content", { method: "POST", body: snapshot });
  if (task && !isCurrentAutosaveTask(task)) return saved;
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
  scheduleAutosave(t("Content 未能儲存"), (task) => persistContentSnapshot(snapshot, task));
}

async function saveContent() {
  const snapshot = contentSnapshot();
  await cancelAutosaveAndWait();
  setSaveState(t("儲存中..."), "saving");
  try {
    const saved = await persistContentSnapshot(snapshot);
    state.selectedContent = saved.name;
    state.selectedContentDisplayName = saved.displayName;
    await refreshAfterSave();
    await loadContent(saved.name);
    toast(t("Content 已儲存"));
  } catch (error) {
    setSaveState(t("儲存失敗"), "error");
    toast(error.message, "error");
  }
}

async function deleteContent() {
  if (!state.selectedContent || !window.confirm(t("確定刪除 Content「{name}」？", { name: `${state.selectedContent}.rpy` }))) return;
  const node = state.selectedNodePath;
  const name = state.selectedContent;
  await cancelAutosaveAndWait();
  setSaveState(t("刪除中..."), "saving");
  try {
    await api(`/api/content?node=${encodeURIComponent(node)}&name=${encodeURIComponent(name)}`, { method: "DELETE" });
    state.selectedContent = null;
    state.selectedContentDisplayName = "";
    state.contentSource = "";
    await refreshAfterSave();
    toast(t("Content 已刪除"));
  } catch (error) {
    setSaveState(t("刪除失敗"), "error");
    toast(error.message, "error");
  }
}

function statRowsHtml(entries, group) {
  return entries.map(([id, values]) => `
    <div class="stat-row stat-columns group-drag-item" role="row" data-stat-id="${escapeHtml(id)}" data-stat-order="${escapeHtml(values.Order ?? 0)}" data-group-item-id="${escapeHtml(id)}" data-group-item-group="${escapeHtml(group)}" aria-grabbed="false">
      <div class="stat-cell stat-name-cell" role="cell"><div class="stat-name-control"><input name="statName" aria-label="Stat Name" value="${escapeHtml(values.Name || id)}"></div></div>
      <div class="stat-cell" role="cell"><input name="statMin" aria-label="Min" type="number" step="any" value="${escapeHtml(values.Min)}"></div>
      <div class="stat-cell" role="cell"><input name="statInit" aria-label="Init" type="number" step="any" value="${escapeHtml(values.Init)}"></div>
      <div class="stat-cell" role="cell"><input name="statMax" aria-label="Max" type="number" step="any" value="${escapeHtml(values.Max)}"></div>
      <div class="stat-cell action-cell" role="cell"><button class="row-button" type="button" data-remove-stat="${escapeHtml(id)}" title="${t("移除 Stat")}" aria-label="${t("移除 Stat")}">×</button></div>
    </div>
  `).join("");
}

function statGroupsHtml() {
  const blocks = SceneStateEditor.statPoolBlocks(state.statsDraft);
  return `
    <div class="stat-column-header stat-columns" role="row">
      <span role="columnheader">Name</span><span role="columnheader">Min</span><span role="columnheader">Init</span><span role="columnheader">Max</span><span aria-hidden="true"></span>
    </div>
    <div class="stat-groups-body" id="statsGroups" role="rowgroup" data-group-drop="${SceneStateEditor.DEFAULT_GROUP}" data-stat-ungrouped-drop>
      ${blocks.map((block) => block.type === "item"
        ? statRowsHtml([[block.id, block.values]], SceneStateEditor.DEFAULT_GROUP)
        : `
          <section class="stat-group-card" data-stat-group="${escapeHtml(block.group)}" data-group-drop="${escapeHtml(block.group)}">
            <div class="stat-group-heading">
              <input class="stat-group-name" name="statGroupName" data-stat-group-name="${escapeHtml(block.group)}" aria-label="${t("群組名稱")}" maxlength="80" value="${escapeHtml(block.group)}">
              <div class="group-block-drag-space stat-group-drag-space" title="${escapeHtml(t("拖移群組"))}" aria-label="${escapeHtml(t("拖移群組"))}"></div>
            </div>
            <div class="stat-group-items">${statRowsHtml(block.entries, block.group)}</div>
          </section>
        `).join("")}
      <div class="group-loose-drop-tail stat-loose-drop-tail" aria-hidden="true"></div>
    </div>
  `;
}

function memoryRowsHtml() {
  const entries = Object.entries(state.memoriesDraft);
  return entries.map(([id, values], index) => {
    const isDefault = id === "memory";
    return `
      <tr class="memory-row" data-memory-index="${index}" data-memory-id="${escapeHtml(id)}">
        <td><input name="memoryName" aria-label="${t("記憶庫名稱")}" value="${escapeHtml(values.Name || id)}" ${isDefault ? "disabled" : ""}></td>
        <td class="action-cell">${isDefault ? `<span class="default-memory-badge">${t("預設")}</span>` : `<button class="row-button" type="button" data-remove-memory="${index}" title="${t("移除記憶庫")}" aria-label="${t("移除記憶庫")}">×</button>`}</td>
      </tr>
    `;
  }).join("");
}

function renderStatsPanel() {
  statGroupDragController?.destroy();
  statGroupDragController = null;
  dom.statsPanel.innerHTML = `
    <div class="panel-page wide state-definitions-page" id="stateDefinitionsPage">
      <section class="state-definition-section">
        <div class="state-section-heading">
          <div><h2>Stats</h2></div>
          <button class="state-add-button add-button" id="addStatButton" type="button" title="${t("新增 Stat")}" aria-label="${t("新增 Stat")}">＋</button>
        </div>
        <div class="stat-groups">${statGroupsHtml()}</div>
      </section>

      <section class="state-definition-section">
        <div class="state-section-heading">
          <div><h2>Memory</h2></div>
          <button class="state-add-button add-button" id="addMemoryButton" type="button" title="${t("新增記憶庫")}" aria-label="${t("新增記憶庫")}">＋</button>
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
  document.querySelector("#addStatButton")?.addEventListener("click", () => addStat());
  document.querySelector("#addMemoryButton")?.addEventListener("click", addMemory);
  document.querySelectorAll("[data-remove-stat]").forEach((button) => button.addEventListener("click", () => removeStat(button.dataset.removeStat)));
  document.querySelectorAll("[data-remove-memory]:not([disabled])").forEach((button) => button.addEventListener("click", () => removeMemory(Number(button.dataset.removeMemory))));
  document.querySelectorAll("[data-stat-group-name]").forEach((input) => {
    const source = input.dataset.statGroupName;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        input.value = source;
        input.blur();
      }
    });
    input.addEventListener("change", () => renameStatGroup(source, input.value));
  });
  statGroupDragController = SceneGroupDrag.createController({
    root: document.querySelector("#statsGroups"),
    itemSelector: ".stat-row[data-group-item-id]",
    groupSelector: ".stat-group-card[data-group-drop]",
    ungroupedSelector: "[data-stat-ungrouped-drop]",
    groupHandleSelector: ".stat-group-drag-space",
    listSelector: ".stat-group-items",
    onDrop: applyStatGroupDrop,
    onGroupDrop: applyStatGroupBlockDrop,
    onError: (error) => toast(error.message, "error"),
  });
  const page = document.querySelector("#stateDefinitionsPage");
  page?.addEventListener("input", (event) => {
    if (event.target.matches("[data-stat-group-name]")) return;
    scheduleStatsAutosave();
  });
  if (pendingStatGroupFocus) {
    const input = document.querySelector(`[data-stat-group-name="${CSS.escape(pendingStatGroupFocus)}"]`);
    pendingStatGroupFocus = null;
    input?.focus({ preventScroll: true });
    input?.select();
  }
}

function readStatsForm() {
  const result = {};
  document.querySelectorAll(".stat-row").forEach((row) => {
    const id = row.dataset.statId;
    if (!id) return;
    const groupCard = row.closest(".stat-group-card[data-group-drop]");
    const group = SceneStateEditor.normalizeGroup(
      groupCard?.querySelector('[name="statGroupName"]')?.value || groupCard?.dataset.groupDrop,
    );
    result[id] = {
      Name: row.querySelector('[name="statName"]').value.trim() || id,
      Group: group,
      Order: Math.max(0, Math.trunc(numberValue(row.dataset.statOrder, 0))),
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

function addStat(group = SceneStateEditor.DEFAULT_GROUP) {
  state.statsDraft = readStatsForm();
  state.memoriesDraft = readMemoriesForm();
  const id = generateId("stat");
  const nextOrder = Math.max(-1, ...Object.values(state.statsDraft).map((values) => numberValue(values.Order, -1))) + 1;
  state.statsDraft[id] = {
    Name: "新數值",
    Group: SceneStateEditor.normalizeGroup(group),
    Order: nextOrder,
    Min: 0,
    Init: 0,
    Max: 100,
  };
  renderStatsPanel();
  scheduleStatsAutosave();
  document.querySelector(`.stat-row[data-stat-id="${CSS.escape(id)}"] [name="statName"]`)?.select();
  return id;
}

async function commitStatsGrouping(nextStats, { focusGroup = null, message = t("Stat 群組已更新"), notify = true } = {}) {
  if (!await flushAutosave()) return false;
  const previousStats = clone(state.statsDraft);
  const memories = readMemoriesForm();
  state.statsDraft = clone(nextStats);
  state.memoriesDraft = clone(memories);
  pendingStatGroupFocus = focusGroup;
  renderStatsPanel();
  setSaveState(t("儲存中..."), "saving");
  try {
    const data = await api("/api/stats", { method: "PUT", body: { stats: nextStats } });
    state.stats = clone(data.stats);
    state.statsDraft = clone(data.stats);
    updateDatalists();
    setSaveState(t("已同步"));
    if (notify) toast(message);
    return true;
  } catch (error) {
    state.statsDraft = previousStats;
    state.memoriesDraft = clone(memories);
    pendingStatGroupFocus = null;
    renderStatsPanel();
    setSaveState(t("儲存失敗"), "error");
    toast(error.message, "error");
    return false;
  }
}

async function applyStatGroupDrop({ mode, sourceId, targetId, targetGroup, position }) {
  const stats = readStatsForm();
  const items = Object.entries(SceneStateEditor.withStatOrders(state.statsDraft))
    .map(([id, values]) => ({ id, group: values.Group }));
  const settings = { sourceId, targetId, targetGroup, position, defaultGroup: SceneStateEditor.DEFAULT_GROUP };
  const plan = mode === "group"
    ? SceneGroupDrag.planGroupDrop(items, { ...settings, newGroupName: t("新群組") })
    : SceneGroupDrag.planReorder(items, settings);
  if (!plan) return false;
  Object.entries(plan.assignments).forEach(([id, group]) => {
    if (stats[id]) stats[id].Group = group;
  });
  const orderedStats = {};
  plan.order.forEach((id, index) => {
    if (!stats[id]) return;
    stats[id].Order = index;
    orderedStats[id] = stats[id];
  });
  return commitStatsGrouping(orderedStats, {
    focusGroup: plan.createdGroup,
    notify: false,
  });
}

async function applyStatGroupBlockDrop({ sourceGroup, targetId, position }) {
  const stats = readStatsForm();
  const items = Object.entries(SceneStateEditor.withStatOrders(state.statsDraft))
    .map(([id, values]) => ({ id, group: values.Group }));
  const plan = SceneGroupDrag.planGroupBlockReorder(items, {
    sourceGroup,
    targetId,
    position,
    defaultGroup: SceneStateEditor.DEFAULT_GROUP,
  });
  if (!plan) return false;
  const orderedStats = {};
  plan.order.forEach((id, index) => {
    if (!stats[id]) return;
    stats[id].Order = index;
    orderedStats[id] = stats[id];
  });
  return commitStatsGrouping(orderedStats, { notify: false });
}

async function renameStatGroup(source, rawTarget) {
  const target = SceneStateEditor.normalizeGroup(rawTarget);
  if (!String(rawTarget || "").trim()) {
    renderStatsPanel();
    return false;
  }
  const stats = readStatsForm();
  Object.values(stats).forEach((values) => {
    if (SceneStateEditor.normalizeGroup(values.Group) === source || values.Group === target) values.Group = target;
  });
  return commitStatsGrouping(stats);
}

function removeStat(id) {
  state.statsDraft = readStatsForm();
  state.memoriesDraft = readMemoriesForm();
  delete state.statsDraft[id];
  SceneStateEditor.groupedStatEntries(state.statsDraft).forEach(({ group, entries }) => {
    if (group !== SceneStateEditor.DEFAULT_GROUP && entries.length === 1) {
      state.statsDraft[entries[0][0]].Group = SceneStateEditor.DEFAULT_GROUP;
    }
  });
  state.statsDraft = SceneStateEditor.withStatOrders(state.statsDraft);
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

async function persistStatsSnapshot(stats, memories, task = null) {
  const data = await api("/api/state", { method: "PUT", body: { stats, memories } });
  if (task && !isCurrentAutosaveTask(task)) return data;
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
  scheduleAutosave(t("狀態定義未能儲存"), (task) => persistStatsSnapshot(stats, memories, task));
}

async function saveStats() {
  const stats = readStatsForm();
  const memories = readMemoriesForm();
  await cancelAutosaveAndWait();
  setSaveState(t("儲存中..."), "saving");
  try {
    await persistStatsSnapshot(stats, memories);
    await refreshAfterSave();
    toast(t("狀態定義已儲存"));
  } catch (error) {
    setSaveState(t("儲存失敗"), "error");
    toast(error.message, "error");
  }
}

function graphViewBoxValue() {
  const view = state.graphViewBox;
  return view ? `${view.x} ${view.y} ${view.width} ${view.height}` : "0 0 760 480";
}

function applyGraphViewBox() {
  const svg = dom.graphPanel.querySelector("#projectGraphSvg");
  if (svg && state.graphViewBox) {
    svg.setAttribute("viewBox", graphViewBoxValue());
    updateGraphNameScale(svg);
  }
}

function updateGraphNameScale(svg = dom.graphPanel.querySelector("#projectGraphSvg")) {
  if (!svg || !state.graphViewBox) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const unitsPerPixel = Math.max(
    state.graphViewBox.width / rect.width,
    state.graphViewBox.height / rect.height,
  );
  const nameFadeProgress = Math.max(0, Math.min(1,
    (unitsPerPixel - GRAPH_NAME_FADE_START) / (GRAPH_NAME_FADE_END - GRAPH_NAME_FADE_START),
  ));
  const nameOpacity = 1 - nameFadeProgress;
  svg.style.setProperty("--graph-name-opacity", String(nameOpacity));
  svg.classList.toggle("graph-names-hidden", nameOpacity <= 0);
  svg.dataset.nodeNames = nameOpacity <= 0 ? "hidden" : nameOpacity < 1 ? "fading" : "visible";
  svg.querySelectorAll(".graph-node").forEach((node) => {
    const name = node.querySelector(".graph-node-name");
    const radius = Number(node.querySelector(".graph-node-dot")?.getAttribute("r"));
    if (!name || !Number.isFinite(radius)) return;
    name.setAttribute("y", String(radius * 2 + 17 * unitsPerPixel));
    name.style.fontSize = `${12 * unitsPerPixel}px`;
    name.style.strokeWidth = `${4 * unitsPerPixel}px`;
  });
}

function fittedGraphViewBox(layout, svg = null) {
  const bounds = SceneGraphModel.viewBounds(layout, 110);
  const rect = svg?.getBoundingClientRect();
  const viewportRatio = rect?.width && rect?.height ? rect.width / rect.height : 1.6;
  let width = Math.max(1200, bounds.width);
  let height = Math.max(720, bounds.height);
  if (width / height < viewportRatio) width = height * viewportRatio;
  else height = width / viewportRatio;
  return {
    x: bounds.x + bounds.width / 2 - width / 2,
    y: bounds.y + bounds.height / 2 - height / 2,
    width,
    height,
  };
}

function resetGraphView(layout) {
  const svg = dom.graphPanel.querySelector("#projectGraphSvg");
  if (!svg || !layout) return;
  state.graphViewBox = fittedGraphViewBox(layout, svg);
  applyGraphViewBox();
}

function updateGraphSearch() {
  const query = state.graphSearch.trim().toLocaleLowerCase();
  const matches = new Set();
  dom.graphPanel.querySelectorAll(".graph-node").forEach((node) => {
    const nodeMatches = !query || (node.dataset.searchText || "").includes(query);
    if (nodeMatches) matches.add(node.dataset.nodeId);
    node.classList.toggle("is-dimmed", !nodeMatches);
    node.classList.toggle("is-search-match", Boolean(query && nodeMatches));
  });
  dom.graphPanel.querySelectorAll(".graph-edge").forEach((edge) => {
    edge.classList.toggle("is-search-dimmed", Boolean(
      query && !matches.has(edge.dataset.source) && !matches.has(edge.dataset.target)
    ));
  });
}

function graphGeometryCache(relationships) {
  return {
    edges: relationships.map((relationship, index) => {
      const group = dom.graphPanel.querySelector(`.graph-edge[data-edge-index="${index}"]`);
      return {
        group,
        path: group?.querySelector("path"),
        endArrow: group?.querySelector(".graph-edge-arrow.is-end"),
        startArrow: group?.querySelector(".graph-edge-arrow.is-start"),
      };
    }),
    nodes: new Map([...dom.graphPanel.querySelectorAll(".graph-node[data-node-id]")]
      .map((node) => [node.dataset.nodeId, {
        group: node,
        content: node.querySelector(".graph-node-content"),
      }])),
    svg: dom.graphPanel.querySelector("#projectGraphSvg"),
  };
}

function updateGraphGeometry(
  layout,
  relationships,
  geometry = null,
  controller = null,
  updateDiagnostics = false,
) {
  const elements = geometry || graphGeometryCache(relationships);
  relationships.forEach((relationship, index) => {
    const source = layout.positions.get(relationship.source);
    const target = layout.positions.get(relationship.target);
    const edge = elements.edges[index];
    if (!source || !target || !edge?.group) return;
    edge.path?.setAttribute(
      "d",
      SceneGraphModel.edgePath(source, target, layout, index, relationship.endUp, relationship),
    );
    edge.endArrow?.setAttribute(
      "points",
      SceneGraphModel.edgeArrowPoints(source, target, layout, index, relationship.endUp, relationship),
    );
    edge.startArrow?.setAttribute(
      "points",
      SceneGraphModel.edgeArrowPoints(source, target, layout, index, relationship.endUp, relationship, "start"),
    );
  });
  elements.nodes.forEach((node, nodeId) => {
    const position = layout.positions.get(nodeId);
    if (!position) return;
    const particle = controller?.particles.get(nodeId);
    const baseX = particle?.x ?? position.x;
    const baseY = particle?.y ?? position.y;
    node.group.setAttribute("transform", `translate(${baseX} ${baseY})`);
    node.content?.setAttribute("transform", `translate(${position.x - baseX} ${position.y - baseY})`);
  });
  if (updateDiagnostics && elements.svg) {
    elements.svg.dataset.edgeCrossings = String(SceneGraphModel.countEdgeCrossings(relationships, layout));
  }
}

function bindGraphPanel(layout, relationships, controller, revealDurationMs = 0) {
  const svg = dom.graphPanel.querySelector("#projectGraphSvg");
  const canvas = dom.graphPanel.querySelector(".graph-canvas");
  const search = dom.graphPanel.querySelector("#graphSearch");
  const geometry = graphGeometryCache(relationships);
  dom.graphPanel.querySelector("#resetGraphView")?.addEventListener("click", () => resetGraphView(layout));
  search?.addEventListener("input", (event) => {
    state.graphSearch = event.target.value;
    updateGraphSearch();
  });
  const setGraphFocus = (nodeId = null) => {
    canvas?.classList.toggle("has-graph-focus", Boolean(nodeId));
    const relatedNodeIds = new Set(nodeId ? [nodeId] : []);
    dom.graphPanel.querySelectorAll(".graph-edge").forEach((edge) => {
      const related = Boolean(
        nodeId && (edge.dataset.source === nodeId || edge.dataset.target === nodeId)
      );
      edge.classList.toggle("is-focus-related", related);
      if (related) {
        relatedNodeIds.add(edge.dataset.source);
        relatedNodeIds.add(edge.dataset.target);
      }
    });
    dom.graphPanel.querySelectorAll(".graph-node").forEach((node) => {
      node.classList.toggle("is-focus-related", Boolean(nodeId && relatedNodeIds.has(node.dataset.nodeId)));
    });
  };
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  let layoutAnimationFrame = null;
  let revealTimer = null;
  let idleMotionEnabled = false;
  const refreshGraphNameScale = () => updateGraphNameScale(svg);
  window.addEventListener("resize", refreshGraphNameScale);
  const drawLayoutAnimation = (timeMs) => {
    layoutAnimationFrame = null;
    if (!svg?.isConnected) return;
    const changed = controller.frame(timeMs, idleMotionEnabled ? 1 : 0);
    if (changed) updateGraphGeometry(layout, relationships, geometry, controller);
    if (idleMotionEnabled || controller.isActive()) {
      layoutAnimationFrame = window.requestAnimationFrame(drawLayoutAnimation);
    }
  };
  const requestLayoutAnimationFrame = () => {
    if (reducedMotion || layoutAnimationFrame !== null) return;
    layoutAnimationFrame = window.requestAnimationFrame(drawLayoutAnimation);
  };
  state.graphStopLayoutAnimation?.();
  state.graphStopLayoutAnimation = () => {
    if (layoutAnimationFrame !== null) window.cancelAnimationFrame(layoutAnimationFrame);
    if (revealTimer !== null) window.clearTimeout(revealTimer);
    layoutAnimationFrame = null;
    revealTimer = null;
    window.removeEventListener("resize", refreshGraphNameScale);
  };

  const finishGraphReveal = () => {
    if (!canvas || !canvas.classList.contains("is-revealing")) return;
    canvas.classList.remove("is-revealing");
    if (revealTimer !== null) window.clearTimeout(revealTimer);
    revealTimer = null;
    if (!reducedMotion) {
      idleMotionEnabled = true;
      requestLayoutAnimationFrame();
    }
  };
  if (canvas?.classList.contains("is-revealing")) {
    if (reducedMotion) finishGraphReveal();
    else revealTimer = window.setTimeout(finishGraphReveal, revealDurationMs);
    canvas.addEventListener("pointerdown", finishGraphReveal, { capture: true, once: true });
    canvas.addEventListener("wheel", finishGraphReveal, { capture: true, once: true });
    canvas.addEventListener("keydown", finishGraphReveal, { capture: true, once: true });
  } else if (!reducedMotion) {
    idleMotionEnabled = true;
    requestLayoutAnimationFrame();
  }

  dom.graphPanel.querySelectorAll(".graph-node").forEach((node) => {
    const openNode = () => selectNode(node.dataset.nodePath, { preserveTab: true });
    let nodeDrag = null;
    let suppressClick = false;
    const graphPoint = (event) => {
      const rect = svg.getBoundingClientRect();
      const view = state.graphViewBox || { x: 0, y: 0, width: layout.width, height: layout.height };
      return {
        x: view.x + (event.clientX - rect.left) / rect.width * view.width,
        y: view.y + (event.clientY - rect.top) / rect.height * view.height,
      };
    };
    const finishNodeDrag = (event, cancelled = false) => {
      if (!nodeDrag || event.pointerId !== nodeDrag.pointerId) return;
      if (nodeDrag.moved) {
        const samples = nodeDrag.samples;
        const last = samples[samples.length - 1];
        const first = [...samples].reverse().find((sample) => last.time - sample.time >= 45) || samples[0];
        const seconds = Math.max(0.016, (last.time - first.time) / 1000);
        const velocityX = cancelled ? 0 : (last.x - first.x) / seconds;
        const velocityY = cancelled ? 0 : (last.y - first.y) / seconds;
        controller.release(node.dataset.nodeId, velocityX, velocityY);
        suppressClick = true;
        if (reducedMotion) {
          controller.tick(90);
          updateGraphGeometry(layout, relationships, geometry, controller);
        } else {
          requestLayoutAnimationFrame();
        }
      }
      node.classList.remove("is-dragging");
      node.setAttribute("aria-grabbed", "false");
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      nodeDrag = null;
    };
    node.addEventListener("pointerenter", () => setGraphFocus(node.dataset.nodeId));
    node.addEventListener("pointerleave", () => {
      if (document.activeElement !== node) setGraphFocus();
    });
    node.addEventListener("focus", () => setGraphFocus(node.dataset.nodeId));
    node.addEventListener("blur", () => setGraphFocus());
    node.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const position = layout.positions.get(node.dataset.nodeId);
      const point = graphPoint(event);
      nodeDrag = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        offsetX: point.x - position.x,
        offsetY: point.y - position.y,
        moved: false,
        samples: [{ x: point.x, y: point.y, time: event.timeStamp }],
      };
      node.setPointerCapture(event.pointerId);
    });
    node.addEventListener("pointermove", (event) => {
      if (!nodeDrag || event.pointerId !== nodeDrag.pointerId) return;
      const movement = Math.hypot(event.clientX - nodeDrag.startClientX, event.clientY - nodeDrag.startClientY);
      if (!nodeDrag.moved && movement < 6) return;
      if (!nodeDrag.moved) {
        nodeDrag.moved = true;
        node.classList.add("is-dragging");
        node.setAttribute("aria-grabbed", "true");
      }
      const point = graphPoint(event);
      controller.pin(node.dataset.nodeId, point.x - nodeDrag.offsetX, point.y - nodeDrag.offsetY);
      nodeDrag.samples.push({ x: point.x, y: point.y, time: event.timeStamp });
      nodeDrag.samples = nodeDrag.samples.filter((sample) => event.timeStamp - sample.time <= 120);
      updateGraphGeometry(layout, relationships, geometry, controller);
      requestLayoutAnimationFrame();
    });
    node.addEventListener("pointerup", (event) => finishNodeDrag(event));
    node.addEventListener("pointercancel", (event) => finishNodeDrag(event, true));
    node.addEventListener("click", (event) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      openNode();
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openNode();
    });
  });
  if (!svg || !canvas) return;
  let pendingWheelDelta = 0;
  let pendingWheelPoint = null;
  let wheelFrame = null;
  const applyWheelZoom = () => {
    wheelFrame = null;
    const point = pendingWheelPoint;
    const rawDelta = Math.max(-55, Math.min(55, pendingWheelDelta));
    pendingWheelDelta = 0;
    pendingWheelPoint = null;
    if (!point || Math.abs(rawDelta) < 0.01) return;

    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const view = state.graphViewBox || { x: 0, y: 0, width: 760, height: 480 };
    const pointerX = view.x + (point.x - rect.left) / rect.width * view.width;
    const pointerY = view.y + (point.y - rect.top) / rect.height * view.height;
    // MacBook 觸控板通常送出大量小數或 1px 左右的 WheelEvent。
    // 為最小位移保留可見的縮放量，再限制單一畫面更新的最大幅度。
    const visibleDelta = Math.sign(rawDelta) * Math.max(1.5, Math.abs(rawDelta));
    const requestedFactor = Math.exp(visibleDelta * 0.008);
    const width = Math.max(120, Math.min(250000, view.width * requestedFactor));
    const factor = width / view.width;
    const height = view.height * factor;
    const ratioX = (pointerX - view.x) / view.width;
    const ratioY = (pointerY - view.y) / view.height;
    state.graphViewBox = {
      x: pointerX - ratioX * width,
      y: pointerY - ratioY * height,
      width,
      height,
    };
    applyGraphViewBox();
  };
  canvas.addEventListener("wheel", (event) => {
    if (event.target.closest(".graph-search, .graph-reset-button")) return;
    event.preventDefault();
    if (!event.deltaY) return;
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? svg.getBoundingClientRect().height
        : 1;
    pendingWheelDelta += event.deltaY * deltaScale;
    pendingWheelPoint = { x: event.clientX, y: event.clientY };
    if (wheelFrame === null) wheelFrame = window.requestAnimationFrame(applyWheelZoom);
  }, { passive: false });

  let drag = null;
  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".graph-node")) return;
    event.preventDefault();
    drag = { x: event.clientX, y: event.clientY, view: { ...state.graphViewBox } };
    svg.classList.add("is-panning");
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const rect = svg.getBoundingClientRect();
    state.graphViewBox = {
      ...drag.view,
      x: drag.view.x - (event.clientX - drag.x) / rect.width * drag.view.width,
      y: drag.view.y - (event.clientY - drag.y) / rect.height * drag.view.height,
    };
    applyGraphViewBox();
  });
  const stopPanning = (event) => {
    if (!drag) return;
    drag = null;
    svg.classList.remove("is-panning");
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };
  svg.addEventListener("pointerup", stopPanning);
  svg.addEventListener("pointercancel", stopPanning);
  updateGraphSearch();
  updateGraphNameScale(svg);
}

function renderGraphPanel() {
  state.graphStopLayoutAnimation?.();
  state.graphStopLayoutAnimation = null;
  // GLOBAL is an authoring scope rather than a place in the game's node
  // structure, so neither it nor its contextual Event edges belong in this map.
  const nodes = (state.nodes || []).filter((node) => (
    node && !node.isGlobal && String(node.id) !== "__global__"
  ));
  const relationships = SceneGraphModel.relationships(nodes, state.graph?.edges || []);
  const signature = JSON.stringify({
    algorithm: "structured-depth-v3",
    nodes: nodes.map((node) => [node.id, node.path, node.name]),
    edges: relationships.map((edge) => [
      edge.source,
      edge.target,
      edge.endUp,
      edge.scope,
      edge.events.length,
      Boolean(edge.bidirectional),
      Boolean(edge.cycle),
    ]),
  });
  const layout = SceneGraphModel.layout(nodes, relationships, state.rootNodeId);
  const controller = SceneGraphModel.createLayoutController(nodes, relationships, layout);
  if (signature !== state.graphLayoutSignature) {
    state.graphLayoutSignature = signature;
    state.graphViewBox = fittedGraphViewBox(layout);
  }
  if (!nodes.length) {
    dom.graphPanel.innerHTML = '<div class="panel-page wide"><div class="success-state">' + t("建立 Scene Node 後，關聯圖會顯示 GOTO／REPLACE 關係。") + '</div></div>';
    return;
  }
  const nodeNames = new Map(nodes.map((node) => [String(node.id), String(node.name || node.id)]));
  const revealStepMs = 110;
  const revealSteps = layout.revealSteps || new Map();
  const revealStepFor = (nodeId) => revealSteps.get(String(nodeId)) || 0;
  const maximumRevealStep = Math.max(0, ...nodes.map((node) => revealStepFor(node.id)));
  const revealDurationMs = maximumRevealStep * revealStepMs + 440;
  const edgesHtml = relationships.map((relationship, index) => {
    const source = layout.positions.get(relationship.source);
    const target = layout.positions.get(relationship.target);
    if (!source || !target) return "";
    const route = layout.routes.get(SceneGraphModel.relationshipKey(relationship)) || { kind: "cross" };
    const descriptions = relationship.events.map((event) => {
      if (relationship.endUp === "MANAGEMENT") {
        const path = (event.replacePath || [event.replacedNode, relationship.target])
          .map((nodeId) => nodeNames.get(String(nodeId)) || nodeId)
          .join(" → ");
        return `${path} · ${event.eventName} · ${eventTriggerDisplayName(event.trigger)} · ${t("REPLACE 管理關係")}`;
      }
      const direction = relationship.bidirectional && event.directionSource
        ? `${nodeNames.get(String(event.directionSource)) || event.directionSource} → ${nodeNames.get(String(event.directionTarget)) || event.directionTarget} · `
        : "";
      const cycle = relationship.cycle ? " · GOTO Cycle" : "";
      return `${direction}${event.eventName} · ${eventTriggerDisplayName(event.trigger)} · ${relationship.scope === "global" ? "GLOBAL CONTEXT · " : ""}${relationship.endUp}${event.weight === 1 ? "" : ` · Weight ${event.weight}`}${cycle}`;
    });
    const selected = relationship.source === String(state.nodeDetail?.node?.ID || "") || relationship.target === String(state.nodeDetail?.node?.ID || "");
    const secondary = ["cross", "context", "management"].includes(route.kind);
    const endArrow = SceneGraphModel.edgeArrowPoints(
      source, target, layout, index, relationship.endUp, relationship,
    );
    const startArrow = relationship.bidirectional
      ? SceneGraphModel.edgeArrowPoints(
          source, target, layout, index, relationship.endUp, relationship, "start",
        )
      : "";
    const revealDelay = Math.min(
      revealStepFor(relationship.source),
      revealStepFor(relationship.target),
    ) * revealStepMs + 70;
    return `
      <g class="graph-edge is-${relationship.endUp.toLocaleLowerCase()} is-${route.kind} ${secondary ? "is-secondary" : ""} ${relationship.bidirectional ? "is-bidirectional" : ""} ${relationship.cycle ? "is-cycle" : ""} ${relationship.scope === "global" ? "is-global" : ""} ${selected ? "is-related" : ""}" style="--graph-reveal-delay: ${revealDelay}ms" data-edge-index="${index}" data-end-up="${relationship.endUp}" data-scope="${relationship.scope}" data-source="${escapeHtml(relationship.source)}" data-target="${escapeHtml(relationship.target)}">
        <path d="${SceneGraphModel.edgePath(source, target, layout, index, relationship.endUp, relationship)}"><title>${escapeHtml(descriptions.join("\n"))}</title></path>
        ${startArrow ? `<polygon class="graph-edge-arrow is-start" points="${startArrow}"></polygon>` : ""}
        <polygon class="graph-edge-arrow is-end" points="${endArrow}"></polygon>
      </g>
    `;
  }).join("");
  const nodesHtml = nodes.map((node) => {
    const position = layout.positions.get(String(node.id));
    const selected = node.path === state.selectedNodePath;
    const global = Boolean(node.isGlobal);
    const root = String(node.id) === String(state.rootNodeId || "");
    const name = String(node.name || node.id);
    const shortName = name.length > 18 ? `${name.slice(0, 17)}…` : name;
    const radius = layout.nodeSizes.get(String(node.id)).radius;
    const searchText = `${name} ${node.id} ${node.path}`.toLocaleLowerCase();
    const revealDelay = revealStepFor(node.id) * revealStepMs;
    return `
      <g class="graph-node ${selected ? "is-selected" : ""} ${root ? "is-root" : ""} ${global ? "is-global" : ""}" transform="translate(${position.x} ${position.y})" role="button" tabindex="0" data-node-id="${escapeHtml(String(node.id))}" data-node-path="${escapeHtml(node.path)}" data-search-text="${escapeHtml(searchText)}" aria-label="${t("開啟節點 {name}", { name: escapeHtml(name) })}" aria-grabbed="false">
        <rect class="graph-node-hit-target" x="${radius - 120}" y="-10" width="240" height="${radius * 2 + 50}" rx="10"></rect>
        <g class="graph-node-content" style="--graph-reveal-delay: ${revealDelay}ms">
          <circle class="graph-node-dot" cx="${radius}" cy="${radius}" r="${radius}"></circle>
          <text class="graph-node-name" x="${radius}" y="${radius * 2 + 18}" text-anchor="middle">${escapeHtml(shortName)}</text>
        </g>
        <title>${escapeHtml(name)}</title>
      </g>
    `;
  }).join("");
  const detachedGuideHtml = Number.isFinite(layout.detachedStartY) ? `
    <g class="graph-detached-guide" style="--graph-reveal-delay: ${maximumRevealStep * revealStepMs}ms">
      <line x1="60" y1="${layout.detachedStartY}" x2="${Math.max(60, layout.width - 60)}" y2="${layout.detachedStartY}"></line>
      <text x="78" y="${layout.detachedStartY - 14}">${t("未連結至 ROOT 的節點")}</text>
    </g>
  ` : "";
  dom.graphPanel.innerHTML = `
    <div class="graph-workspace">
      <div class="graph-canvas is-revealing">
        <label class="search-field graph-search"><span class="visually-hidden">${t("搜尋關聯圖節點")}</span><input id="graphSearch" type="search" value="${escapeHtml(state.graphSearch)}" placeholder="${t("搜尋節點")}"></label>
        <button class="graph-reset-button" id="resetGraphView" type="button" title="${t("顯示全圖")}" aria-label="${t("顯示全圖")}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 3v3M12 18v3M3 12h3M18 12h3"></path></svg>
        </button>
        <svg id="projectGraphSvg" role="img" aria-label="${t("依 Stack 深度排列的 Scene Node GOTO 與 REPLACE 有向關聯圖")}" viewBox="${graphViewBoxValue()}" data-graph-width="${layout.width}" data-graph-height="${layout.height}" data-layout-algorithm="${layout.algorithm}" data-depth-columns="${layout.columns.length}" data-edge-crossings="${SceneGraphModel.countEdgeCrossings(relationships, layout)}">
          ${detachedGuideHtml}
          <g class="graph-edges">${edgesHtml}</g>
          <g class="graph-nodes">${nodesHtml}</g>
        </svg>
      </div>
    </div>
  `;
  bindGraphPanel(layout, relationships, controller, revealDurationMs);
}

function renderValidationPanel() {
  const errors = state.issues.filter((issue) => issue.level === "error").length;
  const warnings = state.issues.filter((issue) => issue.level !== "error").length;
  dom.validationPanel.innerHTML = `
    <div class="panel-page wide">
      <div class="section-heading">
        <div><span class="section-kicker">PROJECT CHECK</span><h2>${t("專案檢查")}</h2><p>${t("{errors} 個錯誤，{warnings} 個提醒。", { errors, warnings })}</p></div>
        <div class="section-actions"><button class="primary-button" id="runValidationButton" type="button">${t("重新檢查")}</button></div>
      </div>
      ${state.issues.length ? `
        <div class="validation-list">${state.issues.map((issue) => `
          <div class="issue-row ${escapeHtml(issue.level)}">
            <span class="issue-level">${issue.level === "error" ? t("錯誤") : t("提醒")}</span>
            <span class="issue-location" title="${escapeHtml(issue.location)}">${escapeHtml(issue.location)}</span>
            <span class="issue-message">${escapeHtml(issue.message)}</span>
          </div>
        `).join("")}</div>
      ` : `<div class="success-state">${t("未發現專案問題")}</div>`}
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
    toast(state.issues.length ? t("找到 {count} 個項目", { count: state.issues.length }) : t("專案檢查通過"));
  } catch (error) {
    toast(error.message, "error");
  }
}

async function refreshAfterSave() {
  const selectedPath = state.selectedNodePath;
  const project = await api("/api/project");
  state.rootNodeId = project.rootNodeId || null;
  state.globalNode = project.globalNode || null;
  state.nodes = project.nodes || [];
  state.graph = project.graph || { edges: [] };
  state.images = project.images || [];
  state.audio = project.audio || [];
  state.optionTargets = project.optionTargets || [];
  state.stats = SceneStateEditor.withStatOrders(project.stats || {});
  state.statsDraft = clone(state.stats);
  state.memories = project.memories || { memory: { Name: "Memory" } };
  state.memoriesDraft = clone(state.memories);
  state.issues = project.issues || [];
  if (selectedPath && (selectedPath === state.globalNode?.path || state.nodes.some((node) => node.path === selectedPath))) {
    state.nodeDetail = await api(`/api/node?path=${encodeURIComponent(selectedPath)}`);
    state.nodeDetail.events = normalizeEventEntries(state.nodeDetail.events);
    state.optionsDraft = clone(state.nodeDetail.options || defaultOptionsDraft());
    if (!state.optionsDraft.Elements.some((element) => element.ID === state.selectedOptionElementId)) {
      state.selectedOptionElementId = state.optionsDraft.Elements[0]?.ID || null;
    }
    if (!selectedOptionElement()?.Items?.some((item) => item.ID === state.selectedOptionItemId)) {
      state.selectedOptionItemId = selectedOptionElement()?.Items?.[0]?.ID || null;
    }
  }
  setSaveState(t("已同步"));
  renderAll();
}

function openNameDialog() {
  dom.nameDialogInput.value = "";
  dom.nameDialog.showModal();
  window.setTimeout(() => dom.nameDialogInput.focus(), 0);
}

async function createNamedFile(name) {
  const id = generateId("content");
  const source = `label ${id}:\n    \"在這裡撰寫演出。\"\n    return\n`;
  await api("/api/content", { method: "POST", body: { node: state.selectedNodePath, id, displayName: name, source } });
  state.selectedContent = id;
  state.selectedContentDisplayName = name;
  await refreshAfterSave();
  await loadContent(id);
  switchTab("content");
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
  };
  setSaveState(t("建立中..."), "saving");
  try {
    const created = await api("/api/nodes", { method: "POST", body: payload });
    dom.nodeDialog.close();
    await loadProject({ preserveNode: false });
    await selectNode(created.path);
    switchTab("node");
    toast(t("Scene Node 已建立"));
  } catch (error) {
    setSaveState(t("建立失敗"), "error");
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
  if (!shortcut) return t("未設定");
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
      <span>${escapeHtml(t(label))}</span>
      <input data-shortcut-action="${escapeHtml(action)}" value="${escapeHtml(shortcutDisplay(state.editorSettings.shortcuts[action]))}" readonly aria-label="${escapeHtml(t(label))}">
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
          toast(t("快捷鍵已用於「{action}」", { action: SHORTCUT_LABELS[conflict[0]] ? t(SHORTCUT_LABELS[conflict[0]]) : conflict[0] }), "error");
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
  syncSelectPicker(dom.autosaveDelay);
  if (dom.editorLanguage) {
    dom.editorLanguage.value = state.editorSettings.language || "zh-Hant";
    syncSelectPicker(dom.editorLanguage);
  }
  dom.gridSize.value = state.editorSettings.gridSize;
  renderShortcutSettings();
  if (!dom.settingsDialog.open) dom.settingsDialog.showModal();
}

function syncShortcutTitles() {
  const settingsButton = document.querySelector("#settingsButton");
  const sidebarButton = document.querySelector("#openSidebar");
  if (settingsButton) settingsButton.title = `${t("編輯器設定")}（${shortcutDisplay(state.editorSettings.shortcuts.settings)}）`;
  if (sidebarButton) sidebarButton.title = `${t("切換節點列表")}（${shortcutDisplay(state.editorSettings.shortcuts.sidebar)}）`;
  Object.entries(TAB_SHORTCUT_ACTIONS).forEach(([action, tab]) => {
    const button = document.querySelector(`[data-tab="${tab}"]`);
    if (button) {
      const labelText = t(button.dataset.i18n || button.textContent.trim());
      button.title = `${labelText}（${shortcutDisplay(state.editorSettings.shortcuts[action])}）`;
    }
  });
  const createShortcut = shortcutDisplay(state.editorSettings.shortcuts.create);
  [
    ["#newNodeButton", "新增節點"],
    ["#emptyNewNodeButton", "新增節點"],
    ["#newEventButton", "新增 Event"],
    ["#emptyNewEventButton", "新增 Event"],
    ["#newContentButton", "新增 Content"],
    ["#emptyNewContentButton", "新增 Content"],
  ].forEach(([selector, label]) => {
    const button = document.querySelector(selector);
    if (button) button.title = `${t(label)}（${createShortcut}）`;
  });
  const optionDivider = document.querySelector(".option-workspace-divider");
  if (optionDivider) optionDivider.title = `${t("拖曳或按鍵切換表單與畫布")}（${shortcutDisplay(state.editorSettings.shortcuts.sections)}）`;
}

function toggleActiveSections() {
  if (state.activeTab === "options") {
    setOptionWorkspaceMode(state.optionWorkspaceMode === "form" ? "canvas" : "form");
    return;
  }
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
  if (active === "stats") saveStats();
}

function cycleActiveTab(direction) {
  const tabs = TAB_ORDER;
  const currentIndex = tabs.indexOf(state.activeTab);
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  requestTabSwitch(tabs[nextIndex]);
}

function toggleActiveLeftPanel() {
  if (state.activeTab === "options") {
    setOptionWorkspaceMode("form");
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
  setOptionWorkspaceMode("canvas");
  return true;
}

function createInActiveTab() {
  if (document.querySelector("dialog[open]")) return false;
  if (state.activeTab === "node") {
    openNodeDialog();
  } else if (state.activeTab === "events") {
    if (!state.nodeDetail) {
      toast(t("請先建立或選擇節點"), "error");
      return true;
    }
    createEventDraft();
  } else if (state.activeTab === "content") {
    if (!state.nodeDetail) {
      toast(t("請先建立或選擇節點"), "error");
      return true;
    }
    openNameDialog();
  } else if (state.activeTab === "options") {
    toast(t("選項具有多種元件類型，請在表單模式使用左側新增按鈕"));
  } else if (state.activeTab === "stats") {
    toast(t("狀態具有 Stats 與 Memory，請使用各區新增按鈕"));
  } else {
    toast(t("目前功能區沒有可新增的項目"));
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
  else if (state.activeTab === "options" && action === "grid") toggleOptionGrid();
  else if (state.activeTab === "options" && action === "snap") toggleOptionSnap();
  else return false;
  return true;
}

function bindDialogEnter(form) {
  if (!form) return;
  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "text") {
      event.preventDefault();
      form.requestSubmit();
    }
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
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      pendingTabPreview = button;
      dom.tabbar.classList.add("is-pointer-navigation");
      syncTabFocusIndicator({ targetTab: button });
      window.addEventListener("pointerup", () => {
        window.setTimeout(() => {
          if (pendingTabPreview !== button) return;
          pendingTabPreview = null;
          syncTabFocusIndicator();
        }, 0);
      }, { once: true });
    });
    button.addEventListener("pointercancel", () => {
      if (pendingTabPreview !== button) return;
      pendingTabPreview = null;
      syncTabFocusIndicator();
    });
    button.addEventListener("click", async () => {
      pendingTabPreview = null;
      syncTabFocusIndicator({ targetTab: button });
      if (!await requestTabSwitch(button.dataset.tab)) syncTabFocusIndicator();
    });
  });
  dom.tabbar.addEventListener("keydown", () => dom.tabbar.classList.remove("is-pointer-navigation"));
  dom.tabbar.addEventListener("focusout", (event) => {
    if (!dom.tabbar.contains(event.relatedTarget)) dom.tabbar.classList.remove("is-pointer-navigation");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".content-choice-picker")) closeContentPickers();
    if (!event.target.closest(".select-choice-picker")) closeSelectPickers();
  });
  document.querySelector("#openSidebar").addEventListener("click", toggleSidebar);
  document.querySelector("#closeSidebar")?.addEventListener("click", closeSidebar);
  document.querySelector("#sidebarScrim").addEventListener("click", closeSidebar);
  window.addEventListener("resize", () => {
    closeSelectPickers();
    syncTabFocusIndicator({ immediate: true });
  });
  window.addEventListener("scroll", (event) => {
    if (event.target instanceof Element && event.target.closest(".select-choice-menu, .select-choice-submenu, .content-choice-menu, .content-label-submenu")) return;
    closeSelectPickers();
    closeContentPickers();
  }, true);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => {
    document.querySelector(`#${button.dataset.closeDialog}`)?.close();
  }));
  [dom.nodeDialogForm, dom.nameDialogForm, dom.settingsForm].forEach(bindDialogEnter);

  dom.autosaveEnabled.addEventListener("change", async (event) => {
    state.editorSettings.autosave = event.target.checked;
    writeEditorSettings();
    await autosaveCoordinator.runPendingIfEnabled();
  });
  dom.autosaveDelay.addEventListener("change", (event) => {
    state.editorSettings.autosaveDelay = numberValue(event.target.value, 700);
    writeEditorSettings();
  });
  dom.editorLanguage?.addEventListener("change", async (event) => {
    const newLanguage = normalizeLocale(event.target.value);
    const previousLanguage = state.editorSettings.language;
    if (newLanguage === previousLanguage) return;

    try {
      if (autosaveCoordinator.hasUnsaved() && !state.editorSettings.autosave) {
        throw new Error(t("有未儲存的變更"));
      }

      const flushed = await autosaveCoordinator.flush();
      if (!flushed || autosaveCoordinator.hasUnsaved()) {
        throw new Error(t("儲存失敗"));
      }

      state.editorSettings.language = newLanguage;
      const saved = await writeEditorSettings({ notifyFailure: false });
      if (saved) {
        window.location.reload();
      } else {
        throw new Error(t("編輯器設定未能儲存"));
      }
    } catch (error) {
      state.editorSettings.language = previousLanguage;
      if (dom.editorLanguage) {
        dom.editorLanguage.value = previousLanguage;
        syncSelectPicker(dom.editorLanguage);
      }
      toast(error.message || t("編輯器設定未能儲存"), "error");
    }
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
    toast(t("已重設快捷鍵"));
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
      toast(t("文件已建立"));
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
    const settingsBody = JSON.stringify(state.editorSettings);
    localStorage.setItem(SETTINGS_KEY, settingsBody);
    fetch("/api/editor-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: settingsBody,
      keepalive: true,
    }).catch(() => {});
    if (!autosaveCoordinator.hasUnsaved()) return;
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
  await loadEditorSettings();
  setLocale(state.editorSettings.language);
  translateDocument(document);
  await writeEditorSettings({ notifyFailure: false });
  syncSidebarLayout();
  syncShortcutTitles();
  bindGlobalEvents();
  enhanceSelects(document);
  observeSelects();
  await loadProject();
}

init();
