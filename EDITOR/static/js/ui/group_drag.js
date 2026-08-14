"use strict";

(function exposeGroupDrag(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneGroupDrag = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DEFAULT_DWELL_MS = 500;

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

  function normalizeGroup(value, defaultGroup = "Normal") {
    return String(value || "").trim() || defaultGroup;
  }

  function uniqueGroupName(items, baseName, defaultGroup = "Normal") {
    const names = new Set((items || []).map((item) => normalizeGroup(item.group, defaultGroup).toLocaleLowerCase()));
    const base = String(baseName || "New Group").trim() || "New Group";
    let candidate = base;
    let suffix = 2;
    while (names.has(candidate.toLocaleLowerCase())) {
      candidate = `${base} ${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function planGroupDrop(items, {
    sourceId,
    targetId = null,
    targetGroup = null,
    position = "after",
    newGroupName = "New Group",
    defaultGroup = "Normal",
    dissolveSingleton = true,
  }) {
    const source = (items || []).find((item) => item.id === sourceId);
    const target = targetId ? items.find((item) => item.id === targetId) : null;
    if (!source || (targetId && !target) || target?.id === source.id) return null;

    const sourceGroup = normalizeGroup(source.group, defaultGroup);
    const assignments = {};
    let destination = targetGroup == null ? null : normalizeGroup(targetGroup, defaultGroup);
    let createdGroup = null;

    if (target) {
      const targetItemGroup = normalizeGroup(target.group, defaultGroup);
      if (targetItemGroup === defaultGroup) {
        createdGroup = uniqueGroupName(items, newGroupName, defaultGroup);
        destination = createdGroup;
        assignments[target.id] = destination;
      } else {
        destination = targetItemGroup;
      }
    }
    if (!destination || destination === sourceGroup && !createdGroup) return null;
    assignments[source.id] = destination;

    if (dissolveSingleton && sourceGroup !== defaultGroup && sourceGroup !== destination) {
      const remaining = items.filter((item) => (
        item.id !== source.id
        && normalizeGroup(assignments[item.id] ?? item.group, defaultGroup) === sourceGroup
      ));
      if (remaining.length === 1) assignments[remaining[0].id] = defaultGroup;
    }

    const order = reorderIds(items, sourceId, targetId, position, destination, defaultGroup);
    return { assignments, destination, createdGroup, order };
  }

  function reorderIds(items, sourceId, targetId = null, position = "before", targetGroup = null, defaultGroup = "Normal") {
    const source = (items || []).find((item) => item.id === sourceId);
    if (!source) return [];
    const ids = items.map((item) => item.id).filter((id) => id !== sourceId);
    if (targetId) {
      const targetIndex = ids.indexOf(targetId);
      if (targetIndex < 0) return items.map((item) => item.id);
      ids.splice(targetIndex + (position === "after" ? 1 : 0), 0, sourceId);
      return ids;
    }
    const destination = normalizeGroup(targetGroup, defaultGroup);
    let insertionIndex = -1;
    ids.forEach((id, index) => {
      const item = items.find((candidate) => candidate.id === id);
      if (normalizeGroup(item?.group, defaultGroup) === destination) insertionIndex = index;
    });
    ids.splice(insertionIndex + 1, 0, sourceId);
    return ids;
  }

  function planReorder(items, {
    sourceId,
    targetId = null,
    targetGroup = null,
    position = "before",
    defaultGroup = "Normal",
    dissolveSingleton = true,
  }) {
    const source = (items || []).find((item) => item.id === sourceId);
    const target = targetId ? items.find((item) => item.id === targetId) : null;
    if (!source || target?.id === source.id || targetId && !target) return null;
    const sourceGroup = normalizeGroup(source.group, defaultGroup);
    const destination = targetGroup == null
      ? normalizeGroup(target?.group, defaultGroup)
      : normalizeGroup(targetGroup, defaultGroup);
    const assignments = sourceGroup === destination ? {} : { [source.id]: destination };
    if (dissolveSingleton && sourceGroup !== defaultGroup && sourceGroup !== destination) {
      const remaining = items.filter((item) => (
        item.id !== source.id && normalizeGroup(item.group, defaultGroup) === sourceGroup
      ));
      if (remaining.length === 1) assignments[remaining[0].id] = defaultGroup;
    }
    const order = reorderIds(items, sourceId, targetId, position, destination, defaultGroup);
    const unchangedOrder = order.every((id, index) => id === items[index]?.id);
    if (!Object.keys(assignments).length && unchangedOrder) return null;
    return { assignments, destination, createdGroup: null, order };
  }

  function planGroupBlockReorder(items, {
    sourceGroup,
    targetId = null,
    position = "before",
    defaultGroup = "Normal",
  }) {
    const group = normalizeGroup(sourceGroup, defaultGroup);
    if (group === defaultGroup) return null;
    const members = (items || []).filter((item) => normalizeGroup(item.group, defaultGroup) === group);
    if (!members.length) return null;
    const memberIds = new Set(members.map((item) => item.id));
    if (targetId && memberIds.has(targetId)) return null;
    const order = (items || []).map((item) => item.id).filter((id) => !memberIds.has(id));
    let insertionIndex = order.length;
    if (targetId) {
      const targetIndex = order.indexOf(targetId);
      if (targetIndex < 0) return null;
      insertionIndex = targetIndex + (position === "after" ? 1 : 0);
    }
    order.splice(insertionIndex, 0, ...members.map((item) => item.id));
    const unchanged = order.every((id, index) => id === items[index]?.id);
    return unchanged ? null : { assignments: {}, destination: group, createdGroup: null, order };
  }

  function createController({
    root,
    itemSelector,
    groupSelector,
    ungroupedSelector,
    handleSelector = null,
    groupHandleSelector = null,
    listSelector = null,
    defaultGroup = "Normal",
    dwellMs = DEFAULT_DWELL_MS,
    getItemId = (element) => element.dataset.groupItemId,
    getItemGroup = (element) => element.dataset.groupItemGroup,
    getGroupName = (element) => element.dataset.groupDrop,
    onDrop,
    onGroupDrop = null,
    onError = () => {},
  }) {
    if (!root) return { destroy() {} };
    const MOVE_THRESHOLD = 7;
    const REFLOW_DURATION = 160;
    const reflowAnimations = new WeakMap();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    let press = null;
    let source = null;
    let preview = null;
    let candidate = null;
    let candidateGroup = null;
    let dropReady = null;
    let dwellTimer = null;
    let suppressClickUntil = 0;
    let layoutFrame = 0;
    let pendingPoint = null;
    let scrollContainer = null;
    let previousOverflowAnchor = null;
    let previousDocumentUserSelect = null;

    const closest = (target, selector) => {
      const element = target?.closest?.(selector);
      return element && (element === root || root.contains(element)) ? element : null;
    };
    const groupList = (group) => {
      if (!group) return null;
      if (group === root || group.matches(ungroupedSelector)) return group;
      if (!listSelector || group.matches(listSelector)) return group;
      return group.querySelector(listSelector) || group;
    };
    const findScrollContainer = () => {
      let element = root.parentElement;
      while (element && element !== document.body) {
        const style = window.getComputedStyle(element);
        if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) return element;
        element = element.parentElement;
      }
      return null;
    };
    const setScrollContainer = (element) => {
      if (scrollContainer === element) return;
      if (scrollContainer && previousOverflowAnchor != null) {
        scrollContainer.style.overflowAnchor = previousOverflowAnchor;
      }
      scrollContainer = element;
      previousOverflowAnchor = element?.style.overflowAnchor ?? null;
      if (element) element.style.overflowAnchor = "none";
    };
    const captureRects = () => new Map(
      [...root.querySelectorAll(`${itemSelector}, ${groupSelector}`)]
        .filter((element) => element !== source)
        .map((element) => [element, element.getBoundingClientRect()]),
    );
    const animateReflow = (before) => {
      if (reducedMotion) return;
      before.forEach((oldRect, element) => {
        if (!element.isConnected || element === source) return;
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
        animation.addEventListener("finish", () => reflowAnimations.delete(element), { once: true });
        animation.addEventListener("cancel", () => reflowAnimations.delete(element), { once: true });
      });
    };
    const insertSource = (container, beforeNode = null) => {
      if (!container || !source) return;
      const normalizedBefore = beforeNode === source ? source.nextSibling : beforeNode;
      if (source.parentNode === container && source.nextSibling === normalizedBefore) return;
      const before = captureRects();
      container.insertBefore(source, normalizedBefore);
      animateReflow(before);
    };
    const restoreSource = (record = press) => {
      if (!record?.source?.isConnected || !record.originalParent?.isConnected) return;
      const before = captureRects();
      const next = record.originalNextSibling?.parentNode === record.originalParent
        ? record.originalNextSibling
        : null;
      record.originalParent.insertBefore(record.source, next);
      animateReflow(before);
    };
    const clearCandidate = () => {
      if (dwellTimer) window.clearTimeout(dwellTimer);
      dwellTimer = null;
      candidate?.classList.remove("is-group-candidate", "is-group-ready");
      candidateGroup?.classList.remove("is-group-preview-open");
      candidate = null;
      candidateGroup = null;
    };
    const clearDropTarget = () => {
      root.querySelectorAll(".is-group-drop-ready").forEach((element) => element.classList.remove("is-group-drop-ready"));
    };
    const clearVisuals = () => {
      clearCandidate();
      clearDropTarget();
      source?.classList.remove("is-group-dragging-item");
      source?.classList.remove("is-group-block-dragging");
      if (source) source.style.visibility = "";
      source?.setAttribute("aria-grabbed", "false");
      preview?.remove();
      preview = null;
      root.classList.remove("is-group-dragging");
    };

    const pointInside = (element, x = press?.currentX, y = press?.currentY) => {
      if (!element?.isConnected || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        && x >= rect.left && x <= rect.right
        && y >= rect.top && y <= rect.bottom;
    };

    const candidateStillContainsPointer = (item = candidate, group = candidateGroup) => (
      pointInside(item) || pointInside(group)
    );

    const beginCandidate = (item, group) => {
      if ((!item && !group) || item === source) return;
      if (candidate === item && candidateGroup === group) return;
      clearCandidate();
      candidate = item;
      candidateGroup = group;
      candidate?.classList.add("is-group-candidate");
      dwellTimer = window.setTimeout(() => {
        if (candidate !== item || candidateGroup !== group) return;
        if (!candidateStillContainsPointer(item, group)) {
          clearCandidate();
          if (dropReady?.mode === "group") dropReady.mode = "reorder";
          return;
        }
        if (item && dropReady?.targetId === getItemId(item)) dropReady.mode = "group";
        if (!item && group && dropReady?.targetGroup === normalizeGroup(getGroupName(group), defaultGroup)) {
          dropReady.mode = "group";
        }
        item?.classList.add("is-group-ready");
        group?.classList.add("is-group-preview-open");
      }, dwellMs);
    };

    const createPreview = (item, rect, { groupBlock = false, collapsedHeight = rect.height } = {}) => {
      const wrapper = document.createElement("div");
      wrapper.className = "group-drag-preview";
      if (groupBlock) wrapper.classList.add("is-group-block-preview");
      wrapper.style.width = `${rect.width}px`;
      wrapper.style.height = `${rect.height}px`;
      const clone = item.cloneNode(true);
      clone.removeAttribute("id");
      clone.classList.remove("is-group-candidate", "is-group-ready", "is-group-dragging-item");
      if (groupBlock) clone.classList.add("is-group-preview-open");
      clone.setAttribute("aria-hidden", "true");
      clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      clone.querySelectorAll("input, button, select, textarea, [tabindex]").forEach((element) => {
        element.setAttribute("tabindex", "-1");
        if ("disabled" in element) element.disabled = true;
      });
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);
      if (groupBlock) {
        const collapse = () => {
          clone.classList.remove("is-group-preview-open");
          clone.classList.add("is-group-block-dragging");
          wrapper.style.height = `${collapsedHeight}px`;
        };
        if (reducedMotion) collapse();
        else window.requestAnimationFrame(collapse);
      }
      return wrapper;
    };

    const updatePreview = (event) => {
      if (!preview || !press) return;
      preview.style.transform = `translate3d(${event.clientX - press.grabX}px, ${event.clientY - press.grabY}px, 0)`;
    };

    const directChildren = (container, selector) => [...container.children]
      .filter((element) => element !== source && element.matches(selector));

    const orderAnchorForBlock = (block, position) => {
      if (block.matches(itemSelector)) return getItemId(block);
      const items = [...block.querySelectorAll(itemSelector)].filter((item) => item !== source);
      if (!items.length) return null;
      return getItemId(position === "before" ? items[0] : items[items.length - 1]);
    };

    const placementInList = (list, y) => {
      const items = directChildren(list, itemSelector);
      if (!items.length) return { beforeNode: null, targetId: null, position: "after" };
      const beforeItem = items.find((item) => {
        const rect = item.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
      });
      if (beforeItem) {
        return { beforeNode: beforeItem, targetId: getItemId(beforeItem), position: "before" };
      }
      const last = items[items.length - 1];
      return { beforeNode: last.nextSibling, targetId: getItemId(last), position: "after" };
    };

    const placementInLooseFlow = (y) => {
      const blocks = directChildren(root, `${itemSelector}, ${groupSelector}`);
      if (!blocks.length) return { beforeNode: null, targetId: null, position: "after" };
      const beforeBlock = blocks.find((block) => {
        const rect = block.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
      });
      if (beforeBlock) {
        return {
          beforeNode: beforeBlock,
          targetId: orderAnchorForBlock(beforeBlock, "before"),
          position: "before",
        };
      }
      const last = blocks[blocks.length - 1];
      return {
        beforeNode: last.nextSibling,
        targetId: orderAnchorForBlock(last, "after"),
        position: "after",
      };
    };

    const resolvePlacement = (event) => {
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (!hit) return null;
      if (press?.kind === "group") {
        const rootRect = root.getBoundingClientRect();
        if (
          event.clientX < rootRect.left || event.clientX > rootRect.right
          || event.clientY < rootRect.top - 12 || event.clientY > rootRect.bottom + 12
        ) return null;
        return {
          container: root,
          ...placementInLooseFlow(event.clientY),
          targetGroup: defaultGroup,
          candidate: null,
          group: null,
        };
      }
      let item = closest(hit, itemSelector);
      if (item === source) item = null;
      if (item) {
        const group = closest(item, groupSelector);
        const container = groupList(group || root);
        const rect = item.getBoundingClientRect();
        const itemId = getItemId(item);
        const previousPosition = dropReady?.targetId === itemId ? dropReady.position : null;
        const position = insertionPosition(event.clientY, rect, previousPosition);
        return {
          container,
          beforeNode: position === "before" ? item : item.nextSibling,
          targetId: itemId,
          targetGroup: group ? normalizeGroup(getGroupName(group), defaultGroup) : defaultGroup,
          position,
          candidate: item,
          group,
        };
      }
      const group = closest(hit, groupSelector);
      if (group) {
        const container = groupList(group);
        return {
          container,
          ...placementInList(container, event.clientY),
          targetGroup: normalizeGroup(getGroupName(group), defaultGroup),
          candidate: null,
          group,
        };
      }
      const rootRect = root.getBoundingClientRect();
      const insideRoot = root.contains(hit) || (
        event.clientX >= rootRect.left && event.clientX <= rootRect.right
        && event.clientY >= rootRect.top - 12 && event.clientY <= rootRect.bottom + 12
      );
      if (!insideRoot) return null;
      return {
        container: groupList(closest(hit, ungroupedSelector) || root),
        ...placementInLooseFlow(event.clientY),
        targetGroup: defaultGroup,
        candidate: null,
        group: null,
      };
    };

    const startDrag = (event) => {
      source = press.source;
      window.getSelection?.()?.removeAllRanges();
      previousDocumentUserSelect = document.documentElement.style.userSelect;
      document.documentElement.style.userSelect = "none";
      const rect = source.getBoundingClientRect();
      const groupItems = press.kind === "group" ? groupList(source) : null;
      const collapsedHeight = groupItems
        ? Math.max(38, rect.height - groupItems.getBoundingClientRect().height)
        : rect.height;
      press.handle.setPointerCapture?.(press.pointerId);
      press.grabX = press.startX - rect.left;
      press.grabY = press.startY - rect.top;
      preview = createPreview(source, rect, { groupBlock: press.kind === "group", collapsedHeight });
      if (press.kind === "group") source.classList.add("is-group-block-dragging");
      source.classList.add("is-group-dragging-item");
      source.style.visibility = "hidden";
      source.setAttribute("aria-grabbed", "true");
      root.classList.add("is-group-dragging");
      setScrollContainer(findScrollContainer());
      press.dragging = true;
      updatePreview(event);
    };

    const handlePointerDown = (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const groupHandle = groupHandleSelector ? closest(event.target, groupHandleSelector) : null;
      const handle = groupHandle || (handleSelector ? closest(event.target, handleSelector) : closest(event.target, itemSelector));
      if (!handle) return;
      const kind = groupHandle ? "group" : "item";
      const item = kind === "group" ? closest(handle, groupSelector) : closest(handle, itemSelector);
      if (!item) return;
      const interactive = !handleSelector
        ? event.target.closest("input, textarea, select, button, a, [contenteditable='true']")
        : null;
      if (interactive && interactive !== item) return;
      if (kind === "group" || !item.matches("button, a")) event.preventDefault();
      press = {
        source: item,
        handle,
        kind,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        originalParent: item.parentNode,
        originalNextSibling: item.nextSibling,
        dragging: false,
      };
    };

    const processPlacement = (point) => {
      if (!press?.dragging) return;
      const placement = resolvePlacement(point);
      if (!placement) {
        clearCandidate();
        clearDropTarget();
        dropReady = null;
        return;
      }
      insertSource(placement.container, placement.beforeNode);
      clearDropTarget();
      placement.group?.classList.add("is-group-drop-ready");
      dropReady = {
        mode: press.kind === "group"
          ? "group-reorder"
          : placement.candidate?.classList.contains("is-group-ready") ? "group" : "reorder",
        targetId: placement.targetId,
        targetGroup: placement.targetGroup,
        position: placement.position,
      };
      if (press.kind === "group") {
        clearCandidate();
      } else {
        const hoveredItem = pointInside(placement.candidate) ? placement.candidate : null;
        const hoveredGroup = pointInside(placement.group) ? placement.group : null;
        if (hoveredItem || hoveredGroup) beginCandidate(hoveredItem, hoveredGroup);
        else clearCandidate();
      }
    };

    const autoScroll = (point) => {
      if (!scrollContainer?.isConnected) setScrollContainer(findScrollContainer());
      if (!scrollContainer?.isConnected) return false;
      const rect = scrollContainer.getBoundingClientRect();
      if (point.clientX < rect.left || point.clientX > rect.right) return false;
      const delta = edgeScrollDelta(point.clientY, rect.top, rect.bottom);
      if (!delta) return false;
      const before = scrollContainer.scrollTop;
      scrollContainer.scrollTop += delta;
      return Math.abs(scrollContainer.scrollTop - before) > 0.1;
    };

    const runLayoutFrame = () => {
      layoutFrame = 0;
      if (!press?.dragging || !pendingPoint) return;
      const point = pendingPoint;
      const scrolled = autoScroll(point);
      processPlacement(point);
      if (scrolled) layoutFrame = window.requestAnimationFrame(runLayoutFrame);
    };

    const scheduleLayoutFrame = (point) => {
      pendingPoint = point;
      if (!layoutFrame) layoutFrame = window.requestAnimationFrame(runLayoutFrame);
    };

    const flushLayoutFrame = (point = pendingPoint) => {
      if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
      layoutFrame = 0;
      if (point && press?.dragging) {
        pendingPoint = point;
        processPlacement(point);
      }
    };

    const handlePointerMove = (event) => {
      if (!press || event.pointerId !== press.pointerId) return;
      press.currentX = event.clientX;
      press.currentY = event.clientY;
      const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
      if (!press.dragging && distance < MOVE_THRESHOLD) return;
      if (!press.dragging) startDrag(event);
      event.preventDefault();
      updatePreview(event);
      scheduleLayoutFrame({ clientX: event.clientX, clientY: event.clientY });
    };

    const finish = (event, cancelled = false) => {
      if (!press || event?.pointerId != null && event.pointerId !== press.pointerId) return;
      const record = press;
      if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
      layoutFrame = 0;
      pendingPoint = null;
      setScrollContainer(null);
      if (previousDocumentUserSelect != null) {
        document.documentElement.style.userSelect = previousDocumentUserSelect;
        previousDocumentUserSelect = null;
      }
      if (event?.clientX != null) {
        press.currentX = event.clientX;
        press.currentY = event.clientY;
      }
      if (dropReady?.mode === "group" && !candidateStillContainsPointer()) dropReady.mode = "reorder";
      const detail = record.dragging && !cancelled && dropReady
        ? record.kind === "group"
          ? { sourceGroup: normalizeGroup(getGroupName(record.source), defaultGroup), ...dropReady }
          : { sourceId: getItemId(record.source), ...dropReady }
        : null;
      if (record.dragging) suppressClickUntil = Date.now() + 80;
      clearVisuals();
      if (record.dragging && (cancelled || !detail)) restoreSource(record);
      try {
        if (record.handle?.hasPointerCapture?.(record.pointerId)) record.handle.releasePointerCapture(record.pointerId);
      } catch (_error) {
        // Pointer capture may already have been released by the browser.
      }
      press = null;
      source = null;
      dropReady = null;
      if (!detail) return;
      const dropHandler = record.kind === "group" ? onGroupDrop : onDrop;
      if (!dropHandler) {
        restoreSource(record);
        return;
      }
      Promise.resolve(dropHandler(detail))
        .then((saved) => {
          if (saved === false && record.source.isConnected) restoreSource(record);
        })
        .catch((error) => {
          if (record.source.isConnected) restoreSource(record);
          onError(error);
        });
    };

    const handlePointerUp = (event) => {
      if (press?.dragging && event.pointerId === press.pointerId) {
        flushLayoutFrame({ clientX: event.clientX, clientY: event.clientY });
      }
      finish(event, false);
    };
    const handlePointerCancel = (event) => finish(event, true);
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && press?.dragging) finish(null, true);
    };
    const suppressDraggedClick = (event) => {
      if (Date.now() >= suppressClickUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    root.addEventListener("pointerdown", handlePointerDown);
    root.addEventListener("click", suppressDraggedClick, true);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);

    return {
      destroy() {
        if (press) finish(null, true);
        root.removeEventListener("pointerdown", handlePointerDown);
        root.removeEventListener("click", suppressDraggedClick, true);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        window.removeEventListener("keydown", handleKeyDown);
      },
    };
  }

  return {
    DEFAULT_DWELL_MS,
    createController,
    edgeScrollDelta,
    insertionPosition,
    normalizeGroup,
    planGroupDrop,
    planGroupBlockReorder,
    planReorder,
    reorderIds,
    uniqueGroupName,
  };
});
