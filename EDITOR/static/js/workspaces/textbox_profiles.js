"use strict";

(function exposeTextboxProfiles(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneTextboxProfiles = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DEFAULT_STYLE = Object.freeze({
    Background: "#0b1118",
    "Item Background": "#20302a",
    "Text Color": "#ffffff",
    "Text Size": 30,
    "Text Align": 0.5,
  });

  const FEATURE_IDS = Object.freeze([
    "hover_accent",
    "hover_text_color",
    "item_border",
    "item_corners",
    "text_padding",
    "text_bold",
    "text_italic",
    "text_spacing",
    "text_shadow",
    "text_outline",
    "staggered_entrance",
  ]);

  const FEATURE_DEFAULTS = Object.freeze({
    hover_accent: Object.freeze({ Enabled: false, Color: "#5c7265", Width: 6 }),
    hover_text_color: Object.freeze({ Enabled: false, Color: "#ffffff" }),
    item_border: Object.freeze({ Enabled: false, Color: "#ffffff33", Width: 1 }),
    item_corners: Object.freeze({ Enabled: false, Radius: 12 }),
    text_padding: Object.freeze({ Enabled: false, X: 24 }),
    text_bold: Object.freeze({ Enabled: false }),
    text_italic: Object.freeze({ Enabled: false }),
    text_spacing: Object.freeze({ Enabled: false, Spacing: 0 }),
    text_shadow: Object.freeze({ Enabled: false, Color: "#00000088", Size: 2, X: 0, Y: 2 }),
    text_outline: Object.freeze({ Enabled: false, Color: "#000000cc", Size: 1 }),
    staggered_entrance: Object.freeze({ Enabled: false, Distance: 18, Delay: 0.04, Duration: 0.22 }),
  });

  function profileMap(profiles) {
    if (profiles instanceof Map) return profiles;
    return new Map((profiles || []).map((profile) => [String(profile.ID), profile]));
  }

  function selectedProfile(element, profiles) {
    const profileId = String(element?.Appearance?.Profile || "").trim();
    return profileId ? profileMap(profiles).get(profileId) || null : null;
  }

  function resolveStyle(element, profiles) {
    const profile = selectedProfile(element, profiles);
    if (!profile) return { ...DEFAULT_STYLE, ...(element?.Style || {}) };
    return {
      ...DEFAULT_STYLE,
      ...(profile.Style || {}),
      ...(element?.Appearance?.["Style Overrides"] || {}),
    };
  }

  function resolveFeature(element, featureId, profiles) {
    const defaults = FEATURE_DEFAULTS[featureId] || { Enabled: false };
    const profile = selectedProfile(element, profiles);
    if (!profile) return { ...defaults, Enabled: false };
    const configured = profile.Features?.[featureId] || {};
    const override = element?.Appearance?.Features?.[featureId];
    return {
      ...defaults,
      ...configured,
      Enabled: typeof override === "boolean" ? override : Boolean(configured.Enabled),
    };
  }

  function itemTypographyCss(element, profiles) {
    const feature = (id) => resolveFeature(element, id, profiles);
    const corners = feature("item_corners");
    const padding = feature("text_padding");
    const spacing = feature("text_spacing");
    return [
      corners.Enabled ? `border-radius:${Number(corners.Radius)}px` : "",
      padding.Enabled ? `padding-inline:${Number(padding.X)}px` : "",
      feature("text_bold").Enabled ? "font-weight:700" : "",
      feature("text_italic").Enabled ? "font-style:italic" : "",
      spacing.Enabled ? `letter-spacing:${Number(spacing.Spacing)}px` : "",
    ].filter(Boolean).join(";");
  }

  function withProfile(element, profileId, profiles = []) {
    const next = JSON.parse(JSON.stringify(element || {}));
    const id = String(profileId || "").trim();
    if (!id) {
      const resolved = resolveStyle(next, profiles);
      delete next.Appearance;
      next.Style = resolved;
      return next;
    }
    next.Appearance = {
      Profile: id,
      Features: {},
      "Style Overrides": {},
    };
    return next;
  }

  return {
    DEFAULT_STYLE,
    FEATURE_DEFAULTS,
    FEATURE_IDS,
    itemTypographyCss,
    profileMap,
    resolveFeature,
    resolveStyle,
    selectedProfile,
    withProfile,
  };
});
