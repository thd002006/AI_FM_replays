// B81 Web Worker around the WASM match engine.
//
// Message names match docs/wasm_contract.md and tools/replay_viewer/engine_client.js
// (PR #81): abi, create, step, replaceFormation, status, finish, dispose.
// The envelope (`id`) is not part of the ABI.
//
// PR #81 switches to this worker by changing one line in engine_config.js:
//   export const ENGINE_WORKER_URL = new URL("./engine_worker.js", import.meta.url);

import init, { engine_dispatch } from "./engine/fm_wasm.js";

const ready = init();

self.onmessage = (ev) => {
  const msg = ev.data || {};
  const { id, op, payload } = msg;
  ready
    .then(() => {
      const payloadText = payload === undefined ? "null" : JSON.stringify(payload);
      const text = engine_dispatch(op, payloadText);
      self.postMessage({ id, result: JSON.parse(text) });
    })
    .catch((err) => {
      self.postMessage({
        id,
        result: {
          ok: false,
          code: "Internal",
          message: err && err.message ? err.message : "引擎内部错误",
        },
      });
    });
};
