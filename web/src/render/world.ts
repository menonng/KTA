// Buildings, roads, ground and subway entrances from the Rust core.
// Building facades (windows, shopfronts, colors, lit windows at night) are
// computed in the fragment shader, so the city uses no textures at all.

import * as THREE from 'three';
import type { Game } from '../wasm/kta_wasm.js';
import type { TextureSet } from './textures';

const HASH = /* glsl */ `
// Sine-free hashes (stable for large inputs on all GPUs).
float kH1(float n) { n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }
float kH2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float kN(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(kH2(i), kH2(i + vec2(1.0, 0.0)), f.x), mix(kH2(i + vec2(0.0, 1.0)), kH2(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Box-filtered periodic pulse: anti-aliased procedural lines without textures.
float kPI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
float kPulse(float x, float a, float b, float w) {
  w = max(w, 1e-4);
  return clamp((kPI(x + 0.5 * w, a, b) - kPI(x - 0.5 * w, a, b)) / w, 0.0, 1.0);
}
`;

// Interior mapping: ray-cast into a box room behind each window (GTA V style).
// p in room meters (x across, y up, z=0 at glass), r ray in facade space (z into room).
const INTERIOR = /* glsl */ `
vec3 kRoom(vec2 cell, vec3 r, vec3 size, float seed, float shop, out float back) {
  vec3 p = vec3(cell.x * size.x, cell.y * size.y, 0.0);
  r.z = max(r.z, 0.08);
  float tx = r.x > 0.0 ? (size.x - p.x) / r.x : (r.x < 0.0 ? -p.x / r.x : 1e5);
  float ty = r.y > 0.0 ? (size.y - p.y) / r.y : (r.y < 0.0 ? -p.y / r.y : 1e5);
  float tz = size.z / r.z;
  float t = min(min(tx, ty), tz);
  vec3 h = p + r * t;
  float hw = kH1(seed * 3.1);
  vec3 wallC = shop > 0.5 ? (hw < 0.4 ? vec3(0.85, 0.85, 0.83) : hw < 0.7 ? vec3(0.55, 0.42, 0.32) : vec3(0.3, 0.32, 0.35)) : (hw < 0.33 ? vec3(0.86, 0.82, 0.74) : hw < 0.66 ? vec3(0.78, 0.84, 0.88) : vec3(0.9, 0.86, 0.8));
  vec3 c;
  back = 0.0;
  if (t == tz) {
    back = 1.0;
    c = wallC;
    float fx = h.x / size.x;
    if (shop > 0.5) {
      // Shelves with goods on the back wall.
      float sy = fract(h.y / 0.45);
      float g = kH2(floor(vec2(h.x / 0.22, h.y / 0.45)) + seed);
      vec3 goods = g < 0.25 ? vec3(0.85, 0.25, 0.2) : g < 0.5 ? vec3(0.95, 0.8, 0.3) : g < 0.75 ? vec3(0.2, 0.45, 0.8) : vec3(0.9, 0.9, 0.88);
      float shelfOn = step(0.5, kH1(seed * 4.1));
      c = mix(c, goods * (0.6 + 0.4 * kH1(g * 9.0)), shelfOn * step(0.22, sy) * step(h.y, 2.0) * 0.9);
      c = mix(c, vec3(0.45), shelfOn * step(sy, 0.08) * step(h.y, 2.05));
      // Poster / menu board when no shelves.
      c = mix(c, mix(vec3(0.95, 0.85, 0.3), vec3(0.9, 0.35, 0.3), step(0.5, kH1(seed))), (1.0 - shelfOn) * step(abs(fx - 0.5), 0.3) * step(abs(h.y - 1.7), 0.35));
    } else {
      float fpos = 0.25 + 0.5 * kH1(seed * 5.7);
      if (h.y < 0.85 && abs(fx - fpos) < 0.22) c *= 0.32;                    // sofa / desk
      if (h.y > 1.25 && h.y < 1.85 && abs(fx - (1.0 - fpos)) < 0.12 && kH1(seed * 2.9) > 0.45) c = vec3(0.32, 0.26, 0.2); // frame / shelf
      if (kH1(seed * 7.3) > 0.7 && h.y < 1.9 && abs(fx - 0.85) < 0.08) c = vec3(0.25, 0.3, 0.22); // plant
    }
  } else if (t == ty) {
    c = r.y < 0.0 ? (shop > 0.5 ? mix(vec3(0.5, 0.48, 0.45), vec3(0.32, 0.24, 0.18), step(0.5, hw)) : vec3(0.42, 0.3, 0.2)) : vec3(0.95);
    if (r.y > 0.0) c += vec3(1.6, 1.5, 1.3) * smoothstep(0.35, 0.0, length(vec2(h.x / size.x - 0.5, h.z / size.z - 0.5))) * 0.6;
  } else {
    c = wallC * 0.82;
    if (shop > 0.5) c = mix(c, vec3(0.7, 0.6, 0.4), step(0.3, fract(h.y / 0.45)) * step(h.y, 2.0) * 0.5);
  }
  c *= mix(1.0, 0.6, h.z / size.z);
  return c;
}
`;

const FACADE = /* glsl */ `
float fU = vFacade.x * 0.01;
float fV = vFacade.y * 0.01;
float fSeed = floor(vFacadeId.x + 0.5);
float fKf = floor(vFacadeId.y + 0.5);
float fKind = mod(fKf, 16.0);
float fShopE = step(7.5, fKind); // street-facing shop-front wall
fKind = mod(fKind, 8.0);
float fRoof = mod(floor(fKf / 16.0), 2.0);
float fH = floor(fKf / 32.0) * 0.5;
float floorH = 3.3;
float colW = 2.2 + kH1(fSeed * 2.1) * 1.8;
vec2 gp = vec2(fU / colW, fV / floorH);
vec2 gw = fwidth(gp);
float farF = smoothstep(0.2, 0.6, max(gw.x, gw.y));
float fRough = 0.86;
vec3 fEmis = vec3(0.0);
vec3 fCol;
vec3 fNt = vec3(0.0, 0.0, 1.0);
vec3 nW0 = normalize(vWN);
vec3 rd = normalize(vWP - cameraPosition);
vec3 Tw = normalize(vec3(-nW0.z, 0.0, nW0.x) + vec3(1e-5));
vec3 rT = vec3(dot(rd, Tw), rd.y, -dot(rd, nW0));
float fres = 0.04 + 0.96 * pow(1.0 - clamp(abs(dot(rd, nW0)), 0.0, 1.0), 5.0);
vec3 skyRefl;
{
  // Cheap reflection probe: sky gradient above a jagged skyline of buildings.
  vec3 rr = reflect(rd, nW0);
  float az = atan(rr.x, rr.z);
  float sky = 0.06 + 0.22 * kN(vec2(az * 7.0, 1.0)) + 0.1 * step(0.7, kN(vec2(az * 23.0, 4.0)));
  vec3 skyC = mix(uHorizon, uTop, pow(clamp(rr.y, 0.0, 1.0), 0.55)) * 1.1;
  vec3 bld = mix(vec3(0.16, 0.16, 0.17), vec3(0.012, 0.012, 0.018), uNight);
  vec2 wg = vec2(az * 40.0, rr.y * 60.0);
  bld += vec3(1.0, 0.8, 0.55) * uNight * 0.5 * step(0.72, kH2(floor(wg))) * step(0.3, fract(wg.x)) * step(0.35, fract(wg.y));
  vec3 grd = mix(vec3(0.1, 0.1, 0.1), vec3(0.015), uNight);
  skyRefl = rr.y < 0.0 ? grd : (rr.y < sky ? bld : skyC);
}
if (fRoof > 0.5) {
  vec2 uv = vec2(fU, fV) / 3.0;
  fCol = texture(tWallA, vec3(uv, 8.0)).rgb * (0.85 + 0.25 * kH1(fSeed * 1.9));
  fNt = texture(tWallN, vec3(uv, 8.0)).xyz * 2.0 - 1.0;
  if (kH1(fSeed * 3.7) > 0.86) fCol *= vec3(0.62, 0.95, 0.66);
  else if (kH1(fSeed * 5.3) > 0.82) fCol *= vec3(0.6, 0.92, 0.9);
} else {
  float r = kH1(fSeed * 1.37 + 3.1);
  float layer = 2.0;
  float scale = 2.5;
  vec3 tint = vec3(1.0);
  if (r < 0.18) { layer = 0.0; scale = 1.8; }
  else if (r < 0.34) { layer = 3.0; scale = 1.2; }
  else if (r < 0.50) { layer = 2.0; scale = 2.5; tint = vec3(1.18, 1.17, 1.14); }
  else if (r < 0.63) { layer = 6.0; scale = 3.0; }
  else if (r < 0.72) { layer = 7.0; scale = 1.8; tint = vec3(1.05); }
  else if (r < 0.82) { layer = 4.0; scale = 1.2; }
  else if (r < 0.91) { layer = 1.0; scale = 1.8; }
  else { layer = 2.0; scale = 2.5; tint = vec3(0.78, 0.9, 1.02); }
  tint *= 0.92 + 0.14 * kH1(fSeed * 6.1);
  vec2 wuv = vec2(fU, fV) / scale + vec2(kH1(fSeed * 8.3), kH1(fSeed * 9.7));
  vec3 wcol = texture(tWallA, vec3(wuv, layer)).rgb * tint;
  fNt = texture(tWallN, vec3(wuv, layer)).xyz * 2.0 - 1.0;
  float streak = kN(vec2(fU * 1.4, fV * 0.05) + fSeed * 2.0);
  wcol *= 1.0 - 0.14 * smoothstep(0.62, 0.95, streak) * smoothstep(fH, fH - 6.0, fV);
  float band = kPulse(gp.y, 0.0, 0.03, gw.y);
  fCol = wcol * (1.0 - 0.14 * band);
  bool shop = fShopE > 0.5;
  if (fV < floorH && shop) {
    // Ground floor: granite cladding, aluminum frames, deep shop interiors.
    vec2 guv = vec2(fU, fV) / 2.0;
    vec3 gcol = texture(tWallA, vec3(guv, 5.0)).rgb * (kH1(fSeed * 4.4) > 0.5 ? vec3(1.05) : vec3(0.58, 0.56, 0.54));
    vec3 gn = texture(tWallN, vec3(guv, 5.0)).xyz * 2.0 - 1.0;
    float mw = 1.6 + kH1(fSeed * 7.7) * 1.4;
    float mx = fU / mw;
    float mwid = fwidth(mx);
    float inY = step(0.35, fV) * step(fV, 2.7);
    float glass = (1.0 - kPulse(mx, 0.0, 0.07, mwid)) * inY;
    float frame = clamp((1.0 - kPulse(mx, 0.0, 0.04, mwid)) * step(0.3, fV) * step(fV, 2.76) - glass, 0.0, 1.0);
    fCol = mix(gcol, vec3(0.55, 0.57, 0.6), frame);
    fNt = mix(gn, vec3(0.0, 0.0, 1.0), frame);
    fRough = mix(0.55, 0.35, frame);
    if (glass > 0.001) {
      float bay = floor(mx);
      float bs = kH1(bay * 1.7 + fSeed);
      float back;
      vec2 cell = vec2(fract(mx), clamp((fV - 0.35) / 2.35, 0.0, 1.0));
      vec3 room = vec3(0.7);
      if (farF < 0.999) room = kRoom(cell, rT, vec3(mw, 2.35, 6.0), bay + fSeed, 1.0, back); // skip the ray-cast where it is faded out
      vec3 lightC = bs < 0.35 ? vec3(1.0, 1.0, 1.02) : bs < 0.7 ? vec3(1.0, 0.86, 0.66) : vec3(1.0, 0.74, 0.55);
      float on = mix(step(0.15, kH1(bay + fSeed * 0.3)), 0.85, farF);
      vec3 inside = mix(room * lightC, vec3(0.75, 0.7, 0.62), farF);
      float level = mix(0.075, 0.62, uNight) * on;
      fCol = mix(fCol, vec3(0.02), glass);
      fNt = mix(fNt, vec3(0.0, 0.0, 1.0), glass);
      fRough = mix(fRough, 0.06, glass);
      fres = max(fres, 0.12);
      fEmis = (inside * level * vec3(0.86, 0.92, 0.9) * (1.0 - fres) + skyRefl * fres) * glass;
    }
    if (fV > 2.76) fCol = gcol * 0.85;
  } else if (fV >= floorH && (fKind == 2.0 || fKind == 0.0) && fH > 9.5 && kH1(fSeed * 11.3) < 0.36) {
    // Glass curtain wall on upper floors (2000s-2010s commercial blocks around
    // Hongdae): tinted panels in an aluminium grid, opaque spandrel band at
    // each slab, office floors lit as a whole at night.
    float pw = 1.2 + kH1(fSeed * 12.7) * 0.45;
    vec2 cg = vec2(fU / pw, (fV - floorH) / floorH);
    vec2 cgw = fwidth(cg);
    float frm = clamp(kPulse(cg.x, 0.0, 0.035, cgw.x) + kPulse(cg.y, 0.0, 0.03, cgw.y) + kPulse(cg.y, 0.24, 0.265, cgw.y), 0.0, 1.0) * (1.0 - farF * 0.7);
    float span = kPulse(cg.y, 0.03, 0.24, cgw.y) * (1.0 - frm);
    float glassC = (1.0 - frm) * (1.0 - span);
    vec3 tintG = mix(vec3(0.30, 0.42, 0.48), vec3(0.36, 0.44, 0.38), step(0.6, kH1(fSeed * 13.1)));
    vec2 cell = vec2(fract(cg.x), clamp((fract(cg.y) - 0.265) / 0.735, 0.0, 1.0));
    float back;
    vec3 room = vec3(0.5);
    if (farF < 0.999) room = kRoom(cell, rT, vec3(pw, floorH * 0.73, 7.0), floor(cg.x) * 1.3 + floor(cg.y) * 7.1 + fSeed, 0.0, back);
    float lit = step(0.5, kH2(vec2(floor(cg.y), fSeed)));
    vec3 inside = mix(room, vec3(0.5), farF) * mix(vec3(1.0), vec3(0.88, 0.94, 1.0), uNight);
    float level = mix(0.035, 0.8 * lit + 0.02, uNight);
    float fr3 = max(fres, 0.32);
    fCol = mix(vec3(0.02), vec3(0.36, 0.37, 0.39), frm);
    fCol = mix(fCol, tintG * 0.12, span);
    fRough = mix(0.06, 0.4, frm);
    fNt = vec3(0.0, 0.0, 1.0);
    fEmis = (inside * level * tintG * (1.0 - fr3) + skyRefl * tintG * fr3 * 1.6) * glassC + skyRefl * tintG * fr3 * 1.2 * span;
  } else if (fV >= floorH) {
    float winW = 0.40 + kH1(fSeed * 4.3) * 0.32;
    float winH = 0.42 + kH1(fSeed * 5.9) * 0.2;
    float cov = kPulse(gp.x, 0.5 - winW * 0.5, 0.5 + winW * 0.5, gw.x)
              * kPulse(gp.y, 0.3, 0.3 + winH, gw.y)
              * step(0.9, fH - fV);
    float frameW = (1.0 - farF) * (1.0 - kPulse(gp.x, 0.5 - winW * 0.44, 0.5 + winW * 0.44, gw.x)
              * kPulse(gp.y, 0.3 + winH * 0.04, 0.3 + winH * 0.96, gw.y)) * cov;
    float glassA = cov - frameW;
    // Recess shadow just inside the frame (top/left) for depth.
    if (glassA > 0.001) {
      vec2 cell = vec2(fract(gp.x), fract(gp.y));
      float back;
      vec2 wc = floor(gp);
      float ws = kH2(wc + fSeed * 0.37);
      vec3 room = vec3(0.6);
      if (farF < 0.999) {
        room = kRoom(cell, rT, vec3(colW, floorH, colW * 1.3), ws * 97.0, 0.0, back);
        // Curtains / blinds on some windows.
        float wy = (cell.y - 0.3) / winH;
        float blinds = step(0.72, kH1(ws * 9.1)) * step(1.0 - kH1(ws * 3.3) * 0.7, wy);
        room = mix(room, vec3(0.86, 0.84, 0.78) * (0.85 + 0.15 * step(0.5, fract(wy * 18.0))), blinds);
        float curtain = step(0.8, kH1(ws * 5.9)) * step(abs(fract(gp.x) - 0.5), winW * 0.5) * step(winW * 0.22, abs(fract(gp.x) - 0.5));
        room = mix(room, mix(vec3(0.7, 0.55, 0.45), vec3(0.5, 0.6, 0.7), kH1(ws * 1.3)), curtain);
      }
      float lit = step(0.5, ws);
      vec3 lightC = mix(vec3(1.0, 0.78, 0.5), vec3(0.75, 0.86, 1.0), step(0.85, ws));
      float level = mix(0.05, 0.85 * lit + 0.025, uNight);
      vec3 inside = mix(room * mix(vec3(1.0), lightC, uNight), vec3(0.55, 0.5, 0.45) * mix(0.5, 0.48 + 0.0 * lit, uNight), farF);
      fCol = mix(fCol, vec3(0.02), glassA);
      fRough = mix(fRough, 0.05, glassA);
      fNt = mix(fNt, vec3(0.0, 0.0, 1.0), cov);
      float fr2 = max(fres, 0.16);
      fEmis = (inside * level * (1.0 - fr2) + skyRefl * fr2) * glassA;
      // Security bars (방범창) on low floors of houses and villas.
      if ((fKind == 1.0 || fKind == 0.0) && floor(gp.y) <= 2.0 && kH1(fSeed * 3.3) < 0.6) {
        float bx = fU / 0.13;
        float bars = kPulse(bx, 0.0, 0.2, fwidth(bx)) * (1.0 - farF) * glassA;
        fCol = mix(fCol, vec3(0.72, 0.72, 0.7), bars);
        fEmis *= 1.0 - bars;
      }
    }
    fCol = mix(fCol, vec3(0.78, 0.79, 0.8), frameW);
  }
  if (fH - fV < 0.32) fCol *= 0.82;
}
diffuseColor.rgb = fCol;
`;

// Apply the material normal map in facade tangent space (walls) or roof space.
const FACADE_NORMAL = /* glsl */ `
{
  vec3 Bw = vec3(0.0, 1.0, 0.0);
  vec3 Tn = Tw;
  if (fRoof > 0.5) { Tn = vec3(1.0, 0.0, 0.0); Bw = vec3(0.0, 0.0, -1.0); }
  vec3 nP = normalize(Tn * fNt.x * 0.9 + Bw * fNt.y * 0.9 + nW0 * max(fNt.z, 0.25));
  normal = normalize((viewMatrix * vec4(nP, 0.0)).xyz);
}
`;

const ROAD = /* glsl */ `
float rA = vRoad.x;
float rX = vRoad.y;
float rOne = step(15.5, vRoad.z);
float rK = mod(vRoad.z, 16.0);
float rHw = vRoad.w;
float gl = 0.0;
vec2 guv = vec2(rA, rX) / 4.0;
if (rK > 8.5) { gl = 1.0; guv = vec2(rA, rX) / 2.0; }
else if (rK > 5.5 && rK < 6.5) { gl = 2.0; guv = vec2(rA, rX) / 2.0; }
else if (rK > 6.5 && rK < 7.5) { gl = 1.0; guv = vec2(rA, rX) / 2.0; }
vec3 rc = texture(tGroundA, vec3(guv, gl)).rgb;
vec3 gNt = texture(tGroundN, vec3(guv, gl)).xyz * 2.0 - 1.0;
if (gl < 0.5) rc *= 1.3 * (0.82 + 0.25 * kN(vec2(rA, rX) * 0.06 + 13.0));
if (rK < 3.5 || rK > 7.5) {
  float ax = abs(rX);
  float edge = rHw - ax;
  vec3 yel = vec3(0.8, 0.6, 0.12);
  vec3 wht = vec3(0.78, 0.78, 0.76);
  float wear = 0.75 + 0.25 * kN(vec2(rA * 0.8, rX * 3.0));
  if (rOne < 0.5) {
    if (rK < 2.5 && ax > 0.08 && ax < 0.26) rc = mix(rc, yel, wear);
    if (rK >= 2.5 && ax < 0.08 && fract(rA / 8.0) < 0.5) rc = mix(rc, yel, wear);
    float lane = ax / 3.25;
    float lf = min(fract(lane), 1.0 - fract(lane));
    if (rK < 2.5 && ax > 1.2 && edge > 1.0 && lf < 0.035 && fract(rA / 9.0) < 0.5) rc = mix(rc, wht, wear);
  } else {
    float fromL = rX + rHw;
    float lane = fromL / 3.25;
    float lf = min(fract(lane), 1.0 - fract(lane));
    if (fromL > 1.0 && edge > 1.0 && lf < 0.035 && fract(rA / 9.0) < 0.5) rc = mix(rc, wht, wear);
    if (rHw - rX > 0.15 && rHw - rX < 0.3) rc = mix(rc, yel, wear);
  }
  if (edge > 0.3 && edge < 0.45) rc = mix(rc, wht, wear);
}
diffuseColor.rgb = rc;
`;

// Cotangent-frame normal mapping for flat ground surfaces.
const GROUND_NORMAL = /* glsl */ `
{
  vec3 N = normalize(vGN);
  vec3 dp1 = dFdx(vGP);
  vec3 dp2 = dFdy(vGP);
  vec2 duv1 = dFdx(guv);
  vec2 duv2 = dFdy(guv);
  vec3 dp2p = cross(dp2, N);
  vec3 dp1p = cross(N, dp1);
  vec3 T = dp2p * duv1.x + dp1p * duv2.x;
  vec3 B = dp2p * duv1.y + dp1p * duv2.y;
  float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  vec3 nP = normalize(T * im * gNt.x + B * im * gNt.y + N * max(gNt.z, 0.3));
  normal = normalize((viewMatrix * vec4(nP, 0.0)).xyz);
}
`;

export interface WorldStats {
  chunks: number;
  buildings: number;
  buildingTris: number;
  roadTris: number;
  gpuBytes: number;
  /** Night light-spill layer; hidden in daylight to skip the pass. */
  spill: THREE.Mesh | null;
}

function disposeArray(this: THREE.BufferAttribute) {
  // Free the CPU copy once the GPU has it (memory budget, plan 4.5).
  (this as unknown as { array: unknown }).array = null;
}

export interface SkyUniforms { uTop: THREE.IUniform; uHorizon: THREE.IUniform }

export function createBuildingMaterial(night: { value: number }, tex: TextureSet, sky: SkyUniforms) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = night;
    s.uniforms.tWallA = { value: tex.wallA };
    s.uniforms.tWallN = { value: tex.wallN };
    s.uniforms.uTop = sky.uTop;
    s.uniforms.uHorizon = sky.uHorizon;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFacade;\nvarying vec2 vFacade;\nflat varying vec2 vFacadeId;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = aFacade.xy;\nvFacadeId = aFacade.zw;\nvWP = (modelMatrix * vec4(position, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * normal);');
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nprecision highp sampler2DArray;\nuniform float uNight;\nuniform vec3 uTop;\nuniform vec3 uHorizon;\nuniform sampler2DArray tWallA;\nuniform sampler2DArray tWallN;\nvarying vec2 vFacade;\nflat varying vec2 vFacadeId;\nvarying vec3 vWP;\nvarying vec3 vWN;\n${HASH}\n${INTERIOR}`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FACADE_NORMAL}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmis;');
  };
  m.customProgramCacheKey = () => 'kta-facade-tex-5';
  return m;
}

function groundShader(tex: TextureSet, body: string, extraVert: string) {
  return (s: THREE.WebGLProgramParametersWithUniforms) => {
    s.uniforms.tGroundA = { value: tex.groundA };
    s.uniforms.tGroundN = { value: tex.groundN };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGP;\nvarying vec3 vGN;\n${extraVert}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = (modelMatrix * vec4(position, 1.0)).xyz;\nvGN = vec3(0.0, 1.0, 0.0);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray tGroundA;\nuniform sampler2DArray tGroundN;\nvarying vec3 vGP;\nvarying vec3 vGN;\n${HASH}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${body}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${GROUND_NORMAL}`);
  };
}

export function createRoadMaterial(tex: TextureSet) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 });
  const base = groundShader(tex, ROAD, 'attribute vec4 aRoad;\nvarying vec4 vRoad;');
  m.onBeforeCompile = (s) => {
    base(s);
    s.vertexShader = s.vertexShader.replace('vGN = vec3(0.0, 1.0, 0.0);', 'vGN = vec3(0.0, 1.0, 0.0);\nvRoad = aRoad;');
    s.fragmentShader = s.fragmentShader.replace('varying vec3 vGN;', 'varying vec3 vGN;\nvarying vec4 vRoad;');
  };
  m.customProgramCacheKey = () => 'kta-road-tex-1';
  return m;
}

export function createGroundMaterial(tex: TextureSet) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
  m.onBeforeCompile = groundShader(
    tex,
    `vec2 guv = vGP.xz / 2.0;
     vec3 gNt = texture(tGroundN, vec3(guv, 1.0)).xyz * 2.0 - 1.0;
     diffuseColor.rgb = texture(tGroundA, vec3(guv, 1.0)).rgb * (0.88 + 0.2 * kN(vGP.xz * 0.08));`,
    '',
  );
  m.customProgramCacheKey = () => 'kta-ground-tex-1';
  return m;
}

export function buildWorld(game: Game, memory: WebAssembly.Memory, scene: THREE.Scene, night: { value: number }, tex: TextureSet, sky: SkyUniforms): WorldStats {
  const stats: WorldStats = { chunks: 0, buildings: 0, buildingTris: 0, roadTris: 0, gpuBytes: 0, spill: null };
  const bmat = createBuildingMaterial(night, tex, sky);
  const n = game.chunk_count();
  for (let i = 0; i < n; i++) {
    const d = game.chunk_desc(i);
    const buf = memory.buffer;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(buf, d[0], d[1]).slice();
    const nrm = new Int8Array(buf, d[2], d[3]).slice();
    const att = new Uint16Array(buf, d[4], d[5]).slice();
    const idx = new Uint16Array(buf, d[6], d[7]).slice();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).onUpload(disposeArray));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true).onUpload(disposeArray));
    g.setAttribute('aFacade', new THREE.BufferAttribute(att, 4).onUpload(disposeArray));
    g.setIndex(new THREE.BufferAttribute(idx, 1).onUpload(disposeArray));
    const b = game.chunk_bounds(i);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(b[0], b[1], b[2]), b[3]);
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(b[0] - b[3], 0, b[2] - b[3]),
      new THREE.Vector3(b[0] + b[3], b[1] + b[3], b[2] + b[3]),
    );
    const mesh = new THREE.Mesh(g, bmat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
    stats.chunks++;
    stats.buildings += d[8];
    stats.buildingTris += d[7] / 3;
    stats.gpuBytes += pos.byteLength + nrm.byteLength + att.byteLength + idx.byteLength;
  }

  // Roads + sidewalks (one mesh).
  const r = game.roads_desc();
  const buf = memory.buffer;
  const rg = new THREE.BufferGeometry();
  const rpos = new Float32Array(buf, r[0], r[1]).slice();
  const ratt = new Float32Array(buf, r[2], r[3]).slice();
  const ridx = new Uint32Array(buf, r[4], r[5]).slice();
  rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  const up = new Int8Array((rpos.length / 3) * 3);
  for (let i = 1; i < up.length; i += 3) up[i] = 127;
  rg.setAttribute('normal', new THREE.BufferAttribute(up, 3, true).onUpload(disposeArray));
  rg.setAttribute('aRoad', new THREE.BufferAttribute(ratt, 4).onUpload(disposeArray));
  rg.setIndex(new THREE.BufferAttribute(ridx, 1).onUpload(disposeArray));
  rg.computeBoundingSphere();
  (rg.getAttribute('position') as THREE.BufferAttribute).onUpload(disposeArray);
  const roads = new THREE.Mesh(rg, createRoadMaterial(tex));
  roads.receiveShadow = true;
  roads.matrixAutoUpdate = false;
  scene.add(roads);
  stats.roadTris = ridx.length / 3;
  stats.gpuBytes += rpos.byteLength + ratt.byteLength + ridx.byteLength + up.byteLength;

  // Ground contact shadows along walls (cheap baked AO).
  const sk = game.skirt_desc();
  const sb = memory.buffer;
  const sg = new THREE.BufferGeometry();
  const spos = new Float32Array(sb, sk[0], sk[1]).slice();
  sg.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  sg.setAttribute('aA', new THREE.BufferAttribute(new Uint8Array(sb, sk[2], sk[3]).slice(), 1, true).onUpload(disposeArray));
  sg.setIndex(new THREE.BufferAttribute(new Uint32Array(sb, sk[4], sk[5]).slice(), 1).onUpload(disposeArray));
  sg.computeBoundingSphere();
  (sg.getAttribute('position') as THREE.BufferAttribute).onUpload(disposeArray);
  const skirt = new THREE.Mesh(
    sg,
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute float aA;
        varying float vA;
        void main() {
          vA = aA;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        varying float vA;
        void main() {
          float a = vA * vA * 0.6;
          #ifdef USE_FOG
            a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        }`,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      fog: true,
      transparent: true,
      depthWrite: false,
    }),
  );
  skirt.renderOrder = 1;
  skirt.matrixAutoUpdate = false;
  scene.add(skirt);
  stats.gpuBytes += spos.byteLength + sk[3] + sk[5] * 4;

  // Night light spill from shop fronts: multiply-add blending (dst * (1 + k))
  // brightens the pavement in proportion to its own albedo, like real light.
  const sp = game.spill_desc();
  const pg = new THREE.BufferGeometry();
  const ppos = new Float32Array(sb, sp[0], sp[1]).slice();
  pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  pg.setAttribute('aA', new THREE.BufferAttribute(new Uint8Array(sb, sp[2], sp[3]).slice(), 1, true).onUpload(disposeArray));
  pg.setIndex(new THREE.BufferAttribute(new Uint32Array(sb, sp[4], sp[5]).slice(), 1).onUpload(disposeArray));
  pg.computeBoundingSphere();
  (pg.getAttribute('position') as THREE.BufferAttribute).onUpload(disposeArray);
  const spill = new THREE.Mesh(
    pg,
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aA;
        varying float vA;
        varying vec3 vP;
        void main() {
          vA = aA;
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vA;
        varying vec3 vP;
        float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        void main() {
          // Pools in front of individual shop bays rather than an even band.
          float bay = h(floor(vP.xz / 3.2));
          float k = vA * vA * uNight * (1.6 + 2.4 * bay);
          gl_FragColor = vec4(k * vec3(1.0, 0.82, 0.62), 1.0);
        }`,
      uniforms: { uNight: night },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.OneFactor,
    }),
  );
  spill.renderOrder = 2;
  spill.matrixAutoUpdate = false;
  spill.frustumCulled = true;
  scene.add(spill);
  stats.gpuBytes += ppos.byteLength + sp[3] + sp[5] * 4;
  stats.spill = spill;

  game.free_meshes();

  // Ground.
  const gmat = createGroundMaterial(tex);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2), gmat);
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  scene.add(ground);

  scene.add(buildSkylineFiller(night));
  return stats;
}

/** Low-detail city ring beyond the data area so the horizon is not empty. */
function buildSkylineFiller(night: { value: number }): THREE.InstancedMesh {
  const count = 900;
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.9 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uNight = night;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.9, 0.75, 0.5) * 0.12 * uNight;');
  };
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 620 + rnd() * 520;
    const w = 18 + rnd() * 30;
    const h = 12 + Math.pow(rnd(), 2) * 70;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    m.compose(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), q, new THREE.Vector3(w, h, w * (0.6 + rnd())));
    inst.setMatrixAt(i, m);
  }
  inst.frustumCulled = false;
  return inst;
}

/** Subway entrance canopies (instanced) — returns sign descriptors to add. */
export function buildEntrances(game: Game, scene: THREE.Scene): { x: number; z: number; yaw: number; no: number }[] {
  const e = game.entrances();
  const list: { x: number; z: number; yaw: number; no: number }[] = [];
  for (let i = 0; i < e.length; i += 4) list.push({ x: e[i], z: e[i + 1], yaw: e[i + 2], no: e[i + 3] });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bfc4, roughness: 0.45, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false });
  const stairs = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.9 });
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean }[] = [
    { geo: new THREE.BoxGeometry(2.9, 0.14, 4.7).translate(0, 2.75, 0), mat: steel, shadow: true },
    { geo: new THREE.BoxGeometry(0.1, 2.7, 0.1).translate(1.38, 1.35, -2.25), mat: steel, shadow: true },
    { geo: new THREE.BoxGeometry(0.1, 2.7, 0.1).translate(-1.38, 1.35, -2.25), mat: steel, shadow: true },
    { geo: new THREE.BoxGeometry(0.06, 2.6, 4.4).translate(1.38, 1.35, 0), mat: glass, shadow: false },
    { geo: new THREE.BoxGeometry(0.06, 2.6, 4.4).translate(-1.38, 1.35, 0), mat: glass, shadow: false },
    { geo: new THREE.BoxGeometry(2.8, 2.6, 0.06).translate(0, 1.35, 2.2), mat: glass, shadow: false },
    { geo: new THREE.BoxGeometry(2.6, 0.06, 4.3).translate(0, 0.09, 0), mat: stairs, shadow: false },
  ];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const p of parts) {
    const inst = new THREE.InstancedMesh(p.geo, p.mat, list.length);
    list.forEach((en, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), en.yaw);
      m.compose(new THREE.Vector3(en.x, 0, en.z), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m);
    });
    inst.castShadow = p.shadow;
    inst.receiveShadow = true;
    scene.add(inst);
  }
  return list;
}
