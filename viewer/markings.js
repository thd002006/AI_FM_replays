// Pitch markings for the replay viewer.
//
// Sizes come from the replay header (`header.field`), which `export_replay`
// fills from `config/rules.toml` `[pitch_zones]` and `config/physics.toml`
// `[pitch]`. A missing or non-positive value is derived by scaling the
// Laws of the Game dimensions of a 105 × 68 m pitch onto this field:
// lengths (depths, radii measured along the pitch) by `length / 105`,
// widths by `width / 68`. The drawn mark radius is not a law dimension;
// it stays 0.2 m so the spot does not vanish on a small pitch.
//
// Closed shapes repeat their first point. The halfway line, penalty arc
// and corner arc are open in the laws; everything else is a closed loop.

/** International reference pitch (Laws of the Game). */
export const FIFA = {
  length: 105,
  width: 68,
  goalWidth: 7.32,
  goalHeight: 2.44,
  penaltyDepth: 16.5,
  penaltyHalfWidth: 20.16, // 7.32 / 2 + 16.5
  goalAreaDepth: 5.5,
  goalAreaHalfWidth: 9.16, // 7.32 / 2 + 5.5
  centerCircleRadius: 9.15,
  penaltySpotDistance: 11,
  penaltyArcRadius: 9.15,
  cornerArcRadius: 1,
  markRadius: 0.2,
};

function provided(field, key) {
  const v = field?.[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * @param {object} field header.field (metres)
 * @returns resolved marking sizes in metres
 */
export function resolveMarkings(field) {
  const length = field.length;
  const width = field.width;
  const sx = length / FIFA.length;
  const sz = width / FIFA.width;
  const pick = (key, scaled) => provided(field, key) ?? scaled;
  return {
    length,
    width,
    goalWidth: pick("goal_width", FIFA.goalWidth * sz),
    goalHeight: pick("goal_height", FIFA.goalHeight),
    penaltyDepth: pick("penalty_depth", FIFA.penaltyDepth * sx),
    penaltyHalfWidth: pick("penalty_half_width", FIFA.penaltyHalfWidth * sz),
    goalAreaDepth: pick("goal_area_depth", FIFA.goalAreaDepth * sx),
    goalAreaHalfWidth: pick("goal_area_half_width", FIFA.goalAreaHalfWidth * sz),
    centerCircleRadius: pick("center_circle_radius", FIFA.centerCircleRadius * sx),
    penaltySpotDistance: pick("penalty_spot_distance", FIFA.penaltySpotDistance * sx),
    penaltyArcRadius: pick("penalty_arc_radius", FIFA.penaltyArcRadius * sx),
    cornerArcRadius: pick("corner_arc_radius", FIFA.cornerArcRadius * sx),
    centerMarkRadius: pick("center_mark_radius", FIFA.markRadius),
    penaltyMarkRadius: pick("penalty_mark_radius", FIFA.markRadius),
  };
}

function arcPoints(cx, cz, radius, a0, a1, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = a0 + ((a1 - a0) * i) / segments;
    pts.push([cx + Math.cos(t) * radius, cz + Math.sin(t) * radius]);
  }
  return pts;
}

function circle(cx, cz, radius, segments) {
  return arcPoints(cx, cz, radius, 0, Math.PI * 2, segments);
}

/** Closed rectangle. `goalX` is the goal-line x; depth runs into the pitch. */
function box(goalX, depth, halfWidth) {
  const sign = Math.sign(goalX) || 1;
  const frontX = goalX - sign * depth;
  return [
    [frontX, -halfWidth],
    [goalX, -halfWidth],
    [goalX, halfWidth],
    [frontX, halfWidth],
    [frontX, -halfWidth],
  ];
}

function penaltyArc(sign, m) {
  const halfL = m.length / 2;
  const spotX = sign * (halfL - m.penaltySpotDistance);
  const frontX = sign * (halfL - m.penaltyDepth);
  const cosEdge = (frontX - spotX) / m.penaltyArcRadius;
  if (!(cosEdge > -1 && cosEdge < 1)) return [];
  const a = Math.acos(cosEdge);
  // +x goal: the arc outside the box is the short arc through angle π
  // (smaller x). −x goal: the short arc through angle 0 (larger x).
  if (sign > 0) return arcPoints(spotX, 0, m.penaltyArcRadius, a, Math.PI * 2 - a, 28);
  return arcPoints(spotX, 0, m.penaltyArcRadius, -a, a, 28);
}

function cornerArc(cx, cz, radius) {
  // Quarter circle inside the pitch. Endpoints lie on the two lines that
  // meet at this corner.
  let a0;
  let a1;
  if (cx > 0 && cz > 0) {
    a0 = Math.PI;
    a1 = Math.PI * 1.5;
  } else if (cx > 0 && cz < 0) {
    a0 = Math.PI / 2;
    a1 = Math.PI;
  } else if (cx < 0 && cz > 0) {
    a0 = -Math.PI / 2;
    a1 = 0;
  } else {
    a0 = 0;
    a1 = Math.PI / 2;
  }
  return arcPoints(cx, cz, radius, a0, a1, 12);
}

/**
 * @param {ReturnType<typeof resolveMarkings>} m
 */
export function pitchMarkings(m) {
  const halfL = m.length / 2;
  const halfW = m.width / 2;
  const lines = [
    {
      name: "boundary",
      closed: true,
      points: [
        [-halfL, -halfW],
        [halfL, -halfW],
        [halfL, halfW],
        [-halfL, halfW],
        [-halfL, -halfW],
      ],
    },
    {
      name: "halfway",
      closed: false,
      points: [
        [0, -halfW],
        [0, halfW],
      ],
    },
    { name: "center_circle", closed: true, points: circle(0, 0, m.centerCircleRadius, 72) },
  ];

  for (const sign of [1, -1]) {
    const tag = sign > 0 ? "positive" : "negative";
    const goalX = sign * halfL;
    lines.push({
      name: `penalty_area_${tag}`,
      closed: true,
      points: box(goalX, m.penaltyDepth, m.penaltyHalfWidth),
    });
    lines.push({
      name: `goal_area_${tag}`,
      closed: true,
      points: box(goalX, m.goalAreaDepth, m.goalAreaHalfWidth),
    });
    const arc = penaltyArc(sign, m);
    if (arc.length) {
      lines.push({ name: `penalty_arc_${tag}`, closed: false, points: arc });
    }
  }

  const corners = [
    ["corner_pp", halfL, halfW],
    ["corner_pn", halfL, -halfW],
    ["corner_np", -halfL, halfW],
    ["corner_nn", -halfL, -halfW],
  ];
  for (const [name, cx, cz] of corners) {
    lines.push({
      name,
      closed: false,
      points: cornerArc(cx, cz, m.cornerArcRadius),
    });
  }

  const spots = [
    { name: "center_mark", x: 0, z: 0, radius: m.centerMarkRadius },
    {
      name: "penalty_mark_positive",
      x: halfL - m.penaltySpotDistance,
      z: 0,
      radius: m.penaltyMarkRadius,
    },
    {
      name: "penalty_mark_negative",
      x: -(halfL - m.penaltySpotDistance),
      z: 0,
      radius: m.penaltyMarkRadius,
    },
  ];

  return { markings: m, lines, spots };
}

// Goal nets are not pitch markings. They are drawn only from the optional
// replay header `goal_nets` (engine export: depth, then two goals with the
// −x goal first). A file that omits the key — or that carries a shape this
// reader cannot use — draws the posts from `field` and does not invent a net
// from the pitch size.

/** Metres between net cords. The box itself always comes from the header. */
const NET_CORD_M = 0.4;
/** Upper bound so a corrupt span cannot allocate a huge line buffer. */
const NET_CORD_MAX = 48;

function finite(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * @param {object | null | undefined} header
 * @returns {null | { depth: number, goals: Array<{ goalLineX: number, backX: number, halfWidth: number, height: number, thickness: number, side: number }> }}
 */
export function resolveGoalNets(header) {
  const raw = header?.goal_nets;
  if (!raw || typeof raw !== "object") return null;
  const depth = provided(raw, "depth");
  const goals = raw.goals;
  if (depth == null || !Array.isArray(goals) || goals.length !== 2) return null;
  const parsed = [];
  for (let i = 0; i < 2; i++) {
    const goal = goals[i];
    if (!goal || typeof goal !== "object") return null;
    const goalLineX = finite(goal.goal_line_x);
    const backX = finite(goal.back_x);
    const halfWidth = provided(goal, "half_width");
    const height = provided(goal, "height");
    const thickness = provided(goal, "thickness");
    if (
      goalLineX == null ||
      backX == null ||
      halfWidth == null ||
      height == null ||
      thickness == null
    ) {
      return null;
    }
    // goals[0] is the −x goal, goals[1] the +x goal. Do not swap or mirror.
    const side = i === 0 ? -1 : 1;
    if (Math.sign(goalLineX) !== side) return null;
    // `back_x` is the centre of the back panel. The inner face sits
    // `thickness / 2` toward the pitch, and that face must stay behind
    // the goal line.
    if (!(side * (backX - goalLineX) > thickness / 2)) return null;
    parsed.push({ goalLineX, backX, halfWidth, height, thickness, side });
  }
  return { depth, goals: parsed };
}

function cordStops(span) {
  const n = Math.max(1, Math.min(NET_CORD_MAX, Math.round(span / NET_CORD_M)));
  const out = new Array(n + 1);
  for (let i = 0; i <= n; i++) out[i] = (span * i) / n;
  return out;
}

function pushSeg(segs, ax, ay, az, bx, by, bz) {
  segs.push([ax, ay, az, bx, by, bz]);
}

/**
 * Cord segments for both nets, in world metres (x along the pitch, y up,
 * z across). Empty when `doc` is null. The mouth stays open: cords meet the
 * posts and the crossbar, and no cord crosses the goal mouth below the bar.
 * The back sheet is the inner face of the back panel.
 *
 * @param {ReturnType<typeof resolveGoalNets>} doc
 * @returns {number[][]} each entry is `[x1, y1, z1, x2, y2, z2]`
 */
export function goalNetSegments(doc) {
  if (!doc) return [];
  const segs = [];
  for (const goal of doc.goals) {
    const mouth = goal.goalLineX;
    const inner = goal.backX - goal.side * (goal.thickness / 2);
    const hw = goal.halfWidth;
    const height = goal.height;
    const depthSpan = Math.abs(inner - mouth);
    const ys = cordStops(height);
    const zs = cordStops(hw * 2);
    const alongs = cordStops(depthSpan);

    for (const y of ys) pushSeg(segs, inner, y, -hw, inner, y, hw);
    for (const zOff of zs) {
      const z = -hw + zOff;
      pushSeg(segs, inner, 0, z, inner, height, z);
    }

    for (const z of [-hw, hw]) {
      for (const y of ys) pushSeg(segs, mouth, y, z, inner, y, z);
      for (let i = 0; i < alongs.length - 1; i++) {
        const x = mouth + (inner - mouth) * (alongs[i] / depthSpan);
        pushSeg(segs, x, 0, z, x, height, z);
      }
    }

    for (let zi = 1; zi < zs.length - 1; zi++) {
      const z = -hw + zs[zi];
      pushSeg(segs, mouth, height, z, inner, height, z);
    }
    for (let i = 0; i < alongs.length - 1; i++) {
      const x = mouth + (inner - mouth) * (alongs[i] / depthSpan);
      pushSeg(segs, x, height, -hw, x, height, hw);
    }
  }
  return segs;
}

const EPS = 1e-4;

function d(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function alongFromGoal(sign, x, halfL) {
  return sign > 0 ? halfL - x : x + halfL;
}

/**
 * Geometry checks shared by the node test and the screenshot script.
 * Closed area lines must repeat their first point and include every side.
 * Open lines are only the ones the laws leave open, and they still have
 * to meet the lines they belong to.
 *
 * @param {ReturnType<typeof pitchMarkings>} doc
 * @returns {string[]} empty when the drawing is right
 */
export function checkMarkings(doc) {
  const errors = [];
  const m = doc.markings;
  const halfL = m.length / 2;
  const halfW = m.width / 2;
  const byName = Object.fromEntries(doc.lines.map((line) => [line.name, line]));

  const need = (name) => {
    if (!byName[name]) errors.push(`缺少 ${name}`);
    return byName[name];
  };

  const expectClosed = (name) => {
    const line = need(name);
    if (!line) return;
    if (!line.closed) errors.push(`${name} 应该闭合`);
    const pts = line.points;
    if (!pts || pts.length < 4) {
      errors.push(`${name} 点数不够`);
      return;
    }
    if (d(pts[0], pts[pts.length - 1]) > EPS) errors.push(`${name} 首尾未闭合`);
  };

  for (const name of [
    "boundary",
    "center_circle",
    "penalty_area_positive",
    "penalty_area_negative",
    "goal_area_positive",
    "goal_area_negative",
  ]) {
    expectClosed(name);
  }

  const boundary = byName.boundary;
  if (boundary) {
    for (const corner of [
      [-halfL, -halfW],
      [halfL, -halfW],
      [halfL, halfW],
      [-halfL, halfW],
    ]) {
      if (!boundary.points.some((p) => d(p, corner) <= EPS)) {
        errors.push(`边线缺少角点 ${corner}`);
      }
    }
  }

  const halfway = need("halfway");
  if (halfway) {
    if (halfway.closed) errors.push("中线不是闭合环");
    const ok =
      d(halfway.points[0], [0, -halfW]) <= EPS && d(halfway.points[1], [0, halfW]) <= EPS;
    if (!ok) errors.push("中线没有连上两条边线");
  }

  const circleLine = byName.center_circle;
  if (circleLine) {
    for (const p of circleLine.points) {
      const r = Math.hypot(p[0], p[1]);
      if (Math.abs(r - m.centerCircleRadius) > 1e-3) {
        errors.push(`中圈半径 ${r} ≠ ${m.centerCircleRadius}`);
        break;
      }
    }
    let sweep = 0;
    for (let i = 1; i < circleLine.points.length; i++) {
      const a0 = Math.atan2(circleLine.points[i - 1][1], circleLine.points[i - 1][0]);
      const a1 = Math.atan2(circleLine.points[i][1], circleLine.points[i][0]);
      let delta = a1 - a0;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      sweep += delta;
    }
    if (Math.abs(Math.abs(sweep) - Math.PI * 2) > 0.05) {
      errors.push(`中圈没有画满一圈 (sweep=${sweep})`);
    }
  }

  const checkBox = (line, goalX, depth, halfWidth, label) => {
    if (!line) return;
    const sign = Math.sign(goalX) || 1;
    const frontX = goalX - sign * depth;
    const unique = line.points.slice(0, -1);
    if (unique.length !== 4) {
      errors.push(`${label} 不是四边矩形`);
      return;
    }
    const xs = unique.map((p) => p[0]);
    const zs = unique.map((p) => p[1]);
    if (Math.abs(Math.min(...zs) + halfWidth) > EPS || Math.abs(Math.max(...zs) - halfWidth) > EPS) {
      errors.push(`${label} 半宽不对`);
    }
    const onGoal = sign > 0 ? Math.max(...xs) : Math.min(...xs);
    const front = sign > 0 ? Math.min(...xs) : Math.max(...xs);
    if (Math.abs(onGoal - goalX) > EPS) errors.push(`${label} 没有贴球门线`);
    if (Math.abs(front - frontX) > EPS) errors.push(`${label} 前沿不在深度 ${depth}`);
    const frontPts = unique.filter((p) => Math.abs(p[0] - frontX) <= EPS);
    if (frontPts.length !== 2) errors.push(`${label} 前沿未画全`);
    for (const p of unique) {
      if (Math.abs(p[0]) > halfL + EPS || Math.abs(p[1]) > halfW + EPS) {
        errors.push(`${label} 画出了球场`);
      }
    }
  };

  for (const sign of [1, -1]) {
    const tag = sign > 0 ? "positive" : "negative";
    const goalX = sign * halfL;
    checkBox(byName[`penalty_area_${tag}`], goalX, m.penaltyDepth, m.penaltyHalfWidth, `禁区 ${tag}`);
    checkBox(byName[`goal_area_${tag}`], goalX, m.goalAreaDepth, m.goalAreaHalfWidth, `球门区 ${tag}`);

    const goalLine = byName[`goal_area_${tag}`];
    const pen = byName[`penalty_area_${tag}`];
    if (goalLine && pen) {
      for (const p of goalLine.points) {
        const along = alongFromGoal(sign, p[0], halfL);
        if (along < -EPS || along > m.penaltyDepth + EPS || Math.abs(p[1]) > m.penaltyHalfWidth + EPS) {
          errors.push(`球门区 ${tag} 超出禁区`);
        }
      }
    }

    const spot = doc.spots.find((s) => s.name === `penalty_mark_${tag}`);
    if (!spot) {
      errors.push(`缺少罚球点 ${tag}`);
    } else if (
      Math.abs(spot.x - sign * (halfL - m.penaltySpotDistance)) > EPS ||
      Math.abs(spot.z) > EPS
    ) {
      errors.push(`罚球点 ${tag} 位置不对`);
    } else if (alongFromGoal(sign, spot.x, halfL) > m.penaltyDepth + EPS) {
      errors.push(`罚球点 ${tag} 在禁区外`);
    }

    const arc = need(`penalty_arc_${tag}`);
    if (arc) {
      if (arc.closed) errors.push(`罚球弧 ${tag} 不该是整圆`);
      let leftBox = false;
      for (const p of arc.points) {
        const along = alongFromGoal(sign, p[0], halfL);
        if (along < m.penaltyDepth - 1e-3) errors.push(`罚球弧 ${tag} 画进了禁区`);
        if (along > m.penaltyDepth + 0.05) leftBox = true;
        const spotX = sign * (halfL - m.penaltySpotDistance);
        if (Math.abs(Math.hypot(p[0] - spotX, p[1]) - m.penaltyArcRadius) > 1e-3) {
          errors.push(`罚球弧 ${tag} 半径不对`);
          break;
        }
      }
      if (!leftBox) errors.push(`罚球弧 ${tag} 没有伸出禁区`);
      for (const p of [arc.points[0], arc.points[arc.points.length - 1]]) {
        const along = alongFromGoal(sign, p[0], halfL);
        if (Math.abs(along - m.penaltyDepth) > 1e-3) {
          errors.push(`罚球弧 ${tag} 端点不在禁区线上`);
        }
      }
    }
  }

  for (const [name, cx, cz] of [
    ["corner_pp", halfL, halfW],
    ["corner_pn", halfL, -halfW],
    ["corner_np", -halfL, halfW],
    ["corner_nn", -halfL, -halfW],
  ]) {
    const arc = need(name);
    if (!arc) continue;
    if (arc.closed) errors.push(`${name} 应该是四分之一圆弧`);
    for (const p of arc.points) {
      if (Math.abs(p[0]) > halfL + 1e-3 || Math.abs(p[1]) > halfW + 1e-3) {
        errors.push(`${name} 画出了球场`);
      }
      if (Math.abs(Math.hypot(p[0] - cx, p[1] - cz) - m.cornerArcRadius) > 1e-3) {
        errors.push(`${name} 半径不对`);
        break;
      }
    }
    const ends = [arc.points[0], arc.points[arc.points.length - 1]];
    const onGoal = ends.filter((p) => Math.abs(Math.abs(p[0]) - halfL) <= 1e-3).length;
    const onTouch = ends.filter((p) => Math.abs(Math.abs(p[1]) - halfW) <= 1e-3).length;
    if (onGoal < 1 || onTouch < 1) errors.push(`${name} 端点没有分别落在球门线和边线上`);
  }

  const center = doc.spots.find((s) => s.name === "center_mark");
  if (!center || Math.abs(center.x) > EPS || Math.abs(center.z) > EPS) {
    errors.push("中点不在球场中心");
  }

  return errors;
}
