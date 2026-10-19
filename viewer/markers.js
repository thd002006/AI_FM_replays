// Render-only marker sizes. Physics and collision stay in
// config/physics.toml (`ball.radius`, `push.radius`, `body_collision`);
// nothing here is read by the simulation.

/**
 * On-screen sizes. `playerScale` / `ballScale` are multipliers on the
 * original disc, body and ball (1 = the first viewer sizes).
 * Current defaults are another +50% on the previous 1.5 / 2 step.
 * `?player_scale=` and `?ball_scale=` override these when they are finite
 * and > 0; anything else is ignored. See {@link resolveRender}.
 */
export const RENDER = {
  playerScale: 2.25,
  ballScale: 3,
  basePlayerRadius: 0.36,
  basePlayerHeight: 1.8,
  baseBallRadius: 0.11,
};

/** Ground shadow radius / drawn ball radius. Grows with `ballScale`. */
export const BALL_SHADOW_SCALE = 1.6;

/** Gap between the top of a carried marker and a floating label anchor. */
export const LABEL_HEAD_GAP = 0.35;

/**
 * Extra ground clearance past the facing tip (including the carry swell)
 * so a top-down label does not sit on the arrow.
 */
export const LABEL_EDGE_GAP = 0.25;

/**
 * Marker parts at `playerScale` 1, in metres, except the two ratios.
 * Every glyph on the body — disc, height, facing triangle (gap, length,
 * width, lift), shirt-number disc and its lift — is this times one
 * `playerScale`. There is no second size for the arrow or the number.
 * The team-colour rim is the disc outside the number
 * (`radius * (1 - numberRadiusRatio)`), so it scales too.
 * `carryScale` is a relative swell of that whole marker while the player
 * has the ball; it is not another player size.
 */
export const MARKER_UNIT = {
  facingGap: 0.04,
  facingLength: 0.12,
  facingLift: 0.08,
  facingApexDegrees: 110,
  numberRadiusRatio: 0.98,
  numberLift: 0.02,
  carryScale: 1.08,
};

/**
 * One player's marker at `playerScale` (1 = the original viewer sizes).
 * @param {number} [playerScale]
 */
export function playerMarker(playerScale = RENDER.playerScale) {
  if (!Number.isFinite(playerScale) || playerScale <= 0) {
    throw new Error(`playerScale must be a positive finite number, got ${playerScale}`);
  }
  const radius = RENDER.basePlayerRadius * playerScale;
  const height = RENDER.basePlayerHeight * playerScale;
  const gap = MARKER_UNIT.facingGap * playerScale;
  const length = MARKER_UNIT.facingLength * playerScale;
  const apex = (MARKER_UNIT.facingApexDegrees * Math.PI) / 180;
  const halfWidth = length * Math.tan(apex / 2);
  const lift = MARKER_UNIT.facingLift * playerScale;
  const xBase = radius + gap;
  const xTip = xBase + length;
  return {
    scale: playerScale,
    radius,
    height,
    carryScale: MARKER_UNIT.carryScale,
    numberRadius: radius * MARKER_UNIT.numberRadiusRatio,
    numberLift: MARKER_UNIT.numberLift * playerScale,
    facing: {
      gap,
      length,
      halfWidth,
      lift,
      apexDegrees: MARKER_UNIT.facingApexDegrees,
      points: [
        [xTip, 0],
        [xBase, halfWidth],
        [xBase, -halfWidth],
      ],
    },
  };
}

const DEFAULT_MARKER = playerMarker(RENDER.playerScale);
export const PLAYER_RADIUS = DEFAULT_MARKER.radius;
export const PLAYER_HEIGHT = DEFAULT_MARKER.height;
export const BALL_RADIUS = RENDER.baseBallRadius * RENDER.ballScale;

/**
 * Positive finite scale from a query value, or null when missing / invalid.
 * @param {string|number|null|undefined} raw
 * @returns {number|null}
 */
export function parsePositiveScale(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Render sizes after URL overrides. Invalid `player_scale` / `ball_scale`
 * leave that axis on the {@link RENDER} default.
 * @param {URLSearchParams|Record<string, string>|string|null|undefined} [search]
 */
export function resolveRender(search) {
  const get = (key) => {
    if (search == null) return null;
    if (typeof search === "string") return new URLSearchParams(search).get(key);
    if (typeof search.get === "function") return search.get(key);
    return search[key];
  };
  const playerScale = parsePositiveScale(get("player_scale")) ?? RENDER.playerScale;
  const ballScale = parsePositiveScale(get("ball_scale")) ?? RENDER.ballScale;
  const marker = playerMarker(playerScale);
  const ballRadius = RENDER.baseBallRadius * ballScale;
  return {
    playerScale,
    ballScale,
    playerRadius: marker.radius,
    playerHeight: marker.height,
    ballRadius,
    shadowRadius: ballRadius * BALL_SHADOW_SCALE,
    marker,
  };
}

/**
 * World Y of a label above a marker.
 * A number is treated as a body height with no number lift and no carry
 * swell. A marker clears the carried number plane.
 * @param {number|ReturnType<typeof playerMarker>} source
 */
export function labelAnchorY(source) {
  if (typeof source === "number") return source + LABEL_HEAD_GAP;
  return (source.height + source.numberLift) * source.carryScale + LABEL_HEAD_GAP;
}

/** Ground distance from the player centre to the carried facing tip. */
export function markerPlanarReach(marker) {
  return (marker.radius + marker.facing.gap + marker.facing.length) * marker.carryScale;
}

/**
 * Anchor for a label that should sit clear of a marker.
 * Oblique view uses height only (the cap is what the camera sees).
 * Top-down ignores height, so the point shifts along screen-up past the
 * facing tip — the arrow scales with the body — plus {@link LABEL_EDGE_GAP}.
 * Pass `marker`, or a `playerRadius` that implies the same scale.
 * @param {number} x
 * @param {number} z
 * @param {{ marker?: ReturnType<typeof playerMarker>, playerRadius?: number, screenUp?: {x:number,z:number}|null, topDown: boolean }} opts
 */
export function labelWorldPoint(x, z, opts) {
  const marker = opts.marker
    ?? playerMarker((opts.playerRadius ?? PLAYER_RADIUS) / RENDER.basePlayerRadius);
  const y = labelAnchorY(marker);
  const { screenUp, topDown } = opts;
  if (!topDown || !screenUp) return { x, y, z };
  const lift = markerPlanarReach(marker) + LABEL_EDGE_GAP;
  return { x: x + screenUp.x * lift, y, z: z + screenUp.z * lift };
}

/**
 * Drawn ball centre. The visual radius is larger than the physics radius, so
 * the sphere is lifted until it sits on the pitch. Top-down looks along −Y
 * and the cylinder caps hide anything below them; lift the ball just above
 * the bodies so the larger models do not swallow it. Oblique view keeps the
 * seated (or real airborne) height.
 * @param {number} ballY physics centre
 * @param {{ ballRadius: number, playerHeight: number, topDown: boolean }} sizes
 */
export function ballDrawY(ballY, { ballRadius, playerHeight, topDown }) {
  const y = Number.isFinite(ballY) ? ballY : 0;
  const seated = Math.max(y, ballRadius);
  if (!topDown) return seated;
  return Math.max(seated, playerHeight + ballRadius);
}

/**
 * Jersey number lies flat on the disc (`rotation.x`). It does not take the
 * player's facing. `jerseyYaw` turns the glyph so its top matches screen-up
 * on the ground (world −Z for both the orthographic top camera and the
 * oblique camera, which looks in from +Z).
 */
export const JERSEY_PITCH = -Math.PI / 2;

/**
 * @param {number} screenUpX ground component of screen-up
 * @param {number} screenUpZ ground component of screen-up
 */
export function jerseyYaw(screenUpX, screenUpZ) {
  const len = Math.hypot(screenUpX, screenUpZ);
  if (len < 1e-8) return 0;
  // CircleGeometry +Y, after rotation.x = -π/2, points at (sin yaw, -cos yaw).
  return Math.atan2(screenUpX / len, -screenUpZ / len);
}

/**
 * Screen-up direction on the ground for a camera.
 * Vertical look (true top-down) uses the camera up vector; otherwise the
 * horizontal view direction, which is the top of the screen on the pitch.
 * Facing is intentionally not an argument.
 */
export function screenUpOnGround(camX, camZ, lookX, lookZ, upX, upZ) {
  const dx = lookX - camX;
  const dz = lookZ - camZ;
  const h = Math.hypot(dx, dz);
  if (h > 1e-6) return { x: dx / h, z: dz / h };
  const uh = Math.hypot(upX, upZ);
  if (uh > 1e-6) return { x: upX / uh, z: upZ / uh };
  return { x: 0, z: -1 };
}

/**
 * Facing mark at scale 1: a small obtuse isosceles triangle just outside
 * the disc. Local +x is the facing direction, so the tip points away from
 * the player centre. Drawn gap, length and lift are these times
 * `playerScale` ({@link playerMarker}). The previous wedge was a 0.7 m
 * cone of radius 0.22 whose tip pointed back into the disc.
 */
export const FACING = {
  gap: MARKER_UNIT.facingGap,
  length: MARKER_UNIT.facingLength,
  lift: MARKER_UNIT.facingLift,
  apexDegrees: MARKER_UNIT.facingApexDegrees,
};

/** Facing triangle at `playerScale` (1 = original metres). */
export function facingTriangle(playerScale = RENDER.playerScale) {
  return playerMarker(playerScale).facing;
}

/**
 * Shape checks for the facing triangle at `playerScale`.
 * "Smaller than the old cone" is judged on the scale-1 triangle; a larger
 * `playerScale` grows length and width together and must still pass.
 * @param {number} [playerScale]
 */
export function checkFacing(playerScale = RENDER.playerScale) {
  const errors = [];
  const marker = playerMarker(playerScale);
  const tri = marker.facing;
  const discRadius = marker.radius;
  const [tip, left, right] = tri.points;
  const v1 = [left[0] - tip[0], left[1] - tip[1]];
  const v2 = [right[0] - tip[0], right[1] - tip[1]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const denom = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]);
  const apex = (Math.acos(dot / denom) * 180) / Math.PI;
  if (!(apex > 90)) errors.push(`朝向三角顶角应是钝角，实际 ${apex.toFixed(1)}°`);
  if (!(tip[0] > left[0] && tip[0] > right[0])) errors.push("朝向三角的尖端没有朝外");
  if (Math.abs(left[0] - right[0]) > 1e-9) errors.push("朝向三角底边不垂直于朝向");
  for (const p of tri.points) {
    if (Math.hypot(p[0], p[1]) <= discRadius) errors.push("朝向三角插进了圆盘");
  }
  const unitGap = tri.gap / playerScale;
  if (!(unitGap > 0.01 && unitGap < 0.12)) errors.push("朝向三角没有贴在圆盘外沿");
  // Smaller than the old cone (length 0.7, base radius 0.22) at scale 1.
  const unitLength = tri.length / playerScale;
  const unitHalf = tri.halfWidth / playerScale;
  if (!(unitLength < 0.7 && unitHalf < 0.22)) errors.push("朝向三角没有比原来的楔形更小");
  if (Math.abs(tri.length - FACING.length * playerScale) > 1e-9) {
    errors.push("朝向三角长度没有跟着 player_scale");
  }
  if (Math.abs(tri.lift - FACING.lift * playerScale) > 1e-9) {
    errors.push("朝向三角离地高度没有跟着 player_scale");
  }
  return errors;
}
