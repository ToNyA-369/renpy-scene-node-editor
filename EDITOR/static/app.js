"use strict";

const state = {
  projectName: "",
  projectPath: "",
  nodes: [],
  screens: [],
  images: [],
  stats: {},
  statsDraft: {},
  issues: [],
  selectedNodePath: null,
  nodeDetail: null,
  selectedEventId: null,
  eventOriginalId: null,
  eventDraft: null,
  optionsDraft: null,
  selectedOptionElementId: null,
  selectedOptionItemId: null,
  optionAdvancedOpen: false,
  optionResizeObserver: null,
  selectedContent: null,
  selectedContentDisplayName: "",
  contentSource: "",
  selectedScreen: null,
  selectedScreenDisplayName: "",
  screenSource: "",
  activeTab: "node",
  nameDialogKind: null,
};

const dom = {
  workspace: document.querySelector("#workspace"),
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

function setSaveState(message, kind = "") {
  dom.saveState.textContent = message;
  dom.saveState.className = `save-state ${kind}`.trim();
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
  const response = await fetch(path, request);
  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || `請求失敗 (${response.status})`);
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

function statChoices() {
  return Object.entries(state.stats).map(([id, values]) => ({ id, name: values.Name || id }));
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
        <strong>${escapeHtml(node.name || node.id)}</strong>
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
    state.nodes = data.nodes || [];
    state.screens = data.screens || [];
    state.images = data.images || [];
    state.stats = data.stats || {};
    state.statsDraft = clone(state.stats);
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
    if (state.selectedContent) await loadContent(state.selectedContent, false);
    closeSidebar();
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
}

function switchTab(tab, { render = true } = {}) {
  state.activeTab = tab;
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
  if (render) {
    if (tab === "screens") renderScreensPanel();
    if (tab === "stats") renderStatsPanel();
    if (tab === "validation") renderValidationPanel();
  }
  updateEmptyState();
}

function renderNodePanel() {
  if (!state.nodeDetail) {
    dom.nodePanel.innerHTML = "";
    return;
  }
  const node = state.nodeDetail.node;
  dom.nodePanel.innerHTML = `
    <div class="panel-page">
      <div class="section-heading">
        <div>
          <span class="section-kicker">NODE.JSON</span>
          <h2>${escapeHtml(node.Name || node.ID || "節點設定")}</h2>
        </div>
        <div class="section-actions">
          <button class="danger-button" id="deleteNodeButton" type="button">刪除節點</button>
          <button class="primary-button" type="submit" form="nodeForm">儲存節點</button>
        </div>
      </div>

      <form id="nodeForm">
        <div class="form-section">
          <div class="form-grid two-columns">
            <label class="field">
              <span>節點名稱</span>
              <input name="Name" required value="${escapeHtml(node.Name || node.ID || "")}">
            </label>
            <label class="field">
              <span>技術 ID</span>
              <input value="${escapeHtml(node.ID || "")}" disabled>
              <input name="ID" type="hidden" value="${escapeHtml(node.ID || "")}">
            </label>
          </div>
        </div>
        <div class="form-section">
          <div class="form-grid two-columns">
            <label class="field">
              <span>Background</span>
              <input name="Background" value="${escapeHtml(node.Background || "")}" placeholder="bedroomDay">
            </label>
            <label class="field">
              <span>Scene Screen</span>
              <select name="Screen">${namedOptionTags(screenChoices(), node.Screen || "", { includeNone: true })}</select>
            </label>
          </div>
        </div>
      </form>

      <div class="meta-strip">
        <div class="meta-item"><span>Event Pool</span><strong>${state.nodeDetail.events.length} Events</strong></div>
        <div class="meta-item"><span>Content</span><strong>${state.nodeDetail.contents.length} Files</strong></div>
        <div class="meta-item"><span>Options.json</span><strong>${state.nodeDetail.options?.Elements?.length || 0} Elements</strong></div>
      </div>
    </div>
  `;
  document.querySelector("#nodeForm")?.addEventListener("submit", saveNode);
  document.querySelector("#deleteNodeButton")?.addEventListener("click", deleteNode);
}

async function saveNode(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  setSaveState("儲存中", "saving");
  try {
    await api("/api/node", {
      method: "PUT",
      body: {
        path: state.selectedNodePath,
        node: {
          ID: form.get("ID"),
          Name: form.get("Name"),
          Background: form.get("Background"),
          Screen: form.get("Screen"),
        },
      },
    });
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
    toast(error.message, "error");
  }
}

function defaultEvent(id = generateId("event")) {
  return {
    ID: id,
    Name: "新事件",
    Trigger: "Action:新選項",
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
    const event = entry.data;
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

function renderEventsPanel() {
  if (!state.nodeDetail) {
    dom.eventsPanel.innerHTML = "";
    return;
  }
  dom.eventsPanel.innerHTML = `
    <div class="event-workspace">
      <aside class="subnav">
        <div class="subnav-header">
          <strong>EVENTPOOL</strong>
          <button class="icon-button" id="newEventButton" type="button" title="新增 Event" aria-label="新增 Event">＋</button>
        </div>
        <div class="subnav-list">${eventListHtml()}</div>
      </aside>
      <div class="editor-scroll" id="eventEditorScroll">
        ${state.eventDraft ? eventEditorHtml(state.eventDraft) : `
          <div class="editor-empty">
            <div>
              <p>這個節點還沒有 Event。</p>
              <button class="primary-button" id="emptyNewEventButton" type="button">新增 Event</button>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
  bindEventPanel();
}

function conditionRowsHtml(conditions) {
  if (!conditions.length) return `<div class="row-empty">沒有條件，這個 Event 會作為無條件候選。</div>`;
  return conditions.map((condition, index) => {
    const type = condition.type || "stat";
    const isTag = type === "tag";
    return `
      <div class="repeat-row condition-row" data-index="${index}">
        <label class="field"><span>類型</span><select name="conditionType">${optionTags(["stat", "tag"], type)}</select></label>
        <label class="field"><span>${isTag ? "Tag" : "Stat"}</span>${isTag ? `<input name="conditionId" value="${escapeHtml(condition.id || "")}">` : `<select name="conditionId">${namedOptionTags(statChoices(), condition.id)}</select>`}</label>
        <label class="field"><span>判斷</span><select name="conditionOp">${optionTags(isTag ? ["has", "not_has"] : [">", ">=", "<", "<=", "==", "!="], condition.op)}</select></label>
        <label class="field"><span>值</span><input name="conditionValue" type="number" step="any" value="${escapeHtml(condition.value ?? 0)}" ${isTag ? "disabled" : ""}></label>
        <button class="row-button" type="button" data-remove-condition="${index}" title="移除條件" aria-label="移除條件">×</button>
      </div>
    `;
  }).join("");
}

function effectRowsHtml(effects) {
  if (!effects.length) return `<div class="row-empty">尚未設定 Effect。</div>`;
  return effects.map((effect, index) => {
    const type = effect.type || "stat";
    const isStat = type === "stat";
    const isTag = type === "tag";
    const opItems = isStat ? ["set", "+", "-", "*", "/"] : isTag ? ["add", "remove"] : ["play", "stop"];
    const valueField = isStat
      ? `<label class="field"><span>值</span><input name="effectValue" type="number" step="any" value="${escapeHtml(effect.value ?? 0)}"></label>`
      : isTag
        ? `<label class="field"><span>生命週期</span><select name="effectScope">${optionTags(["permanent", "daily", "weekly"], effect.scope || "permanent")}</select></label>`
        : `<label class="checkbox-field"><input name="effectPersistent" type="checkbox" ${effect.persistent ? "checked" : ""}><span>Persistent</span></label>`;
    return `
      <div class="repeat-row effect-row" data-index="${index}">
        <label class="field"><span>類型</span><select name="effectType">${optionTags(["stat", "tag", "bgm", "se"], type)}</select></label>
        <label class="field"><span>${isStat ? "Stat" : isTag ? "Tag" : "資源 ID"}</span>${isStat ? `<select name="effectId">${namedOptionTags(statChoices(), effect.id)}</select>` : `<input name="effectId" value="${escapeHtml(effect.id || "")}">`}</label>
        <label class="field"><span>操作</span><select name="effectOp">${optionTags(opItems, effect.op)}</select></label>
        ${valueField}
        <div></div>
        <button class="row-button" type="button" data-remove-effect="${index}" title="移除 Effect" aria-label="移除 Effect">×</button>
      </div>
    `;
  }).join("");
}

function valueMode(value) {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return "single";
  return "weighted";
}

function weightedRowsHtml(value, kind) {
  const rows = value && typeof value === "object" ? Object.entries(value) : [];
  if (!rows.length) return `<div class="row-empty">尚未加入權重項目。</div>`;
  const choices = kind === "content" ? contentChoices() : nodeChoices();
  return rows.map(([id, weight], index) => `
    <div class="repeat-row weight-row" data-index="${index}">
      <label class="field"><span>${kind === "content" ? "Label" : "Node"}</span><select name="${kind}WeightedId">${namedOptionTags(choices, id)}</select></label>
      <label class="field"><span>Weight</span><input name="${kind}WeightedValue" type="number" min="0.0001" step="any" value="${escapeHtml(weight)}"></label>
      <button class="row-button" type="button" data-remove-weighted="${kind}:${index}" title="移除項目" aria-label="移除項目">×</button>
    </div>
  `).join("");
}

function choiceBlockHtml(value, kind) {
  const mode = valueMode(value);
  const isContent = kind === "content";
  const labels = isContent ? { none: "None", single: "單一 Label", weighted: "權重抽選" } : { none: "None", single: "單一 Node", weighted: "權重抽選" };
  const choices = isContent ? contentChoices() : nodeChoices();
  let detail = "";
  if (mode === "single") {
    detail = `<label class="field"><span>${isContent ? "Content" : "Next Node"}</span><select name="${kind}Single">${namedOptionTags(choices, value)}</select></label>`;
  } else if (mode === "weighted") {
    detail = `
      <div class="repeat-list">${weightedRowsHtml(value, kind)}</div>
      <div style="margin-top:10px"><button class="quiet-button compact" type="button" data-add-weighted="${kind}">＋ 新增項目</button></div>
    `;
  } else {
    detail = `<div class="inline-note">${isContent ? "Content" : "Next Node"}: None</div>`;
  }
  return `
    <div class="mode-row">
      <label class="field"><span>模式</span><select name="${kind}Mode">${Object.entries(labels).map(([key, label]) => `<option value="${key}"${key === mode ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      <div>${detail}</div>
    </div>
  `;
}

function eventEditorHtml(event) {
  return `
    <form class="editor-page" id="eventForm">
      <div class="section-heading">
        <div>
          <span class="section-kicker">EVENT.JSON</span>
          <h2>${escapeHtml(event.Name || event.ID || "新事件")}</h2>
        </div>
        <div class="section-actions">
          ${state.eventOriginalId ? '<button class="danger-button" id="deleteEventButton" type="button">刪除</button>' : ""}
          <button class="primary-button" type="submit">儲存 Event</button>
        </div>
      </div>

      <div class="form-section">
        <div class="form-grid four-columns">
          <label class="field"><span>事件名稱</span><input name="Name" required value="${escapeHtml(event.Name || event.ID || "")}"></label>
          <label class="field"><span>Trigger</span><input name="Trigger" required value="${escapeHtml(event.Trigger || "")}"></label>
          <label class="field"><span>Priority</span><input name="Priority" type="number" min="0" max="5" step="1" value="${escapeHtml(event.Priority ?? 5)}"></label>
          <label class="field"><span>Weight</span><input name="Weight" type="number" min="0.0001" step="any" value="${escapeHtml(event.Weight ?? 1)}"></label>
        </div>
        <input name="ID" type="hidden" value="${escapeHtml(event.ID || "")}">
        <div class="context-kicker" style="margin-top:10px">${escapeHtml(event.ID || "")}</div>
        <label class="checkbox-field" style="margin-top:12px"><input name="Once" type="checkbox" ${event.Once ? "checked" : ""}><span>全遊戲只觸發一次</span></label>
      </div>

      <div class="form-section">
        <div class="form-section-header">
          <div><h3>Conditions</h3></div>
          <button class="quiet-button compact" id="addConditionButton" type="button">＋ 新增條件</button>
        </div>
        <div class="repeat-list" id="conditionList">${conditionRowsHtml(event.Conditions || [])}</div>
      </div>

      <div class="form-section">
        <div class="form-section-header">
          <div><h3>Effects</h3></div>
          <button class="quiet-button compact" id="addEffectButton" type="button">＋ 新增 Effect</button>
        </div>
        <div class="repeat-list" id="effectList">${effectRowsHtml(event.Effects || [])}</div>
      </div>

      <div class="form-section">
        <div class="form-section-header"><div><h3>Content</h3></div></div>
        ${choiceBlockHtml(event.Content, "content")}
      </div>

      <div class="form-section">
        <div class="form-section-header"><div><h3>節點流程</h3></div></div>
        <div class="form-grid two-columns">
          <label class="field"><span>End up</span><select name="EndUp">${optionTags(["REDO", "GOTO", "EXIT"], event["End up"] || "REDO")}</select></label>
        </div>
        <div id="nextNodeBlock" style="margin-top:12px">${event["End up"] === "GOTO" ? choiceBlockHtml(event["Next Node"], "next") : '<div class="inline-note">Next Node: None</div>'}</div>
      </div>
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
  const mode = form.elements[`${kind}Mode`]?.value || "none";
  if (mode === "none") return null;
  if (mode === "single") return form.elements[`${kind}Single`]?.value.trim() || "";
  return readWeighted(form, kind);
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
    return result;
  });
  const effects = [...form.querySelectorAll(".effect-row")].map((row) => {
    const type = row.querySelector('[name="effectType"]').value;
    const result = {
      type,
      id: row.querySelector('[name="effectId"]').value.trim(),
      op: row.querySelector('[name="effectOp"]').value,
    };
    if (type === "stat") result.value = numberValue(row.querySelector('[name="effectValue"]').value);
    if (type === "tag" && result.op === "add") result.scope = row.querySelector('[name="effectScope"]').value;
    if (type === "bgm" || type === "se") result.persistent = row.querySelector('[name="effectPersistent"]').checked;
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
  document.querySelector("#addConditionButton")?.addEventListener("click", () => {
    state.eventDraft = readEventForm();
    state.eventDraft.Conditions.push({ type: "stat", id: "", op: ">=", value: 0 });
    renderEventsPanel();
  });
  document.querySelector("#addEffectButton")?.addEventListener("click", () => {
    state.eventDraft = readEventForm();
    state.eventDraft.Effects.push({ type: "stat", id: "", op: "+", value: 0 });
    renderEventsPanel();
  });
  form.addEventListener("click", (event) => {
    const conditionIndex = event.target.dataset.removeCondition;
    const effectIndex = event.target.dataset.removeEffect;
    const weighted = event.target.dataset.removeWeighted;
    const addWeighted = event.target.dataset.addWeighted;
    if (conditionIndex !== undefined) {
      state.eventDraft = readEventForm();
      state.eventDraft.Conditions.splice(Number(conditionIndex), 1);
      renderEventsPanel();
    } else if (effectIndex !== undefined) {
      state.eventDraft = readEventForm();
      state.eventDraft.Effects.splice(Number(effectIndex), 1);
      renderEventsPanel();
    } else if (weighted) {
      state.eventDraft = readEventForm();
      const [kind, indexText] = weighted.split(":");
      const key = kind === "content" ? "Content" : "Next Node";
      const entries = Object.entries(state.eventDraft[key] || {});
      entries.splice(Number(indexText), 1);
      state.eventDraft[key] = Object.fromEntries(entries);
      renderEventsPanel();
    } else if (addWeighted) {
      state.eventDraft = readEventForm();
      const key = addWeighted === "content" ? "Content" : "Next Node";
      const current = state.eventDraft[key] && typeof state.eventDraft[key] === "object" ? state.eventDraft[key] : {};
      const available = addWeighted === "content" ? contentChoices() : nodeChoices();
      let id = available.find((item) => !Object.hasOwn(current, item.id))?.id || (addWeighted === "content" ? "missingContent" : "missingNode");
      current[id] = 1;
      state.eventDraft[key] = current;
      renderEventsPanel();
    }
  });
  form.addEventListener("change", (event) => {
    if (event.target.name === "conditionType") {
      const index = Number(event.target.closest(".condition-row").dataset.index);
      state.eventDraft = readEventForm();
      state.eventDraft.Conditions[index] = event.target.value === "tag"
        ? { type: "tag", id: "", op: "has" }
        : { type: "stat", id: "", op: ">=", value: 0 };
      renderEventsPanel();
    } else if (event.target.name === "effectType") {
      const index = Number(event.target.closest(".effect-row").dataset.index);
      state.eventDraft = readEventForm();
      const type = event.target.value;
      state.eventDraft.Effects[index] = type === "stat"
        ? { type, id: "", op: "+", value: 0 }
        : type === "tag"
          ? { type, id: "", op: "add", scope: "permanent" }
          : { type, id: "", op: "play", persistent: false };
      renderEventsPanel();
    } else if (event.target.name === "contentMode") {
      state.eventDraft = readEventForm();
      const firstContent = contentChoices()[0]?.id || "missingContent";
      state.eventDraft.Content = event.target.value === "none" ? null : event.target.value === "single" ? firstContent : { [firstContent]: 1 };
      renderEventsPanel();
    } else if (event.target.name === "nextMode") {
      state.eventDraft = readEventForm();
      const firstNode = nodeChoices()[0]?.id || "missingNode";
      state.eventDraft["Next Node"] = event.target.value === "none" ? null : event.target.value === "single" ? firstNode : { [firstNode]: 1 };
      renderEventsPanel();
    } else if (event.target.name === "EndUp") {
      state.eventDraft = readEventForm();
      state.eventDraft["End up"] = event.target.value;
      state.eventDraft["Next Node"] = event.target.value === "GOTO" ? (state.nodes[0]?.id || "") : null;
      renderEventsPanel();
    }
  });
}

function selectEvent(id) {
  const entry = state.nodeDetail.events.find((item) => item.data.ID === id);
  if (!entry) return;
  state.selectedEventId = id;
  state.eventOriginalId = id;
  state.eventDraft = clone(entry.data);
  renderEventsPanel();
}

function createEventDraft() {
  const id = generateId("event");
  state.selectedEventId = null;
  state.eventOriginalId = null;
  state.eventDraft = defaultEvent(id);
  renderEventsPanel();
  document.querySelector('[name="Name"]')?.focus();
}

async function saveEvent(event) {
  event.preventDefault();
  const draft = readEventForm();
  setSaveState("儲存中", "saving");
  try {
    const saved = await api("/api/events", {
      method: "POST",
      body: { node: state.selectedNodePath, originalId: state.eventOriginalId, event: draft },
    });
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
    await api(`/api/events?node=${encodeURIComponent(state.selectedNodePath)}&id=${encodeURIComponent(state.eventOriginalId)}`, { method: "DELETE" });
    state.selectedEventId = null;
    state.eventOriginalId = null;
    state.eventDraft = null;
    await refreshAfterSave();
    toast("Event 已刪除");
  } catch (error) {
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
  setSaveState("尚未儲存", "saving");
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
        <div class="option-stage-grid"></div>
        ${elements.map(optionStageElementHtml).join("")}
      </div>
    </div>
  `;
}

function optionConditionRowsHtml(conditions, scope) {
  if (!conditions?.length) return `<div class="row-empty compact-empty">無條件</div>`;
  return conditions.map((condition, index) => {
    const type = condition.type || "stat";
    const isTag = type === "tag";
    return `
      <div class="option-condition-row" data-option-condition-scope="${escapeHtml(scope)}" data-index="${index}">
        <select data-option-condition-part="type">${optionTags(["stat", "tag"], type)}</select>
        ${isTag
          ? `<input data-option-condition-part="id" value="${escapeHtml(condition.id || "")}" placeholder="Tag">`
          : `<select data-option-condition-part="id">${namedOptionTags(statChoices(), condition.id)}</select>`}
        <select data-option-condition-part="op">${optionTags(isTag ? ["has", "not_has"] : [">", ">=", "<", "<=", "==", "!="], condition.op)}</select>
        <input data-option-condition-part="value" type="number" step="any" value="${escapeHtml(condition.value ?? 0)}" ${isTag ? "disabled" : ""}>
        <button class="row-button" type="button" data-remove-option-condition="${escapeHtml(scope)}:${index}" title="移除條件" aria-label="移除條件">×</button>
      </div>
    `;
  }).join("");
}

function optionConditionSectionHtml(title, conditions, scope) {
  return `
    <div class="option-condition-section">
      <div class="mini-section-heading"><strong>${escapeHtml(title)}</strong><button class="quiet-button compact" type="button" data-add-option-condition="${escapeHtml(scope)}">＋ 新增</button></div>
      <div class="option-condition-list">${optionConditionRowsHtml(conditions || [], scope)}</div>
    </div>
  `;
}

function textBoxItemsHtml(element) {
  const items = element.Items || [];
  return `
    <div class="option-items-list">
      ${items.map((item, index) => `
        <div class="option-item-entry ${item.ID === state.selectedOptionItemId ? "active" : ""}">
          <button type="button" data-option-item-select="${escapeHtml(item.ID)}"><strong>${escapeHtml(item.Name || item.Text || item.ID)}</strong><span>${escapeHtml(item.Trigger || "")}</span></button>
          <div class="option-item-order">
            <button type="button" data-move-option-item="${index}:-1" title="上移" aria-label="上移" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" data-move-option-item="${index}:1" title="下移" aria-label="下移" ${index === items.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </div>
      `).join("") || `<div class="row-empty compact-empty">尚未建立 Item</div>`}
    </div>
  `;
}

function optionInspectorHtml() {
  const element = selectedOptionElement();
  if (!element) {
    return `<div class="option-inspector-empty"><strong>選擇或新增元件</strong></div>`;
  }
  const layout = element.Layout || {};
  const common = `
    <div class="option-inspector-header">
      <div><span class="section-kicker">${escapeHtml(optionTypeLabel(element.Type))}</span><strong>${escapeHtml(element.Name || element.ID)}</strong><small>${escapeHtml(element.ID)}</small></div>
      <button class="danger-icon-button" id="deleteOptionElement" type="button" title="刪除元件" aria-label="刪除元件">×</button>
    </div>
    <div class="inspector-section">
      <label class="field"><span>名稱</span><input data-option-path="Name" value="${escapeHtml(element.Name || "")}"></label>
      <div class="form-grid two-columns compact-grid">
        <label class="field"><span>X</span><input data-option-path="Layout.X" type="number" value="${escapeHtml(layout.X ?? 0)}"></label>
        <label class="field"><span>Y</span><input data-option-path="Layout.Y" type="number" value="${escapeHtml(layout.Y ?? 0)}"></label>
      </div>
      <label class="field"><span>寬度</span><input data-option-path="Layout.Width" type="number" min="24" value="${escapeHtml(layout.Width ?? 100)}"></label>
    </div>
  `;

  let specific = "";
  if (element.Type === "TEXTBOX") {
    const list = element.List || {};
    const style = element.Style || {};
    const item = selectedOptionItem();
    const itemOverride = item?.["Style Override"] || {};
    const hasItemOverride = Object.keys(itemOverride).length > 0;
    specific = `
      <div class="inspector-section">
        <div class="form-grid two-columns compact-grid">
          <label class="field"><span>最多顯示</span><input data-option-path="List.Max Visible Items" type="number" min="1" max="20" value="${escapeHtml(list["Max Visible Items"] ?? 4)}"></label>
          <label class="field"><span>Scrollbar</span><select data-option-path="List.Scrollbar">${optionTags(["AUTO", "HIDDEN", "ALWAYS"], list.Scrollbar || "AUTO")}</select></label>
        </div>
      </div>
      <div class="inspector-section">
        <div class="mini-section-heading"><strong>清單項目</strong><button class="quiet-button compact" id="addOptionItem" type="button">＋ 新增</button></div>
        ${textBoxItemsHtml(element)}
      </div>
      ${item ? `
        <div class="inspector-section selected-item-editor">
          <div class="mini-section-heading"><strong>選項內容</strong><button class="danger-text-button" id="deleteOptionItem" type="button">刪除</button></div>
          <label class="field"><span>名稱</span><input data-option-item-path="Name" value="${escapeHtml(item.Name || "")}"></label>
          <label class="field"><span>顯示文字</span><input data-option-item-path="Text" value="${escapeHtml(item.Text || "")}"></label>
          <label class="field"><span>Trigger</span><input data-option-item-path="Trigger" value="${escapeHtml(item.Trigger || "")}"></label>
        </div>
      ` : ""}
      <details class="advanced-options" ${state.optionAdvancedOpen ? "open" : ""}>
        <summary>進階選項</summary>
        <div class="advanced-options-body">
          <div class="form-grid two-columns compact-grid">
            <label class="field"><span>Item 高度</span><input data-option-path="List.Item Height" type="number" min="24" value="${escapeHtml(list["Item Height"] ?? 72)}"></label>
            <label class="field"><span>Item 間距</span><input data-option-path="List.Item Spacing" type="number" min="0" value="${escapeHtml(list["Item Spacing"] ?? 12)}"></label>
            <label class="field"><span>Padding</span><input data-option-path="List.Padding" type="number" min="0" value="${escapeHtml(list.Padding ?? 16)}"></label>
            <label class="field"><span>Z Order</span><input data-option-path="Layout.Z Order" type="number" value="${escapeHtml(layout["Z Order"] ?? 10)}"></label>
          </div>
          <div class="form-grid two-columns compact-grid">
            <label class="checkbox-field"><input data-option-path="List.Mousewheel" type="checkbox" ${list.Mousewheel !== false ? "checked" : ""}><span>滑鼠滾輪</span></label>
            <label class="checkbox-field"><input data-option-path="List.Draggable" type="checkbox" ${list.Draggable !== false ? "checked" : ""}><span>拖曳滾動</span></label>
          </div>
          <div class="form-grid two-columns compact-grid">
            <label class="field"><span>Scrollbar 寬度</span><input data-option-path="List.Scrollbar Width" type="number" min="4" value="${escapeHtml(list["Scrollbar Width"] ?? 18)}"></label>
            <label class="field"><span>Scrollbar 位置</span><select data-option-path="List.Scrollbar Side">${optionTags(["LEFT", "RIGHT"], list["Scrollbar Side"] || "RIGHT")}</select></label>
            <label class="field"><span>滾動位置</span><select data-option-path="List.Remember Scroll">${optionTags(["RESET", "NODE"], list["Remember Scroll"] || "RESET")}</select></label>
          </div>
          <div class="form-grid two-columns compact-grid color-grid">
            <label class="field"><span>容器背景</span><input data-option-path="Style.Background" type="color" value="${safeColor(style.Background, "#0b1118").slice(0, 7)}"></label>
            <label class="field"><span>Item 背景</span><input data-option-path="Style.Item Background" type="color" value="${safeColor(style["Item Background"]).slice(0, 7)}"></label>
            <label class="field"><span>Hover 背景</span><input data-option-path="Style.Item Hover Background" type="color" value="${safeColor(style["Item Hover Background"], "#2d8068").slice(0, 7)}"></label>
            <label class="field"><span>停用背景</span><input data-option-path="Style.Item Disabled Background" type="color" value="${safeColor(style["Item Disabled Background"], "#29312e").slice(0, 7)}"></label>
            <label class="field"><span>文字顏色</span><input data-option-path="Style.Text Color" type="color" value="${safeColor(style["Text Color"], "#ffffff").slice(0, 7)}"></label>
            <label class="field"><span>Hover 文字</span><input data-option-path="Style.Text Hover Color" type="color" value="${safeColor(style["Text Hover Color"], "#ffffff").slice(0, 7)}"></label>
            <label class="field"><span>停用文字</span><input data-option-path="Style.Text Disabled Color" type="color" value="${safeColor(style["Text Disabled Color"], "#8b948f").slice(0, 7)}"></label>
          </div>
          <div class="form-grid two-columns compact-grid">
            <label class="field"><span>字體大小</span><input data-option-path="Style.Text Size" type="number" min="8" value="${escapeHtml(style["Text Size"] ?? 30)}"></label>
            <label class="field"><span>文字對齊</span><select data-option-path="Style.Text Align">${optionTags([0, 0.5, 1], style["Text Align"] ?? 0.5, (value) => ({ 0: "靠左", 0.5: "置中", 1: "靠右" })[value])}</select></label>
          </div>
          ${optionConditionSectionHtml("容器顯示條件", element["Visible Conditions"], "element-visible")}
          ${optionConditionSectionHtml("容器可用條件", element["Enabled Conditions"], "element-enabled")}
          ${item ? `
            <label class="field"><span>Item Tooltip</span><input data-option-item-path="Tooltip" value="${escapeHtml(item.Tooltip || "")}"></label>
            <label class="field"><span>Item Icon</span><input data-option-item-path="Icon" list="imageAssets" value="${escapeHtml(item.Icon || "")}"></label>
            <label class="checkbox-field"><input id="itemStyleOverrideEnabled" type="checkbox" ${hasItemOverride ? "checked" : ""}><span>覆寫這個 Item 的樣式</span></label>
            ${hasItemOverride ? `
              <div class="form-grid two-columns compact-grid color-grid">
                <label class="field"><span>覆寫背景</span><input data-option-item-path="Style Override.Item Background" type="color" value="${safeColor(itemOverride["Item Background"], style["Item Background"]).slice(0, 7)}"></label>
                <label class="field"><span>覆寫 Hover</span><input data-option-item-path="Style Override.Item Hover Background" type="color" value="${safeColor(itemOverride["Item Hover Background"], style["Item Hover Background"]).slice(0, 7)}"></label>
                <label class="field"><span>覆寫文字</span><input data-option-item-path="Style Override.Text Color" type="color" value="${safeColor(itemOverride["Text Color"], style["Text Color"]).slice(0, 7)}"></label>
              </div>
              <div class="form-grid two-columns compact-grid">
                <label class="field"><span>覆寫字體大小</span><input data-option-item-path="Style Override.Text Size" type="number" min="8" value="${escapeHtml(itemOverride["Text Size"] ?? style["Text Size"] ?? 30)}"></label>
                <label class="field"><span>覆寫文字對齊</span><select data-option-item-path="Style Override.Text Align">${optionTags([0, 0.5, 1], itemOverride["Text Align"] ?? style["Text Align"] ?? 0.5, (value) => ({ 0: "靠左", 0.5: "置中", 1: "靠右" })[value])}</select></label>
              </div>
            ` : ""}
            ${optionConditionSectionHtml("Item 顯示條件", item["Visible Conditions"], "item-visible")}
            ${optionConditionSectionHtml("Item 可用條件", item["Enabled Conditions"], "item-enabled")}
          ` : ""}
        </div>
      </details>
    `;
  } else if (element.Type === "PICTURE") {
    const picture = element.Picture || {};
    specific = `
      <div class="inspector-section">
        <label class="field"><span>Idle 圖片</span><input data-option-path="Picture.Idle" list="imageAssets" value="${escapeHtml(picture.Idle || "")}"></label>
        <label class="field"><span>Hover 圖片</span><input data-option-path="Picture.Hover" list="imageAssets" value="${escapeHtml(picture.Hover || "")}"></label>
        <label class="field"><span>Trigger</span><input data-option-path="Trigger" value="${escapeHtml(element.Trigger || "")}"></label>
        <div class="form-grid two-columns compact-grid">
          <label class="field"><span>寬度</span><input data-option-path="Layout.Width" type="number" min="24" value="${escapeHtml(layout.Width ?? 180)}"></label>
          <label class="field"><span>高度</span><input data-option-path="Layout.Height" type="number" min="24" value="${escapeHtml(layout.Height ?? 180)}"></label>
        </div>
      </div>
      <details class="advanced-options" ${state.optionAdvancedOpen ? "open" : ""}>
        <summary>進階選項</summary>
        <div class="advanced-options-body">
          <label class="field"><span>Pressed 圖片</span><input data-option-path="Picture.Pressed" list="imageAssets" value="${escapeHtml(picture.Pressed || "")}"></label>
          <label class="field"><span>Disabled 圖片</span><input data-option-path="Picture.Disabled" list="imageAssets" value="${escapeHtml(picture.Disabled || "")}"></label>
          <div class="form-grid two-columns compact-grid">
            <label class="field"><span>圖片填充</span><select data-option-path="Picture.Fit">${optionTags(["CONTAIN", "COVER", "STRETCH"], picture.Fit || "CONTAIN")}</select></label>
            <label class="field"><span>Z Order</span><input data-option-path="Layout.Z Order" type="number" value="${escapeHtml(layout["Z Order"] ?? 10)}"></label>
          </div>
          <label class="checkbox-field"><input data-option-path="Picture.Keep Aspect" type="checkbox" ${picture["Keep Aspect"] !== false ? "checked" : ""}><span>保持長寬比</span></label>
          <label class="checkbox-field"><input data-option-path="Picture.Alpha Hit Test" type="checkbox" ${picture["Alpha Hit Test"] ? "checked" : ""}><span>只讓不透明部分可點擊</span></label>
          <label class="field"><span>Opacity</span><input data-option-path="Picture.Opacity" type="range" min="0" max="1" step="0.05" value="${escapeHtml(picture.Opacity ?? 1)}"></label>
          <label class="field"><span>Hover Scale</span><input data-option-path="Picture.Hover Scale" type="number" min="0.1" max="5" step="0.05" value="${escapeHtml(picture["Hover Scale"] ?? 1)}"></label>
          <label class="field"><span>Tint</span><input data-option-path="Picture.Tint" type="color" value="${safeColor(picture.Tint, "#ffffff").slice(0, 7)}"></label>
          <label class="field"><span>Tooltip</span><input data-option-path="Tooltip" value="${escapeHtml(element.Tooltip || "")}"></label>
          <label class="field"><span>Hover Sound</span><input data-option-path="Hover Sound" value="${escapeHtml(element["Hover Sound"] || "")}"></label>
          <label class="field"><span>Click Sound</span><input data-option-path="Click Sound" value="${escapeHtml(element["Click Sound"] || "")}"></label>
          ${optionConditionSectionHtml("顯示條件", element["Visible Conditions"], "element-visible")}
          ${optionConditionSectionHtml("可用條件", element["Enabled Conditions"], "element-enabled")}
        </div>
      </details>
    `;
  } else {
    const hitbox = element.Hitbox || {};
    specific = `
      <div class="inspector-section">
        <label class="field"><span>Trigger</span><input data-option-path="Trigger" value="${escapeHtml(element.Trigger || "")}"></label>
        <div class="form-grid two-columns compact-grid">
          <label class="field"><span>寬度</span><input data-option-path="Layout.Width" type="number" min="24" value="${escapeHtml(layout.Width ?? 180)}"></label>
          <label class="field"><span>高度</span><input data-option-path="Layout.Height" type="number" min="24" value="${escapeHtml(layout.Height ?? 180)}"></label>
        </div>
      </div>
      <details class="advanced-options" ${state.optionAdvancedOpen ? "open" : ""}>
        <summary>進階選項</summary>
        <div class="advanced-options-body">
          <div class="form-grid two-columns compact-grid">
            <label class="field"><span>編輯器顏色</span><input data-option-path="Hitbox.Editor Color" type="color" value="${safeColor(hitbox["Editor Color"], "#28a47d").slice(0, 7)}"></label>
            <label class="field"><span>Z Order</span><input data-option-path="Layout.Z Order" type="number" value="${escapeHtml(layout["Z Order"] ?? 10)}"></label>
          </div>
          <label class="field"><span>預覽透明度</span><input data-option-path="Hitbox.Editor Opacity" type="range" min="0" max="1" step="0.05" value="${escapeHtml(hitbox["Editor Opacity"] ?? 0.24)}"></label>
          <label class="field"><span>Hover 圖片</span><input data-option-path="Hitbox.Hover Image" list="imageAssets" value="${escapeHtml(hitbox["Hover Image"] || "")}"></label>
          <label class="field"><span>Tooltip</span><input data-option-path="Tooltip" value="${escapeHtml(element.Tooltip || "")}"></label>
          <label class="field"><span>Cursor</span><input data-option-path="Hitbox.Cursor" value="${escapeHtml(hitbox.Cursor || "pointer")}"></label>
          <label class="field"><span>Hover Sound</span><input data-option-path="Hover Sound" value="${escapeHtml(element["Hover Sound"] || "")}"></label>
          <label class="field"><span>Click Sound</span><input data-option-path="Click Sound" value="${escapeHtml(element["Click Sound"] || "")}"></label>
          ${optionConditionSectionHtml("顯示條件", element["Visible Conditions"], "element-visible")}
          ${optionConditionSectionHtml("可用條件", element["Enabled Conditions"], "element-enabled")}
        </div>
      </details>
    `;
  }
  return common + specific + `
    <details class="advanced-options custom-rpy-options">
      <summary>自訂 SCENEOPTION.rpy</summary>
      <div class="advanced-options-body">
        <label class="field"><span>選項模式</span><select id="optionMode">${optionTags(["DATA", "CUSTOM"], state.nodeDetail.node["Option Mode"] || "DATA", (value) => value === "DATA" ? "資料化選項" : "自訂 RPY")}</select></label>
        <label class="field"><span>Custom Screen</span><input id="customOptionScreen" value="${escapeHtml(customOptionScreenName())}" placeholder="scene_option_custom"></label>
        <textarea class="raw-option-editor" id="optionEditor" spellcheck="false">${escapeHtml(state.nodeDetail.optionSource || "")}</textarea>
      </div>
    </details>
  `;
}

function renderOptionsPanel() {
  if (!state.nodeDetail) {
    dom.optionsPanel.innerHTML = "";
    return;
  }
  if (!state.optionsDraft) state.optionsDraft = clone(state.nodeDetail.options || defaultOptionsDraft());
  const canvas = state.optionsDraft.Canvas || {};
  dom.optionsPanel.innerHTML = `
    <div class="option-builder">
      <aside class="option-element-sidebar">
        <div class="subnav-header"><strong>OPTION ELEMENTS</strong></div>
        <div class="option-add-buttons">
          <button class="quiet-button compact" type="button" data-add-option-element="TEXTBOX">Text Box</button>
          <button class="quiet-button compact" type="button" data-add-option-element="PICTURE">Picture</button>
          <button class="quiet-button compact" type="button" data-add-option-element="HITBOX">Hitbox</button>
        </div>
        <div class="subnav-list">${optionElementListHtml()}</div>
      </aside>
      <section class="option-canvas-column">
        <div class="option-builder-toolbar">
          <label class="field inline-field"><span>預覽底圖</span><input data-canvas-path="Preview Background" list="imageAssets" value="${escapeHtml(canvas["Preview Background"] || "")}" placeholder="images/room.png"></label>
          <span class="canvas-size-label">${escapeHtml(canvas.Width || 1920)} × ${escapeHtml(canvas.Height || 1080)}</span>
          <button class="primary-button compact" id="saveOptionsButton" type="button">儲存選項</button>
        </div>
        <div class="option-canvas-scroll">${optionStageHtml()}</div>
      </section>
      <aside class="option-inspector">${optionInspectorHtml()}</aside>
    </div>
  `;
  bindOptionsPanel();
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

function deleteOptionItem() {
  const element = selectedOptionElement();
  const item = selectedOptionItem();
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
  setNested(target, path, controlValue(control));
  if (target.Type === "TEXTBOX") target.Layout.Height = textBoxMetrics(target).height;
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
    if (control.value === "tag") {
      condition.id = "";
      condition.op = "has";
      delete condition.value;
    } else {
      condition.id = statChoices()[0]?.id || "";
      condition.op = ">=";
      condition.value = 0;
    }
    renderOptionsPanel();
  } else {
    markOptionsDirty();
  }
}

function bindOptionsPanel() {
  document.querySelector("#saveOptionsButton")?.addEventListener("click", saveOptions);
  document.querySelectorAll("[data-add-option-element]").forEach((button) => button.addEventListener("click", () => addOptionElement(button.dataset.addOptionElement)));
  document.querySelectorAll("[data-option-element-select]").forEach((button) => button.addEventListener("click", () => {
    state.selectedOptionElementId = button.dataset.optionElementSelect;
    state.selectedOptionItemId = selectedOptionElement()?.Items?.[0]?.ID || null;
    renderOptionsPanel();
  }));
  document.querySelector("#deleteOptionElement")?.addEventListener("click", deleteOptionElement);
  document.querySelector("#addOptionItem")?.addEventListener("click", addOptionItem);
  document.querySelector("#deleteOptionItem")?.addEventListener("click", deleteOptionItem);
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
    state.optionAdvancedOpen = true;
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
    conditions.push({ type: "stat", id: statChoices()[0]?.id || "", op: ">=", value: 0 });
    state.optionAdvancedOpen = true;
    markOptionsDirty();
    renderOptionsPanel();
  }));
  document.querySelectorAll("[data-remove-option-condition]").forEach((button) => button.addEventListener("click", () => {
    const [scope, rawIndex] = button.dataset.removeOptionCondition.split(":");
    optionConditionTarget(scope)?.splice(Number(rawIndex), 1);
    state.optionAdvancedOpen = true;
    markOptionsDirty();
    renderOptionsPanel();
  }));

  dom.optionsPanel.querySelectorAll("[data-option-path]").forEach((control) => {
    control.addEventListener("input", () => updateOptionField(control));
  });
  dom.optionsPanel.querySelectorAll("[data-option-item-path]").forEach((control) => {
    control.addEventListener("input", () => updateOptionField(control, true));
  });
  dom.optionsPanel.querySelectorAll("[data-option-condition-part]").forEach((control) => {
    control.addEventListener("change", () => updateConditionControl(control));
    if (control.dataset.optionConditionPart === "value") control.addEventListener("input", () => updateConditionControl(control));
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
  document.querySelectorAll("details.advanced-options").forEach((details) => details.addEventListener("toggle", () => {
    if (!details.classList.contains("custom-rpy-options")) state.optionAdvancedOpen = details.open;
  }));
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
      layout.X = Math.round(Math.max(0, Math.min(canvasWidth - layout.Width, start.layout.X + dx)));
      layout.Y = Math.round(Math.max(0, Math.min(canvasHeight - height, start.layout.Y + dy)));
    } else {
      if (direction.includes("e")) layout.Width = Math.round(Math.max(24, start.layout.Width + dx));
      if (direction.includes("w")) {
        layout.Width = Math.round(Math.max(24, start.layout.Width - dx));
        layout.X = Math.round(start.layout.X + start.layout.Width - layout.Width);
      }
      if (element.Type === "TEXTBOX" && (direction.includes("n") || direction.includes("s"))) {
        const metrics = textBoxMetrics(element, true);
        const startHeight = start.maxVisible * metrics.itemHeight + Math.max(0, start.maxVisible - 1) * metrics.spacing + metrics.padding * 2;
        const desired = direction.includes("s") ? startHeight + dy : startHeight - dy;
        const rows = Math.max(1, Math.min(20, Math.round((desired - metrics.padding * 2 + metrics.spacing) / (metrics.itemHeight + metrics.spacing))));
        element.List["Max Visible Items"] = rows;
        layout.Height = textBoxMetrics(element).height;
        if (direction.includes("n")) layout.Y = Math.round(start.layout.Y + startHeight - textBoxMetrics(element, true).height);
      } else if (element.Type !== "TEXTBOX") {
        if (direction.includes("s")) layout.Height = Math.round(Math.max(24, start.layout.Height + dy));
        if (direction.includes("n")) {
          layout.Height = Math.round(Math.max(24, start.layout.Height - dy));
          layout.Y = Math.round(start.layout.Y + start.layout.Height - layout.Height);
        }
      }
    }
    moved = true;
    markOptionsDirty();
    refreshOptionStage();
    document.querySelectorAll("[data-option-path]").forEach((control) => {
      const value = getNested(element, control.dataset.optionPath);
      if (value !== undefined && control.type !== "checkbox" && document.activeElement !== control) control.value = value;
    });
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (moved || !node.classList.contains("selected")) renderOptionsPanel();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
}

async function saveOptions() {
  const source = state.nodeDetail?.optionSource || "";
  const mode = state.nodeDetail?.node?.["Option Mode"] || "DATA";
  const customScreen = state.nodeDetail?.node?.["Option Screen"] || "";
  setSaveState("儲存中", "saving");
  try {
    const saved = await api("/api/options", {
      method: "PUT",
      body: {
        node: state.selectedNodePath,
        options: state.optionsDraft,
        source,
        optionMode: mode,
        optionScreen: mode === "DATA" ? "scene_option_renderer" : customScreen,
      },
    });
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
    <div class="file-workspace">
      <aside class="subnav">
        <div class="subnav-header"><strong>CONTENT</strong><button class="icon-button" id="newContentButton" type="button" title="新增 Content" aria-label="新增 Content">＋</button></div>
        <div class="subnav-list">${fileListHtml(files, state.selectedContent, "content-file")}</div>
      </aside>
      <div class="editor-scroll">
        ${state.selectedContent ? `
          <div class="code-toolbar">
            <label class="field" style="width:min(320px,60%)"><span class="visually-hidden">Content 名稱</span><input id="contentDisplayName" value="${escapeHtml(state.selectedContentDisplayName || state.selectedContent)}"></label>
            <div class="section-actions">
              <button class="danger-button compact" id="deleteContentButton" type="button">刪除</button>
              <button class="primary-button compact" id="saveContentButton" type="button">儲存演出</button>
            </div>
          </div>
          <div class="code-editor-wrap"><textarea class="code-editor" id="contentEditor" spellcheck="false">${escapeHtml(state.contentSource)}</textarea></div>
        ` : `<div class="editor-empty"><div><p>選擇或新增 Content 文件。</p><button class="primary-button" id="emptyNewContentButton" type="button">新增 Content</button></div></div>`}
      </div>
    </div>
  `;
  document.querySelectorAll("[data-content-file]").forEach((button) => button.addEventListener("click", () => loadContent(button.dataset.contentFile)));
  document.querySelector("#newContentButton")?.addEventListener("click", () => openNameDialog("content"));
  document.querySelector("#emptyNewContentButton")?.addEventListener("click", () => openNameDialog("content"));
  document.querySelector("#saveContentButton")?.addEventListener("click", saveContent);
  document.querySelector("#deleteContentButton")?.addEventListener("click", deleteContent);
}

async function loadContent(name, rerender = true) {
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

async function saveContent() {
  const displayName = document.querySelector("#contentDisplayName")?.value.trim();
  const source = document.querySelector("#contentEditor")?.value || "";
  try {
    const saved = await api("/api/content", {
      method: "POST",
      body: { node: state.selectedNodePath, originalName: state.selectedContent, id: state.selectedContent, displayName, source },
    });
    state.selectedContent = saved.name;
    state.selectedContentDisplayName = saved.displayName;
    await refreshAfterSave();
    await loadContent(saved.name);
    toast("Content 已儲存");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteContent() {
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
    <div class="file-workspace">
      <aside class="subnav">
        <div class="subnav-header"><strong>SCENESCREEN</strong><button class="icon-button" id="newScreenButton" type="button" title="新增 Scene Screen" aria-label="新增 Scene Screen">＋</button></div>
        <div class="subnav-list">${fileListHtml(files, state.selectedScreen, "screen-file")}</div>
      </aside>
      <div class="editor-scroll">
        ${state.selectedScreen ? `
          <div class="code-toolbar">
            <label class="field" style="width:min(320px,60%)"><span class="visually-hidden">Scene Screen 名稱</span><input id="screenDisplayName" value="${escapeHtml(state.selectedScreenDisplayName || state.selectedScreen)}"></label>
            <div class="section-actions">
              <button class="danger-button compact" id="deleteScreenButton" type="button">刪除</button>
              <button class="primary-button compact" id="saveScreenButton" type="button">儲存畫面</button>
            </div>
          </div>
          <div class="code-editor-wrap"><textarea class="code-editor" id="screenEditor" spellcheck="false">${escapeHtml(state.screenSource)}</textarea></div>
        ` : `<div class="editor-empty"><div><p>選擇或新增 Scene Screen 文件。</p><button class="primary-button" id="emptyNewScreenButton" type="button">新增 Scene Screen</button></div></div>`}
      </div>
    </div>
  `;
  document.querySelectorAll("[data-screen-file]").forEach((button) => button.addEventListener("click", () => loadScreen(button.dataset.screenFile)));
  document.querySelector("#newScreenButton")?.addEventListener("click", () => openNameDialog("screen"));
  document.querySelector("#emptyNewScreenButton")?.addEventListener("click", () => openNameDialog("screen"));
  document.querySelector("#saveScreenButton")?.addEventListener("click", saveScreen);
  document.querySelector("#deleteScreenButton")?.addEventListener("click", deleteScreen);
}

async function loadScreen(name) {
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

async function saveScreen() {
  const displayName = document.querySelector("#screenDisplayName")?.value.trim();
  const source = document.querySelector("#screenEditor")?.value || "";
  try {
    const saved = await api("/api/screens", {
      method: "POST",
      body: { originalName: state.selectedScreen, id: state.selectedScreen, displayName, source },
    });
    state.selectedScreen = saved.name;
    state.selectedScreenDisplayName = saved.displayName;
    await refreshAfterSave();
    await loadScreen(saved.name);
    toast("Scene Screen 已儲存");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteScreen() {
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
  if (!entries.length) return `<tr><td colspan="6"><div class="row-empty">尚未建立 Stat。</div></td></tr>`;
  return entries.map(([id, values], index) => `
    <tr class="stat-row" data-stat-index="${index}" data-stat-id="${escapeHtml(id)}">
      <td><input name="statName" value="${escapeHtml(values.Name || id)}"></td>
      <td><span class="issue-location" title="${escapeHtml(id)}">${escapeHtml(id)}</span></td>
      <td><input name="statMin" type="number" step="any" value="${escapeHtml(values.Min)}"></td>
      <td><input name="statInit" type="number" step="any" value="${escapeHtml(values.Init)}"></td>
      <td><input name="statMax" type="number" step="any" value="${escapeHtml(values.Max)}"></td>
      <td class="action-cell"><button class="row-button" type="button" data-remove-stat="${index}" title="移除 Stat" aria-label="移除 Stat">×</button></td>
    </tr>
  `).join("");
}

function renderStatsPanel() {
  dom.statsPanel.innerHTML = `
    <div class="panel-page wide">
      <div class="section-heading">
        <div><span class="section-kicker">DATA/STATS.JSON</span><h2>全域數值</h2></div>
        <div class="section-actions"><button class="quiet-button" id="addStatButton" type="button">＋ 新增 Stat</button><button class="primary-button" id="saveStatsButton" type="button">儲存數值</button></div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>名稱</th><th>技術 ID</th><th>Min</th><th>Init</th><th>Max</th><th></th></tr></thead>
          <tbody id="statsBody">${statsRowsHtml()}</tbody>
        </table>
      </div>
    </div>
  `;
  document.querySelector("#addStatButton")?.addEventListener("click", addStat);
  document.querySelector("#saveStatsButton")?.addEventListener("click", saveStats);
  document.querySelectorAll("[data-remove-stat]").forEach((button) => button.addEventListener("click", () => removeStat(Number(button.dataset.removeStat))));
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

function addStat() {
  state.statsDraft = readStatsForm();
  const id = generateId("stat");
  state.statsDraft[id] = { Name: "新數值", Min: 0, Init: 0, Max: 100 };
  renderStatsPanel();
  const inputs = document.querySelectorAll('[name="statName"]');
  inputs[inputs.length - 1]?.select();
}

function removeStat(index) {
  state.statsDraft = readStatsForm();
  const entries = Object.entries(state.statsDraft);
  entries.splice(index, 1);
  state.statsDraft = Object.fromEntries(entries);
  renderStatsPanel();
}

async function saveStats() {
  const stats = readStatsForm();
  setSaveState("儲存中", "saving");
  try {
    const data = await api("/api/stats", { method: "PUT", body: { stats } });
    state.stats = data.stats;
    state.statsDraft = clone(data.stats);
    await refreshAfterSave();
    toast("Stats 已儲存");
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

function openSidebar() {
  document.body.classList.add("sidebar-open");
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

function bindGlobalEvents() {
  document.querySelector("#newNodeButton").addEventListener("click", openNodeDialog);
  document.querySelector("#emptyNewNodeButton").addEventListener("click", openNodeDialog);
  document.querySelector("#refreshProject").addEventListener("click", () => loadProject());
  document.querySelector("#validateButton").addEventListener("click", async () => { switchTab("validation"); await runValidation(); });
  dom.nodeSearch.addEventListener("input", renderNodeList);
  dom.nodeList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-node-path]");
    if (button) selectNode(button.dataset.nodePath);
  });
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  document.querySelector("#openSidebar").addEventListener("click", openSidebar);
  document.querySelector("#closeSidebar").addEventListener("click", closeSidebar);
  document.querySelector("#sidebarScrim").addEventListener("click", closeSidebar);

  dom.nodeDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      dom.nodeDialog.close();
      return;
    }
    createNodeFromDialog();
  });

  dom.nameDialogForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      dom.nameDialog.close();
      return;
    }
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && event.target.matches("textarea.code-editor")) {
      event.preventDefault();
      const editor = event.target;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.setRangeText("    ", start, end, "end");
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
      event.preventDefault();
      const active = state.activeTab;
      if (active === "node") document.querySelector("#nodeForm")?.requestSubmit();
      if (active === "events") document.querySelector("#eventForm")?.requestSubmit();
      if (active === "options") saveOptions();
      if (active === "content" && state.selectedContent) saveContent();
      if (active === "screens" && state.selectedScreen) saveScreen();
      if (active === "stats") saveStats();
    }
  });
}

async function init() {
  bindGlobalEvents();
  await loadProject();
}

init();
