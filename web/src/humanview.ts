// Dev-only people viewer (not part of the game bundle): each body variant
// with walk / run / idle poses, front and side. ?t=0.25 picks the cycle
// position, ?lod=1 the detail level, ?rest the bind pose, ?plain no body texture,
// ?noao no baked occlusion (for checking geometry).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadHumans, HumanLayer, crowdPalette, HERO_PALETTE, type Clip, type Variant } from './render/humans';

const qs = new URLSearchParams(location.search);
const W = 1440, H = 900;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9aa4ae);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;
const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 6, bottom: -2 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a5d61, roughness: 0.9 }));
ground.receiveShadow = true;
scene.add(ground);
const kinds = await loadHumans(renderer);
if (qs.has('rest')) {
  for (const k of Object.values(kinds)) {
    const d = k.anim.image.data as Float32Array;
    for (let i = 0; i < d.length; i += 12) d.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], i);
    k.anim.needsUpdate = true;
  }
}
if (qs.has('noao')) {
  for (const k of Object.values(kinds)) for (const g of k.lods) {
    const a = g.getAttribute('aInfo') as THREE.BufferAttribute;
    const arr = (a.array as Uint8Array).slice();
    for (let i = 1; i < arr.length; i += 4) arr[i] = 255;
    g.setAttribute('aInfo', new THREE.BufferAttribute(arr, 4, true));
  }
}
if (qs.has('plain')) {
  const white = new THREE.DataTexture(new Uint8Array([200, 200, 200, 140]), 1, 1);
  white.needsUpdate = true;
  for (const k of Object.values(kinds)) Object.assign(k, { body: white });
}
const t = Number(qs.get('t') ?? 0.15);
const lod = Number(qs.get('lod') ?? 0);
const yawView = Number(qs.get('yaw') ?? 0.5);
const variants: Variant[] = ['hero', 'man', 'woman'];
const clips: Clip[] = ['idle', 'walk', 'run'];
variants.forEach((v, vi) => {
  const layer = new HumanLayer(kinds[v], 8);
  layer.meshes.forEach((m) => scene.add(m));
  layer.begin();
  clips.forEach((c, ci) => {
    const [a, b, bl] = layer.rows(c, t);
    layer.add(lod, (ci - 1) * 1.1 + (vi - 1) * 3.6, 0, 0, yawView, a, b, bl, v === 'hero' ? HERO_PALETTE : crowdPalette(vi * 7 + ci));
  });
  layer.end();
});
const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
const cx = Number(qs.get('cx') ?? 0);
cam.position.set(cx, Number(qs.get('cy') ?? 1.4), Number(qs.get('d') ?? 12));
cam.lookAt(cx, Number(qs.get('ly') ?? 0.95), 0);
renderer.render(scene, cam);
(window as unknown as { ready: boolean }).ready = true;
