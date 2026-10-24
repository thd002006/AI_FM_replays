// On-pitch Chinese labels for match events and skill/intent changes.
// Viewer-only: reads frames/events already in the replay; no sim changes.

/** Hold + fade ≈ 1 s on screen. Debounce stops decision flicker. */
export const PITCH_LABEL = {
  HOLD_SECONDS: 0.75,
  FADE_SECONDS: 0.25,
  DECISION_DEBOUNCE_SECONDS: 0.5,
  /**
   * Fallback world Y when the caller has no body height. The viewer projects
   * at `labelAnchorY(playerHeight)` from markers.js so the text clears the
   * scaled bodies (top-down ignores Y; oblique needs it above the cap).
   */
  ANCHOR_Y: 1.15,
};

/**
 * Opta interception speed floor (m/s).
 * Must match `config/rules.toml` `[interception] intercept_min_ball_speed_m_s`.
 * Used only by the possession-detail fallback for replays that predate the
 * sealed `tackle` / `interception` / `clearance` events.
 */
export const INTERCEPT_MIN_BALL_SPEED_M_S = 1.5;

/** Chinese words drawn for match events. The feed uses the same words. */
export const PITCH_EVENT_LABEL = {
  TACKLE_WON: "抢断",
  DISRUPTED: "破坏",
  INTERCEPTION: "拦截",
  CLEARANCE: "解围",
  SHOT: "射门",
  SAVE: "扑救",
  GOAL: "进球",
  BLOCK: "封堵",
};

/** Replay `kind` values read by {@link eventChinese}. */
export const PITCH_EVENT_KIND = {
  SHOT: "shot",
  GOAL: "goal",
  TACKLE: "tackle",
  INTERCEPTION: "interception",
  CLEARANCE: "clearance",
  BLOCK: "block",
  DEFLECTION: "deflection",
  POSSESSION: "possession_changed",
};

/** `tackle.detail`. */
export const TACKLE_DETAIL = {
  WON: "won",
  DISRUPTED: "disrupted",
};

/** `block.detail` (§2.11). All three draw {@link PITCH_EVENT_LABEL.BLOCK}. */
export const BLOCK_DETAIL = {
  SHOT: "shot",
  PASS: "pass",
  CLEAR: "clear",
};

/**
 * `possession_changed.detail` when a body stop takes the ball (§2.10).
 * The new owner is `other` (`player` is who had it).
 */
export const BODY_CONTROL_ACQUIRED = "body_control/acquired";

/**
 * Same tick, same player: 封堵 is hidden when one of these is already showing.
 * Earlier entries win over later ones. They do not hide each other — 抢断
 * still hides a same-player interception, and that rule is unchanged.
 * `deflection` is not a pitch or feed word, so nothing here exists to hide it.
 */
export const BODY_CONTACT_LOSES_TO = [
  PITCH_EVENT_LABEL.GOAL,
  PITCH_EVENT_LABEL.SAVE,
  PITCH_EVENT_LABEL.TACKLE_WON,
  PITCH_EVENT_LABEL.INTERCEPTION,
  PITCH_EVENT_LABEL.DISRUPTED,
  PITCH_EVENT_LABEL.CLEARANCE,
  PITCH_EVENT_LABEL.SHOT,
];

const BODY_CONTACT_LABELS = new Set([PITCH_EVENT_LABEL.BLOCK]);

const TOTAL_SECONDS = () => PITCH_LABEL.HOLD_SECONDS + PITCH_LABEL.FADE_SECONDS;

/**
 * One Chinese name per `config/ai/skills.toml` intent id.
 * Phase tags in the replay (`press:active`, `run_behind:recycle`, …) share
 * that intent's name. Keys stay in skills.toml order.
 */
export const INTENT_LABEL = {
  hold_shape: "阵型",
  support: "接应",
  drop_back: "回撤",
  run_behind: "前插",
  chase_ball: "追球",
  defence_run: "落位",
  recover_shape: "回位",
  press: "逼抢",
  breakthrough: "突破",
  wide_progress: "边路",
  escape_pressure: "摆脱",
  shield_ball: "护球",
  shoot: "射门",
  clear: "解围",
  tackle: "抢断",
  pass: "传球",
  mark: "盯人",
  gk_position: "站位",
  gk_rush: "出击",
  gk_distribute: "出球",
  stretch_width: "拉边",
};

/**
 * Replay `intent` tag → skills.toml id.
 * `carry`, `keeper`, `restart:taker` and `move_target` are not intents.
 */
const INTENT_TAG_TO_ID = {
  hold_shape: "hold_shape",
  support: "support",
  drop_back: "drop_back",
  stretch_width: "stretch_width",
  "run_behind:stage": "run_behind",
  "run_behind:window": "run_behind",
  "run_behind:recycle": "run_behind",
  "chase:pursue": "chase_ball",
  "chase:receive": "chase_ball",
  recover_shape: "recover_shape",
  defence_run: "defence_run",
  "press:approach": "press",
  "press:active": "press",
  tackle: "tackle",
  mark: "mark",
  clear: "clear",
  shoot: "shoot",
  pass: "pass",
  shield_ball: "shield_ball",
  "dribble:breakthrough": "breakthrough",
  "dribble:wide_progress": "wide_progress",
  "dribble:escape_pressure": "escape_pressure",
  gk_position: "gk_position",
  gk_rush: "gk_rush",
  gk_distribute: "gk_distribute",
};

/**
 * Chinese for the player's current skills.toml intent, or "" when the replay
 * has none. An intent tag wins. A non-intent tag (`keeper`, `restart:taker`,
 * `carry`, `move_target`, empty) falls through to the skill column, which is
 * the protocol intent id when one is running.
 * @param {string} skill `header.skill_names` entry
 * @param {string} intent `header.intent_names` entry
 * @returns {string}
 */
export function decisionChinese(skill, intent) {
  const fromIntent = INTENT_LABEL[INTENT_TAG_TO_ID[intent]];
  if (fromIntent) return fromIntent;
  const fromSkill = INTENT_LABEL[skill];
  if (fromSkill) return fromSkill;
  return "";
}

/**
 * Prominent event label, or null when the event is not shown on the pitch.
 * Shared by on-pitch labels and the side event feed.
 *
 * Replays that contain `tackle`, `interception`, or `clearance` (B59) map
 * those kinds directly:
 * - `tackle` + `detail=won` → 抢断; `detail=disrupted` → 破坏
 * - `interception` → 拦截, unless `ctx.suppressInterception` (a `tackle` won
 *   on the same tick and player keeps 抢断 and this label is dropped)
 * - `clearance` → 解围
 * Goalkeeper saves stay on `possession_changed`. The four derived labels are
 * not also taken from `possession_changed` in that replay.
 *
 * `block` (any `detail`, including `shot` / `pass` / `clear`) → 封堵.
 * `deflection` is not shown on the pitch or in the feed.
 * {@link classifyPitchEvents} drops 封堵 when it shares a tick and player
 * with a higher word in {@link BODY_CONTACT_LOSES_TO}, or with a
 * `body_control/acquired` for that player (`other`). A `block` or
 * `deflection` does not by itself turn off the legacy possession path.
 *
 * Replays with none of those kinds keep the old `possession_changed`
 * derivation (`ctx.legacyPossession`, set by {@link classifyPitchEvents}):
 * - tackle won is a cross-team `owner_set/acquired`
 * - `tackle/released` is a poke-loose; `tackle/acquired` is not a new tackle
 * - an opponent acquire during a pass flight is 拦截 only when planar travel
 *   from release is still short of the designated receiver and ball speed is
 *   at least {@link INTERCEPT_MIN_BALL_SPEED_M_S} (`ctx.interception`)
 * A steal that is also an Opta interception keeps 抢断 (one label per event).
 *
 * Called on one event with no context, possession labels use the legacy
 * derivation so a single old event still reads. A full replay must go through
 * {@link classifyPitchEvents}, which turns that derivation off once any sealed
 * defense event is present.
 *
 * @param {{ kind?: string, detail?: string, contested?: boolean, team?: number|null, player?: number|null, other?: number|null, tick?: number, x?: number, z?: number }} ev
 * @param {{ playerTeam?: Map<number, number>|Record<number, number>, interception?: boolean, legacyPossession?: boolean, suppressInterception?: boolean }} [ctx]
 * @returns {string|null}
 */
export function eventChinese(ev, ctx = {}) {
  if (!ev || !ev.kind) return null;
  if (ev.kind === PITCH_EVENT_KIND.SHOT) return PITCH_EVENT_LABEL.SHOT;
  if (ev.kind === PITCH_EVENT_KIND.GOAL) return PITCH_EVENT_LABEL.GOAL;
  if (ev.kind === PITCH_EVENT_KIND.TACKLE) {
    if (ev.detail === TACKLE_DETAIL.WON) return PITCH_EVENT_LABEL.TACKLE_WON;
    if (ev.detail === TACKLE_DETAIL.DISRUPTED) return PITCH_EVENT_LABEL.DISRUPTED;
    return null;
  }
  if (ev.kind === PITCH_EVENT_KIND.INTERCEPTION) {
    return ctx.suppressInterception ? null : PITCH_EVENT_LABEL.INTERCEPTION;
  }
  if (ev.kind === PITCH_EVENT_KIND.CLEARANCE) return PITCH_EVENT_LABEL.CLEARANCE;
  if (ev.kind === PITCH_EVENT_KIND.BLOCK) return PITCH_EVENT_LABEL.BLOCK;
  if (ev.kind === PITCH_EVENT_KIND.DEFLECTION) return null;
  if (ev.kind !== PITCH_EVENT_KIND.POSSESSION) return null;
  const detail = ev.detail || "";
  if (
    detail.startsWith("goalkeeper_catch") ||
    detail.startsWith("goalkeeper_receive") ||
    detail.startsWith("goalkeeper_claim")
  ) {
    return PITCH_EVENT_LABEL.SAVE;
  }
  // Default on: one-off calls and old files. classifyPitchEvents passes false
  // once the replay contains sealed defense events.
  if (ctx.legacyPossession === false) return null;
  if (detail === "tackle/released") return PITCH_EVENT_LABEL.DISRUPTED;
  if (detail === "tackle/acquired") return null;
  if (detail.startsWith("clear/")) return PITCH_EVENT_LABEL.CLEARANCE;
  if (isTackleWon(ev, ctx.playerTeam)) return PITCH_EVENT_LABEL.TACKLE_WON;
  if (ctx.interception) return PITCH_EVENT_LABEL.INTERCEPTION;
  return null;
}

function teamSlot(team) {
  return team === 0 || team === 1 ? team : null;
}

function teamOf(playerTeam, id) {
  if (id == null || playerTeam == null) return null;
  const t = typeof playerTeam.get === "function" ? playerTeam.get(id) : playerTeam[id];
  return teamSlot(t);
}

/** Cross-team `owner_set/acquired`, same predicate as `tally_tackles`. */
function isTackleWon(ev, playerTeam) {
  if ((ev.detail || "") !== "owner_set/acquired") return false;
  const to = teamSlot(ev.team) ?? teamOf(playerTeam, ev.other);
  const from = teamOf(playerTeam, ev.player);
  if (to == null || from == null) return false;
  return from !== to;
}

function frameTick(frame) {
  if (Number.isFinite(frame.tick)) return frame.tick;
  if (Number.isFinite(frame.t)) return frame.t;
  return 0;
}

/**
 * Viewer rows (`p` / `b` plus column maps) or already-normalized stat frames.
 * @param {Array<object>|undefined} frames
 * @param {Record<string, number>|undefined} col
 * @param {Record<string, number>|undefined} bcol
 */
export function viewerFramesAsStat(frames, col, bcol) {
  if (!frames) return [];
  return frames.map((f) => {
    if (f.players) return f;
    const rows = f.p || [];
    return {
      tick: frameTick(f),
      players: rows.map((row) => ({
        id: row[col.id],
        team: row[col.team],
        x: row[col.x],
        z: row[col.z],
      })),
      ball:
        bcol && f.b
          ? {
              x: f.b[bcol.x],
              z: f.b[bcol.z],
              vx: f.b[bcol.vx] ?? 0,
              vy: f.b[bcol.vy] ?? 0,
              vz: f.b[bcol.vz] ?? 0,
            }
          : null,
    };
  });
}

/** id → team from the first frame that lists players (same as `player_team_index`). */
export function playerTeamIndex(frames) {
  const map = new Map();
  const fill = (list) => {
    for (const f of list) {
      const players = f.players || [];
      if (players.length === 0) continue;
      for (const p of players) map.set(p.id, p.team);
      return true;
    }
    return false;
  };
  if (!fill(frames)) {
    for (const f of frames) {
      for (const p of f.players || []) map.set(p.id, p.team);
    }
  }
  return map;
}

function frameAtTick(frames, tick) {
  // Tick order. The old scan stopped at the first later frame; this is that frame.
  let lo = 0;
  let hi = frames.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const ft = frameTick(frames[mid]);
    if (ft === tick) return frames[mid];
    if (ft < tick) {
      best = frames[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function playerXzAt(frames, tick, id) {
  const f = frameAtTick(frames, tick);
  if (!f) return null;
  const p = (f.players || []).find((q) => q.id === id);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  return { x: p.x, z: p.z };
}

function ballStateAt(frames, tick) {
  const f = frameAtTick(frames, tick);
  if (!f || !f.ball) return null;
  const b = f.ball;
  const vx = b.vx ?? 0;
  const vy = b.vy ?? 0;
  const vz = b.vz ?? 0;
  return { x: b.x, z: b.z, speed: Math.hypot(vx, vy, vz) };
}

function planar(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

/** `is_opta_intercept`: travel < intended receiver distance AND speed ≥ floor. */
function isOptaIntercept(pending, tick, frames, minSpeed) {
  if (pending.intendedM == null) return false;
  const ball = ballStateAt(frames, tick);
  if (!ball || !Number.isFinite(ball.x) || !Number.isFinite(ball.z)) return false;
  const travelled = planar(pending.releaseX, pending.releaseZ, ball.x, ball.z);
  return travelled < pending.intendedM && ball.speed >= minSpeed;
}

/**
 * Per-event Opta Int flags. State machine matches `tally_interceptions`:
 * a new `pass_released` replaces the pending pass; `pass_completed`,
 * `out_of_play`, `shot` and `goal` clear it; `tackle/` and `goalkeeper_`
 * clear it without an interception; other non-acquires leave it pending.
 * @returns {boolean[]}
 */
function interceptionFlags(events, frames, minSpeed) {
  const flags = new Array(events.length).fill(false);
  let pending = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const kind = e.kind;
    if (kind === "pass_released") {
      const passer = teamSlot(e.team);
      if (passer == null) {
        pending = null;
        continue;
      }
      let intendedM = null;
      if (e.other != null) {
        const pos = playerXzAt(frames, e.tick, e.other);
        if (pos) intendedM = planar(e.x, e.z, pos.x, pos.z);
      }
      pending = {
        passer,
        releaseTick: e.tick,
        releaseX: e.x,
        releaseZ: e.z,
        intendedM,
      };
      continue;
    }
    if (kind === "pass_completed" || kind === "out_of_play" || kind === "shot" || kind === "goal") {
      pending = null;
      continue;
    }
    if (kind !== "possession_changed" || !pending) continue;
    const d = e.detail || "";
    if (d.startsWith("tackle/")) {
      pending = null;
      continue;
    }
    if (d.startsWith("goalkeeper_")) {
      pending = null;
      continue;
    }
    const acq = teamSlot(e.team);
    if (acq == null) continue;
    if (!d.endsWith("/acquired")) continue;
    if (acq === pending.passer) {
      pending = null;
      continue;
    }
    if (!(e.tick > pending.releaseTick)) {
      pending = null;
      continue;
    }
    if (isOptaIntercept(pending, e.tick, frames, minSpeed)) flags[i] = true;
    pending = null;
  }
  return flags;
}

/**
 * True when the replay carries sealed defense events (B59) rather than only details.
 * `block` / `deflection` do not count: an old file that somehow has one still
 * derives 抢断 / 破坏 / 解围 / 拦截 from `possession_changed`.
 */
function hasSealedDefense(events) {
  return events.some(
    (e) =>
      e &&
      (e.kind === PITCH_EVENT_KIND.TACKLE ||
        e.kind === PITCH_EVENT_KIND.INTERCEPTION ||
        e.kind === PITCH_EVENT_KIND.CLEARANCE),
  );
}

/**
 * `tackle` won keys (`tick:player`) that hide a same-tick interception label.
 * @param {Array<object>} events
 */
function tackleWonKeys(events) {
  const keys = new Set();
  for (const e of events) {
    if (
      e &&
      e.kind === PITCH_EVENT_KIND.TACKLE &&
      e.detail === TACKLE_DETAIL.WON &&
      e.player != null &&
      e.tick != null
    ) {
      keys.add(`${e.tick}:${e.player}`);
    }
  }
  return keys;
}

/**
 * One Chinese label per event.
 *
 * When the list contains any `tackle`, `interception`, or `clearance`, those
 * kinds are the labels and the possession-detail derivation is off (goalkeeper
 * saves still show). A `tackle` won and an `interception` for the same player
 * on the same tick produce only 抢断. `block` and `deflection` are not part of
 * that switch. `deflection` never gets a word.
 *
 * Otherwise the list is an old replay: labels come from `possession_changed`
 * details and the Opta interception scan.
 *
 * Either way, 封堵 is dropped for a player who, on that same tick, already
 * has a word in {@link BODY_CONTACT_LOSES_TO}, or a
 * {@link BODY_CONTROL_ACQUIRED} (`other` is the player who took the ball).
 * The higher word stays, so a block that is also an interception shows 拦截,
 * and a block that is only a body stop shows nothing (the stop is not a pitch
 * word). Another player's label on that tick is kept: a shot and the block
 * that meets it both show.
 *
 * Pass viewer frames with `col` / `bcol`, or frames already shaped as
 * `{ tick, players: [{id, team, x, z}], ball: {x, z, vx, vy, vz} }`.
 * @param {object} opts
 * @param {Array<object>} [opts.events]
 * @param {Array<object>} [opts.frames]
 * @param {Record<string, number>} [opts.col]
 * @param {Record<string, number>} [opts.bcol]
 * @param {Map<number, number>} [opts.playerTeam]
 * @param {number} [opts.interceptMinBallSpeed]
 * @param {Array<object>} [opts.statFrames] frames already shaped for the legacy scan
 * @returns {Array<string|null>}
 */
export function classifyPitchEvents({
  events,
  frames,
  col,
  bcol,
  playerTeam,
  interceptMinBallSpeed = INTERCEPT_MIN_BALL_SPEED_M_S,
  statFrames,
} = {}) {
  const list = events || [];
  let labels;
  if (hasSealedDefense(list)) {
    const won = tackleWonKeys(list);
    labels = list.map((ev) =>
      eventChinese(ev, {
        legacyPossession: false,
        suppressInterception:
          ev.kind === PITCH_EVENT_KIND.INTERCEPTION &&
          ev.player != null &&
          ev.tick != null &&
          won.has(`${ev.tick}:${ev.player}`),
      }),
    );
  } else {
    const shaped = statFrames || viewerFramesAsStat(frames || [], col, bcol);
    const teams = playerTeam || playerTeamIndex(shaped);
    const flags = interceptionFlags(list, shaped, interceptMinBallSpeed);
    labels = list.map((ev, i) =>
      eventChinese(ev, { playerTeam: teams, interception: flags[i], legacyPossession: true }),
    );
  }
  return suppressSharedTickBodyLabels(list, labels);
}

function tickPlayerKey(tick, player) {
  if (player == null || tick == null || !Number.isFinite(Number(tick))) return null;
  return `${tick}:${player}`;
}

/**
 * Player a label is about. An acquire stores the new owner in `other`
 * (`player` is the previous owner).
 */
function pitchLabelActor(ev) {
  if (!ev) return null;
  if (ev.kind === PITCH_EVENT_KIND.POSSESSION) {
    const detail = ev.detail || "";
    if (detail.endsWith("/acquired") && ev.other != null) return ev.other;
  }
  return ev.player != null ? ev.player : null;
}

/**
 * One label when a body-contact word shares a tick and player with a clearer one.
 * @param {Array<object>} events
 * @param {Array<string|null>} labels
 * @returns {Array<string|null>}
 */
function suppressSharedTickBodyLabels(events, labels) {
  const higher = new Set();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const text = labels[i];
    if (text && !BODY_CONTACT_LABELS.has(text) && BODY_CONTACT_LOSES_TO.includes(text)) {
      const key = tickPlayerKey(ev.tick, pitchLabelActor(ev));
      if (key) higher.add(key);
    }
    if (
      ev &&
      ev.kind === PITCH_EVENT_KIND.POSSESSION &&
      (ev.detail || "") === BODY_CONTROL_ACQUIRED
    ) {
      const who = ev.other != null ? ev.other : ev.player;
      const key = tickPlayerKey(ev.tick, who);
      if (key) higher.add(key);
    }
  }
  return labels.map((text, i) => {
    if (!text || !BODY_CONTACT_LABELS.has(text)) return text;
    const key = tickPlayerKey(events[i].tick, pitchLabelActor(events[i]));
    if (!key) return text;
    if (higher.has(key)) return null;
    return text;
  });
}

/**
 * `restart_ready.detail` and `out_of_play.detail` are `phase_tag` strings
 * (`fm_script::record::phase_tag`). `corner_kick` is accepted as `corner`.
 * Indirect / direct free-kick tags are recognised when a replay actually
 * carries them; the engine currently writes only `free_kick`.
 */
export const RESTART_PHASE_LABEL = {
  throw_in: "界外球",
  corner: "角球",
  corner_kick: "角球",
  goal_kick: "球门球",
  free_kick: "任意球",
  indirect_free_kick: "间接任意球",
  free_kick_indirect: "间接任意球",
  direct_free_kick: "直接任意球",
  free_kick_direct: "直接任意球",
  kickoff: "开球",
  penalty: "点球",
};

const OUT_OF_PLAY_LABEL = "出界";
const RESTART_FALLBACK_LABEL = "重启";
const OFFSIDE_LABEL = "越位";

/** Phase key, dropping the engine's ` (no toucher)` suffix on `out_of_play`. */
function restartPhaseKey(detail) {
  if (typeof detail !== "string") return "";
  return detail.replace(/\s*\(no toucher\)\s*$/, "").trim();
}

/**
 * Chinese for a restart phase tag, or null when `detail` is missing or unknown.
 * @param {string} [detail]
 * @returns {string|null}
 */
export function restartPhaseChinese(detail) {
  const key = restartPhaseKey(detail);
  return RESTART_PHASE_LABEL[key] || null;
}

/**
 * Chinese text for the side event feed. Reuses {@link eventChinese} for the
 * prominent pitch set, then adds offside / out-of-play / restart when present.
 * Decision-change labels are never included. Offside, out-of-play and restart
 * stay off the pitch. Team and player stay on the row, not in this string.
 * @param {{ kind?: string, detail?: string, contested?: boolean, team?: number|null, player?: number|null, other?: number|null }} ev
 * @param {string|null} [classified] precomputed {@link eventChinese} result
 * @returns {string|null}
 */
export function feedEventChinese(ev, classified) {
  const prominent = classified !== undefined ? classified : eventChinese(ev);
  if (prominent) return prominent;
  if (!ev || !ev.kind) return null;
  if (ev.kind === "offside") return OFFSIDE_LABEL;
  if (ev.kind === "out_of_play") return restartPhaseChinese(ev.detail) || OUT_OF_PLAY_LABEL;
  if (ev.kind === "restart_ready") return restartPhaseChinese(ev.detail) || RESTART_FALLBACK_LABEL;
  return null;
}

/**
 * Feed rows for every classified event with real time ≤ `now`, newest first.
 * Rebuild from `events` on each call so seeking forwards or backwards stays
 * in sync; do not append incrementally.
 * @param {object} opts
 * @param {Array<object>} opts.events
 * @param {number} opts.now real seconds
 * @param {(ev: object) => number} opts.realOfEvent
 * @param {Array<string|null>} [opts.labels] from {@link classifyPitchEvents}
 * @returns {Array<{index:number, text:string, time:number, team:number|null, player:number|null, event:object}>}
 */
export function feedEventsUpTo({ events, now, realOfEvent, labels }) {
  /** @type {Array<{index:number, text:string, time:number, team:number|null, player:number|null, event:object}>} */
  const rows = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const text = feedEventChinese(ev, labels ? labels[i] : undefined);
    if (!text) continue;
    const time = realOfEvent(ev);
    if (!(time <= now)) continue;
    const team = ev.team === 0 || ev.team === 1 ? ev.team : null;
    const player = ev.player != null ? ev.player : ev.other != null ? ev.other : null;
    rows.push({ index: i, text, time, team, player, event: ev });
  }
  rows.reverse();
  return rows;
}

/**
 * Opacity in [0, 1] for a label born at `born` and viewed at `now`.
 * @param {number} now
 * @param {number} born
 * @param {number} [hold]
 * @param {number} [fade]
 */
export function labelOpacity(
  now,
  born,
  hold = PITCH_LABEL.HOLD_SECONDS,
  fade = PITCH_LABEL.FADE_SECONDS,
) {
  const age = now - born;
  if (age < 0 || age >= hold + fade) return 0;
  if (age <= hold) return 1;
  return Math.max(0, 1 - (age - hold) / fade);
}

/**
 * Active event labels at real-time `now`.
 * Includes the feed-only kinds ({@link feedEventChinese}): 出界、越位、重启类型.
 * `pass_released` and `deflection` stay off this layer.
 * @param {object} opts
 * @param {Array<object>} opts.events
 * @param {number} opts.now real seconds
 * @param {(ev: object) => number} opts.realOfEvent
 * @param {(playerId: number) => ({x:number,z:number}|null)} [opts.playerPos]
 * @param {Array<string|null>} [opts.labels] from {@link classifyPitchEvents}
 * @returns {Array<{key:string, text:string, x:number, z:number, opacity:number, style:"event"}>}
 */
export function activeEventLabels({ events, now, realOfEvent, playerPos, labels }) {
  const out = [];
  const window = TOTAL_SECONDS();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    // Prominent chips stay as classified. Feed-only kinds (出界、越位、重启)
    // use the same Chinese as the side feed, and only while 事件 is drawn.
    const text = labels ? feedEventChinese(ev, labels[i]) : feedEventChinese(ev);
    if (!text) continue;
    const born = realOfEvent(ev);
    const opacity = labelOpacity(now, born);
    if (opacity <= 0) continue;
    if (now - born > window) continue;
    let x = ev.x;
    let z = ev.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      const id = ev.other ?? ev.player;
      const pos = id != null && playerPos ? playerPos(id) : null;
      if (!pos) continue;
      x = pos.x;
      z = pos.z;
    }
    out.push({
      key: `e${i}`,
      text,
      x,
      z,
      opacity,
      style: "event",
    });
  }
  return out;
}

/**
 * Precompute decision-change birth times (call once after load).
 * Only emits when skill or intent index changes; per-player debounce applies.
 * @param {object} opts
 * @param {Array<{t:number, p:any[]}>} opts.frames
 * @param {Record<string, number>} opts.col
 * @param {string[]} opts.skillNames
 * @param {string[]} opts.intentNames
 * @param {(frame: object) => number} opts.realOfFrame
 * @param {number} [opts.debounce]
 * @param {number} [opts.fromFrame] first frame index; earlier frames are already in `prev`
 * @param {Map<number, {skill:number, intent:number, lastShow:number}>} [opts.prev] cursor, mutated
 * @param {Array<{player:number, text:string, born:number, x:number, z:number}>} [opts.into] births to append
 * @returns {Array<{player:number, text:string, born:number, x:number, z:number}>}
 */
export function collectDecisionBirths({
  frames,
  col,
  skillNames,
  intentNames,
  realOfFrame,
  debounce = PITCH_LABEL.DECISION_DEBOUNCE_SECONDS,
  fromFrame = 0,
  prev = null,
  into = null,
}) {
  /** @type {Map<number, {skill:number, intent:number, lastShow:number}>} */
  const cursor = prev || new Map();
  /** @type {Array<{player:number, text:string, born:number, x:number, z:number}>} */
  const births = into || [];
  const start = Number.isInteger(fromFrame) && fromFrame > 0 ? fromFrame : 0;
  for (let fi = start; fi < frames.length; fi++) {
    const frame = frames[fi];
    const t = realOfFrame(frame);
    for (const row of frame.p) {
      const id = row[col.id];
      const skill = row[col.skill] ?? 0;
      const intent = row[col.intent] ?? 0;
      const last = cursor.get(id);
      if (!last) {
        cursor.set(id, { skill, intent, lastShow: -Infinity });
        continue;
      }
      if (skill === last.skill && intent === last.intent) continue;
      last.skill = skill;
      last.intent = intent;
      if (t - last.lastShow < debounce) continue;
      const text = decisionChinese(skillNames[skill] || "", intentNames[intent] || "");
      if (!text) continue;
      last.lastShow = t;
      births.push({
        player: id,
        text,
        born: t,
        x: row[col.x],
        z: row[col.z],
      });
    }
  }
  return births;
}

/**
 * Continuous head labels for the current frame.
 * One chip per player whose skill/intent maps to {@link INTENT_LABEL}.
 * No fade and no debounce: the word stays while the frame still says that
 * intent, and is absent when {@link decisionChinese} is empty.
 * @param {object} opts
 * @param {Array<Array<number>>} opts.rows player rows
 * @param {Record<string, number>} opts.col
 * @param {string[]} opts.skillNames
 * @param {string[]} opts.intentNames
 * @returns {Array<{key:string, text:string, x:number, z:number, opacity:number, style:"intent", player:number}>}
 */
export function activeIntentLabels({ rows, col, skillNames, intentNames }) {
  const out = [];
  if (!rows || !col) return out;
  const skills = skillNames || [];
  const intents = intentNames || [];
  for (const row of rows) {
    const id = row[col.id];
    const text = decisionChinese(skills[row[col.skill] ?? 0] || "", intents[row[col.intent] ?? 0] || "");
    if (!text) continue;
    out.push({
      key: `i${id}`,
      text,
      x: row[col.x],
      z: row[col.z],
      opacity: 1,
      style: "intent",
      player: id,
    });
  }
  return out;
}

/**
 * Overlay switches from the page query.
 * `pitch_decisions` is the old name of 意图. `labels=0` is the old name of 球高 off.
 * `markers` stays off unless `markers=1` (no checkbox).
 * @param {URLSearchParams|{ get:(key:string)=>string|null, has?:(key:string)=>boolean }} search
 */
export function overlayFlags(search) {
  const get = (key) => (search && typeof search.get === "function" ? search.get(key) : null);
  const has = (key) => (search && typeof search.has === "function" ? search.has(key) : get(key) != null);
  const off = (key) => get(key) === "0";
  let pitchIntents = true;
  if (has("pitch_intents")) pitchIntents = !off("pitch_intents");
  else if (has("pitch_decisions")) pitchIntents = !off("pitch_decisions");
  let ballHeight = true;
  if (has("ball_height")) ballHeight = !off("ball_height");
  else if (off("labels")) ballHeight = false;
  return {
    pitchEvents: !off("pitch_events"),
    pitchIntents,
    ballHeight,
    trail: !off("trail"),
    markers: get("markers") === "1",
  };
}

/**
 * Active decision labels at real-time `now`, from a precomputed birth list.
 * @param {object} opts
 * @param {Array<{player:number, text:string, born:number, x:number, z:number}>} opts.births
 * @param {number} opts.now
 * @param {Map<number, {x:number, z:number}>|Record<number, {x:number, z:number}>} [opts.positions]
 * @returns {Array<{key:string, text:string, x:number, z:number, opacity:number, style:"decision", player:number}>}
 */
export function activeDecisionLabels({ births, now, positions }) {
  const out = [];
  const posOf = (id) => {
    if (!positions) return null;
    if (typeof positions.get === "function") return positions.get(id) || null;
    return positions[id] || null;
  };
  for (let i = 0; i < births.length; i++) {
    const b = births[i];
    const opacity = labelOpacity(now, b.born);
    if (opacity <= 0) continue;
    const p = posOf(b.player) || { x: b.x, z: b.z };
    out.push({
      key: `d${b.player}-${b.born}`,
      text: b.text,
      x: p.x,
      z: p.z,
      opacity,
      style: "decision",
      player: b.player,
    });
  }
  return out;
}
