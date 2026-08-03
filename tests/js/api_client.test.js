"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createApiClient } = require("../../EDITOR/static/js/core/api_client.js");

function response({ ok = true, status = 200, data = {}, jsonError = null } = {}) {
  return {
    ok,
    status,
    async json() {
      if (jsonError) throw jsonError;
      return data;
    },
  };
}

test("API client serializes object bodies and preserves caller headers", async () => {
  let request;
  const api = createApiClient({
    fetchImpl: async (path, options) => {
      request = { path, options };
      return response({ data: { saved: true } });
    },
  });

  const result = await api("/api/node", {
    method: "PUT",
    headers: { "X-Test": "yes" },
    body: { ID: "root" },
  });

  assert.deepEqual(result, { saved: true });
  assert.equal(request.path, "/api/node");
  assert.equal(request.options.body, '{"ID":"root"}');
  assert.deepEqual(request.options.headers, {
    "Content-Type": "application/json",
    "X-Test": "yes",
  });
});

test("API client classifies transport failures for autosave retry", async () => {
  const cause = new Error("connection refused");
  const api = createApiClient({ fetchImpl: async () => { throw cause; } });

  await assert.rejects(api("/api/project"), (error) => {
    assert.equal(error.code, "NETWORK_ERROR");
    assert.equal(error.cause, cause);
    return true;
  });
});

test("API client exposes server validation messages and HTTP status", async () => {
  const api = createApiClient({
    fetchImpl: async () => response({ ok: false, status: 400, data: { error: "缺少 Next Node" } }),
  });

  await assert.rejects(api("/api/events"), (error) => {
    assert.equal(error.code, "HTTP_ERROR");
    assert.equal(error.status, 400);
    assert.equal(error.message, "缺少 Next Node");
    return true;
  });
});

test("API client tolerates an empty successful response", async () => {
  const api = createApiClient({
    fetchImpl: async () => response({ jsonError: new SyntaxError("empty") }),
  });
  assert.deepEqual(await api("/api/empty"), {});
});
