"use strict";

(function exposeNodeWorkspace(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneNodeWorkspace = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function defaultEscapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function groupConnections(items = [], direction = "out") {
    const grouped = new Map();
    items.forEach((edge) => {
      const relatedNode = direction === "out" ? edge.target : edge.source;
      const endUp = edge.endUp || "GOTO";
      const key = `${relatedNode}\u0000${endUp}`;
      if (!grouped.has(key)) grouped.set(key, { relatedNode, endUp, count: 0 });
      grouped.get(key).count += 1;
    });
    return [...grouped.values()];
  }

  function registeredMemoryTags(events = [], memories = {}) {
    const banks = new Map();
    events.forEach((event) => {
      (event?.Effects || []).forEach((effect) => {
        const type = String(effect?.type || "").toLocaleLowerCase();
        const operation = String(effect?.op || "").toLocaleLowerCase();
        const tagId = String(effect?.id || "").trim();
        if (!["memory", "tag"].includes(type) || operation !== "add" || !tagId) return;
        const bankId = String(effect.bank || "memory").trim() || "memory";
        if (!banks.has(bankId)) {
          banks.set(bankId, {
            id: bankId,
            name: String(memories?.[bankId]?.Name || bankId),
            tags: [],
            tagIds: new Set(),
          });
        }
        const bank = banks.get(bankId);
        if (bank.tagIds.has(tagId)) return;
        bank.tagIds.add(tagId);
        bank.tags.push(tagId);
      });
    });
    return [...banks.values()].map(({ tagIds: _tagIds, ...bank }) => bank);
  }

  function createViewModel({
    detail,
    rootNodeId = null,
    globalNode = null,
    nodes = [],
    graph = { edges: [] },
    memories = {},
    isGlobal = false,
  } = {}) {
    if (!detail?.node) return null;
    const node = detail.node;
    const isRoot = node.ID === rootNodeId;
    const events = (detail.events || []).map((entry) => entry.data || {});
    const edges = graph?.edges || [];
    const outgoing = edges.filter((edge) => String(edge.source) === String(node.ID));
    const incoming = edges.filter((edge) => String(edge.target) === String(node.ID));
    const incomingConnections = groupConnections(incoming, "in");
    const outgoingConnections = groupConnections(outgoing, "out");
    const nodeName = (nodeId) => (
      String(globalNode?.id) === String(nodeId)
        ? globalNode.name
        : nodes.find((item) => String(item.id) === String(nodeId))?.name
    ) || nodeId;
    return {
      node,
      isGlobal: Boolean(isGlobal),
      isRoot,
      eventCount: events.length,
      optionsCount: detail.options?.Elements?.length || 0,
      labelCount: (detail.contents || []).reduce((total, content) => total + (content.labels?.length || 0), 0),
      flowLinkCount: outgoingConnections.length,
      incomingConnections: incomingConnections.map((connection) => ({ ...connection, name: nodeName(connection.relatedNode) })),
      outgoingConnections: outgoingConnections.map((connection) => ({ ...connection, name: nodeName(connection.relatedNode) })),
      registeredMemoryTags: registeredMemoryTags(events, memories),
      lifecycle: {
        enter: events.filter((event) => event.Trigger === "Auto:Enter").length,
        node: events.filter((event) => event.Trigger === "Auto:Node").length,
        exit: events.filter((event) => event.Trigger === "Auto:Exit").length,
      },
    };
  }

  function renderHtml(model, { t = (value) => value, escapeHtml = defaultEscapeHtml } = {}) {
    if (!model) return "";
    const { node, isGlobal, isRoot } = model;
    const connectionChips = (items) => {
      if (!items.length) return '<span class="node-flow-empty">None</span>';
      return items.map((connection) => `
        <span class="node-flow-chip is-${String(connection.endUp).toLocaleLowerCase()}">
          ${escapeHtml(connection.name)}
          <small>${escapeHtml(connection.endUp)}${connection.count > 1 ? ` ×${connection.count}` : ""}</small>
        </span>
      `).join("");
    };
    const memoryTags = model.registeredMemoryTags.length
      ? model.registeredMemoryTags.map((bank) => `
        <section class="node-memory-bank">
          <header><strong>${escapeHtml(bank.name)}</strong></header>
          <div>${bank.tags.map((tag) => `<span class="node-memory-tag">${escapeHtml(tag)}</span>`).join("")}</div>
        </section>
      `).join("")
      : `<span class="node-flow-empty">${escapeHtml(t("尚未註冊 Memory Tag"))}</span>`;
    return `
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
              <article><span>Events</span><strong>${model.eventCount}</strong></article>
              <article><span>Options</span><strong>${model.optionsCount}</strong></article>
              <article><span>Content Labels</span><strong>${model.labelCount}</strong></article>
              <article><span>Flow Links</span><strong>${model.flowLinkCount}</strong></article>
            </div>
            <div class="node-overview-details">
              <article class="node-overview-card">
                <header><span>FLOW</span><strong>${isGlobal ? "Contextual Transitions" : "Node Connections"}</strong></header>
                <div class="node-flow-row">
                  <span>Incoming</span>
                  <div>${connectionChips(model.incomingConnections)}</div>
                </div>
                <div class="node-flow-row">
                  <span>Outgoing</span>
                  <div>${connectionChips(model.outgoingConnections)}</div>
                </div>
              </article>
              <article class="node-overview-card">
                <header><span>LIFECYCLE</span><strong>Event Phases</strong></header>
                <div class="node-lifecycle-grid">
                  <div><span>On Enter</span><strong>${model.lifecycle.enter}</strong></div>
                  <div><span>On Node</span><strong>${model.lifecycle.node}</strong></div>
                  <div><span>On Exit</span><strong>${model.lifecycle.exit}</strong></div>
                </div>
              </article>
              <article class="node-overview-card node-memory-card">
                <header><span>MEMORY</span><strong>Registered Tags</strong></header>
                <div class="node-memory-bank-list">${memoryTags}</div>
              </article>
            </div>
          </section>

          ${isGlobal ? "" : `<div class="editor-danger-zone">
            <button class="danger-button" id="deleteNodeButton" type="button" ${isRoot ? `disabled title="${escapeHtml(t("請先將其他節點設為起始節點"))}"` : ""}>${escapeHtml(t("刪除節點"))}</button>
          </div>`}
        </div>
      </div>
    `;
  }

  function createController({
    panel,
    t = (value) => value,
    escapeHtml = defaultEscapeHtml,
    onSubmit = () => {},
    onAutosave = () => {},
    onSetRoot = () => {},
    onDelete = () => {},
  } = {}) {
    if (!panel) throw new TypeError("Node workspace requires a panel.");

    function render(context) {
      const model = createViewModel(context);
      panel.innerHTML = renderHtml(model, { t, escapeHtml });
      if (!model) return;
      const form = panel.querySelector("#nodeForm");
      form?.addEventListener("submit", onSubmit);
      form?.addEventListener("input", onAutosave);
      form?.addEventListener("change", onAutosave);
      panel.querySelector("#setRootNodeButton")?.addEventListener("click", onSetRoot);
      panel.querySelector("#deleteNodeButton")?.addEventListener("click", onDelete);
    }

    return Object.freeze({ render });
  }

  return Object.freeze({ createController, createViewModel, groupConnections, registeredMemoryTags, renderHtml });
});
