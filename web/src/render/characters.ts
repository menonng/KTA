// Placeholder characters built from primitives until the scripted/CC0 asset
// pipeline lands (plan 6.3). Protagonist: Black, bald, adult man — the only
// traits fixed by the design decision; everything else is original.

import * as THREE from 'three';

const SKIN = new THREE.Color('#5b3a2a');

function mat(color: THREE.ColorRepresentation, rough = 0.8) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough });
}

export class Protagonist {
  readonly root = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private shL = new THREE.Group();
  private shR = new THREE.Group();
  private elL = new THREE.Group();
  private elR = new THREE.Group();
  private body = new THREE.Group();

  constructor() {
    const skin = mat(SKIN, 0.55);
    const tank = mat('#ecebe6', 0.9);
    const jeans = mat('#2b3b5c', 0.85);
    const shoe = mat('#1c1c1e', 0.6);
    const belt = mat('#3b2a1e', 0.6);
    const scalp = mat(SKIN, 0.4); // bald scalp sheen

    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    this.root.add(this.body);
    // Torso: tank top with exposed shoulders.
    const torso = add(this.body, new THREE.CylinderGeometry(0.2, 0.165, 0.56, 12), tank, 0, 1.24, 0);
    torso.scale.z = 0.62;
    add(this.body, new THREE.SphereGeometry(0.085, 10, 8), skin, 0.2, 1.47, 0);
    add(this.body, new THREE.SphereGeometry(0.085, 10, 8), skin, -0.2, 1.47, 0);
    const chest = add(this.body, new THREE.CylinderGeometry(0.17, 0.2, 0.12, 12), skin, 0, 1.53, 0);
    chest.scale.z = 0.6;
    add(this.body, new THREE.CylinderGeometry(0.055, 0.062, 0.12, 10), skin, 0, 1.62, 0);
    const head = add(this.body, new THREE.SphereGeometry(0.112, 18, 14), scalp, 0, 1.76, 0.005);
    head.scale.set(0.92, 1.12, 1.0);
    add(this.body, new THREE.SphereGeometry(0.022, 8, 6), skin, 0.1, 1.75, 0);
    add(this.body, new THREE.SphereGeometry(0.022, 8, 6), skin, -0.1, 1.75, 0);
    add(this.body, new THREE.SphereGeometry(0.03, 8, 6), skin, 0, 1.745, 0.105); // nose
    const hips = add(this.body, new THREE.CylinderGeometry(0.17, 0.16, 0.16, 12), jeans, 0, 0.92, 0);
    hips.scale.z = 0.65;
    const bl = add(this.body, new THREE.CylinderGeometry(0.172, 0.172, 0.04, 12), belt, 0, 0.99, 0);
    bl.scale.z = 0.66;

    // Legs.
    for (const [hip, knee, s] of [[this.hipL, this.kneeL, 1], [this.hipR, this.kneeR, -1]] as const) {
      hip.position.set(0.09 * s, 0.9, 0);
      this.body.add(hip);
      add(hip, new THREE.CapsuleGeometry(0.075, 0.32, 4, 10), jeans, 0, -0.22, 0);
      knee.position.set(0, -0.44, 0);
      hip.add(knee);
      add(knee, new THREE.CapsuleGeometry(0.065, 0.32, 4, 10), jeans, 0, -0.2, 0);
      add(knee, new THREE.BoxGeometry(0.11, 0.08, 0.27), shoe, 0, -0.42, 0.05);
    }
    // Arms.
    for (const [sh, el, s] of [[this.shL, this.elL, 1], [this.shR, this.elR, -1]] as const) {
      sh.position.set(0.25 * s, 1.47, 0);
      this.body.add(sh);
      add(sh, new THREE.CapsuleGeometry(0.058, 0.22, 4, 10), skin, 0, -0.16, 0);
      el.position.set(0, -0.31, 0);
      sh.add(el);
      add(el, new THREE.CapsuleGeometry(0.048, 0.2, 4, 10), skin, 0, -0.14, 0);
      add(el, new THREE.SphereGeometry(0.046, 10, 8), skin, 0, -0.29, 0.01);
    }
  }

  /** phase in radians (from the Rust core), speed in m/s. */
  animate(phase: number, speed: number, t: number) {
    const a = Math.min(speed / 2.3, 1) * 0.5 + Math.max(0, Math.min((speed - 2.3) / 3.7, 1)) * 0.4;
    const s = Math.sin(phase);
    this.hipL.rotation.x = s * a;
    this.hipR.rotation.x = -s * a;
    this.kneeL.rotation.x = Math.max(0, -Math.sin(phase + 0.7)) * a * 1.4;
    this.kneeR.rotation.x = Math.max(0, Math.sin(phase + 0.7)) * a * 1.4;
    this.shL.rotation.x = -s * a * 0.8;
    this.shR.rotation.x = s * a * 0.8;
    this.shL.rotation.z = 0.08;
    this.shR.rotation.z = -0.08;
    const bend = 0.2 + a * 0.7;
    this.elL.rotation.x = -bend;
    this.elR.rotation.x = -bend;
    const idle = 1 - Math.min(speed / 0.5, 1);
    this.body.position.y = Math.abs(Math.cos(phase)) * 0.035 * a + Math.sin(t * 2) * 0.006 * idle;
    this.body.rotation.x = Math.min(speed / 6, 1) * 0.12;
  }
}

/** Pedestrians: two instanced meshes (body + head), animated by bobbing. */
export class Crowd {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(readonly count: number) {
    const torso = new THREE.CapsuleGeometry(0.2, 0.55, 4, 10).translate(0, 1.15, 0);
    torso.scale(1, 1, 0.65);
    const legs = new THREE.CylinderGeometry(0.15, 0.12, 0.85, 10).translate(0, 0.43, 0);
    legs.scale(1, 1, 0.7);
    const colorize = (g: THREE.BufferGeometry, v: number) => {
      const n = g.getAttribute('position').count;
      const c = new Float32Array(n * 3).fill(v);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return g;
    };
    const bodyGeo = mergeGeometries([colorize(torso, 1), colorize(legs, 0.18)]);
    this.body = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), count);
    this.head = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.11, 10, 8).translate(0, 1.66, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.6 }),
      count,
    );
    const shirt = ['#d9d4c7', '#2e3440', '#7a1f2b', '#2f5d8a', '#f2c14e', '#3d5a40', '#111111', '#c8c3d8', '#8a5a44', '#e9e9e9'];
    const skin = ['#f1d3b8', '#e0b896', '#c99a74', '#8d5e43', '#5b3a2a'];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.body.setColorAt(i, c.set(shirt[i % shirt.length]));
      this.head.setColorAt(i, c.set(skin[(i * 7) % skin.length]));
    }
    for (const im of [this.body, this.head]) {
      im.castShadow = true;
      im.frustumCulled = false;
      this.group.add(im);
    }
  }

  update(data: Float32Array) {
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      const bob = Math.abs(Math.cos(data[o + 3])) * 0.04;
      this.q.setFromAxisAngle(this.up, data[o + 2]);
      this.m.compose(new THREE.Vector3(data[o], bob, data[o + 1]), this.q, new THREE.Vector3(1, 1, 1));
      this.body.setMatrixAt(i, this.m);
      this.head.setMatrixAt(i, this.m);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
  }
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const arrays = parts.map((g) => g.getAttribute(name).array as Float32Array);
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const a of arrays) {
      merged.set(a, off);
      off += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, 3));
  }
  return out;
}
