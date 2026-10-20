// B78: which Web Worker runs the match. One URL.
// The fake worker stays in the tree for tests that do not load WASM.

/** B81 match engine (`fm_wasm`). */
export const ENGINE_WORKER_URL = new URL("./engine_worker.js", import.meta.url);
