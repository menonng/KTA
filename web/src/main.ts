import './style.css';
import * as THREE from 'three';
import init, { Game } from './wasm/kta_wasm.js';
import wasmUrl from './wasm/kta_wasm_bg.wasm?url';
import fontUrl from 'pretendard/dist/web/static/woff2-subset/Pretendard-Bold.subset.woff2?url';
import { Input } from './platform/input';
import { Environment } from './render/environment';
import { buildEntrances, buildWorld } from './render/world';
import { buildSigns, type LabelDef, type SignInst } from './render/signs';
import { Crowd, Protagonist } from './render/characters';
import { Hud } from './hud/hud';

const params = new URLSearchParams(location.search);
const BENCH = params.has('bench');
const FPS_CAP = Number(params.get('fps') ?? 60);
const SCALE = Number(params.get('scale') ?? 1);
const CROWD = Number(params.get('crowd') ?? 90);

async function boot() {
  const t0 = performance.now();
  const font = new FontFace('Pretendard', `url(${fontUrl})`, { weight: '700' });
  const [wasm, bin, labelsJson] = await Promise.all([
    init({ module_or_path: wasmUrl }),
    fetch('data/hongdae.bin').then((r) => r.arrayBuffer()),
    fetch('data/hongdae.labels.json').then((r) => r.json()),
    font.load().then((f) => document.fonts.add(f)),
  ]);
  const memory = wasm.memory as WebAssembly.Memory;
  const game = new Game(new Uint8Array(bin), 20261127, CROWD);

  // Renderer.
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * SCALE);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 1600);
  const env = new Environment(scene, renderer);

  const world = buildWorld(game, memory, scene, env.night);
  const entrances = buildEntrances(game, scene);

  // Signs: map data + subway exit signs.
  const labels: LabelDef[] = labelsJson.labels;
  const s = game.signs();
  const signs: SignInst[] = [];
  for (let i = 0; i < s.length; i += 8) {
    signs.push({ x: s[i], y: s[i + 1], z: s[i + 2], yaw: s[i + 3], w: s[i + 4], h: s[i + 5], label: s[i + 6], vertical: s[i + 7] > 0.5 });
  }
  for (const e of entrances) {
    if (!e.no) continue;
    const li = labels.push({ t: `${e.no} 출구`, fg: '#FFFFFF', bg: '#00A84D' }) - 1;
    const fx = Math.sin(e.yaw);
    const fz = Math.cos(e.yaw);
    // Above the open (front) end of the canopy, facing outwards.
    signs.push({ x: e.x - fx * 2.33, y: 3.2, z: e.z - fz * 2.33, yaw: e.yaw + Math.PI, w: 1.9, h: 0.6, label: li, vertical: false });
  }
  const signLayer = buildSigns(labels, signs, env.night);
  scene.add(signLayer.mesh);

  const player = new Protagonist();
  scene.add(player.root);
  const crowd = new Crowd(game.crowd_count());
  scene.add(crowd.group);

  const spawnAt = entrances.find((e) => e.no === 9) ?? entrances[0] ?? { x: 0, z: 0, yaw: 0 };
  game.spawn(spawnAt.x + Math.cos(spawnAt.yaw) * 4, spawnAt.z - Math.sin(spawnAt.yaw) * 4);

  const hud = new Hud(document.getElementById('hud')!, labelsJson.attribution);
  hud.setMinimap({ buildings: game.minimap_buildings(), roads: game.minimap_roads(), entrances });

  const input = new Input(canvas);
  input.yaw = spawnAt.yaw + Math.PI * 0.5;
  input.enabled = !BENCH;

  let hours = Number(params.get('time') ?? 18.6);
  let dayIndex = 2;
  let debugOn = params.has('debug') || BENCH;
  hud.debug.classList.toggle('on', debugOn);
  input.onKey = (code) => {
    if (code === 'KeyN') hours = hours > 6 && hours < 18 ? 21.0 : 13.0;
    if (code === 'F3') {
      debugOn = !debugOn;
      hud.debug.classList.toggle('on', debugOn);
    }
  };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const playerView = () => new Float32Array(memory.buffer, game.player_ptr(), 6);
  const crowdView = () => new Float32Array(memory.buffer, game.crowd_ptr(), game.crowd_count() * 4);
  let pv = playerView();
  let cv = crowdView();

  const camTarget = new THREE.Vector3();
  const frameTimes: number[] = [];
  let benchStart = 0;
  let last = performance.now();
  let lastHud = 0;
  let fpsAcc = 0;
  let fpsN = 0;
  let fps = 0;
  const loadMs = performance.now() - t0;
  document.getElementById('loading')?.classList.add('hidden');

  const api = {
    setTime: (h: number) => (hours = h),
    teleport: (x: number, z: number) => game.spawn(x, z),
    setView: (yaw: number, pitch: number, dist: number) => Object.assign(input, { yaw, pitch, dist }),
    stats: () => collectStats(),
    findSign: (text: string) => {
      const sg = signs.find((g) => labels[g.label].t === text);
      return sg ? { x: sg.x, z: sg.z, yaw: sg.yaw, vertical: sg.vertical } : null;
    },
    bench: null as unknown,
  };
  (window as unknown as { __kta: typeof api }).__kta = api;

  function collectStats() {
    const info = renderer.info;
    const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      loadMs: Math.round(loadMs),
      fps: Math.round(fps),
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      wasmMB: +(memory.buffer.byteLength / 1048576).toFixed(1),
      jsHeapMB: perfMem ? +(perfMem.usedJSHeapSize / 1048576).toFixed(1) : null,
      meshGpuMB: +(world.gpuBytes / 1048576).toFixed(2),
      signAtlasMB: +(signLayer.atlasBytes / 1048576).toFixed(2),
      buildings: world.buildings,
      chunks: world.chunks,
      signs: signs.length,
      crowd: crowd.count,
      pixelRatio: renderer.getPixelRatio(),
    };
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    const elapsed = now - last;
    if (elapsed < 1000 / FPS_CAP - 1) return;
    const dt = Math.min(elapsed / 1000, 0.1);
    last = now;
    fpsAcc += elapsed;
    fpsN++;
    if (fpsAcc > 500) {
      fps = (fpsN * 1000) / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }

    if (BENCH) {
      input.yaw += dt * 0.35;
      input.pitch = 0.55;
      input.dist = 38;
    }
    input.update();
    const [fx, fz] = input.forward();
    game.step(dt, input.bits, fx, fz);
    if (pv.buffer !== memory.buffer) {
      pv = playerView();
      cv = crowdView();
    }
    const px = pv[0];
    const pz = pv[2];
    player.root.position.set(px, 0, pz);
    player.root.rotation.y = pv[3];
    player.animate(pv[5], pv[4], now / 1000);
    crowd.update(cv);

    hours = (hours + dt / 60) % 24; // 1 real second = 1 game minute
    env.setTime(hours);
    env.follow(px, pz);

    camTarget.set(px, 1.55, pz);
    const cp = Math.cos(input.pitch);
    camera.position.set(
      px + Math.sin(input.yaw) * cp * input.dist,
      1.55 + Math.sin(input.pitch) * input.dist,
      pz + Math.cos(input.yaw) * cp * input.dist,
    );
    camera.lookAt(camTarget);

    renderer.render(scene, camera);

    if (now - lastHud > 100) {
      lastHud = now;
      hud.update(hours, dayIndex, 52000, px, pz, pv[3], input.yaw);
      if (debugOn) {
        const st = collectStats();
        hud.debug.textContent = Object.entries(st)
          .map(([k, v]) => `${k.padEnd(11)} ${v}`)
          .join('\n');
      }
    }

    if (BENCH) {
      if (!benchStart) benchStart = now + 2000;
      if (now > benchStart) frameTimes.push(elapsed);
      if (now > benchStart + 10000 && !api.bench) {
        const sorted = [...frameTimes].sort((a, b) => a - b);
        const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        api.bench = { avgMs: +avg.toFixed(2), p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2), frames: frameTimes.length, ...collectStats() };
        console.log('BENCH ' + JSON.stringify(api.bench));
      }
    }
  }
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });
  void dayIndex;
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('loading');
  if (el) el.textContent = `불러오기 실패: ${e?.message ?? e}`;
});
