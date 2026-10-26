// Sample SFX catalog for the replay viewer.
//
// Adding a kind:
//   1. Put the ogg files in this directory (the only assets playback uses).
//   2. Add an entry to SFX_CATALOG: samples, a base gain, and impulse: true
//      when loudness should follow ball speed (kicks and woodwork).
//   3. Point a trigger at it: WHISTLE_KINDS, CONTACT_SFX, or a new branch in
//      planForward. Triggers stay here so viewer.js only forwards the playhead.
//
// Playback itself (unlock, mute, master volume, buffer loading) is audio.js.

import { crossedTick, kickContactsCrossing } from "../cues.js";

/** localStorage key. Mute forces silence; volume scales every kind. */
export const SFX_STORAGE_KEY = "ai-fm-replay-sfx";

/**
 * kind → files in this folder, base gain, and whether the impulse curve applies.
 * Base gains leave headroom for the 1.4× impulse ceiling.
 * block / deflection / tackle have no sample of their own: they reuse `pass`
 * at a lower event gain (see CONTACT_SFX). No synthesized layers.
 */
export const SFX_CATALOG = {
  whistle: { samples: ["whistle.ogg"], gain: 0.8, impulse: false },
  shot: { samples: ["shot.ogg"], gain: 0.9, impulse: true },
  pass: { samples: ["pass_1.ogg", "pass_2.ogg"], gain: 0.75, impulse: true },
  dribble: { samples: ["dribble_1.ogg", "dribble_2.ogg"], gain: 0.5, impulse: false },
  woodwork: { samples: ["woodwork.ogg"], gain: 0.9, impulse: true },
};

/**
 * Referee whistle. One blast per stoppage; see WHISTLE_COOLDOWN_S.
 * `restart_whistle` is the pre-kick ceremony blast (run-up window). Stoppage
 * stays on `out_of_play` / `half_time`. The cooldown already folds an adjacent pair.
 */
export const WHISTLE_KINDS = Object.freeze([
  "kickoff",
  "half_time",
  "out_of_play",
  "restart_ready",
  "restart_whistle",
  "offside",
]);

const WHISTLE_KIND_SET = new Set(WHISTLE_KINDS);

/**
 * Kick events → catalog kind. eventGain < 1 is the quieter pass used for
 * contacts that do not have their own recording.
 */
export const CONTACT_SFX = Object.freeze({
  shot: { sfx: "shot", gain: 1 },
  pass_released: { sfx: "pass", gain: 1 },
  clearance: { sfx: "pass", gain: 1 },
  block: { sfx: "pass", gain: 0.45 },
  deflection: { sfx: "pass", gain: 0.45 },
  tackle: { sfx: "pass", gain: 0.45 },
});

/** Sim seconds. A second whistle inside this window is the same blast. */
export const WHISTLE_COOLDOWN_S = 1;

/**
 * Impulse loudness. 15 m/s → 1.0×, 30 m/s → 1.2×, linear through those
 * anchors. Speed is clamped to [0, 45] so the multiplier stays in [0.8, 1.4].
 * A missing speed uses the 15 m/s anchor (1×), not the floor.
 */
export const IMPULSE_SPEED_LO = 15;
export const IMPULSE_GAIN_LO = 1;
export const IMPULSE_SPEED_HI = 30;
export const IMPULSE_GAIN_HI = 1.2;
export const IMPULSE_SPEED_MIN = 0;
export const IMPULSE_SPEED_MAX = 45;

/** Dribble rhythm. Faster carry → shorter gap. Linear between the anchors. */
export const DRIBBLE_SLOW = Object.freeze({ speed: 1.5, interval: 0.64 });
export const DRIBBLE_FAST = Object.freeze({ speed: 8, interval: 0.22 });
/** Below this planar speed the ball is being held, not dribbled. */
export const DRIBBLE_MIN_SPEED = 0.6;
export const DRIBBLE_MIN_INTERVAL = 0.16;
export const DRIBBLE_MAX_INTERVAL = 0.85;

/** `fm_replay` control index: none / foot / hands. */
export const FOOT_CONTROL = 1;

/** Physics defaults when the replay header does not record them. */
export const DEFAULT_BALL_RADIUS = 0.22;
export const DEFAULT_POST_RADIUS = 0.06;
/**
 * Extra metres on the contact radius. Recorded frames are coarser than the
 * physics step, so a graze can sit just outside ball + post.
 */
export const WOODWORK_SLACK = 0.08;
/** Metres beyond the contact limit before another woodwork hit may play. */
export const WOODWORK_RELEASE_M = 0.55;
const WOODWORK_MIN_INCOMING = 3;
const WOODWORK_MIN_DEFLECTION = 0.45;
const WOODWORK_MIN_DELTA = 2;

export function catalogSampleNames() {
  const names = [];
  for (const entry of Object.values(SFX_CATALOG)) names.push(...entry.samples);
  return names;
}

/**
 * @param {string} kind
 * @returns {{ channel: "whistle" | "contact", sfx: string, eventGain: number } | null}
 */
export function classifyEvent(kind) {
  if (WHISTLE_KIND_SET.has(kind)) return { channel: "whistle", sfx: "whistle", eventGain: 1 };
  const rule = CONTACT_SFX[kind];
  if (!rule) return null;
  return { channel: "contact", sfx: rule.sfx, eventGain: rule.gain };
}

/**
 * Uniform pick. `random` returns a number in [0, 1).
 * @param {readonly string[] | null | undefined} samples
 * @param {() => number} [random]
 * @returns {string | null}
 */
export function pickSample(samples, random = Math.random) {
  if (!samples || samples.length === 0) return null;
  const n = samples.length;
  let r = Number(random());
  if (!Number.isFinite(r)) r = 0;
  const i = Math.min(n - 1, Math.max(0, Math.floor(r * n)));
  return samples[i];
}

/** @param {number} value @returns {number} 0…1, or 1 when the value is unusable */
export function clampVolume(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 1;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/**
 * @param {number | null | undefined} speedMps ball speed after contact
 * @returns {number}
 */
export function impulseScale(speedMps) {
  const s = Number(speedMps);
  if (!Number.isFinite(s)) return IMPULSE_GAIN_LO;
  const v = Math.min(IMPULSE_SPEED_MAX, Math.max(IMPULSE_SPEED_MIN, Math.abs(s)));
  const slope = (IMPULSE_GAIN_HI - IMPULSE_GAIN_LO) / (IMPULSE_SPEED_HI - IMPULSE_SPEED_LO);
  return IMPULSE_GAIN_LO + (v - IMPULSE_SPEED_LO) * slope;
}

/**
 * Seconds between dribble taps, or null when the carrier is too slow.
 * @param {number | null | undefined} speedMps
 * @returns {number | null}
 */
export function dribbleIntervalSeconds(speedMps) {
  const s = Number(speedMps);
  if (!Number.isFinite(s) || s < DRIBBLE_MIN_SPEED) return null;
  const span = DRIBBLE_FAST.speed - DRIBBLE_SLOW.speed;
  const slope = (DRIBBLE_FAST.interval - DRIBBLE_SLOW.interval) / span;
  const raw = DRIBBLE_SLOW.interval + (s - DRIBBLE_SLOW.speed) * slope;
  return Math.min(DRIBBLE_MAX_INTERVAL, Math.max(DRIBBLE_MIN_INTERVAL, raw));
}

/**
 * One dribble step. Fires at most once; extra time is dropped so a hitch
 * cannot dump a burst of taps.
 * @param {{ acc?: number, owner?: number | null } | null | undefined} state
 * @param {{ carrying?: boolean, owner?: number | null, speed?: number, dt?: number }} sample
 */
export function stepDribble(state, sample) {
  const prev = state || { acc: 0, owner: null };
  if (!sample || !sample.carrying || sample.owner == null) {
    return { acc: 0, owner: null, fire: false };
  }
  const owner = sample.owner;
  const interval = dribbleIntervalSeconds(sample.speed);
  if (interval == null) return { acc: 0, owner, fire: false };
  const dt = Number(sample.dt);
  let acc = prev.owner === owner ? Number(prev.acc) || 0 : 0;
  if (!(dt > 0)) return { acc, owner, fire: false };
  acc += dt;
  if (acc < interval) return { acc, owner, fire: false };
  return { acc: 0, owner, fire: true, interval };
}

/** @param {number} value */
function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value) {
  const n = finite(value);
  return n != null && n > 0 ? n : null;
}

/**
 * Ball speed after the strike. Event `vx`/`vy`/`vz` win when any is present;
 * otherwise the frame ball velocity.
 * @param {{ vx?: number, vy?: number, vz?: number } | null | undefined} ev
 * @param {{ vx?: number, vy?: number, vz?: number } | null | undefined} ball
 * @returns {number | null}
 */
export function contactSpeedMps(ev, ball) {
  const eventHas = ev && (ev.vx != null || ev.vy != null || ev.vz != null);
  const src = eventHas ? ev : ball;
  if (!src) return null;
  const vx = finite(src.vx);
  const vy = finite(src.vy);
  const vz = finite(src.vz);
  if (vx == null && vy == null && vz == null) return null;
  return Math.hypot(vx || 0, vy || 0, vz || 0);
}

/**
 * Planar speed of the carrier when we have one, otherwise the ball's.
 * @param {{ vx?: number, vz?: number } | null | undefined} ball
 * @param {number | null | undefined} playerPlanar
 */
export function carrySpeedMps(ball, playerPlanar) {
  if (playerPlanar != null && playerPlanar !== "") {
    const player = Number(playerPlanar);
    if (Number.isFinite(player) && player >= 0) return player;
  }
  const vx = finite(ball?.vx);
  const vz = finite(ball?.vz);
  return Math.hypot(vx || 0, vz || 0);
}

/** Foot control with an owner. Hands (goalkeeper / throw-in) are not a dribble. */
export function isDribbleCarry(ball) {
  if (!ball || ball.owner == null || ball.owner === "") return false;
  if (!Number.isFinite(Number(ball.owner))) return false;
  if (ball.control == null || ball.control === "") return true;
  const mode = Number(ball.control);
  if (!Number.isFinite(mode)) return true;
  return mode === FOOT_CONTROL;
}

export function freshSfxMemory() {
  return {
    lastWhistleTick: null,
    dribble: { acc: 0, owner: null },
    woodworkClear: true,
  };
}

/**
 * @param {object | null | undefined} header
 */
export function pitchFromHeader(header) {
  const field = header?.field || {};
  const length = positive(field.length) ?? 105;
  const width = positive(field.width) ?? 68;
  const goalWidth = positive(field.goal_width) ?? 7.32 * (width / 68);
  const goalHeight = positive(field.goal_height) ?? 2.44;
  const postRadius = positive(field.goal_post_radius) ?? DEFAULT_POST_RADIUS;
  let ballRadius = DEFAULT_BALL_RADIUS;
  const sizes = header?.collision_sizes;
  if (sizes && typeof sizes === "object") {
    for (const key of ["ball_radius", "ballRadius", "ball"]) {
      const n = positive(sizes[key]);
      if (n) {
        ballRadius = n;
        break;
      }
    }
  }
  return { length, width, goalWidth, goalHeight, postRadius, ballRadius };
}

export function woodworkLimit(pitch) {
  const ball = positive(pitch?.ballRadius) ?? DEFAULT_BALL_RADIUS;
  const post = positive(pitch?.postRadius) ?? DEFAULT_POST_RADIUS;
  return ball + post + WOODWORK_SLACK;
}

/** Two posts and one crossbar on each goal line. */
export function woodworkCylinders(pitch) {
  const spec = pitch || pitchFromHeader(null);
  const half = spec.length / 2;
  const hw = spec.goalWidth / 2;
  const h = spec.goalHeight;
  const cylinders = [];
  for (const sign of [-1, 1]) {
    const x = sign * half;
    for (const z of [-hw, hw]) {
      cylinders.push({
        part: "post",
        a: { x, y: 0, z },
        b: { x, y: h, z },
      });
    }
    cylinders.push({
      part: "crossbar",
      a: { x, y: h, z: -hw },
      b: { x, y: h, z: hw },
    });
  }
  return cylinders;
}

function clamp01(t) {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/** Closest distance between segments p1–q1 and p2–q2. */
export function segmentDistance(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const d2z = q2.z - p2.z;
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const eps = 1e-8;
  let s;
  let t;
  if (a <= eps && e <= eps) {
    s = 0;
    t = 0;
  } else if (a <= eps) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= eps) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > eps ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const cx = p1.x + d1x * s;
  const cy = p1.y + d1y * s;
  const cz = p1.z + d1z * s;
  const ax = p2.x + d2x * t;
  const ay = p2.y + d2y * t;
  const az = p2.z + d2z * t;
  return {
    dist: Math.hypot(cx - ax, cy - ay, cz - az),
    centre: { x: cx, y: cy, z: cz },
  };
}

function vecOf(ball) {
  return {
    x: finite(ball?.vx) || 0,
    y: finite(ball?.vy) || 0,
    z: finite(ball?.vz) || 0,
  };
}

function len3(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function deflected(before, after) {
  const v0 = vecOf(before);
  const v1 = vecOf(after);
  const s0 = len3(v0);
  if (s0 < WOODWORK_MIN_INCOMING) return false;
  const dx = v1.x - v0.x;
  const dy = v1.y - v0.y;
  const dz = v1.z - v0.z;
  const delta = Math.hypot(dx, dy, dz);
  const s1 = len3(v1);
  if (!(s1 > 1e-6)) return delta >= WOODWORK_MIN_DELTA;
  const cos = Math.min(1, Math.max(-1, (v0.x * v1.x + v0.y * v1.y + v0.z * v1.z) / (s0 * s1)));
  const angle = Math.acos(cos);
  return angle >= WOODWORK_MIN_DEFLECTION || delta >= WOODWORK_MIN_DELTA;
}

function pointOf(ball) {
  return { x: finite(ball?.x) || 0, y: finite(ball?.y) || 0, z: finite(ball?.z) || 0 };
}

export function nearestWoodwork(ball, pitch) {
  const p = pointOf(ball);
  let best = Infinity;
  for (const cyl of woodworkCylinders(pitch)) {
    const hit = segmentDistance(p, p, cyl.a, cyl.b);
    if (hit.dist < best) best = hit.dist;
  }
  return best;
}

/**
 * Viewer-side post / crossbar hit for a tick the replay did not mark.
 * New replays carry a `woodwork` event (post-impact `vx` / `vy` / `vz`);
 * `planForward` prefers that and calls this only when the forward step has
 * no `woodwork` event on the contact. Watches the ball segment between two
 * frames. Returns null on a miss. `speed` is the ball speed on the later
 * frame (after the contact).
 * @returns {{ part: string, dist: number, speed: number } | null}
 */
export function woodworkStrike(prev, next, pitch) {
  if (!prev || !next || !deflected(prev, next)) return null;
  const spec = pitch || pitchFromHeader(null);
  const limit = woodworkLimit(spec);
  const ballR = positive(spec.ballRadius) ?? DEFAULT_BALL_RADIUS;
  const postR = positive(spec.postRadius) ?? DEFAULT_POST_RADIUS;
  const p0 = pointOf(prev);
  const p1 = pointOf(next);
  let best = null;
  for (const cyl of woodworkCylinders(spec)) {
    const hit = segmentDistance(p0, p1, cyl.a, cyl.b);
    if (hit.dist > limit) continue;
    const sign = Math.sign(cyl.a.x) || 1;
    const into = sign * (hit.centre.x - cyl.a.x);
    if (into > ballR + postR) continue;
    if (!best || hit.dist < best.dist) best = { part: cyl.part, dist: hit.dist };
  }
  if (!best) return null;
  return { ...best, speed: len3(vecOf(next)) };
}

function columnMap(list) {
  return Object.fromEntries((list || []).map((name, i) => [name, i]));
}

function readBall(frame, bcol) {
  const row = frame?.b;
  if (!row || !bcol) return null;
  const at = (key) => (bcol[key] == null ? undefined : row[bcol[key]]);
  return {
    tick: frame.t,
    x: at("x"),
    y: at("y"),
    z: at("z"),
    vx: at("vx"),
    vy: at("vy"),
    vz: at("vz"),
    owner: at("owner"),
    control: at("control"),
  };
}

function playerPlanar(frame, col, owner) {
  if (!frame?.p || !col || col.id == null) return null;
  const id = Number(owner);
  const row = frame.p.find((player) => Number(player[col.id]) === id);
  if (!row || col.vx == null || col.vz == null) return null;
  const vx = finite(row[col.vx]);
  const vz = finite(row[col.vz]);
  return Math.hypot(vx || 0, vz || 0);
}

function crossedForward(prev, next) {
  const p = Number(prev);
  const n = Number(next);
  return Number.isFinite(p) && Number.isFinite(n) && n >= p;
}

/**
 * Forward crossing, plus leaving a whistle the playhead is already standing
 * on (the opening kickoff at tick 0). A rewind is not a cross.
 */
export function crossedWhistle(prev, next, tick) {
  const p = Number(prev);
  const n = Number(next);
  const t = Number(tick);
  if (!Number.isFinite(p) || !Number.isFinite(n) || !Number.isFinite(t)) return false;
  if (n < p) return false;
  if (p < t && n >= t) return true;
  return p === t && n > p;
}

function framePairs(frames, prev, next) {
  const out = [];
  if (!frames?.length) return out;
  const p = Number(prev);
  const n = Number(next);
  if (!Number.isFinite(p) || !Number.isFinite(n) || n < p) return out;
  let i = 0;
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const t = Number(frames[mid]?.t);
    if (!Number.isFinite(t) || t < p) lo = mid + 1;
    else hi = mid;
  }
  i = lo > 0 ? lo - 1 : 0;
  for (; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const at = Number(a?.t);
    const bt = Number(b?.t);
    if (!Number.isFinite(at) || !Number.isFinite(bt)) continue;
    if (bt > n && at >= n) break;
    const overlap = Math.min(bt, n) - Math.max(at, p);
    if (overlap > 0) out.push({ a, b, dtTicks: overlap });
  }
  return out;
}

function ballAtTick(frames, bcol, tick) {
  if (!frames?.length) return null;
  let lo = 0;
  let hi = frames.length;
  const target = Number(tick);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const t = Number(frames[mid]?.t);
    if (!Number.isFinite(t) || t < target) lo = mid + 1;
    else hi = mid;
  }
  const frame = frames[Math.min(lo, frames.length - 1)];
  return readBall(frame, bcol);
}

/**
 * `woodwork` events whose tick lies in `(prev, next]`. One rising edge per
 * post / crossbar contact; `vx` / `vy` / `vz` are the post-impact ball speed.
 * @param {Array<{ kind?: string, tick?: number }> | null | undefined} events
 * @param {number | null | undefined} prev
 * @param {number | null | undefined} next
 */
function woodworkEventsCrossing(events, prev, next) {
  const out = [];
  if (!events || !crossedForward(prev, next)) return out;
  for (const ev of events) {
    if (!ev || ev.kind !== "woodwork") continue;
    if (!crossedTick(prev, next, ev.tick)) continue;
    out.push(ev);
  }
  out.sort((a, b) => Number(a.tick) - Number(b.tick));
  return out;
}

/** True when a crossed `woodwork` event lands in `(at, bt]`. */
function pairHoldsWoodwork(events, at, bt) {
  for (const ev of events) {
    const t = Number(ev.tick);
    if (t > at && t <= bt) return true;
  }
  return false;
}

/**
 * Sounds for one forward play step. Scrub passes nothing here.
 * Memory carries the whistle cooldown, the dribble clock, and the woodwork latch.
 * A crossed `woodwork` event plays `woodwork` at the event's post-impact speed
 * (`contactSpeedMps` on `vx` / `vy` / `vz`). Geometry does not also fire for
 * that contact. It still runs for a forward step with no `woodwork` event, and
 * for a tick inside the step that the engine did not mark.
 * @param {{ prevTick?: number, nextTick?: number, header?: object, events?: object[], frames?: object[] }} step
 * @param {ReturnType<typeof freshSfxMemory>} [memory]
 */
export function planForward(step, memory) {
  const prevMemory = memory || freshSfxMemory();
  if (!step || !crossedForward(step.prevTick, step.nextTick)) {
    return { actions: [], memory: freshSfxMemory() };
  }
  const header = step.header || {};
  const hz = positive(header.tick_hz) ?? 60;
  const bcol = columnMap(header.ball_columns);
  const col = columnMap(header.player_columns);
  const pitch = pitchFromHeader(header);
  const actions = [];

  let lastWhistle = prevMemory.lastWhistleTick;
  const cooldown = WHISTLE_COOLDOWN_S * hz;
  const whistles = [];
  for (const ev of step.events || []) {
    if (!ev || !WHISTLE_KIND_SET.has(ev.kind)) continue;
    if (!crossedWhistle(step.prevTick, step.nextTick, ev.tick)) continue;
    whistles.push(ev);
  }
  whistles.sort((a, b) => Number(a.tick) - Number(b.tick));
  for (const ev of whistles) {
    const tick = Number(ev.tick);
    if (
      lastWhistle != null &&
      Number.isFinite(Number(lastWhistle)) &&
      tick >= Number(lastWhistle) &&
      tick - Number(lastWhistle) < cooldown
    ) {
      continue;
    }
    actions.push({ sfx: "whistle", speed: null, eventGain: 1 });
    lastWhistle = tick;
  }

  for (const ev of kickContactsCrossing(step.events, step.prevTick, step.nextTick)) {
    const rule = CONTACT_SFX[ev.kind];
    if (!rule) continue;
    const ball = ballAtTick(step.frames, bcol, ev.tick);
    actions.push({
      sfx: rule.sfx,
      speed: contactSpeedMps(ev, ball),
      eventGain: rule.gain,
    });
  }

  let dribble = {
    acc: Number(prevMemory.dribble?.acc) || 0,
    owner: prevMemory.dribble?.owner ?? null,
  };
  let woodworkClear = prevMemory.woodworkClear !== false;
  let dribbled = false;
  const release = woodworkLimit(pitch) + WOODWORK_RELEASE_M;
  const woodEvents = woodworkEventsCrossing(step.events, step.prevTick, step.nextTick);
  let woodIndex = 0;
  const playWoodworkEvent = (ev) => {
    const ball = ballAtTick(step.frames, bcol, ev.tick);
    actions.push({
      sfx: "woodwork",
      speed: contactSpeedMps(ev, ball),
      eventGain: 1,
    });
    // The engine already resolved this contact. Hold the latch until the
    // ball leaves so the geometric detector cannot blast the same hit.
    woodworkClear = false;
  };
  const emitWoodworkThrough = (tick) => {
    const limit = Number(tick);
    while (woodIndex < woodEvents.length && Number(woodEvents[woodIndex].tick) <= limit) {
      playWoodworkEvent(woodEvents[woodIndex]);
      woodIndex += 1;
    }
  };
  for (const pair of framePairs(step.frames, step.prevTick, step.nextTick)) {
    const prevBall = readBall(pair.a, bcol);
    const nextBall = readBall(pair.b, bcol);
    const at = Number(pair.a?.t);
    const bt = Number(pair.b?.t);
    if (Number.isFinite(bt)) emitWoodworkThrough(bt);
    const covered = Number.isFinite(at) && Number.isFinite(bt) && pairHoldsWoodwork(woodEvents, at, bt);
    if (!covered) {
      const strike = woodworkStrike(prevBall, nextBall, pitch);
      if (strike && woodworkClear) {
        actions.push({ sfx: "woodwork", speed: strike.speed, eventGain: 1 });
        woodworkClear = false;
      } else if (!strike && nextBall && nearestWoodwork(nextBall, pitch) > release) {
        woodworkClear = true;
      }
    } else if (nextBall && nearestWoodwork(nextBall, pitch) > release) {
      woodworkClear = true;
    }
    const carrying = isDribbleCarry(nextBall);
    const owner = carrying ? Number(nextBall.owner) : null;
    const stepped = stepDribble(dribble, {
      carrying,
      owner,
      speed: carrying ? carrySpeedMps(nextBall, playerPlanar(pair.b, col, owner)) : 0,
      dt: pair.dtTicks / hz,
    });
    dribble = { acc: stepped.acc, owner: stepped.owner };
    if (stepped.fire) {
      if (!dribbled) {
        actions.push({ sfx: "dribble", speed: null, eventGain: 1 });
        dribbled = true;
      } else {
        dribble = { acc: 0, owner: stepped.owner };
      }
    }
  }
  emitWoodworkThrough(step.nextTick);

  return {
    actions,
    memory: { lastWhistleTick: lastWhistle, dribble, woodworkClear },
  };
}

/**
 * Linear gain for one shot: master × kind base × impulse × per-event scale.
 * Mute is not applied here; the player forces silence.
 */
export function sampleGain(sfx, { speed = null, eventGain = 1, master = 1 } = {}) {
  const entry = SFX_CATALOG[sfx];
  if (!entry) return 0;
  const impulse = entry.impulse ? impulseScale(speed) : 1;
  const event = Number(eventGain);
  const scale = Number.isFinite(event) && event > 0 ? event : 0;
  return entry.gain * impulse * scale * clampVolume(master);
}
