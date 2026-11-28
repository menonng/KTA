// Precipitation around the camera: rain streaks (line segments) and snow
// flakes (points), both animated entirely in the vertex shader inside a box
// that wraps around the camera, so the CPU cost is one uniform update.

import * as THREE from 'three';

const BOX = 50; // horizontal extent (m)
const TOP = 24; // height of the volume (m)

export class Precipitation {
  readonly group = new THREE.Group();
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uLight: { value: 1 }, uWind: { value: new THREE.Vector2(1.2, 0.4) } };

  constructor() {
    let seed = 9;
    const r = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    // Rain: two vertices per drop sharing a base position; aEnd marks the tail.
    const N = 7000;
    const base = new Float32Array(N * 2 * 3);
    const end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = r() * BOX, y = r() * TOP, z = r() * BOX;
      base.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(base, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const rm = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform vec2 uWind;
        attribute float aEnd;
        varying float vA;
        void main() {
          vec3 p = position;
          float speed = 13.0 + fract(p.x * 7.13) * 4.0;
          p.y = mod(p.y - uTime * speed, ${TOP.toFixed(1)});
          p.xz = mod(p.xz + uWind * uTime * 0.6 - uCam.xz, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)} + uCam.xz;
          p.y += uCam.y - 6.0;
          p += aEnd * vec3(uWind.x, -speed, uWind.y) * 0.035;
          vA = 1.0 - smoothstep(14.0, 25.0, length(p.xz - uCam.xz));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLight; varying float vA;
        void main() { gl_FragColor = vec4(vec3(0.62, 0.66, 0.72) * uLight, 0.32 * vA); }`,
      transparent: true,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(rg, rm);
    this.rain.frustumCulled = false;

    // Snow: soft round flakes drifting down with a sway.
    const M = 6000;
    const sp = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) sp.set([r() * BOX, r() * TOP, r() * BOX], i * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const sm = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform vec2 uWind;
        varying float vA;
        void main() {
          vec3 p = position;
          float ph = fract(p.x * 3.7 + p.z * 1.3) * 6.2831;
          p.y = mod(p.y - uTime * (0.9 + fract(p.z * 5.1) * 0.6), ${TOP.toFixed(1)});
          p.x += sin(uTime * 0.9 + ph) * 0.6;
          p.z += cos(uTime * 0.7 + ph) * 0.5;
          p.xz = mod(p.xz + uWind * uTime * 0.25 - uCam.xz, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)} + uCam.xz;
          p.y += uCam.y - 6.0;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(55.0 / -mv.z, 1.0, 9.0);
          vA = 1.0 - smoothstep(14.0, 25.0, length(p.xz - uCam.xz));
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLight; varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.15, length(d)) * vA * 0.9;
          gl_FragColor = vec4(vec3(0.95, 0.96, 1.0) * uLight, a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.snow = new THREE.Points(sg, sm);
    this.snow.frustumCulled = false;
    this.group.add(this.rain, this.snow);
    this.set('clear');
  }

  set(kind: string) {
    this.rain.visible = kind === 'rain';
    this.snow.visible = kind === 'snow';
  }

  update(dt: number, cam: THREE.Vector3, night: number) {
    this.u.uTime.value += dt;
    this.u.uCam.value.copy(cam);
    this.u.uLight.value = THREE.MathUtils.lerp(1.0, 0.45, night);
  }
}
