// Korean street signs: one single-channel (R8) glyph atlas built at runtime
// from the label table, drawn as instanced quads (one draw call for all signs).

import * as THREE from 'three';

export interface LabelDef {
  t: string;
  fg: string;
  bg: string;
  b?: number;
}

export interface SignInst {
  x: number;
  y: number;
  z: number;
  yaw: number;
  w: number;
  h: number;
  label: number;
  vertical: boolean;
}

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FONT = '700 40px Pretendard, sans-serif';
const ATLAS_W = 2048;

function buildAtlas(labels: LabelDef[], uses: Set<string>) {
  const canvas = document.createElement('canvas');
  const ctx0 = canvas.getContext('2d')!;
  ctx0.font = FONT;
  const items: { key: string; text: string; vertical: boolean; w: number; h: number }[] = [];
  for (const key of uses) {
    const [li, v] = key.split(':');
    const text = labels[+li].t;
    const vertical = v === '1';
    if (vertical) {
      const chars = [...text.replace(/\s+/g, '')];
      items.push({ key, text, vertical, w: 54, h: chars.length * 46 + 14 });
    } else {
      items.push({ key, text, vertical, w: Math.ceil(ctx0.measureText(text).width + 22), h: 54 });
    }
  }
  items.sort((a, b) => b.h - a.h);
  // Shelf packing.
  const cells = new Map<string, Cell>();
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const it of items) {
    if (x + it.w > ATLAS_W) {
      x = 0;
      y += shelf + 2;
      shelf = 0;
    }
    cells.set(it.key, { x, y, w: it.w, h: it.h });
    x += it.w + 2;
    shelf = Math.max(shelf, it.h);
  }
  const H = Math.max(64, 2 ** Math.ceil(Math.log2(y + shelf + 2)));
  canvas.width = ATLAS_W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ATLAS_W, H);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = FONT;
  for (const it of items) {
    const c = cells.get(it.key)!;
    if (it.vertical) {
      const chars = [...it.text.replace(/\s+/g, '')];
      chars.forEach((ch, i) => ctx.fillText(ch, c.x + c.w / 2, c.y + 7 + i * 46 + 25));
    } else {
      ctx.fillText(it.text, c.x + c.w / 2, c.y + c.h / 2 + 3);
    }
  }
  // Red channel only, flipped to GL row order (row 0 = bottom).
  const img = ctx.getImageData(0, 0, ATLAS_W, H).data;
  const data = new Uint8Array(ATLAS_W * H);
  for (let row = 0; row < H; row++) {
    const src = (H - 1 - row) * ATLAS_W * 4;
    const dst = row * ATLAS_W;
    for (let i = 0; i < ATLAS_W; i++) data[dst + i] = img[src + i * 4];
  }
  const tex = new THREE.DataTexture(data, ATLAS_W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, cells, H };
}

const vert = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aRect;
attribute vec3 aFg;
attribute vec3 aBg;
attribute vec4 aMeta;
varying vec2 vUv;
varying vec4 vRect;
varying vec3 vFg;
varying vec3 vBg;
varying vec4 vMeta;
void main() {
  vUv = uv;
  vRect = aRect;
  vFg = aFg;
  vBg = aBg;
  vMeta = aMeta;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uAtlas;
uniform float uNight;
varying vec2 vUv;
varying vec4 vRect;
varying vec3 vFg;
varying vec3 vBg;
varying vec4 vMeta;
void main() {
  vec2 uv = vUv;
  if (!gl_FrontFacing) uv.x = 1.0 - uv.x;
  vec2 b = vec2(0.07) / vMeta.xy;
  bool border = uv.x < b.x || uv.x > 1.0 - b.x || uv.y < b.y || uv.y > 1.0 - b.y;
  vec2 t = (uv - b) / (1.0 - 2.0 * b);
  // Contain-fit the atlas cell into the sign, keeping the glyph aspect.
  float signAsp = (vMeta.x - 0.14) / (vMeta.y - 0.14);
  float cellAsp = vMeta.z;
  if (signAsp > cellAsp) t.x = (t.x - 0.5) * signAsp / cellAsp + 0.5;
  else t.y = (t.y - 0.5) * cellAsp / signAsp + 0.5;
  float m = 0.0;
  if (t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0) {
    m = texture2D(uAtlas, mix(vRect.xy, vRect.zw, t)).r;
  }
  vec3 col = mix(vBg, vFg, smoothstep(0.3, 0.7, m));
  if (border) col = vBg * 0.5;
  col *= mix(0.95, 2.1, uNight);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function buildSigns(labels: LabelDef[], signs: SignInst[], night: { value: number }) {
  const uses = new Set<string>();
  for (const s of signs) uses.add(`${s.label}:${s.vertical ? 1 : 0}`);
  const { tex, cells, H } = buildAtlas(labels, uses);

  const geo = new THREE.PlaneGeometry(1, 1);
  const n = signs.length;
  const rect = new Float32Array(n * 4);
  const fg = new Float32Array(n * 3);
  const bg = new Float32Array(n * 3);
  const meta = new Float32Array(n * 4);
  const col = new THREE.Color();
  signs.forEach((s, i) => {
    const c = cells.get(`${s.label}:${s.vertical ? 1 : 0}`)!;
    // u0, v0 (bottom), u1, v1 (top) in GL convention.
    rect[i * 4] = (c.x + 0.5) / ATLAS_W;
    rect[i * 4 + 1] = (H - c.y - c.h + 0.5) / H;
    rect[i * 4 + 2] = (c.x + c.w - 0.5) / ATLAS_W;
    rect[i * 4 + 3] = (H - c.y - 0.5) / H;
    col.set(labels[s.label].fg);
    fg.set([col.r, col.g, col.b], i * 3);
    col.set(labels[s.label].bg);
    bg.set([col.r, col.g, col.b], i * 3);
    meta.set([s.w, s.h, c.w / c.h, s.vertical ? 1 : 0], i * 4);
  });
  geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geo.setAttribute('aFg', new THREE.InstancedBufferAttribute(fg, 3));
  geo.setAttribute('aBg', new THREE.InstancedBufferAttribute(bg, 3));
  geo.setAttribute('aMeta', new THREE.InstancedBufferAttribute(meta, 4));

  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null } }]),
    fog: true,
    side: THREE.DoubleSide,
  });
  mat.uniforms.uAtlas.value = tex;
  mat.uniforms.uNight = night;

  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  signs.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.w, s.h, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return { mesh, atlasBytes: ATLAS_W * H };
}
