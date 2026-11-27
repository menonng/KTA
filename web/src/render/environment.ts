// Sky dome, sun/moon, hemisphere light, fog and the day/night cycle.
// Everything is procedural: no textures, one draw call for the sky.

import * as THREE from 'three';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.55));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25) * (1.0 - uNight * 0.7);
  if (uNight > 0.01 && d.y > 0.05) {
    vec2 g = floor(d.xz / (d.y + 0.35) * 260.0);
    float st = step(0.9975, h21(g));
    col += vec3(st) * uNight * 0.8;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

const PAL = {
  dayTop: c(0.22, 0.45, 0.85),
  dayHorizon: c(0.72, 0.83, 0.95),
  goldTop: c(0.3, 0.36, 0.62),
  goldHorizon: c(1.0, 0.6, 0.36),
  nightTop: c(0.01, 0.015, 0.05),
  nightHorizon: c(0.06, 0.07, 0.14),
  sunDay: c(1.0, 0.95, 0.86),
  sunGold: c(1.0, 0.62, 0.38),
  moon: c(0.55, 0.65, 1.0),
};

export class Environment {
  readonly sky: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.Fog;
  /** 0 = day, 1 = night. Shared with materials. */
  readonly night = { value: 0 };
  private uniforms: Record<string, THREE.IUniform>;
  private sunDir = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uNight: this.night,
    };
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), skyMat);
    this.sky.scale.setScalar(1500);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -38;
    sc.right = 38;
    sc.top = 38;
    sc.bottom = -38;
    sc.near = 1;
    sc.far = 320;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.fog = new THREE.Fog(0xaabbcc, 120, 800);
    scene.fog = this.fog;
  }

  /** hours in [0, 24). */
  setTime(hours: number) {
    const elev = Math.sin(((hours - 6) / 12) * Math.PI); // -1..1
    const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.18);
    const gold = day * (1 - THREE.MathUtils.smoothstep(elev, 0.05, 0.45));
    const night = 1 - day;
    this.night.value = night;

    const az = ((hours - 6) / 12) * Math.PI;
    const el = Math.max(elev, 0.12) * 1.1;
    this.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), -0.45 - Math.sin(az) * 0.3).normalize();
    if (night > 0.5) this.sunDir.set(-0.4, 0.8, 0.45).normalize();

    const top = PAL.dayTop.clone().lerp(PAL.goldTop, gold).lerp(PAL.nightTop, night);
    const hor = PAL.dayHorizon.clone().lerp(PAL.goldHorizon, gold).lerp(PAL.nightHorizon, night);
    const sunC = PAL.sunDay.clone().lerp(PAL.sunGold, gold).lerp(PAL.moon, night);
    (this.uniforms.uTop.value as THREE.Color).copy(top);
    (this.uniforms.uHorizon.value as THREE.Color).copy(hor);
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (this.uniforms.uSunColor.value as THREE.Color).copy(sunC);

    this.sun.color.copy(sunC);
    this.sun.intensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(2.6, 1.7, gold), 0.18, night);
    this.hemi.color.copy(top).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.hemi.groundColor.set(0x3a3a38).lerp(new THREE.Color(0x101014), night);
    this.hemi.intensity = THREE.MathUtils.lerp(1.15, 0.5, night);
    this.fog.color.copy(hor);
    this.fog.near = THREE.MathUtils.lerp(140, 60, night);
    this.fog.far = THREE.MathUtils.lerp(850, 420, night);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.1, night);
  }

  /** Keep the shadow frustum around the player. */
  follow(x: number, z: number) {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunDir.x * 140, this.sunDir.y * 140, z + this.sunDir.z * 140);
    this.sun.target.updateMatrixWorld();
    this.sky.position.set(x, 0, z);
  }
}
