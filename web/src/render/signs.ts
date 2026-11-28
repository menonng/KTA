// Korean street signs v2: pre-rendered artwork (tools/signgen) in a
// compressed texture array, drawn as lit instanced quads with emission from
// the alpha channel, plus light boxes / brackets for depth.
//
// Atlas alpha: a < 0.5 -> coverage (cut-out styles), a >= 0.5 -> opaque with
// emission (a - 0.5) * 2. Horizontal artwork is trimmed to its content width
// and the shader stretches the edge columns to the full sign width.

import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export interface SignBox {
  color: string;
  depth: number;
  legs?: boolean;
  /** Storefront cladding colour: pilasters and kick plate around the glass. */
  frame?: string | null;
  disc?: boolean;
  awning?: boolean;
}

export interface SignMeta {
  t: string;
  st: string;
  l: number;
  r: [number, number, number, number];
  iw: number;
  px: [number, number];
  off: number;
  box: SignBox | null;
  g: string;
}

export interface SignAtlas {
  attribution: string;
  pages: number;
  size: number;
  signs: SignMeta[];
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
  /** 0 wall, 1 window decal, 2 awning, 3 standing light box, 4 round blade sign, 5 rooftop cross. */
  mount: number;
}

export const MOUNT = { wall: 0, decal: 1, awning: 2, stand: 3, disc: 4, cross: 5 } as const;

/** Load the per-page KTX2 files and merge them into one array texture. */
function dropArray(this: THREE.BufferAttribute) {
  (this as unknown as { array: unknown }).array = null;
}

export async function loadSignTexture(renderer: THREE.WebGLRenderer, pages: number): Promise<{ tex: THREE.CompressedArrayTexture; bytes: number }> {
  const loader = new KTX2Loader().setTranscoderPath('basis/').detectSupport(renderer);
  const parts = (await Promise.all(Array.from({ length: pages }, (_, i) => loader.loadAsync(`textures/signs_${i}.ktx2`)))) as THREE.CompressedTexture[];
  loader.dispose();
  const first = parts[0];
  let bytes = 0;
  const mipmaps = first.mipmaps!.map((m0, level) => {
    const len = (m0.data as Uint8Array).byteLength;
    const data = new Uint8Array(len * pages);
    parts.forEach((p, i) => data.set(p.mipmaps![level].data as Uint8Array, i * len));
    bytes += data.byteLength;
    return { data, width: m0.width, height: m0.height };
  });
  // The per-page textures stay referenced by the loader's internal cache:
  // drop their pixel data explicitly so only the merged copy (freed after
  // upload) remains.
  for (const p of parts) {
    for (const m of p.mipmaps as unknown as { data: Uint8Array }[]) m.data = new Uint8Array(0);
    p.dispose();
  }
  const tex = new THREE.CompressedArrayTexture(mipmaps as unknown as THREE.CompressedTextureMipmap[], first.image.width, first.image.height, pages, first.format as THREE.CompressedPixelFormat, first.type);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  // Drop the CPU copy once uploaded: nothing reads it back.
  tex.onUpdate = () => {
    for (const m of tex.mipmaps as unknown as { data: Uint8Array | null }[]) m.data = new Uint8Array(0);
  };
  return { tex, bytes };
}

const HASH = /* glsl */ `
float sH2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float sN(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sH2(i), sH2(i + vec2(1.0, 0.0)), f.x), mix(sH2(i + vec2(0.0, 1.0)), sH2(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

function signMaterial(night: { value: number }, atlasSize: number) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.0 });
  const tSigns = { value: null as THREE.Texture | null };
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = night;
    s.uniforms.tSigns = tSigns;
    s.uniforms.uSize = { value: atlasSize };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRect;\nattribute vec4 aInfo;\nvarying vec2 vSUv;\nflat varying vec4 vRect;\nflat varying vec4 vInfo;\nflat varying float vSeed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSUv = uv;\nvRect = aRect;\nvInfo = aInfo;\nvSeed = float(gl_InstanceID);');
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray tSigns;\nuniform float uNight;\nuniform float uSize;\nvarying vec2 vSUv;\nflat varying vec4 vRect;\nflat varying vec4 vInfo;\nflat varying float vSeed;\n${HASH}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // vInfo: layer, sign width (m), sign height (m), artwork width (m)
        float xm = (vSUv.x - 0.5) * vInfo.y;
        float pxW = (vRect.z - vRect.x) * uSize;
        float e = 1.5 / pxW;
        // Wider sign: stretch the edge columns; narrower: condense the artwork.
        // Negative artwork width = horizontal tile period (awning fabric).
        float txr = vInfo.w < 0.0 ? xm / -vInfo.w + 0.5 : xm / min(vInfo.w, vInfo.y) + 0.5;
        float tx = clamp(vInfo.w < 0.0 ? fract(txr) : txr, e, 1.0 - e);
        vec2 auv = vec2(mix(vRect.x, vRect.z, tx), mix(vRect.y, vRect.w, vSUv.y));
        // Mip selection from the unwrapped coordinate: no seams where the tile wraps.
        vec2 auvR = vec2(mix(vRect.x, vRect.z, txr), auv.y);
        vec2 gdx = dFdx(auvR);
        vec2 gdy = dFdy(auvR);
        // Awning fabric is constant along v and seen at grazing angles: pick the
        // mip from u alone so the stripes stay crisp without anisotropic filtering.
        if (vInfo.w < 0.0) { gdx.y *= 0.1; gdy.y *= 0.1; }
        vec4 sc = textureGrad(tSigns, vec3(auv, vInfo.x), gdx, gdy);
        float op = min(sc.a * 2.0, 1.0);
        float em = max(sc.a * 2.0 - 1.0, 0.0);
        vec2 tp = auvR * uSize;
        float lod = 0.5 * log2(max(max(dot(dFdx(tp), dFdx(tp)), dot(dFdy(tp), dFdy(tp))), 1e-6));
        if (op < mix(0.5, 0.28, clamp(lod / 3.0, 0.0, 1.0))) discard;
        // Weathering in sign space (consistent across the stretched edges).
        float age = sH2(vec2(vSeed, 7.1));
        vec2 sp = vec2(xm, vSUv.y * vInfo.z);
        float grime = (smoothstep(0.45, 0.0, vSUv.y) * 0.6 + sN(sp * 2.3 + vSeed) * 0.5 + sN(sp * vec2(1.0, 0.25) * 6.0 + vSeed * 3.0) * 0.4) * age;
        vec3 sCol = sc.rgb * (1.0 - 0.2 * grime);
        diffuseColor.rgb = sCol;
        vec3 sEm = sCol * em;`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += sEm * mix(0.3, 1.3, uNight);');
  };
  m.customProgramCacheKey = () => 'kta-signs-5';
  return { m, tSigns };
}

export function buildSigns(atlas: SignAtlas, input: SignInst[], night: { value: number }) {
  // Mount 6 (roller shutters) are models, not artwork.
  input = input.filter((s) => s.mount !== 6);
  // Vertical signs are boxes seen from both sides: a face on each side.
  type Face = SignInst & { meta: SignMeta; pitch?: number; rect?: [number, number, number, number] };
  const faces: Face[] = [];
  const AWN_TILT = 0.36; // awning slope below horizontal (rad)
  const AWN_VAL = 0.26; // valance drop (m)
  for (const s of input) {
    const meta = atlas.signs[s.label];
    if (!meta) continue;
    const nx = Math.sin(s.yaw);
    const nz = Math.cos(s.yaw);
    if (s.mount === MOUNT.awning) {
      // Tile rows 0-70 % are the slope, the rest the valance (see signgen).
      const [u0, vb, u1, vt] = meta.r;
      const vs = vt + 0.7 * (vb - vt);
      const L = s.h;
      const out = Math.cos(AWN_TILT) * L;
      const drop = Math.sin(AWN_TILT) * L;
      faces.push({ ...s, x: s.x + nx * out * 0.5, z: s.z + nz * out * 0.5, y: s.y - drop * 0.5, h: L, meta, pitch: -(Math.PI / 2 - AWN_TILT), rect: [u0, vs, u1, vt] });
      faces.push({ ...s, x: s.x + nx * (out + 0.004), z: s.z + nz * (out + 0.004), y: s.y - drop - AWN_VAL * 0.5, h: AWN_VAL, meta, rect: [u0, vb, u1, vs] });
      // Underside: the same fabric seen from the pavement (stripes show through).
      const lo = 0.026;
      faces.push({ ...s, x: s.x + nx * (out * 0.5 - Math.sin(AWN_TILT) * lo), z: s.z + nz * (out * 0.5 - Math.sin(AWN_TILT) * lo), y: s.y - drop * 0.5 - Math.cos(AWN_TILT) * lo, h: L, meta, pitch: Math.PI / 2 + AWN_TILT, rect: [u0, vs, u1, vt] });
      continue;
    }
    if (s.vertical) {
      const half = (meta.box?.depth ?? 0.3) * 0.5 + 0.006;
      faces.push({ ...s, x: s.x + nx * half, z: s.z + nz * half, meta });
      faces.push({ ...s, x: s.x - nx * half, z: s.z - nz * half, yaw: s.yaw + Math.PI, meta });
    } else {
      faces.push({ ...s, x: s.x - nx * meta.off, z: s.z - nz * meta.off, meta });
    }
  }

  // Spatial cells (128 m): each cell is its own instanced mesh so the main
  // and shadow cameras cull far signage instead of drawing all of it.
  const CELL = 128;
  const keyOf = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const group = new THREE.Group();
  const { m: mat, tSigns } = signMaterial(night, atlas.size);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.15 });
  const plane = new THREE.PlaneGeometry(1, 1);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const qp = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  const faceCells = new Map<string, Face[]>();
  for (const f of faces) {
    const k = keyOf(f.x, f.z);
    (faceCells.get(k) ?? faceCells.set(k, []).get(k)!).push(f);
  }
  let faceCount = 0;
  for (const list of faceCells.values()) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('normal', plane.getAttribute('normal'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    const rect = new Float32Array(list.length * 4);
    const info = new Float32Array(list.length * 4);
    list.forEach((f, i) => {
      rect.set(f.rect ?? f.meta.r, i * 4);
      info.set([f.meta.l, f.w, f.h, f.meta.iw], i * 4);
    });
    geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4).onUpload(dropArray));
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4).onUpload(dropArray));
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((f, i) => {
      q.setFromAxisAngle(up, f.yaw);
      if (f.pitch) q.multiply(qp.setFromAxisAngle(xAxis, f.pitch));
      mesh.setMatrixAt(i, m4.compose(pos.set(f.x, f.y, f.z), q, scl.set(f.w, f.h, 1)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.instanceMatrix.onUpload(dropArray); // static: no CPU copy needed after upload
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    faceCount += list.length;
  }

  // Light boxes, panels, brackets and billboard legs.
  type BoxI = { x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number; col: THREE.Color; pitch?: number };
  const boxCells = new Map<string, BoxI[]>();
  const add = (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, col: THREE.Color, pitch?: number) => {
    const k = keyOf(x, z);
    (boxCells.get(k) ?? boxCells.set(k, []).get(k)!).push({ x, y, z, yaw, sx, sy, sz, col, pitch });
  };
  const discs: BoxI[] = [];
  const dark = new THREE.Color(0x2a2c30);
  const steel = new THREE.Color(0x4a4d52);
  for (const s of input) {
    const meta = atlas.signs[s.label];
    if (!meta) continue;
    const nx = Math.sin(s.yaw);
    const nz = Math.cos(s.yaw);
    const b = meta.box;
    // Tangent along the wall for wall-mounted signs.
    const tx = Math.cos(s.yaw);
    const tz = -Math.sin(s.yaw);
    if (s.mount === MOUNT.awning) {
      // Fabric underside (casts the shadow) just below the printed slope.
      const L = s.h;
      const out = Math.cos(AWN_TILT) * L;
      const drop = Math.sin(AWN_TILT) * L;
      const lift = 0.013;
      add(s.x + nx * (out * 0.5 - Math.sin(AWN_TILT) * lift), s.y - drop * 0.5 - Math.cos(AWN_TILT) * lift, s.z + nz * (out * 0.5 - Math.sin(AWN_TILT) * lift), s.yaw, s.w - 0.01, L - 0.01, 0.008, new THREE.Color(b?.color ?? '#555555'), -(Math.PI / 2 - AWN_TILT));
      // Two thin arms from the wall to the front bar.
      for (const side of [-0.5, 0.5]) {
        const ax = s.x + tx * (s.w * side - Math.sign(side) * 0.05);
        const az = s.z + tz * (s.w * side - Math.sign(side) * 0.05);
        add(ax + nx * out * 0.5, s.y - drop - 0.03, az + nz * out * 0.5, s.yaw, 0.03, 0.03, out, steel);
      }
      continue;
    }
    if (s.mount === MOUNT.disc) {
      discs.push({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, sx: s.w + 0.05, sy: s.h + 0.05, sz: b?.depth ?? 0.1, col: new THREE.Color(b?.color ?? '#2a2f33') });
      const gap = Math.max(0.06, 0.62 - s.w * 0.5);
      const wx = Math.cos(s.yaw);
      const wz = -Math.sin(s.yaw);
      const bx = s.x - wx * (s.w * 0.5 + gap * 0.5);
      const bz = s.z - wz * (s.w * 0.5 + gap * 0.5);
      add(bx, s.y + s.h * 0.5 + 0.04, bz, s.yaw + Math.PI / 2, gap + s.w * 0.5, 0.05, 0.05, steel);
      continue;
    }
    if (s.mount === MOUNT.cross) {
      // Cut-out neon cross on a short mast standing on the roof.
      add(s.x, s.y - s.h * 0.5 - 0.25, s.z, s.yaw, 0.1, 0.5, 0.1, dark);
      continue;
    }
    if (s.mount === MOUNT.stand) {
      const depth = b?.depth ?? 0.2;
      add(s.x, s.y, s.z, s.yaw, s.w + 0.06, s.h + 0.06, depth, new THREE.Color(b?.color ?? '#a7abb0'));
      // Weighted base.
      add(s.x, s.y - s.h * 0.5 - 0.03, s.z, s.yaw, s.w + 0.14, 0.06, depth + 0.22, dark);
      continue;
    }
    if (s.vertical) {
      const depth = b?.depth ?? 0.3;
      add(s.x, s.y, s.z, s.yaw, s.w + 0.06, s.h + 0.06, depth, new THREE.Color(b?.color ?? '#a7abb0'));
      // Brackets from the inner edge back to the wall (wall normal = (cos, -sin)).
      const wx = Math.cos(s.yaw);
      const wz = -Math.sin(s.yaw);
      const gap = Math.max(0.06, (meta.st === 'stack' ? 0.75 : 0.6) - s.w * 0.5);
      const cx = s.x - wx * (s.w * 0.5 + gap * 0.5);
      const cz = s.z - wz * (s.w * 0.5 + gap * 0.5);
      for (const k of [-0.42, 0.42]) add(cx, s.y + s.h * k, cz, s.yaw + Math.PI / 2, gap + 0.04, 0.05, 0.05, steel);
      continue;
    }
    if (!b) continue;
    const off = meta.off + b.depth * 0.5 + 0.008;
    add(s.x - nx * off, s.y, s.z - nz * off, s.yaw, s.w + 0.07, s.h + 0.07, b.depth, new THREE.Color(b.color));
    if (b.frame && s.mount === MOUNT.wall && s.y < 6) {
      // Storefront cladding: pilasters from the pavement to the fascia and a
      // kick plate under the glass (the face sits 0.25 m off the wall).
      const fc = new THREE.Color(b.frame);
      const pw = 0.3;
      const ph = s.y - s.h * 0.5 - 0.035;
      if (ph > 1.5) {
        for (const side of [-1, 1]) {
          const lat = side * (s.w * 0.5 + 0.035 - pw * 0.5);
          add(s.x + tx * lat - nx * 0.125, ph * 0.5, s.z + tz * lat - nz * 0.125, s.yaw, pw, ph, 0.25, fc);
        }
        add(s.x - nx * 0.21, 0.15, s.z - nz * 0.21, s.yaw, Math.max(0.2, s.w - 2 * pw + 0.07), 0.3, 0.08, fc);
      }
    }
    if (b.legs) {
      const legH = 1.6;
      const base = s.y - s.h / 2 - legH;
      for (const side of [-0.35, 0.35]) {
        const lx = Math.cos(s.yaw) * s.w * side;
        const lz = -Math.sin(s.yaw) * s.w * side;
        add(s.x + lx - nx * 0.3, base + legH / 2, s.z + lz - nz * 0.3, s.yaw, 0.18, legH, 0.18, dark);
      }
    }
  }
  let boxCount = 0;
  for (const list of boxCells.values()) {
    const boxes = new THREE.InstancedMesh(cube, boxMat, list.length);
    list.forEach((o, i) => {
      q.setFromAxisAngle(up, o.yaw);
      if (o.pitch) q.multiply(qp.setFromAxisAngle(xAxis, o.pitch));
      boxes.setMatrixAt(i, m4.compose(pos.set(o.x, o.y, o.z), q, scl.set(o.sx, o.sy, o.sz)));
      boxes.setColorAt(i, o.col);
    });
    boxes.castShadow = true;
    boxes.receiveShadow = true;
    boxes.instanceMatrix.needsUpdate = true;
    boxes.computeBoundingSphere();
    boxes.instanceMatrix.onUpload(dropArray);
    boxes.instanceColor?.onUpload(dropArray);
    boxes.matrixAutoUpdate = false;
    group.add(boxes);
    boxCount += list.length;
  }
  if (discs.length) {
    // Round blade signs: a short cylinder with its axis across the sign.
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 28).rotateX(Math.PI / 2);
    const dm = new THREE.InstancedMesh(cyl, boxMat, discs.length);
    discs.forEach((o, i) => {
      q.setFromAxisAngle(up, o.yaw);
      dm.setMatrixAt(i, m4.compose(pos.set(o.x, o.y, o.z), q, scl.set(o.sx, o.sy, o.sz)));
      dm.setColorAt(i, o.col);
    });
    dm.castShadow = true;
    dm.receiveShadow = true;
    dm.computeBoundingSphere();
    dm.matrixAutoUpdate = false;
    group.add(dm);
    boxCount += discs.length;
  }
  group.matrixAutoUpdate = false;

  return {
    group,
    count: input.length,
    faces: faceCount,
    boxes: boxCount,
    setTexture(tex: THREE.Texture) {
      tSigns.value = tex;
    },
  };
}
