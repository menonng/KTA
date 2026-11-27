// Browser side of the sign generator: lays out and paints every sign with
// canvas 2D (real fonts), packs them into 2048² atlas pages and returns the
// raw RGBA pages.
//
// Alpha encodes two things so one texture covers every sign style:
//   a < 0.5  : coverage (transparent background styles), no emission
//   a >= 0.5 : opaque, emission = (a - 0.5) * 2 (lit faces, neon, channel letters)

import { makeDesign, DENSITY, EMOJI, FALLBACK } from './design.mjs';

const S = 2048;
const PAD = 4;

function parseFont(spec) {
  const m = spec.match(/^(\d{3}) (.*)$/);
  return { weight: m ? m[1] : '400', fam: m ? m[2] : spec };
}
// spec: "[weight ]Family[|script]" — the script picks the fallback chain
// (Japanese, hanja, Thai glyphs missing from a display face).
function fontStr(spec, px) {
  const [sp, fb = 'ko'] = spec.split('|');
  const { weight, fam } = parseFont(sp);
  const chain = (FALLBACK[fb] || FALLBACK.ko).map((f) => `"${f}"`).join(', ');
  return `${weight} ${px.toFixed(1)}px "${fam}", ${chain}, "${EMOJI}"`;
}
const isLatinText = (t) => !/[\u3131-\uD79D\u3040-\u30FF\u4E00-\u9FFF\u0E00-\u0E7F]/.test(t);
function withFallbacks(d) {
  const tag = (font, fb) => (font && !font.includes('|') ? `${font}|${fb}` : font);
  if (d.main) d.main.font = tag(d.main.font, d.fb || 'ko');
  for (const s of d.sub) s.font = tag(s.font, s.fb || (isLatinText(s.text) ? 'latin' : 'ko'));
  for (const t of d.tenants || []) t.font = tag(t.font, 'ko');
  return d;
}

// Small deterministic RNG for painted textures (wood grain).
function prng(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const mctx = document.createElement('canvas').getContext('2d');
// Ink metrics of `text` at 100px.
function ink(spec, text, spacing = 0) {
  mctx.font = fontStr(spec, 100);
  mctx.letterSpacing = `${spacing}px`;
  const m = mctx.measureText(text);
  const asc = m.actualBoundingBoxAscent;
  const desc = m.actualBoundingBoxDescent;
  return { w: m.width, asc, desc, h: Math.max(1, asc + desc) };
}

// Fit text ink into a box: returns size, horizontal condense factor, width.
function fit(spec, text, bw, bh, spacing = 0, minSx = 0.55) {
  const k = ink(spec, text, spacing);
  let px = (bh * 100) / k.h;
  let w = (k.w * px) / 100;
  let sx = 1;
  if (w > bw) {
    sx = bw / w;
    if (sx < minSx) {
      px *= sx / minSx;
      sx = minSx;
    }
    w = ((k.w * px) / 100) * sx;
  }
  return { px, sx, w, asc: (k.asc * px) / 100, desc: (k.desc * px) / 100, spacing: (spacing * px) / 100 };
}

function drawText(ctx, spec, text, f, cx, cy, opt = {}) {
  ctx.save();
  ctx.font = fontStr(spec, f.px);
  ctx.letterSpacing = `${f.spacing || 0}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.translate(cx, cy + (f.asc - f.desc) / 2);
  ctx.scale(f.sx, 1);
  ctx.lineJoin = 'round';
  if (opt.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowOffsetX = f.px * 0.035;
    ctx.shadowOffsetY = f.px * 0.045;
    ctx.shadowBlur = f.px * 0.03;
  }
  if (opt.glowColor) {
    ctx.shadowColor = opt.glowColor;
    ctx.shadowBlur = f.px * 0.22;
  }
  if (opt.ret) {
    ctx.fillStyle = opt.ret;
    ctx.fillText(text, f.px * 0.035, f.px * 0.05);
  }
  if (opt.stroke) {
    ctx.strokeStyle = opt.stroke;
    ctx.lineWidth = f.px * (opt.strokeW || 0.12);
    ctx.strokeText(text, 0, 0);
    if (!opt.glowColor) ctx.shadowColor = 'transparent';
  }
  if (opt.fill !== false) {
    ctx.fillStyle = opt.fillStyle || opt.color;
    ctx.fillText(text, 0, 0);
  }
  ctx.restore();
}

function metalGrad(ctx, color, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, mix(color, '#FFFFFF', 0.35));
  g.addColorStop(0.5, color);
  g.addColorStop(1, mix(color, '#000000', 0.3));
  return g;
}

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a);
  const B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function fillBg(ctx, bg, W, H) {
  if (!bg || bg.type === 'none') return;
  if (bg.type === 'vgrad') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix(bg.c1, '#FFFFFF', 0.12));
    g.addColorStop(1, bg.c2);
    ctx.fillStyle = g;
  } else ctx.fillStyle = bg.c1;
  ctx.fillRect(0, 0, W, H);
  if (bg.type === 'wood') {
    // Natural timber board: horizontal grain lines (stretch-safe at the edges).
    const r = prng(Math.round(W * 7 + H * 13));
    for (let i = 0; i < H * 0.9; i++) {
      const y = r() * H;
      ctx.strokeStyle = r() < 0.5 ? 'rgba(70,40,15,0.22)' : 'rgba(255,235,200,0.14)';
      ctx.lineWidth = 0.6 + r() * 1.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= W; x += W / 8) ctx.lineTo(x, y + Math.sin(x * 0.05 + y) * H * 0.012);
      ctx.stroke();
    }
    const v = ctx.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(255,255,255,0.08)');
    v.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }
  if (bg.type === 'noren') {
    // Indigo cloth split into panels, hanging from a rod at the top.
    const n = Math.max(3, Math.min(5, Math.round(W / H / 1.2)));
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 1; k < n; k++) ctx.fillRect((W * k) / n - 1, H * 0.16, 2, H);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, 0, W, H * 0.07);
  }
  if (bg.type === 'band') {
    ctx.fillStyle = bg.c2;
    ctx.fillRect(0, 0, W, H * 0.075);
    ctx.fillRect(0, H * 0.925, W, H * 0.075);
  }
}

function emblem(ctx, e, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = e.bg;
  ctx.fill();
  ctx.lineWidth = r * 0.12;
  ctx.strokeStyle = e.ring;
  ctx.stroke();
  ctx.font = `${(r * 1.1).toFixed(1)}px "${EMOJI}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = e.ring;
  ctx.fillText(e.glyph.replace('\uFE0F', ''), cx, cy + r * 0.04);
  ctx.restore();
}

// ------------------------------------------------------------ horizontal
// Natural content width (px) of a horizontal sign at height H.
function measureH(d, H) {
  const m = d.main;
  const layout = d.layout || 'center';
  const mainH = H * (d.sub.length && layout !== 'right' ? 0.46 : 0.58);
  const sp = ((m.spacing || 0) * 100) / mainH;
  const k = ink(m.font, m.text, sp);
  let w = (k.w * mainH) / k.h;
  if (d.emblem) w += H * 0.95;
  if (d.floorTag) w += H * 0.75;
  if (d.sub.length && layout === 'right') {
    const subH = H * (d.sub.length > 1 ? 0.15 : 0.19);
    w += H * 0.3 + Math.max(...d.sub.map((s) => { const q = ink(s.font, s.text); return (q.w * subH) / q.h; }));
  }
  return w + H * 0.7;
}

function paintH(d, ctx, g, W, H) {
  const m = d.main;
  const layout = d.layout || 'center';
  fillBg(ctx, d.bg, W, H);
  let x0 = H * 0.35;
  let x1 = W - H * 0.35;
  const band = layout === 'band';
  const top = band ? 0 : 0;
  const bot = band ? H * 0.74 : H;
  if (band) {
    ctx.fillStyle = d.bg.c2 && d.bg.c2 !== d.bg.c1 ? d.bg.c2 : mix(d.bg.c1, '#000000', 0.35);
    ctx.fillRect(0, bot, W, H - bot);
  }
  const midY = (top + bot) / 2;
  if (d.emblem) {
    emblem(ctx, d.emblem, x0 + H * 0.36, midY, H * 0.33 * (band ? 0.85 : 1));
    x0 += H * 0.95;
  }
  if (d.floorTag) {
    const f = fit('900 Noto Sans KR', d.floorTag.text, H * 0.6, H * 0.32);
    drawText(ctx, '900 Noto Sans KR', d.floorTag.text, f, x0 + H * 0.3, midY, { color: d.floorTag.color, stroke: '#1A1A1A', strokeW: 0.1 });
    x0 += H * 0.75;
  }
  // Sub lines on the right.
  let subRightW = 0;
  const subs = d.sub;
  if (subs.length && layout === 'right') {
    const subH = H * (subs.length > 1 ? 0.15 : 0.19);
    const fits = subs.map((s) => fit(s.font, s.text, (x1 - x0) * 0.42, subH));
    subRightW = Math.max(...fits.map((f) => f.w));
    const gap = H * 0.08;
    const total = fits.length * subH + (fits.length - 1) * gap;
    fits.forEach((f, i) => {
      const s = subs[i];
      const cy = midY - total / 2 + subH / 2 + i * (subH + gap);
      drawText(ctx, s.font, s.text, f, x1 - subRightW / 2, cy, { color: s.color, glowColor: s.neon ? s.color : null });
      if (d.glow === 'letters') drawText(g, s.font, s.text, f, x1 - subRightW / 2, cy, { color: '#fff' });
    });
    x1 -= subRightW + H * 0.3;
  }
  const hasBelow = subs.length && layout !== 'right';
  const mainH = (bot - top) * (hasBelow && !band ? 0.46 : band ? 0.62 : 0.58);
  const mainY = hasBelow && !band ? top + (bot - top) * 0.4 : midY;
  const sp = ((m.spacing || 0) * 100) / mainH;
  const f = fit(m.font, m.text, x1 - x0, mainH, sp * (mainH / 100));
  const cx = (x0 + x1) / 2;
  if (d.raceway) {
    ctx.fillStyle = d.raceway;
    ctx.fillRect(cx - f.w / 2 - H * 0.12, mainY - H * 0.1, f.w + H * 0.24, H * 0.2);
  }
  const opt = { color: m.color, stroke: m.stroke, shadow: m.shadow, ret: m.ret };
  if (m.metal) opt.fillStyle = metalGrad(ctx, m.color, mainY - f.asc, mainY + f.desc);
  if (m.neon) {
    opt.fillStyle = mix(m.color, '#FFFFFF', 0.55);
    opt.glowColor = m.color;
    opt.stroke = m.color;
    opt.strokeW = 0.05;
  }
  drawText(ctx, m.font, m.text, f, cx, mainY, opt);
  if (d.glow === 'letters') drawText(g, m.font, m.text, f, cx, mainY, { color: '#fff', stroke: m.neon ? '#fff' : null, strokeW: 0.08 });
  if (hasBelow) {
    const s = subs[0];
    const subY = band ? (bot + H) / 2 : top + (bot - top) * 0.8;
    const subH = band ? (H - bot) * 0.55 : (bot - top) * 0.16;
    const fs = fit(s.font, s.text, band ? W - H * 0.6 : (x1 - x0) * 0.9, subH, (s.spacing || 0) * (subH / 100));
    const col = band ? (d.main.color === d.bg.c1 ? '#FFFFFF' : d.main.color) : s.color;
    drawText(ctx, s.font, s.text, fs, band ? W / 2 : cx, subY, { color: band ? pickContrast(ctx.fillStyle, col) : col, glowColor: s.neon ? s.color : null });
    if (d.glow === 'letters') drawText(g, s.font, s.text, fs, band ? W / 2 : cx, subY, { color: '#fff' });
  }
}

function pickContrast(bg, fg) {
  return fg;
}

// ------------------------------------------------------------ vertical
function paintV(d, ctx, g, W, H) {
  const m = d.main;
  fillBg(ctx, d.bg.type === 'blocks' ? { type: 'solid', c1: d.bg.c1 } : d.bg, W, H);
  let y0 = W * 0.18;
  let y1 = H - W * 0.18;
  if (d.emblem) {
    emblem(ctx, d.emblem, W / 2, y0 + W * 0.4, W * 0.36);
    y0 += W * 0.9;
  }
  if (d.sub.length) {
    const s = d.sub[0];
    const f = fit(s.font, s.text, W * 0.8, W * 0.3);
    drawText(ctx, s.font, s.text, f, W / 2, y1 - W * 0.18, { color: s.color });
    y1 -= W * 0.5;
  }
  const chars = [...m.text.replace(/\s+/g, '')];
  const n = chars.length;
  const cell = Math.min(W * 1.05, (y1 - y0) / n);
  const start = (y0 + y1) / 2 - (cell * n) / 2;
  chars.forEach((ch, i) => {
    const cy = start + cell * (i + 0.5);
    let col = m.color;
    if (d.bg.type === 'blocks' && i % 2 === 1) {
      ctx.fillStyle = d.bg.c2;
      ctx.fillRect(0, start + cell * i, W, cell);
      col = d.bg.c1 === m.color ? '#FFFFFF' : d.bg.c1;
    }
    const f = fit(m.font, ch, W * 0.8, Math.min(cell * 0.74, W * 0.74), 0, 0.7);
    drawText(ctx, m.font, ch, f, W / 2, cy, { color: col, stroke: m.stroke });
  });
}

function paintStack(d, ctx, g, W, H) {
  const n = d.tenants.length;
  const gap = Math.max(2, W * 0.05);
  const ph = (H - gap * (n - 1)) / n;
  ctx.fillStyle = '#1E2023';
  ctx.fillRect(0, 0, W, H);
  d.tenants.forEach((t, k) => {
    const y = k * (ph + gap);
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, y, W, ph);
    const tagH = Math.min(ph * 0.09, W * 0.3);
    const ft = fit('900 Noto Sans KR', t.floor, W * 0.6, tagH);
    drawText(ctx, '900 Noto Sans KR', t.floor, ft, W / 2, y + W * 0.12 + tagH / 2, { color: t.acc === t.bg ? t.fg : t.acc });
    const chars = [...t.text.replace(/\s+/g, '')];
    const top = y + W * 0.24 + tagH;
    const bot = y + ph - W * 0.12;
    const cell = Math.min(W * 1.0, (bot - top) / chars.length);
    const st = (top + bot) / 2 - (cell * chars.length) / 2;
    chars.forEach((ch, i) => {
      const f = fit(t.font, ch, W * 0.78, Math.min(cell * 0.76, W * 0.72), 0, 0.7);
      drawText(ctx, t.font, ch, f, W / 2, st + cell * (i + 0.5), { color: t.fg });
    });
  });
}

function paintBoard(d, ctx, g, W, H) {
  fillBg(ctx, d.bg, W, H);
  // Product blobs on the right.
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#FFFFFF';
  for (const [x, y, r] of [[0.82, 0.45, 0.42], [0.92, 0.85, 0.3], [0.7, 0.1, 0.22]]) {
    ctx.beginPath();
    ctx.arc(W * x, H * y, H * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  const m = d.main;
  const f = fit(m.font, m.text, W * 0.62, H * 0.38);
  drawText(ctx, m.font, m.text, f, W * 0.36, H * 0.4, { color: m.color, shadow: true });
  const s = d.sub[0];
  const fs = fit(s.font, s.text, W * 0.55, H * 0.12);
  drawText(ctx, s.font, s.text, fs, W * 0.36, H * 0.76, { color: s.color });
}

function paintBanner(d, ctx, g, W, H) {
  fillBg(ctx, d.bg, W, H);
  // Cloth wrinkles.
  ctx.save();
  for (let i = 0; i < 7; i++) {
    const x = (i + 0.5 + Math.sin(i * 7.1) * 0.3) * (W / 7);
    const gr = ctx.createLinearGradient(x - W * 0.04, 0, x + W * 0.04, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.5, 'rgba(0,0,0,0.07)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(x - W * 0.04, 0, W * 0.08, H);
  }
  ctx.restore();
  const m = d.main;
  const f = fit(m.font, m.text, W * 0.5, H * 0.56);
  drawText(ctx, m.font, m.text, f, W * 0.3, H * 0.5, { color: m.color });
  const s = d.sub[0];
  const fs = fit(s.font, s.text, W * 0.4, H * 0.24);
  drawText(ctx, s.font, '☎ ' + s.text, fs, W * 0.74, H * 0.5, { color: s.color });
  // Rope ties at the corners.
  ctx.fillStyle = '#9A9A9A';
  for (const [x, y] of [[0.015, 0.06], [0.985, 0.06], [0.015, 0.94], [0.985, 0.94]]) {
    ctx.beginPath();
    ctx.arc(W * x, H * y, H * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintExit(d, ctx, g, W, H) {
  ctx.fillStyle = '#1F2A44';
  ctx.fillRect(0, 0, W, H);
  const pad = H * 0.12;
  ctx.fillStyle = '#FFC20E';
  ctx.fillRect(pad, pad, H - 2 * pad, H - 2 * pad);
  const fn = fit('900 Noto Sans KR', d.no, (H - 2 * pad) * 0.8, (H - 2 * pad) * 0.62);
  drawText(ctx, '900 Noto Sans KR', d.no, fn, H / 2, H / 2, { color: '#111111' });
  const f1 = fit('700 Noto Sans KR', '출구', W * 0.4, H * 0.36);
  drawText(ctx, '700 Noto Sans KR', '출구', f1, H + (W - H) * 0.32, H * 0.42, { color: '#FFFFFF' });
  const f2 = fit('500 Montserrat', 'Exit', W * 0.25, H * 0.2);
  drawText(ctx, '500 Montserrat', 'Exit', f2, H + (W - H) * 0.32, H * 0.78, { color: '#C9D3E6' });
  const f3 = fit('700 Noto Sans KR', '홍대입구역', (W - H) * 0.38, H * 0.2);
  drawText(ctx, '700 Noto Sans KR', '홍대입구역', f3, W - (W - H) * 0.22 - pad * 0.5, H * 0.5, { color: '#FFFFFF' });
}

// ------------------------------------------------------------ pipeline
function sizeOf(d) {
  const D = DENSITY[d.kind] * (d._scale || 1);
  const H = Math.max(8, Math.round(d.h * D));
  const full = Math.max(8, Math.round(d.w * D));
  if (d.style === 'vflex' || d.style === 'stack' || d.style === 'board' || d.style === 'banner' || d.style === 'exit') return { W: full, H, D };
  const nat = Math.ceil(measureH(d, H));
  return { W: Math.max(Math.round(H * 1.2), Math.min(full, nat)), H, D };
}

function encodeSign(cctx, gctx, W, H) {
  const c = cctx.getImageData(0, 0, W, H).data;
  const gl = gctx.getImageData(0, 0, W, H).data;
  const out = new Uint8ClampedArray(W * H * 4);
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let i = 0; i < W * H; i++) {
    const a = c[i * 4 + 3];
    out[i * 4] = c[i * 4];
    out[i * 4 + 1] = c[i * 4 + 1];
    out[i * 4 + 2] = c[i * 4 + 2];
    if (a >= 250) out[i * 4 + 3] = 128 + Math.round(gl[i * 4] * 127 / 255);
    else out[i * 4 + 3] = Math.round(a * 127 / 255);
    if (a > 128) { sr += c[i * 4]; sg += c[i * 4 + 1]; sb += c[i * 4 + 2]; sn++; }
  }
  // Bleed colour into transparent texels so filtering does not darken edges.
  for (let pass = 0; pass < 6; pass++) {
    const src = out.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (src[i * 4 + 3] >= 16) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (src[j * 4 + 3] >= 16 || (pass > 0 && (src[j * 4] | src[j * 4 + 1] | src[j * 4 + 2]))) { r += src[j * 4]; g += src[j * 4 + 1]; b += src[j * 4 + 2]; n++; }
      }
      if (n) { out[i * 4] = r / n; out[i * 4 + 1] = g / n; out[i * 4 + 2] = b / n; }
    }
  }
  if (sn) for (let i = 0; i < W * H; i++) if (out[i * 4 + 3] < 16 && !(out[i * 4] | out[i * 4 + 1] | out[i * 4 + 2])) { out[i * 4] = sr / sn; out[i * 4 + 1] = sg / sn; out[i * 4 + 2] = sb / sn; }
  return out;
}

function blit(page, img, W, H, px, py) {
  // Copy with PAD-pixel edge extension (clamp) to limit mip bleeding.
  for (let y = -PAD; y < H + PAD; y++) {
    const sy = Math.min(H - 1, Math.max(0, y));
    for (let x = -PAD; x < W + PAD; x++) {
      const sx = Math.min(W - 1, Math.max(0, x));
      const si = (sy * W + sx) * 4;
      const di = ((py + y) * S + px + x) * 4;
      page[di] = img[si];
      page[di + 1] = img[si + 1];
      page[di + 2] = img[si + 2];
      page[di + 3] = img[si + 3];
    }
  }
}

function pack(items, maxPages) {
  const order = items.map((_, i) => i).sort((a, b) => items[b].H - items[a].H || items[b].W - items[a].W);
  const pos = new Array(items.length);
  let page = 0, x = PAD, y = PAD, shelf = 0;
  for (const i of order) {
    const it = items[i];
    if (it.W + 2 * PAD > S || it.H + 2 * PAD > S) throw new Error('sign too large: ' + i);
    if (x + it.W + PAD > S) { x = PAD; y += shelf + 2 * PAD; shelf = 0; }
    if (y + it.H + PAD > S) { page++; x = PAD; y = PAD; shelf = 0; }
    if (page >= maxPages) return null;
    pos[i] = { page, x, y };
    x += it.W + 2 * PAD;
    shelf = Math.max(shelf, it.H);
  }
  return { pos, pages: page + 1 };
}

async function toB64(u8) {
  return await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.slice(fr.result.indexOf(',') + 1));
    fr.readAsDataURL(new Blob([u8]));
  });
}

window.signgen = async (reqs, maxPages) => {
  const designs = reqs.map((r, i) => withFallbacks(makeDesign(r, i)));
  // Load every font subset the designs need.
  const need = new Map();
  const add = (spec, text) => { if (spec && text) need.set(spec, (need.get(spec) || '') + text); };
  for (const d of designs) {
    add(d.main?.font, d.main?.text);
    if (d.style === 'exit') { add('900 Noto Sans KR', d.no); add('700 Noto Sans KR', '출구홍대입구역'); add('500 Montserrat', 'Exit'); }
    d.sub.forEach((s) => add(s.font, s.text + '☎ '));
    d.tenants?.forEach((t) => { add(t.font, t.text); add('900 Noto Sans KR', t.floor); });
    if (d.floorTag) add('900 Noto Sans KR', d.floorTag.text);
    if (d.emblem) need.set('EMOJI', (need.get('EMOJI') || '') + d.emblem.glyph);
  }
  add('Do Hyeon', '가나다ABC0123');
  add('900 Noto Sans KR', '0123456789F-☎');
  await Promise.all([...need].map(([spec, text]) => {
    const uniq = [...new Set([...text])].join('');
    return spec === 'EMOJI' ? document.fonts.load(`40px "${EMOJI}"`, uniq) : document.fonts.load(fontStr(spec, 40), uniq);
  }));
  await document.fonts.ready;

  // Size, then shrink density until everything fits into maxPages.
  let scale = 1, sizes, packed;
  for (let tries = 0; tries < 20; tries++) {
    designs.forEach((d) => (d._scale = scale));
    sizes = designs.map(sizeOf);
    packed = pack(sizes, maxPages);
    if (packed) break;
    scale *= 0.94;
  }
  const pages = Array.from({ length: packed.pages }, () => new Uint8ClampedArray(S * S * 4));
  const cv = document.createElement('canvas');
  const gv = document.createElement('canvas');
  const meta = [];
  designs.forEach((d, i) => {
    const { W, H, D } = sizes[i];
    cv.width = gv.width = W;
    cv.height = gv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const g = gv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, W, H);
    g.fillStyle = d.glow === 'face' ? '#ffffff' : '#000000';
    g.fillRect(0, 0, W, H);
    if (d.style === 'vflex') paintV(d, ctx, g, W, H);
    else if (d.style === 'stack') paintStack(d, ctx, g, W, H);
    else if (d.style === 'board') paintBoard(d, ctx, g, W, H);
    else if (d.style === 'banner') paintBanner(d, ctx, g, W, H);
    else if (d.style === 'exit') paintExit(d, ctx, g, W, H);
    else paintH(d, ctx, g, W, H);
    const img = encodeSign(ctx, g, W, H);
    const p = packed.pos[i];
    blit(pages[p.page], img, W, H, p.x, p.y);
    meta.push({
      t: d.text || '',
      st: d.style,
      l: p.page,
      // u0, v_bottom, u1, v_top (v = 0 is the first image row).
      r: [p.x / S, (p.y + H) / S, (p.x + W) / S, p.y / S].map((v) => +v.toFixed(6)),
      iw: +(W / D).toFixed(3),
      px: [W, H],
      off: d.off || 0,
      box: d.box || null,
      g: d.glow,
    });
  });
  const b64 = [];
  for (const p of pages) b64.push(await toB64(new Uint8Array(p.buffer)));
  return { meta, pages: b64, scale, size: S };
};
window.signgenReady = true;
