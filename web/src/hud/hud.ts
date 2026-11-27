// DOM HUD: clock, money, place name, rotating minimap (vector, no bitmap
// cache), controls hint, attribution and a debug overlay.

const DAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

export interface MinimapData {
  buildings: Float32Array;
  roads: Float32Array;
  entrances: { x: number; z: number; no: number }[];
}

export class Hud {
  private clock: HTMLElement;
  private day: HTMLElement;
  private money: HTMLElement;
  private place: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly debug: HTMLElement;
  // Building outlines bucketed into 64 m tiles: only tiles inside the 110 m
  // view circle are filled each redraw (about a tenth of the map).
  private bTiles = new Map<string, Path2D>();
  private last = { px: NaN, pz: NaN, pyaw: NaN, camYaw: NaN };
  private text = { clock: '', day: '', money: '', place: '' };
  private roadPaths: { path: Path2D; width: number; color: string }[] = [];
  private entrances: { x: number; z: number; no: number }[] = [];

  constructor(root: HTMLElement, attribution: string) {
    root.innerHTML = `
      <div class="hud-tr"><div class="hud-clock"></div><div class="hud-day"></div><div class="hud-money"></div></div>
      <div class="hud-bl"><div class="hud-place"></div><canvas id="minimap" width="190" height="190"></canvas></div>
      <div class="hud-hint">WASD 이동 · Shift 달리기 · 드래그 시점 · 휠 줌 · N 낮/밤 · F3 정보</div>
      <div class="hud-credit"></div>
      <div class="hud-debug"></div>`;
    this.clock = root.querySelector('.hud-clock')!;
    this.day = root.querySelector('.hud-day')!;
    this.money = root.querySelector('.hud-money')!;
    this.place = root.querySelector('.hud-place')!;
    this.debug = root.querySelector('.hud-debug')!;
    (root.querySelector('.hud-credit') as HTMLElement).textContent = `지도 데이터 ${attribution}`;
    this.canvas = root.querySelector('#minimap')!;
    this.ctx = this.canvas.getContext('2d')!;
  }

  setMinimap(d: MinimapData) {
    const b = d.buildings;
    for (let i = 0; i < b.length; ) {
      const n = b[i++];
      const key = `${Math.floor(b[i] / 64)},${Math.floor(b[i + 1] / 64)}`;
      let path = this.bTiles.get(key);
      if (!path) this.bTiles.set(key, (path = new Path2D()));
      for (let k = 0; k < n; k++) {
        const x = b[i++];
        const z = b[i++];
        if (k === 0) path.moveTo(x, z);
        else path.lineTo(x, z);
      }
      path.closePath();
    }
    const groups = new Map<string, { path: Path2D; width: number; color: string }>();
    const r = d.roads;
    for (let i = 0; i < r.length; ) {
      const n = r[i++];
      const kind = r[i++];
      const width = r[i++];
      const color = kind === 6 ? '#8a6a5e' : kind === 7 ? '#5a636b' : kind <= 3 || kind === 8 ? '#9aa3ab' : '#717b84';
      const key = `${color}:${Math.round(width)}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { path: new Path2D(), width: Math.max(width, 2), color }));
      for (let k = 0; k < n; k++) {
        const x = r[i++];
        const z = r[i++];
        if (k === 0) g.path.moveTo(x, z);
        else g.path.lineTo(x, z);
      }
    }
    this.roadPaths = [...groups.values()].sort((a, b) => a.width - b.width);
    this.entrances = d.entrances;
  }

  update(hours: number, dayIndex: number, money: number, px: number, pz: number, pyaw: number, camYaw: number) {
    const h = Math.floor(hours) % 24;
    const m = Math.floor((hours % 1) * 60);
    // Touch the DOM only when a string changes (avoids per-frame style/layout).
    this.setText('clock', this.clock, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    this.setText('day', this.day, DAYS[dayIndex % 7]);
    this.setText('money', this.money, `₩ ${money.toLocaleString('ko-KR')}`);
    let best = { d: Infinity, no: 0 };
    for (const e of this.entrances) {
      const d = Math.hypot(e.x - px, e.z - pz);
      if (d < best.d) best = { d, no: e.no };
    }
    this.setText('place', this.place, best.d < 90 && best.no > 0 ? `홍대입구역 ${best.no}번 출구 부근` : '홍대입구 일대');
    // Redraw the minimap only when the view actually changed.
    const l = this.last;
    if (Math.abs(px - l.px) > 0.03 || Math.abs(pz - l.pz) > 0.03 || Math.abs(pyaw - l.pyaw) > 0.003 || Math.abs(camYaw - l.camYaw) > 0.002 || Number.isNaN(l.px)) {
      Object.assign(l, { px, pz, pyaw, camYaw });
      this.drawMinimap(px, pz, pyaw, camYaw);
    }
  }

  private setText(k: keyof Hud['text'], el: HTMLElement, v: string) {
    if (this.text[k] !== v) {
      this.text[k] = v;
      el.textContent = v;
    }
  }

  private drawMinimap(px: number, pz: number, pyaw: number, camYaw: number) {
    const c = this.ctx;
    const W = this.canvas.width;
    const scale = W / 2 / 110; // 110 m radius
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const rot = -Math.PI / 2 - Math.atan2(fz, fx);
    c.save();
    c.fillStyle = '#1b2026';
    c.fillRect(0, 0, W, W);
    c.translate(W / 2, W / 2);
    c.rotate(rot);
    c.scale(scale, scale);
    c.translate(-px, -pz);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const g of this.roadPaths) {
      c.strokeStyle = g.color;
      c.lineWidth = g.width;
      c.stroke(g.path);
    }
    c.fillStyle = '#39424b';
    const tx = Math.floor(px / 64);
    const tz = Math.floor(pz / 64);
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const p = this.bTiles.get(`${tx + dx},${tz + dz}`);
        if (p) c.fill(p);
      }
    }
    for (const e of this.entrances) {
      c.beginPath();
      c.arc(e.x, e.z, 5, 0, Math.PI * 2);
      c.fillStyle = '#39c5bb';
      c.fill();
    }
    c.restore();
    // Player arrow.
    const a = Math.atan2(Math.cos(pyaw), Math.sin(pyaw)) + rot;
    c.save();
    c.translate(W / 2, W / 2);
    c.rotate(a + Math.PI / 2);
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6.5, 7);
    c.lineTo(0, 3.5);
    c.lineTo(-6.5, 7);
    c.closePath();
    c.fillStyle = '#ff7e00';
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1.5;
    c.fill();
    c.stroke();
    c.restore();
    // North marker.
    const nx = W / 2 + Math.cos(rot - Math.PI / 2) * (W / 2 - 12);
    const ny = W / 2 + Math.sin(rot - Math.PI / 2) * (W / 2 - 12);
    c.font = '700 13px Pretendard, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.fillText('N', nx, ny);
  }
}
