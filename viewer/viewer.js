// AI_FM replay viewer: top-down 3D playback of a `fm_replay` file.
//
// Reads `docs/回放与查看/回放文件格式.md`. Schema 1 is every replay before
// `collision_sizes`. Schema 2 adds that object (radii already scaled). Any
// other schema is refused instead of guessing. Column order and the phase / skill /
// intent vocabularies come from the file header, so the viewer keeps
// working when the engine adds a skill next to an old one.

import * as THREE from "three";
import { pitchMarkings, resolveMarkings } from "./markings.js";
import {
  JERSEY_PITCH,
  ballDrawY,
  jerseyYaw,
  labelWorldPoint,
  resolveRender,
  screenUpOnGround,
} from "./markers.js";
import {
  HALF_TIME_BANNER_S,
  broadcastClock,
  findHalfTime,
  formatRealClock,
  halfLabel,
  halfTimeBannerText,
} from "./clock.js";
import {
  activeDecisionLabels,
  activeEventLabels,
  classifyPitchEvents,
  collectDecisionBirths,
  feedEventsUpTo,
  viewerFramesAsStat,
} from "./pitch_labels.js";
import {
  CONTROLS_IDLE_MS,
  FULLSCREEN_CHROME_IDLE_MS,
  DOUBLE_TAP_MS,
  EDGE_PAD_PX,
  PORTRAIT_CAMERA_UP,
  TAP_SLOP_PX,
  applyDocumentLayout,
  formatSpeed,
  nextSpeed,
} from "./mobile.js";
import {
  FULLSCREEN_BUTTON_ID,
  FULLSCREEN_ROOT_ID,
  IMMERSIVE_CLASS,
  createFullscreen,
  immersiveSize,
} from "./fullscreen.js";
import { formatLoadProgress, replayFetchPlan } from "./load_url.js";
import { mountTactics } from "./tactics.js";
import { createEngineClient } from "./engine_client.js";
import {
  createNewMatchSession,
  matchListHref,
  randomMatchSeed,
} from "./new_match.js";
import { eventKitClass, isGoalkeeper, kitClass, outfieldColor, playerColor, shirtNumber } from "./kits.js";
import { createMatchAudio } from "./audio.js";
import {
  jiggleDurationMs,
  jiggleFactor,
  kickContactsCrossing,
  shouldPauseForHalf,
} from "./cues.js";

/** History files are 1. Engine replays that record `collision_sizes` are 2. */
const SUPPORTED_SCHEMAS = [1, 2];
/** Wheel and pinch clamp. Same range the desktop wheel already used. */
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 8;
const WHEEL_ZOOM_OUT = 0.92;
const WHEEL_ZOOM_IN = 1.08;
/** Extra world around the touchlines so the lines are not on the pixel edge. */
const PITCH_FIT_PAD = 1.12;

const state = {
  replay: null,
  header: null,
  frames: [],
  events: [],
  metrics: null,
  col: {},
  bcol: {},
  frame: 0, // fractional frame index
  playing: false,
  speed: 1,
  view: "top",
  labels: true,
  pitchEvents: true,
  pitchDecisions: true,
  markers: false,
  trail: true,
  hoverId: null,
  selectedId: null,
  cam: { x: 0, z: 0, zoom: 1 },
  fit: null,
  lastTables: 0,
  decisionBirths: [],
  /** Parallel to `events`: fm_stats-aligned pitch labels, or null. */
  eventLabels: [],
  /** Resolved render sizes (URL `player_scale` / `ball_scale` or defaults). */
  draw: resolveRender(),
  /** §4.12 B fm_stats sidecar (`timeline` + `final`); null if missing. */
  statsSidecar: null,
  statsSidecarError: null,
  /** True when the sidecar URL 404s. Not a viewer error. */
  statsMissing: false,
  statsModalOpen: false,
  statsAutoOpened: false,
};

/** Session tactics board. History replay hides it; `newMatch` is the 开新局 hook. */
let tacticsCtl = null;

/** B78 live session. Null while a history replay is on screen. */
let newMatch = null;
let newMatchHintTimer = 0;
let eventsBound = false;
/** Decision-birth cursor so a live step does not rescan the whole match. */
let decisionCursor = null;
/** Legacy pitch-label frames, grown with the match instead of copied each step. */
let statFrames = null;
let statFrameCount = 0;
/** Bumped when `#events` is rebuilt so the side feed cannot keep stale words. */
let feedEpoch = 0;
let feedActive = -2;
/** The one `#events li.active`. Playback must not walk the whole list. */
let activeEventLi = null;

/** Half-time banner. `until` is a performance.now() deadline; `hold` stays up for half_time phase frames. */
let halfBanner = { until: 0, hold: false, score: [0, 0] };
let prevHudTick = null;
/** Fade after {@link HALF_TIME_BANNER_S}. Autoplay also pauses on the same tick edge. */
const HALF_TIME_BANNER_FADE_MS = 400;
/**
 * Second-half whistle. Autoplay only. Not the same as `preMatch`: tactics stay shut.
 * Cleared by 开球 or Space (`togglePlay`).
 */
let awaitingSecondHalfKickoff = false;
/** Floor-frame tick last painted. Null until the first frame, so opening on the whistle is not a cross. */
let lastFloorTick = null;
/** @type {Map<number, { t0: number, speed: number }>} */
const jiggles = new Map();
/** Suspended until 开球, ▶, Space, or 列表. Then unmuted unless the speaker button says otherwise. */
const matchAudio = createMatchAudio();

const STATS_MISSING_LINE =
  "本回放没有统计文件。生成：cargo run -p fm_script --bin script_report -- --stats --stats-json-dir <dir> --save-replays <dir>";

const el = (id) => document.getElementById(id);

function fail(message) {
  const box = el("error");
  box.textContent = message;
  box.classList.remove("hidden");
  console.error(message);
}

// ---------------------------------------------------------------- loading

function showLoadProgress(received, total) {
  const node = el("load-progress");
  if (!node) return;
  node.textContent = formatLoadProgress(received, total);
  node.classList.remove("hidden");
}

function hideLoadProgress() {
  el("load-progress")?.classList.add("hidden");
}

/** Yield once so a progress line can paint before a large JSON.parse. */
function paintFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function readJsonWithProgress(res) {
  const totalHeader = Number(res.headers.get("Content-Length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  showLoadProgress(0, total);
  await paintFrame();
  if (!res.body || typeof res.body.getReader !== "function") {
    const data = await res.json();
    showLoadProgress(total ?? 0, total);
    return data;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    showLoadProgress(received, total);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

/**
 * Page-relative `?file=`, then one server-root retry on HTTP 404 when the
 * value does not start with ".". Network errors do not fall through.
 */
async function fetchReplay(file) {
  const plan = replayFetchPlan(file, location.href);
  let lastError = null;
  for (let i = 0; i < plan.urls.length; i++) {
    const url = plan.urls[i];
    const res = await fetch(url, { cache: plan.cache });
    if (res.status === 404 && i < plan.urls.length - 1) {
      await discardBody(res);
      lastError = new Error(`${res.status} ${res.statusText}`);
      continue;
    }
    if (!res.ok) {
      await discardBody(res);
      throw new Error(`${res.status} ${res.statusText}`);
    }
    const data = await readJsonWithProgress(res);
    return { data, url, cache: plan.cache };
  }
  throw lastError || new Error("无法加载");
}

async function load() {
  applyDocumentLayout(window);
  const params = new URLSearchParams(location.search);
  if (params.get("mode") === "newMatch") {
    await loadNewMatch(params);
    return;
  }
  const file = params.get("file") || "sample_replay.json";
  el("file-name").textContent = file;
  let data;
  let url;
  let fetchCache = "default";
  try {
    const loaded = await fetchReplay(file);
    data = loaded.data;
    url = loaded.url;
    fetchCache = loaded.cache;
  } catch (err) {
    hideLoadProgress();
    fail(`无法加载回放 ${file}：${err.message}\n本页必须通过 HTTP 打开（python tools/replay_viewer/serve.py）。`);
    return;
  }
  await presentReplay(data, file, url, fetchCache, params);
}

/**
 * Paint a schema 1 or 2 replay. History files, tactics playback, and the
 * 开新局 tick-0 frame share this, so a v2 header is accepted in every mode.
 * @param {URLSearchParams} params
 * @param {{ stats?: boolean }} [options]
 */
async function presentReplay(data, file, url, fetchCache, params, options = {}) {
  const header = data.header || {};
  if (!SUPPORTED_SCHEMAS.includes(header.schema_version)) {
    hideLoadProgress();
    fail(
      `回放 schema_version=${header.schema_version}，本查看器只支持 ${SUPPORTED_SCHEMAS.join("、")}。\n` +
        `文件不匹配时拒绝加载，不做静默适配（评审 §6.1 第 5 项）。`,
    );
    return;
  }
  state.replay = data;
  state.header = header;
  state.frames = data.frames || [];
  state.events = data.events || [];
  state.metrics = data.metrics || {};
  // Debug hook: keeps the whole file reachable from the console (and from
  // scripted checks), it is read-only for the viewer itself.
  window.__replay = data;
  state.col = Object.fromEntries((header.player_columns || []).map((c, i) => [c, i]));
  state.bcol = Object.fromEntries((header.ball_columns || []).map((c, i) => [c, i]));
  if (state.frames.length === 0) {
    hideLoadProgress();
    fail("回放里没有帧。");
    return;
  }
  state.decisionBirths = collectDecisionBirths({
    frames: state.frames,
    col: state.col,
    skillNames: header.skill_names || [],
    intentNames: header.intent_names || [],
    realOfFrame,
  });
  state.eventLabels = classifyPitchEvents({
    events: state.events,
    frames: state.frames,
    col: state.col,
    bcol: state.bcol,
  });

  const clockEl = el("clock");
  if (clockEl) {
    clockEl.title = header.clock
      ? "比赛时钟（转播读法）"
      : "真实时间（这份回放没有比赛时钟）";
  }
  el("scene").textContent = header.scene ?? "–";
  el("seed").textContent = header.seed ?? "–";
  el("protocol").textContent = `${header.protocol_tag ?? "?"} (v${header.protocol_version ?? "?"})`;
  el("config-hash").textContent = (header.config_hash || "–").slice(0, 8);
  el("scrub").max = String(state.frames.length - 1);

  // Optional header.collision_sizes (see readHeaderRadii). Schema 2 records
  // radii that are already scaled; resolveRender does not apply
  // collision_size_scale again. A later schema still has to be allowlisted.
  state.draw = resolveRender(params, header);
  awaitingSecondHalfKickoff = false;
  lastFloorTick = null;
  jiggles.clear();
  const frameArg = params.get("frame");
  if (frameArg !== null && frameArg !== "") {
    const n = Number(frameArg);
    if (Number.isFinite(n)) state.frame = Math.max(0, Math.min(state.frames.length - 1, n));
  }
  if (params.get("markers") === "1") state.markers = true;
  const viewArg = params.get("view");

  buildScene();
  buildMetrics();
  buildEvents();
  if (options.stats === false) state.statsMissing = true;
  else await loadStatsSidecar(file, url, fetchCache);
  hideLoadProgress();
  wireControls();
  updateStatsModal();
  el("markers-on").checked = state.markers;
  if (params.get("labels") === "0") {
    state.labels = false;
    el("labels-on").checked = false;
  }
  if (params.get("pitch_events") === "0") {
    state.pitchEvents = false;
    el("pitch-events-on").checked = false;
  }
  if (params.get("pitch_decisions") === "0") {
    state.pitchDecisions = false;
    el("pitch-decisions-on").checked = false;
  }
  if (params.get("trail") === "0") {
    state.trail = false;
    el("trail-on").checked = false;
  }
  setView(viewArg === "tilt" ? "tilt" : "top");
  if (params.get("focus") === "player") {
    focusPlayer(Number(params.get("player") ?? "0"), Number(params.get("span") ?? "4"), state.view);
  }
  window.__viewer = {
    ready: true,
    focusPlayer,
    setFrame(i) {
      if (awaitingSecondHalfKickoff) endSecondHalfKickoff(false);
      state.frame = Math.max(0, Math.min(state.frames.length - 1, i));
      state.playing = false;
      trailCount = 0;
      lastFloorTick = floorTickAt(state.frame);
      const play = el("play");
      if (play) play.textContent = "▶";
    },
    setView(mode) {
      setView(mode);
    },
    setLabels(on) {
      state.labels = !!on;
      el("labels-on").checked = state.labels;
    },
    setPitchEvents(on) {
      state.pitchEvents = !!on;
      el("pitch-events-on").checked = state.pitchEvents;
    },
    setPitchDecisions(on) {
      state.pitchDecisions = !!on;
      el("pitch-decisions-on").checked = state.pitchDecisions;
    },
    setTrail(on) {
      state.trail = !!on;
      el("trail-on").checked = state.trail;
      trailCount = 0;
    },
    setMarkers(on) {
      state.markers = !!on;
      el("markers-on").checked = state.markers;
      syncMarkers();
    },
    markings() {
      return pitchMarkings(resolveMarkings(state.header.field));
    },
    renderSizes() {
      return state.draw;
    },
    cameraKind() {
      return viewCamera.isOrthographicCamera ? "ortho" : "persp";
    },
    playing() {
      return state.playing;
    },
    awaitingSecondHalfKickoff() {
      return awaitingSecondHalfKickoff;
    },
    markerScale(id) {
      const mesh = playerMeshes[id];
      return mesh ? mesh.group.scale.x : null;
    },
    audio() {
      return { muted: matchAudio.muted, unlocked: matchAudio.unlocked, played: matchAudio.played };
    },
    frame() {
      return state.frame;
    },
    camera() {
      return { x: state.cam.x, z: state.cam.z, zoom: state.cam.zoom };
    },
    refit() {
      reframe();
      placeCamera();
    },
    // Touchline corners in CSS pixels, plus the chrome rectangle the camera fit to.
    pitchScreenBounds() {
      placeCamera();
      const f = state.header.field;
      const halfL = f.length / 2;
      const halfW = f.width / 2;
      const { width: W, height: H } = viewPixels();
      const points = [
        [-halfL, -halfW],
        [halfL, -halfW],
        [halfL, halfW],
        [-halfL, halfW],
      ].map(([x, z]) => {
        const v = new THREE.Vector3(x, 0, z).project(viewCamera);
        return { x: (v.x + 1) * 0.5 * W, y: (1 - v.y) * 0.5 * H };
      });
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const panelNode = el("panel");
      const panel = panelNode ? panelNode.getBoundingClientRect() : null;
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        points,
        insets: chromeInsets(),
        view: { width: W, height: H },
        panel: panel
          ? {
              left: panel.left,
              top: panel.top,
              right: panel.right,
              bottom: panel.bottom,
              width: panel.width,
              height: panel.height,
            }
          : null,
        kind: viewCamera.isOrthographicCamera ? "ortho" : "persp",
      };
    },
    realSeconds() {
      return realOfFrame(frameAt(state.frame).a);
    },
    zoom() {
      return state.cam.zoom;
    },
    speed() {
      return state.speed;
    },
    layout() {
      return document.documentElement.dataset.layout || "desktop";
    },
    playerScreen(id) {
      const row = frameAt(state.frame).a.p.find((r) => r[state.col.id] === id);
      if (!row) return null;
      placeCamera();
      const v = new THREE.Vector3(row[state.col.x], 0, row[state.col.z]).project(viewCamera);
      const { width: W, height: H } = viewPixels();
      return {
        id,
        x: (v.x + 1) * 0.5 * W,
        y: (1 - v.y) * 0.5 * H,
      };
    },
  };
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ scene

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10161d);
// Far plane covers a full IFAB pitch (105×68) plus chrome insets when zoomed out.
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 2000);
let viewCamera = camera;
const renderer = new THREE.WebGLRenderer({ canvas: el("pitch"), antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

let pitchGroup = null;
let ballMesh = null;
let ballShadow = null;
let ballStem = null;
let trail = null;
let trailCount = 0;
const playerMeshes = [];
const playerLabels = [];
const eventMarkers = [];
let eventFlash = null;

const labelLayer = el("labels");
const pitchLabelLayer = el("pitch-labels");
/** @type {Map<string, HTMLElement>} */
const pitchLabelNodes = new Map();

function jerseyTexture(n) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const text = String(n);
  const fontPx = text.length > 1 ? 128 : 168;
  ctx.clearRect(0, 0, size, size);
  ctx.font = `800 ${fontPx}px Arial, "Segoe UI", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.round(fontPx * 0.14);
  ctx.strokeStyle = "#07111c";
  const y = size / 2 + fontPx * 0.02;
  ctx.strokeText(text, size / 2, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, size / 2, y);
  const tex = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

function buildScene() {
  const f = state.header.field;
  const halfL = f.length / 2;

  scene.clear();
  labelLayer.innerHTML = "";
  pitchLabelLayer.innerHTML = "";
  pitchLabelNodes.clear();
  playerMeshes.length = 0;
  playerLabels.length = 0;
  eventMarkers.length = 0;

  pitchGroup = new THREE.Group();
  scene.add(pitchGroup);

  // Grass, mown stripes and the apron outside the touchline.
  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(f.length + 16, f.width + 12),
    new THREE.MeshBasicMaterial({ color: 0x1d4d2a }),
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  pitchGroup.add(outer);

  const stripes = 14;
  for (let i = 0; i < stripes; i += 2) {
    const w = f.length / stripes;
    const s = new THREE.Mesh(
      new THREE.PlaneGeometry(w, f.width),
      new THREE.MeshBasicMaterial({ color: 0x226032 }),
    );
    s.rotation.x = -Math.PI / 2;
    s.position.set(-halfL + w * (i + 0.5), -0.01, 0);
    pitchGroup.add(s);
  }

  const markings = pitchMarkings(resolveMarkings(f));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xf4f7fb });
  for (const line of markings.lines) {
    const pts = line.points.map((p) => new THREE.Vector3(p[0], 0.03, p[1]));
    // A closed loop already repeats its first point for the geometry test;
    // LineLoop closes the gap itself.
    const draw = line.closed ? pts.slice(0, -1) : pts;
    const g = new THREE.BufferGeometry().setFromPoints(draw);
    pitchGroup.add(line.closed ? new THREE.LineLoop(g, lineMat) : new THREE.Line(g, lineMat));
  }
  const spotMat = new THREE.MeshBasicMaterial({ color: 0xf4f7fb });
  for (const spot of markings.spots) {
    const mark = new THREE.Mesh(new THREE.CircleGeometry(spot.radius, 20), spotMat);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(spot.x, 0.035, spot.z);
    pitchGroup.add(mark);
  }

  // Goals. Post thickness is a draw size; mouth width and crossbar height
  // come from the pitch config via the replay header.
  const goalW = markings.markings.goalWidth;
  const goalH = markings.markings.goalHeight;
  const post = new THREE.MeshBasicMaterial({ color: 0xf7fbff });
  for (const sign of [1, -1]) {
    for (const z of [-goalW / 2, goalW / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, goalH, 0.12), post);
      bar.position.set(sign * halfL, goalH / 2, z);
      pitchGroup.add(bar);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, goalW + 0.12), post);
    cross.position.set(sign * halfL, goalH, 0);
    pitchGroup.add(cross);
  }

  // Players: a disc, an outward obtuse triangle, and the jersey number on
  // the top face. Every one of those comes from `marker` (one playerScale).
  // The number is not a child of the body: Euler x=−π/2 gimbal-locks yaw on
  // the mesh itself, and body yaw was what flipped the away numbers.
  const { marker, ballRadius, shadowRadius } = state.draw;
  const { radius: playerRadius, height: playerHeight } = marker;
  const bodyGeo = new THREE.CylinderGeometry(playerRadius, playerRadius, playerHeight, 32);
  const [tip, left, right] = marker.facing.points;
  const wedgeY = marker.facing.lift;
  const wedgeGeo = new THREE.BufferGeometry();
  wedgeGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [tip[0], wedgeY, tip[1], left[0], wedgeY, left[1], right[0], wedgeY, right[1]],
      3,
    ),
  );
  const wedgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const first = state.frames[0].p;
  state.keeperIds = new Map();
  for (const row of first) {
    const id = row[state.col.id];
    const team = row[state.col.team];
    const keeper = rememberKeeper(row);
    const mesh = new THREE.Mesh(
      bodyGeo,
      new THREE.MeshBasicMaterial({ color: playerColor(team, keeper) }),
    );
    mesh.position.y = playerHeight / 2;
    const group = new THREE.Group();
    group.add(mesh);
    group.add(new THREE.Mesh(wedgeGeo, wedgeMat));
    group.userData.playerId = id;
    const number = new THREE.Mesh(
      new THREE.CircleGeometry(marker.numberRadius, 32),
      new THREE.MeshBasicMaterial({
        map: jerseyTexture(shirtNumber(row, state.col)),
        transparent: true,
        depthWrite: false,
      }),
    );
    number.rotation.x = JERSEY_PITCH;
    number.renderOrder = 2;
    const numberRig = new THREE.Group();
    numberRig.add(number);
    scene.add(numberRig);
    scene.add(group);
    playerMeshes[id] = { group, body: mesh, number: numberRig };

    const lab = document.createElement("div");
    lab.className = `plabel ${kitClass(team, keeper)}`;
    labelLayer.appendChild(lab);
    playerLabels[id] = lab;
  }

  // Ball: sphere, ground shadow and a stem that shows the height.
  // Radius is the resolved draw size (no-radius replays are the previous
  // picture × 1.3; a header ball radius keeps that same ratio). The
  // shadow disc uses the same radius. Physics ball.radius is not edited here.
  ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(ballRadius, 24, 16),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  scene.add(ballMesh);
  ballShadow = new THREE.Mesh(
    new THREE.CircleGeometry(shadowRadius, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }),
  );
  ballShadow.rotation.x = -Math.PI / 2;
  scene.add(ballShadow);
  ballStem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xffe08a }),
  );
  scene.add(ballStem);

  const ballLab = document.createElement("div");
  ballLab.className = "plabel ball";
  labelLayer.appendChild(ballLab);
  playerLabels[-1] = ballLab;

  trail = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.55 }),
  );
  scene.add(trail);
  trailCount = 0;

  // Persistent rings are opt-in. Shots and goals used to share one yellow
  // ring, which read as a field of unexplained circles. They stay distinct
  // and hidden until 「标记」 is on. Possession changes are not drawn.
  for (const ev of state.events) {
    if (ev.x === undefined || ev.z === undefined) continue;
    const team = ev.team === 0 || ev.team === 1 ? ev.team : 0;
    let ring = null;
    if (ev.kind === "goal") {
      ring = addRing(0.85, 1.2, outfieldColor(team), 0.95, ev.x, ev.z);
    } else if (ev.kind === "shot" && ev.on_target) {
      ring = addRing(0.5, 0.72, 0xffd479, 0.95, ev.x, ev.z);
    } else if (ev.kind === "shot") {
      ring = addRing(0.28, 0.44, 0x9aa7b5, 0.85, ev.x, ev.z);
    }
    if (ring) eventMarkers.push(ring);
  }
  syncMarkers();

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(40, 90, 30);
  scene.add(sun);
  eventFlash = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.6, 28),
    new THREE.MeshBasicMaterial({ color: 0xff6b5e, transparent: true, opacity: 0.9 }),
  );
  eventFlash.rotation.x = -Math.PI / 2;
  eventFlash.visible = false;
  scene.add(eventFlash);

  onResize();
}

function addRing(inner, outer, color, opacity, x, z) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.045, z);
  ring.visible = false;
  scene.add(ring);
  return ring;
}

function syncMarkers() {
  for (const ring of eventMarkers) ring.visible = state.markers;
}

function layoutName() {
  return document.documentElement.dataset.layout || "desktop";
}

function immersiveOn() {
  return document.documentElement.classList.contains(IMMERSIVE_CLASS);
}

/** Landscape and fullscreen float the bars. Portrait and desktop reserve them. */
function barsFloat() {
  return layoutName() === "landscape" || immersiveOn();
}

function viewPixels() {
  return immersiveSize(window, immersiveOn());
}

function chromeInsets() {
  const { width: W, height: H } = viewPixels();
  const insets = { top: EDGE_PAD_PX, left: EDGE_PAD_PX, right: EDGE_PAD_PX, bottom: EDGE_PAD_PX };
  // Floating bars sit on the pitch; reserving them would shrink the field.
  if (barsFloat()) return insets;
  const box = (id) => {
    const node = el(id);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return r;
  };
  const hud = box("hud-top");
  const controls = box("controls");
  const panel = box("panel");
  const feed = box("event-feed");
  if (hud) insets.top = Math.max(insets.top, hud.bottom + 10);
  if (controls) insets.bottom = Math.max(insets.bottom, H - controls.top + 10);
  // The event feed is a bounded strip on the right. Keep the pitch to its left.
  // Portrait drawer covers the lower half on purpose. It is not chrome to avoid.
  if (layoutName() !== "portrait") {
    if (feed) insets.right = Math.max(insets.right, W - feed.left + 12);
    if (panel) reservePanel(insets, panel, W, H);
  }
  return insets;
}

// A full-height stats column blocks whichever side contains it. Measuring
// `panel.right` and always writing `left` shoved a right-hand column off the
// left edge (at 1280×720 that inset was ~1292px and the pitch left the
// screen). Collapsing shrinks the column to a short header; that header only
// takes a top band, so the width underneath stays usable.
function reservePanel(insets, rect, W, H) {
  const onLeft = rect.left + rect.width / 2 <= W / 2;
  const column = rect.height >= H * 0.45;
  if (column) {
    if (onLeft) insets.left = Math.max(insets.left, rect.right + 12);
    else insets.right = Math.max(insets.right, W - rect.left + 12);
    return;
  }
  if (rect.top < 24) {
    insets.top = Math.max(insets.top, rect.bottom + 10);
    return;
  }
  if (onLeft) insets.left = Math.max(insets.left, rect.right + 12);
  else insets.right = Math.max(insets.right, W - rect.left + 12);
}

function reframe() {
  if (!state.header) return;
  const f = state.header.field;
  const insets = chromeInsets();
  const { width: W, height: H } = viewPixels();
  const viewW = Math.max(80, W - insets.left - insets.right);
  const viewH = Math.max(80, H - insets.top - insets.bottom);
  const pitchL = f.length * PITCH_FIT_PAD;
  const pitchW = f.width * PITCH_FIT_PAD;
  const viewCx = insets.left + viewW / 2;
  const viewCy = insets.top + viewH / 2;
  const portrait = layoutName() === "portrait" && state.view === "top";
  if (state.view === "top") {
    // Portrait turns the camera 90°: pitch length runs up the screen, width across it.
    const alongX = portrait ? pitchW : pitchL;
    const alongY = portrait ? pitchL : pitchW;
    const units = Math.max(alongX / viewW, alongY / viewH);
    const lookX = portrait ? (viewCy - H / 2) * units : -(viewCx - W / 2) * units;
    const lookZ = portrait ? (W / 2 - viewCx) * units : (H / 2 - viewCy) * units;
    state.fit = { mode: "top", lookX, lookZ, units, portrait };
  } else {
    const fov = (camera.fov * Math.PI) / 180;
    const tilt = 0.95;
    const span = Math.max(pitchL, pitchW);
    const frac = Math.min(viewW / W, viewH / H);
    const dist = ((span * 0.55) / Math.tan(fov / 2) / Math.max(0.35, frac)) * 0.92;
    const halfH = Math.tan(fov / 2) * dist;
    const halfWf = halfH * (W / Math.max(1, H));
    const ndcX = (viewCx / W) * 2 - 1;
    const ndcY = -((viewCy / H) * 2 - 1);
    state.fit = {
      mode: "tilt",
      lookX: -ndcX * halfWf,
      lookZ: ndcY * halfH * Math.cos(tilt),
      dist,
      tilt,
      units: dist / 500,
    };
  }
  state.cam.x = 0;
  state.cam.z = 0;
  state.cam.zoom = 1;
}

function setView(mode) {
  state.view = mode === "tilt" ? "tilt" : "top";
  const view = el("view");
  if (view) view.value = state.view;
  reframe();
}

// `span` is the visible world height in metres (top) or the camera distance
// (oblique). The look point moves onto the player; zoom does the rest, so a
// later reframe of the whole pitch does not stick.
function focusPlayer(id, span, view) {
  const { a } = frameAt(state.frame);
  const row = a.p.find((r) => r[state.col.id] === id);
  if (!row) return false;
  const mode = view === "tilt" ? "tilt" : "top";
  setView(mode);
  const fit = state.fit;
  if (!fit) return false;
  state.cam.x = row[state.col.x] - fit.lookX;
  state.cam.z = row[state.col.z] - fit.lookZ;
  const want = span > 0 ? span : mode === "top" ? 4 : 9;
  if (mode === "top") {
    const h = Math.max(1, viewPixels().height);
    state.cam.zoom = (fit.units * h) / want;
  } else {
    state.cam.zoom = fit.dist / want;
  }
  return true;
}

function placeCamera() {
  const fit = state.fit;
  if (!fit) return;
  const zoom = state.cam.zoom || 1;
  const lx = fit.lookX + state.cam.x;
  const lz = fit.lookZ + state.cam.z;
  if (fit.mode === "top") {
    const units = fit.units / zoom;
    const { width: viewW, height: viewH } = viewPixels();
    const worldW = units * viewW;
    const worldH = units * viewH;
    ortho.left = -worldW / 2;
    ortho.right = worldW / 2;
    ortho.top = worldH / 2;
    ortho.bottom = -worldH / 2;
    ortho.position.set(lx, 90, lz);
    if (fit.portrait) ortho.up.set(PORTRAIT_CAMERA_UP.x, PORTRAIT_CAMERA_UP.y, PORTRAIT_CAMERA_UP.z);
    else ortho.up.set(0, 0, -1);
    ortho.lookAt(lx, 0, lz);
    ortho.updateProjectionMatrix();
    viewCamera = ortho;
  } else {
    const dist = fit.dist / zoom;
    camera.position.set(lx, dist * Math.sin(fit.tilt), lz + dist * Math.cos(fit.tilt));
    camera.up.set(0, 1, 0);
    camera.lookAt(lx, 0, lz);
    camera.updateProjectionMatrix();
    viewCamera = camera;
  }
}

function realOfFrame(frame) {
  const dt = state.header && state.header.field && state.header.field.dt;
  if (frame && Number.isFinite(frame.t) && Number.isFinite(dt) && dt > 0) return frame.t * dt;
  const m = state.metrics || {};
  if (frame && m.game_seconds > 0) return (frame.time || 0) * (m.duration_seconds / m.game_seconds);
  return frame ? frame.time || 0 : 0;
}

function realOfEvent(ev) {
  const dt = state.header && state.header.field && state.header.field.dt;
  if (ev && Number.isFinite(ev.tick) && Number.isFinite(dt) && dt > 0) return ev.tick * dt;
  return ev ? ev.time || 0 : 0;
}

function clockHeader() {
  return state.header && state.header.clock ? state.header.clock : null;
}

/** Match clock when the file has one; otherwise the real-time clock. */
function shownClock(matchSeconds, tick, realSeconds) {
  const text = broadcastClock(matchSeconds, tick, clockHeader(), findHalfTime(state.events));
  return text == null ? formatRealClock(realSeconds) : text;
}

function hideHalfBanner() {
  halfBanner.until = 0;
  halfBanner.hold = false;
  const node = el("half-banner");
  if (!node) return;
  node.classList.add("hidden");
  node.classList.remove("fading");
}

function showHalfBanner(score, hold) {
  const node = el("half-banner");
  if (!node) return;
  halfBanner.hold = hold;
  halfBanner.score = [Number(score?.[0]) || 0, Number(score?.[1]) || 0];
  halfBanner.until = hold ? 0 : performance.now() + HALF_TIME_BANNER_S * 1000;
  node.textContent = halfTimeBannerText(halfBanner.score);
  node.classList.remove("hidden", "fading");
}

/** @returns {boolean} banner is on screen (including the fade). */
function syncHalfBanner(frame) {
  const node = el("half-banner");
  if (!node) return false;
  const clock = clockHeader();
  const ht = findHalfTime(state.events);
  const phase = state.header.phase_names[frame.phase] ?? "";
  const tick = Number(frame.t);
  if (!clock || !ht) {
    hideHalfBanner();
    prevHudTick = Number.isFinite(tick) ? tick : prevHudTick;
    return false;
  }
  if (phase === "half_time") {
    showHalfBanner(frame.score, true);
    prevHudTick = tick;
    return true;
  }
  if (prevHudTick != null && prevHudTick < ht.tick && tick >= ht.tick) {
    showHalfBanner(frame.score, false);
  }
  if (tick < ht.tick) {
    hideHalfBanner();
  } else if (!halfBanner.hold && halfBanner.until) {
    const now = performance.now();
    if (now >= halfBanner.until + HALF_TIME_BANNER_FADE_MS) hideHalfBanner();
    else if (now >= halfBanner.until) node.classList.add("fading");
  }
  prevHudTick = tick;
  return !node.classList.contains("hidden");
}

/** @returns {boolean} this row is the team's goalkeeper */
function rememberKeeper(row) {
  if (!state.keeperIds) state.keeperIds = new Map();
  const id = row[state.col.id];
  const keeper = isGoalkeeper(row, state.col, state.header);
  if (keeper) state.keeperIds.set(id, row[state.col.team]);
  else state.keeperIds.delete(id);
  return keeper;
}

function detailText(row) {
  const col = state.col;
  const skill = state.header.skill_names[row[col.skill]] || "";
  const intent = state.header.intent_names[row[col.intent]] || "";
  const bits = [];
  if (isGoalkeeper(row, col, state.header)) bits.push("门将");
  if (skill) bits.push(skill);
  if (intent && intent !== skill) bits.push(intent);
  return bits.join(" · ");
}

// ------------------------------------------------------------- playback

function frameAt(index) {
  const n = state.frames.length;
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(index)));
  const i1 = Math.min(n - 1, i0 + 1);
  const a = state.frames[i0];
  const b = state.frames[i1];
  return { a, b, t: Math.max(0, Math.min(1, index - i0)), i0 };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function orientJersey(number, x, z, scale) {
  const cam = viewCamera;
  // Cameras look down their local −Z. A pure top-down look has no ground
  // component, so screen-up is camera.up: world −Z in landscape, world +X
  // when the portrait top camera has turned the pitch.
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const up = screenUpOnGround(
    cam.position.x,
    cam.position.z,
    cam.position.x + fwd.x,
    cam.position.z + fwd.z,
    cam.up.x,
    cam.up.z,
  );
  const { height, numberLift } = state.draw.marker;
  number.position.set(x, (height + numberLift) * scale, z);
  number.rotation.set(0, jerseyYaw(up.x, up.z), 0);
  number.scale.setScalar(scale);
}

/** True when the drawn ball sits inside a player cylinder (oblique occlusion). */
function ballBuriedInBody(bx, bz, meshY, byId) {
  if (meshY >= state.draw.playerHeight) return false;
  const { radius, carryScale } = state.draw.marker;
  const r = radius * carryScale;
  const r2 = r * r;
  const col = state.col;
  for (const [, row] of byId) {
    const dx = bx - row[col.x];
    const dz = bz - row[col.z];
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

function currentScreenUp() {
  const cam = viewCamera;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  return screenUpOnGround(
    cam.position.x,
    cam.position.z,
    cam.position.x + fwd.x,
    cam.position.z + fwd.z,
    cam.up.x,
    cam.up.z,
  );
}

/** World point for a floating label, clear of the scaled body. */
function labelAt(x, z) {
  return labelWorldPoint(x, z, {
    marker: state.draw.marker,
    screenUp: currentScreenUp(),
    topDown: state.view === "top",
  });
}

function applyFrame() {
  const { a, b, t, i0 } = frameAt(state.frame);
  const col = state.col;
  const bcol = state.bcol;
  const byId = new Map();
  for (const row of a.p) byId.set(row[col.id], row);
  for (const row of b.p) if (!byId.has(row[col.id])) byId.set(row[col.id], row);

  for (const [id, row] of byId) {
    const other = b.p.find((r) => r[col.id] === id) || row;
    const mesh = playerMeshes[id];
    if (!mesh) continue;
    const x = lerp(row[col.x], other[col.x], t);
    const z = lerp(row[col.z], other[col.z], t);
    mesh.group.position.set(x, 0, z);
    const fx = lerp(row[col.fx], other[col.fx], t);
    const fz = lerp(row[col.fz], other[col.fz], t);
    const len = Math.hypot(fx, fz) || 1;
    // Only the disc and the facing triangle yaw. The number is oriented
    // from the camera below, so it stays upright on screen.
    mesh.group.rotation.y = Math.atan2(-fz / len, fx / len);
    const carrying = row[col.ball] === 1 || other[col.ball] === 1;
    const scale = carrying ? state.draw.marker.carryScale : 1;
    mesh.group.scale.setScalar(scale);
    const team = row[col.team];
    const keeper = rememberKeeper(row);
    mesh.body.material.color.setHex(playerColor(team, keeper));
    const lab = playerLabels[id];
    if (lab) {
      lab.classList.toggle("home", team === 0);
      lab.classList.toggle("away", team === 1);
      lab.classList.toggle("gk", keeper);
    }
    // The number rig is not a child of the body, so this yaw does not turn it.
    orientJersey(mesh.number, x, z, scale);
    // applyFrame overwrites scale every paint. The kick pulse multiplies after that.
    const jiggle = jiggleNow(id);
    if (jiggle !== 1) {
      mesh.group.scale.setScalar(scale * jiggle);
      mesh.number.scale.setScalar(scale * jiggle);
    }
  }

  const bx = lerp(a.b[bcol.x], b.b[bcol.x], t);
  const by = lerp(a.b[bcol.y], b.b[bcol.y], t);
  const bz = lerp(a.b[bcol.z], b.b[bcol.z], t);
  const topDown = state.view === "top";
  const meshY = ballDrawY(by, {
    ballRadius: state.draw.ballRadius,
    playerHeight: state.draw.playerHeight,
    topDown,
  });
  ballMesh.position.set(bx, meshY, bz);
  // Oblique: a grounded ball inside a body cylinder is hidden by the cap.
  // Draw it after the bodies so it stays readable. Top-down already lifts
  // the sphere above the caps (see ballDrawY).
  const buried = !topDown && ballBuriedInBody(bx, bz, meshY, byId);
  ballMesh.material.depthTest = !buried;
  ballMesh.renderOrder = buried ? 4 : 0;
  ballShadow.position.set(bx, 0.03, bz);
  const shadowScale = 1 + Math.max(0, by - state.draw.ballRadius) * 0.35;
  ballShadow.scale.setScalar(shadowScale);
  ballShadow.material.opacity = Math.max(0.18, 0.45 - by * 0.06);
  const airborne = by > 0.45;
  ballStem.visible = airborne;
  ballStem.geometry.setFromPoints([
    new THREE.Vector3(bx, 0.03, bz),
    new THREE.Vector3(bx, by, bz),
  ]);

  trail.visible = state.trail;
  if (state.trail && i0 + 1 > trailCount) {
    const start = Math.max(0, i0 - 299);
    const pts = [];
    for (let i = start; i <= i0; i++) {
      const f = state.frames[i];
      pts.push(new THREE.Vector3(f.b[bcol.x], f.b[bcol.y], f.b[bcol.z]));
    }
    trail.geometry.setFromPoints(pts);
    trailCount = i0 + 1;
  }
  if (!state.trail) trailCount = 0;

  // Labels sit above the body in screen space (a world-Y offset collapses
  // to the same pixel in top-down). The jersey number is painted on the disc
  // with no '#'; the floating tag is skill and intent, on hover or click.
  const labelsOn = state.labels;
  labelLayer.style.display = labelsOn ? "" : "none";
  const project = (x, y, z) => new THREE.Vector3(x, y, z).project(viewCamera);
  if (labelsOn) {
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const place = (lab, p) => {
      lab.style.left = `${(p.x * 0.5 + 0.5) * w}px`;
      lab.style.top = `${(-p.y * 0.5 + 0.5) * h}px`;
      lab.style.opacity = p.z > 1 ? "0" : "1";
    };
    for (const [id, row] of byId) {
      const lab = playerLabels[id];
      if (!lab) continue;
      const other = b.p.find((r) => r[col.id] === id) || row;
      const open = id === state.hoverId || id === state.selectedId;
      lab.classList.toggle("show-detail", open);
      lab.classList.toggle("on", id === state.selectedId);
      const detail = detailText(row);
      lab.innerHTML = detail ? `<span class="detail">${detail}</span>` : "";
      lab.style.visibility = open && detail ? "visible" : "hidden";
      const head = labelAt(
        lerp(row[col.x], other[col.x], t),
        lerp(row[col.z], other[col.z], t),
      );
      place(lab, project(head.x, head.y, head.z));
    }
    const bl = playerLabels[-1];
    bl.classList.toggle("hidden", !airborne);
    if (airborne) {
      bl.textContent = `${by.toFixed(2)} m`;
      place(bl, project(bx, by, bz));
    }
  }

  // Top clock is the broadcast match clock when header.clock is present.
  // #time stays real seconds (tick × dt). Old files keep the real-time clock.
  const real = realOfFrame(a);
  const phaseName = state.header.phase_names[a.phase] ?? "";
  const bannerOn = syncHalfBanner(a);
  el("score").textContent = `${a.score[0]} - ${a.score[1]}`;
  el("clock").textContent = shownClock(a.time, a.t, real);
  const label = el("half-label");
  if (label) {
    label.textContent = halfLabel({
      clock: clockHeader(),
      phase: phaseName,
      tick: a.t,
      bannerVisible: bannerOn,
      halfTime: findHalfTime(state.events),
    });
  }
  el("phase").textContent = phaseName;
  el("frame-info").textContent = `tick ${a.t} · 帧 ${i0 + 1}/${state.frames.length}`;
  el("time").textContent = `${real.toFixed(1)}s`;
  el("scrub").value = String(i0);

  // Nearest event within 0.2 real seconds. The pitch pulse is only for
  // shot / goal / out_of_play, and only while markers are on.
  let active = null;
  let best = 0.2;
  for (const ev of state.events) {
    const d = Math.abs(realOfEvent(ev) - real);
    if (d < best) {
      best = d;
      active = ev;
    }
  }
  const eventList = el("events");
  let nextLi = null;
  if (active && eventList) {
    const idx = state.events.indexOf(active);
    if (idx >= 0) nextLi = eventList.children[idx] || null;
  }
  if (activeEventLi && activeEventLi !== nextLi) activeEventLi.classList.remove("active");
  if (nextLi && nextLi !== activeEventLi) nextLi.classList.add("active");
  activeEventLi = nextLi;
  const flashKind = active && (active.kind === "goal" || active.kind === "shot" || active.kind === "out_of_play");
  if (state.markers && flashKind && active.x !== undefined) {
    eventFlash.visible = true;
    eventFlash.position.set(active.x, 0.06, active.z);
    const s = 1 + 0.25 * Math.sin(performance.now() / 120);
    eventFlash.scale.setScalar(s);
  } else {
    eventFlash.visible = false;
  }

  syncEventFeed(real, active);
  syncPitchLabels(real, byId);

  if (performance.now() - state.lastTables > 200) {
    state.lastTables = performance.now();
    updateTables(a);
  }
}

function playerPosAt(byId, id) {
  const row = byId.get(id);
  if (!row) return null;
  return { x: row[state.col.x], z: row[state.col.z] };
}

function syncPitchLabels(real, byId) {
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  const project = (x, y, z) => new THREE.Vector3(x, y, z).project(viewCamera);
  /** @type {Array<{key:string, text:string, x:number, z:number, opacity:number, style:string}>} */
  const items = [];
  if (state.pitchEvents) {
    items.push(
      ...activeEventLabels({
        events: state.events,
        now: real,
        realOfEvent,
        playerPos: (id) => playerPosAt(byId, id),
        labels: state.eventLabels,
      }),
    );
  }
  if (state.pitchDecisions) {
    const positions = new Map();
    for (const [id, row] of byId) {
      positions.set(id, { x: row[state.col.x], z: row[state.col.z] });
    }
    items.push(
      ...activeDecisionLabels({
        births: state.decisionBirths,
        now: real,
        positions,
      }),
    );
  }

  const seen = new Set();
  for (const item of items) {
    seen.add(item.key);
    let node = pitchLabelNodes.get(item.key);
    if (!node) {
      node = document.createElement("div");
      node.dataset.key = item.key;
      pitchLabelLayer.appendChild(node);
      pitchLabelNodes.set(item.key, node);
    }
    node.className = `pitch-label ${item.style}`;
    node.textContent = item.text;
    const head = labelAt(item.x, item.z);
    const p = project(head.x, head.y, head.z);
    node.style.left = `${(p.x * 0.5 + 0.5) * w}px`;
    node.style.top = `${(-p.y * 0.5 + 0.5) * h}px`;
    const decisionMul = item.style === "decision" ? 0.72 : 1;
    node.style.opacity = p.z > 1 ? "0" : String(item.opacity * decisionMul);
    node.style.visibility = item.opacity > 0 && p.z <= 1 ? "visible" : "hidden";
  }
  for (const [key, node] of pitchLabelNodes) {
    if (seen.has(key)) continue;
    node.remove();
    pitchLabelNodes.delete(key);
  }
}

function updateTables(frame) {
  const col = state.col;
  const body = [];
  for (const row of frame.p) {
    const team = row[col.team];
    const keeper = isGoalkeeper(row, col, state.header);
    const skill = state.header.skill_names[row[col.skill]] || "";
    const intent = state.header.intent_names[row[col.intent]] || "";
    const speed = Math.hypot(row[col.vx], row[col.vz]);
    body.push(
      `<tr><td class="${kitClass(team, keeper)}">#${shirtNumber(row, col)}${
        keeper ? " 门将" : ""
      }</td><td class="skill">${skill}</td><td class="intent">${intent}</td><td class="num">${speed.toFixed(
        1,
      )}</td><td class="num">${row[col.y].toFixed(2)}</td></tr>`,
    );
  }
  el("players").innerHTML =
    "<tr><th>球员</th><th>技能</th><th>意图</th><th class='num'>m/s</th><th class='num'>高度</th></tr>" +
    body.join("");
}

// --------------------------------------------------------------- panels

const METRIC_ROWS = [
  { label: "传球成功率", key: "pass_completion_rate", target: "每队 65–85%", scope: "each", ok: (v) => v >= 0.65 && v <= 0.85, show: (v) => teamText(v, pct) },
  { label: "控球链长度(中位)", key: "possession_chain_median", target: "2–4", scope: "num", ok: (v) => v >= 2 && v <= 4, show: (v) => v.toFixed(1) },
  { label: "最长控球链", key: "possession_chain_max", target: "≥6 偶尔", show: (v) => String(v) },
  { label: "射门", key: "shots", target: "合计 8–20", scope: "total", ok: (v) => v >= 8 && v <= 20, show: (v) => teamTotal(v) },
  { label: "射正", key: "shots_on_target", target: "–", show: (v) => teamText(v) },
  { label: "进球", key: "goals", target: "合计 1–6", scope: "total", ok: (v) => v >= 1 && v <= 6, show: (v) => `主 ${v[0]} – 客 ${v[1]}（共 ${num(v[0]) + num(v[1])}）` },
  { label: "出界次数", key: "out_of_plays", target: "–", show: (v) => String(v) },
  { label: "出界频率(次/比赛分)", key: "out_of_plays_per_game_minute", target: "上限 2；低于 0.5 不凑", scope: "num", ok: (v) => v <= 2, show: (v) => v.toFixed(2) },
  { label: "出界频率(次/真实分)", key: "out_of_plays_per_minute", target: "对照，不验收", show: (v) => v.toFixed(2) },
  { label: "队友最近距离(m)", key: "min_teammate_distance_mean", target: "≥6 m", scope: "num", ok: (v) => v >= 6, show: (v) => v.toFixed(2) },
  { label: "扎堆占比", key: "crowding_ratio", target: "<10%", scope: "num", ok: (v) => v < 0.1, show: (v) => pct(v) },
  { label: "呆立占比", key: "idle_ratio", target: "<5%（不含门将）", scope: "num", ok: (v) => v < 0.05, show: (v) => pct(v) },
  { label: "技能来回(次/人/真实分)", key: "skill_reversals_per_player_minute", target: "<1", scope: "num", ok: (v) => v < 1, show: (v) => v.toFixed(2) },
  { label: "门将出球", key: "keeper_distributions", target: "≥1", scope: "num", ok: (v) => v >= 1, show: (v) => String(v) },
  { label: "门将出球浪费", key: "keeper_wasted_distributions", target: "–", show: (v) => String(v) },
  { label: "双人持球帧", key: "dual_possession_frames", target: "0", scope: "num", ok: (v) => v === 0, show: (v) => String(v) },
  { label: "越界持球帧", key: "carrier_off_pitch_frames", target: "0", scope: "num", ok: (v) => v === 0, show: (v) => String(v) },
  { label: "严重穿模帧", key: "severe_overlap_frames", target: "0", scope: "num", ok: (v) => v === 0, show: (v) => String(v) },
  { label: "最长停表(s)", key: "longest_stoppage_seconds", target: "≤4", scope: "num", ok: (v) => v <= 4, show: (v) => v.toFixed(2) },
  { label: "球最高点(m)", key: "ball_height_max", target: "–", show: (v) => v.toFixed(2) },
  { label: "控球转换", key: "possession_changes", target: "–", show: (v) => String(v) },
  {
    label: "传球(成/试)",
    key: "passes_attempted",
    target: "–",
    show: (v) => {
      const c = state.metrics.passes_completed || [0, 0];
      return `主 ${c[0]}/${v[0]} · 客 ${c[1]}/${v[1]}`;
    },
  },
  { label: "真实时长(s)", key: "duration_seconds", target: "–", show: (v) => v.toFixed(1) },
];

function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function teamText(v, each) {
  if (!Array.isArray(v)) return fmt(v);
  const a = each ? each(v[0]) : String(v[0]);
  const b = each ? each(v[1]) : String(v[1]);
  return `主 ${a} · 客 ${b}`;
}

function teamTotal(v) {
  if (!Array.isArray(v)) return fmt(v);
  return `主 ${v[0]} · 客 ${v[1]}（共 ${num(v[0]) + num(v[1])}）`;
}

function fmt(v) {
  if (Array.isArray(v)) return teamText(v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v);
}

function judge(row, v) {
  if (!row.ok || v == null) return "";
  if (row.scope === "total" && Array.isArray(v)) return row.ok(num(v[0]) + num(v[1])) ? "ok" : "bad";
  if (row.scope === "each" && Array.isArray(v)) return v.every((x) => row.ok(num(x))) ? "ok" : "bad";
  if (typeof v === "number") return row.ok(v) ? "ok" : "bad";
  return "";
}

function buildMetrics() {
  const m = state.metrics;
  const rows = ['<tr><th>指标</th><th class="num">值</th><th class="num">目标(初始)</th></tr>'];
  for (const row of METRIC_ROWS) {
    const v = m[row.key];
    const cls = judge(row, v);
    const text = v == null ? "–" : row.show ? row.show(v) : fmt(v);
    rows.push(
      `<tr><td>${row.label}</td><td class="num ${cls}">${text}</td><td class="num">${row.target}</td></tr>`,
    );
  }
  const notes = [];
  const restarts = Object.entries(m.restarts || {})
    .map(([k, v]) => `${k} ${v}`)
    .join("、");
  if (restarts) notes.push(`<div class="note"><b>重启</b> ${restarts}</div>`);
  const skills = Object.entries(m.skill_frames || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k} ${v}`)
    .join("、");
  if (skills) notes.push(`<div class="note"><b>技能帧</b> ${skills}</div>`);
  el("metrics").innerHTML = rows.join("") + "</table>" + notes.join("");
}

function eventLiHtml(ev, i) {
  const when = clockHeader()
    ? shownClock(ev.time, ev.tick, realOfEvent(ev))
    : `${realOfEvent(ev).toFixed(1)}s`;
  const team =
    ev.team !== null && ev.team !== undefined ? ` (队${ev.team})` : "";
  const detail = ev.detail ? ` · ${ev.detail}` : "";
  return `<li data-i="${i}" data-frame="${indexOfTick(ev.tick)}"><span class="t">${when}</span>${ev.kind}${team}${detail}</li>`;
}

function bindEventLists() {
  if (eventsBound) return;
  eventsBound = true;
  el("events").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    seekToFrame(Number(li.dataset.frame));
  });
  el("event-feed-list").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    seekToFrame(Number(li.dataset.frame));
  });
}

function buildEvents() {
  feedEpoch += 1;
  activeEventLi = null;
  const list = el("events");
  list.innerHTML = state.events.map((ev, i) => eventLiHtml(ev, i)).join("");
  bindEventLists();
  syncEventFeed(realOfFrame(frameAt(state.frame).a), null);
}

function seekToFrame(frameIndex) {
  state.frame = Math.max(0, Math.min(state.frames.length - 1, frameIndex));
  trailCount = 0;
  if (awaitingSecondHalfKickoff) return;
  state.playing = false;
  const play = el("play");
  if (play) play.textContent = "▶";
}

/** Last rendered feed signature so seeks rebuild, idle frames do not. */
let feedSig = "";

/** Rebuild the side feed from events at real time `now` (newest on top). */
function syncEventFeed(now, active) {
  const list = el("event-feed-list");
  if (!list) return;
  const rows = feedEventsUpTo({
    events: state.events,
    now,
    realOfEvent,
    labels: state.eventLabels,
  });
  const activeIndex = active ? state.events.indexOf(active) : -1;
  const newest = rows.length ? rows[0].index : -1;
  const oldest = rows.length ? rows[rows.length - 1].index : -1;
  const sig = `${feedEpoch}|${rows.length}|${newest}|${oldest}`;
  if (sig !== feedSig) {
    feedSig = sig;
    feedActive = activeIndex;
    list.innerHTML = rows
    .map((row) => {
      const teamClass = eventKitClass(row.team, row.player, state.keeperIds);
      const num = row.player != null ? String(row.player) : "–";
      const cls = row.index === activeIndex ? ' class="active"' : "";
      const when = shownClock(row.event.time, row.event.tick, row.time);
      return `<li${cls} data-i="${row.index}" data-frame="${indexOfTick(row.event.tick)}"><span class="t">${when}</span><i class="dot ${teamClass}"></i><span class="num">${num}</span><span class="txt">${row.text}</span></li>`;
    })
    .join("");
    return;
  }
  if (activeIndex === feedActive) return;
  const prev = list.querySelector("li.active");
  if (prev) prev.classList.remove("active");
  if (activeIndex >= 0) {
    const next = list.querySelector(`li[data-i="${activeIndex}"]`);
    if (next) next.classList.add("active");
  }
  feedActive = activeIndex;
}

function indexOfTick(tick) {
  const frames = state.frames;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ------------------------------------------- §4.12 B stats popup / sidecar

/** Same-dir convention only: `seed_N.json` → `seed_N.stats.json`. */
function sidecarPathFromReplay(file) {
  if (/\.stats\.json$/i.test(file)) return file;
  return file.replace(/\.json$/i, ".stats.json");
}

/** Read the body so Chromium marks the request finished. An unread 404 stays pending and `networkidle` never arrives. */
async function discardBody(res) {
  try {
    await res.arrayBuffer();
  } catch {
    // The status is the signal. A short or closed body is not a viewer error.
  }
}

async function loadStatsSidecar(file, replayUrl, cacheMode) {
  const sideFile = sidecarPathFromReplay(file);
  // Same directory as the replay: replace the final path segment's .json.
  const url = replayUrl.replace(/\.json(\?.*)?$/i, ".stats.json$1");
  try {
    const res = await fetch(url, { cache: cacheMode || "default" });
    if (res.status === 404) {
      // Expected when nobody has written the sidecar. Not a viewer error.
      await discardBody(res);
      state.statsSidecar = null;
      state.statsSidecarError = null;
      state.statsMissing = true;
      return;
    }
    if (!res.ok) {
      await discardBody(res);
      state.statsSidecar = null;
      state.statsMissing = false;
      state.statsSidecarError = `无法加载统计 ${sideFile}：${res.status}`;
      return;
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.timeline) || !data.final) {
      state.statsSidecar = null;
      state.statsMissing = false;
      state.statsSidecarError = `统计文件格式无效（需要 timeline[] + final）：${sideFile}`;
      return;
    }
    state.statsSidecar = data;
    state.statsSidecarError = null;
    state.statsMissing = false;
  } catch (err) {
    state.statsSidecar = null;
    state.statsMissing = false;
    state.statsSidecarError = `无法加载统计 ${sideFile}：${err.message}`;
  }
}

/** Match-clock seconds from the current frame (`ReplayFrame.time`). */
function currentMatchTimeS() {
  const frames = state.frames;
  if (!frames.length) return 0;
  const i = Math.max(0, Math.min(frames.length - 1, Math.floor(state.frame)));
  return Number(frames[i].time) || 0;
}

/** Convert match-clock seconds → real seconds (same scale as the scoreboard). */
function matchTimeToReal(matchTimeS) {
  const m = state.metrics || {};
  if (m.game_seconds > 0 && m.duration_seconds > 0) {
    return matchTimeS * (m.duration_seconds / m.game_seconds);
  }
  return matchTimeS;
}

function atFullTime() {
  if (!state.frames.length) return false;
  return Math.floor(state.frame) >= state.frames.length - 1;
}

/** Latest timeline snap with match_time_s ≤ t (no interpolation). */
function pickStatsSnapshot(matchTimeS) {
  const side = state.statsSidecar;
  if (!side || !side.timeline.length) return null;
  let best = side.timeline[0];
  for (const s of side.timeline) {
    if (s.match_time_s <= matchTimeS) best = s;
    else break;
  }
  if (atFullTime() && side.final) {
    return { match_time_s: best.match_time_s, stats: side.final, isFinal: true };
  }
  return { ...best, isFinal: false };
}

/** @param {"pct"|"count"|"xg"|"ppda"|"text"} kind */
function fmtStat(v, kind) {
  if (v === null || v === undefined || v === "n/a") return "n/a";
  if (typeof v === "object" && v !== null && "n_a" in v) return "n/a";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "n/a";
    if (kind === "pct") return v.toFixed(1);
    if (kind === "xg" || kind === "ppda") return v.toFixed(2);
    if (kind === "count") return String(Math.round(v));
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return String(v);
}

function fillStatsTable(stats) {
  const table = el("stats-modal-table");
  if (!stats || !stats.teams) {
    table.innerHTML = "";
    return;
  }
  const h = stats.teams[0] || {};
  const a = stats.teams[1] || {};
  const offsideVal = (t) =>
    t.offsides == null || t.offsides === "n/a"
      ? "n/a"
      : typeof t.offsides === "object"
        ? t.offsides.value ?? t.offsides.n_a ?? "n/a"
        : t.offsides;
  const ppdaVal = (t) =>
    t.ppda == null || t.ppda === "n/a"
      ? "n/a"
      : typeof t.ppda === "object"
        ? t.ppda.value ?? t.ppda.n_a ?? "n/a"
        : t.ppda;
  const rows = [
    ["控球率 %", h.possession_pass_pct, a.possession_pass_pct, "pct"],
    ["进球", h.goals, a.goals, "count"],
    ["射门", h.shots, a.shots, "count"],
    ["射正", h.shots_on_target, a.shots_on_target, "count"],
    ["期望进球", h.xg, a.xg, "xg"],
    [
      "传球 尝试/成功",
      `${h.passes_attempted ?? 0}/${h.passes_completed ?? 0}`,
      `${a.passes_attempted ?? 0}/${a.passes_completed ?? 0}`,
      "text",
    ],
    ["传球完成率 %", h.pass_completion_pct, a.pass_completion_pct, "pct"],
    [
      "本方三区 尝试/成功",
      `${h.own_third_passes_attempted ?? 0}/${h.own_third_passes_completed ?? 0}`,
      `${a.own_third_passes_attempted ?? 0}/${a.own_third_passes_completed ?? 0}`,
      "text",
    ],
    ["长传尝试", h.passes_long, a.passes_long, "count"],
    ["抢断成功", h.tackles_won, a.tackles_won, "count"],
    ["拦截", h.interceptions, a.interceptions, "count"],
    ["球权夺回", h.ball_recoveries, a.ball_recoveries, "count"],
    ["解围", h.clearances, a.clearances, "count"],
    ["扑救", h.saves, a.saves, "count"],
    ["角球", h.corners, a.corners, "count"],
    ["越位", offsideVal(h), offsideVal(a), "count"],
    ["PPDA", ppdaVal(h), ppdaVal(a), "ppda"],
    ["前场三区进入", h.final_third_entries, a.final_third_entries, "count"],
    ["带球进入", h.final_third_carries, a.final_third_carries, "count"],
  ];
  table.innerHTML =
    "<tr><th>指标</th><th class='num'>主</th><th class='num'>客</th></tr>" +
    rows
      .map(
        ([label, hv, av, kind]) =>
          `<tr><td>${label}</td><td class='num'>${fmtStat(hv, kind)}</td><td class='num'>${fmtStat(av, kind)}</td></tr>`,
      )
      .join("");
}

function setStatsModalOpen(open) {
  state.statsModalOpen = !!open;
  const modal = el("stats-modal");
  if (!modal) return;
  modal.classList.toggle("hidden", !state.statsModalOpen);
  modal.setAttribute("aria-hidden", state.statsModalOpen ? "false" : "true");
  el("stats-toggle")?.classList.toggle("active", state.statsModalOpen);
  updateStatsModal();
}

function toggleStatsModal() {
  setStatsModalOpen(!state.statsModalOpen);
}

function updateStatsModal() {
  const msg = el("stats-modal-msg");
  const title = el("stats-modal-title");
  const timeEl = el("stats-modal-time");
  if (!state.statsModalOpen) return;
  if (state.statsMissing || !state.statsSidecar) {
    msg.classList.remove("hidden");
    msg.classList.toggle("quiet", state.statsMissing || !state.statsSidecarError);
    msg.textContent = state.statsSidecarError || STATS_MISSING_LINE;
    el("stats-modal-table").innerHTML = "";
    timeEl.textContent = "";
    title.textContent = "比赛统计";
    return;
  }
  msg.classList.add("hidden");
  msg.classList.remove("quiet");
  const frame = frameAt(state.frame).a;
  const t = currentMatchTimeS();
  const snap = pickStatsSnapshot(t);
  if (!snap) {
    msg.classList.remove("hidden");
    msg.classList.remove("quiet");
    msg.textContent = "时间线为空";
    return;
  }
  title.textContent = snap.isFinal || atFullTime() ? "赛后统计" : "比赛统计";
  const cur = shownClock(frame.time, frame.t, realOfFrame(frame));
  const snapText = shownClock(snap.match_time_s, null, matchTimeToReal(snap.match_time_s));
  timeEl.textContent =
    snap.isFinal || atFullTime() ? `累计 ${cur}` : `累计至 ${snapText}（当前 ${cur}）`;
  fillStatsTable(snap.stats);
}

function maybeAutoOpenStatsAtFullTime() {
  if (state.statsAutoOpened) return;
  if (!atFullTime()) return;
  state.statsAutoOpened = true;
  // No sidecar: leave the modal closed. A 404 is not a viewer error.
  if (!state.statsSidecar) return;
  setStatsModalOpen(true);
}

// ------------------------------------------------------------- controls

let lastInteraction = 0;
let lastEmptyTapAt = 0;

function noteInteraction() {
  lastInteraction = performance.now();
  document.documentElement.classList.remove("chrome-idle");
}

function syncChromeIdle(now) {
  const root = document.documentElement;
  const menuOpen = el("more-menu")?.classList.contains("open");
  const scrubbing = el("scrub-readout") && !el("scrub-readout").classList.contains("hidden");
  if (!barsFloat() || !state.playing || menuOpen || scrubbing) {
    root.classList.remove("chrome-idle");
    return;
  }
  const idleMs = immersiveOn() ? FULLSCREEN_CHROME_IDLE_MS : CONTROLS_IDLE_MS;
  if (now - lastInteraction >= idleMs) root.classList.add("chrome-idle");
}

function applySpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return;
  state.speed = speed;
  const sel = el("speed");
  if (sel && [...sel.options].some((opt) => opt.value === String(speed))) sel.value = String(speed);
  const btn = el("speed-cycle");
  if (btn) btn.textContent = formatSpeed(speed);
}

function showScrubReadout() {
  if (layoutName() === "desktop") return;
  const tip = el("scrub-readout");
  const scrub = el("scrub");
  if (!tip || !scrub) return;
  const max = Number(scrub.max) || 0;
  const val = Number(scrub.value) || 0;
  tip.style.left = `${(max > 0 ? val / max : 0) * 100}%`;
  const frame = frameAt(state.frame).a;
  tip.textContent = shownClock(frame.time, frame.t, realOfFrame(frame));
  tip.classList.remove("hidden");
  tip.setAttribute("aria-hidden", "false");
}

function hideScrubReadout() {
  const tip = el("scrub-readout");
  if (!tip) return;
  tip.classList.add("hidden");
  tip.setAttribute("aria-hidden", "true");
}

function scrubToClientX(clientX) {
  const scrub = el("scrub");
  const rect = scrub.getBoundingClientRect();
  const raw = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const pct = Math.max(0, Math.min(1, raw));
  const max = Number(scrub.max) || 0;
  const frame = Math.round(pct * max);
  state.frame = frame;
  scrub.value = String(frame);
  trailCount = 0;
  updateStatsModal();
  showScrubReadout();
}

function panPixels(dx, dy) {
  const scale = state.fit ? state.fit.units / (state.cam.zoom || 1) : 0.15;
  if (state.fit && state.fit.portrait) {
    state.cam.z -= dx * scale;
    state.cam.x += dy * scale;
  } else {
    state.cam.x -= dx * scale;
    state.cam.z -= dy * scale;
  }
}

function clampZoom(zoom) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

function syncFeedSheet() {
  const sheet = Boolean(el("event-feed")?.classList.contains("open") && layoutName() !== "desktop");
  document.documentElement.classList.toggle("event-feed-open", sheet);
  const backdrop = el("event-feed-backdrop");
  if (backdrop) backdrop.hidden = !sheet;
}

function setFeedOpen(open) {
  const on = Boolean(open);
  el("event-feed")?.classList.toggle("open", on);
  el("feed-toggle")?.setAttribute("aria-expanded", on ? "true" : "false");
  syncFeedSheet();
  noteInteraction();
}

function setMoreOpen(open) {
  el("more-menu")?.classList.toggle("open", open);
  el("more-toggle")?.setAttribute("aria-expanded", open ? "true" : "false");
  noteInteraction();
}

function finishTap(x, y) {
  const id = pickPlayerAt(x, y);
  const now = performance.now();
  const phone = layoutName() !== "desktop";
  if (phone && id == null && now - lastEmptyTapAt <= DOUBLE_TAP_MS) {
    reframe();
    lastEmptyTapAt = 0;
    noteInteraction();
    return;
  }
  state.selectedId = id;
  lastEmptyTapAt = phone && id == null ? now : 0;
  noteInteraction();
}

function wireControls() {
  let fitting = false;
  const fullscreenCtl = createFullscreen(document, el(FULLSCREEN_ROOT_ID), {
    button: el(FULLSCREEN_BUTTON_ID),
    win: window,
    isDesktop: () => layoutName() === "desktop",
    onChange: () => {
      if (fitting) return;
      fitting = true;
      noteInteraction();
      onResize();
      fitting = false;
    },
  });
  fullscreenCtl.bind();

  el("play").addEventListener("click", togglePlay);
  const kickoffBtn = el("kickoff");
  if (kickoffBtn && kickoffBtn.dataset.bound !== "1") {
    kickoffBtn.dataset.bound = "1";
    kickoffBtn.addEventListener("click", onKickoffPressed);
  }
  const muteBtn = el("mute");
  if (muteBtn && muteBtn.dataset.bound !== "1") {
    muteBtn.dataset.bound = "1";
    muteBtn.addEventListener("click", () => {
      matchAudio.unlock();
      matchAudio.toggleMuted();
      syncMuteButton();
      noteInteraction();
    });
  }
  el("scrub").addEventListener("input", (e) => {
    state.frame = Number(e.target.value);
    trailCount = 0;
    updateStatsModal();
    if (layoutName() !== "desktop") showScrubReadout();
  });
  el("speed").addEventListener("change", (e) => {
    applySpeed(e.target.value);
  });
  el("speed-cycle")?.addEventListener("click", () => {
    applySpeed(nextSpeed(state.speed));
    noteInteraction();
  });
  el("more-toggle")?.addEventListener("click", () => {
    setMoreOpen(!el("more-menu").classList.contains("open"));
  });
  el("feed-toggle")?.addEventListener("click", () => {
    const open = !el("event-feed").classList.contains("open");
    setFeedOpen(open);
    if (open) setMoreOpen(false);
  });
  el("event-feed-close")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setFeedOpen(false);
  });
  el("event-feed-backdrop")?.addEventListener("click", () => setFeedOpen(false));
  el("feed-head")?.addEventListener("click", () => {
    if (layoutName() === "desktop") return;
    setFeedOpen(!el("event-feed").classList.contains("open"));
  });
  let scrubbing = false;
  const scrubWrap = el("scrub-wrap");
  scrubWrap?.addEventListener("pointerdown", (e) => {
    if (layoutName() === "desktop") return;
    scrubbing = true;
    noteInteraction();
    scrubToClientX(e.clientX);
    try {
      scrubWrap.setPointerCapture(e.pointerId);
    } catch {
      // Desktop uses display:contents; the listener returns before capture.
    }
  });
  scrubWrap?.addEventListener("pointermove", (e) => {
    if (!scrubbing) return;
    scrubToClientX(e.clientX);
  });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    hideScrubReadout();
  };
  scrubWrap?.addEventListener("pointerup", endScrub);
  scrubWrap?.addEventListener("pointercancel", endScrub);
  el("controls")?.addEventListener("pointerdown", noteInteraction);
  el("view").addEventListener("change", (e) => setView(e.target.value));
  el("labels-on").addEventListener("change", (e) => {
    state.labels = e.target.checked;
  });
  el("pitch-events-on").addEventListener("change", (e) => {
    state.pitchEvents = e.target.checked;
  });
  el("pitch-decisions-on").addEventListener("change", (e) => {
    state.pitchDecisions = e.target.checked;
  });
  el("markers-on").addEventListener("change", (e) => {
    state.markers = e.target.checked;
    syncMarkers();
  });
  el("trail-on").addEventListener("change", (e) => {
    state.trail = e.target.checked;
    trailCount = 0;
  });
  el("prev").addEventListener("click", () => step(-1));
  el("next").addEventListener("click", () => step(1));
  el("panel-toggle").addEventListener("click", () => {
    const body = document.querySelector(".panel-body");
    body.classList.toggle("hidden");
    reframe();
  });
  el("stats-toggle")?.addEventListener("click", toggleStatsModal);
  el("stats-modal-close")?.addEventListener("click", () => setStatsModalOpen(false));
  el("stats-modal-backdrop")?.addEventListener("click", () => setStatsModalOpen(false));

  window.addEventListener("keydown", (e) => {
    noteInteraction();
    if (e.code === "Escape") {
      if (state.statsModalOpen) {
        setStatsModalOpen(false);
        return;
      }
      if (layoutName() !== "desktop" && el("event-feed")?.classList.contains("open")) {
        setFeedOpen(false);
        return;
      }
      if (document.documentElement.classList.contains("tactics-open")) return;
      if (fullscreenCtl.onEscape(e)) {
        e.preventDefault();
        return;
      }
    }
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.code === "ArrowLeft") step(-1);
    else if (e.code === "ArrowRight") step(1);
    else if (e.code === "KeyS" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      toggleStatsModal();
    }
  });

  // Desktop: one-finger drag pans, wheel zooms, a small click selects.
  // Phone: one finger taps (player label, or empty grass to show the bar /
  // a second tap restores the frame). Two fingers pinch-zoom and pan.
  const canvas = renderer.domElement;
  const pointers = new Map();
  let touchOwns = false;
  let pinch = null;
  let downAt = null;
  let dragLast = null;
  let moved = false;

  function pinchFromPointers() {
    const pts = [...pointers.values()];
    return {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      zoom: state.cam.zoom || 1,
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
    };
  }

  function movePinch() {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const cx = (pts[0].x + pts[1].x) / 2;
    const cy = (pts[0].y + pts[1].y) / 2;
    state.cam.zoom = clampZoom(pinch.zoom * (dist / pinch.dist));
    panPixels(cx - pinch.cx, cy - pinch.cy);
    pinch.cx = cx;
    pinch.cy = cy;
    moved = true;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || touchOwns) return;
    noteInteraction();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // The canvas can reject capture if it is not in the tree yet.
    }
    if (pointers.size === 1) {
      downAt = { x: e.clientX, y: e.clientY };
      dragLast = { x: e.clientX, y: e.clientY };
      moved = false;
      pinch = null;
    } else if (pointers.size >= 2) {
      pinch = pinchFromPointers();
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" || touchOwns) return;
    if (!pointers.has(e.pointerId)) {
      state.hoverId = pickPlayer(e);
      return;
    }
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && pinch) {
      movePinch();
      return;
    }
    if (!downAt || !dragLast) return;
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) >= TAP_SLOP_PX) moved = true;
    // An anchor drag owns the primary pointer. Panning stays on the pitch,
    // outside the board, and on the existing two-finger gesture.
    if (layoutName() === "desktop" && prev && !tacticsCtl?.isDragging()) {
      panPixels(e.clientX - dragLast.x, e.clientY - dragLast.y);
    }
    dragLast = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch" || touchOwns) return;
    const wasDown = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (wasDown && pointers.size === 0 && downAt && !moved) finishTap(e.clientX, e.clientY);
    if (pointers.size === 0) {
      downAt = null;
      dragLast = null;
      pinch = null;
      moved = false;
    } else if (pointers.size === 1) {
      const pt = [...pointers.values()][0];
      dragLast = { ...pt };
      pinch = null;
      moved = true;
    }
  });
  canvas.addEventListener("pointercancel", (e) => {
    pointers.delete(e.pointerId);
  });

  const syncTouches = (list) => {
    pointers.clear();
    for (const t of list) pointers.set(t.identifier, { x: t.clientX, y: t.clientY });
  };
  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      touchOwns = true;
      noteInteraction();
      syncTouches(e.touches);
      if (e.touches.length === 1) {
        downAt = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        moved = false;
        pinch = null;
      } else if (e.touches.length >= 2) {
        pinch = pinchFromPointers();
      }
    },
    { passive: false },
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      syncTouches(e.touches);
      if (e.touches.length >= 2 && pinch) {
        movePinch();
        return;
      }
      if (e.touches.length === 1 && downAt) {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - downAt.x, t.clientY - downAt.y) >= TAP_SLOP_PX) moved = true;
      }
    },
    { passive: false },
  );
  canvas.addEventListener(
    "touchend",
    (e) => {
      if (e.touches.length === 0 && downAt && !moved) {
        const t = e.changedTouches[0];
        if (t) finishTap(t.clientX, t.clientY);
      }
      syncTouches(e.touches);
      if (e.touches.length === 0) {
        touchOwns = false;
        downAt = null;
        pinch = null;
        moved = false;
      } else if (e.touches.length >= 2) {
        pinch = pinchFromPointers();
      } else {
        pinch = null;
        moved = true;
      }
    },
    { passive: false },
  );
  canvas.addEventListener("touchcancel", () => {
    touchOwns = false;
    pointers.clear();
    downAt = null;
    pinch = null;
    moved = false;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? WHEEL_ZOOM_OUT : WHEEL_ZOOM_IN;
    state.cam.zoom = clampZoom((state.cam.zoom || 1) * factor);
  });

  window.addEventListener("resize", onResize);
}

function floorTickAt(index) {
  if (!state.frames.length || !state.header) return null;
  const tick = Number(frameAt(index).a.t);
  return Number.isFinite(tick) ? tick : null;
}

function currentHalfTick() {
  const ht = findHalfTime(state.events);
  return ht ? ht.tick : null;
}

function startJiggle(id) {
  jiggles.set(id, { t0: performance.now(), speed: state.speed });
}

function jiggleNow(id) {
  const row = jiggles.get(id);
  if (!row) return 1;
  const elapsed = performance.now() - row.t0;
  const factor = jiggleFactor(elapsed, row.speed);
  if (elapsed >= jiggleDurationMs(row.speed)) jiggles.delete(id);
  return factor;
}

/** Forward contacts since the previous floor tick. Sound only while this step is playback. */
function noteCueCross(prev, next, playing) {
  for (const ev of kickContactsCrossing(state.events, prev, next)) {
    startJiggle(ev.player);
    if (playing) matchAudio.playContact(ev.kind);
  }
}

function syncMuteButton() {
  const btn = el("mute");
  if (!btn) return;
  const muted = matchAudio.muted;
  btn.textContent = muted ? "🔇" : "🔊";
  btn.setAttribute("aria-pressed", muted ? "true" : "false");
  btn.setAttribute("aria-label", "声音");
}

function beginSecondHalfKickoff() {
  if (awaitingSecondHalfKickoff) return;
  awaitingSecondHalfKickoff = true;
  state.playing = false;
  const play = el("play");
  if (play) play.textContent = "▶";
  setShown(play, false);
  setShown(el("kickoff"), true);
  noteInteraction();
}

/** @param {boolean} resume true: hide 开球, show ⏸, keep playing */
function endSecondHalfKickoff(resume) {
  awaitingSecondHalfKickoff = false;
  const play = el("play");
  setShown(el("kickoff"), false);
  setShown(play, true);
  state.playing = !!resume;
  if (play) play.textContent = resume ? "⏸" : "▶";
}

function onKickoffPressed() {
  matchAudio.unlock();
  noteInteraction();
  if (awaitingSecondHalfKickoff) {
    endSecondHalfKickoff(true);
    return;
  }
  if (newMatch && newMatch.phase === "preMatch") newMatch.kickoff();
}

function togglePlay() {
  matchAudio.unlock();
  if (awaitingSecondHalfKickoff) {
    endSecondHalfKickoff(true);
    noteInteraction();
    return;
  }
  if (newMatch && newMatch.phase === "preMatch") {
    newMatch.kickoff();
    noteInteraction();
    return;
  }
  if (document.documentElement.dataset.newMatch === "fullTime") return;
  state.playing = !state.playing;
  el("play").textContent = state.playing ? "⏸" : "▶";
  noteInteraction();
}

function step(delta) {
  if (!awaitingSecondHalfKickoff) {
    state.playing = false;
    const play = el("play");
    if (play) play.textContent = "▶";
  }
  state.frame = Math.max(0, Math.min(state.frames.length - 1, Math.round(state.frame) + delta));
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pickPlayer(e) {
  return pickPlayerAt(e.clientX, e.clientY);
}

function pickPlayerAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, viewCamera);
  const roots = playerMeshes.filter(Boolean).map((m) => m.group);
  const hit = raycaster.intersectObjects(roots, true)[0];
  if (!hit) return null;
  let obj = hit.object;
  while (obj) {
    if (obj.userData && obj.userData.playerId !== undefined) return obj.userData.playerId;
    obj = obj.parent;
  }
  return null;
}

function onResize() {
  applyDocumentLayout(window);
  syncFeedSheet();
  const { width: w, height: h } = viewPixels();
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (state.header) reframe();
}

let lastTime = 0;

function loop(now) {
  const dt = lastTime ? (now - lastTime) / 1000 : 0;
  lastTime = now;
  const header = state.header;
  if (!header) {
    requestAnimationFrame(loop);
    return;
  }
  const framesPerSecond = header.tick_hz / (header.frame_interval || 1);
  const liveHold = document.documentElement.dataset.newMatch === "live";
  const arrived = floorTickAt(state.frame);
  if (lastFloorTick != null && arrived != null && arrived !== lastFloorTick) {
    // Seek / scrub / step. Jiggle only; sound stays on the playback step below.
    noteCueCross(lastFloorTick, arrived, false);
  }
  if (state.playing && !awaitingSecondHalfKickoff) {
    const prevFloor = floorTickAt(state.frame);
    state.frame += dt * framesPerSecond * state.speed;
    const max = state.frames.length - 1;
    let hitEnd = false;
    if (state.frame >= max) {
      state.frame = max;
      hitEnd = !liveHold;
    }
    const nextFloor = floorTickAt(state.frame);
    if (
      shouldPauseForHalf({
        autoplay: true,
        prevTick: prevFloor,
        nextTick: nextFloor,
        halfTick: currentHalfTick(),
        awaiting: awaitingSecondHalfKickoff,
      })
    ) {
      state.frame = indexOfTick(currentHalfTick());
      beginSecondHalfKickoff();
    } else if (hitEnd) {
      state.playing = false;
      const play = el("play");
      if (play) play.textContent = "▶";
      maybeAutoOpenStatsAtFullTime();
    }
    noteCueCross(prevFloor, floorTickAt(state.frame), true);
  }
  lastFloorTick = floorTickAt(state.frame);
  if (newMatch && newMatch.phase === "live" && state.playing && !awaitingSecondHalfKickoff && state.frames.length) {
    const { a, b, t } = frameAt(state.frame);
    newMatch
      .pump({
        playing: true,
        awaitingSecondHalfKickoff: false,
        speed: state.speed,
        wallSeconds: dt,
        playheadTick: a.t + (b.t - a.t) * t,
        bufferedTick: state.frames[state.frames.length - 1].t,
        physicsHz: header.tick_hz,
        frameInterval: header.frame_interval || 2,
      })
      .catch((err) => {
        showNewMatchError({ code: "Internal", message: err.message || "步进失败" });
      });
  }
  syncChromeIdle(now);
  placeCamera();
  applyFrame();
  if (state.statsModalOpen) updateStatsModal();
  maybeAutoOpenStatsAtFullTime();
  renderer.render(scene, viewCamera);
  requestAnimationFrame(loop);
}

tacticsCtl = mountTactics(document, {
  sessionMode: "history",
  onInteract() {
    noteInteraction();
  },
  onFormationChange(snapshot) {
    if (!newMatch) return;
    newMatch.onFormation(snapshot).catch((err) => {
      showNewMatchError({ code: "Internal", message: err.message || "阵型没有送进比赛" });
    });
  },
});
window.getSessionFormation = () => tacticsCtl.getSessionFormation();
window.setSessionFormation = (table) => tacticsCtl.setSessionFormation(table);
window.getSessionMode = () => tacticsCtl.getSessionMode();
window.setSessionMode = (mode) => tacticsCtl.setSessionMode(mode);
window.setJerseyNumbers = (numbers) => tacticsCtl.setJerseyNumbers(numbers);

let newMatchChromeBound = false;

function bindNewMatchChrome() {
  if (newMatchChromeBound) return;
  newMatchChromeBound = true;
  el("new-match-again")?.addEventListener("click", () => {
    onNewMatchAgain();
  });
  el("new-match-back")?.addEventListener("click", () => {
    onNewMatchBack();
  });
}

function hideNewMatchOverlay() {
  const overlay = el("new-match-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

function hideNewMatchHint() {
  clearTimeout(newMatchHintTimer);
  el("new-match-hint")?.classList.add("hidden");
}

function showNewMatchHint(text) {
  const node = el("new-match-hint");
  if (!node) return;
  node.textContent = text;
  node.classList.remove("hidden");
  clearTimeout(newMatchHintTimer);
  newMatchHintTimer = setTimeout(() => node.classList.add("hidden"), 4000);
}

function showNewMatchOverlay({ title, score, message, again }) {
  const overlay = el("new-match-overlay");
  if (!overlay) return;
  el("new-match-title").textContent = title;
  el("new-match-score").textContent = score || "";
  const msg = el("new-match-message");
  if (message) {
    msg.textContent = message;
    msg.classList.remove("hidden");
  } else {
    msg.textContent = "";
    msg.classList.add("hidden");
  }
  const againBtn = el("new-match-again");
  if (againBtn) againBtn.hidden = !again;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}

function showNewMatchError(error) {
  document.documentElement.dataset.newMatch = "error";
  const code = error && error.code ? `（${error.code}）` : "";
  showNewMatchOverlay({
    title: "这场没能开始",
    score: "",
    message: `${(error && error.message) || "引擎没有接受这场比赛"}${code}`,
    again: false,
  });
}

function showFullTimeOverlay(score) {
  const home = Array.isArray(score) ? Number(score[0]) || 0 : 0;
  const away = Array.isArray(score) ? Number(score[1]) || 0 : 0;
  showNewMatchOverlay({
    title: "全场结束",
    score: `主 ${home} – ${away} 客`,
    message: "",
    again: true,
  });
}

function setShown(node, shown) {
  if (!node) return;
  node.hidden = !shown;
  node.classList.toggle("hidden", !shown);
}

function enterPreMatch() {
  const play = el("play");
  if (play) play.textContent = "▶";
  setShown(play, false);
  state.playing = false;
  setShown(el("kickoff"), true);
  document.documentElement.dataset.newMatch = "preMatch";
  tacticsCtl.setOpen(true);
}

function resetLiveDerived() {
  decisionCursor = null;
  statFrames = null;
  statFrameCount = 0;
}

function statFramesCovering() {
  if (!statFrames || statFrameCount > state.frames.length) {
    statFrames = [];
    statFrameCount = 0;
  }
  if (statFrameCount < state.frames.length) {
    statFrames.push(
      ...viewerFramesAsStat(state.frames.slice(statFrameCount), state.col, state.bcol),
    );
    statFrameCount = state.frames.length;
  }
  return statFrames;
}

function extendDecisionBirths(fromFrame) {
  const header = state.header;
  if (!header) return;
  if (!decisionCursor) decisionCursor = new Map();
  collectDecisionBirths({
    frames: state.frames,
    col: state.col,
    skillNames: header.skill_names || [],
    intentNames: header.intent_names || [],
    realOfFrame,
    fromFrame,
    prev: decisionCursor,
    into: state.decisionBirths,
  });
}

function labelsPrefixSame(prev, next) {
  if (!prev || prev.length > next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== next[i]) return false;
  }
  return true;
}

function appendEventItems(from) {
  const list = el("events");
  if (!list || from >= state.events.length) return;
  bindEventLists();
  const html = [];
  for (let i = from; i < state.events.length; i++) html.push(eventLiHtml(state.events[i], i));
  list.insertAdjacentHTML("beforeend", html.join(""));
}

function extendEventLabels(previousCount) {
  const prev = state.eventLabels;
  const labels = classifyPitchEvents({
    events: state.events,
    frames: state.frames,
    col: state.col,
    bcol: state.bcol,
    statFrames: statFramesCovering(),
  });
  state.eventLabels = labels;
  if (!labelsPrefixSame(prev, labels)) {
    buildEvents();
    return;
  }
  appendEventItems(previousCount);
}

function refreshDerived() {
  const header = state.header;
  if (!header) return;
  resetLiveDerived();
  decisionCursor = new Map();
  state.decisionBirths = [];
  collectDecisionBirths({
    frames: state.frames,
    col: state.col,
    skillNames: header.skill_names || [],
    intentNames: header.intent_names || [],
    realOfFrame,
    prev: decisionCursor,
    into: state.decisionBirths,
  });
  state.eventLabels = classifyPitchEvents({
    events: state.events,
    frames: state.frames,
    col: state.col,
    bcol: state.bcol,
  });
  buildEvents();
}

function appendEngineOutput(result) {
  if (!result) return;
  const sealed = Array.isArray(result.sealedEvents);
  const eventStart = sealed ? 0 : state.events.length;
  if (sealed) state.events = result.sealedEvents.slice();
  else if (result.events && result.events.length) state.events.push(...result.events);
  const frameStart = state.frames.length;
  if (result.frames && result.frames.length) {
    state.frames.push(...result.frames);
    const scrub = el("scrub");
    if (scrub) scrub.max = String(state.frames.length - 1);
  }
  // Sealed interceptions rewrite earlier events. The first step also builds
  // the cursor. Later steps only extend it.
  if (sealed || !decisionCursor) {
    refreshDerived();
    return;
  }
  if (state.frames.length > frameStart) extendDecisionBirths(frameStart);
  if (state.events.length > eventStart || state.frames.length > frameStart) {
    extendEventLabels(eventStart);
  }
}

function resetToCreated(result) {
  state.header = result.header;
  state.replay = { header: result.header, frames: [result.frame], events: [], metrics: {} };
  window.__replay = state.replay;
  state.frames = state.replay.frames;
  state.events = [];
  state.metrics = {};
  state.frame = 0;
  state.playing = false;
  awaitingSecondHalfKickoff = false;
  lastFloorTick = null;
  jiggles.clear();
  trailCount = 0;
  const scrub = el("scrub");
  if (scrub) {
    scrub.max = "0";
    scrub.value = "0";
  }
  el("play").textContent = "▶";
  el("seed").textContent = result.header.seed ?? "–";
  hideNewMatchOverlay();
  hideNewMatchHint();
  refreshDerived();
  enterPreMatch();
}

function onNewMatchEvent(ev) {
  if (ev.type === "created") {
    if (state.header) resetToCreated(ev.result);
    return;
  }
  if (ev.type === "formation") {
    window.__lastFormation = ev.result;
    if (ev.result.applied === "kickoff" && ev.result.frame && state.frames.length) {
      state.frames[0] = ev.result.frame;
      trailCount = 0;
      // The kickoff frame changed. The next step rebuilds labels from it.
      resetLiveDerived();
    }
    if (ev.result.applied === "next-decision") showNewMatchHint("改动从下一次决策刷新起生效");
    return;
  }
  if (ev.type === "step") {
    appendEngineOutput(ev.result);
    return;
  }
  if (ev.type === "fullTime") {
    appendEngineOutput(ev.result);
    state.playing = false;
    // The playhead sits ~BUFFER_AHEAD_S behind the last step. Show the whistle.
    if (state.frames.length) state.frame = state.frames.length - 1;
    el("play").textContent = "▶";
    document.documentElement.dataset.newMatch = "fullTime";
    showFullTimeOverlay(ev.result.status && ev.result.status.score);
    return;
  }
  if (ev.type === "kickoff") {
    tacticsCtl.setOpen(false);
    state.playing = true;
    const play = el("play");
    if (play) play.textContent = "⏸";
    setShown(el("kickoff"), false);
    document.documentElement.dataset.newMatch = "live";
    setShown(play, true);
    return;
  }
  if (ev.type === "error") showNewMatchError(ev.error);
}

async function onNewMatchAgain() {
  if (!newMatch) return;
  const button = el("new-match-again");
  if (button) button.disabled = true;
  try {
    const result = await newMatch.again(tacticsCtl.getSessionFormation(), randomMatchSeed());
    if (!result || result.ok === false) showNewMatchError(result || { message: "没能再开一局" });
  } catch (err) {
    showNewMatchError({ code: "Internal", message: err.message || "没能再开一局" });
  } finally {
    if (button) button.disabled = false;
  }
}

async function onNewMatchBack() {
  if (newMatch) {
    try {
      await newMatch.back();
    } catch {
      // Leaving the page anyway.
    }
  }
  location.assign(matchListHref(location.href));
}

function bindMatchList() {
  const button = el("match-list");
  if (!button || button.dataset.bound === "1") return;
  button.dataset.bound = "1";
  button.addEventListener("click", () => {
    matchAudio.unlock();
    onNewMatchBack();
  });
}

function matchSeedFromQuery(params) {
  const raw = params.get("seed");
  if (raw == null || raw === "") return randomMatchSeed();
  if (/^\d+$/.test(raw) && raw.length <= 15) return Number(raw);
  return raw;
}

async function loadNewMatch(params) {
  bindNewMatchChrome();
  el("file-name").textContent = "开新局";
  tacticsCtl.setSessionMode("newMatch");
  const node = el("load-progress");
  if (node) {
    node.textContent = "正在开局…";
    node.classList.remove("hidden");
  }
  try {
    const client = createEngineClient();
    newMatch = createNewMatchSession(client, { onEvent: onNewMatchEvent });
    const created = await newMatch.open({
      seed: matchSeedFromQuery(params),
      formation: tacticsCtl.getSessionFormation(),
    });
    if (!created || created.ok === false) {
      hideLoadProgress();
      showNewMatchError(created || { message: "开局失败" });
      return;
    }
    await presentReplay(
      { header: created.header, frames: [created.frame], events: [], metrics: {} },
      "开新局",
      location.href,
      "default",
      params,
      { stats: false },
    );
    enterPreMatch();
  } catch (err) {
    hideLoadProgress();
    showNewMatchError({ code: "Internal", message: err.message || "开局失败" });
  }
}

bindMatchList();
load();
