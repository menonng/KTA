// CMU BVH clips -> game skeleton. Each game bone takes its direction from the
// matching source bone and its twist from the source bone's local axis, so the
// different rest poses (CMU T-pose, MakeHuman A-pose) do not matter. Loops are
// cut where the pose repeats; travel is removed and its speed recorded.

import { readFileSync } from 'node:fs';
import { v3, m3, frame, quatFromM3 } from './math.mjs';
import { BONES, BI, SRC, AXIS } from './skeleton.mjs';

/** Posture corrections per bone: [pitch about +X (negative = up / back), roll about +Z] in degrees. */
const POSTURE = {
  spineMid: [-3, 0],
  chest: [-4, 0],
  neck: [-7, 0],
  head: [-9, 0],
  'clavicle.L': [0, -7],
  'clavicle.R': [0, 7],
};

export function parseBVH(text) {
  const tok = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const joints = [];
  const stack = [];
  while (tok[i] !== 'MOTION') {
    const t = tok[i++];
    if (t === 'ROOT' || t === 'JOINT') {
      joints.push({ name: tok[i++], parent: stack.length ? stack[stack.length - 1] : -1, offset: [0, 0, 0], channels: [] });
      stack.push(joints.length - 1);
    } else if (t === 'End') {
      i++;
      const parent = stack[stack.length - 1];
      joints.push({ name: joints[parent].name + '_end', parent, offset: [0, 0, 0], channels: [] });
      stack.push(joints.length - 1);
    } else if (t === 'OFFSET') {
      joints[stack[stack.length - 1]].offset = [+tok[i], +tok[i + 1], +tok[i + 2]];
      i += 3;
    } else if (t === 'CHANNELS') {
      const n = +tok[i++];
      joints[stack[stack.length - 1]].channels = tok.slice(i, i + n);
      i += n;
    } else if (t === '}') stack.pop();
  }
  i += 2;
  const nf = +tok[i++];
  i += 2;
  const ft = +tok[i++];
  const nch = joints.reduce((s, j) => s + j.channels.length, 0);
  const data = new Float32Array(nf * nch);
  for (let k = 0; k < nf * nch; k++) data[k] = +tok[i++];
  return { joints, nf, ft, nch, data };
}

/** World rotation + position of every joint at frame f. */
function fk(bvh, f) {
  const W = [];
  const Pp = [];
  let c = f * bvh.nch;
  bvh.joints.forEach((j, ji) => {
    let R = m3.I();
    let t = null;
    for (const ch of j.channels) {
      const v = bvh.data[c++];
      if (ch.endsWith('position')) {
        t = t ?? [0, 0, 0];
        t['XYZ'.indexOf(ch[0])] = v;
      } else R = m3.mul(R, m3.rot(ch[0], v));
    }
    if (j.parent < 0) {
      W[ji] = R;
      Pp[ji] = t ?? j.offset;
    } else {
      W[ji] = m3.mul(W[j.parent], R);
      Pp[ji] = v3.add(Pp[j.parent], m3.apply(W[j.parent], j.offset));
    }
  });
  return { W, P: Pp };
}

export function loadClip(path) {
  const bvh = parseBVH(readFileSync(path, 'utf8'));
  const idx = Object.fromEntries(bvh.joints.map((j, i) => [j.name, i]));
  const frames = [];
  for (let f = 0; f < bvh.nf; f++) frames.push(fk(bvh, f));
  const legLen = v3.len(bvh.joints[idx.LeftLeg].offset) + v3.len(bvh.joints[idx.LeftFoot].offset);
  return { bvh, idx, frames, fps: 1 / bvh.ft, legLen };
}

/** Pose features for loop matching: feet and hands relative to the hips, in the hips' heading frame. */
function feature(clip, f) {
  const { P, W } = clip.frames[f];
  const h = P[clip.idx.Hips];
  const fw = m3.apply(W[clip.idx.Hips], [0, 0, 1]);
  const yaw = Math.atan2(fw[0], fw[2]);
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  const o = [];
  for (const n of ['LeftFoot', 'RightFoot', 'LeftHand', 'RightHand', 'Head']) {
    const d = v3.sub(P[clip.idx[n]], h);
    o.push(c * d[0] + s * d[2], d[1], -s * d[0] + c * d[2]);
  }
  return o;
}

export function findLoop(clip, minS, maxS, searchFrom = 0, searchTo = Infinity) {
  const fps = clip.fps;
  const nf = clip.frames.length;
  const feats = clip.frames.map((_, f) => feature(clip, f));
  let best = { err: Infinity, s: 0, p: 0 };
  const step = 2;
  for (let s = searchFrom; s < Math.min(nf, searchTo); s += step) {
    for (let p = Math.round(minS * fps); p <= Math.round(maxS * fps) && s + p + 2 < nf; p += 1) {
      let e = 0;
      for (let k = 0; k < feats[s].length; k++) {
        const d = feats[s][k] - feats[s + p][k];
        const dv = feats[s + 2][k] - feats[s][k] - (feats[s + p + 2][k] - feats[s + p][k]);
        e += d * d + 4 * dv * dv;
      }
      if (e < best.err) best = { err: e, s, p };
    }
  }
  return best;
}

/**
 * Retarget frames [s, s + p) of a clip to a body, resampled to `fps`.
 * Returns per frame: root offset (3) + quaternion per game bone (4 x 20), and the travel speed (m/s).
 */
export function retarget(clip, s, p, body, fps, inPlace) {
  const n = Math.max(2, Math.round((p / clip.fps) * fps));
  const I = clip.idx;
  const F = clip.frames;
  // Heading: travel direction (moving clips) or the average facing (idle).
  const h0 = F[s].P[I.Hips];
  const h1 = F[s + p].P[I.Hips];
  let yaw;
  const travel = v3.sub(h1, h0);
  if (inPlace && Math.hypot(travel[0], travel[2]) > 1) yaw = Math.atan2(travel[0], travel[2]);
  else {
    let fx = 0;
    let fz = 0;
    for (let f = s; f < s + p; f++) {
      const fw = m3.apply(F[f].W[I.Hips], [0, 0, 1]);
      fx += fw[0];
      fz += fw[2];
    }
    yaw = Math.atan2(fx, fz);
  }
  const H = m3.rot('Y', (-yaw * 180) / Math.PI);
  const tgtLeg = v3.len(v3.sub(body.pivot[BI['lowerleg.L']], body.pivot[BI['upperleg.L']])) + v3.len(v3.sub(body.pivot[BI['foot.L']], body.pivot[BI['lowerleg.L']]));
  const scale = tgtLeg / clip.legLen;
  const dur = p / clip.fps;
  const speed = inPlace ? (Math.hypot(travel[0], travel[2]) * scale) / dur : 0;
  // Rest frames of the target bones (primary = bone direction, secondary = the twist axis).
  const restB = BONES.map((b) => {
    const [, from, to] = body.defs[b];
    return frame(v3.sub(to, from), AXIS[SRC[b][2]]);
  });
  // Mean hips height over the loop (the root offset is relative to it).
  let meanY = 0;
  for (let f = s; f < s + p; f++) meanY += F[f].P[I.Hips][1];
  meanY /= p;
  const meanH = (() => {
    const a = [0, 0, 0];
    for (let f = s; f < s + p; f++) for (let k = 0; k < 3; k++) a[k] += F[f].P[I.Hips][k] / p;
    return a;
  })();
  // Start the loop at the left heel strike (left foot furthest forward), so walk and run cycles line up.
  let shift = 0;
  if (inPlace) {
    let best = -Infinity;
    for (let f = s; f < s + p; f++) {
      const d = m3.apply(H, v3.sub(F[f].P[I.LeftFoot], F[f].P[I.Hips]));
      if (d[2] > best) {
        best = d[2];
        shift = f - s;
      }
    }
  }
  const outF = new Float32Array(n * (3 + BONES.length * 4));
  for (let k = 0; k < n; k++) {
    const u = (((k / n) * p + shift) % p) / p;
    const tf = s + u * p;
    const f = Math.min(F.length - 1, Math.round(tf));
    const { W, P } = F[f];
    const o = k * (3 + BONES.length * 4);
    // Root: vertical bob and residual sway (forward progression removed).
    const hp = v3.sub(P[I.Hips], meanH);
    const prog = inPlace ? v3.scale(travel, u - 0.5) : [0, 0, 0];
    const rel = m3.apply(H, v3.sub(hp, prog));
    outF[o] = rel[0] * scale;
    outF[o + 1] = (P[I.Hips][1] - meanY) * scale;
    outF[o + 2] = rel[2] * scale;
    BONES.forEach((b, bi) => {
      const [from, to, ax] = SRC[b];
      const pf = P[I[from]];
      const pt = P[I[to]];
      const prim = m3.apply(H, v3.sub(pt, pf));
      const sec = m3.apply(H, m3.apply(W[I[from]], AXIS[ax]));
      let Wt = m3.mul(frame(prim, sec), m3.T(restB[bi]));
      // Feet keep their own rest angle (heels, sneakers) and take only the source's rotation from
      // its rest pose (the BVH rest has identity joint rotations).
      if (b.startsWith('foot.')) Wt = m3.mul(m3.mul(H, W[I[from]]), m3.T(H));
      // Posture: the capture subjects stoop a little; stand taller, lift the gaze, drop the shoulders.
      const corr = POSTURE[b];
      if (corr) Wt = m3.mul(m3.mul(m3.rot('Z', corr[1]), m3.rot('X', corr[0])), Wt);
      const q = quatFromM3(Wt);
      outF.set(q, o + 3 + bi * 4);
    });
  }
  // Level the gaze: capture subjects often look down at the floor. If the head's average pitch over the
  // loop is more than 6 degrees down, lift the head (and the neck by half) by the excess.
  {
    const stride = 3 + BONES.length * 4;
    const pitchOf = (k, bi) => {
      const o = k * stride + 3 + bi * 4;
      const [x, y, z, w] = outF.slice(o, o + 4);
      // Rotate (0, 1, 0) by the quaternion.
      const uy = 1 - 2 * (x * x + z * z);
      const uz = 2 * (y * z + w * x);
      return Math.atan2(uz, uy);
    };
    let mean = 0;
    for (let k = 0; k < n; k++) mean += pitchOf(k, BI.head) / n;
    const excess = mean - (6 * Math.PI) / 180;
    if (excess > 0) {
      const fix = (bi, a) => {
        const qx = Math.sin(-a / 2), qw = Math.cos(-a / 2);
        for (let k = 0; k < n; k++) {
          const o = k * stride + 3 + bi * 4;
          const [x, y, z, w] = outF.slice(o, o + 4);
          // q' = qfix * q (rotation about world X applied after the bone's rotation).
          outF.set([qw * x + qx * w, qw * y - qx * z, qw * z + qx * y, qw * w - qx * x], o);
        }
      };
      fix(BI.head, excess);
      fix(BI.neck, excess * 0.5);
    }
  }
  return { data: outF, frames: n, speed };
}


// ------------------------------------------------------------------ designed idle
/** Rotation matrix taking unit vector a onto unit vector b (shortest arc). */
export function rotFromTo(a, b) {
  const ax = v3.cross(a, b);
  const s = v3.len(ax);
  const c = Math.max(-1, Math.min(1, v3.dot(a, b)));
  if (s < 1e-8) return m3.I();
  return rodrigues(v3.scale(ax, 1 / s), Math.atan2(s, c));
}
export function rodrigues(k, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  const [x, y, z] = k;
  return [c + x * x * t, x * y * t - z * s, x * z * t + y * s, y * x * t + z * s, c + y * y * t, y * z * t - x * s, z * x * t - y * s, z * y * t + x * s, c + z * z * t];
}

/**
 * A relaxed standing loop designed for the game (instead of a stiff capture): weight on one leg
 * (contrapposto) shifting to the other and back, chest up, shoulders down, arms hanging with soft
 * elbows, breathing, slow glances around. Feet stay planted (two-bone IK). body: { pivot, defs }.
 * The character faces +Z, its left side is +X. Returns frames like retarget().
 */
export function designedIdle(body, fps = 30, seconds = 12) {
  const n = Math.round(fps * seconds);
  const P = (b) => body.pivot[BI[b]];
  const restDir = (b) => v3.norm(v3.sub(body.defs[b][2], body.defs[b][1]));
  const stride = 3 + BONES.length * 4;
  const out = new Float32Array(n * stride);
  const D = Math.PI / 180;
  const Rx = (a) => m3.rot('X', a / D), Ry = (a) => m3.rot('Y', a / D), Rz = (a) => m3.rot('Z', a / D);
  const legLen = (s) => [v3.len(v3.sub(P(`lowerleg.${s}`), P(`upperleg.${s}`))), v3.len(v3.sub(P(`foot.${s}`), P(`lowerleg.${s}`)))];
  for (let k = 0; k < n; k++) {
    const t = k / fps;
    const ph = (2 * Math.PI * t) / seconds;
    // Weight shift: held stance, quick change (left = +1).
    const st = Math.tanh(3 * Math.sin(ph)) / Math.tanh(3);
    const breath = Math.sin((2 * Math.PI * t) / (seconds / 3));
    const sway = Math.sin((2 * Math.PI * t) / (seconds / 2) + 0.7);
    const W = {};
    // Pelvis: over the standing leg, its hip raised, slight turn.
    const rootOff = [0.028 * st + 0.004 * sway, -0.012 * Math.abs(st) - 0.004, 0.0];
    W.root = m3.mul(Ry(2.5 * D * st), Rz(3.0 * D * st));
    // Spine counter-curves so the shoulders stay nearly level; chest lifts on the in-breath.
    W.spineLow = m3.mul(W.root, Rz(-1.8 * D * st));
    W.spineMid = m3.mul(W.spineLow, m3.mul(Rz(-0.9 * D * st), Rx(-1.5 * D)));
    W.chest = m3.mul(W.spineMid, m3.mul(Rx((-2.5 - 1.2 * breath) * D), Rz(-0.6 * D * st)));
    // Head: level gaze with slow glances.
    const lookY = 9 * D * Math.sin(ph + 1.3) + 4 * D * Math.sin(3 * ph + 0.4);
    const lookP = -2 * D + 2 * D * Math.sin(2 * ph + 2.1);
    W.neck = m3.mul(Ry(lookY * 0.4), Rx(lookP * 0.5 - 4 * D));
    W.head = m3.mul(Ry(lookY), Rx(lookP));
    // Arms: hang under gravity, slightly away from the hips, soft elbows, palms facing the thighs.
    for (const [s, side] of [['L', 1], ['R', -1]]) {
      const swing = 1.2 * D * breath + 1.5 * D * st * side;
      W[`clavicle.${s}`] = m3.mul(W.chest, Rz(-side * 6 * D));
      const ua = v3.norm([side * 0.13, -1, 0.03 + Math.sin(swing) * 0.2]);
      const la = v3.norm([side * 0.07, -0.94, 0.3]);
      const wr = v3.norm([side * 0.02, -0.96, 0.27]);
      W[`upperarm.${s}`] = rotFromTo(restDir(`upperarm.${s}`), ua);
      W[`lowerarm.${s}`] = rotFromTo(restDir(`lowerarm.${s}`), la);
      W[`wrist.${s}`] = rotFromTo(restDir(`wrist.${s}`), wr);
    }
    // Legs: two-bone IK to planted feet; the free leg's knee bends and its foot turns out.
    const rootP = v3.add(P('root'), rootOff);
    for (const [s, side] of [['L', 1], ['R', -1]]) {
      const load = Math.max(0, st * side); // 1 = this leg carries the weight
      const free = 1 - load;
      const hip = v3.add(rootP, m3.apply(W.root, v3.sub(P(`upperleg.${s}`), P('root'))));
      const ankle0 = P(`foot.${s}`);
      const ankle = v3.add(ankle0, [side * 0.03 * free, 0.006 * free, 0.06 * free]);
      const [l1, l2] = legLen(s);
      const d = Math.min(v3.len(v3.sub(ankle, hip)), l1 + l2 - 1e-4);
      const dir = v3.norm(v3.sub(ankle, hip));
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      let bend = v3.sub([side * 0.15, 0, 1], v3.scale(dir, v3.dot([side * 0.15, 0, 1], dir)));
      bend = v3.norm(bend);
      const knee = v3.add(hip, v3.add(v3.scale(dir, a), v3.scale(bend, h)));
      W[`upperleg.${s}`] = rotFromTo(restDir(`upperleg.${s}`), v3.norm(v3.sub(knee, hip)));
      W[`lowerleg.${s}`] = rotFromTo(restDir(`lowerleg.${s}`), v3.norm(v3.sub(ankle, knee)));
      W[`foot.${s}`] = Ry(side * (6 + 8 * free) * D);
    }
    const o = k * stride;
    out[o] = rootOff[0];
    out[o + 1] = rootOff[1];
    out[o + 2] = rootOff[2];
    BONES.forEach((b, bi) => out.set(quatFromM3(W[b]), o + 3 + bi * 4));
  }
  return { data: out, frames: n, speed: 0 };
}
