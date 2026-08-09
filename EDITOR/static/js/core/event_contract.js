"use strict";

(function exposeEventContract(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEventContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const EVENT_TRIGGER_MODES = Object.freeze([
    Object.freeze({ id: "Auto", name: "Auto" }),
    Object.freeze({ id: "Action", name: "Option" }),
    Object.freeze({ id: "Keyboard", name: "Keyboard" }),
    Object.freeze({ id: "Mouse", name: "Mouse" }),
  ]);
  const AUTO_TRIGGER_CHOICES = Object.freeze([
    Object.freeze({ id: "Auto:Enter", name: "On Enter" }),
    Object.freeze({ id: "Auto:Node", name: "On Node" }),
    Object.freeze({ id: "Auto:Exit", name: "On Exit" }),
  ]);
  const MOUSE_TRIGGER_CHOICES = Object.freeze([
    Object.freeze({ id: "Mouse:Left", name: "左鍵" }),
    Object.freeze({ id: "Mouse:Middle", name: "中鍵" }),
    Object.freeze({ id: "Mouse:Right", name: "右鍵" }),
    Object.freeze({ id: "Mouse:WheelUp", name: "滾輪向上" }),
    Object.freeze({ id: "Mouse:WheelDown", name: "滾輪向下" }),
  ]);
  const END_UP_CHOICES = Object.freeze(["REDO", "GOTO", "REPLACE", "EXIT"]);

  function actionTriggerName(trigger) {
    const value = String(trigger || "").trim();
    return value.startsWith("Action:") ? value.slice("Action:".length).trim() : value;
  }

  function actionTriggerValue(name) {
    const value = actionTriggerName(name);
    return value ? `Action:${value}` : "";
  }

  function eventTriggerMode(trigger) {
    const value = String(trigger || "").trim();
    if (value.startsWith("Auto:")) return "Auto";
    if (value.startsWith("Keyboard:")) return "Keyboard";
    if (value.startsWith("Mouse:")) return "Mouse";
    return "Action";
  }

  function isLifecycleTrigger(trigger) {
    return trigger === "Auto:Enter" || trigger === "Auto:Exit";
  }

  function endUpUsesNextNode(endUp) {
    return endUp === "GOTO" || endUp === "REPLACE";
  }

  function keyboardTriggerKeysym(trigger) {
    const value = String(trigger || "").trim();
    return value.startsWith("Keyboard:") ? value.slice("Keyboard:".length).trim() : "";
  }

  function keyboardKeysymFromEvent(event) {
    const namedKeys = {
      Space: "K_SPACE", Enter: "K_RETURN", Escape: "K_ESCAPE", Tab: "K_TAB",
      Backspace: "K_BACKSPACE", Delete: "K_DELETE", Insert: "K_INSERT",
      Home: "K_HOME", End: "K_END", PageUp: "K_PAGEUP", PageDown: "K_PAGEDOWN",
      ArrowLeft: "K_LEFT", ArrowRight: "K_RIGHT", ArrowUp: "K_UP", ArrowDown: "K_DOWN",
      Minus: "K_MINUS", Equal: "K_EQUALS", BracketLeft: "K_LEFTBRACKET",
      BracketRight: "K_RIGHTBRACKET", Backslash: "K_BACKSLASH", Semicolon: "K_SEMICOLON",
      Quote: "K_QUOTE", Backquote: "K_BACKQUOTE", Comma: "K_COMMA",
      Period: "K_PERIOD", Slash: "K_SLASH", NumpadEnter: "K_KP_ENTER",
      NumpadAdd: "K_KP_PLUS", NumpadSubtract: "K_KP_MINUS",
      NumpadMultiply: "K_KP_MULTIPLY", NumpadDivide: "K_KP_DIVIDE",
      NumpadDecimal: "K_KP_PERIOD",
    };
    let key = namedKeys[event.code] || "";
    const letter = event.code.match(/^Key([A-Z])$/)?.[1];
    const digit = event.code.match(/^Digit([0-9])$/)?.[1];
    const numpad = event.code.match(/^Numpad([0-9])$/)?.[1];
    const functionKey = event.code.match(/^F([1-9]|1[0-2])$/)?.[1];
    if (letter) key = `K_${letter.toLocaleLowerCase()}`;
    else if (digit) key = `K_${digit}`;
    else if (numpad) key = `K_KP${numpad}`;
    else if (functionKey) key = `K_F${functionKey}`;
    if (!key) return "";

    const prefixes = [];
    if (event.metaKey) prefixes.push("meta");
    if (event.ctrlKey) prefixes.push("ctrl");
    if (event.altKey) prefixes.push("alt");
    if (event.shiftKey) prefixes.push("shift");
    return [...prefixes, key].join("_");
  }

  function keyboardKeysymDisplay(keysym, platform = globalThis.navigator?.platform || "") {
    const isMac = /Mac|iPhone|iPad/.test(platform);
    const modifierLabels = {
      meta: isMac ? "⌘" : "Meta", ctrl: "Ctrl", osctrl: isMac ? "⌥" : "Ctrl",
      alt: isMac ? "⌥" : "Alt", shift: isMac ? "⇧" : "Shift", noshift: "No Shift",
      anymod: "Any Modifier", repeat: "Repeat", anyrepeat: "Any Repeat",
      keydown: "Key Down", keyup: "Key Up", caps: "Caps", nocaps: "No Caps",
      num: "Num", nonum: "No Num",
    };
    const labels = [];
    let remaining = String(keysym || "");
    while (remaining.includes("_")) {
      const modifier = Object.keys(modifierLabels).find((item) => remaining.startsWith(`${item}_`));
      if (!modifier) break;
      labels.push(modifierLabels[modifier]);
      remaining = remaining.slice(modifier.length + 1);
    }
    const keyLabels = {
      K_SPACE: "Space", K_RETURN: "Enter", K_ESCAPE: "Esc", K_TAB: "Tab",
      K_BACKSPACE: "Backspace", K_DELETE: "Delete", K_INSERT: "Insert", K_HOME: "Home",
      K_END: "End", K_PAGEUP: "Page Up", K_PAGEDOWN: "Page Down",
      K_LEFT: "←", K_RIGHT: "→", K_UP: "↑", K_DOWN: "↓",
    };
    let keyLabel = keyLabels[remaining];
    if (!keyLabel && /^K_[a-z]$/.test(remaining)) keyLabel = remaining.slice(2).toLocaleUpperCase();
    if (!keyLabel && /^K_[0-9]$/.test(remaining)) keyLabel = remaining.slice(2);
    if (!keyLabel && /^K_F(?:[1-9]|1[0-2])$/.test(remaining)) keyLabel = remaining.slice(2);
    if (!keyLabel) keyLabel = remaining.replace(/^K_/, "").replaceAll("_", " ");
    if (keyLabel) labels.push(keyLabel);
    const defaultPrompt = typeof SceneI18n !== "undefined" ? SceneI18n.t("按下鍵盤按鍵") : "按下鍵盤按鍵";
    return labels.join(isMac ? "" : " + ") || defaultPrompt;
  }

  function eventTriggerDisplayName(trigger, platform) {
    const mode = eventTriggerMode(trigger);
    if (mode === "Action") return actionTriggerName(trigger);
    if (mode === "Keyboard") return keyboardKeysymDisplay(keyboardTriggerKeysym(trigger), platform);
    if (mode === "Mouse") {
      const name = MOUSE_TRIGGER_CHOICES.find((item) => item.id === trigger)?.name || trigger;
      return typeof SceneI18n !== "undefined" ? SceneI18n.t(name) : name;
    }
    const name = AUTO_TRIGGER_CHOICES.find((item) => item.id === trigger)?.name || trigger;
    return typeof SceneI18n !== "undefined" ? SceneI18n.t(name) : name;
  }

  return {
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
  };
});
