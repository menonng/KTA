// Traffic signals at the signalised junctions (OSM signal nodes, grouped
// into sites by the Rust core).
//
// Korean layout: the vehicle signal is a horizontal four-aspect head
// (적·황·좌회전 녹색 화살표·녹) on a cantilever beyond the junction (far side),
// facing the traffic that drives towards it. Pedestrian signals (standing /
// walking figure) stand at both ends of each crossing with a two-digit
// countdown of the remaining walk time (잔여시간 표시기). Stop lines are drawn
// 1.5 m before the crossings.
//
// Each site runs a fixed two-phase cycle: group 0 (along the site's widest
// road) then group 1, each 26 s green with a simultaneous left arrow
// (직좌 동시신호), 3 s yellow, 1 s all-red. Pedestrians cross a road while its
// own traffic is red (during the other group's green), flashing for the last
// 8 s. Sites are offset so neighbouring junctions do not switch together.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const GREEN = 0;
export const YELLOW = 1;
export const RED = 2;

const G = 26;
const Y = 3;
const AR = 1;
const CYCLE = 2 * (G + Y + AR);
const FLASH = 8;

interface Site {
  x: number;
  z: number;
  axis: number;
  offset: number;
}

export interface SignalPoint {
  x: number;
  z: number;
  half: number;
  site: number;
}

// Glyph atlas cells (64 px each).
const CELL_BALL = 0;
const CELL_ARROW = 1;
const CELL_STAND = 2;
const CELL_WALK = 3;
const CELL_DIGIT = 4; // .. 13
const CELL_BLANK = 14;
const CELLS = 16;

function glyphAtlas(): THREE.CanvasTexture {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = S * CELLS;
  cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  const at = (i: number) => i * S;
  // Ball.
  g.beginPath();
  g.arc(at(CELL_BALL) + S / 2, S / 2, S * 0.44, 0, Math.PI * 2);
  g.fill();
  // Left arrow.
  {
    const x = at(CELL_ARROW);
    g.beginPath();
    g.moveTo(x + S * 0.12, S / 2);
    g.lineTo(x + S * 0.46, S * 0.18);
    g.lineTo(x + S * 0.46, S * 0.38);
    g.lineTo(x + S * 0.86, S * 0.38);
    g.lineTo(x + S * 0.86, S * 0.62);
    g.lineTo(x + S * 0.46, S * 0.62);
    g.lineTo(x + S * 0.46, S * 0.82);
    g.closePath();
    g.fill();
  }
  // Standing and walking figures.
  const person = (x: number, walking: boolean) => {
    g.beginPath();
    g.arc(x + S / 2, S * 0.16, S * 0.09, 0, Math.PI * 2);
    g.fill();
    g.lineCap = 'round';
    g.lineWidth = S * 0.13;
    g.beginPath();
    g.moveTo(x + S / 2, S * 0.3);
    g.lineTo(x + S / 2 + (walking ? S * 0.03 : 0), S * 0.58);
    g.stroke();
    g.lineWidth = S * 0.09;
    g.beginPath();
    if (walking) {
      g.moveTo(x + S * 0.53, S * 0.58);
      g.lineTo(x + S * 0.68, S * 0.92);
      g.moveTo(x + S * 0.53, S * 0.58);
      g.lineTo(x + S * 0.36, S * 0.9);
      g.moveTo(x + S * 0.5, S * 0.36);
      g.lineTo(x + S * 0.7, S * 0.52);
      g.moveTo(x + S * 0.5, S * 0.36);
      g.lineTo(x + S * 0.32, S * 0.5);
    } else {
      g.moveTo(x + S * 0.45, S * 0.58);
      g.lineTo(x + S * 0.43, S * 0.93);
      g.moveTo(x + S * 0.55, S * 0.58);
      g.lineTo(x + S * 0.57, S * 0.93);
      g.moveTo(x + S * 0.42, S * 0.34);
      g.lineTo(x + S * 0.38, S * 0.6);
      g.moveTo(x + S * 0.58, S * 0.34);
      g.lineTo(x + S * 0.62, S * 0.6);
    }
    g.stroke();
  };
  person(at(CELL_STAND), false);
  person(at(CELL_WALK), true);
  g.font = `bold ${S * 0.95}px monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let d = 0; d < 10; d++) g.fillText(String(d), at(CELL_DIGIT + d) + S / 2, S * 0.54);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Coloured boxes / cylinders merged into one vertex-coloured mesh. */
class Kit {
  parts: THREE.BufferGeometry[] = [];
  private q = new THREE.Quaternion();
  box(w: number, h: number, d: number, p: THREE.Vector3, yaw: number, col: number) {
    const g = new THREE.BoxGeometry(w, h, d).applyQuaternion(this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    g.translate(p.x, p.y, p.z);
    this.paint(g, col);
  }
  cyl(r: number, h: number, p: THREE.Vector3, col: number, seg = 8) {
    const g = new THREE.CylinderGeometry(r * 0.85, r, h, seg).translate(p.x, p.y + h / 2, p.z);
    this.paint(g, col);
  }
  private paint(g: THREE.BufferGeometry, col: number) {
    const c = new THREE.Color(col);
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    this.parts.push(g.index ? g.toNonIndexed() : g);
  }
}

interface Lamp {
  site: number;
  group: number;
  /** 0 red, 1 yellow, 2 arrow, 3 green (vehicle); 4 stand, 5 walk (pedestrian); 6 tens, 7 ones (countdown). */
  role: number;
}

const COLORS: Record<number, [number, number, number]> = {
  0: [1.0, 0.12, 0.08],
  1: [1.0, 0.62, 0.05],
  2: [0.15, 1.0, 0.55],
  3: [0.15, 1.0, 0.55],
  4: [1.0, 0.15, 0.1],
  5: [0.2, 1.0, 0.6],
  6: [0.25, 1.0, 0.6],
  7: [0.25, 1.0, 0.6],
};

export class Signals {
  readonly group = new THREE.Group();
  readonly sites: Site[] = [];
  readonly points: SignalPoint[] = [];
  private t = 0;
  private lamps: Lamp[] = [];
  private lampMesh: THREE.InstancedMesh | null = null;
  private cells: Float32Array = new Float32Array(0);
  private cellAttr: THREE.InstancedBufferAttribute | null = null;
  private lastKey = '';
  private col = new THREE.Color();

  constructor(
    sites: Float32Array,
    points: Float32Array,
    heads: Float32Array,
    stops: Float32Array,
    groundY: (x: number, z: number) => number,
  ) {
    for (let i = 0; i < sites.length; i += 4) this.sites.push({ x: sites[i], z: sites[i + 1], axis: sites[i + 2], offset: (sites[i + 3] * 13.7) % CYCLE });
    for (let i = 0; i < points.length; i += 4) this.points.push({ x: points[i], z: points[i + 1], half: points[i + 2], site: points[i + 3] });
    this.build(heads, stops, groundY);
  }

  /** Time within the site cycle. */
  private local(site: number) {
    return (this.t + this.sites[site].offset) % CYCLE;
  }

  /** Vehicle light for a group at a site. */
  state(site: number, group: number): number {
    const t = (this.local(site) - group * (G + Y + AR) + CYCLE) % CYCLE;
    return t < G ? GREEN : t < G + Y ? YELLOW : RED;
  }

  /** Seconds of walk time left for pedestrians crossing a road of `group` (0 = don't walk). */
  walkLeft(site: number, group: number): number {
    const other = 1 - group;
    const t = (this.local(site) - other * (G + Y + AR) + CYCLE) % CYCLE;
    return t < G ? G - t : 0;
  }

  /** Lane approach group (same rule as the core: within 45 degrees of the site axis = 0). */
  groupOf(site: number, hx: number, hz: number): number {
    const a = Math.atan2(hx, hz);
    const d = (((a - this.sites[site].axis) % Math.PI) + Math.PI) % Math.PI;
    return d < Math.PI / 4 || d > (3 * Math.PI) / 4 ? 0 : 1;
  }

  private build(heads: Float32Array, stops: Float32Array, groundY: (x: number, z: number) => number) {
    const kit = new Kit();
    const lampAt: { p: THREE.Vector3; yaw: number; size: number; cell: number; lamp: Lamp }[] = [];
    const POLE = 0x7f8488;
    const HOUSING = 0x22262a;
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    for (let i = 0; i < heads.length; i += 7) {
      const [kind, x, z, yaw, group, site, reach] = [heads[i], heads[i + 1], heads[i + 2], heads[i + 3], heads[i + 4], heads[i + 5], heads[i + 6]];
      const y0 = groundY(x, z);
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      // Right-hand axis of a viewer looking at the head (driver or pedestrian).
      const rx = fz;
      const rz = -fx;
      if (kind === 0) {
        // The pole stands on the driver's right; the cantilever reaches over the lanes.
        const ax = -rx;
        const az = -rz;
        kit.cyl(0.14, 6.4, v(x, y0, z), POLE, 10);
        const ex = x + ax * reach;
        const ez = z + az * reach;
        const mid = v((x + ex) / 2, y0 + 5.95, (z + ez) / 2);
        kit.box(reach, 0.16, 0.16, mid, Math.atan2(ax, az) + Math.PI / 2, POLE);
        // Bracing strut.
        kit.box(reach * 0.45, 0.07, 0.07, v(x + ax * reach * 0.22, y0 + 5.55, z + az * reach * 0.22), Math.atan2(ax, az) + Math.PI / 2, POLE);
        // Horizontal 4-aspect head hanging under the arm end: red, yellow, left arrow, green
        // from the driver's left to right.
        const hc = v(ex - ax * 0.75, y0 + 5.45, ez - az * 0.75);
        kit.box(1.36, 0.4, 0.28, hc, yaw, HOUSING);
        kit.box(0.06, 0.16, 0.06, v(hc.x, y0 + 5.78, hc.z), yaw, POLE);
        for (let k = 0; k < 4; k++) {
          const off = -0.48 + k * 0.32;
          const p = v(hc.x + rx * off + fx * 0.145, hc.y, hc.z + rz * off + fz * 0.145);
          // Visor over each lamp.
          kit.box(0.28, 0.025, 0.16, v(p.x + fx * 0.07, hc.y + 0.16, p.z + fz * 0.07), yaw, HOUSING);
          lampAt.push({ p, yaw, size: 0.24, cell: k === 2 ? CELL_ARROW : CELL_BALL, lamp: { site, group, role: k } });
        }
      } else {
        // Pedestrian head with countdown on the viewer's left.
        kit.cyl(0.075, 3.3, v(x, y0, z), POLE, 8);
        const hc = v(x + fx * 0.12, y0 + 2.55, z + fz * 0.12);
        kit.box(0.36, 0.74, 0.2, hc, yaw, HOUSING);
        lampAt.push({ p: v(hc.x + fx * 0.105, hc.y + 0.18, hc.z + fz * 0.105), yaw, size: 0.28, cell: CELL_STAND, lamp: { site, group, role: 4 } });
        lampAt.push({ p: v(hc.x + fx * 0.105, hc.y - 0.18, hc.z + fz * 0.105), yaw, size: 0.28, cell: CELL_WALK, lamp: { site, group, role: 5 } });
        const cc = v(hc.x - rx * 0.36, hc.y - 0.1, hc.z - rz * 0.36);
        kit.box(0.34, 0.3, 0.16, cc, yaw, HOUSING);
        for (const [k, off] of [[6, -0.075], [7, 0.075]] as const) {
          lampAt.push({ p: v(cc.x + rx * off + fx * 0.085, cc.y, cc.z + rz * off + fz * 0.085), yaw, size: 0.16, cell: CELL_BLANK, lamp: { site, group, role: k } });
        }
      }
    }
    if (kit.parts.length) {
      const g = mergeGeometries(kit.parts)!;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }

    // Lamp faces: instanced quads sampling the glyph atlas, unlit, HDR colour.
    const n = lampAt.length;
    if (n) {
      const geo = new THREE.PlaneGeometry(1, 1);
      this.cells = new Float32Array(n);
      this.cellAttr = new THREE.InstancedBufferAttribute(this.cells, 1);
      this.cellAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aCell', this.cellAttr);
      const mat = new THREE.MeshBasicMaterial({ map: glyphAtlas(), transparent: false, alphaTest: 0.35 });
      mat.onBeforeCompile = (s) => {
        s.vertexShader = s.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aCell;')
          .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vec2((uv.x + aCell) / ${CELLS}.0, uv.y);`);
      };
      mat.customProgramCacheKey = () => 'kta-signal-lamp-1';
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      lampAt.forEach((l, i) => {
        q.setFromAxisAngle(up, l.yaw);
        m.compose(l.p, q, new THREE.Vector3(l.size, l.size, 1));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, this.col.setRGB(0.05, 0.05, 0.05));
        this.cells[i] = l.cell;
        this.lamps.push(l.lamp);
      });
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.lampMesh = mesh;
      this.group.add(mesh);
    }

    // Stop lines (white, 45 cm wide).
    const ns = stops.length / 4;
    if (ns) {
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xdedcd4, roughness: 0.7 }), ns);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < ns; i++) {
        q.setFromAxisAngle(up, stops[i * 4 + 2]);
        m.compose(new THREE.Vector3(stops[i * 4], 0.107, stops[i * 4 + 1]), q, new THREE.Vector3(stops[i * 4 + 3], 1, 0.45));
        mesh.setMatrixAt(i, m);
      }
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
  }

  update(dt: number) {
    this.t += dt;
    const mesh = this.lampMesh;
    if (!mesh) return;
    // Re-colour only when something visible changed (state or countdown second, flash phase).
    const flashOn = Math.floor(this.t * 2) % 2 === 0;
    const key = `${Math.floor(this.t)}|${flashOn}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    let cellsDirty = false;
    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.lamps[i];
      let on = false;
      if (l.role <= 3) {
        const st = this.state(l.site, l.group);
        on = l.role === 0 ? st === RED : l.role === 1 ? st === YELLOW : st === GREEN;
      } else {
        const left = this.walkLeft(l.site, l.group);
        if (l.role === 4) on = left <= 0;
        else if (l.role === 5) on = left > 0 && (left > FLASH || flashOn);
        else {
          const sec = Math.ceil(left);
          const digit = l.role === 6 ? Math.floor(sec / 10) : sec % 10;
          const cell = left > 0 && !(l.role === 6 && sec < 10) ? CELL_DIGIT + digit : CELL_BLANK;
          if (this.cells[i] !== cell) {
            this.cells[i] = cell;
            cellsDirty = true;
          }
          on = left > 0;
        }
      }
      const c = COLORS[l.role];
      if (on) this.col.setRGB(c[0] * 3.2, c[1] * 3.2, c[2] * 3.2);
      else this.col.setRGB(c[0] * 0.03 + 0.015, c[1] * 0.03 + 0.015, c[2] * 0.03 + 0.015);
      mesh.setColorAt(i, this.col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (cellsDirty && this.cellAttr) this.cellAttr.needsUpdate = true;
  }
}
