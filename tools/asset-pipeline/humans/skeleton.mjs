// The 20-bone game skeleton (source rigs collapse into it: fingers, face,
// toes and twist bones merge into their parents) and the CMU joints that
// drive each bone. Rest pivots and directions come from each avatar.

export const BONES = ['root', 'spineLow', 'spineMid', 'chest', 'neck', 'head', 'clavicle.L', 'upperarm.L', 'lowerarm.L', 'wrist.L', 'clavicle.R', 'upperarm.R', 'lowerarm.R', 'wrist.R', 'upperleg.L', 'lowerleg.L', 'foot.L', 'upperleg.R', 'lowerleg.R', 'foot.R'];
export const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
export const PARENT = { root: null, spineLow: 'root', spineMid: 'spineLow', chest: 'spineMid', neck: 'chest', head: 'neck' };
for (const s of ['L', 'R']) {
  Object.assign(PARENT, { [`clavicle.${s}`]: 'chest', [`upperarm.${s}`]: `clavicle.${s}`, [`lowerarm.${s}`]: `upperarm.${s}`, [`wrist.${s}`]: `lowerarm.${s}`, [`upperleg.${s}`]: 'root', [`lowerleg.${s}`]: `upperleg.${s}`, [`foot.${s}`]: `lowerleg.${s}` });
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

