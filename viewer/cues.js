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

/** 1× wall-clock length of the kick nudge. */
export const JIGGLE_BASE_MS = 120;

/**
 * Share of the window used by the outward nudge. The rest is a decaying
 * shudder on the same axis: one out-and-back plus four oscillations.
 */
const NUDGE_SPLIT = 0.36;
const NUDGE_TAIL_CYCLES = 4;

/**
 * Default on-screen disc the nudge is tuned against (metres):
 * `markers.js` base radius 0.36 × player scale 2.25 × 1.3.
 */
const NUDGE_DISC_M = 0.36 * 2.25 * 1.3;

/** A shorter vector is not a kick direction (m, or m/s). */
const DIR_MIN = 0.2;

/**
 * @param {number} speed
 * @returns {number} playback rate used for the nudge, at least 1 and at most 4
 */
export function jiggleSpeed(speed) {
  const s = Number(speed);
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(4, Math.max(1, s));
}

/**
 * Wall-clock length of one kick nudge.
 * 1× stays inside 90–140ms. Higher speeds stretch the same nudge so a 4×
 * playhead, which crosses the tick in fewer paints, still shows it.
 * @param {number} speed
 */
export function jiggleDurationMs(speed) {
  return Math.round(JIGGLE_BASE_MS * jiggleSpeed(speed));
}

/**
 * Peak metres along the kick. About 8% of the default disc at 1×.
 * Grows with sqrt(speed) so 4× still reads, and the centre stays inside the disc.
 * @param {number} speed
 */
export function jiggleAmplitude(speed) {
  return NUDGE_DISC_M * 0.08 * Math.sqrt(jiggleSpeed(speed));
}

/**
 * Signed metres along the kick axis. Positive is the kick direction.
 * Scale is not part of this: the marker stays at `carryScale` (or 1).
 * The first lobe is a hard-attack out-and-back. The tail oscillates on
 * that same axis and dies away.
 * @param {number} elapsedMs
 * @param {number} speed playback rate captured when the kick crossed
 */
export function jiggleOffset(elapsedMs, speed) {
  const dur = jiggleDurationMs(speed);
  const elapsed = Number(elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed >= dur) return 0;
  const u = elapsed / dur;
  const amp = jiggleAmplitude(speed);
  if (u < NUDGE_SPLIT) {
    const v = u / NUDGE_SPLIT;
    return amp * Math.sin(Math.PI * Math.pow(v, 0.55));
  }
  const v = (u - NUDGE_SPLIT) / (1 - NUDGE_SPLIT);
  const env = Math.exp(-3.4 * v) * 0.42;
  return amp * env * Math.sin(2 * Math.PI * NUDGE_TAIL_CYCLES * v);
}

function finiteNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Unit XZ vector, or null when the input is missing or shorter than {@link DIR_MIN}.
 * @param {number | null | undefined} x
 * @param {number | null | undefined} z
 * @returns {{ x: number, z: number } | null}
 */
function unitXZ(x, z) {
  const dx = finiteNum(x);
  const dz = finiteNum(z);
  if (dx == null || dz == null) return null;
  const len = Math.hypot(dx, dz);
  if (len < DIR_MIN) return null;
  return { x: dx / len, z: dz / len };
}

/**
 * Horizontal kick direction.
 * Ball velocity after contact wins (event `vx`/`vz` when present, otherwise
 * the frame). Then player facing, then player velocity, then player → ball.
 * @param {{
 *   eventVx?: number, eventVz?: number,
 *   ballVx?: number, ballVz?: number,
 *   facingX?: number, facingZ?: number,
 *   playerVx?: number, playerVz?: number,
 *   playerX?: number, playerZ?: number,
 *   ballX?: number, ballZ?: number,
 * } | null | undefined} sample
 * @returns {{ x: number, z: number } | null}
 */
export function kickDirection(sample) {
  if (!sample) return null;
  const fromEvent = unitXZ(sample.eventVx, sample.eventVz);
  if (fromEvent) return fromEvent;
  const fromBall = unitXZ(sample.ballVx, sample.ballVz);
  if (fromBall) return fromBall;
  const facing = unitXZ(sample.facingX, sample.facingZ);
  if (facing) return facing;
  const moving = unitXZ(sample.playerVx, sample.playerVz);
  if (moving) return moving;
  const px = finiteNum(sample.playerX);
  const pz = finiteNum(sample.playerZ);
  const bx = finiteNum(sample.ballX);
  const bz = finiteNum(sample.ballZ);
  if (px == null || pz == null || bx == null || bz == null) return null;
  return unitXZ(bx - px, bz - pz);
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
