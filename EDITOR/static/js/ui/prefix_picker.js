"use strict";

(function exposePrefixPicker(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ScenePrefixPicker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const LAYOUT = Object.freeze({
    menuMaxHeight: 320,
    menuWidth: 240,
    viewportEdge: 12,
    triggerGap: 7,
  });

  function normalizeItems(items = []) {
    const seen = new Set();
    const result = [];
    items.forEach((item) => {
      const value = String(typeof item === "object" ? item?.value ?? item?.id ?? "" : item).trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      result.push({
        value,
        label: String(typeof item === "object" ? item?.label ?? item?.name ?? value : value),
      });
    });
    return result;
  }

  function prefixMatches(items, query = "", limit = 60) {
    const prefix = String(query).trim().toLocaleLowerCase();
    return normalizeItems(items)
      .filter((item) => !prefix || item.value.toLocaleLowerCase().startsWith(prefix))
      .slice(0, Math.max(0, limit));
  }

  function createController({
    root,
    inputSelector = "[data-prefix-picker]",
    getItems = () => [],
    generateId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`,
  } = {}) {
    if (!root?.querySelectorAll) return { close() {}, destroy() {} };
    const entries = [];
    let openEntry = null;

    function showSurface(menu) {
      if (typeof menu?.showPopover !== "function") return;
      try {
        if (!menu.matches(":popover-open")) menu.showPopover();
      } catch (_error) {
        // The fixed-position fallback remains available without Popover API support.
      }
    }

    function hideSurface(menu) {
      if (typeof menu?.hidePopover !== "function") return;
      try {
        if (menu.matches(":popover-open")) menu.hidePopover();
      } catch (_error) {
        // A workspace rerender may already have detached the surface.
      }
    }

    function close(entry = openEntry) {
      if (!entry) return;
      hideSurface(entry.menu);
      entry.wrapper.classList.remove("open");
      entry.input.setAttribute("aria-expanded", "false");
      entry.input.removeAttribute("aria-activedescendant");
      entry.activeIndex = -1;
      if (openEntry === entry) openEntry = null;
    }

    function setActive(entry, index) {
      const options = [...entry.menu.querySelectorAll("[data-prefix-value]")];
      options.forEach((option) => option.classList.remove("is-picker-active"));
      if (!options.length) {
        entry.activeIndex = -1;
        entry.input.removeAttribute("aria-activedescendant");
        return;
      }
      entry.activeIndex = (index + options.length) % options.length;
      const active = options[entry.activeIndex];
      active.classList.add("is-picker-active");
      entry.input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    }

    function position(entry) {
      const rect = entry.input.getBoundingClientRect();
      const edge = LAYOUT.viewportEdge;
      const width = Math.min(LAYOUT.menuWidth, Math.max(1, window.innerWidth - edge * 2));
      const availableHeight = Math.min(LAYOUT.menuMaxHeight, Math.max(1, window.innerHeight - edge * 2));
      entry.menu.style.width = `${width}px`;
      entry.menu.style.minWidth = "0";
      entry.menu.style.maxWidth = `${width}px`;
      entry.menu.style.height = "auto";
      entry.menu.style.minHeight = "0";
      entry.menu.style.maxHeight = `${availableHeight}px`;
      const height = Math.min(availableHeight, Math.ceil(entry.menu.scrollHeight + 2));
      const left = Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge));
      const below = rect.bottom + LAYOUT.triggerGap;
      const top = below + height <= window.innerHeight - edge || rect.top < height + edge
        ? below
        : rect.top - height - LAYOUT.triggerGap;
      entry.menu.style.left = `${left}px`;
      entry.menu.style.top = `${Math.max(edge, top)}px`;
    }

    function render(entry) {
      const matches = prefixMatches(getItems(entry.input), entry.input.value);
      entry.menu.replaceChildren();
      matches.forEach((item, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.id = `${entry.menu.id}_option_${index}`;
        option.className = "select-choice-option";
        option.dataset.prefixValue = item.value;
        option.textContent = item.label;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(item.value === entry.input.value));
        entry.menu.append(option);
      });
      return matches.length;
    }

    function open(entry, preferredIndex = 0) {
      if (entry.input.disabled || !render(entry)) {
        close(entry);
        return false;
      }
      if (openEntry && openEntry !== entry) close(openEntry);
      openEntry = entry;
      entry.wrapper.classList.add("open");
      entry.input.setAttribute("aria-expanded", "true");
      showSurface(entry.menu);
      position(entry);
      setActive(entry, preferredIndex);
      return true;
    }

    function commit(entry, value) {
      entry.committing = true;
      entry.input.value = value;
      close(entry);
      entry.input.dispatchEvent(new Event("input", { bubbles: true }));
      entry.input.dispatchEvent(new Event("change", { bubbles: true }));
      entry.committing = false;
      entry.input.focus({ preventScroll: true });
    }

    function enhance(input) {
      if (!(input instanceof HTMLInputElement) || input.dataset.prefixEnhanced) return;
      input.dataset.prefixEnhanced = "true";
      const wrapper = input.closest("label") || input.parentElement;
      if (!wrapper) return;
      wrapper.classList.add("prefix-choice-picker");
      const menu = document.createElement("div");
      menu.id = generateId("prefix_menu");
      menu.className = "select-choice-menu prefix-choice-menu";
      menu.setAttribute("popover", "manual");
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", input.getAttribute("aria-label") || "Suggestions");
      wrapper.append(menu);
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-expanded", "false");
      input.setAttribute("aria-controls", menu.id);
      input.setAttribute("autocomplete", "off");
      const entry = { input, wrapper, menu, activeIndex: -1, committing: false };
      entries.push(entry);

      input.addEventListener("focus", () => open(entry));
      input.addEventListener("input", () => {
        if (!entry.committing) open(entry);
      });
      input.addEventListener("blur", () => window.setTimeout(() => {
        if (!wrapper.contains(document.activeElement)) close(entry);
      }, 0));
      input.addEventListener("keydown", (event) => {
        const options = [...menu.querySelectorAll("[data-prefix-value]")];
        if (event.key === "Escape" && wrapper.classList.contains("open")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          close(entry);
          input.focus({ preventScroll: true });
          return;
        }
        if (event.key === "Tab") {
          close(entry);
          return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          if (!wrapper.classList.contains("open")) {
            if (!open(entry, event.key === "ArrowUp" || event.key === "End" ? -1 : 0)) return;
          } else if (event.key === "Home") setActive(entry, 0);
          else if (event.key === "End") setActive(entry, options.length - 1);
          else setActive(entry, entry.activeIndex + (event.key === "ArrowDown" ? 1 : -1));
          event.preventDefault();
          return;
        }
        if (event.key === "Enter" && wrapper.classList.contains("open") && entry.activeIndex >= 0) {
          const active = menu.querySelectorAll("[data-prefix-value]")[entry.activeIndex];
          if (active) commit(entry, active.dataset.prefixValue);
          event.preventDefault();
          event.stopPropagation();
        }
      });
      menu.addEventListener("pointerdown", (event) => {
        if (event.button === 0) event.preventDefault();
      });
      menu.addEventListener("pointermove", (event) => {
        const option = event.target.closest("[data-prefix-value]");
        if (!option) return;
        setActive(entry, [...menu.querySelectorAll("[data-prefix-value]")].indexOf(option));
      });
      menu.addEventListener("click", (event) => {
        const option = event.target.closest("[data-prefix-value]");
        if (!option) return;
        commit(entry, option.dataset.prefixValue);
        event.preventDefault();
      });
    }

    root.querySelectorAll(inputSelector).forEach(enhance);
    return {
      close: () => close(),
      destroy() {
        close();
        entries.forEach(({ input, wrapper, menu }) => {
          input.removeAttribute("aria-activedescendant");
          input.removeAttribute("aria-autocomplete");
          input.removeAttribute("aria-controls");
          input.removeAttribute("aria-expanded");
          delete input.dataset.prefixEnhanced;
          wrapper.classList.remove("prefix-choice-picker", "open");
          menu.remove();
        });
      },
    };
  }

  return Object.freeze({ LAYOUT, createController, normalizeItems, prefixMatches });
});
