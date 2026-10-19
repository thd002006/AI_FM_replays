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
// listen for T. `newMatch` is the 开新局 hook for pre-kickoff and mid-match;
// phase B has not landed, so the viewer stays on `history`.

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
 * `x` 0 = own goal line, 1 = opponent goal line. `y` 0 = own left touchline.
 * Labels are the role code for the accessible name and the tooltip only.
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
 * @param {{ onInteract?: () => void, sessionMode?: string }} [hooks]
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
  let open = false;
  /** @type {{ index: number, pointerId: number } | null} */
  let drag = null;

  const interact = () => {
    if (typeof hooks.onInteract === "function") hooks.onInteract();
  };

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
    const phase = session.phase;
    board.dataset.phase = phase;
    slots.forEach((slot, i) => {
      const node = anchors.children[i];
      const point = phase === "defend" ? slot.defend : slot.attack;
      const number = session.jersey[i];
      node.className = `tactics-anchor${slot.label === "GK" ? " gk" : ""}`;
      node.textContent = String(number);
      node.title = slot.label;
      node.setAttribute("aria-label", `${number}号，${slot.label} 锚点`);
      node.style.left = `${point[0] * 100}%`;
      node.style.top = `${(1 - point[1]) * 100}%`;
      node.dataset.x = String(round4(point[0]));
      node.dataset.y = String(round4(point[1]));
      node.dataset.phase = phase;
      node.dataset.label = slot.label;
      node.dataset.number = String(number);
    });
  }

  function paint() {
    placeAnchors();
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
  }

  function setOpen(next) {
    if (next && session.sessionMode !== SESSION_MODE_NEW_MATCH) return;
    open = !!next;
    modal?.classList.toggle("hidden", !open);
    modal?.setAttribute("aria-hidden", open ? "false" : "true");
    toggleBtn?.classList.toggle("active", open);
    toggleBtn?.setAttribute("aria-pressed", open ? "true" : "false");
    doc.documentElement.classList.toggle("tactics-open", open);
    if (open) paint();
    interact();
  }

  function pointerPoint(e) {
    return clientToUnit(board.getBoundingClientRect(), e.clientX, e.clientY);
  }

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    drag = null;
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
    if (moveAnchor(session, drag.index, p.x, p.y)) paint();
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
    interact();
  });
  toggleBtn?.addEventListener("click", () => {
    if (session.sessionMode !== SESSION_MODE_NEW_MATCH) return;
    setOpen(!open);
  });
  doc.getElementById("tactics-close")?.addEventListener("click", () => setOpen(false));

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

  return {
    getSessionFormation: () => getSessionFormation(session),
    setSessionFormation(table) {
      const next = setSessionFormation(session, table);
      paint();
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
      return next;
    },
    isDragging: () => drag !== null,
    isOpen: () => open,
    setOpen,
  };
}
