// Street kit rendering: streamed prop cells (merged meshes built by the Rust
// core around the player), overhead wires, crosswalks, lamp light pools.

import * as THREE from 'three';
import type { Game } from '../wasm/kta_wasm.js';

const CELL = 128;

function disposeArray(this: THREE.BufferAttribute) {
  (this as unknown as { array: unknown }).array = null;
}

export class PropStreamer {
  private available = new Map<string, [number, number]>();
  private loaded = new Map<string, { mesh: THREE.Mesh; bytes: number }>();
  private material: THREE.MeshStandardMaterial;
  private timer = 0;
  bytes = 0;

  constructor(private game: Game, private memory: WebAssembly.Memory, private scene: THREE.Scene, night: { value: number }, private radius = 230) {
    const c = game.prop_cells();
    for (let i = 0; i < c.length; i += 3) this.available.set(`${c[i]},${c[i + 1]}`, [c[i], c[i + 1]]);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0 });
    m.onBeforeCompile = (s) => {
      s.uniforms.uNight = night;
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n#ifdef USE_COLOR_ALPHA\ntotalEmissiveRadiance += vColor.rgb * (1.0 - step(0.5, vColor.a)) * mix(0.15, 3.0, uNight);\n#endif',
        );
    };
    m.customProgramCacheKey = () => 'kta-props-1';
    this.material = m;
  }

  get cellCount() {
    return this.loaded.size;
  }

  update(x: number, z: number, dt: number, force = false) {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.25;
    const want: [string, number][] = [];
    for (const [key, [cx, cz]] of this.available) {
      const d = Math.hypot((cx + 0.5) * CELL - x, (cz + 0.5) * CELL - z) - CELL * 0.7;
      if (d < this.radius && !this.loaded.has(key)) want.push([key, d]);
    }
    want.sort((a, b) => a[1] - b[1]);
    for (const [key] of want.slice(0, force ? want.length : 2)) this.load(key);
    for (const [key, v] of this.loaded) {
      const [cx, cz] = this.available.get(key)!;
      const d = Math.hypot((cx + 0.5) * CELL - x, (cz + 0.5) * CELL - z) - CELL * 0.7;
      if (d > this.radius + 70) {
        this.scene.remove(v.mesh);
        v.mesh.geometry.dispose();
        this.bytes -= v.bytes;
        this.loaded.delete(key);
      }
    }
  }

  private load(key: string) {
    const [cx, cz] = this.available.get(key)!;
    const d = this.game.build_prop_cell(cx, cz);
    const buf = this.memory.buffer;
    const pos = new Float32Array(buf, d[0], d[1]).slice();
    const nrm = new Int8Array(buf, d[2], d[3]).slice();
    const col = new Uint8Array(buf, d[4], d[5]).slice();
    const idx32 = new Uint32Array(buf, d[6], d[7]);
    const idx = pos.length / 3 < 65536 ? Uint16Array.from(idx32) : idx32.slice();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true).onUpload(disposeArray));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4, true).onUpload(disposeArray));
    g.setIndex(new THREE.BufferAttribute(idx, 1).onUpload(disposeArray));
    g.computeBoundingSphere();
    (g.getAttribute('position') as THREE.BufferAttribute).onUpload(disposeArray);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    const bytes = pos.byteLength + nrm.byteLength + col.byteLength + idx.byteLength;
    this.bytes += bytes;
    this.loaded.set(key, { mesh, bytes });
  }
}

export function buildStreetDetails(game: Game, scene: THREE.Scene, night: { value: number }) {
  // Overhead wires: one draw call.
  const w = game.wires();
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(w, 3));
  wg.computeBoundingSphere();
  (wg.getAttribute('position') as THREE.BufferAttribute).onUpload(disposeArray);
  const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1b1d20 }));
  wires.matrixAutoUpdate = false;
  scene.add(wires);

  // Crosswalks: instanced flat quads with stripe discard.
  const cw = game.crosswalks();
  const nCw = cw.length / 5;
  const cg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const widths = new Float32Array(nCw);
  const cm = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7 });
  cm.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aW;\nvarying float vX;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvX = uv.x * aW;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vX;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (fract(vX / 1.0) > 0.5) discard;');
  };
  cm.customProgramCacheKey = () => 'kta-crosswalk-1';
  const cross = new THREE.InstancedMesh(cg, cm, Math.max(1, nCw));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < nCw; i++) {
    const [x, z, yaw, width, len] = [cw[i * 5], cw[i * 5 + 1], cw[i * 5 + 2], cw[i * 5 + 3], cw[i * 5 + 4]];
    q.setFromAxisAngle(up, yaw);
    m.compose(new THREE.Vector3(x, 0.105, z), q, new THREE.Vector3(width - 1.0, 1, len));
    cross.setMatrixAt(i, m);
    widths[i] = width - 1.0;
  }
  cg.setAttribute('aW', new THREE.InstancedBufferAttribute(widths, 1));
  cross.count = nCw;
  cross.receiveShadow = true;
  scene.add(cross);

  // Light pools under street lamps (night only, additive).
  const lp = game.lamps();
  const nL = lp.length / 2;
  const lg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const lm = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uNight;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = pow(max(1.0 - r, 0.0), 2.0) * uNight * 0.3;
        vec3 c = vec3(1.0, 0.8, 0.55) * a;
        #ifdef USE_FOG
          float fogF = smoothstep(fogNear, fogFar, vFogDepth);
          c *= 1.0 - fogF;
        #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  lm.uniforms.uNight = night;
  const pools = new THREE.InstancedMesh(lg, lm, Math.max(1, nL));
  for (let i = 0; i < nL; i++) {
    m.compose(new THREE.Vector3(lp[i * 2], 0.115, lp[i * 2 + 1]), new THREE.Quaternion(), new THREE.Vector3(10, 1, 10));
    pools.setMatrixAt(i, m);
  }
  pools.count = nL;
  pools.renderOrder = 2;
  scene.add(pools);

  return { wireSegments: w.length / 6, crosswalks: nCw, lamps: nL };
}
