"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createController,
  issueCounts,
  renderHtml,
} = require("../../EDITOR/static/js/workspaces/validation_workspace.js");

function translator(value, values = {}) {
  return String(value).replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? `{${key}}`));
}

test("validation summary separates errors from reminders", () => {
  assert.deepEqual(issueCounts([
    { level: "error" },
    { level: "warning" },
    { level: "notice" },
  ]), { errors: 1, warnings: 2 });
  assert.deepEqual(issueCounts(null), { errors: 0, warnings: 0 });
});

test("validation markup preserves status hierarchy and escapes project data", () => {
  const html = renderHtml({
    issues: [{ level: "error", location: "<node>", message: "bad & unsafe" }],
    t: translator,
  });
  assert.match(html, /1 個錯誤，0 個提醒/);
  assert.match(html, /issue-row error/);
  assert.match(html, /&lt;node&gt;/);
  assert.match(html, /bad &amp; unsafe/);
  assert.doesNotMatch(renderHtml({ t: translator }), /validation-list/);
  assert.match(renderHtml({ t: translator }), /success-state/);
});

test("validation controller flushes before reading and publishes one refreshed result", async () => {
  const calls = [];
  let issues = [];
  let clickHandler;
  const panel = {
    innerHTML: "",
    querySelector() {
      return { addEventListener: (_type, handler) => { clickHandler = handler; } };
    },
  };
  const controller = createController({
    panel,
    getIssues: () => issues,
    setIssues: (next) => { calls.push("set"); issues = next; },
    flush: async () => { calls.push("flush"); return true; },
    api: async (path) => { calls.push(path); return { issues: [{ level: "warning", location: "Node", message: "Check" }] }; },
    onIssuesChange: () => calls.push("header"),
    toast: (message, kind = "") => calls.push(`toast:${kind}:${message}`),
    t: translator,
  });

  controller.render();
  assert.equal(typeof clickHandler, "function");
  assert.equal(await controller.run(), true);
  assert.deepEqual(calls, ["flush", "/api/validate", "set", "header", "toast::找到 1 個項目"]);
  assert.match(panel.innerHTML, /issue-row warning/);
});

test("validation controller keeps the current result when flush or request fails", async () => {
  const messages = [];
  const panel = { innerHTML: "", querySelector: () => null };
  const blocked = createController({
    panel,
    flush: async () => false,
    api: async () => { throw new Error("must not run"); },
    toast: (...values) => messages.push(values),
  });
  assert.equal(await blocked.run(), false);
  assert.deepEqual(messages, []);

  const failed = createController({
    panel,
    flush: async () => true,
    api: async () => { throw new Error("validation unavailable"); },
    toast: (...values) => messages.push(values),
  });
  assert.equal(await failed.run(), false);
  assert.deepEqual(messages, [["validation unavailable", "error"]]);
});
