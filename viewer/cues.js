// Playback cues for the viewer. No engine state: half-time pause, kick
// vibration, and which events count as a ball contact.

const KICK_KINDS = new Set([
  "pass_released",
  "shot",
  "clearance",
  "block",
  "deflection",
  "tackle",
]);

/** 1× wall-clock length. About six rendered frames. */
export const JIGGLE_BASE_MS = 100;

/**
 * @param {number} speed
 * @returns {number} playback rate used for the pulse, at least 1 and at most 4
 */
export function jiggleSpeed(speed) {
  const s = Number(speed);
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(4, Math.max(1, s));
}

/**
 * Wall-clock length of one kick pulse.
 * 1× stays inside 80–120ms. Higher speeds stretch the same pulse so a 4×
 * playhead, which crosses the tick in fewer paints, still shows it.
 * @param {number} speed
 */
export function jiggleDurationMs(speed) {
  return Math.round(JIGGLE_BASE_MS * jiggleSpeed(speed));
}

/** Peak scale added on top of 1. Larger at higher playback speeds. */
export function jiggleAmplitude(speed) {
  return 0.22 * Math.sqrt(jiggleSpeed(speed));
}

/**
 * Scale multiplier for a kick pulse. 1 means no extra scale.
 * The middle of the window holds near the peak and wobbles, so the marker
 * reads as a short jiggle instead of a one-frame flash.
 * @param {number} elapsedMs
 * @param {number} speed playback rate captured when the kick crossed
 */
export function jiggleFactor(elapsedMs, speed) {
  const dur = jiggleDurationMs(speed);
  const elapsed = Number(elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= dur) return 1;
  const u = elapsed / dur;
  let env;
  if (u < 0.12) env = u / 0.12;
  else if (u < 0.82) env = 1;
  else env = (1 - u) / 0.18;
  const wobble = 0.82 + 0.18 * Math.sin(u * Math.PI * 6);
  return 1 + jiggleAmplitude(speed) * env * wobble;
}

/**
 * Forward crossing of one tick. A rewind (`next < prev`) is not a cross.
 * @param {number | null | undefined} prev
 * @param {number | null | undefined} next
 * @param {number | null | undefined} tick
 */
export function crossedTick(prev, next, tick) {
  const p = Number(prev);
  const n = Number(next);
  const t = Number(tick);
  if (!Number.isFinite(p) || !Number.isFinite(n) || !Number.isFinite(t)) return false;
  if (n < p) return false;
  return p < t && n >= t;
}

/**
 * Autoplay is the only path that pauses for the second-half kickoff.
 * Scrub and step pass `autoplay: false` and keep today's banner-only behaviour.
 * @param {{ autoplay?: boolean, prevTick?: number, nextTick?: number, halfTick?: number | null, awaiting?: boolean }} opts
 */
export function shouldPauseForHalf(opts) {
  if (!opts || !opts.autoplay || opts.awaiting) return false;
  if (opts.halfTick == null || !Number.isFinite(Number(opts.halfTick))) return false;
  return crossedTick(opts.prevTick, opts.nextTick, Number(opts.halfTick));
}

/**
 * Player id to jiggle, or null when this event is not a contact
 * (team kickoff, a tackle that is neither won nor disrupted, missing player).
 * @param {{ kind?: string, player?: number | null, detail?: string } | null | undefined} ev
 */
export function kickPlayer(ev) {
  if (!ev || !KICK_KINDS.has(ev.kind)) return null;
  if (ev.player == null) return null;
  if (ev.kind === "tackle") {
    const detail = ev.detail == null ? "" : String(ev.detail);
    if (detail !== "won" && detail !== "disrupted") return null;
  }
  return ev.player;
}

/**
 * Kick contacts whose tick lies in `(prev, next]`.
 * @param {Array<{kind?: string, tick?: number, player?: number | null, detail?: string}> | null | undefined} events
 * @param {number | null | undefined} prev
 * @param {number | null | undefined} next
 */
export function kickContactsCrossing(events, prev, next) {
  const out = [];
  if (!events || !crossedForward(prev, next)) return out;
  for (const ev of events) {
    if (!ev || !crossedTick(prev, next, ev.tick)) continue;
    const player = kickPlayer(ev);
    if (player == null) continue;
    out.push(ev);
  }
  return out;
}

function crossedForward(prev, next) {
  const p = Number(prev);
  const n = Number(next);
  return Number.isFinite(p) && Number.isFinite(n) && n >= p;
}
