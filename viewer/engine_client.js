// Page-side adapter for the WASM contract (docs/wasm_contract.md, B75).
//
// The match lives in one Web Worker. This module only postMessages. The
// worker URL comes from engine_config.js so the real worker is a one-line swap.

import { ENGINE_WORKER_URL } from "./engine_config.js";

/** ABI the page was written against. */
export const PAGE_ABI_VERSION = 1;

/**
 * Page-side check for `createMatch` options (contract `BadOption`).
 * Absent fields are legal. An illegal value never reaches `create`.
 * @param {{ frameInterval?: number, kickoffTeam?: number } | null | undefined} request
 * @returns {{ ok: false, code: "BadOption", message: string } | null}
 */
export function createMatchOptionError(request) {
  if (!request) return null;
  if (request.frameInterval !== undefined) {
    if (!Number.isInteger(request.frameInterval) || request.frameInterval < 1) {
      return { ok: false, code: "BadOption", message: "frameInterval 必须是不小于 1 的整数" };
    }
  }
  if (request.kickoffTeam !== undefined) {
    if (request.kickoffTeam !== 0 && request.kickoffTeam !== 1) {
      return { ok: false, code: "BadOption", message: "kickoffTeam 只能是 0 或 1" };
    }
  }
  return null;
}

/**
 * @param {{ workerUrl?: URL | string, Worker?: typeof Worker, port?: { postMessage: Function, addEventListener: Function, terminate?: Function }, abiVersion?: number }} [options]
 */
export function createEngineClient(options = {}) {
  const expectedAbi = options.abiVersion ?? PAGE_ABI_VERSION;
  const port =
    options.port ||
    new (options.Worker || globalThis.Worker)(options.workerUrl || ENGINE_WORKER_URL, { type: "module" });
  let nextId = 1;
  /** @type {Map<number, {resolve: Function, reject: Function}>} */
  const pending = new Map();

  port.addEventListener("message", (ev) => {
    const data = ev.data || {};
    const slot = pending.get(data.id);
    if (!slot) return;
    pending.delete(data.id);
    slot.resolve(data.result);
  });
  port.addEventListener("error", (ev) => {
    const message = (ev && ev.message) || "引擎线程出错";
    for (const slot of pending.values()) slot.reject(new Error(message));
    pending.clear();
  });

  function call(op, payload) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port.postMessage({ id, op, payload });
    });
  }

  return {
    engineAbiVersion() {
      return call("abi");
    },

    /**
     * Refuses to create when the worker ABI is not the page ABI, or when
     * `frameInterval` / `kickoffTeam` are present but illegal (`BadOption`).
     * Neither case reaches `create`.
     */
    async createMatch(request) {
      if (!request || request.abiVersion !== expectedAbi) {
        return {
          ok: false,
          code: "BadVersion",
          message: `开局请求的接口版本不是 ${expectedAbi}`,
        };
      }
      const optionError = createMatchOptionError(request);
      if (optionError) return optionError;
      let abi;
      try {
        abi = await call("abi");
      } catch (err) {
        return { ok: false, code: "Internal", message: err.message || "读不到引擎接口版本" };
      }
      if (abi !== expectedAbi) {
        return {
          ok: false,
          code: "BadVersion",
          message: `引擎接口版本是 ${abi}，页面需要 ${expectedAbi}`,
        };
      }
      return call("create", request);
    },

    step(ticks) {
      return call("step", ticks);
    },

    replaceFormation(formation) {
      return call("replaceFormation", formation);
    },

    matchStatus() {
      return call("status");
    },

    finish() {
      return call("finish");
    },

    async dispose() {
      await call("dispose");
    },

    terminate() {
      if (typeof port.terminate === "function") port.terminate();
    },
  };
}
