(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  root.SceneContentEditorSupport = value;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function asArray(value) {
    if (Array.isArray(value)) return value;
    return value === null || value === undefined ? [] : [value];
  }

  function normalizeSnippets(source) {
    return Object.entries(source || {}).flatMap(([name, snippet]) => {
      const body = Array.isArray(snippet.body) ? snippet.body.join("\n") : String(snippet.body || "");
      return asArray(snippet.prefix).filter(Boolean).map((prefix) => ({
        label: String(prefix),
        detail: String(name),
        documentation: String(snippet.description || ""),
        insertText: body.replace(/\t/g, "    "),
      }));
    });
  }

  function completionContext(lineBeforeCursor) {
    const line = String(lineBeforeCursor || "");
    if (/\b(?:call|jump)\s+[\w.]*$/i.test(line)) return "label";
    if (/\b(?:play|queue)\s+(?:music|sound|voice)\s+["'][^"']*$/i.test(line)) return "audio";
    if (/\b(?:scene|show|hide)\s+(?!screen\b)[\w/ .-]*$/i.test(line)) return "image";
    return "general";
  }

  function uniqueNamed(values) {
    const seen = new Set();
    return asArray(values).flatMap((value) => {
      const id = String(typeof value === "object" ? value.id ?? value.name ?? "" : value).trim();
      const name = String(typeof value === "object" ? value.name ?? id : id).trim();
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, name }];
    });
  }

  function projectSuggestions(context, project = {}) {
    const kind = String(context || "general");
    if (kind === "label") {
      return uniqueNamed(project.labels).map(({ id, name }) => ({
        label: id,
        detail: name === id ? "Ren'Py label" : `Ren'Py label · ${name}`,
        insertText: id,
        type: "reference",
      }));
    }
    if (kind === "audio") {
      return uniqueNamed(project.audio).map(({ id }) => ({
        label: id,
        detail: "game/audio",
        insertText: id,
        type: "file",
      }));
    }
    if (kind === "image") {
      return uniqueNamed(project.images).map(({ id }) => ({
        label: id,
        detail: "game/images",
        insertText: id.replace(/\.[^.]+$/, "").replace(/[\\/]+/g, " "),
        type: "file",
      }));
    }
    return [
      { label: "scene_get_stat", detail: "Scene Node public API", insertText: "scene_get_stat(${1:stat_id}, ${2:0})", type: "function" },
      { label: "scene_change_stat", detail: "Scene Node bridge API · prefer Event Effects", insertText: "scene_change_stat(${1:stat_id}, \"${2:+}\", ${3:value})", type: "function" },
      { label: "scene_current_node_id", detail: "Scene Node public API", insertText: "scene_current_node_id()", type: "function" },
      { label: "scene_current_node_name", detail: "Scene Node public API", insertText: "scene_current_node_name(${1:\"\"})", type: "function" },
      { label: "scene_memory_has", detail: "Scene Node public API", insertText: "scene_memory_has(${1:bank_id}, ${2:tag_id})", type: "function" },
      { label: "scene_memory_tags", detail: "Scene Node public API", insertText: "scene_memory_tags(${1:bank_id})", type: "function" },
      { label: "scene_memory_add", detail: "Scene Node bridge API · prefer Event Effects", insertText: "scene_memory_add(${1:bank_id}, ${2:tag_id})", type: "function" },
      { label: "scene_memory_remove", detail: "Scene Node bridge API · prefer Event Effects", insertText: "scene_memory_remove(${1:bank_id}, ${2:tag_id})", type: "function" },
      { label: "scene_memory_clear", detail: "Scene Node bridge API · prefer Event Effects", insertText: "scene_memory_clear(${1:bank_id})", type: "function" },
    ];
  }

  return Object.freeze({ completionContext, normalizeSnippets, projectSuggestions });
});
