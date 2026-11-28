// Atmosphere: Preetham sky with clouds (three.js SkyShader, MIT) extended
// with a Seoul night (stars, moon, orange city glow under the clouds), the
// real winter sun path for Seoul, weather (clear / cloudy / rain / snow),
// and one small equirect sky LUT that feeds three things so they agree:
// the image-based lighting (PMREM), the aerial-perspective fog in the post
// pass, and the facade reflection colours.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Grade } from './post';
import { SURFACE } from './surface';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow';
export const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain', 'snow'];

const NIGHT_UNIFORMS = /* glsl */ `
uniform float uNight;
uniform vec3 uMoonDir;
uniform vec3 uCity;
uniform float uSkyScale;
uniform float uStars;
float h21s(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

// Inserted before the cloud block: night sky base, stars, moon, city glow.
const NIGHT_SKY = /* glsl */ `
{
  float up = max(direction.y, 0.0);
  texColor += mix(vec3(0.0008, 0.0012, 0.0028), vec3(0.0002, 0.0003, 0.0009), up) * uNight;
  // Light pollution: warm glow hugging the horizon.
  texColor += uCity * pow(1.0 - up, 5.0) * uNight;
  if (direction.y > 0.02 && uStars > 0.0) {
    vec2 g = floor(direction.xz / (direction.y + 0.4) * 300.0);
    float st = step(0.9982, h21s(g)) * smoothstep(0.02, 0.25, direction.y);
    texColor += vec3(0.02) * st * uStars;
  }
  float md = dot(direction, normalize(uMoonDir));
  texColor += vec3(0.05, 0.052, 0.058) * smoothstep(0.99985, 0.99992, md) * uNight;
  texColor += vec3(0.0016, 0.0018, 0.0024) * pow(max(md, 0.0), 60.0) * uNight;
}
`;

const SKY_PATCH = (frag: string) =>
  frag
    .replace('uniform float time;', `uniform float time;\n${NIGHT_UNIFORMS}`)
    .replace('// Clouds', `${NIGHT_SKY}\n// Clouds`)
    .replace('cloudColor *= max( dayFactor, 0.03 );', 'cloudColor *= max( dayFactor, 0.03 );\ncloudColor += uCity * (0.5 + 0.8 * shade) * uNight * 1.6;')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * uSkyScale, 1.0 );');

const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const PAL = {
  dayTop: c(0.22, 0.45, 0.85),
  dayHorizon: c(0.72, 0.83, 0.95),
  goldTop: c(0.3, 0.36, 0.62),
  goldHorizon: c(1.0, 0.6, 0.36),
  nightTop: c(0.01, 0.015, 0.05),
  nightHorizon: c(0.09, 0.075, 0.1),
  sunDay: c(1.0, 0.94, 0.84),
  sunGold: c(1.0, 0.6, 0.34),
  moon: c(0.62, 0.68, 0.85),
};

interface WeatherLook {
  turbidity: number;
  rayleigh: number;
  cloud: number;
  cloudDensity: number;
  sun: number;
  fog: number;
  shadow: number;
  sat: number;
}
const LOOK: Record<Weather, WeatherLook> = {
  clear: { turbidity: 6.5, rayleigh: 2.2, cloud: 0.32, cloudDensity: 0.45, sun: 1.0, fog: 1.0, shadow: 1.0, sat: 1.0 },
  cloudy: { turbidity: 11, rayleigh: 1.4, cloud: 0.78, cloudDensity: 0.75, sun: 0.42, fog: 1.6, shadow: 0.55, sat: 0.9 },
  rain: { turbidity: 16, rayleigh: 0.8, cloud: 0.97, cloudDensity: 1.0, sun: 0.16, fog: 3.6, shadow: 0.25, sat: 0.78 },
  snow: { turbidity: 18, rayleigh: 0.9, cloud: 0.95, cloudDensity: 0.95, sun: 0.2, fog: 4.4, shadow: 0.3, sat: 0.72 },
};

/** Sun direction for Seoul (37.56 N, 126.98 E) on 28 November, KST hours. */
function seoulSun(hours: number, out: THREE.Vector3) {
  const lat = THREE.MathUtils.degToRad(37.56);
  const decl = THREE.MathUtils.degToRad(-21.3);
  // Solar noon ~12:20 KST in late November (longitude + equation of time).
  const H = THREE.MathUtils.degToRad(15 * (hours - 12.33));
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(H)); // from north, clockwise
  // World: +x east, -z north.
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return el;
}

export class Environment {
  readonly sky: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** 0 = day, 1 = night. Shared with materials. */
  readonly night = { value: 0 };
  /** Wet / snow coverage shared with ground, road and facade shaders. */
  readonly surface = SURFACE;
  readonly grade: Grade = {
    exposure: 1,
    tint: new THREE.Color(1, 1, 1),
    shadow: new THREE.Color(1, 1, 1),
    high: new THREE.Color(1, 1, 1),
    contrast: 1,
    saturation: 1,
    vignette: 0.35,
    bloom: 0.3,
  };
  /** Facade reflection colours (zenith / horizon). */
  readonly uniforms: Record<string, THREE.IUniform>;
  /** Equirect sky (no sun disc) for fog colour and IBL. */
  readonly lut: THREE.WebGLRenderTarget;
  /** Height-fog parameters read by the post pass. */
  readonly fog = { density: 0.0028, falloff: 0.011, sunGlow: 0.5 };
  weather: Weather = 'clear';
  private skyMat: THREE.ShaderMaterial;
  private lutMat: THREE.ShaderMaterial;
  private lutScene = new THREE.Scene();
  private lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envKey = '';
  private sunDir = new THREE.Vector3();
  private time = 0;
  private lastSet = 0;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.uniforms = { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uNight: this.night };
    const base = Sky.SkyShader as unknown as { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };
    const skyUniforms = THREE.UniformsUtils.merge([
      base.uniforms,
      {
        uNight: { value: 0 },
        uMoonDir: { value: new THREE.Vector3(0.3, 0.6, 0.5) },
        uCity: { value: new THREE.Color(0.0075, 0.0042, 0.0022) },
        uSkyScale: { value: 0.5 },
        uStars: { value: 1 },
      },
    ]);
    this.skyMat = new THREE.ShaderMaterial({
      name: 'KtaSky',
      uniforms: skyUniforms,
      vertexShader: base.vertexShader,
      fragmentShader: SKY_PATCH(base.fragmentShader),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.scale.setScalar(1500);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    // The same sky rendered into an equirect target (direction from uv).
    this.lutMat = new THREE.ShaderMaterial({
      uniforms: this.skyMat.uniforms,
      vertexShader: base.vertexShader
        .replace('varying vec3 vWorldPosition;', 'varying vec3 vWorldPosition;\nvarying vec2 vUvL;')
        .replace('gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );', 'vUvL = uv;\ngl_Position = vec4( position.xy, 0.0, 1.0 );')
        .replace('gl_Position.z = gl_Position.w; // set z to camera.far', ''),
      fragmentShader: SKY_PATCH(base.fragmentShader)
        .replace('varying vec3 vWorldPosition;', 'varying vec3 vWorldPosition;\nvarying vec2 vUvL;')
        .replace(
          'vec3 direction = normalize( vWorldPosition - cameraPosition );',
          'float phiL = (vUvL.x - 0.5) * 6.2831853; float thL = (vUvL.y - 0.5) * 3.1415926;\nvec3 direction = vec3(cos(thL) * cos(phiL), sin(thL), cos(thL) * sin(phiL));',
        ),
      depthTest: false,
      depthWrite: false,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat);
    q.frustumCulled = false;
    this.lutScene.add(q);
    this.lut = new THREE.WebGLRenderTarget(256, 128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.lut.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // Sharp enough for thin casters (legs, poles): a wide filter or large biases erase them.
    this.sun.shadow.radius = 1;
    const sc = this.sun.shadow.camera;
    sc.left = -38;
    sc.right = 38;
    sc.top = 38;
    sc.bottom = -38;
    sc.near = 1;
    sc.far = 320;
    this.sun.shadow.bias = -0.00012;
    this.sun.shadow.normalBias = 0.015;
    scene.add(this.sun, this.sun.target);
    scene.fog = null; // aerial perspective is applied in the post pass
  }

  setWeather(w: Weather) {
    this.weather = w;
    this.envKey = '';
  }

  /** hours in [0, 24). */
  setTime(hours: number) {
    const now = performance.now() / 1000;
    this.time += Math.min(0.1, Math.max(0, now - this.lastSet));
    this.lastSet = now;
    const look = LOOK[this.weather];
    const el = seoulSun(hours, this.sunDir);
    const elDeg = THREE.MathUtils.radToDeg(el);
    const day = THREE.MathUtils.smoothstep(elDeg, -7, 5);
    const gold = day * (1 - THREE.MathUtils.smoothstep(elDeg, 3, 22));
    const night = 1 - day;
    this.night.value = night;

    const u = this.skyMat.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = look.turbidity;
    u.rayleigh.value = look.rayleigh;
    u.mieCoefficient.value = this.weather === 'clear' ? 0.0035 : 0.002;
    u.mieDirectionalG.value = 0.76;
    u.cloudCoverage.value = look.cloud;
    u.cloudDensity.value = look.cloudDensity;
    u.cloudScale.value = 0.00022;
    u.cloudSpeed.value = 0.00003;
    u.cloudElevation.value = this.weather === 'clear' ? 0.45 : 0.75;
    u.time.value = this.time * 60;
    u.uNight.value = night;
    u.uStars.value = this.weather === 'clear' ? 1 : 0;
    u.uMoonDir.value.set(-this.sunDir.x * 0.6 + 0.2, Math.abs(this.sunDir.y) * 0.5 + 0.35, -this.sunDir.z * 0.6 + 0.3).normalize();
    // Overcast night: the cloud deck glows brighter orange over the city.
    (u.uCity.value as THREE.Color).setRGB(0.0075, 0.0043, 0.0023).multiplyScalar(this.weather === 'clear' ? 1 : 1.8);
    // Preetham radiance grows fast with sun height while our sun light does
    // not: scale the sky down at midday and under overcast to keep them in balance.
    const overcastK = 1 - look.sun;
    u.uSkyScale.value = THREE.MathUtils.lerp(0.5, 0.24, THREE.MathUtils.smoothstep(elDeg, 4, 28)) * THREE.MathUtils.lerp(1, 0.55, overcastK);

    // Facade reflection gradient (approximation of the sky above).
    const top = PAL.dayTop.clone().lerp(PAL.goldTop, gold).lerp(PAL.nightTop, night);
    const hor = PAL.dayHorizon.clone().lerp(PAL.goldHorizon, gold).lerp(PAL.nightHorizon, night);
    const grey = new THREE.Color(0.55, 0.58, 0.62).lerp(new THREE.Color(0.08, 0.07, 0.08), night);
    const overcast = 1 - look.sun;
    top.lerp(grey, overcast * 0.8);
    hor.lerp(grey, overcast * 0.7);
    (this.uniforms.uTop.value as THREE.Color).copy(top);
    (this.uniforms.uHorizon.value as THREE.Color).copy(hor);

    // Sun / moon light. A low winter sun: warm most of the day.
    const sunC = PAL.sunDay.clone().lerp(PAL.sunGold, gold).lerp(PAL.moon, night);
    this.sun.color.copy(sunC);
    this.sun.intensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(3.0, 2.0, gold) * look.sun, 0.1, night);
    this.sun.shadow.intensity = THREE.MathUtils.lerp(look.shadow, 0.6, night);
    if (night > 0.5) this.sunDir.copy(u.uMoonDir.value);
    if (this.sunDir.y < 0.12) this.sunDir.y = 0.12;
    this.sunDir.normalize();
    // Sky light comes from the IBL; the hemisphere light only adds a warm bounce.
    this.hemi.color.set(0xfff2e2);
    this.hemi.groundColor.set(0x6e6458).lerp(new THREE.Color(0x221e1a), night);
    this.hemi.intensity = THREE.MathUtils.lerp(0.55, 0.28, night) * (0.7 + 0.3 * look.sun);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.62, 1.5, night) * (1 + overcast * 0.25);

    const fogScale = look.fog * THREE.MathUtils.lerp(1, 1.4, night);
    this.fog.density = 0.00085 * fogScale;
    this.fog.falloff = this.weather === 'rain' || this.weather === 'snow' ? 0.006 : 0.011;
    this.fog.sunGlow = look.sun;

    // Wet / snowy surfaces.
    const sw = this.surface;
    sw.uWet.value = this.weather === 'rain' ? 1 : 0;
    sw.uSnow.value = this.weather === 'snow' ? 1 : 0;

    const L = THREE.MathUtils.lerp;
    const g = this.grade;
    g.exposure = L(L(1.0, 1.06, gold), 1.25, night) * (this.weather === 'snow' ? 0.82 : 1) * (1 - overcast * 0.06);
    g.tint.setRGB(L(L(1.03, 1.1, gold), 1.0, night), L(L(1.0, 0.97, gold), 0.98, night), L(L(0.95, 0.84, gold), 1.04, night));
    if (overcast > 0.3) g.tint.lerp(new THREE.Color(0.97, 1.0, 1.05), overcast * 0.6);
    g.shadow.setRGB(L(0.97, 0.88, night), L(0.99, 0.96, night), L(1.03, 1.12, night));
    g.high.setRGB(L(L(1.06, 1.14, gold), 1.12, night), L(L(1.0, 0.98, gold), 1.0, night), L(L(0.9, 0.8, gold), 0.86, night));
    g.contrast = L(1.06, 1.06, night) * (1 - overcast * 0.04);
    g.saturation = L(L(0.95, 1.02, gold), 1.04, night) * look.sat;
    g.vignette = L(0.26, 0.4, night);
    g.bloom = L(L(0.18, 0.3, gold), 0.72, night) * (this.weather === 'rain' ? 1.25 : 1);

    // Rebuild the LUT + IBL when the light has changed noticeably.
    const key = `${this.weather}|${Math.round(hours * 12)}`;
    if (key !== this.envKey) {
      this.envKey = key;
      this.updateEnvironment();
    }
  }

  /** Render the sky into the equirect LUT and prefilter it for IBL. */
  private updateEnvironment() {
    const r = this.renderer;
    const u = this.skyMat.uniforms;
    const disc = u.showSunDisc.value;
    u.showSunDisc.value = 0;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.lut);
    r.render(this.lutScene, this.lutCam);
    r.setRenderTarget(prev);
    u.showSunDisc.value = disc;
    const env = this.pmrem.fromEquirectangular(this.lut.texture);
    this.envRT?.dispose();
    this.envRT = env;
    this.scene.environment = env.texture;
  }

  /** Keep the shadow frustum around the player. */
  follow(x: number, z: number) {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunDir.x * 140, this.sunDir.y * 140, z + this.sunDir.z * 140);
    this.sun.target.updateMatrixWorld();
    this.sky.position.set(x, 0, z);
  }

  get sunDirection() {
    return this.sunDir;
  }
}
