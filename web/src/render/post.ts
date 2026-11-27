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

const compFs = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
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
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = fxaa(vUv) + texture2D(tBloom, vUv).rgb * uBloom;
  c *= uExposure * uTint / 0.6; // same pre-scale as three.js ACESFilmic
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(uShadow, uHigh, smoothstep(0.02, 0.8, L));
  c = aces(c);
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
        uTexel: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compMat);
    this.quad.frustumCulled = false;
    this.qscene.add(this.quad);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
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
    this.down = [4, 8, 16].map((d) => mk(Math.ceil(w / d), Math.ceil(h / d), false));
    this.up = [4, 8].map((d) => mk(Math.ceil(w / d), Math.ceil(h / d), false));
    this.bytes = w * h * (bpp + 4) + [...this.down, ...this.up].reduce((s, t) => s + t.width * t.height * bpp, 0);
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
    // Composite to screen.
    const u = this.compMat.uniforms;
    u.tScene.value = this.scene.texture;
    u.tBloom.value = this.up[0].texture;
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
