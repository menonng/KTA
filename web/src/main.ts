import './style.css';
import * as THREE from 'three';
import init, { Game } from './wasm/kta_wasm.js';
import wasmUrl from './wasm/kta_wasm_bg.wasm?url';
import fontUrl from 'pretendard/dist/web/static/woff2-subset/Pretendard-Bold.subset.woff2?url';
import { Input } from './platform/input';
import { Environment } from './render/environment';
import { buildEntrances, buildWorld } from './render/world';
import { buildSigns, loadSignTexture, type SignAtlas, type SignInst } from './render/signs';
import { Crowd, Protagonist } from './render/characters';
import { Hud } from './hud/hud';
import { Post } from './render/post';
import { loadTextures } from './render/textures';
import { PropStreamer, buildStreetDetails } from './render/props';
import { ModelLayer, MODEL, storefrontFurniture, type ModelInst } from './render/models';
import { Precipitation } from './render/weather';
import { WEATHERS, type Weather } from './render/environment';

const params = new URLSearchParams(location.search);
const BENCH = params.has('bench');
const FPS_CAP = Number(params.get('fps') ?? 60);
const SCALE = Number(params.get('scale') ?? 1);
const CROWD = Number(params.get('crowd') ?? 90);

async function boot() {
  const t0 = performance.now();
  const font = new FontFace('Pretendard', `url(${fontUrl})`, { weight: '700' });
  const [wasm, bin, atlas] = await Promise.all([
    init({ module_or_path: wasmUrl }),
    fetch('data/hongdae.bin').then((r) => r.arrayBuffer()),
    fetch('data/hongdae.signs.json').then((r) => r.json() as Promise<SignAtlas>),
    font.load().then((f) => document.fonts.add(f)),
  ]);
  const memory = wasm.memory as WebAssembly.Memory;
  const game = new Game(new Uint8Array(bin), 20261127, CROWD);

  // Renderer.
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * SCALE);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.NoToneMapping; // tone mapping + grading happen in Post
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.info.autoReset = false; // several passes per frame; reset manually
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 1600);
  const env = new Environment(scene, renderer);

  const tex = await loadTextures(renderer);
  const world = buildWorld(game, memory, scene, env.night, tex, { uTop: env.uniforms.uTop, uHorizon: env.uniforms.uHorizon });
  const entrances = buildEntrances(game, scene);

  // Signs (shop signs, directories, banners, exit signs) from the map data.
  // The artwork streams in after the first frames (about 15 MB of KTX2).
  const s = game.signs();
  const signs: SignInst[] = [];
  for (let i = 0; i < s.length; i += 8) {
    const fl = Math.round(s[i + 7]);
    signs.push({ x: s[i], y: s[i + 1], z: s[i + 2], yaw: s[i + 3], w: s[i + 4], h: s[i + 5], label: s[i + 6], vertical: (fl & 1) !== 0, mount: fl >> 1 });
  }
  const signLayer = buildSigns(atlas, signs, env.night);
  scene.add(signLayer.group);
  let signTexBytes = 0;
  const signsReady = loadSignTexture(renderer, atlas.pages).then(({ tex, bytes }) => {
    signLayer.setTexture(tex);
    signTexBytes = bytes;
  });
  const street = buildStreetDetails(game, scene, env.night);
  const props = new PropStreamer(game, memory, scene, env.night);
  // CC0 models (Poly Haven): streamed with the prop cells, plus static sets.
  const models = new ModelLayer(renderer);
  scene.add(models.group);
  props.models = models;
  const shutters: ModelInst[] = signs
    .filter((g) => g.mount === 6)
    .map((g) => ({ m: MODEL.shutter, x: g.x, y: 0.1, z: g.z, yaw: g.yaw, sx: g.w / 1.08, sy: g.h / 2.4, sz: 1 }));
  const cvs = signs
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.mount === 0 && !g.vertical && g.y < 5 && /^(GG24|CUZ|SIX-TEN)/.test(atlas.signs[g.label]?.t ?? ''))
    .map(({ g, i }) => ({ x: g.x, z: g.z, yaw: g.yaw, w: g.w, seed: i * 2654435761 }));
  const modelsReady = models.load().then(() => {
    models.set('shutters', shutters);
    models.set('storefront', storefrontFurniture(cvs));
    models.flush();
  });
  const post = new Post(renderer);
  const precip = new Precipitation();
  scene.add(precip.group);
  const setWeather = (w: Weather) => {
    env.setWeather(w);
    precip.set(w);
  };
  setWeather((params.get('weather') as Weather) || 'clear');

  const player = new Protagonist();
  scene.add(player.root);
  // Cinematic fill light around the player at night (one dynamic light, plan 4.8).
  const fill = new THREE.PointLight(0xffd9a8, 0, 14, 1.6);
  scene.add(fill);
  const crowd = new Crowd(game.crowd_count());
  scene.add(crowd.group);

  const spawnAt = entrances.find((e) => e.no === 9) ?? entrances[0] ?? { x: 0, z: 0, yaw: 0 };
  game.spawn(spawnAt.x + Math.cos(spawnAt.yaw) * 4, spawnAt.z - Math.sin(spawnAt.yaw) * 4);

  const hud = new Hud(document.getElementById('hud')!, atlas.attribution);
  hud.setMinimap({ buildings: game.minimap_buildings(), roads: game.minimap_roads(), entrances });

  const input = new Input(canvas);
  input.yaw = spawnAt.yaw + Math.PI * 0.5;
  input.pitch = 0.16;
  input.dist = 5.2;
  {
    const sp = new Float32Array(memory.buffer, game.player_ptr(), 6);
    props.update(sp[0], sp[2], 0, true);
  }
  input.enabled = !BENCH;
  // Compile both light setups (fill light on/off) before the first frame so
  // dusk and dawn never hitch on shader compilation.
  fill.visible = true;
  post.compile(scene, camera);
  fill.visible = false;
  post.compile(scene, camera);

  let hours = Number(params.get('time') ?? 18.6);
  let dayIndex = 2;
  let debugOn = params.has('debug') || BENCH;
  hud.debug.classList.toggle('on', debugOn);
  input.onKey = (code) => {
    if (code === 'KeyN') hours = hours > 6 && hours < 18 ? 21.0 : 13.0;
    if (code === 'KeyB') setWeather(WEATHERS[(WEATHERS.indexOf(env.weather) + 1) % WEATHERS.length]);
    if (code === 'F3') {
      debugOn = !debugOn;
      hud.debug.classList.toggle('on', debugOn);
    }
  };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    const ds = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.setSize(ds.x, ds.y);
  });

  const playerView = () => new Float32Array(memory.buffer, game.player_ptr(), 6);
  const crowdView = () => new Float32Array(memory.buffer, game.crowd_ptr(), game.crowd_count() * 4);
  let pv = playerView();
  let cv = crowdView();

  const camTarget = new THREE.Vector3();
  let camDist = 5.2;
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
    setWeather: (w: Weather) => setWeather(w),
    teleport: (x: number, z: number) => {
      game.spawn(x, z);
      props.update(x, z, 0, true);
    },
    setView: (yaw: number, pitch: number, dist: number) => Object.assign(input, { yaw, pitch, dist }),
    stats: () => collectStats(),
    debugBuffers: () => {
      const seen = new Set<unknown>();
      const rows: [string, number][] = [];
      scene.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (g && !seen.has(g)) {
          seen.add(g);
          let b = 0;
          for (const a of Object.values(g.attributes)) b += ((a as THREE.BufferAttribute).array?.byteLength ?? 0);
          if (g.index) b += g.index.array?.byteLength ?? 0;
          const im = (o as THREE.InstancedMesh).instanceMatrix;
          if (im) b += im.array.byteLength + ((o as THREE.InstancedMesh).instanceColor?.array.byteLength ?? 0);
          rows.push([`geo ${o.type} ${o.name}`, b]);
        }
        const mats = ([] as THREE.Material[]).concat(((o as THREE.Mesh).material as THREE.Material) ?? []);
        for (const m of mats) {
          for (const v of Object.values(m)) {
            const t = v as THREE.Texture;
            if (t && t.isTexture && !seen.has(t)) {
              seen.add(t);
              const mm = (t.mipmaps ?? []) as { data?: ArrayBufferView }[];
              rows.push([`tex ${t.constructor.name}`, mm.reduce((s2, x) => s2 + (x.data?.byteLength ?? 0), 0) + (((t.image as { data?: ArrayBufferView })?.data?.byteLength) ?? 0)]);
            }
          }
        }
      });
      const agg = new Map<string, number>();
      for (const [k, v] of rows) agg.set(k, (agg.get(k) ?? 0) + v);
      for (const [k, t] of Object.entries(tex)) {
        if (!(t as THREE.Texture).isTexture) continue;
        const mm = ((t as THREE.Texture).mipmaps ?? []) as { data?: ArrayBufferView }[];
        agg.set(`texset ${k} (${mm.length} mips, v${(t as THREE.Texture).version})`, mm.reduce((s2, x) => s2 + (x.data?.byteLength ?? 0), 0));
      }
      return [...agg].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${(v / 1048576).toFixed(2)} ${k}`);
    },
    findSign: (text: string) => {
      const hit = (g: SignInst) => atlas.signs[g.label]?.t.includes(text);
      const sg = signs.find((g) => hit(g) && !g.vertical) ?? signs.find(hit);
      return sg ? { x: sg.x, z: sg.z, yaw: sg.yaw, vertical: sg.vertical } : null;
    },
    bench: null as unknown,
    signsReady: Promise.all([signsReady, modelsReady]),
    modelSpots: (m: number) => models.list(m).map((it) => ({ x: it.x, z: it.z, yaw: it.yaw })),
    signList: () => signs.map((g) => ({ x: g.x, z: g.z, yaw: g.yaw, v: g.vertical, st: atlas.signs[g.label]?.st })),
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
      signAtlasMB: +(signTexBytes / 1048576).toFixed(2),
      buildings: world.buildings,
      chunks: world.chunks,
      signs: signLayer.count,
      propPrims: game.prop_count(),
      propCells: props.cellCount,
      propMB: +(props.bytes / 1048576).toFixed(2),
      modelInstances: models.instances,
      modelTexMB: +(models.texBytes / 1048576).toFixed(2),
      wires: street.wireSegments,
      crosswalks: street.crosswalks,
      lamps: street.lamps,
      postMB: +(post.bytes / 1048576).toFixed(1),
      texMB: +(tex.bytes / 1048576).toFixed(1),
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

    renderer.info.reset();
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
    fill.position.set(px + Math.sin(input.yaw) * 2.0, 3.2, pz + Math.cos(input.yaw) * 2.0);
    fill.intensity = env.night.value * 5;
    // A zero-intensity light still costs every lit pixel: drop it in daylight.
    fill.visible = env.night.value > 0.01;
    if (world.spill) world.spill.visible = fill.visible;

    props.update(px, pz, dt);
    models.update(px, pz);
    camTarget.set(px, 1.45, pz);
    // Third-person camera with wall collision: pull in at once when a wall
    // is in the way, ease back out (no camera inside buildings in alleys).
    const cp = Math.cos(input.pitch);
    const ox = Math.sin(input.yaw) * cp;
    const oy = Math.sin(input.pitch);
    const oz = Math.cos(input.yaw) * cp;
    const want = input.dist;
    const clear = game.camera_clear(px, 1.45, pz, px + ox * (want + 0.5), 1.6 + oy * (want + 0.5), pz + oz * (want + 0.5));
    const allowed = Math.max(0.6, clear * (want + 0.5) - 0.5);
    camDist = allowed < camDist ? allowed : camDist + (allowed - camDist) * Math.min(1, dt * 2.5);
    camera.position.set(px + ox * camDist, 1.6 + oy * camDist, pz + oz * camDist);
    camera.lookAt(camTarget);

    post.atmo.lut = env.lut.texture;
    post.atmo.density = env.fog.density;
    post.atmo.falloff = env.fog.falloff;
    post.atmo.wet = env.surface.uWet.value;
    precip.update(dt, camera.position, env.night.value);
    post.render(scene, camera, env.grade);

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
