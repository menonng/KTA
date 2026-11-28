// Dev-only vehicle viewer (not part of the game bundle): every vehicle type
// from three angles on a plain ground, lit by a room environment.
// Open /carview.html on the Vite dev server; ?night for lamps on.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { carParts, CAR_TYPES } from './render/cars';

const night = { value: location.search.includes('night') ? 1 : 0 };
const W = 1440, H = 900;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setScissorTest(true);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9aa4ae);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;
const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
sun.position.set(6, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.9 }));
ground.receiveShadow = true;
scene.add(ground);
const colors = [0x1f3556, 0xe9e9e6, 0x6a1e22, 0xe8913a, 0x2a5fb8, 0x3aa34a];
const parts = carParts(night);
const groups = CAR_TYPES.map((t, i) => {
  const g = new THREE.Group();
  for (const p of parts.get(t)![location.search.includes('far') ? 'far' : 'near']) {
    const m = new THREE.Mesh(p.geo, p.tint ? (p.mat as THREE.MeshPhysicalMaterial).clone() : p.mat);
    if (p.tint) (m.material as THREE.MeshPhysicalMaterial).color.setHex(colors[i]);
    m.castShadow = p.shadow;
    g.add(m);
  }
  g.visible = false;
  scene.add(g);
  return g;
});
const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const views = [
  [0.75, 0.18],
  [Math.PI / 2, 0.05],
  [Math.PI - 0.7, 0.22],
];
const only = new URLSearchParams(location.search).get('only')?.split(',').map(Number) ?? CAR_TYPES.map((_, i) => i);
const cw = W / 3, ch = H / only.length;
cam.aspect = cw / ch;
cam.updateProjectionMatrix();
only.forEach((ti, i) => {
  const t = CAR_TYPES[ti];
  groups.forEach((g, j) => (g.visible = j === ti));
  const big = t === 'bus' ? 2.3 : t === 'truck' ? 1.25 : 1;
  views.forEach(([yaw, pitch], v) => {
    const d = (only.length > 3 ? 7.2 : only.length > 1 ? 5.2 : 6.5) * big;
    cam.position.set(Math.sin(yaw) * d * Math.cos(pitch), 0.9 + Math.sin(pitch) * d, Math.cos(yaw) * d * Math.cos(pitch));
    cam.lookAt(0, 0.75 * big, 0);
    const y = H - (i + 1) * ch;
    renderer.setViewport(v * cw, y, cw, ch);
    renderer.setScissor(v * cw, y, cw, ch);
    renderer.render(scene, cam);
  });
});
(window as unknown as { ready: boolean }).ready = true;
