// 开新局 session (B78). The page owns the buttons and the playback clock.
// This module owns the phase, the worker calls, and the formation sent in.
//
// It does not write matches.json or config/formations.

import { PAGE_ABI_VERSION } from "./engine_client.js";

export const PHASE_IDLE = "idle";
export const PHASE_PRE_MATCH = "preMatch";
export const PHASE_LIVE = "live";
export const PHASE_FULL_TIME = "fullTime";
export const PHASE_ERROR = "error";

/** Wall-clock seconds of simulation to keep ahead of the playhead. */
export const BUFFER_AHEAD_S = 0.75;

const STRIPPED = ["name", "nOut", "jersey", "phase", "revision", "applyFrom", "persisted", "sessionMode"];

/**
 * Formation table the engine accepts. Jersey, revision, and the other
 * tactics-board fields stay on the page.
 * @param {object} table session snapshot or a bare table
 */
export function formationTableForEngine(table) {
  if (!table || !Array.isArray(table.slot)) throw new TypeError("formation needs slots");
  return {
    press_trigger_x: table.press_trigger_x,
    slot: table.slot.map((s) => ({
      label: typeof s.label === "string" ? s.label : "",
      defend: [Number(s.defend[0]), Number(s.defend[1])],
      attack: [Number(s.attack[0]), Number(s.attack[1])],
    })),
  };
}

/**
 * Today's board is one table. It goes in `home`. `away` stays null so the
 * engine mirrors it.
 * @param {object} snapshot `getSessionFormation()` or a bare table
 */
export function formationPairForEngine(snapshot) {
  return { home: formationTableForEngine(snapshot), away: null };
}

/** Keys that must not cross into the worker. */
export function strippedFormationKeys() {
  return STRIPPED.slice();
}

/**
 * Contract §4.3 batch, page side only.
 * `max(frameInterval, round(speed * physicsHz * wallSeconds))`, then up to a
 * multiple of `frameInterval`, clamped to 1..=240.
 */
export function suggestedStepTicks({
  speed = 1,
  wallSeconds = 0,
  frameInterval = 2,
  physicsHz = 60,
  maxTicks = 240,
} = {}) {
  const interval = Number.isInteger(frameInterval) && frameInterval >= 1 ? frameInterval : 1;
  const hz = Number.isFinite(physicsHz) && physicsHz > 0 ? physicsHz : 60;
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 0;
  const wall = Number.isFinite(wallSeconds) && wallSeconds > 0 ? wallSeconds : 0;
  const rounded = Math.round(rate * hz * wall);
  let ticks = Math.max(interval, rounded);
  ticks = Math.ceil(ticks / interval) * interval;
  const cap = Math.floor(maxTicks / interval) * interval;
  if (ticks > cap) ticks = cap;
  if (ticks < 1) ticks = 1;
  if (ticks > maxTicks) ticks = maxTicks;
  return ticks;
}

/**
 * Ticks to request on this pump. Zero when the buffer is already far enough
 * ahead of the playhead, so 1× stays near wall-clock instead of running away.
 */
export function ticksForPacing({
  playheadTick = 0,
  bufferedTick = 0,
  speed = 1,
  wallSeconds = 0,
  physicsHz = 60,
  frameInterval = 2,
  bufferAheadSeconds = BUFFER_AHEAD_S,
} = {}) {
  const hz = Number.isFinite(physicsHz) && physicsHz > 0 ? physicsHz : 60;
  const ahead = (Number(bufferedTick) - Number(playheadTick)) / hz;
  const want = (Number.isFinite(speed) && speed > 0 ? speed : 0) * bufferAheadSeconds;
  if (ahead >= want && Number(bufferedTick) > Number(playheadTick)) return 0;
  return suggestedStepTicks({ speed, wallSeconds, frameInterval, physicsHz });
}

/**
 * Decimal u64 string. The engine treats `"1"` and `1` as the same seed.
 * @param {(buf: Uint32Array) => void} [fill]
 */
export function randomMatchSeed(fill) {
  const buf = new Uint32Array(2);
  if (fill) fill(buf);
  else if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    buf[0] = Math.floor(Math.random() * 0x100000000);
    buf[1] = Math.floor(Math.random() * 0x100000000);
  }
  const n = (BigInt(buf[0] >>> 0) << 32n) | BigInt(buf[1] >>> 0);
  return n.toString();
}

/**
 * Where 「返回列表」 goes.
 * Published viewer lives in `viewer/`. The repo viewer lives next to `list/`.
 * @param {string} pageHref
 */
export function matchListHref(pageHref) {
  const url = new URL(pageHref, "http://localhost/");
  const path = url.pathname;
  if (/\/viewer\/(?:index\.html)?$/.test(path)) return new URL("../", url).href;
  return new URL("list/", url).href;
}

/**
 * Where the list's 「开新局」 button goes.
 * @param {string} pageHref
 */
export function newMatchHref(pageHref) {
  const url = new URL(pageHref, "http://localhost/");
  const path = url.pathname;
  if (/\/list(?:\/(?:index\.html)?)?$/.test(path)) return new URL("../?mode=newMatch", url).href;
  return new URL("viewer/?mode=newMatch", url).href;
}

function emit(onEvent, event) {
  if (typeof onEvent === "function") onEvent(event);
}

/**
 * @param {{ createMatch: Function, step: Function, replaceFormation: Function, dispose: Function }} engine
 * @param {{ onEvent?: Function }} [hooks]
 */
export function createNewMatchSession(engine, hooks = {}) {
  let phase = PHASE_IDLE;
  let seed = null;
  let status = null;
  let stepping = false;

  function setPhase(next) {
    phase = next;
  }

  async function open({ seed: nextSeed, formation, frameInterval, kickoffTeam }) {
    const request = {
      abiVersion: PAGE_ABI_VERSION,
      seed: nextSeed,
      format: "11v11",
      formation: formationPairForEngine(formation),
    };
    if (frameInterval !== undefined) request.frameInterval = frameInterval;
    if (kickoffTeam !== undefined) request.kickoffTeam = kickoffTeam;
    const result = await engine.createMatch(request);
    if (!result || result.ok === false) {
      setPhase(PHASE_ERROR);
      status = null;
      emit(hooks.onEvent, { type: "error", phase, error: result || { ok: false, code: "Internal", message: "开局失败" } });
      return result;
    }
    seed = nextSeed;
    status = result.status;
    setPhase(PHASE_PRE_MATCH);
    emit(hooks.onEvent, { type: "created", phase, result });
    return result;
  }

  return {
    get phase() {
      return phase;
    },
    get seed() {
      return seed;
    },
    get status() {
      return status;
    },

    open,

    /** Drag or reset. Ignored outside pre-match and live. */
    async onFormation(snapshot) {
      if (phase !== PHASE_PRE_MATCH && phase !== PHASE_LIVE) return null;
      const result = await engine.replaceFormation(formationPairForEngine(snapshot));
      if (!result || result.ok === false) {
        setPhase(PHASE_ERROR);
        emit(hooks.onEvent, { type: "error", phase, error: result || { ok: false, code: "Internal", message: "阵型没有送进比赛" } });
        return result;
      }
      status = result.status;
      emit(hooks.onEvent, { type: "formation", phase, result });
      return result;
    },

    /** First step is kickoff. The caller starts playback. */
    kickoff() {
      if (phase !== PHASE_PRE_MATCH) return false;
      setPhase(PHASE_LIVE);
      emit(hooks.onEvent, { type: "kickoff", phase });
      return true;
    },

    /**
     * Ask the engine for more ticks when playback is running and the buffer
     * is short. Overlapping pumps wait; the worker still sees one step at a time.
     */
    async pump(ctx) {
      if (phase !== PHASE_LIVE || !ctx || !ctx.playing || ctx.awaitingSecondHalfKickoff || stepping) return null;
      const ticks = ticksForPacing(ctx);
      if (ticks < 1) return null;
      stepping = true;
      try {
        const result = await engine.step(ticks);
        if (!result || result.ok === false) {
          setPhase(PHASE_ERROR);
          emit(hooks.onEvent, { type: "error", phase, error: result || { ok: false, code: "Internal", message: "步进失败" } });
          return result;
        }
        status = result.status;
        if (result.status && result.status.fullTime) {
          setPhase(PHASE_FULL_TIME);
          emit(hooks.onEvent, { type: "fullTime", phase, result });
        } else {
          emit(hooks.onEvent, { type: "step", phase, result });
        }
        return result;
      } finally {
        stepping = false;
      }
    },

    /** Dispose, new seed, same session formation, back to pre-match. */
    async again(formation, nextSeed) {
      await engine.dispose();
      setPhase(PHASE_IDLE);
      return open({ seed: nextSeed, formation });
    },

    async back() {
      await engine.dispose();
      seed = null;
      status = null;
      setPhase(PHASE_IDLE);
      emit(hooks.onEvent, { type: "disposed", phase });
    },
  };
}
