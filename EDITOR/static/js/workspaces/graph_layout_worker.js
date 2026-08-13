"use strict";

importScripts("graph_model.js");

self.addEventListener("message", (event) => {
  const { requestId, nodes, relationships, rootNodeId } = event.data || {};
  if (!requestId) return;
  try {
    const layout = self.SceneGraphModel.compactLayout(
      self.SceneGraphModel.layout(nodes || [], relationships || [], rootNodeId || null),
    );
    self.postMessage({ kind: "layout", requestId, layout });
    self.setTimeout(() => {
      try {
        const edgeCrossings = self.SceneGraphModel.countEdgeCrossings(relationships || [], layout);
        self.postMessage({ kind: "diagnostics", requestId, edgeCrossings });
      } catch (_error) {
        self.postMessage({ kind: "diagnostics", requestId, edgeCrossings: null });
      }
    }, 0);
  } catch (error) {
    self.postMessage({
      kind: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
