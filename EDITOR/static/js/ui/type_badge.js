"use strict";

// Presentation only: a type badge covers its own fields without moving the menu anchor.
const SceneTypeBadge = (() => {
  function scopeOf(select) {
    return select?.matches("[data-type-badge]") ? select.closest(".type-badge-scope") : null;
  }

  function setOpen(select, open) {
    scopeOf(select)?.classList.toggle("type-badge-open", open);
  }

  function capture(select) {
    const scope = scopeOf(select);
    const row = select.closest("[data-badge-row]");
    const form = select.form;
    if (!scope || !row || !form?.id) return null;
    const cover = scope.querySelector(":scope > .type-badge-cover");
    return {
      select, formId: form.id, row: row.dataset.badgeRow, name: select.name,
      fraction: cover.getBoundingClientRect().width / scope.clientWidth,
    };
  }

  function restore(snapshot) {
    if (!snapshot || snapshot.select.isConnected) return;
    // Type changes synchronously rebuild the form. Transfer only the current visual
    // extent to its replacement, never delay a data write or replay a stale callback.
    const form = document.getElementById(snapshot.formId);
    const row = [...(form?.querySelectorAll("[data-badge-row]") || [])].find((item) => item.dataset.badgeRow === snapshot.row);
    const select = [...(row?.querySelectorAll("select[data-type-badge]") || [])].find((item) => item.name === snapshot.name);
    const scope = scopeOf(select);
    if (!scope) return;
    const cover = scope.querySelector(":scope > .type-badge-cover");
    cover.style.transition = "none";
    cover.style.width = `${Math.min(1, snapshot.fraction) * scope.clientWidth}px`;
    cover.getBoundingClientRect();
    cover.style.removeProperty("transition");
    cover.style.removeProperty("width");
  }

  return { setOpen, capture, restore };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SceneTypeBadge;
