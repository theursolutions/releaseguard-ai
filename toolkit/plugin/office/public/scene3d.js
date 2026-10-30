// The 3D office. Loaded on demand by office.js, so Three.js never delays the first render of the page.
// Everything is built from primitives; repeated furniture is instanced to keep draw calls low.
import * as THREE from './vendor/three.module.min.js';
import { LOUNGE_CREW, baseType, colorFor, hashString, roleLabel, stageFor, withPerson } from './crew.js';

// ---------------------------------------------------------------------------------------------
// Floor plan. Two rows of three rooms around a corridor (a U in pipeline order), the entrance at
// the west end of the corridor and the "Done" lounge at the east end.
// ---------------------------------------------------------------------------------------------

const ROOM_W = 8;
const ROOM_D = 7.5;
const CORR = 2.5; // half the corridor width
const LAYOUT = { triage: [0, 0], plan: [1, 0], build: [2, 0], qa: [2, 1], regression: [1, 1], review: [0, 1] };
const ROOM_AT = [
  ['triage', 'plan', 'build'],
  ['review', 'regression', 'qa'],
];
const ROOM_IDS = Object.keys(LAYOUT);
const AISLE_U = { triage: -0.9 };
const DESK_ROWS = { triage: [4.8], plan: [2.3, 4.5], build: [1.9, 3.9, 5.9], qa: [2.2, 4.4], regression: [2.0, 4.0], review: [2.2, 4.4] };
const ROOM_INK = { triage: '#b4470f', plan: '#6d28d9', build: '#1d4ed8', qa: '#15803d', regression: '#b91c1c', review: '#8a5a00', lounge: '#be185d' };

const DOOR_OUTSIDE = new THREE.Vector3(-13.6, 0, 0.4);
const DOOR_INSIDE = new THREE.Vector3(-11.4, 0, 0.4);
const LOUNGE_ENTRY = new THREE.Vector3(13.3, 0, 0);
const OFFICE_CENTER = new THREE.Vector3(3.2, 0, 0.6);

const WALK_SPEED = 5.2;
const FADE_AFTER_MS = 60000;
const FADE_MS = 2500;
const SIT_LIFT = 0.12;

const WIDE_VIEW = { theta: 0.55, phi: 0.92 };
// On portrait screens the camera looks along the office's long axis so it fills the height.
const TALL_VIEW = { theta: 1.42, phi: 0.72 };
const FIT_BOX = { min: new THREE.Vector3(-13.6, 0, -10.3), max: new THREE.Vector3(20.3, 3.2, 10.3) };
const LIMITS = { phiMin: 0.42, phiMax: 1.25, thetaMin: -1.35, thetaMax: 1.75, zoomMin: 0.38, zoomMax: 1.45 };

const THEMES = {
  light: {
    backdrop: ['#f2f3f5', '#d8dce2'],
    pool: '#c2c8d0',
    hemiSky: '#eef3ff',
    hemiGround: '#b59f86',
    hemi: 0.55,
    sun: '#fff0d8',
    sunI: 2.7,
    env: 0.85,
    exposure: 1.0,
    lamps: false,
    glow: '#fff6e8',
    glowI: 0.35,
    screenOff: '#1d2431',
    arc: '#f08a00',
  },
  dark: {
    backdrop: ['#121b2c', '#070b13'],
    pool: '#03060b',
    hemiSky: '#4a5a86',
    hemiGround: '#1a140f',
    hemi: 0.3,
    sun: '#a9b8ff',
    sunI: 0.4,
    env: 0.18,
    exposure: 1.05,
    lamps: true,
    glow: '#ffd9a6',
    glowI: 2.6,
    screenOff: '#121826',
    arc: '#ffd166',
  },
};

const roomFrame = (id) => {
  const [col, row] = LAYOUT[id] || LAYOUT.build;
  return { cx: (col - 1) * ROOM_W, dir: row === 0 ? -1 : 1 };
};
const place = (id, u, v, y = 0) => {
  const { cx, dir } = roomFrame(id);
  return new THREE.Vector3(cx + u, y, dir * (CORR + v));
};
const aisleU = (id) => AISLE_U[id] ?? 0;
const facingCorridor = (id) => (roomFrame(id).dir < 0 ? 0 : Math.PI);
const depthIn = (pos) => THREE.MathUtils.clamp(Math.abs(pos.z) - CORR, 0.15, ROOM_D - 0.4);

function regionAt(pos) {
  if (pos.x < -12.05) return 'outside';
  if (pos.x > 12.05) return 'lounge';
  if (Math.abs(pos.z) < CORR) return 'corridor';
  const col = pos.x < -4 ? 0 : pos.x < 4 ? 1 : 2;
  return ROOM_AT[pos.z < 0 ? 0 : 1][col];
}

/** Collects repeated static parts and turns each material group into one InstancedMesh. */
class Batch {
  constructor() {
    this.groups = new Map();
    this.matrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.euler = new THREE.Euler();
  }

  // Shadow flags come from the first part added under a key.
  add(key, geometry, material, position, scale, { rotY = 0, rotX = 0, rotZ = 0, color = null, cast = true, receive = true } = {}) {
    let group = this.groups.get(key);
    if (!group) {
      group = { geometry, material, matrices: [], colors: [], cast, receive };
      this.groups.set(key, group);
    }
    this.quaternion.setFromEuler(this.euler.set(rotX, rotY, rotZ, 'YXZ'));
    group.matrices.push(new THREE.Matrix4().compose(position, this.quaternion, scale));
    group.colors.push(color);
    return group.matrices.length - 1;
  }

  build(parent) {
    const meshes = new Map();
    const color = new THREE.Color();
    for (const [key, group] of this.groups) {
      const mesh = new THREE.InstancedMesh(group.geometry, group.material, group.matrices.length);
      group.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      if (group.colors.some(Boolean)) group.colors.forEach((value, index) => mesh.setColorAt(index, color.set(value || '#ffffff')));
      mesh.castShadow = group.cast;
      mesh.receiveShadow = group.receive;
      mesh.frustumCulled = false;
      parent.add(mesh);
      meshes.set(key, mesh);
    }
    return meshes;
  }
}

const S = (x, y, z) => new THREE.Vector3(x, y, z);
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------------------
// Procedural textures. The page's CSP allows no external images, so every surface is painted here.
// ---------------------------------------------------------------------------------------------

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

/** Small deterministic random generator, so the textures look the same on every load. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(width, height, draw, { wrapS = true, wrapT = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (wrapS) texture.wrapS = THREE.RepeatWrapping;
  if (wrapT) texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const hsl = (h, s, l) => `hsl(${h}, ${s}%, ${l}%)`;

function speckle(ctx, w, h, rand, count, alpha, size = 1.5) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${alpha * rand()})` : `rgba(255,255,255,${alpha * rand()})`;
    ctx.fillRect(rand() * w, rand() * h, size, size);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function woodPlank(ctx, x, y, len, height, seed) {
  const rand = seeded(seed);
  ctx.fillStyle = hsl(30 + rand() * 6, 30 + rand() * 10, 63 + rand() * 9);
  ctx.fillRect(x, y, len, height);
  for (let g = 0; g < 16; g++) {
    const gy = y + rand() * height;
    const amp = rand() * 2.5;
    const freq = 0.01 + rand() * 0.02;
    const phase = rand() * 6;
    ctx.strokeStyle = `rgba(110, 72, 38, ${0.04 + rand() * 0.09})`;
    ctx.lineWidth = 0.6 + rand() * 1.3;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    for (let t = 0; t <= len; t += 12) ctx.lineTo(x + t, gy + Math.sin(t * freq + phase) * amp);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(70, 45, 22, 0.45)';
  ctx.fillRect(x, y, 1.5, height);
  ctx.fillRect(x, y, len, 1.5);
}

/** Light oak planks; each row's planks wrap around so the texture tiles. */
function drawPlanks(ctx, w, h, rand) {
  const rows = 8;
  const ph = h / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * ph;
    const start = rand() * w;
    const breaks = [];
    for (let x = start; x < start + w - 120; x += 170 + rand() * 230) breaks.push(x);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, w, ph);
    ctx.clip();
    breaks.forEach((bx, i) => {
      const end = i + 1 < breaks.length ? breaks[i + 1] : start + w;
      const seed = Math.floor(rand() * 1e9);
      for (const shift of [0, -w]) woodPlank(ctx, bx + shift, y, end - bx, ph, seed);
    });
    ctx.restore();
  }
}

/** Grey carpet tiles laid in alternating pile direction. */
function drawCarpet(ctx, w, h, rand) {
  const n = 4;
  const s = w / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * s;
      const y = j * s;
      ctx.fillStyle = hsl(30, 3, 58 + (rand() - 0.5) * 5);
      ctx.fillRect(x, y, s, s);
      const across = (i + j) % 2 === 0;
      for (let k = 0; k < s; k += 3) {
        ctx.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.06})`;
        if (across) ctx.fillRect(x, y + k, s, 1.2);
        else ctx.fillRect(x + k, y, 1.2, s);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, s - 1.5, s - 1.5);
    }
  }
  speckle(ctx, w, h, rand, 9000, 0.16, 1.4);
}

/** Polished concrete with soft mottling and a saw-cut joint. */
function drawConcrete(ctx, w, h, rand) {
  ctx.fillStyle = '#c9c8c4';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 80; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 30 + rand() * 110;
    const tone = rand() < 0.5 ? '0,0,0' : '255,255,255';
    const a = 0.025 + rand() * 0.045;
    for (const dx of [-w, 0, w]) {
      for (const dy of [-h, 0, h]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, `rgba(${tone},${a})`);
        g.addColorStop(1, `rgba(${tone},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  speckle(ctx, w, h, rand, 7000, 0.12, 1.3);
  ctx.fillStyle = 'rgba(80,80,80,0.32)';
  ctx.fillRect(0, 0, w, 2);
  ctx.fillRect(0, 0, 2, h);
}

/** Large-format porcelain tiles (120 x 60) in a half bond. */
function drawStone(ctx, w, h, rand) {
  const cols = 2;
  const rows = 4;
  const tw = w / cols;
  const th = h / rows;
  const tones = Array.from({ length: cols * rows }, () => 82 + rand() * 4);
  const veins = Array.from({ length: cols * rows }, () => Math.floor(rand() * 1e9));
  for (let r = 0; r < rows; r++) {
    for (let c = -1; c <= cols; c++) {
      const index = r * cols + ((c % cols) + cols) % cols;
      const x = c * tw + (r % 2) * (tw / 2);
      const y = r * th;
      ctx.fillStyle = hsl(36, 8, tones[index]);
      ctx.fillRect(x, y, tw, th);
      const vrand = seeded(veins[index]);
      for (let v = 0; v < 3; v++) {
        ctx.strokeStyle = `rgba(120, 110, 95, ${0.05 + vrand() * 0.06})`;
        ctx.lineWidth = 0.8 + vrand() * 1.5;
        ctx.beginPath();
        let px = x + vrand() * tw;
        let py = y;
        ctx.moveTo(px, py);
        while (py < y + th) {
          px += (vrand() - 0.5) * 24;
          py += 10 + vrand() * 14;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(115, 108, 98, 0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, tw - 2, th - 2);
    }
  }
  speckle(ctx, w, h, rand, 4000, 0.08, 1.2);
}

function herringPlank(ctx, x, y, pw, ph, horizontal, seed) {
  if (x > 520 || y > 520 || x + pw < -8 || y + ph < -8) return;
  const rand = seeded(seed * 7919 + 17);
  ctx.fillStyle = hsl(26 + rand() * 7, 36 + rand() * 10, 44 + rand() * 11);
  ctx.fillRect(x + 0.75, y + 0.75, pw - 1.5, ph - 1.5);
  for (let g = 0; g < 7; g++) {
    ctx.fillStyle = `rgba(60,35,15,${0.05 + rand() * 0.1})`;
    if (horizontal) ctx.fillRect(x + 1, y + 2 + rand() * (ph - 4), pw - 2, 0.8 + rand());
    else ctx.fillRect(x + 2 + rand() * (pw - 4), y + 1, 0.8 + rand(), ph - 2);
  }
}

/**
 * Warm herringbone parquet. The planks form a lattice with periods (W, W) and (L, -L); colours depend
 * only on a plank's class modulo the 512px tile, so the texture repeats without seams.
 */
function drawHerringbone(ctx, w, h) {
  const W = 32;
  const L = 128;
  ctx.fillStyle = '#4e3421';
  ctx.fillRect(0, 0, w, h);
  for (let i = -8; i <= 24; i++) {
    for (let j = -5; j <= 5; j++) {
      const ox = i * W + j * L;
      const oy = i * W - j * L;
      const cls = ((((i - 8 * Math.floor(j / 2)) % 16) + 16) % 16) * 2 + (((j % 2) + 2) % 2);
      herringPlank(ctx, ox, oy, L, W, true, cls * 2);
      herringPlank(ctx, ox + L, oy + W - L, W, L, false, cls * 2 + 1);
    }
  }
}

function drawRug(ctx, w, h, rand) {
  const c = w / 2;
  ctx.fillStyle = '#b9ae9e';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#857866';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.86, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.79, 0, Math.PI * 2);
  ctx.stroke();
  speckle(ctx, w, h, rand, 22000, 0.2, 1.6);
}

/** The view through the windows: a skyline by day, lit office towers by night. Tiles horizontally. */
function drawSky(ctx, w, h, rand, night) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (night) {
    g.addColorStop(0, '#0a1122');
    g.addColorStop(0.7, '#17223a');
    g.addColorStop(1, '#263250');
  } else {
    g.addColorStop(0, '#8db5dc');
    g.addColorStop(0.65, '#cddff0');
    g.addColorStop(1, '#edf1f3');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (const layer of [0, 1]) {
    let x = 0;
    while (x < w) {
      const bw = 30 + rand() * 70;
      const bh = h * (layer ? 0.12 + rand() * 0.2 : 0.22 + rand() * 0.3);
      const lit = Math.floor(rand() * 1e9);
      for (const shift of [0, -w]) {
        const bx = x + shift;
        ctx.fillStyle = night ? (layer ? '#10182a' : '#0c1322') : layer ? 'rgba(126, 148, 170, 0.75)' : 'rgba(160, 180, 200, 0.6)';
        ctx.fillRect(bx, h - bh, bw, bh);
        if (night) {
          const wr = seeded(lit);
          for (let wy = h - bh + 6; wy < h - 4; wy += 7) {
            for (let wx = bx + 4; wx < bx + bw - 4; wx += 6) {
              if (wr() < 0.28) {
                ctx.fillStyle = `rgba(255, 214, 140, ${0.35 + wr() * 0.5})`;
                ctx.fillRect(wx, wy, 3, 3);
              }
            }
          }
        }
      }
      x += bw + rand() * 8;
    }
  }
  const sheen = ctx.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, `rgba(255,255,255,${night ? 0.03 : 0.1})`);
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);
}

function drawRack(ctx, w, h) {
  ctx.fillStyle = '#171a21';
  ctx.fillRect(0, 0, w, h);
  const unit = h / 32;
  for (let u = 0; u < 32; u++) {
    const y = u * unit;
    ctx.fillStyle = u % 4 === 0 ? '#2a303a' : '#20252e';
    ctx.fillRect(14, y + 1, w - 28, unit - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let x = 34; x < w - 34; x += 8) ctx.fillRect(x, y + unit * 0.35, 4, unit * 0.3);
  }
  ctx.fillStyle = '#3a414d';
  ctx.fillRect(0, 0, 10, h);
  ctx.fillRect(w - 10, 0, 10, h);
}

/** Editor-like lines; multiplied by each screen's instance colour. */
function drawCode(ctx, w, h, rand) {
  ctx.fillStyle = '#c4c4c4';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 0, w, 8);
  ctx.fillRect(0, 8, 22, h);
  for (let y = 14; y < h - 4; y += 6) {
    let x = 28 + Math.floor(rand() * 4) * 8;
    const parts = 1 + Math.floor(rand() * 3);
    for (let p = 0; p < parts && x < w - 10; p++) {
      const len = 10 + rand() * 50;
      ctx.fillStyle = rand() < 0.5 ? '#ffffff' : '#e6e6e6';
      ctx.fillRect(x, y, Math.min(len, w - 10 - x), 3);
      x += len + 6;
    }
  }
}

/** Room name tag for the floor: a rounded label with a small colour dot. */
function labelTexture(text, ink, forDarkTheme) {
  return paint(
    512,
    128,
    (ctx, w) => {
      ctx.font = `600 50px ${FONT}`;
      const textW = Math.min(ctx.measureText(text).width, w - 124);
      const pw = textW + 108;
      const x0 = (w - pw) / 2;
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = forDarkTheme ? 'rgba(248, 250, 252, 0.95)' : 'rgba(17, 24, 39, 0.9)';
      roundRect(ctx, x0, 20, pw, 88, 24);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(x0 + 42, 64, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = forDarkTheme ? 'rgba(15, 23, 42, 0.25)' : 'rgba(255, 255, 255, 0.85)';
      ctx.stroke();
      ctx.fillStyle = forDarkTheme ? '#0f172a' : '#f8fafc';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x0 + 70, 66, w - 124);
    },
    { wrapS: false, wrapT: false },
  );
}

/** Backlit company sign: an orange mark and the wordmark with a soft glow. */
function logoTexture() {
  return paint(
    1024,
    256,
    (ctx, w, h) => {
      ctx.font = `700 132px ${FONT}`;
      const textW = ctx.measureText('devcrew').width;
      const x0 = (w - (textW + 140)) / 2;
      ctx.shadowColor = 'rgba(255, 196, 120, 0.9)';
      ctx.shadowBlur = 30;
      const mark = ctx.createLinearGradient(x0, 78, x0 + 100, 178);
      mark.addColorStop(0, '#fb923c');
      mark.addColorStop(1, '#ea580c');
      ctx.fillStyle = mark;
      roundRect(ctx, x0, 78, 100, 100, 24);
      ctx.fill();
      ctx.fillStyle = '#fff8ec';
      ctx.textBaseline = 'middle';
      ctx.fillText('devcrew', x0 + 140, h / 2 + 6);
    },
    { wrapS: false, wrapT: false },
  );
}

function checkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#16a34a';
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(36, 66);
  ctx.lineTo(56, 86);
  ctx.lineTo(92, 44);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A tiny studio room with bright panels, pre-filtered into an environment map so metal, glass and
 * glossy surfaces have something to reflect (RoomEnvironment is not vendored, so this stands in).
 */
function roomEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = [];
  const add = (color, intensity, position, scale, side = THREE.FrontSide) => {
    const material = new THREE.MeshBasicMaterial({ color, side });
    material.color.multiplyScalar(intensity);
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.scale.copy(scale);
    envScene.add(mesh);
  };
  add('#6a6f76', 1, S(0, 4, 0), S(22, 12, 22), THREE.BackSide);
  add('#3f3a34', 1, S(0, -1.9, 0), S(21, 0.2, 21));
  add('#ffffff', 6, S(0, 9.8, -3), S(10, 0.1, 2.5));
  add('#ffffff', 6, S(0, 9.8, 3), S(10, 0.1, 2.5));
  add('#dbe8ff', 3.5, S(-10.8, 4, 0), S(0.1, 5, 14));
  add('#ffe8cc', 1.8, S(10.8, 3, 0), S(0.1, 3, 9));
  add('#ffffff', 2, S(0, 4, -10.8), S(9, 4, 0.1));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  geometry.dispose();
  for (const material of materials) material.dispose();
  return target;
}

// ---------------------------------------------------------------------------------------------
// createOffice
// ---------------------------------------------------------------------------------------------

export function createOffice(container, { rooms, reducedMotion = false, dark = false, onFail = () => {} }) {
  let motionOff = reducedMotion;
  let theme = dark ? THEMES.dark : THEMES.light;

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = !coarse;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = theme.exposure;
  renderer.domElement.className = 'office-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const labelLayer = document.createElement('div');
  labelLayer.className = 'labels';
  labelLayer.setAttribute('aria-hidden', 'true');
  container.replaceChildren(renderer.domElement, labelLayer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);

  const disposables = new Set();
  const track = (item) => {
    disposables.add(item);
    return item;
  };

  const envTarget = track(roomEnvironment(renderer));
  scene.environment = envTarget.texture;
  scene.environmentIntensity = theme.env;

  // Shared geometries.
  const BOX = track(new THREE.BoxGeometry(1, 1, 1));
  const CYL = track(new THREE.CylinderGeometry(0.5, 0.5, 1, 16));
  const CONE = track(new THREE.CylinderGeometry(0.28, 0.5, 1, 16, 1, true));
  const LEAF = track(new THREE.IcosahedronGeometry(0.5, 1));
  const BALL = track(new THREE.SphereGeometry(0.5, 12, 8));
  const PLANE = track(new THREE.PlaneGeometry(1, 1));
  const RING = track(new THREE.RingGeometry(0.8, 1, 40));
  const DISC = track(new THREE.CylinderGeometry(0.5, 0.5, 1, 48));
  const POT = track(new THREE.CylinderGeometry(0.5, 0.38, 1, 16));

  const std = (color, extra = {}) => track(new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra }));
  // Unlit colours (signs, LEDs, screens) keep their exact colour instead of going through tone mapping.
  const basic = (color, extra = {}) => track(new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra }));

  // Textures.
  const T = {
    oak: track(paint(512, 512, (c, w, h) => drawPlanks(c, w, h, seeded(11)))),
    carpet: track(paint(512, 512, (c, w, h) => drawCarpet(c, w, h, seeded(23)))),
    stone: track(paint(512, 512, (c, w, h) => drawStone(c, w, h, seeded(37)))),
    concrete: track(paint(512, 512, (c, w, h) => drawConcrete(c, w, h, seeded(41)))),
    herring: track(paint(512, 512, (c, w, h) => drawHerringbone(c, w, h))),
    rug: track(paint(512, 512, (c, w, h) => drawRug(c, w, h, seeded(53)), { wrapS: false, wrapT: false })),
    rack: track(paint(256, 512, (c, w, h) => drawRack(c, w, h), { wrapS: false, wrapT: false })),
    code: track(paint(128, 80, (c, w, h) => drawCode(c, w, h, seeded(61)), { wrapS: false, wrapT: false })),
  };
  // Real-world sizes: planks 1.5 m per tile, carpet tiles 2 m, porcelain 2.4 m, concrete 4 m, parquet 2.4 m.
  T.oak.repeat.set(ROOM_W / 1.5, ROOM_D / 1.5);
  T.carpet.repeat.set(ROOM_W / 2, ROOM_D / 2);
  T.stone.repeat.set(ROOM_W / 2.4, ROOM_D / 2.4);
  T.concrete.repeat.set(24.3 / 4, (CORR * 2) / 4);
  T.herring.repeat.set(7.9 / 2.4, 12.2 / 2.4);

  const skyPair = (night) => {
    const narrow = track(paint(1024, 256, (c, w, h) => drawSky(c, w, h, seeded(5), night), { wrapT: false }));
    const wide = track(narrow.clone());
    wide.repeat.set(3, 1);
    wide.needsUpdate = true;
    return { narrow, wide };
  };
  const sky = { day: skyPair(false), night: skyPair(true) };
  const backdropTexture = ([top, bottom]) =>
    track(
      paint(
        4,
        256,
        (ctx, w, h) => {
          const g = ctx.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, top);
          g.addColorStop(1, bottom);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        },
        { wrapS: false, wrapT: false },
      ),
    );
  const backdrop = { light: backdropTexture(THEMES.light.backdrop), dark: backdropTexture(THEMES.dark.backdrop) };
  scene.background = dark ? backdrop.dark : backdrop.light;

  const floorMat = {
    oak: std('#ffffff', { map: T.oak, roughness: 0.55 }),
    carpet: std('#ffffff', { map: T.carpet, roughness: 0.97 }),
    stone: std('#ffffff', { map: T.stone, roughness: 0.4 }),
    concrete: std('#ffffff', { map: T.concrete, roughness: 0.34 }),
    herring: std('#ffffff', { map: T.herring, roughness: 0.5 }),
  };

  const M = {
    wall: std('#f1efea', { roughness: 0.92 }),
    cap: std('#2f3540', { roughness: 0.7 }),
    skirting: std('#5b616b', { roughness: 0.6 }),
    slab: std('#bfc2c5', { roughness: 0.9 }),
    paving: std('#b9b5ae', { roughness: 0.85 }),
    alu: std('#c3c8ce', { roughness: 0.35, metalness: 0.75 }),
    glass: std('#d6e5ec', { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false }),
    deskTop: std('#f4f4f2', { roughness: 0.45 }),
    oak: std('#d3ae7f', { roughness: 0.55 }),
    walnut: std('#6b4a33', { roughness: 0.6 }),
    steel: std('#3a3f47', { roughness: 0.45, metalness: 0.6 }),
    chrome: std('#d9dde2', { roughness: 0.2, metalness: 0.9 }),
    stainless: std('#c9cdd1', { roughness: 0.3, metalness: 0.7 }),
    black: std('#1c1f26', { roughness: 0.5 }),
    keyboard: std('#d6dadf', { roughness: 0.5 }),
    fabric: std('#2d3138', { roughness: 0.95 }),
    mesh: std('#24272d', { roughness: 0.85 }),
    felt: std('#ffffff', { roughness: 1 }),
    sofa: std('#3d424a', { roughness: 0.95 }),
    cushion: std('#4b515a', { roughness: 0.95 }),
    tint: std('#ffffff', { roughness: 0.6 }),
    leaf: std('#ffffff', { roughness: 0.75, flatShading: true }),
    planter: std('#ffffff', { roughness: 0.55 }),
    rack: std('#ffffff', { map: T.rack, roughness: 0.55, metalness: 0.3 }),
    whiteboard: std('#fbfbf9', { roughness: 0.2 }),
    white: std('#f3f3f1', { roughness: 0.5 }),
    rug: std('#ffffff', { map: T.rug, roughness: 1 }),
    lightPanel: std('#f7f7f4', { emissive: theme.glow, emissiveIntensity: theme.glowI, roughness: 0.4 }),
    shade: std('#f4ede1', { emissive: theme.glow, emissiveIntensity: theme.glowI, roughness: 0.6, side: THREE.DoubleSide }),
    glow: basic('#ffffff', { side: THREE.DoubleSide }),
    screen: basic('#ffffff', { map: T.code }),
  };
  const glowMaterials = [M.lightPanel, M.shade];

  // Lights.
  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun, theme.sunI);
  sun.position.set(OFFICE_CENTER.x + 10, 24, OFFICE_CENTER.z + 14);
  sun.target.position.copy(OFFICE_CENTER);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 16, bottom: -16, near: 4, far: 60 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const lamps = [];
  for (const id of ROOM_IDS) lamps.push(place(id, 0, ROOM_D / 2, 2.4));
  lamps.push(new THREE.Vector3(16.2, 2.4, 0));
  const lampLights = lamps.map((position) => {
    const light = new THREE.PointLight('#ffc98a', 7, 0, 1.5);
    light.position.copy(position);
    light.visible = theme.lamps;
    scene.add(light);
    return light;
  });

  // -------------------------------------------------------------------------------------------
  // Static office
  // -------------------------------------------------------------------------------------------

  const batch = new Batch();
  const box = (key, material, position, scale, options) => batch.add(key, BOX, material, position, scale, options);
  const NO_SHADOW = { cast: false };
  const GLASS = { cast: false, receive: false };
  /** A box spanning [a, b] along a wall: 'x' walls run along X at a fixed Z, 'z' walls along Z at a fixed X. */
  const span = (key, material, axis, fixed, a, b, y0, y1, thick, offset = 0, options) => {
    if (b - a <= 0.001) return;
    const mid = (a + b) / 2;
    if (axis === 'x') box(key, material, S(mid, (y0 + y1) / 2, fixed + offset), S(b - a, y1 - y0, thick), options);
    else box(key, material, S(fixed + offset, (y0 + y1) / 2, mid), S(thick, y1 - y0, b - a), options);
  };

  const LEAF_GREENS = ['#3f7f45', '#4f9150', '#2f6b3c', '#5c9a4f', '#3c7a52'];
  const POT_COLORS = ['#f1f0ec', '#30333a', '#cbc4b8'];
  const plant = (position, size = 1, kind = 'tall') => {
    const { x, z } = position;
    const rand = seeded(Math.round(x * 131 + z * 71 + 1000));
    batch.add('planter', POT, M.planter, S(x, 0.26 * size, z), S(0.44 * size, 0.52 * size, 0.44 * size), { color: POT_COLORS[Math.floor(rand() * POT_COLORS.length)] });
    if (kind === 'snake') {
      for (let i = 0; i < 9; i++) {
        const angle = (i / 9) * Math.PI * 2 + rand() * 0.5;
        const height = (0.5 + rand() * 0.4) * size;
        const tilt = 0.12 + rand() * 0.18;
        const r = 0.07 * size + Math.sin(tilt) * height * 0.5;
        box('blade', M.leaf, S(x + Math.cos(angle) * r, 0.5 * size + height / 2, z + Math.sin(angle) * r), S(0.08 * size, height, 0.015), {
          rotY: Math.PI / 2 - angle,
          rotX: tilt,
          color: LEAF_GREENS[(i + 2) % LEAF_GREENS.length],
        });
      }
      return;
    }
    batch.add('stem', CYL, M.walnut, S(x, 0.85 * size, z), S(0.035, 0.9 * size, 0.035));
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const s = (0.62 - t * 0.26) * size;
      batch.add('leaf', LEAF, M.leaf, S(x + (rand() - 0.5) * 0.28 * size, (0.72 + t * 0.95) * size, z + (rand() - 0.5) * 0.28 * size), S(s, s * 0.85, s), {
        rotY: rand() * 6,
        color: LEAF_GREENS[Math.floor(rand() * LEAF_GREENS.length)],
      });
    }
  };
  const floorLamp = (x, z) => {
    batch.add('disc', CYL, M.steel, S(x, 0.015, z), S(0.34, 0.03, 0.34));
    batch.add('pole', CYL, M.chrome, S(x, 0.8, z), S(0.035, 1.6, 0.035));
    batch.add('shade', CONE, M.shade, S(x, 1.65, z), S(0.5, 0.34, 0.5), NO_SHADOW);
  };
  // Suspended linear LED light over a desk.
  const linearPendant = (center, length = 1.5) => {
    box('pendant', M.black, center, S(0.09, 0.04, length), NO_SHADOW);
    box('panel', M.lightPanel, S(center.x, center.y - 0.024, center.z), S(0.07, 0.01, length - 0.04), NO_SHADOW);
    for (const k of [-1, 1]) box('pendant', M.black, S(center.x, center.y + 0.27, center.z + k * length * 0.38), S(0.008, 0.52, 0.008), NO_SHADOW);
  };

  // The building: a concrete slab under the floors and an entrance landing.
  box('slab', M.slab, S(0, -0.35, 0), S(24.8, 0.5, 20.8));
  box('slab', M.slab, S(16.4, -0.35, 0), S(8.0, 0.5, 13.0));
  box('slab', M.slab, S(-13.5, -0.35, 0.3), S(2.3, 0.5, 6.6));
  box('paving', M.paving, S(-13.4, -0.05, 0.3), S(2.3, 0.1, 6.4), NO_SHADOW);

  // A soft pool of shade under the building that fades into the backdrop.
  const poolTexture = track(
    paint(
      256,
      256,
      (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      },
      { wrapS: false, wrapT: false },
    ),
  );
  const poolMat = basic(theme.pool, { map: poolTexture, transparent: true, depthWrite: false });
  {
    const pool = new THREE.Mesh(PLANE, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(4, -0.62, 0);
    pool.scale.set(64, 44, 1);
    pool.renderOrder = -1;
    scene.add(pool);
  }

  // Floors: porcelain at reception, carpet in planning and review, oak on the work floors, a raised-floor
  // grey in the server bay, polished concrete in the corridor and herringbone parquet in the lounge.
  const ROOM_FLOOR = {
    triage: ['stone', '#ffffff'],
    plan: ['carpet', '#d2cabf'],
    build: ['oak', null],
    qa: ['oak', null],
    regression: ['stone', '#b9c0c9'],
    review: ['carpet', '#bcc5cf'],
  };
  box('concrete', floorMat.concrete, S(-0.05, -0.05, 0), S(24.3, 0.1, CORR * 2), NO_SHADOW);
  for (const id of ROOM_IDS) {
    const { cx, dir } = roomFrame(id);
    const [kind, color] = ROOM_FLOOR[id];
    box(`floor-${kind}`, floorMat[kind], S(cx, -0.05, dir * (CORR + ROOM_D / 2)), S(ROOM_W - 0.02, 0.1, ROOM_D), { cast: false, color });
  }
  box('herring', floorMat.herring, S(16.1, -0.05, 0), S(7.9, 0.1, 12.2), NO_SHADOW);

  // Walls. Back walls (north, west) are full height with windows; walls toward the default camera
  // (south, east) are cut low like an architectural section so they never hide anyone.
  const WALL_H = 2.9;
  const WALL_T = 0.2;
  const SILL = 0.7;
  const WIN_HEAD = 2.55;
  const GLASS_H = 2.7;
  const backZ = CORR + ROOM_D + 0.1;
  const windowWall = (axis, fixed, a0, a1, windows) => {
    let cursor = a0;
    for (const [a, b] of windows) {
      span('wall', M.wall, axis, fixed, cursor, a, -0.1, WALL_H, WALL_T);
      span('wall', M.wall, axis, fixed, a, b, -0.1, SILL, WALL_T);
      span('wall', M.wall, axis, fixed, a, b, WIN_HEAD, WALL_H, WALL_T);
      span('glass', M.glass, axis, fixed, a, b, SILL, WIN_HEAD, 0.02, 0, GLASS);
      span('alu', M.alu, axis, fixed, a, b, SILL, SILL + 0.05, 0.1, 0, NO_SHADOW);
      span('alu', M.alu, axis, fixed, a, b, WIN_HEAD - 0.05, WIN_HEAD, 0.1, 0, NO_SHADOW);
      const panes = Math.max(1, Math.round((b - a) / 1.2));
      for (let i = 0; i <= panes; i++) {
        const p = a + ((b - a) * i) / panes;
        span('alu', M.alu, axis, fixed, p - 0.03, p + 0.03, SILL, WIN_HEAD, 0.1, 0, NO_SHADOW);
      }
      span('white', M.white, axis, fixed, a - 0.06, b + 0.06, SILL - 0.04, SILL, 0.16, 0.1);
      cursor = b;
    }
    span('wall', M.wall, axis, fixed, cursor, a1, -0.1, WALL_H, WALL_T);
    span('cap', M.cap, axis, fixed, a0, a1, WALL_H, WALL_H + 0.03, WALL_T + 0.02, 0, NO_SHADOW);
    span('skirting', M.skirting, axis, fixed, a0, a1, 0, 0.08, 0.02, WALL_T / 2 + 0.01, NO_SHADOW);
  };
  const lowWall = (axis, fixed, a0, a1, height = 0.5) => {
    span('wall', M.wall, axis, fixed, a0, a1, -0.1, height, WALL_T);
    span('cap', M.cap, axis, fixed, a0, a1, height, height + 0.03, WALL_T + 0.02, 0, NO_SHADOW);
  };
  /** Frameless-look glass partition with thin aluminium tracks and mullions. */
  const glassRun = (axis, fixed, a0, a1) => {
    if (a1 - a0 < 0.05) return;
    span('glass', M.glass, axis, fixed, a0, a1, 0.05, GLASS_H - 0.05, 0.02, 0, GLASS);
    span('alu', M.alu, axis, fixed, a0, a1, 0, 0.06, 0.07, 0, NO_SHADOW);
    span('alu', M.alu, axis, fixed, a0, a1, GLASS_H - 0.06, GLASS_H, 0.07, 0, NO_SHADOW);
    const panes = Math.max(1, Math.round((a1 - a0) / 1.6));
    for (let i = 0; i <= panes; i++) {
      const p = a0 + ((a1 - a0) * i) / panes;
      span('alu', M.alu, axis, fixed, p - 0.025, p + 0.025, 0, GLASS_H, 0.07, 0, NO_SHADOW);
    }
  };

  const NORTH_WINDOWS = { triage: [[-3.6, -2.0], [2.3, 3.6]], plan: [[-3.6, -1.95], [1.95, 3.6]], build: [[-3.6, -1.95], [1.95, 3.6]] };
  const northWindows = Object.entries(NORTH_WINDOWS).flatMap(([id, list]) => list.map(([a, b]) => [roomFrame(id).cx + a, roomFrame(id).cx + b]));
  windowWall('x', -backZ, -12.2, 12.2, northWindows);
  windowWall('z', -12.1, -backZ - 0.1, -CORR, [[-9.4, -7.6], [-6.0, -4.2]]);
  windowWall('z', -12.1, CORR, backZ + 0.1, [[3.3, 6.3]]);
  windowWall('x', -6.2, 12.0, 20.2, [[12.8, 18.7]]);
  lowWall('x', backZ, -12.2, 12.2);
  lowWall('z', 12.1, -backZ - 0.1, -6.2);
  lowWall('z', 12.1, 6.2, backZ + 0.1);
  lowWall('z', 20.1, -6.3, 6.3);
  lowWall('x', 6.2, 12.2, 20.2);

  // The view through the windows, behind the wall openings.
  const skyWide = basic('#ffffff', { map: dark ? sky.night.wide : sky.day.wide });
  const skyNarrow = basic('#ffffff', { map: dark ? sky.night.narrow : sky.day.narrow });
  const skyPlane = (material, axis, fixed, a0, a1) => {
    const mesh = new THREE.Mesh(PLANE, material);
    mesh.scale.set(a1 - a0, WIN_HEAD - SILL + 0.2, 1);
    const behind = fixed - (WALL_T / 2 + 0.03);
    const y = (SILL + WIN_HEAD) / 2;
    if (axis === 'x') mesh.position.set((a0 + a1) / 2, y, behind);
    else {
      mesh.position.set(behind, y, (a0 + a1) / 2);
      mesh.rotation.y = Math.PI / 2;
    }
    scene.add(mesh);
  };
  skyPlane(skyWide, 'x', -backZ, -12.2, 12.2);
  skyPlane(skyNarrow, 'z', -12.1, -backZ - 0.1, -CORR);
  skyPlane(skyNarrow, 'z', -12.1, CORR, backZ + 0.1);
  skyPlane(skyNarrow, 'x', -6.2, 12.0, 20.2);

  // Glass fronts toward the corridor, with a wide opening on each room's aisle and a small colour plaque.
  for (const id of ROOM_IDS) {
    const { cx, dir } = roomFrame(id);
    const door = cx + aisleU(id);
    const z = dir * CORR;
    glassRun('x', z, cx - 4, door - 1.7);
    glassRun('x', z, door + 1.7, cx + 4);
    box('plaque', M.tint, S(door + 2.05, 1.55, z - dir * 0.03), S(0.3, 0.3, 0.02), { color: ROOM_INK[id], cast: false });
  }
  // Glass between neighbouring rooms, and between the end rooms and the lounge.
  for (const x of [-4, 4]) {
    glassRun('z', x, -backZ + 0.1, -CORR);
    glassRun('z', x, CORR, backZ - 0.1);
  }
  glassRun('z', 12.1, -6.2, -CORR);
  glassRun('z', 12.1, CORR, 6.2);

  // Entrance: glass side lights, an open doorway on the walking line, a canopy and a mat outside.
  span('wall', M.wall, 'z', -12.1, -CORR, CORR, WIN_HEAD, WALL_H, WALL_T);
  span('cap', M.cap, 'z', -12.1, -CORR, CORR, WALL_H, WALL_H + 0.03, WALL_T + 0.02, 0, NO_SHADOW);
  span('glass', M.glass, 'z', -12.1, -CORR, -0.95, 0.05, WIN_HEAD, 0.02, 0, GLASS);
  span('glass', M.glass, 'z', -12.1, 1.75, CORR, 0.05, WIN_HEAD, 0.02, 0, GLASS);
  for (const p of [-CORR + 0.04, -0.95, 1.75, CORR - 0.04]) span('alu', M.alu, 'z', -12.1, p - 0.04, p + 0.04, 0, WIN_HEAD, 0.12, 0, NO_SHADOW);
  span('alu', M.alu, 'z', -12.1, -CORR, CORR, WIN_HEAD - 0.06, WIN_HEAD, 0.12, 0, NO_SHADOW);
  box('cap', M.cap, S(-12.75, 2.72, 0.4), S(1.1, 0.08, 3.6));
  box('mat', M.fabric, S(-12.9, 0.006, 0.4), S(1.2, 0.012, 2.0), NO_SHADOW);
  plant(S(-13.6, 0, -2.2), 1.1);
  plant(S(-13.6, 0, 3.0), 1.1);

  // Desks: every room has several, so parallel agents never share one. Each is a white sit-stand desk
  // with dual monitors on an arm, a felt divider in the room's accent colour and a linear pendant.
  const desks = [];
  const deskScreens = [];
  const MON_W = 0.58;
  const MON_H = 0.34;
  const MON_TURN = 0.2;
  const MUGS = ['#f5f5f4', '#1f2937', '#f59e0b', '#0ea5e9', '#e11d48'];
  const feltGrey = new THREE.Color('#9aa1a9');
  for (const id of ROOM_IDS) {
    const accent = new THREE.Color(ROOM_INK[id]).lerp(feltGrey, 0.5);
    for (const v of DESK_ROWS[id]) {
      for (const s of [-1, 1]) {
        const at = (u, y) => place(id, s * u, v, y);
        const atv = (u, dv, y) => place(id, s * u, v + dv, y);
        const yawS = s > 0 ? 0 : Math.PI;
        const index = desks.length;
        const rand = seeded(index * 97 + 13);

        box('deskTop', M.deskTop, at(2.55, 0.76), S(1.0, 0.035, 1.66));
        for (const dv of [-0.7, 0.7]) {
          box('steel', M.steel, atv(2.55, dv, 0.39), S(0.07, 0.72, 0.07));
          box('steel', M.steel, atv(2.55, dv, 0.02), S(0.78, 0.04, 0.07));
        }
        box('steel', M.steel, at(2.62, 0.7), S(0.06, 0.06, 1.4));
        box('felt', M.felt, at(3.03, 1.0), S(0.03, 0.44, 1.62), { color: accent });

        // Dual monitors, angled in slightly; the glowing screens are drawn by one InstancedMesh below.
        box('steel', M.steel, at(2.97, 0.98), S(0.04, 0.4, 0.04));
        box('steel', M.steel, at(2.93, 1.16), S(0.03, 0.03, 0.8));
        const base = at(2.9 - 0.045, 1.16);
        for (const k of [-1, 1]) {
          const turn = -s * k * MON_TURN;
          const position = base.clone().add(S(k * (MON_W / 2) * Math.sin(turn), 0, k * (0.012 + (MON_W / 2) * Math.cos(turn))));
          deskScreens.push({ position, quaternion: new THREE.Quaternion().setFromAxisAngle(UP_AXIS, turn) });
          const bezel = position.clone().add(S(Math.cos(turn) * s * 0.016, 0, -Math.sin(turn) * s * 0.016));
          box('bezel', M.black, bezel, S(0.022, MON_H + 0.024, MON_W + 0.02), { rotY: turn });
        }
        box('keyboard', M.keyboard, at(2.28, 0.786), S(0.14, 0.014, 0.44), NO_SHADOW);
        box('keyboard', M.keyboard, at(2.3, 0.79).add(S(0, 0, s * 0.34)), S(0.1, 0.022, 0.06), NO_SHADOW);
        if (rand() < 0.6) batch.add('mug', CYL, M.tint, at(2.25, 0.83).add(S(0, 0, -s * 0.55)), S(0.08, 0.1, 0.08), { color: MUGS[Math.floor(rand() * MUGS.length)] });
        else box('paper', M.tint, at(2.3, 0.785).add(S(0, 0, -s * 0.5)), S(0.22, 0.012, 0.16), { color: '#ece8de', cast: false });

        // Ergonomic chair: seat, tilted mesh back, armrests, gas lift and a five-star base on casters.
        const seat = at(1.55, 0);
        box('chairSeat', M.fabric, at(1.55, 0.47), S(0.5, 0.07, 0.5));
        box('chairBack', M.mesh, at(1.25, 0.86), S(0.04, 0.56, 0.46), { rotY: yawS, rotZ: 0.12 });
        for (const k of [-1, 1]) {
          box('steel', M.steel, at(1.55, 0.6).add(S(0, 0, k * 0.27)), S(0.03, 0.2, 0.03));
          box('black', M.black, at(1.58, 0.71).add(S(0, 0, k * 0.27)), S(0.26, 0.03, 0.06));
        }
        batch.add('chrome', CYL, M.chrome, at(1.55, 0.27), S(0.06, 0.36, 0.06));
        for (let k = 0; k < 5; k++) {
          const angle = (k / 5) * Math.PI * 2 + index;
          const c = Math.cos(angle);
          const sn = Math.sin(angle);
          box('steel', M.steel, seat.clone().add(S(c * 0.15, 0.06, sn * 0.15)), S(0.3, 0.035, 0.045), { rotY: -angle });
          batch.add('caster', BALL, M.black, seat.clone().add(S(c * 0.29, 0.03, sn * 0.29)), S(0.055, 0.055, 0.055), NO_SHADOW);
        }

        linearPendant(at(2.55, 2.55));

        const yaw = Math.atan2(s, 0);
        desks.push({
          room: id,
          screen: at(2.9 - 0.045, 1.16),
          sit: { key: `desk-${desks.length}-sit`, region: id, pos: at(1.55, 0), yaw, sit: true },
          stand: { key: `desk-${desks.length}-stand`, region: id, pos: at(0.75, 0), yaw, sit: false },
          occupant: null,
          glowKey: '',
        });
      }
    }
  }

  // Lounge-style seating with its own frame; front is local +z.
  const armchair = (position, rotY, color) => {
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const at = (lx, y, lz) => S(position.x + lx * cos + lz * sin, y, position.z - lx * sin + lz * cos);
    box('armchair', M.tint, at(0, 0.25, 0), S(0.72, 0.3, 0.72), { rotY, color });
    box('armchair', M.tint, at(0, 0.44, 0.05), S(0.56, 0.1, 0.6), { rotY, color });
    box('armchair', M.tint, at(0, 0.62, -0.3), S(0.72, 0.5, 0.14), { rotY, rotX: -0.1, color });
    for (const k of [-1, 1]) box('armchair', M.tint, at(k * 0.31, 0.5, 0), S(0.1, 0.2, 0.72), { rotY, color });
    for (const lx of [-0.3, 0.3]) for (const lz of [-0.3, 0.3]) box('steel', M.steel, at(lx, 0.05, lz), S(0.04, 0.1, 0.04), { rotY });
  };

  // Reception: white counter with an oak top and LED strip, a backlit logo on a slatted wall, waiting chairs.
  box('white', M.white, place('triage', 1.5, 1.5, 0.54), S(2.8, 0.92, 0.55));
  box('black', M.black, place('triage', 1.5, 1.52, 0.04), S(2.7, 0.08, 0.48));
  box('oakTop', M.oak, place('triage', 1.5, 1.5, 1.04), S(3.0, 0.07, 0.75));
  box('panel', M.lightPanel, place('triage', 1.5, 1.235, 0.995), S(2.8, 0.015, 0.02), NO_SHADOW);
  box('bezel', M.black, place('triage', 0.8, 1.75, 1.3), S(0.5, 0.32, 0.025));
  box('steel', M.steel, place('triage', 0.8, 1.78, 1.12), S(0.04, 0.1, 0.04));
  box('walnut', M.walnut, place('triage', 0.2, ROOM_D - 0.015, 1.35), S(3.9, 2.5, 0.03));
  for (let i = 0; i < 36; i++) box('oakTop', M.oak, place('triage', -1.55 + i * 0.1, ROOM_D - 0.045, 1.35), S(0.045, 2.5, 0.03));
  armchair(place('triage', -3.35, 1.9), Math.PI / 2, '#a69c8f');
  armchair(place('triage', -3.35, 3.0), Math.PI / 2, '#a69c8f');
  batch.add('sideTable', CYL, M.oak, place('triage', -3.45, 2.45, 0.42), S(0.32, 0.03, 0.32));
  batch.add('chrome', CYL, M.chrome, place('triage', -3.45, 2.45, 0.21), S(0.03, 0.42, 0.03));
  plant(place('triage', -3.4, 0.6), 1, 'snake');
  plant(place('triage', 3.4, 6.9), 1.2);
  const counter = { spot: { key: 'counter', region: 'triage', pos: place('triage', 1.5, 2.25), yaw: facingCorridor('triage'), sit: false }, occupant: null };

  // Planning room: glass whiteboard with sticky notes.
  box('alu', M.alu, place('plan', 0, ROOM_D - 0.06, 1.45), S(3.3, 1.6, 0.04), NO_SHADOW);
  box('whiteboard', M.whiteboard, place('plan', 0, ROOM_D - 0.1, 1.45), S(3.2, 1.5, 0.05));
  const notes = ['#fde047', '#f9a8d4', '#93c5fd', '#86efac', '#fde047', '#fdba74', '#c4b5fd', '#93c5fd', '#fde047'];
  notes.forEach((color, i) => {
    box('plaque', M.tint, place('plan', -1.2 + (i % 5) * 0.55, ROOM_D - 0.14, 1.8 - Math.floor(i / 5) * 0.45), S(0.32, 0.32, 0.02), { color, cast: false });
  });
  box('alu', M.alu, place('plan', 0, ROOM_D - 0.18, 0.69), S(1.6, 0.03, 0.1), NO_SHADOW);
  plant(place('plan', -3.4, 6.9), 1.1);
  plant(place('plan', 3.4, 0.6), 1, 'snake');

  // Dev floor: coffee station on a white credenza and a kanban board.
  box('white', M.white, place('build', 0, ROOM_D - 0.4, 0.43), S(1.3, 0.86, 0.55));
  box('oakTop', M.oak, place('build', 0, ROOM_D - 0.4, 0.875), S(1.36, 0.03, 0.6));
  box('black', M.black, place('build', -0.25, ROOM_D - 0.42, 1.1), S(0.36, 0.42, 0.34));
  box('glow', M.glow, place('build', -0.25, ROOM_D - 0.6, 1.2), S(0.08, 0.04, 0.02), { color: '#ef4444', cast: false });
  batch.add('mug', CYL, M.tint, place('build', 0.3, ROOM_D - 0.4, 0.94), S(0.09, 0.1, 0.09), { color: '#f5f5f4' });
  batch.add('mug', CYL, M.tint, place('build', 0.48, ROOM_D - 0.4, 0.94), S(0.09, 0.1, 0.09), { color: '#f5f5f4' });
  box('whiteboard', M.whiteboard, place('build', 0, ROOM_D - 0.08, 1.75), S(1.9, 0.9, 0.04));
  ['#93c5fd', '#fde047', '#86efac', '#93c5fd', '#fca5a5', '#86efac'].forEach((color, i) => {
    box('plaque', M.tint, place('build', -0.6 + (i % 3) * 0.6, ROOM_D - 0.11, 1.93 - Math.floor(i / 3) * 0.38), S(0.42, 0.24, 0.02), { color, cast: false });
  });
  plant(place('build', 3.5, 0.45), 1, 'snake');
  plant(place('build', -3.5, 0.45), 1, 'snake');

  // QA lab: device bench and a test light.
  box('oakTop', M.oak, place('qa', 0, 6.65, 0.86), S(3.4, 0.05, 0.75));
  for (const u of [-1.6, 1.6]) for (const dv of [-0.3, 0.3]) box('steel', M.steel, place('qa', u, 6.65 + dv, 0.42), S(0.05, 0.84, 0.05));
  box('white', M.white, place('qa', 0, 6.65, 0.25), S(3.3, 0.03, 0.65));
  ['#38bdf8', '#4ade80', '#f472b6', '#38bdf8', '#a3e635'].forEach((color, i) => {
    box('bezel', M.black, place('qa', -1.2 + i * 0.6, 6.65, 1.09), S(0.24, 0.38, 0.05));
    box('glow', M.glow, place('qa', -1.2 + i * 0.6, 6.62, 1.1), S(0.2, 0.31, 0.06), { color, cast: false });
  });
  batch.add('pole', CYL, M.chrome, place('qa', 3.4, 6.8, 0.8), S(0.08, 1.6, 0.08));
  ['#ef4444', '#f59e0b', '#22c55e'].forEach((color, i) => {
    batch.add('bulb', BALL, M.glow, place('qa', 3.4, 6.8, 1.75 - i * 0.24), S(0.2, 0.2, 0.2), { color, cast: false });
  });
  plant(place('qa', -3.4, 6.9));

  // Regression bay: server racks with blinking LEDs.
  const ledColors = ['#22c55e', '#38bdf8', '#22c55e', '#f59e0b', '#22c55e'];
  const leds = [];
  for (const u of [-1.0, 0, 1.0]) {
    box('rack', M.rack, place('regression', u, 6.75, 1.05), S(0.86, 2.1, 0.76));
    for (let row = 0; row < 7; row++) {
      leds.push(box('led', M.glow, place('regression', u, 6.75, 0.35 + row * 0.25), S(0.5, 0.04, 0.8), { color: ledColors[(row + Math.round(u)) % ledColors.length], cast: false }));
    }
  }
  plant(place('regression', 3.4, 6.9));
  plant(place('regression', -3.4, 6.9));

  // Review desk: open walnut bookcase and a reading lamp.
  box('walnut', M.walnut, place('review', -3.9, 5.4, 0.95), S(0.04, 1.9, 2.4));
  for (const dv of [-1.18, 1.18]) box('walnut', M.walnut, place('review', -3.72, 5.4 + dv, 0.95), S(0.4, 1.9, 0.04));
  for (let k = 0; k < 5; k++) box('walnut', M.walnut, place('review', -3.72, 5.4, 0.135 + k * 0.44), S(0.4, 0.03, 2.36));
  const bookColors = ['#7f1d1d', '#1e3a8a', '#b45309', '#065f46', '#4c1d95', '#9d174d', '#0c4a6e', '#e7e5e4', '#374151'];
  {
    const rand = seeded(77);
    for (let shelf = 0; shelf < 4; shelf++) {
      let dv = -1.12;
      while (dv < 1.08) {
        const thick = 0.035 + rand() * 0.04;
        if (rand() < 0.12) {
          dv += 0.12;
          continue;
        }
        const height = 0.24 + rand() * 0.1;
        box('book', M.tint, place('review', -3.68, 5.4 + dv + thick / 2, 0.15 + height / 2 + shelf * 0.44), S(0.22, height, thick), {
          color: bookColors[Math.floor(rand() * bookColors.length)],
          cast: false,
        });
        dv += thick + 0.004;
      }
    }
  }
  floorLamp(place('review', 3.4, 6.8).x, place('review', 3.4, 6.8).z);
  plant(place('review', 3.4, 0.6), 1, 'snake');

  // Done lounge: three fabric sofas around a rug, a coffee bar along the east wall, lamps and plants.
  const loungeSeats = [];
  const PILLOWS = ['#d4a72c', '#2a9d8f', '#c8553d', '#e9c6a1', '#4f6d7a', '#d4a72c'];
  let pillowIndex = 0;
  const sofa = (cx, cz, rotY, length = 3.4, seats = 3) => {
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const at = (lx, y, lz) => S(cx + lx * cos + lz * sin, y, cz - lx * sin + lz * cos);
    for (const lx of [-length / 2 + 0.12, length / 2 - 0.12]) for (const lz of [-0.36, 0.36]) box('steel', M.steel, at(lx, 0.05, lz), S(0.05, 0.1, 0.05), { rotY });
    box('sofa', M.sofa, at(0, 0.26, 0), S(length, 0.3, 0.9), { rotY });
    box('sofa', M.sofa, at(0, 0.6, -0.37), S(length, 0.5, 0.16), { rotY });
    for (const k of [-1, 1]) box('sofa', M.sofa, at(k * (length / 2 - 0.08), 0.5, 0), S(0.16, 0.38, 0.9), { rotY });
    const cushionW = (length - 0.32) / seats;
    for (let i = 0; i < seats; i++) {
      const lx = (i - (seats - 1) / 2) * (length / seats);
      const cushionX = (i - (seats - 1) / 2) * cushionW;
      box('cushion', M.cushion, at(cushionX, 0.46, 0.06), S(cushionW - 0.03, 0.11, 0.72), { rotY, cast: false });
      box('cushion', M.cushion, at(cushionX, 0.73, -0.24), S(cushionW - 0.05, 0.36, 0.14), { rotY, rotX: -0.16, cast: false });
      const index = loungeSeats.length;
      loungeSeats.push({
        spot: { key: `seat-${index}`, region: 'lounge', pos: at(lx, 0, 0.08), yaw: rotY, sit: true, approach: at(lx, 0, 0.95) },
        occupant: null,
      });
    }
    for (const k of [-1, 1]) {
      box('plaque', M.tint, at(k * (length / 2 - 0.3), 0.68, -0.14), S(0.34, 0.3, 0.1), { rotY, rotX: -0.3, rotZ: k * 0.12, color: PILLOWS[pillowIndex++ % PILLOWS.length], cast: false });
    }
  };
  // The east sofa seats four, so the whole crew of ten fits when it gathers here.
  sofa(19.35, 0, -Math.PI / 2, 4.2, 4);
  sofa(16.2, -5.45, 0);
  sofa(16.2, 5.45, Math.PI);
  const RUG_CENTER = S(16.4, 0, 0);
  batch.add('rug', DISC, M.rug, S(16.4, 0.012, 0), S(4.4, 0.02, 4.4), NO_SHADOW);
  // Globe pendants above the rug.
  [
    [15.7, 2.35, -0.5],
    [16.5, 2.5, 0.4],
    [17.2, 2.3, -0.2],
  ].forEach(([x, y, z]) => {
    batch.add('globe', BALL, M.lightPanel, S(x, y, z), S(0.34, 0.34, 0.34), NO_SHADOW);
    box('pendant', M.black, S(x, (y + 3.1) / 2, z), S(0.008, 3.1 - y, 0.008), NO_SHADOW);
  });
  // Side table with a lamp, by the north-west corner.
  batch.add('sideTable', CYL, M.oak, S(12.85, 0.55, -5.45), S(0.6, 0.04, 0.6));
  batch.add('chrome', CYL, M.chrome, S(12.85, 0.27, -5.45), S(0.05, 0.53, 0.05));
  batch.add('disc', CYL, M.steel, S(12.85, 0.015, -5.45), S(0.36, 0.03, 0.36));
  batch.add('shade', CONE, M.shade, S(12.8, 0.82, -5.5), S(0.3, 0.22, 0.3), NO_SHADOW);
  floorLamp(14.05, -5.75);
  floorLamp(19.55, 3.05);
  plant(S(12.85, 0, 5.4), 1.2);
  plant(S(19.5, 0, 5.6), 1.2);
  // Coffee bar: fridge, base cabinets with an oak top, coffee machine, sink and stools.
  box('stainless', M.stainless, S(19.66, 0.95, -5.72), S(0.66, 1.9, 0.66));
  box('black', M.black, S(19.31, 1.15, -5.5), S(0.02, 0.6, 0.03));
  box('white', M.white, S(19.74, 0.44, -3.95), S(0.6, 0.88, 2.5));
  box('oakTop', M.oak, S(19.72, 0.9, -3.95), S(0.66, 0.04, 2.54));
  box('black', M.black, S(19.8, 1.1, -4.75), S(0.34, 0.36, 0.3));
  box('glow', M.glow, S(19.62, 1.18, -4.75), S(0.02, 0.03, 0.08), { color: '#22c55e', cast: false });
  box('steel', M.steel, S(19.74, 0.923, -3.5), S(0.42, 0.006, 0.5), NO_SHADOW);
  batch.add('chrome', CYL, M.chrome, S(19.95, 1.05, -3.5), S(0.03, 0.26, 0.03));
  for (const z of [-4.75, -3.8, -2.85]) {
    batch.add('stool', CYL, M.tint, S(19.02, 0.66, z), S(0.36, 0.05, 0.36), { color: '#3f3a36' });
    batch.add('chrome', CYL, M.chrome, S(19.02, 0.33, z), S(0.04, 0.62, 0.04));
    batch.add('disc', CYL, M.steel, S(19.02, 0.015, z), S(0.36, 0.03, 0.36));
  }
  const loungeOverflow = [];
  for (let i = 0; i < 16; i++) {
    loungeOverflow.push({ spot: { key: `lounge-${i}`, region: 'lounge', pos: S(14.2 + (i % 4) * 1.0, 0, -1.8 + Math.floor(i / 4) * 1.2), yaw: -0.6, sit: false }, occupant: null });
  }
  const roomOverflow = Object.fromEntries(
    ROOM_IDS.map((id) => [
      id,
      Array.from({ length: 12 }, (_, i) => ({ spot: { key: `${id}-extra-${i}`, region: id, pos: place(id, -3.1 + (i % 6) * 1.25, 1.0 + Math.floor(i / 6) * 0.9), yaw: facingCorridor(id), sit: false }, occupant: null })),
    ]),
  );

  const instanced = batch.build(scene);
  const ledMesh = instanced.get('led');
  // Glass draws after the floor labels so the labels show through it.
  instanced.get('glass').renderOrder = 2;

  // Monitor screens: one InstancedMesh, two screens per desk, whose colours light up while someone works there.
  const screens = new THREE.InstancedMesh(BOX, M.screen, deskScreens.length);
  screens.frustumCulled = false;
  {
    const matrix = new THREE.Matrix4();
    const off = new THREE.Color(theme.screenOff);
    const scale = S(0.012, MON_H, MON_W);
    deskScreens.forEach(({ position, quaternion }, i) => {
      matrix.compose(position, quaternion, scale);
      screens.setMatrixAt(i, matrix);
      screens.setColorAt(i, off);
    });
  }
  scene.add(screens);

  // Room names on the floor at each doorway: a dark tag in the light theme, a light tag in the dark one.
  const floorLabels = [];
  const floorLabel = (text, ink, position, width) => {
    const forLight = track(labelTexture(text, ink, false));
    const forDark = track(labelTexture(text, ink, true));
    const material = track(new THREE.MeshBasicMaterial({ map: dark ? forDark : forLight, transparent: true, depthWrite: false, toneMapped: false }));
    const mesh = new THREE.Mesh(PLANE, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(width, width / 4, 1);
    mesh.position.copy(position);
    mesh.renderOrder = 1;
    scene.add(mesh);
    floorLabels.push({ material, forLight, forDark });
  };
  for (const room of rooms) {
    if (!LAYOUT[room.id]) continue;
    floorLabel(room.label, ROOM_INK[room.id], place(room.id, room.id === 'triage' ? -1.0 : 0, 0.62, 0.013), 3.0);
  }
  floorLabel('Done lounge', ROOM_INK.lounge, S(14.2, 0.013, 2.6), 2.7);
  floorLabel('Entrance', '#64748b', S(-10.6, 0.013, -1.6), 2.2);

  // Backlit company sign on the reception wall.
  {
    const texture = track(logoTexture());
    const material = track(new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
    const sign = new THREE.Mesh(PLANE, material);
    sign.scale.set(2.4, 0.6, 1);
    sign.position.copy(place('triage', 0.2, ROOM_D - 0.07, 1.8));
    sign.rotation.y = facingCorridor('triage');
    scene.add(sign);
  }

  // -------------------------------------------------------------------------------------------
  // Characters
  // -------------------------------------------------------------------------------------------

  const BODY = track(new THREE.CapsuleGeometry(0.26, 0.36, 3, 8));
  const HEAD = track(new THREE.SphereGeometry(0.21, 12, 9));
  const HAIR = track(new THREE.SphereGeometry(0.225, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.45));
  const LEG = track(new THREE.BoxGeometry(0.12, 0.36, 0.13).translate(0, -0.18, 0));
  const EYE = track(new THREE.SphereGeometry(0.032, 6, 4));
  // The front of the head, slightly larger than the hair cap, for agents shown with a real person's photo.
  const FACE = track(new THREE.SphereGeometry(0.232, 24, 16, Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.16, Math.PI * 0.52));
  const faceLoader = new THREE.TextureLoader();
  const skins = ['#f1c7a3', '#d9a07a', '#a96f4b', '#7a4c31', '#f5d2b8'].map((c) => std(c, { roughness: 0.6 }));
  const hairs = ['#3b2a20', '#1f2937', '#7c4a1e', '#d6a756', '#5b3a29'].map((c) => std(c, { roughness: 0.85 }));
  const eyeMat = basic('#1f2937');
  const legMat = std('#323a4c', { roughness: 0.85 });
  const bodyMats = new Map();
  const bodyMat = (type) => {
    const color = colorFor(type);
    if (!bodyMats.has(color)) bodyMats.set(color, std(color, { flatShading: true, roughness: 0.7 }));
    return bodyMats.get(color);
  };
  const checkMap = track(checkTexture());
  const checkMat = track(new THREE.SpriteMaterial({ map: checkMap, depthWrite: false, toneMapped: false }));

  const actors = new Map();
  const gone = new Set();
  let clock = 0;

  function buildActor(agent) {
    const seed = hashString(agent.key);
    const root = new THREE.Group();
    const inner = new THREE.Group();
    root.add(inner);

    const body = new THREE.Mesh(BODY, bodyMat(agent.type));
    body.position.y = 0.77;
    const headPivot = new THREE.Group();
    headPivot.position.y = 1.2;
    const skin = skins[seed % skins.length];
    const head = new THREE.Mesh(HEAD, skin);
    head.position.y = 0.18;
    const hair = new THREE.Mesh(HAIR, hairs[(seed >>> 3) % hairs.length]);
    hair.position.set(0, 0.2, -0.012);
    const eyes = [-0.075, 0.075].map((x) => {
      const eye = new THREE.Mesh(EYE, eyeMat);
      eye.position.set(x, 0.2, 0.185);
      return eye;
    });
    headPivot.add(head, hair, ...eyes);
    let faceTexture = null;
    let faceMaterial = null;
    if (agent.person?.photo) {
      faceTexture = faceLoader.load(agent.person.photo);
      faceTexture.colorSpace = THREE.SRGBColorSpace;
      faceMaterial = new THREE.MeshBasicMaterial({ map: faceTexture, toneMapped: false });
      const faceMesh = new THREE.Mesh(FACE, faceMaterial);
      faceMesh.position.y = 0.18;
      headPivot.add(faceMesh);
      for (const eye of eyes) eye.visible = false;
    }
    const legs = [-0.1, 0.1].map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.38, 0);
      const leg = new THREE.Mesh(LEG, legMat);
      leg.castShadow = true;
      pivot.add(leg);
      return pivot;
    });
    inner.add(body, headPivot, ...legs);
    for (const mesh of [body, head, hair]) mesh.castShadow = true;

    const check = new THREE.Sprite(checkMat);
    check.position.y = 1.95;
    check.scale.setScalar(0.001);
    check.visible = false;
    root.add(check);
    scene.add(root);

    // Floating HTML label: name chip plus a speech bubble with the current action and task.
    const label = document.createElement('div');
    label.className = 'agent-label';
    const name = document.createElement('div');
    name.className = 'al-name';
    const dot = document.createElement('span');
    dot.className = 'al-dot';
    const face = document.createElement('img');
    face.className = 'al-face';
    face.alt = '';
    face.hidden = true;
    const nameText = document.createElement('span');
    const aiTag = document.createElement('span');
    aiTag.className = 'ai-tag';
    aiTag.textContent = 'AI';
    aiTag.hidden = true;
    const tick = document.createElement('span');
    tick.className = 'al-check';
    tick.textContent = '✓';
    name.append(dot, face, nameText, aiTag, tick);
    const bubble = document.createElement('div');
    bubble.className = 'al-bubble';
    const action = document.createElement('span');
    action.className = 'al-action';
    const task = document.createElement('span');
    task.className = 'al-task';
    bubble.append(action, task);
    label.append(name, bubble);
    labelLayer.append(label);

    return {
      key: agent.key,
      seed,
      agent,
      root,
      inner,
      body,
      headPivot,
      legs,
      check,
      checkBorn: -1,
      materials: null,
      faceTexture,
      faceMaterial,
      label: { el: label, nameText, face, aiTag, action, task, w: 0, h: 0, dirty: true },
      spot: null,
      path: [],
      yaw: 0,
      sitAmt: 0,
      phase: seed % 7,
      walking: false,
      desk: null,
      seat: null,
      extra: null,
      atCounter: false,
      fadeAt: Infinity,
      opacity: 1,
    };
  }

  function fillLabel(actor) {
    const { agent, label } = actor;
    label.el.dataset.status = agent.status;
    label.el.style.setProperty('--agent', colorFor(agent.type));
    label.nameText.textContent = agent.label || 'Agent';
    // A real person's name on an AI agent is always marked, so the work is never read as theirs.
    label.aiTag.hidden = !agent.person;
    label.aiTag.title = agent.person ? `AI ${agent.role || 'agent'}, shown as ${agent.person.name}` : '';
    label.face.hidden = !agent.person?.photo;
    if (agent.person?.photo && label.face.getAttribute('src') !== agent.person.photo) label.face.src = agent.person.photo;
    label.action.textContent = agent.status === 'resting' ? '…' : agent.text || '';
    label.task.textContent = agent.task || '';
    label.task.hidden = !agent.task;
    label.dirty = true;
  }

  // --- Seats, desks and spots -----------------------------------------------------------------

  const WHITE = new THREE.Color('#ffffff');
  const glowColor = new THREE.Color();
  const offColor = new THREE.Color(theme.screenOff);
  let screensDirty = false;
  function setGlow(desk, key) {
    if (desk.glowKey === key) return;
    desk.glowKey = key;
    const color = key ? glowColor.set(key).lerp(WHITE, 0.45) : offColor;
    const index = desks.indexOf(desk) * 2;
    screens.setColorAt(index, color);
    screens.setColorAt(index + 1, color);
    screensDirty = true;
  }

  const release = (actor, field) => {
    if (actor[field]) {
      actor[field].occupant = null;
      if (field === 'desk') setGlow(actor.desk, '');
    }
    actor[field] = null;
  };
  const releaseAll = (actor) => {
    release(actor, 'desk');
    release(actor, 'seat');
    release(actor, 'extra');
    if (counter.occupant === actor) counter.occupant = null;
  };
  const claim = (list, actor) => {
    const free = list.find((item) => !item.occupant) || list[list.length - 1];
    free.occupant = actor;
    return free;
  };

  function chooseSpot(actor) {
    const { agent } = actor;
    if (agent.status === 'done' || agent.status === 'resting') {
      release(actor, 'desk');
      release(actor, 'extra');
      if (counter.occupant === actor) counter.occupant = null;
      if (!actor.seat) actor.seat = claim(loungeSeats.some((seat) => !seat.occupant) ? loungeSeats : loungeOverflow, actor);
      return actor.seat.spot;
    }
    release(actor, 'seat');
    const room = LAYOUT[agent.stage] ? agent.stage : 'build';
    if (actor.desk && actor.desk.room !== room) release(actor, 'desk');
    if (actor.extra && actor.extra.spot.region !== room) release(actor, 'extra');

    if (agent.status === 'idle' && room === 'triage' && (!counter.occupant || counter.occupant === actor)) {
      release(actor, 'desk');
      release(actor, 'extra');
      counter.occupant = actor;
      return counter.spot;
    }
    if (counter.occupant === actor) counter.occupant = null;

    if (!actor.desk && !actor.extra) {
      const free = desks.find((desk) => desk.room === room && !desk.occupant);
      if (free) {
        free.occupant = actor;
        actor.desk = free;
      } else {
        actor.extra = claim(roomOverflow[room], actor);
      }
    }
    if (actor.desk) return agent.status === 'working' ? actor.desk.sit : actor.desk.stand;
    return actor.extra.spot;
  }

  function routeTo(actor, spot) {
    const position = actor.root.position;
    const from = regionAt(position);
    const to = spot.region;
    const points = [];
    if (from === to && LAYOUT[to]) {
      points.push(place(to, aisleU(to), depthIn(position)), place(to, aisleU(to), depthIn(spot.pos)));
    } else if (from !== to) {
      if (LAYOUT[from]) points.push(place(from, aisleU(from), depthIn(position)), place(from, aisleU(from), 0.15));
      else if (from === 'lounge') points.push(LOUNGE_ENTRY.clone());
      else if (from === 'outside') points.push(DOOR_INSIDE.clone());
      if (LAYOUT[to]) {
        const { cx } = roomFrame(to);
        points.push(S(cx + aisleU(to), 0, 0), place(to, aisleU(to), 0.15), place(to, aisleU(to), depthIn(spot.pos)));
      } else if (to === 'lounge') {
        points.push(LOUNGE_ENTRY.clone());
      }
    }
    if (spot.approach) points.push(spot.approach.clone());
    points.push(spot.pos.clone());

    const path = [];
    let last = position;
    for (const point of points) {
      if (point.distanceTo(last) > 0.05) path.push(point);
      last = point;
    }
    actor.path = path;
  }

  function settle(actor, instant) {
    const spot = chooseSpot(actor);
    if (actor.spot && actor.spot.key === spot.key && !instant) return;
    actor.spot = spot;
    if (instant || motionOff) {
      actor.root.position.copy(spot.pos);
      actor.path = [];
      actor.yaw = spot.yaw;
      actor.sitAmt = spot.sit ? 1 : 0;
    } else {
      routeTo(actor, spot);
    }
  }

  function markDone(actor, instant) {
    const ended = Number.isFinite(actor.agent.endedAt) ? actor.agent.endedAt : Date.now();
    actor.fadeAt = Math.max(ended, Date.now() - FADE_AFTER_MS + 4000) + FADE_AFTER_MS;
    actor.check.visible = true;
    actor.checkBorn = instant || motionOff ? -10 : clock;
    if (instant || motionOff) actor.check.scale.setScalar(0.5);
  }

  function removeActor(actor) {
    releaseAll(actor);
    scene.remove(actor.root);
    actor.label.el.remove();
    if (actor.materials) for (const material of actor.materials) material.dispose();
    actor.faceTexture?.dispose();
    actor.faceMaterial?.dispose();
    actors.delete(actor.key);
  }

  // The built-in Plan agent sits in the planner's chair, so the planner is never shown twice.
  const crewType = (type) => (baseType(type) === 'Plan' ? 'planner' : baseType(type));
  const loungeCrew = () =>
    LOUNGE_CREW.map((type) => withPerson({ key: `crew:${type}`, type, label: roleLabel(type), stage: stageFor(type), status: 'resting', text: '' }));

  /**
   * Who is in the office: while work is going on, the session's agents plus the rest of the crew relaxing
   * in the Done lounge; when nothing is being worked on, the whole crew in the lounge. A crew member who
   * finishes rejoins the lounge, so each role appears once.
   */
  function castFor(agents) {
    if (!agents.some((agent) => agent.status === 'working')) return loungeCrew();
    const onDuty = agents.filter((agent) => !(agent.status === 'done' && LOUNGE_CREW.includes(crewType(agent.type))));
    const busyTypes = new Set(onDuty.map((agent) => crewType(agent.type)));
    return [...onDuty, ...loungeCrew().filter((member) => !busyTypes.has(member.type))];
  }

  function sync(agents, { reset = false } = {}) {
    if (reset) {
      for (const actor of [...actors.values()]) removeActor(actor);
      gone.clear();
    }
    const cast = castFor(agents);
    const castKeys = new Set(cast.map((agent) => agent.key));
    // A character who leaves hands its place to the next one in the same role, so people walk from the
    // lounge to their desk and back instead of vanishing in one place and appearing in another.
    const handover = new Map();
    for (const actor of [...actors.values()]) {
      if (castKeys.has(actor.key)) continue;
      const type = crewType(actor.agent.type);
      handover.set(type, [...(handover.get(type) || []), { position: actor.root.position.clone(), yaw: actor.yaw }]);
      removeActor(actor);
    }
    const now = Date.now();
    for (const agent of cast) {
      if (gone.has(agent.key)) continue;
      let actor = actors.get(agent.key);
      if (!actor) {
        // Agents that finished long ago have already left the office.
        if (agent.status === 'done' && Number.isFinite(agent.endedAt) && now - agent.endedAt > FADE_AFTER_MS) {
          gone.add(agent.key);
          continue;
        }
        actor = buildActor(agent);
        actors.set(agent.key, actor);
        fillLabel(actor);
        if (reset) {
          settle(actor, true);
          if (agent.status === 'done') markDone(actor, true);
        } else {
          const from = handover.get(crewType(agent.type))?.shift();
          const room = LAYOUT[agent.stage] ? agent.stage : 'build';
          if (from) {
            actor.root.position.copy(from.position);
            actor.yaw = from.yaw;
          } else if (agent.status === 'resting') {
            actor.root.position.copy(place(room, aisleU(room), 0.15));
          } else {
            actor.root.position.copy(DOOR_OUTSIDE);
            actor.yaw = Math.PI / 2;
          }
          settle(actor, false);
          if (agent.status === 'done') markDone(actor, false);
        }
        continue;
      }
      const wasDone = actor.agent.status === 'done';
      actor.agent = agent;
      fillLabel(actor);
      if (agent.status === 'done' && !wasDone) markDone(actor, false);
      if (agent.status !== 'done' && wasDone) {
        actor.check.visible = false;
        actor.fadeAt = Infinity;
      }
      settle(actor, false);
    }
  }

  // --- Hand-off arcs --------------------------------------------------------------------------

  const arcs = [];
  function handoff(event) {
    const router = actors.get(`${event.session}:${event.agentId}`);
    const from = router ? router.root.position.clone().setY(1.7) : place('triage', 1.5, 2.2, 1.7);
    const room = stageFor(event.target);
    const to = place(LAYOUT[room] ? room : 'build', 0, 3.2, 0.9);
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 3 + from.distanceTo(to) * 0.18;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const geometry = new THREE.TubeGeometry(curve, 48, 0.06, 6, false);
    const material = new THREE.MeshBasicMaterial({ color: theme.arc, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending });
    const tube = new THREE.Mesh(geometry, material);
    const packet = new THREE.Mesh(BALL, material);
    packet.scale.setScalar(0.32);
    const ring = new THREE.Mesh(RING, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(to).setY(0.03);
    ring.visible = false;
    scene.add(tube, packet, ring);
    arcs.push({ curve, tube, packet, ring, material, geometry, born: clock, count: geometry.index.count });
  }

  function updateArcs() {
    for (let i = arcs.length - 1; i >= 0; i--) {
      const arc = arcs[i];
      const age = clock - arc.born;
      const travel = motionOff ? 1 : Math.min(1, age / 0.75);
      const quads = Math.floor((arc.count / 6) * travel) * 6;
      arc.geometry.setDrawRange(0, quads);
      arc.packet.visible = !motionOff && travel < 1;
      if (arc.packet.visible) arc.curve.getPoint(travel, arc.packet.position);
      if (travel >= 1 && !motionOff) {
        arc.ring.visible = true;
        const grow = Math.min(1, (age - 0.75) / 0.8);
        arc.ring.scale.setScalar(0.4 + grow * 1.8);
      }
      const fadeStart = motionOff ? 0.4 : 1.1;
      arc.material.opacity = 0.95 * (1 - THREE.MathUtils.clamp((age - fadeStart) / 0.8, 0, 1));
      if (age > fadeStart + 0.8) {
        scene.remove(arc.tube, arc.packet, arc.ring);
        arc.geometry.dispose();
        arc.material.dispose();
        arcs.splice(i, 1);
      }
    }
  }

  // --- Lounge chat ----------------------------------------------------------------------------

  // Seated crew members take turns talking; the others turn their heads to the speaker.
  const CHAT_TURN_S = 3.2;
  let speaker = null;
  let chatTimer = 0;
  const seatedAndResting = (actor) => actor.agent.status === 'resting' && !actor.path.length && actor.sitAmt > 0.8;

  function updateChat(dt) {
    chatTimer -= dt;
    if (speaker && (!actors.has(speaker.key) || !seatedAndResting(speaker))) chatTimer = 0;
    if (chatTimer > 0) return;
    chatTimer = CHAT_TURN_S;
    const seated = [...actors.values()].filter(seatedAndResting);
    const choices = seated.filter((actor) => actor !== speaker);
    const next = choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
    if (speaker !== next) {
      for (const actor of [speaker, next]) {
        if (!actor || !actors.has(actor.key)) continue;
        actor.label.el.dataset.talking = String(actor === next);
        actor.label.dirty = true;
      }
    }
    speaker = next;
  }

  const lookTarget = new THREE.Vector3();
  function headTurn(actor) {
    if (!seatedAndResting(actor)) return 0;
    lookTarget.copy(speaker && speaker !== actor ? speaker.root.position : RUG_CENTER);
    const toward = Math.atan2(lookTarget.x - actor.root.position.x, lookTarget.z - actor.root.position.z);
    let diff = (toward - actor.yaw) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return THREE.MathUtils.clamp(diff, -0.9, 0.9);
  }

  // --- Per-frame character update -------------------------------------------------------------


  function angleLerp(from, to, t) {
    let diff = (to - from) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return from + diff * t;
  }

  function updateActor(actor, dt, nowMs) {
    const position = actor.root.position;
    let moving = false;
    if (actor.path.length) {
      let step = WALK_SPEED * dt;
      while (step > 0 && actor.path.length) {
        const next = actor.path[0];
        const dx = next.x - position.x;
        const dz = next.z - position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.001) actor.targetYaw = Math.atan2(dx, dz);
        if (distance <= step) {
          position.set(next.x, 0, next.z);
          actor.path.shift();
          step -= distance;
        } else {
          position.x += (dx / distance) * step;
          position.z += (dz / distance) * step;
          step = 0;
        }
      }
      moving = true;
    }
    const arrived = !actor.path.length;
    const spot = actor.spot;
    const yawGoal = arrived && spot ? spot.yaw : actor.targetYaw ?? actor.yaw;
    actor.yaw = angleLerp(actor.yaw, yawGoal, 1 - Math.exp(-dt * 12));
    actor.root.rotation.y = actor.yaw;

    const sitGoal = arrived && spot?.sit ? 1 : 0;
    actor.sitAmt += (sitGoal - actor.sitAmt) * (1 - Math.exp(-dt * (motionOff ? 100 : 9)));

    let bob = 0;
    let swing = 0;
    if (moving && !motionOff) {
      actor.phase += dt * 14;
      swing = Math.sin(actor.phase) * 0.6;
      bob = Math.abs(Math.sin(actor.phase)) * 0.07;
    }
    const working = actor.agent.status === 'working' && arrived && actor.sitAmt > 0.8;
    let nod = 0;
    if (!motionOff) {
      if (working) {
        nod = 0.1 + Math.sin(clock * 7 + actor.seed) * 0.07;
        bob += Math.abs(Math.sin(clock * 15 + actor.seed)) * 0.014;
      } else if (!moving) {
        bob += Math.sin(clock * 2 + actor.seed) * 0.008;
      }
    } else if (working) {
      nod = 0.12;
    }
    if (actor === speaker && !motionOff) nod = Math.sin(clock * 8 + actor.seed) * 0.09;
    actor.headPivot.rotation.x = nod;
    const turn = headTurn(actor);
    actor.headPivot.rotation.y = motionOff ? turn : actor.headPivot.rotation.y + (turn - actor.headPivot.rotation.y) * (1 - Math.exp(-dt * 5));
    actor.inner.position.y = actor.sitAmt * SIT_LIFT + bob;
    const legSit = -actor.sitAmt * Math.PI / 2;
    actor.legs[0].rotation.x = legSit + swing * (1 - actor.sitAmt);
    actor.legs[1].rotation.x = legSit - swing * (1 - actor.sitAmt);
    actor.body.rotation.z = moving && !motionOff ? Math.sin(actor.phase) * 0.04 : 0;

    // Monitor glow follows whoever is actually seated and working at the desk.
    if (actor.desk) setGlow(actor.desk, working ? colorFor(actor.agent.type) : '');

    if (actor.check.visible) {
      const age = clock - actor.checkBorn;
      const pop = age < 0.45 ? easeOutBack(Math.max(0, age) / 0.45) : 1;
      actor.check.scale.setScalar(0.5 * pop);
      actor.check.position.y = 1.95 + actor.inner.position.y + (motionOff ? 0 : Math.sin(clock * 3 + actor.seed) * 0.05);
    }

    if (nowMs >= actor.fadeAt) {
      if (!actor.materials) {
        actor.materials = [];
        actor.root.traverse((object) => {
          if (!object.material) return;
          const material = object.material.clone();
          material.transparent = true;
          material.depthWrite = false;
          object.material = material;
          actor.materials.push(material);
        });
      }
      actor.opacity = 1 - (nowMs - actor.fadeAt) / FADE_MS;
      for (const material of actor.materials) material.opacity = Math.max(0, actor.opacity);
      actor.label.el.style.opacity = String(Math.max(0, actor.opacity));
      if (actor.opacity <= 0) {
        gone.add(actor.key);
        removeActor(actor);
      }
    }
  }

  const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

  // --- Labels ---------------------------------------------------------------------------------

  const projected = new THREE.Vector3();
  const placed = [];
  let viewW = 1;
  let viewH = 1;

  function updateLabels() {
    placed.length = 0;
    const items = [];
    for (const actor of actors.values()) {
      const { label } = actor;
      if (label.dirty) {
        label.w = label.el.offsetWidth;
        label.h = label.el.offsetHeight;
        label.dirty = false;
      }
      const lift = actor.agent.status === 'done' ? 2.35 : 1.82;
      projected.copy(actor.root.position);
      projected.y += lift + actor.inner.position.y;
      projected.project(camera);
      const visible = projected.z < 1 && Math.abs(projected.x) < 1.2 && Math.abs(projected.y) < 1.2;
      items.push({ actor, x: (projected.x + 1) * 0.5 * viewW, y: (1 - projected.y) * 0.5 * viewH, visible, depth: projected.z });
    }
    // Nearest first, then nudge each label up until it no longer covers one already placed.
    items.sort((a, b) => a.depth - b.depth);
    for (const item of items) {
      const { label } = item.actor;
      if (!item.visible) {
        label.el.hidden = true;
        continue;
      }
      const anchorTop = item.y - label.h;
      let top = anchorTop;
      const left = THREE.MathUtils.clamp(item.x - label.w / 2, 4, Math.max(4, viewW - label.w - 4));
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find((r) => left < r.left + r.w && left + label.w > r.left && top < r.top + r.h && top + label.h > r.top);
        if (!hit) break;
        top = hit.top - label.h - 2;
      }
      // A label pushed far from its character would point at the wrong person; the panel still lists it.
      if (anchorTop - top > 84 || top < 2) {
        label.el.hidden = true;
        continue;
      }
      label.el.hidden = false;
      placed.push({ left, top, w: label.w, h: label.h });
      label.el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    }
  }

  // --- Camera ---------------------------------------------------------------------------------

  let fitRadius = 40;
  let defaultView = WIDE_VIEW;
  let userMoved = false;
  const view = { theta: defaultView.theta, phi: defaultView.phi, zoom: 1 };
  const goal = { ...view };
  const UP = new THREE.Vector3(0, 1, 0);

  /** Distance at which the whole office box fits the viewport for this camera direction. */
  function fitFor(theta, phi) {
    const toCamera = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    const right = new THREE.Vector3().crossVectors(toCamera.clone().negate(), UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, toCamera.clone().negate());
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanH = tanV * camera.aspect;
    const corner = new THREE.Vector3();
    let radius = 0;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? FIT_BOX.max.x : FIT_BOX.min.x, i & 2 ? FIT_BOX.max.y : FIT_BOX.min.y, i & 4 ? FIT_BOX.max.z : FIT_BOX.min.z).sub(OFFICE_CENTER);
      const along = corner.dot(toCamera);
      radius = Math.max(radius, Math.abs(corner.dot(right)) / tanH + along, Math.abs(corner.dot(up)) / tanV + along);
    }
    return radius * 1.03;
  }

  function clampGoal() {
    userMoved = true;
    goal.phi = THREE.MathUtils.clamp(goal.phi, LIMITS.phiMin, LIMITS.phiMax);
    goal.theta = THREE.MathUtils.clamp(goal.theta, LIMITS.thetaMin, LIMITS.thetaMax);
    goal.zoom = THREE.MathUtils.clamp(goal.zoom, LIMITS.zoomMin, LIMITS.zoomMax);
  }

  function updateCamera(dt) {
    const t = motionOff ? 1 : 1 - Math.exp(-dt * 9);
    view.theta += (goal.theta - view.theta) * t;
    view.phi += (goal.phi - view.phi) * t;
    view.zoom += (goal.zoom - view.zoom) * t;
    const radius = fitRadius * view.zoom;
    camera.position.set(
      OFFICE_CENTER.x + radius * Math.sin(view.phi) * Math.sin(view.theta),
      radius * Math.cos(view.phi),
      OFFICE_CENTER.z + radius * Math.sin(view.phi) * Math.cos(view.theta),
    );
    camera.lookAt(OFFICE_CENTER);
  }

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    viewW = width;
    viewH = height;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    defaultView = camera.aspect < 0.9 ? TALL_VIEW : WIDE_VIEW;
    if (!userMoved) Object.assign(goal, { theta: defaultView.theta, phi: defaultView.phi });
    if (!userMoved && !running) Object.assign(view, { theta: defaultView.theta, phi: defaultView.phi });
    fitRadius = fitFor(defaultView.theta, defaultView.phi);
    camera.far = fitRadius * 4;
    camera.updateProjectionMatrix();
    for (const actor of actors.values()) actor.label.dirty = true;
  }

  const pointers = new Map();
  let pinchDistance = 0;
  const canvas = renderer.domElement;

  const onPointerDown = (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) pinchDistance = spread();
  };
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const onPointerMove = (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last.x = event.clientX;
    last.y = event.clientY;
    if (pointers.size === 1) {
      goal.theta -= dx * 0.006;
      goal.phi -= dy * 0.005;
    } else if (pointers.size === 2) {
      const distance = spread();
      goal.zoom *= pinchDistance / distance;
      pinchDistance = distance;
    }
    clampGoal();
  };
  const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 2) pinchDistance = spread();
  };
  const onWheel = (event) => {
    event.preventDefault();
    goal.zoom *= Math.exp(event.deltaY * 0.0012);
    clampGoal();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const onContextLost = (event) => {
    event.preventDefault();
    stop();
    onFail('The 3D view lost its graphics context, so the 2D board is shown.');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  // --- Theme ----------------------------------------------------------------------------------

  function applyTheme(isDark) {
    dark = isDark;
    theme = isDark ? THEMES.dark : THEMES.light;
    scene.background = isDark ? backdrop.dark : backdrop.light;
    poolMat.color.set(theme.pool);
    scene.environmentIntensity = theme.env;
    renderer.toneMappingExposure = theme.exposure;
    hemi.color.set(theme.hemiSky);
    hemi.groundColor.set(theme.hemiGround);
    hemi.intensity = theme.hemi;
    sun.color.set(theme.sun);
    sun.intensity = theme.sunI;
    for (const light of lampLights) light.visible = theme.lamps;
    for (const material of glowMaterials) {
      material.emissive.set(theme.glow);
      material.emissiveIntensity = theme.glowI;
    }
    const view = isDark ? sky.night : sky.day;
    skyWide.map = view.wide;
    skyNarrow.map = view.narrow;
    for (const label of floorLabels) label.material.map = isDark ? label.forDark : label.forLight;
    offColor.set(theme.screenOff);
    desks.forEach((desk, index) => {
      if (desk.glowKey) return;
      screens.setColorAt(index * 2, offColor);
      screens.setColorAt(index * 2 + 1, offColor);
    });
    screensDirty = true;
  }

  // --- Loop -----------------------------------------------------------------------------------

  let raf = 0;
  let running = false;
  let inView = true;
  let disposed = false;
  let lastTime = 0;
  let ledTimer = 0;
  const ledColor = new THREE.Color();

  function frame(time) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, lastTime ? (time - lastTime) / 1000 : 0.016);
    lastTime = time;
    clock += dt;
    const nowMs = Date.now();

    updateChat(dt);
    for (const actor of [...actors.values()]) updateActor(actor, dt, nowMs);
    updateArcs();
    updateCamera(dt);

    if (!motionOff && ledMesh) {
      ledTimer += dt;
      if (ledTimer > 0.22) {
        ledTimer = 0;
        for (let i = 0; i < 3; i++) {
          const index = leds[Math.floor(Math.random() * leds.length)];
          ledMesh.setColorAt(index, ledColor.set(ledColors[Math.floor(Math.random() * ledColors.length)]).multiplyScalar(Math.random() < 0.3 ? 0.35 : 1));
        }
        ledMesh.instanceColor.needsUpdate = true;
      }
    }
    if (screensDirty) {
      screens.instanceColor.needsUpdate = true;
      screensDirty = false;
    }

    renderer.render(scene, camera);
    updateLabels();
  }

  function start() {
    if (running || disposed || document.hidden || !inView) return;
    running = true;
    lastTime = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);
  const intersection = new IntersectionObserver((entries) => {
    inView = entries.some((entry) => entry.isIntersecting);
    if (inView) start();
    else stop();
  });
  intersection.observe(container);
  const resizer = new ResizeObserver(() => resize());
  resizer.observe(container);

  resize();
  updateCamera(1);
  start();

  return {
    sync,
    handoff,
    rotate(direction) {
      goal.theta += direction * 0.45;
      clampGoal();
    },
    zoom(direction) {
      goal.zoom *= direction > 0 ? 1.2 : 1 / 1.2;
      clampGoal();
    },
    resetView() {
      userMoved = false;
      Object.assign(goal, { theta: defaultView.theta, phi: defaultView.phi, zoom: 1 });
    },
    setDark(isDark) {
      applyTheme(isDark);
    },
    setReducedMotion(value) {
      motionOff = value;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      intersection.disconnect();
      resizer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      for (const actor of [...actors.values()]) removeActor(actor);
      for (const arc of arcs) {
        arc.geometry.dispose();
        arc.material.dispose();
      }
      arcs.length = 0;
      for (const mesh of instanced.values()) mesh.dispose();
      screens.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      container.replaceChildren();
    },
  };
}
