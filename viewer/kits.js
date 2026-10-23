// Kit colours for the replay viewer. Outfield stays team blue / coral.
// Each goalkeeper has a shirt of its own: gold for the home keeper, violet
// for the away keeper. Neither matches an outfield shirt or the other keeper.
// The pitch camera does not turn at half-time; shirt numbers stay on the
// player id (see shirtNumber) and are not taken from roster or row order.

/** Home outfield, away outfield. Same hexes as `--home` / `--away`. */
export const OUTFIELD = [0x3d8bfd, 0xff6b5e];

/**
 * Home keeper, away keeper. Same hexes as `--home-gk` / `--away-gk`.
 * Gold is the tactics-board GK disc. Violet sits away from that gold,
 * from both outfield colours, and from the grass.
 */
export const KEEPER = [0xeab308, 0xc084fc];

/**
 * @param {number} team
 * @returns {number}
 */
export function outfieldColor(team) {
  return OUTFIELD[team] ?? 0xcccccc;
}

/**
 * @param {number} team
 * @returns {number}
 */
export function keeperColor(team) {
  const color = KEEPER[team];
  return color == null ? outfieldColor(team) : color;
}

/**
 * @param {number} team
 * @param {boolean} keeper
 * @returns {number}
 */
export function playerColor(team, keeper) {
  return keeper ? keeperColor(team) : outfieldColor(team);
}

/**
 * CSS class for a player chip. `none` when the team is unknown.
 * @param {number | null | undefined} team
 * @param {boolean} keeper
 * @returns {"home" | "away" | "home gk" | "away gk" | "none"}
 */
export function kitClass(team, keeper) {
  const side = team === 0 ? "home" : team === 1 ? "away" : "none";
  if (side === "none" || !keeper) return side;
  return `${side} gk`;
}

/**
 * Event-feed dot. Keeper colour only when `player` is that team's keeper.
 * @param {number | null | undefined} team
 * @param {number | null | undefined} player
 * @param {Map<number, number> | null | undefined} keeperTeamById player id → team
 */
export function eventKitClass(team, player, keeperTeamById) {
  const known = player != null && keeperTeamById ? keeperTeamById.get(player) : undefined;
  const keeper = known !== undefined && (team == null || team === known);
  const side = team === 0 || team === 1 ? team : known;
  return kitClass(side, keeper);
}

/**
 * Goalkeeper from the replay row. `gk` is the role flag and wins.
 * Without that column, roster slot 0 is the keeper only when the header
 * says that team has one. The player id is not a slot.
 * @param {Array<number>} row
 * @param {Record<string, number>} col column name → index
 * @param {{ goalkeepers?: boolean[] } | null | undefined} [header]
 * @returns {boolean}
 */
export function isGoalkeeper(row, col, header) {
  if (!row || !col) return false;
  if (Object.prototype.hasOwnProperty.call(col, "gk")) return Number(row[col.gk]) === 1;
  const roster = Number(row[col.roster]);
  const team = Number(row[col.team]);
  const flags = header && header.goalkeepers;
  return roster === 0 && Array.isArray(flags) && flags[team] === true;
}

/**
 * Digits painted on this player. The replay `id` is the shirt for the
 * whole match; row order and roster slot are not.
 * @param {Array<number>} row
 * @param {Record<string, number>} col
 */
export function shirtNumber(row, col) {
  return row[col.id];
}

/** @param {number} hex */
export function hexRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Hue in degrees, or null for a grey. */
export function hexHue(hex) {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-6) return null;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (((h * 60) % 360) + 360) % 360;
}

/** Smallest absolute hue difference, wrapping at 360. */
export function hueGap(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}
