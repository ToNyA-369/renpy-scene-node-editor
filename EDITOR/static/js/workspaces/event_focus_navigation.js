"use strict";

(function exposeEventFocusNavigation(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEventFocusNavigation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SECTION_SELECTOR = "[data-event-section]";
  const FIELD_SELECTOR = [
    "input:not([type='hidden']):not([disabled]):not(.select-choice-native)",
    "textarea:not([disabled])",
    "[data-select-picker-toggle]",
  ].join(",");

  function fieldsWithin(container, section = container) {
    if (!container || !section) return [];
    return [...container.querySelectorAll(FIELD_SELECTOR)].filter((field) => (
      !field.closest(".select-choice-menu, .select-choice-submenu")
      && field.closest(SECTION_SELECTOR) === section
    ));
  }

  function sectionFields(section) {
    return fieldsWithin(section, section);
  }

  function firstFieldInLastItem(section) {
    const items = [...section.querySelectorAll("[data-event-nav-item]")];
    const lastItem = items[items.length - 1];
    return fieldsWithin(lastItem || section, section)[0] || sectionFields(section)[0] || null;
  }

  function navigationStep(index, length, direction) {
    const next = index + direction;
    if (next >= 0 && next < length) return { type: "field", index: next };
    return { type: direction < 0 ? "section" : "next-section" };
  }

  function createController({ form, onAdd = () => false } = {}) {
    if (!form) throw new TypeError("Event focus navigation requires a form.");
    const sections = () => [...form.querySelectorAll(SECTION_SELECTOR)];

    function prepare() {
      sections().forEach((section) => {
        section.tabIndex = 0;
        sectionFields(section).forEach((field) => { field.tabIndex = -1; });
        section.querySelectorAll(".section-add-button, .row-button").forEach((button) => {
          button.tabIndex = -1;
        });
      });
    }

    function focusSection(section) {
      if (!section) return false;
      section.focus({ preventScroll: true });
      section.scrollIntoView?.({ block: "nearest" });
      return true;
    }

    function enterSection(sectionOrName, { lastItem = false } = {}) {
      const section = typeof sectionOrName === "string"
        ? form.querySelector(`${SECTION_SELECTOR}[data-event-section="${sectionOrName}"]`)
        : sectionOrName;
      const field = lastItem ? firstFieldInLastItem(section) : sectionFields(section)[0];
      if (!field) return false;
      field.focus({ preventScroll: true });
      field.scrollIntoView?.({ block: "nearest" });
      return true;
    }

    function adjacentSection(section, direction) {
      const items = sections();
      const index = items.indexOf(section);
      return index < 0 ? null : items[index + direction] || null;
    }

    function focusBeforeFirstSection() {
      const once = form.elements?.Once;
      if (once && !once.disabled) {
        once.focus({ preventScroll: true });
        return true;
      }
      return false;
    }

    function focusAfterLastSection() {
      const target = form.querySelector("#deleteEventButton");
      if (!target) return false;
      target.focus({ preventScroll: true });
      return true;
    }

    function handleKeydown(event) {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (target.matches('[name="Once"]') && event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        target.click();
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const section = target.closest(SECTION_SELECTOR);
      if (!section || !form.contains(section)) return;

      if (target === section) {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          const name = section.dataset.eventSection;
          const added = onAdd(name);
          if (!added && name === "end-up") enterSection(section);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === "Enter" && !event.altKey) {
          enterSection(section);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === "Tab") {
          const adjacent = adjacentSection(section, event.shiftKey ? -1 : 1);
          const moved = adjacent
            ? focusSection(adjacent)
            : event.shiftKey ? focusBeforeFirstSection() : focusAfterLastSection();
          if (moved) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
        return;
      }

      if (event.key === "Escape") {
        focusSection(section);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== "Tab") return;

      const fields = sectionFields(section);
      const index = fields.indexOf(target);
      if (index < 0) return;
      const step = navigationStep(index, fields.length, event.shiftKey ? -1 : 1);
      if (step.type === "field") {
        fields[step.index].focus({ preventScroll: true });
        fields[step.index].scrollIntoView?.({ block: "nearest", inline: "nearest" });
      } else if (step.type === "section") {
        focusSection(section);
      } else {
        focusSection(adjacentSection(section, 1)) || focusAfterLastSection();
      }
      event.preventDefault();
      event.stopPropagation();
    }

    prepare();
    form.addEventListener("keydown", handleKeydown);
    return {
      destroy() {
        form.removeEventListener("keydown", handleKeydown);
      },
      enterSection,
      focusSection(name) {
        return focusSection(form.querySelector(`${SECTION_SELECTOR}[data-event-section="${name}"]`));
      },
      prepare,
      sectionFields,
    };
  }

  return { createController, navigationStep, sectionFields };
});
