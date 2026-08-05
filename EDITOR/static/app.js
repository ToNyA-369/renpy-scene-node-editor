"use strict";

const SETTINGS_KEY = "scene-node-editor.settings";
const GRID_VISIBLE_KEY = "scene-node-editor.option-grid-visible";
const SNAP_ENABLED_KEY = "scene-node-editor.option-snap-enabled";
const GLOBAL_NODE_ID = "__global__";
const GLOBAL_NODE_PATH = "@global";
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
  dom.saveState.textContent = message;
  dom.saveState.className = `save-state ${kind}`.trim();
  dom.saveState.title = detail;
}

const autosaveCoordinator = SceneAutosave.createAutosaveCoordinator({
  isEnabled: () => state.editorSettings.autosave,
  getDelay: () => state.editorSettings.autosaveDelay,
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (timer) => window.clearTimeout(timer),
  onState: setSaveState,
  onFailure: (label, error) => toast(`${label}：${error.message}`, "error"),
});

function writeEditorSettings({ notifyFailure = true } = {}) {
  const snapshot = clone(state.editorSettings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
  editorSettingsSave = editorSettingsSave.then(async () => {
    try {
      await api("/api/editor-settings", { method: "PUT", body: snapshot });
      editorSettingsSaveFailureNotified = false;
      return true;
    } catch (error) {
      if (notifyFailure && !editorSettingsSaveFailureNotified) {
        toast(`編輯器設定未能儲存：${error.message}`, "error");
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
  item.textContent = message;
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

function namedOptionTags(items, current, { includeNone = false } = {}) {
  const normalized = items.map((item) => ({
    id: String(item.id),
    name: String(item.name || item.id),
    pickerPath: item.pickerPath ? String(item.pickerPath) : "",
  }));
  const known = new Set(normalized.map((item) => item.id));
  if (current && !known.has(String(current))) normalized.push({ id: String(current), name: `${current}（未找到）` });
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
    ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(leafName(current))}（未找到）</option>`
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
  return isGlobalNode()
    ? EVENT_TRIGGER_MODES.filter((item) => item.id !== "Action")
    : EVENT_TRIGGER_MODES;
}

function eventEffectTypeChoices() {
  return isGlobalNode()
    ? SceneStateRuleContract.EFFECT_TYPES.filter((type) => type !== "option")
    : SceneStateRuleContract.EFFECT_TYPES;
}

function statChoices() {
  return SceneStateEditor.statChoices(state.stats);
}

function memoryChoices() {
  return Object.entries(state.memories).map(([id, values]) => ({ id, name: values.Name || id }));
}

function warnMissingStat(kind) {
  toast(`目前專案沒有任何 Stat。請先到「狀態」建立 Stat，再新增 Stat ${kind}。`, "error");
}

function warnMissingOptionTarget() {
  toast("目前節點沒有 CONTROLLED Option。請先在「選項」把 Element 或 Item 的 Availability 設為 CONTROLLED。", "error");
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
      !isGlobalNode()
      && entry.nodeId === currentNodeId
      && entry.availability === "CONTROLLED"
    ))
    .map((entry) => {
      const target = optionEffectTargetFromEntry(entry);
      const elementName = String(entry.elementName || entry.elementId).replaceAll("/", "／");
      const leaf = entry.target === "item"
        ? String(entry.itemName || entry.itemId).replaceAll("/", "／")
        : entry.elementType === "TEXTBOX" ? "整個選項列" : elementName;
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
  return tags + `<option value="${escapeHtml(current)}" selected>${escapeHtml(missingName)}（未找到）</option>`;
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
  return String(label || "尚未選擇");
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
    : (label ? `${leafName(label)}（未找到）` : "尚未選擇");
  const files = state.nodeDetail?.contents || [];
  const fileRows = files.map((file) => {
    const fileName = contentFileDisplayName(file);
    const labels = file.labels || [];
    if (!labels.length) {
      return `<button class="content-file-choice is-disabled" type="button" disabled><span>${escapeHtml(fileName)}</span><small>沒有 label</small></button>`;
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
          ${fileRows || '<div class="content-choice-empty">目前節點沒有 Content 文件。</div>'}
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
  addWeightedChoice,
  choiceEntries,
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
  dom.projectSummary.textContent = `${state.nodes.length} 個節點`;
  dom.nodeTitle.textContent = node?.Name || node?.ID || "Scene Node Editor";
  dom.nodePath.textContent = isGlobalNode()
    ? "GLOBALNODE"
    : state.selectedNodePath
      ? `SCENENODE/${state.selectedNodePath}`
      : state.projectPath || "尚未選擇節點";
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
    dom.nodeList.innerHTML = `<div class="node-list-empty">${state.nodes.length ? "沒有符合的節點" : "尚未建立 Scene Node"}</div>`;
    return;
  }
  const globalHtml = globalMatches ? `
    <div class="global-node-slot">
      <button class="node-item global-node-item ${globalNode.path === state.selectedNodePath ? "active" : ""}" type="button" data-node-path="${escapeHtml(globalNode.path)}">
        <span class="node-item-copy">
          <strong>${escapeHtml(globalNode.name || "GLOBAL")}<span class="global-node-badge">GLOBAL</span></strong>
          <span>所有 Scene Node 的事件作用域</span>
        </span>
        <span class="node-event-count" title="Global Event 數量">${globalNode.eventCount}</span>
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
      <span class="node-event-count" title="Event 數量">${node.eventCount}</span>
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
    state.stats = data.stats || {};
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
    if (detail.isGlobal && state.activeTab === "options") state.activeTab = "events";
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
  if (isGlobalNode() && state.activeTab === "options") state.activeTab = "events";
  const optionsTab = dom.tabbar?.querySelector('[data-tab="options"]');
  if (optionsTab) {
    optionsTab.disabled = isGlobalNode();
    optionsTab.title = isGlobalNode() ? "Global Node 不支援 Options" : "";
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
  if (tab === "options" && isGlobalNode()) tab = "events";
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
            <span>${isGlobal ? "套用至所有 Scene Node 的虛擬事件作用域" : isRoot ? "目前的遊戲起始節點" : "可設為遊戲起始節點"}</span>
          </div>
          ${isGlobal || isRoot ? "" : '<button class="quiet-button compact" id="setRootNodeButton" type="button">設為起始節點</button>'}
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
            <article><span>Options</span><strong>${isGlobal ? "—" : optionsCount}</strong></article>
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
          <button class="danger-button" id="deleteNodeButton" type="button" ${isRoot ? 'disabled title="請先將其他節點設為起始節點"' : ""}>刪除節點</button>
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
    toast("Global Node 不可設為起始節點。", "error");
    return;
  }
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
  if (snapshot) scheduleAutosave("節點設定未能儲存", (task) => persistNodeSnapshot(snapshot, task));
}

async function saveNode(event) {
  event.preventDefault();
  const snapshot = readNodeForm(event.currentTarget);
  await cancelAutosaveAndWait();
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
  const node = state.nodeDetail?.node;
  if (!node) return;
  if (isGlobalNode()) {
    toast("Global Node 不可刪除。", "error");
    return;
  }
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
    await cancelAutosaveAndWait();
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
    choices.push({ id: currentValue, name: `${actionTriggerName(currentValue)}（未找到）` });
  }
  return choices;
}

function defaultEvent(id = generateId("event")) {
  return {
    ID: id,
    Name: "新事件",
    Trigger: isGlobalNode() ? "Auto:Node" : (eventActionChoices()[0]?.id || "Auto:Node"),
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
          <span>${escapeHtml(eventTriggerDisplayName(event.Trigger))}</span>
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

function eventEditorHtml(event) {
  const triggerMode = eventTriggerMode(event.Trigger);
  const lifecycle = isLifecycleTrigger(event.Trigger);
  const triggerInput = triggerMode === "Action"
    ? `<select name="Trigger" aria-label="Option 選項" required>${namedOptionTags(eventActionChoices(event.Trigger), event.Trigger)}</select>`
    : triggerMode === "Keyboard"
      ? `<input class="keyboard-trigger-recorder" data-keyboard-trigger readonly aria-label="Keyboard 按鍵" value="${escapeHtml(keyboardKeysymDisplay(keyboardTriggerKeysym(event.Trigger)))}" title="聚焦後直接按下按鍵或按鍵組合">
         <input name="Trigger" type="hidden" value="${escapeHtml(event.Trigger)}">`
      : triggerMode === "Mouse"
        ? `<select name="Trigger" aria-label="Mouse 按鍵" required>${namedOptionTags(MOUSE_TRIGGER_CHOICES, event.Trigger)}</select>`
        : `<select name="Trigger" aria-label="Auto 時機" required>${namedOptionTags(AUTO_TRIGGER_CHOICES, event.Trigger)}</select>`;
  return `
    <form class="editor-page" id="eventForm">
      <div class="form-section event-primary-section">
        <div class="form-grid event-primary-name-grid">
          <label class="field"><span>Name</span><input name="Name" required value="${escapeHtml(event.Name || event.ID || "")}"></label>
          <div class="field event-trigger-field">
            <span>Trigger</span>
            <div class="event-trigger-control is-${triggerMode.toLocaleLowerCase()}">
              <select name="TriggerMode" aria-label="Trigger 模式">${namedOptionTags(eventTriggerModeChoices(), triggerMode)}</select>
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

      ${lifecycle ? "" : `<details class="form-section collapsible-section event-choice-section" open>
        <summary class="form-section-header">
          <div><h3>End up</h3><span>${escapeHtml(event["End up"] || "REDO")}</span></div>
          ${endUpUsesNextNode(event["End up"]) ? '<button class="icon-button section-add-button add-button" type="button" data-add-weighted="next" title="新增節點" aria-label="新增節點">＋</button>' : ""}
        </summary>
        <div class="collapsible-section-body">
          <div class="end-up-control">
            <label class="field"><span class="visually-hidden">End up</span><select name="EndUp" aria-label="End up">${optionTags(END_UP_CHOICES, event["End up"] || "REDO")}</select></label>
          </div>
          <div id="nextNodeBlock">${endUpUsesNextNode(event["End up"]) ? choiceBlockHtml(event["Next Node"], "next") : ""}</div>
        </div>
      </details>`}

      ${state.eventOriginalId ? '<div class="editor-danger-zone"><button class="danger-button" id="deleteEventButton" type="button">刪除事件</button></div>' : ""}
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
  document.querySelector("#newEventButton")?.addEventListener("click", createEventDraft);
  document.querySelector("#emptyNewEventButton")?.addEventListener("click", createEventDraft);
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
        toast(addWeighted === "content" ? "目前節點沒有可用的 Content label。" : "目前專案沒有 Scene Node。", "error");
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
          toast("目前節點尚未建立可供 Event 使用的選項。", "error");
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

async function persistEventSnapshot(snapshot, task = null) {
  const saved = await api("/api/events", {
    method: "POST",
    body: { node: snapshot.node, originalId: snapshot.originalId, event: snapshot.event },
  });
  if (task && !isCurrentAutosaveTask(task)) return saved;
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
  scheduleAutosave("Event 未能儲存", (task) => persistEventSnapshot(snapshot, task));
}

async function saveEvent(event) {
  event.preventDefault();
  const draft = readEventForm();
  const snapshot = { node: state.selectedNodePath, originalId: state.eventOriginalId, event: clone(draft) };
  await cancelAutosaveAndWait();
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
  if (!state.eventOriginalId || !window.confirm(`確定刪除 Event「${state.eventOriginalId}」？`)) return;
  try {
    await cancelAutosaveAndWait();
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
  if (!elements.length) return `<div class="node-list-empty">尚未建立選項</div>`;
  return elements.map((element) => `
    <button class="subnav-item option-element-list-item ${element.ID === state.selectedOptionElementId ? "active" : ""}" type="button" data-option-element-select="${escapeHtml(element.ID)}">
      <span class="subnav-item-copy">
        <strong>${escapeHtml(element.Name || element.ID)}</strong>
        <span>${escapeHtml(optionTypeLabel(element.Type))}${element.Type === "TEXTBOX" ? ` · ${element.Items?.length || 0} 項` : ""}${element.Availability === "CONTROLLED" ? " · Controlled" : ""}</span>
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
          `).join("") : `<div class="option-empty-row" style="height:${metrics.itemHeight}px">尚未建立 Item</div>`}
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
      : `<div class="option-picture-placeholder"><span>PICTURE</span><small>選擇 Idle 圖片</small></div>`;
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
    ${optionBooleanField("Hover 效果", 'data-option-path="Hover.Enabled"', hoverEnabled)}
    ${hoverEnabled ? `
      ${transparentColorField("Hover 顏色", "Hover.Color", hover.Color, "#ffffff18")}
      ${picture ? `<label class="field"><span>Hover 圖片</span><select data-option-path="Picture.Hover" aria-label="Hover 圖片">${imageOptionTags(pictureData.Hover || "", [{ id: "", name: "None" }])}</select></label>` : ""}
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
  return `
    <details class="form-section collapsible-section option-collapsible-section ${extraClass}" data-option-section="${escapeHtml(title)}">
      <summary class="form-section-header">
        <div><h3>${escapeHtml(title)}</h3>${summary ? `<span>${escapeHtml(summary)}</span>` : ""}</div>
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
        <strong>${state.optionWorkspaceMode === "canvas" ? "畫布上尚無可調整的選項" : "選擇或新增選項"}</strong>
        ${state.optionWorkspaceMode === "canvas" ? '<span>向左拖曳分隔把手即可回到表單新增。</span>' : ""}
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
      <label class="field"><span>寬度</span><input data-option-path="Layout.Width" type="number" min="24" value="${escapeHtml(layout.Width ?? 100)}"></label>
      ${element.Type === "TEXTBOX" ? "" : `<label class="field"><span>高度</span><input data-option-path="Layout.Height" type="number" min="24" value="${escapeHtml(layout.Height ?? 100)}"></label>`}
    </div>
  `;
  const zOrderField = `<label class="field"><span>圖層順序</span><input data-option-path="Layout.Z Order" type="number" value="${escapeHtml(layout["Z Order"] ?? 10)}"></label>`;
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
            <div><h3>Items</h3><span>${element.Items?.length || 0} 個選項</span></div>
            <button class="icon-button section-add-button add-button" id="addOptionItem" type="button" title="新增選項" aria-label="新增選項">＋</button>
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
          ${rangeField("最多顯示", "List.Max Visible Items", list["Max Visible Items"] ?? 4, { min: 1, max: 20 })}
          ${rangeField("Item 高度", "List.Item Height", list["Item Height"] ?? 72, { min: 24, max: 240, suffix: " px" })}
          ${rangeField("Item 間距", "List.Item Spacing", list["Item Spacing"] ?? 12, { min: 0, max: 120, suffix: " px" })}
          ${rangeField("Padding", "List.Padding", list.Padding ?? 16, { min: 0, max: 160, suffix: " px" })}
        </div>
        ${optionBooleanField("內容超出時顯示滑桿", 'data-option-path="List.Show Scrollbar"', list["Show Scrollbar"] !== false)}
      `);
      sections += optionCollapsibleSection("外觀", "", `
        <div class="option-section-group">
          ${optionHoverFields(element)}
        </div>
        <div class="option-section-group">
          <h4>背景</h4>
          <div class="form-grid compact-grid color-grid option-opacity-colors">
            ${transparentColorField("容器", "Style.Background", style.Background, "#0b1118")}
            ${transparentColorField("Item", "Style.Item Background", style["Item Background"], "#20302a")}
          </div>
        </div>
        <div class="option-section-group">
          <h4>文字</h4>
          <div class="form-grid two-columns compact-grid color-grid">
            <label class="field"><span>一般</span><input data-option-path="Style.Text Color" type="color" value="${safeColor(style["Text Color"], "#ffffff").slice(0, 7)}"></label>
          </div>
          ${rangeField("字體大小", "Style.Text Size", style["Text Size"] ?? 30, { min: 8, max: 160, suffix: " px" })}
          <label class="field"><span>文字對齊</span><select data-option-path="Style.Text Align">${optionTags([0, 0.5, 1], style["Text Align"] ?? 0.5, (value) => ({ 0: "靠左", 0.5: "置中", 1: "靠右" })[value])}</select></label>
        </div>
        ${item ? `
          <div class="option-section-group">
            ${optionBooleanField("使用獨立樣式", 'id="itemStyleOverrideEnabled"', hasItemOverride)}
            ${hasItemOverride ? `
              <div class="form-grid compact-grid color-grid option-opacity-colors">
                ${transparentColorField("背景", "Style Override.Item Background", itemOverride["Item Background"], style["Item Background"] || "#20302a", true)}
                <label class="field"><span>文字</span><input data-option-item-path="Style Override.Text Color" type="color" value="${safeColor(itemOverride["Text Color"], style["Text Color"]).slice(0, 7)}"></label>
              </div>
              ${rangeField("字體大小", "Style Override.Text Size", itemOverride["Text Size"] ?? style["Text Size"] ?? 30, { min: 8, max: 160, suffix: " px", itemField: true })}
              <label class="field"><span>文字對齊</span><select data-option-item-path="Style Override.Text Align">${optionTags([0, 0.5, 1], itemOverride["Text Align"] ?? style["Text Align"] ?? 0.5, (value) => ({ 0: "靠左", 0.5: "置中", 1: "靠右" })[value])}</select></label>
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
            <label class="field"><span>Idle 圖片</span><select data-option-path="Picture.Idle" aria-label="Idle 圖片">${imageOptionTags(picture.Idle || "", [{ id: "", name: "None" }])}</select></label>
            ${optionBooleanField("只讓不透明部分可點擊", 'data-option-path="Picture.Alpha Hit Test"', Boolean(picture["Alpha Hit Test"]))}
          </div>
        </div>
      `;
      sections += optionSoundSection(element);
    } else {
      primary = positionFields;
      sections += optionCollapsibleSection("版面細節", "", `
        ${zOrderField}
        <label class="field"><span>填充方式</span><select data-option-path="Picture.Fit">${optionTags(["CONTAIN", "COVER", "STRETCH"], picture.Fit || "CONTAIN")}</select></label>
        ${optionBooleanField("保持長寬比", 'data-option-path="Picture.Keep Aspect"', picture["Keep Aspect"] !== false)}
      `);
      sections += optionCollapsibleSection("外觀", "", `
        <div class="option-section-group">
          ${optionHoverFields(element, { picture: true })}
        </div>
        <div class="option-section-group">
          <h4>顯示效果</h4>
          ${rangeField("不透明度", "Picture.Opacity", picture.Opacity ?? 1, { min: 0, max: 1, step: 0.01, format: "percent" })}
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
          <label class="field"><span>顏色</span><input data-option-path="Hitbox.Editor Color" type="color" value="${safeColor(hitbox["Editor Color"], "#28a47d").slice(0, 7)}"></label>
          ${rangeField("不透明度", "Hitbox.Editor Opacity", hitbox["Editor Opacity"] ?? 0.24, { min: 0, max: 1, step: 0.01, format: "percent" })}
        </div>
      `);
    }
  }

  return `
    <div class="editor-page option-editor-page option-editor-${isCanvas ? "canvas" : "form"}">
      <div class="form-section option-primary-section">${primary}</div>
      ${sections}
      ${isCanvas ? "" : `<div class="editor-danger-zone"><button class="danger-button" id="deleteOptionElement" type="button">刪除</button></div>`}
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
  if (isGlobalNode()) {
    dom.optionsPanel.innerHTML = '<div class="panel-page wide"><div class="success-state">Global Node 不提供 Options；全局事件不可由選項觸發。</div></div>';
    return;
  }
  if (!state.optionsDraft) state.optionsDraft = clone(state.nodeDetail.options || defaultOptionsDraft());
  const canvas = state.optionsDraft.Canvas || {};
  const isFormMode = state.optionWorkspaceMode === "form";
  const elementSidebar = `
    <aside class="option-element-sidebar">
      <div class="option-add-buttons" aria-label="新增選項">
        <button class="quiet-button compact add-button" type="button" data-add-option-element="TEXTBOX">Text Box</button>
        <button class="quiet-button compact add-button" type="button" data-add-option-element="PICTURE">Picture</button>
        <button class="quiet-button compact add-button" type="button" data-add-option-element="HITBOX">Hitbox</button>
      </div>
      <div class="subnav-list">${optionElementListHtml()}</div>
    </aside>
  `;
  const divider = `
    <button class="option-workspace-divider" type="button" role="separator" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${isFormMode ? 0 : 100}" aria-label="拖曳切換表單與畫布" title="拖曳切換表單與畫布；也可按 Enter 或方向鍵">
      <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
    </button>
  `;
  const canvasColumn = `
    <section class="option-canvas-column">
      <div class="option-builder-toolbar">
        <div class="option-view-controls" aria-label="畫布設定">
          <button class="toggle-button ${state.optionGridVisible ? "active" : ""}" id="toggleOptionGrid" type="button" title="顯示或隱藏格線（${shortcutDisplay(state.editorSettings.shortcuts.grid)}）">格線</button>
          <button class="toggle-button ${state.optionSnapEnabled ? "active" : ""}" id="toggleOptionSnap" type="button" title="開啟或關閉吸附（${shortcutDisplay(state.editorSettings.shortcuts.snap)}）">吸附</button>
        </div>
        <label class="field inline-field canvas-path-field"><select data-canvas-path="Preview Background" aria-label="預覽底圖">${canvasBackgroundOptionTags(canvas["Preview Background"] || "")}</select></label>
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
      toast(`無法刪除「${element.Name}」：仍被 ${data.references.length} 個 Event Effect 引用。`, "error");
      return;
    }
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  if (!window.confirm(`確定刪除「${element.Name}」？`)) return;
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
      toast(`無法刪除「${item.Name}」：仍被 ${data.references.length} 個 Event Effect 引用。`, "error");
      return;
    }
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  if (!window.confirm(`確定刪除「${item.Name}」？`)) return;
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
  scheduleAutosave("選項設定未能儲存", (task) => persistOptionsSnapshot(snapshot, task));
}

async function saveOptions() {
  const snapshot = optionsSnapshot();
  await cancelAutosaveAndWait();
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
    const symbols = file.labels || [];
    return `
      <button class="subnav-item ${file.name === selected ? "active" : ""}" type="button" data-${dataName}="${escapeHtml(file.name)}">
        <span class="subnav-item-copy">
          <strong>${escapeHtml(file.displayName || file.name)}</strong>
          <span>${symbols.length ? `${symbols.length} 個 label` : "尚未偵測到 label"}</span>
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
  scheduleAutosave("Content 未能儲存", (task) => persistContentSnapshot(snapshot, task));
}

async function saveContent() {
  const snapshot = contentSnapshot();
  await cancelAutosaveAndWait();
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
  if (!state.selectedContent || !window.confirm(`確定刪除 Content「${state.selectedContent}.rpy」？`)) return;
  const node = state.selectedNodePath;
  const name = state.selectedContent;
  await cancelAutosaveAndWait();
  setSaveState("刪除中", "saving");
  try {
    await api(`/api/content?node=${encodeURIComponent(node)}&name=${encodeURIComponent(name)}`, { method: "DELETE" });
    state.selectedContent = null;
    state.selectedContentDisplayName = "";
    state.contentSource = "";
    await refreshAfterSave();
    toast("Content 已刪除");
  } catch (error) {
    setSaveState("刪除失敗", "error");
    toast(error.message, "error");
  }
}

function statRowsHtml(entries) {
  if (!entries.length) return `<tr><td colspan="5"><div class="row-empty">這個群組尚未建立 Stat。</div></td></tr>`;
  return entries.map(([id, values]) => `
    <tr class="stat-row" data-stat-id="${escapeHtml(id)}">
      <td><input name="statName" aria-label="Stat Name" value="${escapeHtml(values.Name || id)}"></td>
      <td><input name="statMin" type="number" step="any" value="${escapeHtml(values.Min)}"></td>
      <td><input name="statInit" type="number" step="any" value="${escapeHtml(values.Init)}"></td>
      <td><input name="statMax" type="number" step="any" value="${escapeHtml(values.Max)}"></td>
      <td class="action-cell"><button class="row-button" type="button" data-remove-stat="${escapeHtml(id)}" title="移除 Stat" aria-label="移除 Stat">×</button></td>
    </tr>
  `).join("");
}

function statGroupsHtml() {
  const groups = SceneStateEditor.groupedStatEntries(state.statsDraft);
  return groups.map(({ group, entries }) => `
    <section class="stat-group-card" data-stat-group="${escapeHtml(group)}">
      <div class="stat-group-heading">
        <label class="field stat-group-name-field">
          <span class="visually-hidden">群組名稱</span>
          <input name="statGroupName" aria-label="群組名稱" value="${escapeHtml(group)}" ${group === SceneStateEditor.DEFAULT_GROUP ? "readonly" : ""}>
        </label>
        <button class="stat-group-add-button add-button" type="button" data-add-stat-to-group title="在 ${escapeHtml(group)} 新增 Stat" aria-label="在 ${escapeHtml(group)} 新增 Stat">＋</button>
      </div>
      <div class="state-table-wrap">
        <table class="data-table state-data-table stats-table">
          <thead><tr><th>Name</th><th>Min</th><th>Init</th><th>Max</th><th></th></tr></thead>
          <tbody>${statRowsHtml(entries)}</tbody>
        </table>
      </div>
    </section>
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
  dom.statsPanel.innerHTML = `
    <div class="panel-page wide state-definitions-page" id="stateDefinitionsPage">
      <section class="state-definition-section">
        <div class="state-section-heading">
          <div><h2>Stats</h2></div>
          <button class="state-add-button add-button" id="addStatGroupButton" type="button" title="新增 Stat 群組" aria-label="新增 Stat 群組">＋</button>
        </div>
        <div class="stat-groups" id="statsGroups">${statGroupsHtml()}</div>
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
  document.querySelector("#addStatGroupButton")?.addEventListener("click", addStatGroup);
  document.querySelectorAll("[data-add-stat-to-group]").forEach((button) => button.addEventListener("click", () => {
    const group = button.closest(".stat-group-card")?.querySelector('[name="statGroupName"]')?.value;
    addStat(group);
  }));
  document.querySelector("#addMemoryButton")?.addEventListener("click", addMemory);
  document.querySelectorAll("[data-remove-stat]").forEach((button) => button.addEventListener("click", () => removeStat(button.dataset.removeStat)));
  document.querySelectorAll("[data-remove-memory]:not([disabled])").forEach((button) => button.addEventListener("click", () => removeMemory(Number(button.dataset.removeMemory))));
  const page = document.querySelector("#stateDefinitionsPage");
  page?.addEventListener("input", scheduleStatsAutosave);
}

function readStatsForm() {
  const result = {};
  document.querySelectorAll(".stat-row").forEach((row) => {
    const id = row.dataset.statId;
    if (!id) return;
    const group = SceneStateEditor.normalizeGroup(
      row.closest(".stat-group-card")?.querySelector('[name="statGroupName"]')?.value,
    );
    result[id] = {
      Name: row.querySelector('[name="statName"]').value.trim() || id,
      Group: group,
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
  state.statsDraft[id] = {
    Name: "新數值",
    Group: SceneStateEditor.normalizeGroup(group),
    Min: 0,
    Init: 0,
    Max: 100,
  };
  renderStatsPanel();
  scheduleStatsAutosave();
  document.querySelector(`.stat-row[data-stat-id="${CSS.escape(id)}"] [name="statName"]`)?.select();
  return id;
}

function addStatGroup() {
  state.statsDraft = readStatsForm();
  state.memoriesDraft = readMemoriesForm();
  const existing = new Set(SceneStateEditor.groupedStatEntries(state.statsDraft).map(({ group }) => group));
  const base = "New Group";
  let group = base;
  let suffix = 2;
  while (existing.has(group)) {
    group = `${base} ${suffix}`;
    suffix += 1;
  }
  const id = addStat(group);
  document.querySelector(`.stat-row[data-stat-id="${CSS.escape(id)}"]`)
    ?.closest(".stat-group-card")
    ?.querySelector('[name="statGroupName"]')
    ?.select();
}

function removeStat(id) {
  state.statsDraft = readStatsForm();
  state.memoriesDraft = readMemoriesForm();
  delete state.statsDraft[id];
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
  scheduleAutosave("狀態定義未能儲存", (task) => persistStatsSnapshot(stats, memories, task));
}

async function saveStats() {
  const stats = readStatsForm();
  const memories = readMemoriesForm();
  await cancelAutosaveAndWait();
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

function graphViewBoxValue() {
  const view = state.graphViewBox;
  return view ? `${view.x} ${view.y} ${view.width} ${view.height}` : "0 0 760 480";
}

function applyGraphViewBox() {
  const svg = dom.graphPanel.querySelector("#projectGraphSvg");
  if (svg && state.graphViewBox) svg.setAttribute("viewBox", graphViewBoxValue());
}

function resetGraphView() {
  const svg = dom.graphPanel.querySelector("#projectGraphSvg");
  if (!svg) return;
  state.graphViewBox = {
    x: 0,
    y: 0,
    width: Number(svg.dataset.graphWidth) || 760,
    height: Number(svg.dataset.graphHeight) || 480,
  };
  applyGraphViewBox();
}

function updateGraphSearch() {
  const query = state.graphSearch.trim().toLocaleLowerCase();
  dom.graphPanel.querySelectorAll(".graph-node").forEach((node) => {
    const matches = !query || (node.dataset.searchText || "").includes(query);
    node.classList.toggle("is-dimmed", !matches);
    node.classList.toggle("is-search-match", Boolean(query && matches));
  });
}

function bindGraphPanel() {
  const svg = dom.graphPanel.querySelector("#projectGraphSvg");
  const canvas = dom.graphPanel.querySelector(".graph-canvas");
  const search = dom.graphPanel.querySelector("#graphSearch");
  dom.graphPanel.querySelector("#resetGraphView")?.addEventListener("click", resetGraphView);
  search?.addEventListener("input", (event) => {
    state.graphSearch = event.target.value;
    updateGraphSearch();
  });
  dom.graphPanel.querySelectorAll(".graph-node").forEach((node) => {
    const openNode = () => selectNode(node.dataset.nodePath, { preserveTab: true });
    node.addEventListener("click", openNode);
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
    const width = Math.max(320, Math.min(5000, view.width * requestedFactor));
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
}

function renderGraphPanel() {
  const nodes = [state.globalNode, ...(state.nodes || [])].filter(Boolean);
  const relationships = SceneGraphModel.relationships(nodes, state.graph?.edges || []);
  const signature = JSON.stringify({
    nodes: nodes.map((node) => [node.id, node.path, node.name]),
    edges: relationships.map((edge) => [edge.source, edge.target, edge.endUp, edge.scope, edge.events.length]),
  });
  const layout = SceneGraphModel.layout(nodes, relationships, state.rootNodeId);
  if (signature !== state.graphLayoutSignature) {
    state.graphLayoutSignature = signature;
    state.graphViewBox = { x: 0, y: 0, width: layout.width, height: layout.height };
  }
  if (!nodes.length) {
    dom.graphPanel.innerHTML = '<div class="panel-page wide"><div class="success-state">建立 Scene Node 後，關聯圖會顯示 GOTO／REPLACE 關係。</div></div>';
    return;
  }
  const nodeNames = new Map(nodes.map((node) => [String(node.id), String(node.name || node.id)]));
  const edgesHtml = relationships.map((relationship, index) => {
    const source = layout.positions.get(relationship.source);
    const target = layout.positions.get(relationship.target);
    if (!source || !target) return "";
    const descriptions = relationship.events.map((event) => relationship.endUp === "MANAGEMENT"
      ? `${nodeNames.get(String(event.replacedNode)) || event.replacedNode} · ${event.eventName} · ${eventTriggerDisplayName(event.trigger)} · REPLACE 管理關係`
      : `${event.eventName} · ${eventTriggerDisplayName(event.trigger)} · ${relationship.scope === "global" ? "GLOBAL CONTEXT · " : ""}${relationship.endUp}${event.weight === 1 ? "" : ` · Weight ${event.weight}`}`);
    const selected = relationship.source === String(state.nodeDetail?.node?.ID || "") || relationship.target === String(state.nodeDetail?.node?.ID || "");
    const marker = relationship.endUp === "MANAGEMENT" ? "Management" : "Goto";
    return `
      <g class="graph-edge is-${relationship.endUp.toLocaleLowerCase()} ${relationship.scope === "global" ? "is-global" : ""} ${selected ? "is-related" : ""}" data-end-up="${relationship.endUp}" data-scope="${relationship.scope}">
        <path d="${SceneGraphModel.edgePath(source, target, layout, index, relationship.endUp)}" marker-end="url(#graphArrow${marker})"><title>${escapeHtml(descriptions.join("\n"))}</title></path>
        ${relationship.events.length > 1 ? `<text x="${(source.x + target.x + layout.nodeWidth) / 2}" y="${(source.y + target.y + layout.nodeHeight) / 2 - 8}">×${relationship.events.length}</text>` : ""}
      </g>
    `;
  }).join("");
  const nodesHtml = nodes.map((node) => {
    const position = layout.positions.get(String(node.id));
    const selected = node.path === state.selectedNodePath;
    const global = Boolean(node.isGlobal);
    const root = String(node.id) === String(state.rootNodeId || "");
    const name = String(node.name || node.id);
    const shortName = name.length > 20 ? `${name.slice(0, 19)}…` : name;
    const shortId = String(node.id).length > 24 ? `${String(node.id).slice(0, 23)}…` : String(node.id);
    const searchText = `${name} ${node.id} ${node.path}`.toLocaleLowerCase();
    return `
      <g class="graph-node ${selected ? "is-selected" : ""} ${root ? "is-root" : ""} ${global ? "is-global" : ""}" transform="translate(${position.x} ${position.y})" role="button" tabindex="0" data-node-path="${escapeHtml(node.path)}" data-search-text="${escapeHtml(searchText)}" aria-label="開啟節點 ${escapeHtml(name)}">
        <rect width="${layout.nodeWidth}" height="${layout.nodeHeight}" rx="17"></rect>
        <circle cx="22" cy="24" r="6"></circle>
        <text class="graph-node-name" x="38" y="29">${escapeHtml(shortName)}</text>
        <text class="graph-node-id" x="22" y="53">${escapeHtml(shortId)}</text>
        ${root ? `<text class="graph-root-label" x="${layout.nodeWidth - 12}" y="17" text-anchor="end">ROOT</text>` : ""}
        ${global ? `<text class="graph-global-label" x="${layout.nodeWidth - 12}" y="17" text-anchor="end">GLOBAL</text>` : ""}
        <title>${escapeHtml(name)}\n${global ? "GLOBALNODE" : escapeHtml(node.path)}</title>
      </g>
    `;
  }).join("");
  dom.graphPanel.innerHTML = `
    <div class="graph-workspace">
      <div class="graph-canvas">
        <label class="search-field graph-search"><span class="visually-hidden">搜尋關聯圖節點</span><input id="graphSearch" type="search" value="${escapeHtml(state.graphSearch)}" placeholder="搜尋節點"></label>
        <button class="graph-reset-button" id="resetGraphView" type="button" title="重新置中" aria-label="重新置中">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 3v3M12 18v3M3 12h3M18 12h3"></path></svg>
        </button>
        <svg id="projectGraphSvg" role="img" aria-label="Scene Node GOTO 與 REPLACE 有向關聯圖" viewBox="${graphViewBoxValue()}" data-graph-width="${layout.width}" data-graph-height="${layout.height}">
          <defs>
            <marker id="graphArrowGoto" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
            <marker id="graphArrowManagement" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
          </defs>
          <g class="graph-edges">${edgesHtml}</g>
          <g class="graph-nodes">${nodesHtml}</g>
        </svg>
      </div>
    </div>
  `;
  bindGraphPanel();
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
  state.rootNodeId = project.rootNodeId || null;
  state.globalNode = project.globalNode || null;
  state.nodes = project.nodes || [];
  state.graph = project.graph || { edges: [] };
  state.images = project.images || [];
  state.audio = project.audio || [];
  state.optionTargets = project.optionTargets || [];
  state.stats = project.stats || {};
  state.statsDraft = clone(state.stats);
  state.memories = project.memories || { memory: { Name: "Memory" } };
  state.memoriesDraft = clone(state.memories);
  state.issues = project.issues || [];
  if (selectedPath && (selectedPath === state.globalNode?.path || state.nodes.some((node) => node.path === selectedPath))) {
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
  syncSelectPicker(dom.autosaveDelay);
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
  ].forEach(([selector, label]) => {
    const button = document.querySelector(selector);
    if (button) button.title = `${label}（${createShortcut}）`;
  });
  const optionDivider = document.querySelector(".option-workspace-divider");
  if (optionDivider) optionDivider.title = `拖曳或按鍵切換表單與畫布（${shortcutDisplay(state.editorSettings.shortcuts.sections)}）`;
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
  const tabs = isGlobalNode() ? TAB_ORDER.filter((tab) => tab !== "options") : TAB_ORDER;
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
      toast("請先建立或選擇節點", "error");
      return true;
    }
    createEventDraft();
  } else if (state.activeTab === "content") {
    if (!state.nodeDetail) {
      toast("請先建立或選擇節點", "error");
      return true;
    }
    openNameDialog();
  } else if (state.activeTab === "options") {
    toast("選項具有多種元件類型，請在表單模式使用左側新增按鈕");
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
  else if (state.activeTab === "options" && action === "grid") toggleOptionGrid();
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
  await writeEditorSettings({ notifyFailure: false });
  syncSidebarLayout();
  syncShortcutTitles();
  bindGlobalEvents();
  enhanceSelects(document);
  observeSelects();
  await loadProject();
}

init();
