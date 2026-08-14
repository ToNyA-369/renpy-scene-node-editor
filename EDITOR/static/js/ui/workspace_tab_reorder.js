"use strict";

(function exposeWorkspaceTabReorder(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneWorkspaceTabReorder = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function horizontalGeometry(pointerX, grabOffset, width, trackStart, trackEnd) {
    const safeWidth = Math.max(0, Number(width) || 0);
    const minimum = Number(trackStart) || 0;
    const maximum = Math.max(minimum, (Number(trackEnd) || minimum) - safeWidth);
    const desiredStart = (Number(pointerX) || 0) - (Number(grabOffset) || 0);
    const start = Math.min(maximum, Math.max(minimum, desiredStart));
    return { start, center: start + safeWidth / 2, end: start + safeWidth };
  }

  function targetIndexForGeometry(geometry, siblingRects, trackStart, trackEnd, previousIndex = null) {
    if (!siblingRects.length) return 0;
    if (geometry.start <= trackStart + 0.5) return 0;
    if (geometry.end >= trackEnd - 0.5) return siblingRects.length;
    let candidate = siblingRects.findIndex((rect) => geometry.center < rect.left + rect.width / 2);
    if (candidate < 0) candidate = siblingRects.length;
    if (previousIndex === null || candidate === previousIndex) return candidate;
    const deadBand = 8;
    if (candidate > previousIndex) {
      const crossed = siblingRects[Math.max(0, candidate - 1)];
      if (crossed && geometry.center < crossed.left + crossed.width / 2 + deadBand) return previousIndex;
    } else {
      const crossed = siblingRects[Math.min(siblingRects.length - 1, candidate)];
      if (crossed && geometry.center > crossed.left + crossed.width / 2 - deadBand) return previousIndex;
    }
    return candidate;
  }

  function reorderedIds(ids, sourceIndex, targetIndex) {
    const next = [...ids];
    const [source] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, source);
    return next;
  }

  function createController({
    root,
    itemSelector = ".tab[data-reorder-id]",
    getItemId = (element) => element.dataset.reorderId,
    onDrop,
    onSettled = () => {},
    onError = () => {},
  }) {
    if (!root) return { destroy() {} };
    const MOVE_THRESHOLD = 7;
    const SETTLE_DURATION = 180;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const controller = new AbortController();
    const { signal } = controller;
    const settleAnimations = new Set();
    let press = null;
    let dragging = false;
    let finishing = false;
    let suppressClickUntil = 0;

    const items = () => [...root.querySelectorAll(itemSelector)];
    const applyOrder = (order) => {
      const byId = new Map(items().map((item) => [String(getItemId(item)), item]));
      order.forEach((id) => {
        const item = byId.get(String(id));
        if (item) root.append(item);
      });
    };
    const clearTransforms = () => {
      items().forEach((item) => {
        item.style.transform = "";
        item.classList.remove("is-workspace-tab-dragging");
        item.setAttribute("aria-grabbed", "false");
      });
    };
    const captureVisualRects = () => new Map(items().map((item) => [item, item.getBoundingClientRect()]));
    const settleFrom = async (beforeRects) => {
      root.classList.remove("is-workspace-tab-reordering");
      root.classList.add("is-workspace-tab-settling");
      clearTransforms();
      if (!reducedMotion) {
        const animations = items().flatMap((item) => {
          const before = beforeRects.get(item);
          if (!before) return [];
          const after = item.getBoundingClientRect();
          const x = before.left - after.left;
          const y = before.top - after.top;
          if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) return [];
          const animation = item.animate([
            { transform: `translate3d(${x}px, ${y}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ], {
            duration: SETTLE_DURATION,
            easing: "cubic-bezier(0.2, 0.82, 0.2, 1)",
          });
          settleAnimations.add(animation);
          animation.finished.catch(() => {}).finally(() => settleAnimations.delete(animation));
          return [animation.finished.catch(() => {})];
        });
        await Promise.all(animations);
      }
      root.classList.remove("is-workspace-tab-settling");
      onSettled();
    };
    const renderDrag = (event) => {
      if (!press || !dragging) return;
      const geometry = horizontalGeometry(
        event.clientX,
        press.grabOffset,
        press.sourceRect.width,
        press.trackStart,
        press.trackEnd,
      );
      press.geometry = geometry;
      press.targetIndex = targetIndexForGeometry(
        geometry,
        press.siblingRects,
        press.trackStart,
        press.trackEnd,
        press.targetIndex,
      );
      press.source.style.transform = `translate3d(${geometry.start - press.sourceRect.left}px, 0, 0)`;
      press.originalItems.forEach((item, index) => {
        if (item === press.source) return;
        let shift = 0;
        if (press.targetIndex > press.sourceIndex && index > press.sourceIndex && index <= press.targetIndex) {
          shift = -press.sourceRect.width;
        } else if (press.targetIndex < press.sourceIndex && index >= press.targetIndex && index < press.sourceIndex) {
          shift = press.sourceRect.width;
        }
        item.style.transform = shift ? `translate3d(${shift}px, 0, 0)` : "";
      });
    };
    const startDrag = (event) => {
      const originalItems = items();
      const sourceIndex = originalItems.indexOf(press.source);
      const sourceRect = press.source.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const rootStyle = window.getComputedStyle(root);
      const trackStart = rootRect.left + (Number.parseFloat(rootStyle.paddingLeft) || 0);
      const trackEnd = rootRect.right - (Number.parseFloat(rootStyle.paddingRight) || 0);
      press = {
        ...press,
        originalItems,
        originalIds: originalItems.map((item) => String(getItemId(item))),
        sourceIndex,
        sourceRect,
        siblingRects: originalItems.filter((item) => item !== press.source).map((item) => item.getBoundingClientRect()),
        grabOffset: press.startX - sourceRect.left,
        trackStart,
        trackEnd,
        targetIndex: sourceIndex,
        previousUserSelect: document.documentElement.style.userSelect,
      };
      try {
        root.setPointerCapture?.(event.pointerId);
      } catch (_error) {
        // Window listeners remain the fallback when capture is unavailable.
      }
      dragging = true;
      document.documentElement.style.userSelect = "none";
      window.getSelection?.()?.removeAllRanges();
      root.classList.add("is-workspace-tab-reordering");
      press.source.classList.add("is-workspace-tab-dragging");
      press.source.setAttribute("aria-grabbed", "true");
      renderDrag(event);
    };
    const finishActive = async (cancelled = false) => {
      if (!press || finishing) return;
      if (!dragging) {
        press = null;
        return;
      }
      finishing = true;
      dragging = false;
      const completed = press;
      const beforeRects = captureVisualRects();
      const nextIds = cancelled
        ? completed.originalIds
        : reorderedIds(completed.originalIds, completed.sourceIndex, completed.targetIndex);
      applyOrder(nextIds);
      suppressClickUntil = performance.now() + 350;
      document.documentElement.style.userSelect = completed.previousUserSelect;
      await settleFrom(beforeRects);
      try {
        if (!cancelled && nextIds.some((id, index) => id !== completed.originalIds[index])) {
          const accepted = await onDrop?.({ orderedIds: nextIds, previousIds: completed.originalIds });
          if (accepted === false) {
            const rollbackRects = captureVisualRects();
            applyOrder(completed.originalIds);
            await settleFrom(rollbackRects);
          }
        }
      } catch (error) {
        const rollbackRects = captureVisualRects();
        applyOrder(completed.originalIds);
        await settleFrom(rollbackRects);
        onError(error);
      } finally {
        press = null;
        finishing = false;
      }
    };
    const pointerDown = (event) => {
      if (finishing || event.button !== 0 || !event.isPrimary) return;
      const source = event.target.closest?.(itemSelector);
      if (!source || !root.contains(source)) return;
      press = { source, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    };
    const pointerMove = (event) => {
      if (!press || event.pointerId !== press.pointerId || finishing) return;
      if (!dragging) {
        const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
        if (distance < MOVE_THRESHOLD) return;
        startDrag(event);
      } else {
        renderDrag(event);
      }
      event.preventDefault();
    };
    const finishPointer = (event, cancelled = false) => {
      if (!press || event.pointerId !== press.pointerId) return;
      void finishActive(cancelled);
    };
    const cancelForInterruption = () => {
      if (dragging) void finishActive(true);
      else press = null;
    };

    root.addEventListener("pointerdown", pointerDown, { signal });
    window.addEventListener("pointermove", pointerMove, { capture: true, signal });
    window.addEventListener("pointerup", (event) => finishPointer(event), { capture: true, signal });
    window.addEventListener("pointercancel", (event) => finishPointer(event, true), { capture: true, signal });
    window.addEventListener("mouseup", (event) => {
      if (event.button === 0 && dragging) void finishActive(false);
    }, { capture: true, signal });
    window.addEventListener("blur", cancelForInterruption, { signal });
    window.addEventListener("pagehide", cancelForInterruption, { signal });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelForInterruption();
    }, { signal });
    root.addEventListener("click", (event) => {
      if (performance.now() > suppressClickUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, signal });

    return {
      destroy() {
        controller.abort();
        settleAnimations.forEach((animation) => animation.cancel());
        settleAnimations.clear();
        if (press?.originalIds) applyOrder(press.originalIds);
        clearTransforms();
        root.classList.remove("is-workspace-tab-reordering", "is-workspace-tab-settling");
        if (press?.previousUserSelect !== undefined) {
          document.documentElement.style.userSelect = press.previousUserSelect;
        }
        press = null;
        dragging = false;
        finishing = false;
      },
    };
  }

  return Object.freeze({ createController, horizontalGeometry, reorderedIds, targetIndexForGeometry });
});
