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
      // Posture: the capture subjects stoop a little; stand taller, lift the gaze, drop the shoulders.
      const corr = POSTURE[b];
      if (corr) Wt = m3.mul(m3.mul(m3.rot('Z', corr[1]), m3.rot('X', corr[0])), Wt);
      const q = quatFromM3(Wt);
      outF.set(q, o + 3 + bi * 4);
    });
  }
  // Make the loop seamless: blend the root offset's start/end mismatch away.
  return { data: outF, frames: n, speed };
}

