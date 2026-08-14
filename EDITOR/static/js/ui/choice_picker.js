"use strict";

(function exposeChoicePicker(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneChoicePicker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const LAYOUT = Object.freeze({
    menuWidth: 240,
    submenuGap: 14,
  });
  const SUBMENU_GAP = LAYOUT.submenuGap;
  const SUBMENU_CLOSE_DELAY = 180;
  const SELECT_MENU_WIDTH = LAYOUT.menuWidth;

  function buildOptionHierarchy(options) {
    const root = { folders: new Map(), leading: [], options: [] };
    options.forEach((option) => {
      const parts = String(option.pickerPath || "").split("/").filter(Boolean);
      if (!parts.length) {
        root.leading.push(option);
        return;
      }
      let branch = root;
      parts.slice(0, -1).forEach((part) => {
        if (!branch.folders.has(part)) branch.folders.set(part, { folders: new Map(), options: [] });
        branch = branch.folders.get(part);
      });
      branch.options.push(option);
    });
    return root;
  }

  function hierarchyDepth(branch) {
    let depth = 0;
    branch.folders.forEach((child) => { depth = Math.max(depth, 1 + hierarchyDepth(child)); });
    return depth;
  }

  function createChoicePicker({ escapeHtml, generateId, beforeOpen = () => {} }) {
    const submenuCloseTimers = new WeakMap();

    function clearSubmenuClose(branch) {
      const timer = submenuCloseTimers.get(branch);
      if (timer) window.clearTimeout(timer);
      submenuCloseTimers.delete(branch);
    }

    function closeSubmenuTree(branch) {
      if (!branch) return;
      [branch, ...branch.querySelectorAll(".select-choice-branch, .content-file-branch")].forEach((item) => {
        clearSubmenuClose(item);
        item.classList.remove("submenu-open");
        item.querySelector(":scope > [aria-haspopup='menu']")?.setAttribute("aria-expanded", "false");
      });
    }

    function setSubmenuOpen(branch, opening, position) {
      if (!branch) return;
      clearSubmenuClose(branch);
      if (!opening) {
        closeSubmenuTree(branch);
        return;
      }
      [...branch.parentElement.children].forEach((sibling) => {
        if (sibling === branch || !sibling.classList?.contains(branch.classList[0])) return;
        closeSubmenuTree(sibling);
      });
      branch.classList.add("submenu-open");
      branch.querySelector(":scope > [aria-haspopup='menu']")?.setAttribute("aria-expanded", "true");
      position(branch);
    }

    function scheduleSubmenuClose(branch) {
      clearSubmenuClose(branch);
      submenuCloseTimers.set(branch, window.setTimeout(() => {
        setSubmenuOpen(branch, false, () => {});
      }, SUBMENU_CLOSE_DELAY));
    }

    function directMenuItems(menu, folderSelector, choiceSelector) {
      if (!menu) return [];
      return [...menu.children].map((child) => {
        if (child.matches?.(choiceSelector)) return child;
        return child.querySelector?.(`:scope > ${folderSelector}`) || null;
      }).filter((item) => item && !item.disabled && item.offsetParent !== null);
    }

    function focusRelativeMenuItem(active, key, folderSelector, choiceSelector) {
      const menu = active.closest(".select-choice-menu, .select-choice-submenu, .content-choice-menu, .content-label-submenu");
      const items = directMenuItems(menu, folderSelector, choiceSelector);
      const current = items.indexOf(active);
      if (current < 0 || !items.length) return false;
      const next = key === "Home" ? 0
        : key === "End" ? items.length - 1
          : (current + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
      return true;
    }

    function close(except = null) {
      document.querySelectorAll(".select-choice-picker.open").forEach((picker) => {
        if (picker === except) return;
        picker.classList.remove("open");
        picker.querySelector("[data-select-picker-toggle]")?.setAttribute("aria-expanded", "false");
        picker.querySelectorAll(".select-choice-branch").forEach((branch) => {
          clearSubmenuClose(branch);
          branch.classList.remove("submenu-open");
          branch.querySelector(":scope > [data-select-folder-toggle]")?.setAttribute("aria-expanded", "false");
        });
      });
    }

    function selectedOptionLabel(select) {
      return select.selectedOptions?.[0]?.textContent?.trim()
        || select.options?.[select.selectedIndex]?.textContent?.trim()
        || (typeof SceneI18n !== "undefined" ? SceneI18n.t("尚未選擇") : "尚未選擇");
    }

    function populateMenu(select, picker) {
      const menu = picker.querySelector(".select-choice-menu");
      if (!menu) return;
      menu.replaceChildren();
      const appendOption = (option, parent = menu) => {
        if (option.hidden) return;
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "select-choice-option";
        choice.dataset.selectValue = option.value;
        choice.textContent = option.textContent;
        choice.disabled = option.disabled;
        choice.setAttribute("role", "option");
        choice.setAttribute("aria-selected", String(option.selected));
        parent.append(choice);
      };
      const flatOptions = [...select.options];
      if (flatOptions.some((option) => option.dataset.pickerPath)) {
        const root = buildOptionHierarchy(flatOptions.map((option) => ({
          element: option,
          pickerPath: option.dataset.pickerPath || "",
        })));
        const appendBranch = (name, branch, parent) => {
          const wrapper = document.createElement("div");
          wrapper.className = "select-choice-branch";
          const folder = document.createElement("button");
          folder.type = "button";
          folder.className = "select-choice-folder";
          folder.dataset.selectFolderToggle = "";
          folder.setAttribute("aria-haspopup", "menu");
          folder.setAttribute("aria-expanded", "false");
          folder.innerHTML = `<span>${escapeHtml(name)}</span><i aria-hidden="true">›</i>`;
          const submenu = document.createElement("div");
          submenu.className = "select-choice-submenu";
          submenu.setAttribute("role", "menu");
          submenu.setAttribute("aria-label", name);
          branch.folders.forEach((child, childName) => appendBranch(childName, child, submenu));
          branch.options.forEach((item) => appendOption(item.element, submenu));
          wrapper.append(folder, submenu);
          parent.append(wrapper);
        };
        root.leading.forEach((item) => appendOption(item.element));
        root.folders.forEach((branch, name) => appendBranch(name, branch, menu));
        root.options.forEach((item) => appendOption(item.element));
        return;
      }
      [...select.children].forEach((child) => {
        if (child.tagName === "OPTGROUP") {
          const heading = document.createElement("div");
          heading.className = "select-choice-group";
          heading.textContent = child.label;
          menu.append(heading);
          [...child.children].forEach(appendOption);
        } else if (child.tagName === "OPTION") {
          appendOption(child);
        }
      });
    }

    function positionSubmenu(branch) {
      const trigger = branch.querySelector(":scope > .select-choice-folder");
      const submenu = branch.querySelector(":scope > .select-choice-submenu");
      if (!trigger || !submenu) return;
      const rect = trigger.getBoundingClientRect();
      const rootMenu = branch.closest(".select-choice-menu");
      if (!rootMenu) return;
      const rootRect = rootMenu.getBoundingClientRect();
      const edge = 12;
      const width = Math.min(SELECT_MENU_WIDTH, window.innerWidth - edge * 2);
      const height = Math.min(submenu.scrollHeight, 320);
      let depth = 1;
      for (let parent = branch.parentElement; parent && parent !== rootMenu; parent = parent.parentElement) {
        if (parent.classList.contains("select-choice-submenu")) depth += 1;
      }
      const opensLeft = rootMenu.dataset.submenuDirection === "left";
      const requestedLeft = opensLeft
        ? rootRect.left - depth * (width + SUBMENU_GAP)
        : rootRect.left + depth * (width + SUBMENU_GAP);
      submenu.classList.toggle("opens-left", opensLeft);
      submenu.style.width = `${width}px`;
      submenu.style.left = `${Math.max(edge, Math.min(requestedLeft, window.innerWidth - width - edge))}px`;
      submenu.style.top = `${Math.max(edge, Math.min(rect.top - 7, window.innerHeight - height - edge))}px`;
      submenu.style.zIndex = String(310 + depth);
    }

    function sync(select) {
      const picker = select.closest(".select-choice-picker");
      if (!picker) return;
      const trigger = picker.querySelector("[data-select-picker-toggle]");
      const selectedLabel = selectedOptionLabel(select);
      if (trigger instanceof HTMLInputElement) trigger.value = selectedLabel;
      else {
        const label = trigger?.querySelector("strong");
        if (label) label.textContent = selectedLabel;
      }
      if (trigger) trigger.disabled = select.disabled;
      populateMenu(select, picker);
    }

    function positionMenu(picker) {
      const trigger = picker.querySelector("[data-select-picker-toggle]");
      const menu = picker.querySelector(".select-choice-menu");
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const edge = 12;
      const width = Math.min(SELECT_MENU_WIDTH, window.innerWidth - edge * 2);
      const model = buildOptionHierarchy([...picker.querySelectorAll(".select-choice-option")].map((option) => ({
        pickerPath: option.dataset.pickerPath || "",
      })));
      const domDepth = (container) => {
        let depth = 0;
        container.querySelectorAll(":scope > .select-choice-branch").forEach((branch) => {
          const submenu = branch.querySelector(":scope > .select-choice-submenu");
          if (submenu) depth = Math.max(depth, 1 + domDepth(submenu));
        });
        return depth;
      };
      const depth = Math.max(hierarchyDepth(model), domDepth(menu));
      const pitch = width + SUBMENU_GAP;
      const totalWidth = width + depth * pitch;
      const naturalRightLeft = Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge));
      const naturalLeftLeft = Math.max(edge, Math.min(rect.right - width, window.innerWidth - width - edge));
      const rightFits = naturalRightLeft + totalWidth <= window.innerWidth - edge;
      const leftFits = naturalLeftLeft - depth * pitch >= edge;
      const rightSpace = window.innerWidth - naturalRightLeft;
      const leftSpace = naturalLeftLeft + width;
      const opensLeft = !rightFits && (leftFits || leftSpace > rightSpace);
      menu.dataset.submenuDirection = opensLeft ? "left" : "right";
      let left = opensLeft ? naturalLeftLeft : naturalRightLeft;
      if (totalWidth <= window.innerWidth - edge * 2) {
        left = opensLeft ? Math.max(left, edge + depth * pitch) : Math.min(left, window.innerWidth - edge - totalWidth);
      }
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.max(edge, Math.min(left, window.innerWidth - width - edge))}px`;
      menu.style.top = `${rect.bottom + 7}px`;
      const height = Math.min(menu.scrollHeight, 320);
      if (rect.bottom + 7 + height > window.innerHeight - edge && rect.top > height + edge) {
        menu.style.top = `${rect.top - height - 7}px`;
      }
    }

    function enhance(select) {
      if (!(select instanceof HTMLSelectElement) || select.multiple || select.dataset.selectEnhanced) return;
      select.dataset.selectEnhanced = "true";
      const picker = document.createElement("div");
      picker.className = "select-choice-picker";
      const menuId = generateId("select_menu");
      const fieldLabel = select.closest("label")?.querySelector("span")?.textContent?.trim();
      const settingLabel = select.closest(".setting-row")?.querySelector("strong")?.textContent?.trim();
      const label = select.getAttribute("aria-label") || select.title || settingLabel || fieldLabel || (typeof SceneI18n !== "undefined" ? SceneI18n.t("選擇項目") : "選擇項目");
      const trigger = document.createElement("input");
      trigger.type = "text";
      trigger.readOnly = true;
      trigger.className = "content-choice-trigger select-choice-trigger";
      trigger.dataset.selectPickerToggle = "";
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-label", label);
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-autocomplete", "none");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-controls", menuId);
      const menu = document.createElement("div");
      menu.id = menuId;
      menu.className = "select-choice-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", label);

      select.before(picker);
      picker.append(select, trigger, menu);
      select.classList.add("select-choice-native");
      select.hidden = true;
      select.tabIndex = -1;
      select.setAttribute("aria-hidden", "true");
      sync(select);

      picker.addEventListener("click", (event) => {
        const folder = event.target.closest("[data-select-folder-toggle]");
        if (folder) {
          setSubmenuOpen(folder.closest(".select-choice-branch"), true, positionSubmenu);
          event.preventDefault();
          return;
        }
        const choice = event.target.closest("[data-select-value]");
        if (choice && !choice.disabled) {
          const changed = select.value !== choice.dataset.selectValue;
          select.value = choice.dataset.selectValue;
          sync(select);
          close();
          trigger.focus({ preventScroll: true });
          if (changed) {
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
          event.preventDefault();
          return;
        }
        if (!event.target.closest("[data-select-picker-toggle]")) return;
        const opening = !picker.classList.contains("open");
        beforeOpen();
        close(opening ? picker : null);
        picker.classList.toggle("open", opening);
        trigger.setAttribute("aria-expanded", String(opening));
        if (opening) {
          populateMenu(select, picker);
          positionMenu(picker);
        }
        event.preventDefault();
      });
      picker.addEventListener("pointerover", (event) => {
        let branch = event.target.closest(".select-choice-branch");
        while (branch && picker.contains(branch)) {
          clearSubmenuClose(branch);
          branch = branch.parentElement?.closest(".select-choice-branch");
        }
        const folder = event.target.closest("[data-select-folder-toggle]");
        if (folder) setSubmenuOpen(folder.closest(".select-choice-branch"), true, positionSubmenu);
      });
      picker.addEventListener("pointerout", (event) => {
        const branch = event.target.closest(".select-choice-branch");
        if (branch && !branch.contains(event.relatedTarget)) scheduleSubmenuClose(branch);
      });
      picker.addEventListener("focusin", (event) => {
        const branch = event.target.closest(".select-choice-branch");
        if (branch) setSubmenuOpen(branch, true, positionSubmenu);
      });
      picker.addEventListener("focusout", (event) => {
        if (!picker.contains(event.relatedTarget)) close();
      });
      picker.addEventListener("keydown", (event) => {
        const folder = event.target.closest("[data-select-folder-toggle]");
        if (folder && ["Enter", " ", "ArrowRight"].includes(event.key)) {
          const branch = folder.closest(".select-choice-branch");
          setSubmenuOpen(branch, true, positionSubmenu);
          directMenuItems(branch.querySelector(":scope > .select-choice-submenu"), "[data-select-folder-toggle]", "[data-select-value]")[0]?.focus();
          event.preventDefault();
          return;
        }
        if (event.key === "ArrowLeft" && event.target.closest(".select-choice-submenu")) {
          const branch = event.target.closest(".select-choice-submenu").parentElement;
          setSubmenuOpen(branch, false, positionSubmenu);
          branch.querySelector(":scope > [data-select-folder-toggle]")?.focus();
          event.preventDefault();
          return;
        }
        if (event.target === trigger && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          if (!picker.classList.contains("open")) trigger.click();
          const options = directMenuItems(menu, "[data-select-folder-toggle]", "[data-select-value]");
          const selected = options.find((option) => option.getAttribute("aria-selected") === "true");
          const edgeOption = ["ArrowDown", "Home"].includes(event.key) ? options[0] : options[options.length - 1];
          (event.key === "Home" || event.key === "End" ? edgeOption : selected || edgeOption)?.focus();
          event.preventDefault();
          return;
        }
        const choice = event.target.closest("[data-select-value]");
        if ((folder || choice) && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          focusRelativeMenuItem(event.target, event.key, "[data-select-folder-toggle]", "[data-select-value]");
          event.preventDefault();
        } else if (choice && ["Enter", " "].includes(event.key)) {
          document.activeElement.click();
          event.preventDefault();
        } else if (event.key === "Escape") {
          close();
          trigger.focus({ preventScroll: true });
          event.preventDefault();
        }
      });
      select.addEventListener("change", () => sync(select));
    }

    function enhanceAll(container = document) {
      const selects = container.matches?.("select") ? [container] : [...(container.querySelectorAll?.("select") || [])];
      selects.forEach(enhance);
    }

    function observe() {
      const observer = new MutationObserver((records) => {
        records.forEach((record) => record.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) enhanceAll(node);
        }));
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return observer;
    }

    return {
      close,
      enhance,
      enhanceAll,
      hierarchy: {
        clearSubmenuClose,
        directMenuItems,
        focusRelativeMenuItem,
        scheduleSubmenuClose,
        setSubmenuOpen,
      },
      observe,
      positionMenu,
      positionSubmenu,
      sync,
    };
  }

  return { buildOptionHierarchy, createChoicePicker, hierarchyDepth, LAYOUT };
});
