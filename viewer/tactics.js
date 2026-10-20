// Session tactics board (§5.9).
//
// The icons are formation anchors, not the Three.js player meshes. Edits stay
// in this page's memory and write the single session FormationTable at once.
// Nothing here writes a formation file. A later live match reads that table
// at the next decision refresh; this page does not run that match and does
// not move players already on the pitch.
//
// `sessionMode` is `history` or `newMatch`. History replay (the sample, a
// `?file=` replay, published Pages) does not show the button and does not
// listen for T. `newMatch` is 开新局 (B78): pre-kickoff and mid-match. The
// viewer stays on `history` until `?mode=newMatch`. The worker is engine_config.js.

/** Bundled 11v11 test-team shape. Outfield count; the table also has a GK row. */
export const DEFAULT_N_OUT = 10;

/** Formation name in the format file. One shared table; the away side mirrors it. */
export const DEFAULT_FORMATION_NAME = "4-3-3";

/**
 * When a written edit would start affecting a live match.
 * The table is already the session table. Phase B applies it on the next
 * decision refresh. There is no separate confirm step.
 */
export const APPLY_FROM = "next-decision-refresh";

/** Watch a replay file. No tactics button, no T shortcut. */
export const SESSION_MODE_HISTORY = "history";

/** 开新局: pre-kickoff setup and mid-match edits, without pausing. */
export const SESSION_MODE_NEW_MATCH = "newMatch";

/**
 * Default slots, copied from the bundled 11v11 4-3-3 (GK + 10 outfield).
 * `x` 0 = own goal line, 1 = opponent goal line.
 * `y` 0 = own left touchline, 1 = own right touchline. On the board, y grows
 * upward, so y = 0 is the bottom edge (`clientToUnit`).
 * `label` stays the formation-file name. The disc role is computed from the
 * anchor on screen and is never written back onto `label`.
 */
export const DEFAULT_SLOTS = [
  { label: "GK", defend: [0.04, 0.5], attack: [0.1, 0.5] },
  { label: "LB", defend: [0.22, 0.15], attack: [0.65, 0.05] },
  { label: "LCB", defend: [0.2, 0.38], attack: [0.37, 0.3] },
  { label: "RCB", defend: [0.2, 0.62], attack: [0.37, 0.7] },
  { label: "RB", defend: [0.22, 0.85], attack: [0.65, 0.95] },
  { label: "DM", defend: [0.33, 0.5], attack: [0.45, 0.5] },
  { label: "LCM", defend: [0.38, 0.32], attack: [0.62, 0.35] },
  { label: "RCM", defend: [0.38, 0.68], attack: [0.62, 0.65] },
  { label: "LW", defend: [0.52, 0.22], attack: [0.8, 0.1] },
  { label: "ST", defend: [0.55, 0.5], attack: [0.87, 0.5] },
  { label: "RW", defend: [0.52, 0.78], attack: [0.8, 0.9] },
];

/** Coach press line shipped with that default table. */
export const DEFAULT_PRESS_TRIGGER_X = 0.52;

/**
 * Shirt numbers for the bundled 11v11 home side, one per formation slot.
 *
 * The viewer paints replay `id` (`fm_script::record::player_row`). `Match::new`
 * places home roster slot `r` at player index `r`, and `Formation::from_table`
 * assigns `table.slot[r]` to that player. The digits on the home disc are
 * therefore `r`. Away mirrors the same slot; their ids are offset by the
 * home count and are not a second set of pieces. A live 开新局 roster replaces
 * this list through `setJerseyNumbers`.
 * @param {number} [slotCount]
 */
export function defaultJerseyNumbers(slotCount = DEFAULT_SLOTS.length) {
  const n = Number.isInteger(slotCount) && slotCount > 0 ? slotCount : 0;
  return Array.from({ length: n }, (_, i) => i);
}

/** @param {number} v */
export function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Role bands, measured from the own goal line.
 * x < ROLE_X_BACK: LB / CB / RB
 * [ROLE_X_BACK, ROLE_X_DM): LB / DMF / RB
 * [ROLE_X_DM, ROLE_X_MID): LMF / CMF / RMF
 * [ROLE_X_MID, ROLE_X_FORWARD): LWF / AMF / RWF
 * x >= ROLE_X_FORWARD: LWF / CF / RWF
 */
export const ROLE_X_BACK = 0.3;
export const ROLE_X_DM = 0.42;
export const ROLE_X_MID = 0.62;
export const ROLE_X_FORWARD = 0.75;

/** y below this is the left channel (own left touchline is 0). */
export const ROLE_Y_LEFT = 0.3;

/** y above this is the right channel. Values in between, including the edges, are centre. */
export const ROLE_Y_RIGHT = 0.7;

/**
 * Display role for one piece. Slot 0 is always GK.
 * `x` / `y` are the anchor of the phase currently on screen, not `slot.label`.
 * Non-finite coordinates clamp to 0.
 * @param {number} slotIndex
 * @param {number} x
 * @param {number} y
 */
export function anchorRole(slotIndex, x, y) {
  if (slotIndex === 0) return "GK";
  const px = clamp01(x);
  const py = clamp01(y);
  const channel = py < ROLE_Y_LEFT ? "left" : py > ROLE_Y_RIGHT ? "right" : "centre";
  let left = "LWF";
  let centre = "CF";
  let right = "RWF";
  if (px < ROLE_X_BACK) {
    left = "LB";
    centre = "CB";
    right = "RB";
  } else if (px < ROLE_X_DM) {
    left = "LB";
    centre = "DMF";
    right = "RB";
  } else if (px < ROLE_X_MID) {
    left = "LMF";
    centre = "CMF";
    right = "RMF";
  } else if (px < ROLE_X_FORWARD) {
    left = "LWF";
    centre = "AMF";
    right = "RWF";
  }
  if (channel === "left") return left;
  if (channel === "right") return right;
  return centre;
}

/** Disc colour group: GK yellow, defenders blue, midfielders green, forwards red. */
export function roleGroup(role) {
  if (role === "GK") return "gk";
  if (role === "LB" || role === "CB" || role === "RB") return "df";
  if (role === "LWF" || role === "CF" || role === "RWF") return "fw";
  return "mf";
}

/**
 * Position rating drawn on the disc and in the player panel.
 * Placeholder until player attributes exist. Always 0.
 * @param {object | null | undefined} slot formation row (kept for a later attribute lookup)
 * @param {string} role code from {@link anchorRole}
 * @returns {number}
 */
export function positionRating(slot, role) {
  void slot;
  void role;
  return 0;
}

/**
 * The three lines on a piece. Does not read or write `slot.label`.
 * @param {number} slotIndex
 * @param {number[]} point current phase anchor `[x, y]`
 * @param {number | string} jersey
 * @param {object | null | undefined} slot
 */
export function piecePresentation(slotIndex, point, jersey, slot) {
  const x = Array.isArray(point) ? point[0] : 0;
  const y = Array.isArray(point) ? point[1] : 0;
  const role = anchorRole(slotIndex, x, y);
  const rating = positionRating(slot, role);
  const name = String(jersey);
  return {
    role,
    rating,
    name,
    group: roleGroup(role),
    ariaLabel: `${name}号，${role}，评分 ${rating}`,
  };
}

/**
 * Compact landscape (B82). Portrait never uses it.
 * A landscape viewport under {@link COMPACT_LANDSCAPE_VIEW_PX}, or any
 * non-portrait card slot under {@link COMPACT_LANDSCAPE_CARD_PX}.
 */
export const COMPACT_LANDSCAPE_CARD_PX = 360;
export const COMPACT_LANDSCAPE_VIEW_PX = 420;

/** Inside compact landscape, a viewport under this shortens labels (默认, 4-3-3). */
export const VERY_SHORT_VIEW_PX = 320;

/** Disc diameter is this fraction of the nearest anchor spacing. */
export const DISC_GAP_FILL = 0.72;

/** Below this diameter the disc drops the rating and keeps role + number tab. */
export const DISC_COMPACT_BELOW_PX = 32;

/**
 * @param {{ layout?: string, viewportHeight?: number, availableHeight?: number }} box
 */
export function compactLandscape(box) {
  const layout = box && box.layout ? box.layout : "desktop";
  if (layout === "portrait") return false;
  const vh = Number(box && box.viewportHeight);
  const avail = Number(box && box.availableHeight);
  if (layout === "landscape" && Number.isFinite(vh) && vh > 0 && vh < COMPACT_LANDSCAPE_VIEW_PX) return true;
  if (Number.isFinite(avail) && avail > 0 && avail < COMPACT_LANDSCAPE_CARD_PX) return true;
  return false;
}

/**
 * Pixel distance between the closest pair. `points` are unit `[x, y]`
 * (y grows up the board). A single point has no neighbour.
 * @param {Array<[number, number]>} points
 */
export function nearestNeighbourPx(points, boardWidth, boardHeight) {
  const w = Number(boardWidth);
  const h = Number(boardHeight);
  if (!(w > 0) || !(h > 0) || !Array.isArray(points) || points.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      if (!a || !b) continue;
      const d = Math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Disc diameter for a rendered board.
 * `min(pitchW / 9, pitchH / 6, nearestNeighbour * 0.72)`.
 * @param {number} boardWidth
 * @param {number} boardHeight
 * @param {Array<[number, number]>} points
 */
export function discDiameterPx(boardWidth, boardHeight, points) {
  const w = Number(boardWidth);
  const h = Number(boardHeight);
  if (!(w > 0) || !(h > 0)) return 52;
  const nearest = nearestNeighbourPx(points, w, h);
  const gapCap = Number.isFinite(nearest) ? nearest * DISC_GAP_FILL : Infinity;
  return Math.min(w / 9, h / 6, gapCap);
}

/**
 * Unit pitch point under a pointer. `y` grows upward (own left touchline at the bottom).
 * @param {{ left: number, top: number, width: number, height: number }} rect
 */
export function clientToUnit(rect, clientX, clientY) {
  const w = rect.width > 0 ? rect.width : 1;
  const h = rect.height > 0 ? rect.height : 1;
  return {
    x: clamp01((clientX - rect.left) / w),
    y: clamp01(1 - (clientY - rect.top) / h),
  };
}

function cloneSlots(slots) {
  return slots.map((s) => ({
    label: s.label,
    defend: [s.defend[0], s.defend[1]],
    attack: [s.attack[0], s.attack[1]],
  }));
}

function cloneTable(table) {
  return {
    name: table.name,
    nOut: table.nOut,
    press_trigger_x: table.press_trigger_x,
    slot: cloneSlots(table.slot),
  };
}

/** Fresh copy of the bundled 11v11 table. */
export function defaultFormation() {
  return {
    name: DEFAULT_FORMATION_NAME,
    nOut: DEFAULT_N_OUT,
    press_trigger_x: DEFAULT_PRESS_TRIGGER_X,
    slot: cloneSlots(DEFAULT_SLOTS),
  };
}

function unitPair(v, what) {
  if (!Array.isArray(v) || v.length !== 2) throw new TypeError(`${what} must be [x, y]`);
  const x = Number(v[0]);
  const y = Number(v[1]);
  if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) {
    throw new TypeError(`${what} must be inside [0, 1]`);
  }
  return [x, y];
}

function normalizeTable(table, fallback) {
  if (!table || !Array.isArray(table.slot) || table.slot.length === 0) {
    throw new TypeError("session formation needs at least one slot");
  }
  const press =
    table.press_trigger_x === undefined || table.press_trigger_x === null
      ? fallback.press_trigger_x
      : Number(table.press_trigger_x);
  if (!Number.isFinite(press) || press < 0 || press > 1) {
    throw new TypeError("press_trigger_x must be inside [0, 1]");
  }
  const slot = table.slot.map((s, i) => ({
    label: typeof s.label === "string" ? s.label : `S${i}`,
    defend: unitPair(s.defend, `slot ${i} defend`),
    attack: unitPair(s.attack, `slot ${i} attack`),
  }));
  const name = typeof table.name === "string" && table.name ? table.name : fallback.name;
  const nOut = Number.isInteger(table.nOut) && table.nOut >= 0 ? table.nOut : fallback.nOut;
  return { name, nOut, press_trigger_x: press, slot };
}

function normalizeJerseys(numbers, slotCount) {
  if (!Array.isArray(numbers) || numbers.length !== slotCount) {
    throw new TypeError("jersey numbers must match the slot count");
  }
  return numbers.map((n, i) => {
    if (!Number.isInteger(n) || n < 0) {
      throw new TypeError(`jersey ${i} must be a non-negative integer`);
    }
    return n;
  });
}

/** In-memory session. One table: what the board shows is what a sim would read. */
export function createSession(base) {
  const table = cloneTable(base || defaultFormation());
  return {
    table,
    jersey: defaultJerseyNumbers(table.slot.length),
    phase: "attack",
    revision: 0,
    applyFrom: APPLY_FROM,
    sessionMode: SESSION_MODE_HISTORY,
  };
}

/** JSON stand-in for the session FormationTable. Always `persisted: false`. */
export function getSessionFormation(session) {
  return {
    name: session.table.name,
    nOut: session.table.nOut,
    press_trigger_x: session.table.press_trigger_x,
    slot: cloneSlots(session.table.slot),
    jersey: session.jersey.slice(),
    phase: session.phase,
    revision: session.revision,
    applyFrom: session.applyFrom,
    persisted: false,
    sessionMode: session.sessionMode,
  };
}

/**
 * Replace the session table immediately. Does not write a file.
 * `table.jersey`, when present, replaces the shirt numbers in the same write.
 */
export function setSessionFormation(session, table) {
  const next = normalizeTable(table, session.table);
  session.jersey = Array.isArray(table.jersey)
    ? normalizeJerseys(table.jersey, next.slot.length)
    : defaultJerseyNumbers(next.slot.length);
  session.table = next;
  session.revision += 1;
  return getSessionFormation(session);
}

/** `"history"` hides the tactics entry. `"newMatch"` shows it for 开新局. */
export function setSessionMode(session, mode) {
  if (mode !== SESSION_MODE_HISTORY && mode !== SESSION_MODE_NEW_MATCH) {
    throw new TypeError('sessionMode must be "history" or "newMatch"');
  }
  session.sessionMode = mode;
  return mode;
}

/** Shirt numbers for the current slots. Display only; not part of the formation file. */
export function setJerseyNumbers(session, numbers) {
  session.jersey = normalizeJerseys(numbers, session.table.slot.length);
  return session.jersey.slice();
}

/** `"attack"` or `"defend"`. Switching layers does not change either coordinate set. */
export function setPhase(session, phase) {
  if (phase !== "attack" && phase !== "defend") throw new TypeError("phase must be attack or defend");
  session.phase = phase;
  return phase;
}

/**
 * Move one anchor in the current phase and write that coordinate at once.
 * The other phase is left alone.
 * @returns {boolean} false when the point did not change
 */
export function moveAnchor(session, index, x, y) {
  const slot = session.table.slot[index];
  if (!slot) throw new RangeError(`slot ${index} is outside the table`);
  const next = [clamp01(x), clamp01(y)];
  const cur = session.phase === "defend" ? slot.defend : slot.attack;
  if (cur[0] === next[0] && cur[1] === next[1]) return false;
  if (session.phase === "defend") slot.defend = next;
  else slot.attack = next;
  session.revision += 1;
  return true;
}

/** Back to the bundled default, still only in memory. Does not change `sessionMode`. */
export function resetSession(session) {
  session.table = defaultFormation();
  session.jersey = defaultJerseyNumbers(session.table.slot.length);
  session.phase = "attack";
  session.revision += 1;
  return getSessionFormation(session);
}

function fmtNum(n) {
  const s = Number(n).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s.includes(".") ? s : `${s}.0`;
}

/** TOML-shaped text for the session table. Callers must not write it to disk. */
export function formationToml(table) {
  const lines = [`press_trigger_x = ${fmtNum(table.press_trigger_x)}`, ""];
  for (const slot of table.slot) {
    const label = String(slot.label).replace(/"/g, "");
    lines.push("[[slot]]");
    lines.push(`label = "${label}"`);
    lines.push(`defend = [${fmtNum(slot.defend[0])}, ${fmtNum(slot.defend[1])}]`);
    lines.push(`attack = [${fmtNum(slot.attack[0])}, ${fmtNum(slot.attack[1])}]`);
    lines.push("");
  }
  return lines.join("\n");
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function statusText(session) {
  if (session.revision === 0) {
    return "默认 4-3-3。拖图标立刻写入这一场会话；打开不暂停。这场已经在踢时，从下一次决策刷新起生效。";
  }
  return "已写入这一场会话。这场已经在踢时，从下一次决策刷新起用这张表。不写入阵型文件，不暂停，不挪场上球员。";
}

/**
 * Bind the tactics panel. Safe to call before a replay has loaded.
 * History mode does not show the button and does not listen for T.
 * Opening and dragging never touch playback.
 * @param {Document} doc
 * @param {{ onInteract?: () => void, onFormationChange?: (snapshot: object) => void, sessionMode?: string }} [hooks]
 */
export function mountTactics(doc, hooks = {}) {
  const session = createSession();
  setSessionMode(session, hooks.sessionMode ?? SESSION_MODE_HISTORY);
  const modal = doc.getElementById("tactics-modal");
  const card = doc.getElementById("tactics-card");
  const board = doc.getElementById("tactics-board");
  const anchors = doc.getElementById("tactics-anchors");
  const status = doc.getElementById("tactics-status");
  const attackBtn = doc.getElementById("tactics-phase-attack");
  const defendBtn = doc.getElementById("tactics-phase-defend");
  const toggleBtn = doc.getElementById("tactics-toggle");
  const playerEmpty = doc.getElementById("tactics-player-empty");
  const playerDetail = doc.getElementById("tactics-player-detail");
  const playerNumber = doc.getElementById("tactics-player-number");
  const playerRole = doc.getElementById("tactics-player-role");
  const playerRating = doc.getElementById("tactics-player-rating");
  let open = false;
  /** @type {number | null} */
  let selectedIndex = null;
  /** @type {{ index: number, pointerId: number } | null} */
  let drag = null;

  const interact = () => {
    if (typeof hooks.onInteract === "function") hooks.onInteract();
  };

  function notifyFormation() {
    if (typeof hooks.onFormationChange === "function") {
      hooks.onFormationChange(getSessionFormation(session));
    }
  }

  function placeAnchors() {
    if (!anchors || !board) return;
    const slots = session.table.slot;
    if (anchors.childElementCount !== slots.length) {
      anchors.replaceChildren();
      slots.forEach((_, i) => {
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.dataset.index = String(i);
        anchors.appendChild(btn);
      });
    }
    if (selectedIndex != null && (selectedIndex < 0 || selectedIndex >= slots.length)) {
      selectedIndex = null;
    }
    const phase = session.phase;
    board.dataset.phase = phase;
    slots.forEach((slot, i) => {
      const node = anchors.children[i];
      const point = phase === "defend" ? slot.defend : slot.attack;
      const face = piecePresentation(i, point, session.jersey[i], slot);
      let disc = node.querySelector(".tactics-disc");
      if (!disc) {
        disc = doc.createElement("span");
        disc.className = "tactics-disc";
        const roleEl = doc.createElement("span");
        roleEl.className = "tactics-role";
        const ratingEl = doc.createElement("span");
        ratingEl.className = "tactics-rating";
        disc.append(roleEl, ratingEl);
        const nameEl = doc.createElement("span");
        nameEl.className = "tactics-name";
        node.replaceChildren(disc, nameEl);
      }
      const selected = i === selectedIndex;
      const dragging = drag != null && drag.index === i;
      node.className = `tactics-anchor${selected ? " selected" : ""}${dragging ? " dragging" : ""}`;
      node.querySelector(".tactics-role").textContent = face.role;
      node.querySelector(".tactics-rating").textContent = String(face.rating);
      node.querySelector(".tactics-name").textContent = face.name;
      node.title = face.ariaLabel;
      node.setAttribute("aria-label", face.ariaLabel);
      node.setAttribute("aria-pressed", selected ? "true" : "false");
      node.style.left = `${point[0] * 100}%`;
      node.style.top = `${(1 - point[1]) * 100}%`;
      node.dataset.x = String(round4(point[0]));
      node.dataset.y = String(round4(point[1]));
      node.dataset.phase = phase;
      node.dataset.label = slot.label;
      node.dataset.role = face.role;
      node.dataset.group = face.group;
      node.dataset.rating = String(face.rating);
      node.dataset.number = face.name;
    });
  }

  function paintPlayer() {
    const slot = selectedIndex == null ? null : session.table.slot[selectedIndex];
    if (!slot || selectedIndex == null) {
      selectedIndex = null;
      playerEmpty?.removeAttribute("hidden");
      if (playerDetail) playerDetail.hidden = true;
      return;
    }
    const point = session.phase === "defend" ? slot.defend : slot.attack;
    const face = piecePresentation(selectedIndex, point, session.jersey[selectedIndex], slot);
    if (playerEmpty) playerEmpty.hidden = true;
    if (playerDetail) playerDetail.hidden = false;
    if (playerNumber) playerNumber.textContent = face.name;
    if (playerRole) playerRole.textContent = face.role;
    if (playerRating) playerRating.textContent = String(face.rating);
  }

  function syncBoardFrame() {
    const root = doc.documentElement;
    const view = doc.defaultView;
    const vv = view && view.visualViewport;
    const vh = vv && vv.height > 0 ? vv.height : view ? view.innerHeight : 0;
    const available = modal && modal.clientHeight > 0 ? modal.clientHeight : vh;
    const layout = root.dataset.layout || "desktop";
    const compact = compactLandscape({ layout, viewportHeight: vh, availableHeight: available });
    root.classList.toggle("tactics-compact-landscape", compact);
    root.classList.toggle("tactics-very-short", compact && vh > 0 && vh < VERY_SHORT_VIEW_PX);
    if (!board) return;
    if (compact) {
      const col = board.parentElement;
      if (col && col.clientWidth > 8 && col.clientHeight > 8) {
        const cs = view ? view.getComputedStyle(col) : null;
        const padX = cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 0;
        const padY = cs ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : 0;
        const availW = Math.max(0, col.clientWidth - (Number.isFinite(padX) ? padX : 0));
        const availH = Math.max(0, col.clientHeight - (Number.isFinite(padY) ? padY : 0));
        if (availW > 8 && availH > 8) {
          let w = availW;
          let h = (w * 68) / 105;
          if (h > availH) {
            h = availH;
            w = (h * 105) / 68;
          }
          const nextW = `${Math.floor(w * 10) / 10}px`;
          const nextH = `${Math.floor(h * 10) / 10}px`;
          if (board.style.width !== nextW) board.style.width = nextW;
          if (board.style.height !== nextH) board.style.height = nextH;
        }
      }
    } else if (board.style.width || board.style.height) {
      board.style.width = "";
      board.style.height = "";
    }
    const rect = board.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const points = session.table.slot.map((slot) => (session.phase === "defend" ? slot.defend : slot.attack));
    const d = discDiameterPx(rect.width, rect.height, points);
    const px = Math.floor(d * 10) / 10;
    board.style.setProperty("--disc", `${px}px`);
    board.classList.toggle("tactics-compact-disc", px < DISC_COMPACT_BELOW_PX);
  }

  function paint() {
    placeAnchors();
    paintPlayer();
    attackBtn?.setAttribute("aria-pressed", session.phase === "attack" ? "true" : "false");
    defendBtn?.setAttribute("aria-pressed", session.phase === "defend" ? "true" : "false");
    attackBtn?.classList.toggle("active", session.phase === "attack");
    defendBtn?.classList.toggle("active", session.phase === "defend");
    if (status) status.textContent = statusText(session);
    if (card) {
      card.dataset.applyFrom = APPLY_FROM;
      card.dataset.persisted = "false";
      card.dataset.sessionMode = session.sessionMode;
    }
    syncBoardFrame();
  }

  function setOpen(next) {
    if (next && session.sessionMode !== SESSION_MODE_NEW_MATCH) return;
    open = !!next;
    modal?.classList.toggle("hidden", !open);
    modal?.setAttribute("aria-hidden", open ? "false" : "true");
    toggleBtn?.classList.toggle("active", open);
    toggleBtn?.setAttribute("aria-pressed", open ? "true" : "false");
    doc.documentElement.classList.toggle("tactics-open", open);
    if (open) {
      const scroller = doc.querySelector("#tactics-card .tactics-scroll");
      if (scroller) scroller.scrollTop = 0;
      paint();
      doc.defaultView?.requestAnimationFrame(() => syncBoardFrame());
    }
    interact();
  }

  function pointerPoint(e) {
    return clientToUnit(board.getBoundingClientRect(), e.clientX, e.clientY);
  }

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    drag = null;
    paint();
  }

  board?.addEventListener("pointerdown", (e) => {
    if (session.sessionMode !== SESSION_MODE_NEW_MATCH || !open) return;
    const icon = e.target.closest?.(".tactics-anchor");
    if (!icon || !board) return;
    if (e.isPrimary === false) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { index: Number(icon.dataset.index), pointerId: e.pointerId };
    selectedIndex = drag.index;
    paint();
    try {
      board.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail if the node is detached. Window listeners still track the pointer.
    }
    interact();
  });

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId || !board) return;
    e.preventDefault();
    const p = pointerPoint(e);
    if (moveAnchor(session, drag.index, p.x, p.y)) {
      paint();
      notifyFormation();
    }
  };
  const onPointerUp = (e) => endDrag(e);
  doc.defaultView?.addEventListener("pointermove", onPointerMove);
  doc.defaultView?.addEventListener("pointerup", onPointerUp);
  doc.defaultView?.addEventListener("pointercancel", onPointerUp);

  attackBtn?.addEventListener("click", () => {
    setPhase(session, "attack");
    paint();
    interact();
  });
  defendBtn?.addEventListener("click", () => {
    setPhase(session, "defend");
    paint();
    interact();
  });
  doc.getElementById("tactics-reset")?.addEventListener("click", () => {
    resetSession(session);
    paint();
    notifyFormation();
    interact();
  });
  toggleBtn?.addEventListener("click", () => {
    if (session.sessionMode !== SESSION_MODE_NEW_MATCH) return;
    setOpen(!open);
  });
  doc.getElementById("tactics-close")?.addEventListener("click", () => setOpen(false));
  /** Click the dim mask to close. A drag outside the card still pans the pitch. */
  let outsidePointer = null;
  doc.addEventListener("pointerdown", (e) => {
    if (!open || (card && card.contains(e.target))) {
      outsidePointer = null;
      return;
    }
    outsidePointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  doc.addEventListener("pointerup", (e) => {
    if (!outsidePointer || e.pointerId !== outsidePointer.id) return;
    const moved = Math.hypot(e.clientX - outsidePointer.x, e.clientY - outsidePointer.y);
    outsidePointer = null;
    if (!open || moved > 6) return;
    if (card && card.contains(e.target)) return;
    setOpen(false);
  });

  function onKeyDown(e) {
    if (session.sessionMode !== SESSION_MODE_NEW_MATCH) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.code === "KeyT" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setOpen(!open);
      return;
    }
    if (e.code === "Escape" && open) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    }
  }

  function applyEntry() {
    const live = session.sessionMode === SESSION_MODE_NEW_MATCH;
    toggleBtn?.classList.toggle("hidden", !live);
    if (toggleBtn) {
      toggleBtn.hidden = !live;
      toggleBtn.setAttribute("aria-hidden", live ? "false" : "true");
      if (!live) {
        toggleBtn.classList.remove("active");
        toggleBtn.setAttribute("aria-pressed", "false");
      }
    }
    doc.documentElement.dataset.sessionMode = session.sessionMode;
    const win = doc.defaultView;
    if (!win) return;
    win.removeEventListener("keydown", onKeyDown);
    if (live) win.addEventListener("keydown", onKeyDown);
  }

  paint();
  applyEntry();
  if (typeof ResizeObserver !== "undefined") {
    const watch = new ResizeObserver(() => syncBoardFrame());
    if (modal) watch.observe(modal);
    if (board && board.parentElement) watch.observe(board.parentElement);
  }
  doc.defaultView?.addEventListener("resize", () => syncBoardFrame());

  return {
    getSessionFormation: () => getSessionFormation(session),
    setSessionFormation(table) {
      const next = setSessionFormation(session, table);
      paint();
      notifyFormation();
      return next;
    },
    setJerseyNumbers(numbers) {
      const next = setJerseyNumbers(session, numbers);
      paint();
      return next;
    },
    getSessionMode: () => session.sessionMode,
    setSessionMode(mode) {
      const next = setSessionMode(session, mode);
      if (next !== SESSION_MODE_NEW_MATCH && open) setOpen(false);
      applyEntry();
      if (card) card.dataset.sessionMode = next;
      return next;
    },
    reset() {
      const next = resetSession(session);
      paint();
      notifyFormation();
      return next;
    },
    isDragging: () => drag !== null,
    isOpen: () => open,
    setOpen,
  };
}
