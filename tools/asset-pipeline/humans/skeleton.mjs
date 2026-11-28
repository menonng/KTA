// The 20-bone game skeleton: MakeHuman's 163-bone default rig collapsed
// (fingers, face, toes and twist bones merge into their parents), the rest
// pivots and directions per bone, and the CMU joints that drive each bone.

export const BONES = ['root', 'spineLow', 'spineMid', 'chest', 'neck', 'head', 'clavicle.L', 'upperarm.L', 'lowerarm.L', 'wrist.L', 'clavicle.R', 'upperarm.R', 'lowerarm.R', 'wrist.R', 'upperleg.L', 'lowerleg.L', 'foot.L', 'upperleg.R', 'lowerleg.R', 'foot.R'];
export const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
export const PARENT = { root: null, spineLow: 'root', spineMid: 'spineLow', chest: 'spineMid', neck: 'chest', head: 'neck' };
for (const s of ['L', 'R']) {
  Object.assign(PARENT, { [`clavicle.${s}`]: 'chest', [`upperarm.${s}`]: `clavicle.${s}`, [`lowerarm.${s}`]: `upperarm.${s}`, [`wrist.${s}`]: `lowerarm.${s}`, [`upperleg.${s}`]: 'root', [`lowerleg.${s}`]: `upperleg.${s}`, [`foot.${s}`]: `lowerleg.${s}` });
}
/** MakeHuman bone -> game bone (others take their nearest mapped ancestor). */
export const MH2G = { root: 'root', 'pelvis.L': 'root', 'pelvis.R': 'root', spine05: 'spineLow', spine04: 'spineLow', spine03: 'spineMid', spine02: 'spineMid', spine01: 'chest', neck01: 'neck', neck02: 'neck', neck03: 'neck', head: 'head' };
for (const s of ['L', 'R']) {
  Object.assign(MH2G, {
    [`clavicle.${s}`]: `clavicle.${s}`, [`shoulder01.${s}`]: `clavicle.${s}`,
    [`upperarm01.${s}`]: `upperarm.${s}`, [`upperarm02.${s}`]: `upperarm.${s}`,
    [`lowerarm01.${s}`]: `lowerarm.${s}`, [`lowerarm02.${s}`]: `lowerarm.${s}`,
    [`wrist.${s}`]: `wrist.${s}`,
    [`upperleg01.${s}`]: `upperleg.${s}`, [`upperleg02.${s}`]: `upperleg.${s}`,
    [`lowerleg01.${s}`]: `lowerleg.${s}`, [`lowerleg02.${s}`]: `lowerleg.${s}`,
    [`foot.${s}`]: `foot.${s}`,
  });
}
export function gameBoneOf(skel, mhBone) {
  let b = mhBone;
  while (b && !MH2G[b]) b = skel.bones[b]?.parent;
  return MH2G[b] ?? 'root';
}
/** Rest pivot (MakeHuman joint) and primary direction (from, to joints) per game bone. */
export function boneDefs(skel, J) {
  const H = (b) => J(skel.bones[b].head);
  const Tl = (b) => J(skel.bones[b].tail);
  const d = {
    root: [H('spine05'), H('spine05'), H('spine03')],
    spineLow: [H('spine05'), H('spine05'), H('spine03')],
    spineMid: [H('spine03'), H('spine03'), H('spine01')],
    chest: [H('spine01'), H('spine01'), H('neck01')],
    neck: [H('neck01'), H('neck01'), H('head')],
    head: [H('head'), H('head'), Tl('head')],
  };
  for (const s of ['L', 'R']) {
    d[`clavicle.${s}`] = [H(`clavicle.${s}`), H(`clavicle.${s}`), H(`upperarm01.${s}`)];
    d[`upperarm.${s}`] = [H(`upperarm01.${s}`), H(`upperarm01.${s}`), H(`lowerarm01.${s}`)];
    d[`lowerarm.${s}`] = [H(`lowerarm01.${s}`), H(`lowerarm01.${s}`), H(`wrist.${s}`)];
    d[`wrist.${s}`] = [H(`wrist.${s}`), H(`wrist.${s}`), H(`finger3-1.${s}`)];
    d[`upperleg.${s}`] = [H(`upperleg01.${s}`), H(`upperleg01.${s}`), H(`lowerleg01.${s}`)];
    d[`lowerleg.${s}`] = [H(`lowerleg01.${s}`), H(`lowerleg01.${s}`), H(`foot.${s}`)];
    d[`foot.${s}`] = [H(`foot.${s}`), H(`foot.${s}`), Tl(`foot.${s}`)];
  }
  return d;
}
/** Source (CMU) joints for each game bone: direction from -> to, twist axis of `from`'s frame. */
export const SRC = { root: ['Hips', 'Spine1', 'X', 'Hips'], spineLow: ['LowerBack', 'Spine', 'X'], spineMid: ['Spine', 'Spine1', 'X'], chest: ['Spine1', 'Neck', 'X'], neck: ['Neck', 'Head', 'X'], head: ['Head', 'Head_end', 'X'] };
for (const [s, S] of [['L', 'Left'], ['R', 'Right']]) {
  Object.assign(SRC, {
    [`clavicle.${s}`]: [`${S}Shoulder`, `${S}Arm`, 'Z'],
    [`upperarm.${s}`]: [`${S}Arm`, `${S}ForeArm`, 'Z'],
    [`lowerarm.${s}`]: [`${S}ForeArm`, `${S}Hand`, 'Z'],
    [`wrist.${s}`]: [`${S}Hand`, `${S}HandIndex1`, 'Z'],
    [`upperleg.${s}`]: [`${S}UpLeg`, `${S}Leg`, 'X'],
    [`lowerleg.${s}`]: [`${S}Leg`, `${S}Foot`, 'X'],
    [`foot.${s}`]: [`${S}Foot`, `${S}ToeBase`, 'X'],
  });
}
export const AXIS = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

