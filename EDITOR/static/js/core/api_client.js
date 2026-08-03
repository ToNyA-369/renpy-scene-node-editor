"use strict";

(function exposeApiClient(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEditorApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function createApiClient({ fetchImpl, networkMessage } = {}) {
    const fetchRequest = fetchImpl || ((...args) => fetch(...args));
    const offlineMessage = networkMessage || "無法連線到編輯器伺服器。請保持此頁開啟並重新啟動編輯器。";

    return async function api(path, options = {}) {
      const request = { ...options };
      request.headers = { "Content-Type": "application/json", ...(options.headers || {}) };
      if (request.body && typeof request.body !== "string") {
        request.body = JSON.stringify(request.body);
      }

      let response;
      try {
        response = await fetchRequest(path, request);
      } catch (cause) {
        const error = new Error(offlineMessage);
        error.code = "NETWORK_ERROR";
        error.cause = cause;
        throw error;
      }

      let data = {};
      try {
        data = await response.json();
      } catch (_error) {
        data = {};
      }
      if (!response.ok) {
        const error = new Error(data.error || `請求失敗 (${response.status})`);
        error.code = "HTTP_ERROR";
        error.status = response.status;
        throw error;
      }
      return data;
    };
  }

  return { createApiClient };
});
