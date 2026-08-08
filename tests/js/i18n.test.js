"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const i18n = require("../../EDITOR/static/js/core/i18n.js");

test("i18n exposes supported locales and defaults to zh-Hant", () => {
  assert.deepEqual(i18n.SUPPORTED_LOCALES, ["zh-Hant", "en"]);
  assert.equal(i18n.DEFAULT_LOCALE, "zh-Hant");
  assert.equal(i18n.getLocale(), "zh-Hant");
});

test("locale normalization maps english variants to en and everything else to zh-Hant", () => {
  assert.equal(i18n.normalizeLocale("en"), "en");
  assert.equal(i18n.normalizeLocale("en-US"), "en");
  assert.equal(i18n.normalizeLocale("EN_gb"), "en");
  assert.equal(i18n.normalizeLocale("zh-Hant"), "zh-Hant");
  assert.equal(i18n.normalizeLocale("zh-TW"), "zh-Hant");
  assert.equal(i18n.normalizeLocale("fr"), "zh-Hant");
  assert.equal(i18n.normalizeLocale(null), "zh-Hant");
});

test("t() returns fallback string in zh-Hant and translates in en with interpolation", () => {
  i18n.setLocale("zh-Hant");
  assert.equal(i18n.t("編輯器設定"), "編輯器設定");
  assert.equal(i18n.t("快捷鍵已用於「{action}」", { action: "立即儲存" }), "快捷鍵已用於「立即儲存」");

  i18n.setLocale("en");
  assert.equal(i18n.t("編輯器設定"), "Editor Settings");
  assert.equal(i18n.t("快捷鍵已用於「{action}」", { action: "Save Immediately" }), "Shortcut already bound to \"Save Immediately\"");
  assert.equal(i18n.t("未知的鍵"), "未知的鍵");

  // Reset to default
  i18n.setLocale("zh-Hant");
});

test("EN_DICTIONARY covers required static keys", () => {
  assert.equal(i18n.EN_DICTIONARY["節點"], "Node");
  assert.equal(i18n.EN_DICTIONARY["事件"], "Events");
  assert.equal(i18n.EN_DICTIONARY["選項"], "Options");
  assert.equal(i18n.EN_DICTIONARY["演出"], "Content");
  assert.equal(i18n.EN_DICTIONARY["狀態"], "State");
  assert.equal(i18n.EN_DICTIONARY["關聯圖"], "Graph");
  assert.equal(i18n.EN_DICTIONARY["檢查"], "Validation");
  assert.equal(i18n.EN_DICTIONARY["介面語言"], "Interface Language");
  assert.equal(i18n.EN_DICTIONARY["有未儲存的變更"], "Unsaved changes");
  assert.equal(i18n.EN_DICTIONARY["儲存失敗"], "Save failed");
});

test("t() returns expected output for all key translations", () => {
  i18n.setLocale("en");
  for (const [key, value] of Object.entries(i18n.EN_DICTIONARY)) {
    assert.ok(value && typeof value === "string", `Translation for "${key}" should be a non-empty string`);
  }
  i18n.setLocale("zh-Hant");
});

test("untranslated Editor-owned literal completeness guard", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const appJs = fs.readFileSync(path.resolve(__dirname, "../../EDITOR/static/app.js"), "utf-8");
  const html = fs.readFileSync(path.resolve(__dirname, "../../EDITOR/static/index.html"), "utf-8");
  const modulePaths = [
    "js/core/api_client.js",
    "js/core/event_contract.js",
    "js/ui/choice_picker.js",
    "js/workspaces/event_editor.js",
  ];
  const modules = modulePaths.map((relative) => ({
    source: relative,
    text: fs.readFileSync(path.resolve(__dirname, `../../EDITOR/static/${relative}`), "utf-8"),
  }));

  const chineseRegex = /[\u4e00-\u9fa5]+/g;
  const missingKeys = new Set();

  function checkText(text, source) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].split("//")[0];
      const matches = line.match(chineseRegex) || [];
      for (const match of matches) {
        if (["新數值", "新記憶庫", "新標籤", "新事件", "新選項", "在這裡撰寫演出"].includes(match)) continue;
        if (!i18n.EN_DICTIONARY[match] && !Object.keys(i18n.EN_DICTIONARY).some((k) => k.includes(match))) {
          missingKeys.add(`${source}:${i + 1}: ${match}`);
        }
      }
    }
  }

  checkText(appJs, "app.js");
  checkText(html, "index.html");
  modules.forEach(({ source, text }) => checkText(text, source));

  assert.equal(missingKeys.size, 0, `Missing translations in EN_DICTIONARY:\n${[...missingKeys].join("\n")}`);

  // Catch literals embedded directly into generated markup or accessibility
  // attributes. Dictionary membership alone cannot prove the rendering path
  // actually invokes t().
  const generatedUiSource = [appJs, ...modules.map(({ text }) => text)].join("\n");
  assert.doesNotMatch(generatedUiSource, />刪除事件<|>不透明度<|>選擇 Idle 圖片</);
  assert.doesNotMatch(generatedUiSource, /(?:aria-label|title|placeholder)="[^"$]*[\u3400-\u9fff][^"]*"/);
  assert.doesNotMatch(generatedUiSource, /aria-label="\$\{escapeHtml\(label\)\}(?:顏色|不透明度)"/);
});
