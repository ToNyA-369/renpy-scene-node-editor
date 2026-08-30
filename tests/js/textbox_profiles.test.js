"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const profiles = require("../../EDITOR/static/js/workspaces/textbox_profiles.js");

const glass = {
  ID: "glass",
  Name: "Glass",
  Style: { Background: "#102030cc", "Text Size": 34 },
  Features: {
    hover_accent: { Enabled: true, Color: "#5c7265", Width: 8 },
    text_shadow: { Enabled: true, Size: 3 },
  },
};

test("profile style and feature overrides resolve in deterministic order", () => {
  const element = {
    Style: { Background: "#111111", "Text Size": 28 },
    Appearance: {
      Profile: "glass",
      Features: { text_shadow: false },
      "Style Overrides": { "Text Size": 40 },
    },
  };

  assert.equal(profiles.resolveStyle(element, [glass]).Background, "#102030cc");
  assert.equal(profiles.resolveStyle(element, [glass])["Text Size"], 40);
  assert.equal(profiles.resolveFeature(element, "hover_accent", [glass]).Enabled, true);
  assert.equal(profiles.resolveFeature(element, "text_shadow", [glass]).Enabled, false);
});

test("new optional effects remain disabled for older profiles", () => {
  const element = { Appearance: { Profile: "glass", Features: {}, "Style Overrides": {} } };
  assert.equal(profiles.resolveFeature(element, "hover_text_color", [glass]).Enabled, false);
  assert.equal(profiles.resolveFeature(element, "item_border", [glass]).Width, 1);
  assert.equal(profiles.resolveFeature(element, "text_outline", [glass]).Size, 1);
  assert.equal(profiles.itemTypographyCss(element, [glass]), "");
  for (const id of ["item_corners", "text_padding", "text_bold", "text_italic", "text_spacing"]) {
    assert.equal(profiles.resolveFeature(element, id, [glass]).Enabled, false);
  }
});

test("item typography previews all five features and honors individual overrides", () => {
  const profile = { ...glass, Features: {
    item_corners: { Enabled: true, Radius: 20 },
    text_padding: { Enabled: true, X: 0 },
    text_bold: { Enabled: true }, text_italic: { Enabled: true },
    text_spacing: { Enabled: true, Spacing: -1.5 },
  } };
  const element = { Appearance: { Profile: glass.ID } };
  assert.equal(profiles.itemTypographyCss(element, [profile]), "border-radius:20px;padding-inline:0px;font-weight:700;font-style:italic;letter-spacing:-1.5px");
  element.Appearance.Features = Object.fromEntries(Object.keys(profile.Features).map((id) => [id, false]));
  assert.equal(profiles.itemTypographyCss(element, [profile]), "");
  assert.equal(profiles.itemTypographyCss(element, []), "");
});

test("missing profiles fall back to inline style and disable profile features", () => {
  const element = {
    Style: { Background: "#111111", "Text Size": 28 },
    Appearance: { Profile: "missing", Features: { hover_accent: true } },
  };

  assert.equal(profiles.resolveStyle(element, [glass]).Background, "#111111");
  assert.equal(profiles.resolveFeature(element, "hover_accent", [glass]).Enabled, false);
});

test("detaching a profile materializes the resolved appearance", () => {
  const element = {
    Type: "TEXTBOX",
    Style: { Background: "#111111" },
    Appearance: { Profile: "glass", Features: {}, "Style Overrides": { "Text Size": 42 } },
  };

  const detached = profiles.withProfile(element, "", [glass]);
  assert.equal(detached.Style.Background, "#102030cc");
  assert.equal(detached.Style["Text Size"], 42);
  assert.equal(detached.Appearance, undefined);
});

test("applying a profile clears stale local overrides", () => {
  const element = {
    Type: "TEXTBOX",
    Style: { Background: "#111111", "Text Size": 28 },
    Appearance: {
      Profile: "old",
      Features: { text_shadow: false },
      "Style Overrides": { Background: "#111111", "Text Size": 28 },
    },
  };

  const applied = profiles.withProfile(element, "glass", [glass]);
  assert.deepEqual(applied.Appearance, {
    Profile: "glass",
    Features: {},
    "Style Overrides": {},
  });
  assert.equal(profiles.resolveStyle(applied, [glass]).Background, "#102030cc");
});
