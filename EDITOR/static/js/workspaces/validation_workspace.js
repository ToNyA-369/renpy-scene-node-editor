"use strict";

(function exposeValidationWorkspace(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneValidationWorkspace = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function defaultEscapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function issueCounts(issues = []) {
    const values = Array.isArray(issues) ? issues : [];
    const errors = values.filter((issue) => issue?.level === "error").length;
    return { errors, warnings: values.length - errors };
  }

  function renderHtml({ issues = [], t = (value) => value, escapeHtml = defaultEscapeHtml } = {}) {
    const values = Array.isArray(issues) ? issues : [];
    const { errors, warnings } = issueCounts(values);
    return `
      <div class="panel-page wide">
        <div class="section-heading">
          <div><span class="section-kicker">PROJECT CHECK</span><h2>${t("專案檢查")}</h2><p>${t("{errors} 個錯誤，{warnings} 個提醒。", { errors, warnings })}</p></div>
          <div class="section-actions"><button class="primary-button" id="runValidationButton" type="button">${t("重新檢查")}</button></div>
        </div>
        ${values.length ? `
          <div class="validation-list">${values.map((issue) => `
            <div class="issue-row ${escapeHtml(issue.level)}">
              <span class="issue-level">${issue.level === "error" ? t("錯誤") : t("提醒")}</span>
              <span class="issue-location" title="${escapeHtml(issue.location)}">${escapeHtml(issue.location)}</span>
              <span class="issue-message">${escapeHtml(issue.message)}</span>
            </div>
          `).join("")}</div>
        ` : `<div class="success-state">${t("未發現專案問題")}</div>`}
      </div>
    `;
  }

  function createController({
    panel,
    getIssues = () => [],
    setIssues = () => {},
    flush = async () => true,
    api = async () => ({ issues: [] }),
    onIssuesChange = () => {},
    toast = () => {},
    t = (value) => value,
    escapeHtml = defaultEscapeHtml,
  } = {}) {
    if (!panel) throw new TypeError("Validation workspace requires a panel.");

    function render() {
      panel.innerHTML = renderHtml({ issues: getIssues(), t, escapeHtml });
      panel.querySelector("#runValidationButton")?.addEventListener("click", run);
    }

    async function run() {
      if (!await flush()) return false;
      try {
        const data = await api("/api/validate");
        const issues = data.issues || [];
        setIssues(issues);
        onIssuesChange(issues);
        render();
        toast(issues.length ? t("找到 {count} 個項目", { count: issues.length }) : t("專案檢查通過"));
        return true;
      } catch (error) {
        toast(error.message, "error");
        return false;
      }
    }

    return Object.freeze({ render, run });
  }

  return Object.freeze({ createController, issueCounts, renderHtml });
});
