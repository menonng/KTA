// Lightweight HDR post chain: scene -> HalfFloat target -> 3-level bloom
// (1/4, 1/8, 1/16 res) -> composite (exposure, split-tone grading, ACES,
// contrast/saturation, vignette, sRGB). About 1.3x one full-res target in
// memory, far less than a stock EffectComposer setup (plan 4.4 ③).

import * as THREE from 'three';

export interface Grade {
  exposure: number;
  tint: THREE.Color;
  shadow: THREE.Color;
  high: THREE.Color;
  contrast: number;
  saturation: number;
  vignette: number;
  bloom: number;
}

const vs = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const downFs = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  if (uThreshold > 0.0) {
    // Soft-knee threshold (knee 0.5).
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThreshold + 0.5, 0.0, 1.0);
    soft = soft * soft / (2.0 + 1e-4);
    c *= max(soft, br - uThreshold) / max(br, 1e-4);
    c = min(c, vec3(30.0));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const upFs = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tLow;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 l = texture2D(tLow, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(tLow, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture2D(tLow, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture2D(tLow, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  gl_FragColor = vec4(texture2D(tSrc, vUv).rgb + l * 0.25, 1.0);
}`;

// Screen-space ambient occlusion at half resolution from the scene depth:
// view-space hemisphere samples around the depth-derived normal.
const aoFs = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform vec2 uTexel;
uniform vec3 uKernel[12];
uniform float uRadius;
varying vec2 vUv;
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 p = viewPos(vUv);
  vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0));
  vec3 pl = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y));
  vec3 pd = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  vec3 n = normalize(cross(dx, dy));
  float a = hash(gl_FragCoord.xy) * 6.2831853;
  vec3 rv = vec3(cos(a), sin(a), 0.0);
  vec3 t = normalize(rv - n * dot(rv, n));
  vec3 b = cross(n, t);
  mat3 tbn = mat3(t, b, n);
  float rad = uRadius * clamp(-p.z / 6.0, 0.6, 2.5);
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    vec3 sp = p + tbn * uKernel[i] * rad;
    vec4 c = uProj * vec4(sp, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
    float sz = viewPos(suv).z;
    float range = smoothstep(0.0, 1.0, rad / max(abs(p.z - sz), 1e-3));
    occ += step(sp.z + 0.04 * rad, sz) * range;
  }
  float ao = 1.0 - occ / 12.0;
  gl_FragColor = vec4(vec3(ao), 1.0);
}`;

// 4x4 box blur of the AO term (kills the per-pixel rotation noise).
const aoBlurFs = /* glsl */ `
uniform sampler2D tAO;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  float s = 0.0;
  for (int x = -2; x < 2; x++) for (int y = -2; y < 2; y++) s += texture2D(tAO, vUv + (vec2(x, y) + 0.5) * uTexel).r;
  gl_FragColor = vec4(vec3(s / 16.0), 1.0);
}`;

const compFs = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tAdapt;
uniform float uFogScale;
uniform float uKey;
uniform sampler2D tAO;
uniform float uAO;
uniform sampler2D tDepth;
uniform sampler2D tSkyLUT;
uniform mat4 uProjInvC;
uniform mat4 uProjC;
uniform mat4 uViewInv;
uniform mat4 uView;
uniform vec3 uCamPos;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uWet;
uniform float uExposure;
uniform vec3 uTint;
uniform vec3 uShadow;
uniform vec3 uHigh;
uniform float uContrast;
uniform float uSat;
uniform float uVignette;
uniform float uBloom;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 fetchS(vec2 uv) { return texture2D(tScene, uv).rgb; }
// Perceptual luma for edge detection on HDR input.
float lumP(vec3 c) { float l = dot(c, vec3(0.299, 0.587, 0.114)) * uExposure / 0.6; return l / (1.0 + l); }
// FXAA (console variant) on the HDR scene, before tone mapping.
vec3 fxaa(vec2 uv) {
  vec3 cM = fetchS(uv);
  float lM = lumP(cM);
  float lNW = lumP(fetchS(uv + vec2(-1.0, -1.0) * uTexel));
  float lNE = lumP(fetchS(uv + vec2(1.0, -1.0) * uTexel));
  float lSW = lumP(fetchS(uv + vec2(-1.0, 1.0) * uTexel));
  float lSE = lumP(fetchS(uv + vec2(1.0, 1.0) * uTexel));
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) return cM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * uTexel;
  vec3 a = 0.5 * (fetchS(uv + dir * (1.0 / 3.0 - 0.5)) + fetchS(uv + dir * (2.0 / 3.0 - 0.5)));
  vec3 b = a * 0.5 + 0.25 * (fetchS(uv - dir * 0.5) + fetchS(uv + dir * 0.5));
  float lB = lumP(b);
  return (lB < lMin || lB > lMax) ? a : b;
}
vec3 worldAt(vec2 uv, float d) {
  vec4 v = uProjInvC * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return (uViewInv * vec4(v.xyz / v.w, 1.0)).xyz;
}
float nH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nV(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(nH(i), nH(i + vec2(1.0, 0.0)), f.x), mix(nH(i + vec2(0.0, 1.0)), nH(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 skyAt(vec3 dir, float lod) {
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));
  vec2 luv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  return textureLod(tSkyLUT, luv, lod).rgb;
}
// Filmic curve (Hable / Uncharted 2, as GTA V uses): keeps shadow detail, rolls highlights off softly.
vec3 hableC(vec3 x) { return ((x * (0.15 * x + 0.05) + 0.004) / (x * (0.15 * x + 0.5) + 0.06)) - 0.0666667; }
vec3 filmic(vec3 x) {
  vec3 c = clamp(hableC(x * 6.27) * 1.163, 0.0, 1.0);
  // Small black level so shadows keep depth (the curve's toe is lifted).
  return max(c - 0.018, 0.0) / 0.982;
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  float ao = mix(1.0, texture2D(tAO, vUv).r, uAO);
  vec3 c = fxaa(vUv) * ao;
  float dz = texture2D(tDepth, vUv).x;
  if (dz < 0.99999) {
    vec3 wp = worldAt(vUv, dz);
    vec3 rd = wp - uCamPos;
    float dist = length(rd);
    vec3 dir = rd / max(dist, 1e-3);
    // Wet streets: screen-space reflection of the city in the ground plane.
    if (uWet > 0.0 && wp.y < 0.3 && dist < 90.0) {
      vec3 R = reflect(dir, vec3(0.0, 1.0, 0.0));
      float pud = smoothstep(0.5, 0.72, nV(wp.xz * 0.11) * 0.7 + nV(wp.xz * 0.6) * 0.3);
      float fres = 0.08 + 0.92 * pow(1.0 - max(-dir.y, 0.0), 5.0);
      float strength = uWet * mix(0.2, 0.8, pud) * fres;
      vec3 refl = skyAt(R, 3.0);
      float t = 0.6;
      for (int i = 0; i < 18; i++) {
        vec3 p = wp + R * t;
        vec4 cp = uProjC * (uView * vec4(p, 1.0));
        vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
        vec3 sp = worldAt(suv, texture2D(tDepth, suv).x);
        float sceneDist = length(sp - uCamPos);
        float rayDist = length(p - uCamPos);
        if (sceneDist < rayDist - 0.05 && rayDist - sceneDist < t * 0.35 + 0.6) {
          // Rough wet asphalt: blur the hit and fade it with distance travelled.
          vec2 bl = vec2(0.004, 0.012) * (0.5 + t * 0.06);
          refl = (texture2D(tScene, suv).rgb * 2.0 + texture2D(tScene, suv + bl).rgb + texture2D(tScene, suv - bl).rgb + texture2D(tScene, suv + vec2(-bl.x, bl.y)).rgb) / 5.0;
          refl = mix(refl, skyAt(R, 3.0), smoothstep(8.0, 40.0, t) * 0.5);
          break;
        }
        t *= 1.28;
      }
      c = mix(c, refl, clamp(strength, 0.0, 0.85));
    }
    // Aerial perspective: exponential height fog lit by the sky in that direction.
    float k = uFogFalloff;
    float h0 = max(uCamPos.y, 0.0);
    float ky = k * rd.y;
    float integ = abs(ky) > 1e-4 ? (1.0 - exp(-ky)) / ky : 1.0;
    // Clear air close to the camera: the haze builds up beyond ~25 m.
    float fogA = 1.0 - exp(-uFogDensity * exp(-k * h0) * max(dist - 25.0, 0.0) * integ);
    c = mix(c, skyAt(dir, 4.5) * 0.85 * uFogScale, clamp(fogA, 0.0, 0.82));
  }
  c += texture2D(tBloom, vUv).rgb * uBloom;
  // Eye adaptation: partial correction towards a mid-grey key from the adapted average luminance.
  float adapted = max(texture2D(tAdapt, vec2(0.5)).r, 1e-4);
  float autoExp = clamp(pow(uKey / adapted, 0.5), 0.7, 1.35);
  c *= uExposure * autoExp * uTint / 0.6;
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(uShadow, uHigh, smoothstep(0.02, 0.8, L));
  c = filmic(c);
  c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
  float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(mix(vec3(g), c, uSat), 0.0, 1.0);
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
  c = toSRGB(c);
  // Tiny dither against banding in the night sky.
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

// Average log luminance of the HDR scene, 4x4 taps per texel of a small target.
const lumFs = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main() {
  float s = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    vec2 o = (vec2(float(x), float(y)) - 1.5) * 0.25 * uTexel;
    vec3 c = texture2D(tSrc, vUv + o).rgb;
    s += log(dot(c, vec3(0.2126, 0.7152, 0.0722)) + 1e-4);
  }
  gl_FragColor = vec4(s / 16.0, 0.0, 0.0, 1.0);
}`;

// Adapted luminance: average of the small target, eased over time (faster towards bright, like an eye).
const adaptFs = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform vec2 uSize;
uniform float uDt;
void main() {
  float s = 0.0;
  for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++) {
    s += texture2D(tLum, (vec2(float(x), float(y)) + 0.5) / uSize).r;
  }
  float target = exp(s / 576.0);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (prev <= 0.0 || prev > 1e4) prev = target;
  float rate = target > prev ? 1.6 : 0.8;
  gl_FragColor = vec4(prev + (target - prev) * (1.0 - exp(-uDt * rate)), 0.0, 0.0, 1.0);
}`;

export class Post {
  private scene!: THREE.WebGLRenderTarget;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private qscene = new THREE.Scene();
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private aoMat: THREE.ShaderMaterial;
  private aoBlurMat: THREE.ShaderMaterial;
  private ao!: THREE.WebGLRenderTarget;
  private aoBlur!: THREE.WebGLRenderTarget;
  aoStrength = 0.9;
  private lumMat!: THREE.ShaderMaterial;
  private adaptMat!: THREE.ShaderMaterial;
  private lum!: THREE.WebGLRenderTarget;
  private adapt: THREE.WebGLRenderTarget[] = [];
  private adaptIdx = 0;
  private lastT = 0;
  /** Atmosphere inputs (set by main from the Environment). */
  atmo: { lut: THREE.Texture | null; density: number; falloff: number; wet: number; fogScale: number } = { lut: null, density: 0.002, falloff: 0.01, wet: 0, fogScale: 1 };
  bytes = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.downMat = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: downFs,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: upFs,
      uniforms: { tSrc: { value: null }, tLow: { value: null }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: compFs,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uExposure: { value: 1 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uShadow: { value: new THREE.Color(1, 1, 1) },
        uHigh: { value: new THREE.Color(1, 1, 1) },
        uContrast: { value: 1 },
        uSat: { value: 1 },
        uVignette: { value: 0.3 },
        uBloom: { value: 0.3 },
        tAdapt: { value: null },
        uFogScale: { value: 1 },
        uKey: { value: 0.14 },
        uTexel: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
    // Hemisphere kernel, denser near the centre.
    const kernel: THREE.Vector3[] = [];
    let seed = 3;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 0.85 + 0.15).normalize();
      const k = (i + 1) / 12;
      v.multiplyScalar(0.15 + 0.85 * k * k);
      kernel.push(v);
    }
    this.aoMat = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: aoFs,
      uniforms: { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uKernel: { value: kernel }, uRadius: { value: 0.75 } },
      depthTest: false,
      depthWrite: false,
    });
    this.aoBlurMat = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: aoBlurFs,
      uniforms: { tAO: { value: null }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    const cu = this.compMat.uniforms;
    cu.tAO = { value: null };
    cu.uAO = { value: 0.75 };
    cu.tDepth = { value: null };
    cu.tSkyLUT = { value: null };
    cu.uProjInvC = { value: new THREE.Matrix4() };
    cu.uProjC = { value: new THREE.Matrix4() };
    cu.uViewInv = { value: new THREE.Matrix4() };
    cu.uView = { value: new THREE.Matrix4() };
    cu.uCamPos = { value: new THREE.Vector3() };
    cu.uFogDensity = { value: 0.002 };
    cu.uFogFalloff = { value: 0.01 };
    cu.uWet = { value: 0 };
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat);
    this.quad.frustumCulled = false;
    this.qscene.add(this.quad);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.lumMat = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: lumFs, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
    this.adaptMat = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: adaptFs, uniforms: { tLum: { value: null }, tPrev: { value: null }, uSize: { value: new THREE.Vector2(32, 18) }, uDt: { value: 0.016 } }, depthTest: false, depthWrite: false });
    const small = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.lum = small(32, 18);
    this.adapt = [small(1, 1), small(1, 1)];
    this.setSize(size.x, size.y);
  }

  setSize(w: number, h: number) {
    // Packed R11G11B10 float colour (4 B/px instead of 8) where renderable:
    // HDR range kept, alpha not needed. Halves bandwidth of every pass.
    const packed = this.renderer.extensions.has('EXT_color_buffer_float');
    const mk = (sw: number, sh: number, depth: boolean) => {
      const t = new THREE.WebGLRenderTarget(Math.max(1, sw), Math.max(1, sh), {
        type: THREE.HalfFloatType,
        format: packed ? THREE.RGBFormat : THREE.RGBAFormat,
        depthBuffer: depth,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      if (packed) t.texture.internalFormat = 'R11F_G11F_B10F';
      return t;
    };
    const bpp = packed ? 4 : 8;
    this.scene?.dispose();
    this.down.forEach((t) => t.dispose());
    this.up.forEach((t) => t.dispose());
    this.scene = mk(w, h, true);
    this.scene.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    this.ao?.dispose();
    this.aoBlur?.dispose();
    const aoT = () => new THREE.WebGLRenderTarget(Math.ceil(w / 2), Math.ceil(h / 2), { type: THREE.UnsignedByteType, format: THREE.RedFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.ao = aoT();
    this.aoBlur = aoT();
    this.down = [4, 8, 16].map((d) => mk(Math.ceil(w / d), Math.ceil(h / d), false));
    this.up = [4, 8].map((d) => mk(Math.ceil(w / d), Math.ceil(h / d), false));
    this.bytes = w * h * (bpp + 4) + [...this.down, ...this.up].reduce((s, t) => s + t.width * t.height * bpp, 0) + this.ao.width * this.ao.height * 2;
    this.compMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qscene, this.cam);
  }

  /** Compile scene programs for the HDR target ahead of the first frame. */
  compile(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.setRenderTarget(this.scene);
    this.renderer.compile(scene, camera);
    this.renderer.setRenderTarget(null);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, g: Grade) {
    const r = this.renderer;
    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    // Ambient occlusion (half res) + blur.
    const cam = camera as THREE.PerspectiveCamera;
    const au = this.aoMat.uniforms;
    au.tDepth.value = this.scene.depthTexture;
    au.uProj.value.copy(cam.projectionMatrix);
    au.uProjInv.value.copy(cam.projectionMatrixInverse);
    au.uTexel.value.set(1 / this.scene.width, 1 / this.scene.height);
    this.pass(this.aoMat, this.ao);
    this.aoBlurMat.uniforms.tAO.value = this.ao.texture;
    this.aoBlurMat.uniforms.uTexel.value.set(1 / this.ao.width, 1 / this.ao.height);
    this.pass(this.aoBlurMat, this.aoBlur);
    // Downsample chain (first pass thresholds).
    let src: THREE.WebGLRenderTarget = this.scene;
    this.down.forEach((t, i) => {
      this.downMat.uniforms.tSrc.value = src.texture;
      this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.downMat.uniforms.uThreshold.value = i === 0 ? 1.0 : 0.0;
      this.pass(this.downMat, t);
      src = t;
    });
    // Upsample: up[1] = down[1] + down[2]; up[0] = down[0] + up[1].
    this.upMat.uniforms.tSrc.value = this.down[1].texture;
    this.upMat.uniforms.tLow.value = this.down[2].texture;
    this.upMat.uniforms.uTexel.value.set(1 / this.down[2].width, 1 / this.down[2].height);
    this.pass(this.upMat, this.up[1]);
    this.upMat.uniforms.tSrc.value = this.down[0].texture;
    this.upMat.uniforms.tLow.value = this.up[1].texture;
    this.upMat.uniforms.uTexel.value.set(1 / this.up[1].width, 1 / this.up[1].height);
    this.pass(this.upMat, this.up[0]);
    // Eye adaptation.
    const now = performance.now();
    const dt = this.lastT ? Math.min(0.25, (now - this.lastT) / 1000) : 10;
    this.lastT = now;
    this.lumMat.uniforms.tSrc.value = this.scene.texture;
    this.lumMat.uniforms.uTexel.value.set(1 / 32, 1 / 18);
    this.pass(this.lumMat, this.lum);
    const prev = this.adapt[this.adaptIdx];
    const next = this.adapt[1 - this.adaptIdx];
    this.adaptMat.uniforms.tLum.value = this.lum.texture;
    this.adaptMat.uniforms.tPrev.value = prev.texture;
    this.adaptMat.uniforms.uDt.value = dt;
    this.pass(this.adaptMat, next);
    this.adaptIdx = 1 - this.adaptIdx;
    // Composite to screen.
    const u = this.compMat.uniforms;
    u.tAdapt.value = next.texture;
    u.tScene.value = this.scene.texture;
    u.tBloom.value = this.up[0].texture;
    u.tAO.value = this.aoBlur.texture;
    u.uAO.value = this.aoStrength;
    u.tDepth.value = this.scene.depthTexture;
    u.tSkyLUT.value = this.atmo.lut;
    u.uProjInvC.value.copy(cam.projectionMatrixInverse);
    u.uProjC.value.copy(cam.projectionMatrix);
    u.uViewInv.value.copy(cam.matrixWorld);
    u.uView.value.copy(cam.matrixWorldInverse);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uFogDensity.value = this.atmo.lut ? this.atmo.density : 0;
    u.uFogFalloff.value = this.atmo.falloff;
    u.uWet.value = this.atmo.wet;
    u.uFogScale.value = this.atmo.fogScale;
    u.uExposure.value = g.exposure;
    u.uTint.value.copy(g.tint);
    u.uShadow.value.copy(g.shadow);
    u.uHigh.value.copy(g.high);
    u.uContrast.value = g.contrast;
    u.uSat.value = g.saturation;
    u.uVignette.value = g.vignette;
    u.uBloom.value = g.bloom;
    this.pass(this.compMat, null);
  }
}
