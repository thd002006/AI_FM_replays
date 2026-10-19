// Broadcast match clock (§5.7). Display conversion only: the half split is the
// `half_time` event already in the file. No added-time estimate, no format branch.

/** Real seconds the half-time banner stays fully visible before it fades. */
export const HALF_TIME_BANNER_S = 3;

/**
 * @param {Array<{kind?: string, tick?: number, time?: number}> | null | undefined} events
 * @returns {{tick: number, time: number} | null}
 */
export function findHalfTime(events) {
  if (!events) return null;
  for (const ev of events) {
    if (ev && ev.kind === "half_time" && Number.isFinite(Number(ev.tick))) {
      return { tick: Number(ev.tick), time: Number(ev.time) || 0 };
    }
  }
  return null;
}

/**
 * `MM:SS`. Minutes may pass 59 (90:00 is a match clock, not an hour wrap).
 * 1e-9 s sits on top of the value so binary dust just under a whole second
 * (2700 − 1.1e-10 from `half_time.time`) does not floor to the previous minute.
 */
export function formatMmSs(seconds) {
  const total = Math.max(0, Math.floor((Number(seconds) || 0) + 1e-9));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Real-time readout used when the file has no `header.clock`.
 * Same whole-second `MM:SS` as {@link formatMmSs}.
 */
export function formatRealClock(seconds) {
  return formatMmSs(seconds);
}

function endMinuteLabel(limit) {
  const minutes = limit / 60;
  if (Number.isInteger(minutes)) return String(minutes);
  const rounded = Math.round(minutes * 100) / 100;
  return String(rounded);
}

/**
 * Turn a cumulative display time into the television readout.
 * `tick` chooses the half when it is a number (the `half_time` event tick).
 * A snapshot that only has match seconds uses that event's `time` as the same split.
 * Returns null when `clock` is missing.
 *
 * @param {number} matchSeconds cumulative display seconds (`frames[].time`)
 * @param {number | null | undefined} tick
 * @param {{half_game_seconds: number} | null | undefined} clock
 * @param {{tick: number, time: number} | null} halfTime
 */
export function broadcastClock(matchSeconds, tick, clock, halfTime) {
  if (!clock || !Number.isFinite(Number(clock.half_game_seconds))) return null;
  const H = Number(clock.half_game_seconds);
  const t = Number(matchSeconds);
  if (!Number.isFinite(t)) return formatMmSs(0);
  const secondHalf = halfTime
    ? tick != null && Number.isFinite(Number(tick))
      ? Number(tick) >= halfTime.tick
      : t >= halfTime.time
    : false;
  const e = secondHalf ? H + (t - halfTime.time) : t;
  const base = secondHalf ? H : 0;
  const limit = base + H;
  const excess = e - limit;
  // 1e-9 s absorbs binary dust on an exact whistle (2700, 5400). It is not a
  // stoppage threshold: anything actually past the half uses the +N′ formula.
  if (!(excess > 1e-9)) return formatMmSs(e);
  const n = Math.ceil(excess / 60 - 1e-12);
  return `${endMinuteLabel(limit)}+${n}′`;
}

/**
 * @param {{clock?: object|null, phase?: string, tick?: number, bannerVisible?: boolean, halfTime?: {tick:number}|null}} opts
 * @returns {"" | "上半场" | "中场" | "下半场" | "完场"}
 */
export function halfLabel(opts) {
  if (!opts || !opts.clock) return "";
  if (opts.phase === "full_time") return "完场";
  if (opts.phase === "half_time" || opts.bannerVisible) return "中场";
  if (opts.halfTime && Number(opts.tick) >= opts.halfTime.tick) return "下半场";
  return "上半场";
}

/** 「中场休息 · 主 a – b 客」 */
export function halfTimeBannerText(score) {
  const home = score && Number.isFinite(Number(score[0])) ? Number(score[0]) : 0;
  const away = score && Number.isFinite(Number(score[1])) ? Number(score[1]) : 0;
  return `中场休息 · 主 ${home} – ${away} 客`;
}
