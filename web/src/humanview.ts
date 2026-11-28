// Dev-only people viewer (not part of the game bundle): every variant in a
// row (idle / walk pose). ?t=0.25 cycle position, ?clip=walk, ?lod=1,
// ?only=hero,m_suit1 subset, ?d=6 camera distance, ?ly=1.0 look height, ?yaw=0.5.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadHumans, HumanLayer, type Clip } from './render/humans';

const qs = new URLSearchParams(location.search);
const W = 1440, H = 900;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8d969f);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xfff0dc, 2.0);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 6, bottom: -2 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.9 }));
ground.receiveShadow = true;
scene.add(ground);
const kinds = await loadHumans(renderer);
const all = [kinds.hero, ...kinds.crowd];
const only = qs.get('only')?.split(',');
const list = only ? all.filter((k) => only.includes(k.variant)) : all;
const t = Number(qs.get('t') ?? 0.15);
const lod = Number(qs.get('lod') ?? 0);
const clip = (qs.get('clip') ?? 'idle') as Clip;
const lookYaw = Number(qs.get('look') ?? 0);
const yawView = Number(qs.get('yaw') ?? 0.3);
const gap = Number(qs.get('gap') ?? 0.95);
list.forEach((k, i) => {
  const layer = new HumanLayer(k, 2);
  layer.meshes.forEach((m) => scene.add(m));
  layer.begin();
  const [a, b, bl] = layer.rows(clip, t);
  layer.add(lod, (i - (list.length - 1) / 2) * gap, 0, 0, yawView, a, b, bl, 1, 1, lookYaw, 0);
  layer.end();
});
const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
cam.position.set(Number(qs.get('cx') ?? 0), Number(qs.get('cy') ?? 1.4), Number(qs.get('d') ?? 9));
cam.lookAt(Number(qs.get('cx') ?? 0), Number(qs.get('ly') ?? 0.95), 0);
renderer.render(scene, cam);
(window as unknown as { ready: boolean }).ready = true;
