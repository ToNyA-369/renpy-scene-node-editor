"use strict";

(function exposeListReorder(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneListReorder = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function reorderIds(ids, sourceId, targetId = null, position = "before") {
    const source = String(sourceId || "");
    const order = (ids || []).map(String);
    const sourceIndex = order.indexOf(source);
    if (sourceIndex < 0) return order;
    order.splice(sourceIndex, 1);
    if (targetId === null || targetId === undefined || targetId === "") {
      order.push(source);
      return order;
    }
    const targetIndex = order.indexOf(String(targetId));
    if (targetIndex < 0) return (ids || []).map(String);
    order.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);
    return order;
  }

  function insertionPosition(pointerY, rect, previousPosition = null, hysteresisRatio = 0.16) {
    const center = rect.top + rect.height / 2;
    const deadBand = Math.min(14, Math.max(5, rect.height * hysteresisRatio));
    if (previousPosition === "before" && pointerY < center + deadBand) return "before";
    if (previousPosition === "after" && pointerY > center - deadBand) return "after";
    return pointerY < center ? "before" : "after";
  }

  function edgeScrollDelta(pointerY, top, bottom, edgeSize = 58, maximum = 18) {
    if (pointerY < top + edgeSize) {
      const progress = Math.min(1, Math.max(0, (top + edgeSize - pointerY) / edgeSize));
      return -maximum * progress * progress;
    }
    if (pointerY > bottom - edgeSize) {
      const progress = Math.min(1, Math.max(0, (pointerY - (bottom - edgeSize)) / edgeSize));
      return maximum * progress * progress;
    }
    return 0;
  }

  function createController({
    root,
    itemSelector,
    handleSelector = null,
    ignoreSelector = null,
    getItemId = (element) => element.dataset.reorderId,
    onDrop,
    onError = () => {},
  }) {
    if (!root) return { destroy() {} };
    const MOVE_THRESHOLD = 7;
    const REFLOW_DURATION = 160;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const controller = new AbortController();
    const { signal } = controller;
    const reflowAnimations = new WeakMap();
    let press = null;
    let source = null;
    let preview = null;
    let placement = null;
    let layoutFrame = 0;
    let pendingPoint = null;
    let scrollContainer = null;
    let previousOverflowAnchor = null;
    let previousUserSelect = null;
    let suppressClickUntil = 0;

    const closest = (target, selector) => {
      const element = target?.closest?.(selector);
      return element && root.contains(element) ? element : null;
    };
    const items = () => [...root.querySelectorAll(itemSelector)];
    const movableItems = () => items().filter((element) => element !== source);
    const captureRects = () => new Map(
      movableItems().map((element) => [element, element.getBoundingClientRect()]),
    );
    const animateReflow = (before) => {
      if (reducedMotion) return;
      before.forEach((oldRect, element) => {
        if (!element.isConnected) return;
        const nextRect = element.getBoundingClientRect();
        const x = oldRect.left - nextRect.left;
        const y = oldRect.top - nextRect.top;
        if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) return;
        reflowAnimations.get(element)?.cancel();
        const animation = element.animate([
          { transform: `translate3d(${x}px, ${y}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ], {
          duration: REFLOW_DURATION,
          easing: "cubic-bezier(0.2, 0.82, 0.2, 1)",
        });
        reflowAnimations.set(element, animation);
        const clear = () => reflowAnimations.delete(element);
        animation.addEventListener("finish", clear, { once: true });
        animation.addEventListener("cancel", clear, { once: true });
      });
    };
    const findScrollContainer = () => {
      let element = root.parentElement;
      while (element && element !== document.body) {
        const style = window.getComputedStyle(element);
        if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) return element;
        element = element.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    };
    const setScrollContainer = (element) => {
      if (scrollContainer === element) return;
      if (scrollContainer && previousOverflowAnchor !== null) scrollContainer.style.overflowAnchor = previousOverflowAnchor;
      scrollContainer = element;
      previousOverflowAnchor = element?.style.overflowAnchor ?? null;
      if (element) element.style.overflowAnchor = "none";
    };
    const createPreview = (element, rect) => {
      const wrapper = document.createElement("div");
      wrapper.className = "list-reorder-preview";
      if (element.matches(".option-item-row")) wrapper.classList.add("is-option-item-preview");
      wrapper.style.width = `${rect.width}px`;
      wrapper.style.height = `${rect.height}px`;
      const clone = element.cloneNode(true);
      const sourceControls = element.querySelectorAll("input, select, textarea");
      const cloneControls = clone.querySelectorAll("input, select, textarea");
      sourceControls.forEach((control, index) => {
        const cloneControl = cloneControls[index];
        if (!cloneControl) return;
        if (control.type === "checkbox" || control.type === "radio") cloneControl.checked = control.checked;
        else cloneControl.value = control.value;
      });
      clone.removeAttribute("id");
      clone.classList.remove("is-list-reorder-dragging");
      clone.setAttribute("aria-hidden", "true");
      clone.querySelectorAll("[id]").forEach((child) => child.removeAttribute("id"));
      clone.querySelectorAll("input, button, select, textarea, [tabindex]").forEach((child) => {
        child.setAttribute("tabindex", "-1");
        if ("disabled" in child) child.disabled = true;
      });
      if (element.tagName === "TR") {
        wrapper.classList.add("is-table-row-preview");
        const sourceTable = element.closest("table");
        const table = document.createElement("table");
        table.className = sourceTable?.className || "";
        table.style.width = `${rect.width}px`;
        table.style.tableLayout = "fixed";
        const colgroup = document.createElement("colgroup");
        [...element.children].forEach((cell) => {
          const col = document.createElement("col");
          col.style.width = `${cell.getBoundingClientRect().width}px`;
          colgroup.appendChild(col);
        });
        const tbody = document.createElement("tbody");
        tbody.appendChild(clone);
        table.append(colgroup, tbody);
        wrapper.appendChild(table);
      } else {
        wrapper.appendChild(clone);
      }
      document.body.appendChild(wrapper);
      return wrapper;
    };
    const updatePreview = (event) => {
      if (!preview || !press) return;
      preview.style.transform = `translate3d(${event.clientX - press.grabX}px, ${event.clientY - press.grabY}px, 0)`;
    };
    const restoreSource = () => {
      if (!source?.isConnected || !press?.originalParent?.isConnected) return;
      const before = captureRects();
      const next = press.originalNextSibling?.parentNode === press.originalParent
        ? press.originalNextSibling
        : null;
      press.originalParent.insertBefore(source, next);
      animateReflow(before);
    };
    const setPlacement = (nextPlacement) => {
      if (!source || !nextPlacement) return;
      const beforeNode = nextPlacement.position === "before"
        ? nextPlacement.target
        : nextPlacement.target?.nextSibling || null;
      const normalizedBefore = beforeNode === source ? source.nextSibling : beforeNode;
      if (source.parentNode === root && source.nextSibling === normalizedBefore) {
        placement = nextPlacement;
        return;
      }
      const before = captureRects();
      root.insertBefore(source, normalizedBefore);
      placement = nextPlacement;
      animateReflow(before);
    };
    const resolvePlacement = (point) => {
      const rootRect = root.getBoundingClientRect();
      if (
        point.clientX < rootRect.left || point.clientX > rootRect.right
        || point.clientY < rootRect.top - 12 || point.clientY > rootRect.bottom + 28
      ) return null;
      const candidates = movableItems();
      if (!candidates.length) return { target: null, targetId: null, position: "after" };
      const currentTarget = placement?.target;
      if (currentTarget?.isConnected) {
        const rect = currentTarget.getBoundingClientRect();
        const position = insertionPosition(
          point.clientY,
          rect,
          placement.position,
        );
        const deadBand = Math.min(18, Math.max(7, rect.height * 0.2));
        if (point.clientY >= rect.top - deadBand && point.clientY <= rect.bottom + deadBand) {
          return { target: currentTarget, targetId: getItemId(currentTarget), position };
        }
      }
      const target = candidates.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return point.clientY < rect.top + rect.height / 2;
      });
      if (target) return { target, targetId: getItemId(target), position: "before" };
      const last = candidates[candidates.length - 1];
      return { target: last, targetId: getItemId(last), position: "after" };
    };
    const processPoint = () => {
      layoutFrame = 0;
      if (!press?.dragging || !pendingPoint) return;
      const nextPlacement = resolvePlacement(pendingPoint);
      if (nextPlacement) setPlacement(nextPlacement);
      else placement = null;
      if (scrollContainer) {
        const rect = scrollContainer === document.scrollingElement || scrollContainer === document.documentElement
          ? { top: 0, bottom: window.innerHeight }
          : scrollContainer.getBoundingClientRect();
        const delta = edgeScrollDelta(pendingPoint.clientY, rect.top, rect.bottom);
        if (delta) {
          scrollContainer.scrollTop += delta;
          layoutFrame = window.requestAnimationFrame(processPoint);
        }
      }
    };
    const queuePoint = (event) => {
      const coalesced = event.getCoalescedEvents?.() || [];
      const latest = coalesced[coalesced.length - 1] || event;
      pendingPoint = { clientX: latest.clientX, clientY: latest.clientY };
      updatePreview(latest);
      if (!layoutFrame) layoutFrame = window.requestAnimationFrame(processPoint);
    };
    const startDrag = (event) => {
      source = press.source;
      const rect = source.getBoundingClientRect();
      press.grabX = press.startX - rect.left;
      press.grabY = press.startY - rect.top;
      previousUserSelect = document.documentElement.style.userSelect;
      document.documentElement.style.userSelect = "none";
      window.getSelection?.()?.removeAllRanges();
      preview = createPreview(source, rect);
      source.classList.add("is-list-reorder-dragging");
      source.style.visibility = "hidden";
      source.setAttribute("aria-grabbed", "true");
      root.classList.add("is-list-reordering");
      setScrollContainer(findScrollContainer());
      press.dragging = true;
      queuePoint(event);
    };
    const clearVisuals = () => {
      source?.classList.remove("is-list-reorder-dragging");
      if (source) source.style.visibility = "";
      source?.setAttribute("aria-grabbed", "false");
      root.classList.remove("is-list-reordering");
      preview?.remove();
      preview = null;
      document.documentElement.style.userSelect = previousUserSelect ?? "";
      previousUserSelect = null;
      if (scrollContainer && previousOverflowAnchor !== null) scrollContainer.style.overflowAnchor = previousOverflowAnchor;
      scrollContainer = null;
      previousOverflowAnchor = null;
    };
    const finish = async (event, cancelled = false) => {
      if (!press || event.pointerId !== press.pointerId) return;
      if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
      layoutFrame = 0;
      if (!press.dragging) {
        press = null;
        return;
      }
      const completedPress = press;
      completedPress.dragging = false;
      const completedSource = source;
      const completedPlacement = placement;
      if (cancelled || !completedPlacement) restoreSource();
      const orderedIds = items().map((item) => String(getItemId(item)));
      clearVisuals();
      suppressClickUntil = performance.now() + 350;
      press = completedPress;
      source = completedSource;
      try {
        if (!cancelled && completedPlacement) {
          const accepted = await onDrop?.({
            sourceId: String(getItemId(completedSource)),
            targetId: completedPlacement.targetId === null ? null : String(completedPlacement.targetId),
            position: completedPlacement.position,
            orderedIds,
          });
          if (accepted === false) restoreSource();
        }
      } catch (error) {
        restoreSource();
        onError(error);
      } finally {
        press = null;
        source = null;
        placement = null;
        pendingPoint = null;
      }
    };
    const pointerDown = (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      if (ignoreSelector && event.target.closest?.(ignoreSelector)) return;
      const item = closest(event.target, itemSelector);
      if (!item) return;
      const handle = handleSelector ? closest(event.target, handleSelector) : item;
      if (!handle) return;
      const interactive = event.target.closest?.("input, textarea, select, button, a, [contenteditable='true']");
      if (!handleSelector && interactive && interactive !== item) return;
      press = {
        source: item,
        handle,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originalParent: item.parentNode,
        originalNextSibling: item.nextSibling,
        dragging: false,
      };
      handle.setPointerCapture?.(event.pointerId);
    };
    const pointerMove = (event) => {
      if (!press || event.pointerId !== press.pointerId) return;
      if (!press.dragging) {
        const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
        if (distance < MOVE_THRESHOLD) return;
        event.preventDefault();
        startDrag(event);
        return;
      }
      event.preventDefault();
      queuePoint(event);
    };

    root.addEventListener("pointerdown", pointerDown, { signal });
    window.addEventListener("pointermove", pointerMove, { capture: true, signal });
    window.addEventListener("pointerup", (event) => finish(event), { capture: true, signal });
    window.addEventListener("pointercancel", (event) => finish(event, true), { capture: true, signal });
    root.addEventListener("click", (event) => {
      if (performance.now() > suppressClickUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, signal });

    return {
      destroy() {
        controller.abort();
        if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
        if (press?.dragging) restoreSource();
        clearVisuals();
        press = null;
        source = null;
      },
    };
  }

  return Object.freeze({ createController, edgeScrollDelta, insertionPosition, reorderIds });
});
