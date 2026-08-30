"use strict";

(function exposeChoicePicker(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneChoicePicker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const LAYOUT = Object.freeze({
    itemHeight: 38,
    menuMaxHeight: 320,
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

  function createChoicePicker({ escapeHtml, generateId, beforeOpen = () => {}, typeBadge = null }) {
    const submenuCloseTimers = new WeakMap();
    const anchorRects = new WeakMap();
    let pointerActivePicker = null;

    const clearPointerActivePicker = () => {
      window.setTimeout(() => { pointerActivePicker = null; }, 0);
    };
    window.addEventListener("pointerup", clearPointerActivePicker, true);
    window.addEventListener("pointercancel", clearPointerActivePicker, true);

    function showMenuSurface(menu) {
      if (typeof menu?.showPopover !== "function") return;
      try {
        if (!menu.matches(":popover-open")) menu.showPopover();
      } catch (_error) {
        // Browsers without Popover API support keep using the fixed-position fallback.
      }
    }

    function hideMenuSurface(menu) {
      if (typeof menu?.hidePopover !== "function") return;
      try {
        if (menu.matches(":popover-open")) menu.hidePopover();
      } catch (_error) {
        // The menu may already have been detached by a workspace rerender.
      }
    }

    function clearSubmenuClose(branch) {
      const timer = submenuCloseTimers.get(branch);
      if (timer) window.clearTimeout(timer);
      submenuCloseTimers.delete(branch);
    }

    function closeSubmenuTree(branch) {
      if (!branch) return;
      [branch, ...branch.querySelectorAll(".select-choice-branch")].forEach((item) => {
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
      const itemContainer = menu.querySelector(":scope > .select-choice-submenu-scroll") || menu;
      return [...itemContainer.children].map((child) => {
        if (child.matches?.(choiceSelector)) return child;
        return child.querySelector?.(`:scope > ${folderSelector}`) || null;
      }).filter((item) => item && !item.disabled && item.offsetParent !== null);
    }

    function fitMenuSurface(surface) {
      if (!surface) return 0;
      const edge = 12;
      const limit = Math.min(LAYOUT.menuMaxHeight, Math.max(1, window.innerHeight - edge * 2));
      surface.style.height = "auto";
      surface.style.minHeight = "0";
      surface.style.maxHeight = `${limit}px`;
      const style = getComputedStyle(surface);
      const borders = Number.parseFloat(style.borderTopWidth || "0") + Number.parseFloat(style.borderBottomWidth || "0");
      const height = Math.min(limit, Math.ceil(surface.scrollHeight + borders));
      surface.style.height = `${height}px`;
      return height;
    }

    function focusWithinMenu(item) {
      if (!item) return;
      // A popover is still a DOM descendant of the form's scroll containers.
      // Focus must scroll only its menu, never the form or an inline rule row.
      item.focus({ preventScroll: true });
      const surface = item.closest(".select-choice-submenu-scroll, .select-choice-menu");
      if (!surface) return;
      const itemRect = item.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();
      const top = surfaceRect.top + surface.clientTop;
      const bottom = top + surface.clientHeight;
      if (itemRect.top < top) surface.scrollTop -= top - itemRect.top;
      else if (itemRect.bottom > bottom) surface.scrollTop += itemRect.bottom - bottom;
    }

    function focusRelativeMenuItem(active, key, folderSelector, choiceSelector) {
      const menu = active.closest(".select-choice-menu, .select-choice-submenu");
      const items = directMenuItems(menu, folderSelector, choiceSelector);
      const current = items.indexOf(active);
      if (current < 0 || !items.length) return false;
      const next = key === "Home" ? 0
        : key === "End" ? items.length - 1
          : (current + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      focusWithinMenu(items[next]);
      return true;
    }

    function close(except = null) {
      document.querySelectorAll(".select-choice-picker.open").forEach((picker) => {
        if (picker === except) return;
        hideMenuSurface(picker.querySelector(":scope > .select-choice-menu"));
        picker.classList.remove("open");
        typeBadge?.setOpen(picker.querySelector("select"), false);
        picker.querySelectorAll(".is-picker-active").forEach((active) => active.classList.remove("is-picker-active"));
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
          const submenuScroll = document.createElement("div");
          submenuScroll.className = "select-choice-submenu-scroll";
          branch.folders.forEach((child, childName) => appendBranch(childName, child, submenuScroll));
          branch.options.forEach((item) => appendOption(item.element, submenuScroll));
          submenu.append(submenuScroll);
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
      const scrollSurface = submenu.querySelector(":scope > .select-choice-submenu-scroll");
      const rootRect = rootMenu.getBoundingClientRect();
      const edge = 12;
      const width = Math.min(SELECT_MENU_WIDTH, window.innerWidth - edge * 2);
      const height = fitMenuSurface(scrollSurface || submenu);
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

    function choiceRepresentative(menu, selected) {
      const items = directMenuItems(menu, "[data-select-folder-toggle]", "[data-select-value]");
      return items.find((item) => selected && (item === selected || item.closest(".select-choice-branch")?.contains(selected))) || items[0];
    }

    function focusMenuItem(picker, item) {
      if (!item) return null;
      picker.querySelectorAll(".is-picker-active").forEach((active) => active.classList.remove("is-picker-active"));
      item.classList.add("is-picker-active");
      focusWithinMenu(item);
      return item;
    }

    function focusSelectedChoice(select, menu, picker = select.closest(".select-choice-picker")) {
      const selected = [...menu.querySelectorAll("[data-select-value]")]
        .find((choice) => !choice.disabled && choice.dataset.selectValue === select.value);
      return focusMenuItem(picker, choiceRepresentative(menu, selected));
    }

    function focusIntoBranch(branch, select) {
      const submenu = branch?.querySelector(":scope > .select-choice-submenu");
      if (!submenu) return;
      const selected = [...submenu.querySelectorAll("[data-select-value]")]
        .find((choice) => !choice.disabled && choice.dataset.selectValue === select.value);
      return focusMenuItem(select.closest(".select-choice-picker"), choiceRepresentative(submenu, selected));
    }

    function sync(select) {
      const picker = select.closest(".select-choice-picker");
      if (!picker) return;
      const trigger = picker.querySelector("[data-select-picker-toggle]");
      const selectedLabel = selectedOptionLabel(select);
      // An opt-in short label affects only the closed control, never menu text or values.
      const compactLabel = select.selectedOptions?.[0]?.dataset.pickerLabel;
      if (trigger instanceof HTMLInputElement) trigger.value = compactLabel || selectedLabel;
      else {
        const label = trigger?.querySelector("strong");
        if (label) label.textContent = selectedLabel;
      }
      if (trigger) {
        trigger.disabled = select.disabled;
        trigger.title = selectedLabel;
        if (compactLabel) {
          trigger.setAttribute("aria-description", selectedLabel);
        } else {
          trigger.removeAttribute("aria-description");
        }
      }
      populateMenu(select, picker);
    }

    function positionMenu(picker) {
      const trigger = picker.querySelector("[data-select-picker-toggle]");
      const menu = picker.querySelector(".select-choice-menu");
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      anchorRects.set(picker, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      const edge = 12;
      const width = Math.min(SELECT_MENU_WIDTH, window.innerWidth - edge * 2);
      const model = buildOptionHierarchy([...picker.querySelectorAll(".select-choice-option")].map((option) => ({
        pickerPath: option.dataset.pickerPath || "",
      })));
      const domDepth = (container) => {
        let depth = 0;
        const branchContainer = container.querySelector(":scope > .select-choice-submenu-scroll") || container;
        branchContainer.querySelectorAll(":scope > .select-choice-branch").forEach((branch) => {
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
      menu.style.minWidth = "0";
      menu.style.maxWidth = `${width}px`;
      menu.style.right = "auto";
      menu.style.bottom = "auto";
      menu.style.left = `${Math.max(edge, Math.min(left, window.innerWidth - width - edge))}px`;
      menu.style.top = `${rect.bottom + 7}px`;
      const height = fitMenuSurface(menu);
      if (rect.bottom + 7 + height > window.innerHeight - edge && rect.top > height + edge) {
        menu.style.top = `${rect.top - height - 7}px`;
      }
    }

    function handleScroll(event) {
      if (event.target instanceof Element && event.target.closest(".select-choice-menu, .select-choice-submenu")) return;
      // Focus/scrollIntoView may queue scroll events before a picker opens.
      // Dismiss only when the anchor actually moved after it was positioned.
      for (const picker of document.querySelectorAll(".select-choice-picker.open")) {
        const previous = anchorRects.get(picker);
        const current = picker.querySelector("[data-select-picker-toggle]")?.getBoundingClientRect();
        if (!previous || !current || ["x", "y", "width", "height"].some((key) => Math.abs(previous[key] - current[key]) > 0.5)) {
          close();
          return;
        }
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
      trigger.className = "select-choice-trigger";
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
      menu.setAttribute("popover", "manual");
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", label);

      select.before(picker);
      picker.append(select, trigger, menu);
      select.classList.add("select-choice-native");
      select.hidden = true;
      select.tabIndex = -1;
      select.setAttribute("aria-hidden", "true");
      sync(select);

      picker.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        if (event.target.closest(".select-choice-menu")) pointerActivePicker = picker;
      });
      picker.addEventListener("click", (event) => {
        const folder = event.target.closest("[data-select-folder-toggle]");
        if (folder) {
          setSubmenuOpen(folder.closest(".select-choice-branch"), true, positionSubmenu);
          event.preventDefault();
          return;
        }
        const choice = event.target.closest("[data-select-value]");
        if (choice && !choice.disabled) {
          const badgeSnapshot = typeBadge?.capture(select);
          const changed = select.value !== choice.dataset.selectValue;
          select.value = choice.dataset.selectValue;
          sync(select);
          close();
          trigger.focus({ preventScroll: true });
          if (changed) {
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
            typeBadge?.restore(badgeSnapshot);
          }
          event.preventDefault();
          return;
        }
        if (!event.target.closest("[data-select-picker-toggle]")) return;
        const opening = !picker.classList.contains("open");
        beforeOpen();
        close(opening ? picker : null);
        picker.classList.toggle("open", opening);
        typeBadge?.setOpen(select, opening);
        trigger.setAttribute("aria-expanded", String(opening));
        if (opening) {
          populateMenu(select, picker);
          showMenuSurface(menu);
          positionMenu(picker);
          focusSelectedChoice(select, menu);
        } else {
          hideMenuSurface(menu);
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
        const item = event.target.closest("[data-select-folder-toggle], [data-select-value]");
        if (item) {
          picker.querySelectorAll(".is-picker-active").forEach((active) => active.classList.remove("is-picker-active"));
          item.classList.add("is-picker-active");
        }
        const branch = event.target.closest(".select-choice-branch");
        if (branch) {
          setSubmenuOpen(branch, true, positionSubmenu);
          return;
        }
        const menu = event.target.closest(".select-choice-menu, .select-choice-submenu");
        const container = menu?.querySelector(":scope > .select-choice-submenu-scroll") || menu;
        [...(container?.children || [])].forEach((item) => {
          if (item.classList?.contains("select-choice-branch")) closeSubmenuTree(item);
        });
      });
      picker.addEventListener("focusout", (event) => {
        if (!picker.contains(event.relatedTarget) && pointerActivePicker !== picker) close();
      });
      picker.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && (picker.classList.contains("open") || event.target !== trigger)) {
          close();
          trigger.focus({ preventScroll: true });
          event.preventDefault();
          return;
        }
        const navigationKeys = ["ArrowDown", "ArrowUp", "Home", "End"];
        if (event.target === trigger && navigationKeys.includes(event.key) && !picker.classList.contains("open")) {
          trigger.click();
          const options = directMenuItems(menu, "[data-select-folder-toggle]", "[data-select-value]");
          if (event.key === "Home") focusMenuItem(picker, options[0]);
          else if (event.key === "End") focusMenuItem(picker, options[options.length - 1]);
          event.preventDefault();
          return;
        }
        const activeItem = event.target.closest("[data-select-folder-toggle], [data-select-value]")
          || picker.querySelector(".is-picker-active")
          || focusSelectedChoice(select, menu, picker);
        const folder = activeItem?.matches("[data-select-folder-toggle]") ? activeItem : null;
        const choice = activeItem?.matches("[data-select-value]") ? activeItem : null;
        if (folder && ["Enter", " ", "ArrowRight"].includes(event.key)) {
          const branch = folder.closest(".select-choice-branch");
          setSubmenuOpen(branch, true, positionSubmenu);
          focusIntoBranch(branch, select);
          event.preventDefault();
          return;
        }
        if (event.key === "ArrowLeft" && activeItem?.closest(".select-choice-submenu")) {
          const branch = activeItem.closest(".select-choice-submenu").parentElement;
          setSubmenuOpen(branch, false, positionSubmenu);
          focusMenuItem(picker, branch.querySelector(":scope > [data-select-folder-toggle]"));
          event.preventDefault();
          return;
        }
        if ((folder || choice) && navigationKeys.includes(event.key)) {
          focusRelativeMenuItem(activeItem, event.key, "[data-select-folder-toggle]", "[data-select-value]");
          event.preventDefault();
        } else if (choice && ["Enter", " "].includes(event.key)) {
          choice.click();
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
      handleScroll,
      enhance,
      enhanceAll,
      hierarchy: {
        clearSubmenuClose,
        directMenuItems,
        fitMenuSurface,
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
