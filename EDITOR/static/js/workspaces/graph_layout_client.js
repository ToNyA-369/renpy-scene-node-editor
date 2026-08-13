"use strict";

(function exposeGraphLayoutClient(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneGraphLayoutClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function signature(nodes, relationships, rootNodeId) {
    return JSON.stringify({
      algorithm: "structured-depth-v4-worker",
      rootNodeId,
      nodes: nodes.map((node) => [node.id, node.path, node.name]),
      edges: relationships.map((edge) => [
        edge.source,
        edge.target,
        edge.endUp,
        edge.scope,
        Boolean(edge.bidirectional),
        Boolean(edge.cycle),
      ]),
    });
  }

  function createTask(nodes, relationships, rootNodeId, options = {}) {
    const model = options.model || globalThis.SceneGraphModel;
    const WorkerConstructor = Object.hasOwn(options, "WorkerConstructor")
      ? options.WorkerConstructor
      : globalThis.Worker;
    const schedule = options.schedule || ((callback) => globalThis.setTimeout(callback, 0));
    const workerUrl = options.workerUrl || "/js/workspaces/graph_layout_worker.js";
    if (!model) throw new Error("SceneGraphModel is required");

    const requestId = `${Date.now()}:${Math.random()}`;
    let worker = null;
    let cancelled = false;
    let layoutSettled = false;
    let diagnosticsSettled = false;
    let resolveLayout;
    let rejectLayout;
    let resolveDiagnostics;
    const layoutPromise = new Promise((resolve, reject) => {
      resolveLayout = resolve;
      rejectLayout = reject;
    });
    const diagnosticsPromise = new Promise((resolve) => {
      resolveDiagnostics = resolve;
    });
    const finishDiagnostics = (value) => {
      if (diagnosticsSettled) return;
      diagnosticsSettled = true;
      resolveDiagnostics(value);
      worker?.terminate();
      worker = null;
    };
    const failLayout = (error) => {
      if (layoutSettled) return;
      layoutSettled = true;
      rejectLayout(error);
      finishDiagnostics(null);
    };
    const computeOnMainThread = () => {
      schedule(() => {
        if (cancelled) return;
        try {
          const layout = model.compactLayout(model.layout(nodes, relationships, rootNodeId));
          layoutSettled = true;
          resolveLayout({ layout, source: "main-thread-fallback" });
          schedule(() => {
            if (cancelled) return;
            finishDiagnostics(model.countEdgeCrossings(relationships, layout));
          });
        } catch (error) {
          failLayout(error);
        }
      });
    };
    if (typeof WorkerConstructor !== "function") {
      computeOnMainThread();
    } else {
      try {
        worker = new WorkerConstructor(workerUrl);
        worker.addEventListener("message", (event) => {
          if (cancelled || event.data?.requestId !== requestId) return;
          if (event.data.kind === "layout") {
            layoutSettled = true;
            resolveLayout({ layout: event.data.layout, source: "worker" });
          } else if (event.data.kind === "diagnostics") {
            finishDiagnostics(Number.isFinite(event.data.edgeCrossings) ? event.data.edgeCrossings : null);
          } else if (event.data.kind === "error") {
            failLayout(new Error(event.data.message || "Graph layout failed"));
          }
        });
        worker.addEventListener("error", (event) => {
          event.preventDefault?.();
          worker?.terminate();
          worker = null;
          if (layoutSettled) finishDiagnostics(null);
          else computeOnMainThread();
        });
        worker.postMessage({ requestId, nodes, relationships, rootNodeId });
      } catch (_error) {
        worker?.terminate();
        worker = null;
        computeOnMainThread();
      }
    }
    return {
      layoutPromise,
      diagnosticsPromise,
      cancel() {
        if (cancelled) return;
        cancelled = true;
        worker?.terminate();
        worker = null;
        if (!layoutSettled) {
          const error = new Error("Graph computation cancelled");
          error.name = "AbortError";
          failLayout(error);
        } else {
          finishDiagnostics(null);
        }
      },
    };
  }

  return { createTask, signature };
});
