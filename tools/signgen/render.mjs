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
const isLatinText = (t) => !/[ㄱ-힝぀-ヿ一-鿿฀-๿]/.test(t);
const tagFont = (font, text, fb) => (font && !font.includes('|') ? `${font}|${fb || (isLatinText(text || '') ? 'latin' : 'ko')}` : font);
function withFallbacks(d) {
  if (d.main) d.main.font = tagFont(d.main.font, d.main.text, d.fb || 'ko');
  for (const s of d.sub) s.font = tagFont(s.font, s.text, s.fb);
  for (const t of d.tenants || []) t.font = tagFont(t.font, t.text, 'ko');
  for (const it of d.items || []) it.font = tagFont(it.font, it.n + it.p);
  if (d.mark && d.mark.font) d.mark.font = tagFont(d.mark.font, d.mark.letter);
  return d;
}

// Small deterministic RNG for painted textures (wood grain, brushed metal).
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

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a);
  const B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const lum = (h) => {
  const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};

// Text in runs (multi-colour wordmarks) with optional halo, raised returns,
// trim stroke and metal face. Centered on (cx, cy).
function drawText(ctx, spec, text, f, cx, cy, opt = {}) {
  ctx.save();
  ctx.font = fontStr(spec, f.px);
  ctx.letterSpacing = `${f.spacing || 0}px`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const runs = (opt.parts || [{ text, color: opt.color }]).map((p) => ({ ...p, w: ctx.measureText(p.text).width }));
  const total = runs.reduce((s, r) => s + r.w, 0);
  let x = -total / 2;
  for (const r of runs) {
    r.x = x;
    x += r.w;
  }
  ctx.translate(cx, cy + (f.asc - f.desc) / 2);
  ctx.scale(f.sx, 1);
  ctx.lineJoin = 'round';
  const each = (fn) => runs.forEach(fn);
  if (opt.halo) {
    ctx.save();
    ctx.shadowColor = opt.halo;
    ctx.shadowBlur = f.px * 0.28;
    ctx.fillStyle = opt.halo;
    each((r) => ctx.fillText(r.text, r.x, 0));
    ctx.restore();
  }
  if (opt.shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowOffsetX = f.px * 0.035;
    ctx.shadowOffsetY = f.px * 0.045;
    ctx.shadowBlur = f.px * 0.03;
    ctx.fillStyle = 'rgba(0,0,0,0.01)';
    each((r) => ctx.fillText(r.text, r.x, 0));
    ctx.restore();
  }
  if (opt.extrude) {
    // Raised letters seen slightly from above-left: the returns show below-right.
    const depth = f.px * opt.extrude.k;
    const n = Math.max(2, Math.min(14, Math.round(depth / 1.1)));
    for (let i = n; i >= 1; i--) {
      ctx.fillStyle = mix(opt.extrude.color, '#000000', 0.35 * (i / n));
      const ox = (depth * 0.45 * i) / n / f.sx;
      const oy = (depth * 0.9 * i) / n;
      each((r) => ctx.fillText(r.text, r.x + ox, oy));
    }
  }
  if (opt.glowColor) {
    ctx.shadowColor = opt.glowColor;
    ctx.shadowBlur = f.px * 0.22;
  }
  if (opt.ret) {
    ctx.fillStyle = opt.ret;
    each((r) => ctx.fillText(r.text, r.x + f.px * 0.035, f.px * 0.05));
  }
  if (opt.stroke) {
    ctx.strokeStyle = opt.stroke;
    ctx.lineWidth = f.px * (opt.strokeW || 0.12);
    each((r) => ctx.strokeText(r.text, r.x, 0));
    if (!opt.glowColor) ctx.shadowColor = 'transparent';
  }
  if (opt.fill !== false) {
    each((r) => {
      ctx.fillStyle = opt.fillStyle || r.color || opt.color;
      ctx.fillText(r.text, r.x, 0);
    });
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
  if (bg.type === 'brushed') {
    // Brushed metal panel: soft vertical falloff and horizontal hairlines.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix(bg.c1, '#FFFFFF', 0.16));
    g.addColorStop(0.55, bg.c1);
    g.addColorStop(1, mix(bg.c1, '#000000', 0.2));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const r = prng(Math.round(W * 3 + H * 17));
    for (let i = 0; i < H * 1.6; i++) {
      ctx.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.03 + r() * 0.05})` : `rgba(0,0,0,${0.03 + r() * 0.06})`;
      ctx.fillRect(0, r() * H, W, 0.6 + r() * 0.8);
    }
  }
  if (bg.type === 'panel' || bg.type === 'brushed') {
    // Folded panel edges catch the light at the top, shade at the bottom.
    ctx.fillStyle = mix(bg.c1, '#FFFFFF', 0.4);
    ctx.fillRect(0, 0, W, Math.max(1, H * 0.025));
    ctx.fillStyle = mix(bg.c1, '#000000', 0.28);
    ctx.fillRect(0, H - Math.max(1.5, H * 0.035), W, Math.max(1.5, H * 0.035));
    if (bg.type === 'panel') {
      const v = ctx.createLinearGradient(0, 0, 0, H);
      v.addColorStop(0, 'rgba(255,255,255,0.07)');
      v.addColorStop(1, 'rgba(0,0,0,0.06)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
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

// ------------------------------------------------------------ logo marks
function glyph(ctx, g, cx, cy, size, color) {
  ctx.font = `${size.toFixed(1)}px "${EMOJI}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(g.replace('️', ''), cx, cy + size * 0.04);
}

function shapePath(ctx, shape, cx, cy, R) {
  ctx.beginPath();
  if (shape === 'hex') {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    }
    ctx.closePath();
  } else if (shape === 'diamond') {
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx + R, cy);
    ctx.lineTo(cx, cy + R);
    ctx.lineTo(cx - R, cy);
    ctx.closePath();
  } else if (shape === 'shield') {
    ctx.moveTo(cx - R * 0.82, cy - R * 0.8);
    ctx.lineTo(cx + R * 0.82, cy - R * 0.8);
    ctx.lineTo(cx + R * 0.82, cy + R * 0.05);
    ctx.quadraticCurveTo(cx + R * 0.8, cy + R * 0.7, cx, cy + R);
    ctx.quadraticCurveTo(cx - R * 0.8, cy + R * 0.7, cx - R * 0.82, cy + R * 0.05);
    ctx.closePath();
  } else ctx.arc(cx, cy, R, 0, Math.PI * 2);
}

// Text set on a circle: top arc reads clockwise, bottom arc stays upright.
function ringText(ctx, text, cx, cy, rad, size, color, bottom) {
  ctx.save();
  ctx.font = fontStr('800 Montserrat|latin', size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + size * 0.12);
  const total = widths.reduce((s, w) => s + w, 0);
  let a = (bottom ? 1 : -1) * Math.PI / 2 + (bottom ? total / rad / 2 : -total / rad / 2);
  chars.forEach((c, i) => {
    const step = widths[i] / rad;
    const mid = bottom ? a - step / 2 : a + step / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(mid) * rad, cy + Math.sin(mid) * rad);
    ctx.rotate(mid + (bottom ? -Math.PI / 2 : Math.PI / 2));
    ctx.fillText(c, 0, 0);
    ctx.restore();
    a = bottom ? a - step : a + step;
  });
  ctx.restore();
}

// Original duck mascot (crowned duck head over waves) for the coffee parody.
function drawDuck(ctx, cx, cy, s, fg, bg) {
  ctx.save();
  ctx.fillStyle = fg;
  // Waves below.
  ctx.lineWidth = s * 0.07;
  ctx.strokeStyle = fg;
  for (const k of [0, 1]) {
    ctx.beginPath();
    const y = cy + s * (0.62 + k * 0.17);
    for (let i = 0; i <= 24; i++) {
      const x = cx - s * 0.62 + (i / 24) * s * 1.24;
      ctx.lineTo(x, y + Math.sin(i * 0.8 + k) * s * 0.04);
    }
    ctx.stroke();
  }
  // Head and neck.
  ctx.beginPath();
  ctx.arc(cx + s * 0.04, cy + s * 0.05, s * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.12, cy + s * 0.42, s * 0.24, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // Bill.
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.36, cy + s * 0.12, s * 0.22, s * 0.1, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = bg;
  ctx.lineWidth = s * 0.03;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.56, cy + s * 0.13);
  ctx.lineTo(cx - s * 0.2, cy + s * 0.12);
  ctx.stroke();
  // Eye.
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx - s * 0.07, cy - s * 0.04, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
  // Crown with a star.
  ctx.fillStyle = fg;
  ctx.beginPath();
  const by = cy - s * 0.26;
  ctx.moveTo(cx - s * 0.26, by);
  ctx.lineTo(cx - s * 0.3, by - s * 0.26);
  ctx.lineTo(cx - s * 0.13, by - s * 0.14);
  ctx.lineTo(cx + s * 0.04, by - s * 0.34);
  ctx.lineTo(cx + s * 0.2, by - s * 0.14);
  ctx.lineTo(cx + s * 0.36, by - s * 0.26);
  ctx.lineTo(cx + s * 0.32, by);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = bg;
  star(ctx, cx + s * 0.04, by - s * 0.12, s * 0.07);
  ctx.restore();
}

function star(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

// mk: mark spec from design.mjs. force: paint every part in one colour (glow pass).
function drawMark(ctx, mk, cx, cy, R, force) {
  const c = (v) => force || v;
  ctx.save();
  switch (mk.type) {
    case 'badge':
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = c(mk.bg);
      ctx.fill();
      ctx.lineWidth = R * 0.12;
      ctx.strokeStyle = c(mk.ring);
      ctx.stroke();
      if (!force) glyph(ctx, mk.glyph, cx, cy, R * 1.05, mk.fg);
      break;
    case 'tile':
      ctx.beginPath();
      ctx.roundRect(cx - R * 0.92, cy - R * 0.92, R * 1.84, R * 1.84, R * 0.36);
      ctx.fillStyle = c(mk.bg);
      ctx.fill();
      if (!force) {
        if (mk.glyph) glyph(ctx, mk.glyph, cx, cy, R * 1.1, mk.fg);
        else if (mk.letter) drawText(ctx, mk.font || '900 Noto Sans KR', mk.letter, fit(mk.font || '900 Noto Sans KR', mk.letter, R * 1.3, R * 1.0), cx, cy, { color: mk.fg });
      }
      break;
    case 'mono': {
      const shape = mk.shape === 'ring2' ? 'circle' : mk.shape;
      shapePath(ctx, shape, cx, cy, R * 0.94);
      if (mk.solid) {
        ctx.fillStyle = c(mk.fg);
        ctx.fill();
      } else {
        ctx.lineWidth = R * 0.1;
        ctx.strokeStyle = c(mk.fg);
        ctx.stroke();
        if (mk.shape === 'ring2') {
          ctx.lineWidth = R * 0.04;
          shapePath(ctx, 'circle', cx, cy, R * 0.74);
          ctx.stroke();
        }
      }
      const f = fit(mk.font, mk.letter, R * 1.1, R * 0.92);
      drawText(ctx, mk.font, mk.letter, f, cx, cy, { color: mk.solid ? (force ? '#000000' : mix(mk.fg, '#000000', 0.6)) : c(mk.fg) });
      break;
    }
    case 'seal': {
      // Red square stamp, characters in columns read right to left.
      ctx.translate(cx, cy);
      ctx.rotate(-0.04);
      const s = R * 0.86;
      ctx.fillStyle = c(mk.bg);
      ctx.fillRect(-s, -s, s * 2, s * 2);
      if (force) break;
      ctx.strokeStyle = mk.fg;
      ctx.lineWidth = s * 0.06;
      ctx.strokeRect(-s * 0.84, -s * 0.84, s * 1.68, s * 1.68);
      const ch = [...mk.text];
      const spec = '900 Noto Serif TC|zhT';
      if (ch.length === 1) {
        drawText(ctx, spec, ch[0], fit(spec, ch[0], s * 1.4, s * 1.3), 0, 0, { color: mk.fg });
      } else {
        const cols = ch.length > 2 ? 2 : 1;
        const rows = Math.ceil(ch.length / cols);
        ch.forEach((t, i) => {
          const col = cols === 1 ? 0 : i < rows ? 1 : 0; // first column on the right
          const row = i % rows;
          const x = cols === 1 ? 0 : (col === 1 ? 0.4 : -0.4) * s;
          const y = ((row + 0.5) / rows - 0.5) * s * 1.5;
          drawText(ctx, spec, t, fit(spec, t, s * (cols === 1 ? 1.3 : 0.7), (s * 1.3) / rows), x, y, { color: mk.fg });
        });
      }
      break;
    }
    case 'picto':
      if (force) {
        ctx.globalAlpha = 1;
        glyph(ctx, mk.glyph, cx, cy, R * 1.9, force);
      } else glyph(ctx, mk.glyph, cx, cy, R * 1.9, mk.fg);
      break;
    case 'neon':
      ctx.shadowColor = mk.fg;
      ctx.shadowBlur = R * 0.4;
      glyph(ctx, mk.glyph, cx, cy, R * 1.8, force || mix(mk.fg, '#FFFFFF', 0.5));
      break;
    case 'roundel': {
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = c(mk.bg);
      ctx.fill();
      if (force) break;
      ctx.strokeStyle = mk.fg;
      ctx.lineWidth = R * 0.035;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.94, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      if (mk.ringText) ringText(ctx, mk.ringText, cx, cy, R * 0.78, R * 0.2, mk.fg, false);
      if (mk.ringText2) ringText(ctx, mk.ringText2, cx, cy, R * 0.78, R * 0.2, mk.fg, true);
      if (mk.ringText || mk.ringText2) {
        ctx.fillStyle = mk.fg;
        star(ctx, cx - R * 0.78, cy, R * 0.07);
        star(ctx, cx + R * 0.78, cy, R * 0.07);
      }
      if (mk.draw === 'duck') drawDuck(ctx, cx, cy - R * 0.05, R * 0.5, mk.fg, mk.bg);
      else if (mk.glyph) glyph(ctx, mk.glyph, cx, cy, R * 0.7, mk.fg);
      break;
    }
    case 'numeral': {
      const spec = 'Archivo Black|latin';
      const f = fit(spec, mk.text, R * 1.6, R * 1.75);
      drawText(ctx, spec, mk.text, f, cx, cy, { color: c(mk.fg), stroke: c(mk.ring), strokeW: 0.16 });
      drawText(ctx, spec, mk.text, f, cx, cy, { color: c(mk.fg) });
      break;
    }
    case 'leaf':
      ctx.fillStyle = c(mk.fg);
      for (const [a, ox] of [[-0.6, -0.22], [0.5, 0.25]]) {
        ctx.beginPath();
        ctx.ellipse(cx + R * ox, cy - R * 0.05, R * 0.28, R * 0.62, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillRect(cx - R * 0.04, cy + R * 0.2, R * 0.08, R * 0.7);
      break;
    case 'film':
      ctx.strokeStyle = c(mk.fg);
      ctx.fillStyle = c(mk.fg);
      ctx.lineWidth = R * 0.1;
      ctx.beginPath();
      ctx.roundRect(cx - R * 0.6, cy - R * 0.92, R * 1.2, R * 1.84, R * 0.12);
      ctx.stroke();
      for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) ctx.fillRect(cx + sx * R * 0.2 - R * 0.14, cy - R * 0.72 + i * R * 0.4, R * 0.28, R * 0.28);
      break;
    case 'sun':
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.92, 0, Math.PI * 2);
      ctx.fillStyle = c(mk.fg);
      ctx.fill();
      if (force) break;
      ctx.beginPath();
      ctx.arc(cx, cy + R * 0.95, R * 1.05, Math.PI * 1.18, Math.PI * 1.82);
      ctx.arc(cx, cy + R * 1.35, R * 1.05, Math.PI * 1.75, Math.PI * 1.25, true);
      ctx.closePath();
      ctx.fillStyle = mk.acc;
      ctx.fill();
      break;
    case 'cross':
      ctx.fillStyle = c(mk.fg);
      ctx.fillRect(cx - R * 0.13, cy - R * 0.95, R * 0.26, R * 1.9);
      ctx.fillRect(cx - R * 0.6, cy - R * 0.5, R * 1.2, R * 0.26);
      break;
    case 'six': {
      // Numeral with the orange top / red bottom split, the name across it.
      const spec = 'Archivo Black|latin';
      const f = fit(spec, '6', R * 1.4, R * 1.75);
      const gr = ctx.createLinearGradient(0, cy - R, 0, cy + R);
      gr.addColorStop(0, c(mk.fg));
      gr.addColorStop(0.5, c(mk.fg));
      gr.addColorStop(0.5, c(mk.fg2));
      gr.addColorStop(1, c(mk.fg2));
      drawText(ctx, spec, '6', f, cx, cy, { color: mk.fg, fillStyle: force ? force : gr });
      const ft = fit(spec, mk.text, R * 1.9, R * 0.4);
      drawText(ctx, spec, mk.text, ft, cx, cy + R * 0.18, { color: c(mk.ink), stroke: c('#FFFFFF'), strokeW: 0.3 });
      drawText(ctx, spec, mk.text, ft, cx, cy + R * 0.18, { color: c(mk.ink) });
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// ------------------------------------------------------------ horizontal
function markR(d, H) {
  const band = d.layout === 'band';
  const stripeH = d.stripes ? d.stripes.reduce((s, x) => s + x.t, 0) * H : 0;
  const bot = band ? H * 0.74 : H - stripeH;
  return { R: bot * 0.34 * (band ? 0.9 : 1), bot };
}

// Natural content width (px) of a horizontal sign at height H.
function measureH(d, H) {
  if (d.layout === 'bands7') return H * 1.85;
  const m = d.main;
  const layout = d.layout || 'center';
  const { R, bot } = markR(d, H);
  const mainH = bot * (d.sub.length && layout !== 'right' ? 0.46 : 0.58);
  const sp = ((m.spacing || 0) * 100) / mainH;
  const k = ink(m.font, m.text, sp);
  let w = (k.w * mainH) / k.h;
  if (d.split) w += H * d.split.k + H * 0.3 - H * 0.35;
  else if (d.mark) w += R * 2.1 + H * 0.22;
  if (d.floorTag) w += H * 0.75;
  if (d.dot) w += H * 0.2;
  if (d.sub.length && layout === 'right') {
    const subH = H * (d.sub.length > 1 ? 0.15 : 0.19);
    w += H * 0.3 + Math.max(...d.sub.map((s) => { const q = ink(s.font, s.text); return (q.w * subH) / q.h + (s.pill ? subH * 1.2 : 0); }));
  }
  return w + H * 0.7;
}

function subLine(ctx, g, d, s, f, cx, cy) {
  if (s.pill) {
    const pw = f.w + f.px * 0.9;
    const ph = (f.asc + f.desc) * 1.7;
    ctx.fillStyle = s.pill;
    ctx.beginPath();
    ctx.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
    ctx.fill();
  }
  const col = s.pill ? (lum(s.pill) > 0.55 ? '#111111' : '#FFFFFF') : s.color;
  drawText(ctx, s.font, s.text, f, cx, cy, { color: col, glowColor: s.neon ? s.color : null });
  if (d.glow === 'letters') drawText(g, s.font, s.text, f, cx, cy, { color: '#fff' });
}

// Convenience chain fascia: full-width colour bands, logo box in the middle
// (the bands carry on to both ends through the edge stretch).
function paintBands7(d, ctx, g, W, H) {
  fillBg(ctx, d.bg, W, H);
  [[0.1, 0.3], [0.36, 0.56], [0.62, 0.82]].forEach(([a, b], i) => {
    ctx.fillStyle = d.bands[i];
    ctx.fillRect(0, a * H, W, (b - a) * H);
  });
  const bw = H * 1.12;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(W / 2 - bw / 2, H * 0.03, bw, H * 0.94);
  ctx.strokeStyle = '#D8D8D8';
  ctx.lineWidth = Math.max(1, H * 0.012);
  ctx.strokeRect(W / 2 - bw / 2, H * 0.03, bw, H * 0.94);
  drawMark(ctx, d.mark, W / 2, H / 2, H * 0.42);
}

// GS25-type fascia: corner brackets in the accent colour at both ends, the
// wordmark in the middle, slogan inside the left bracket.
function paintGG(d, ctx, g, W, H) {
  fillBg(ctx, d.bg, W, H);
  const acc = d.main.parts[1].color;
  const t = H * 0.075;
  const L = Math.min(W * 0.26, H * 3.2);
  const y0 = H * 0.24;
  const y1 = H * 0.74;
  ctx.fillStyle = acc;
  ctx.fillRect(W * 0.06, y0, L, t);
  ctx.fillRect(W * 0.06, y0, t, y1 - y0);
  ctx.fillRect(W * 0.94 - L, y0, L, t);
  ctx.fillRect(W * 0.94 - t, y0, t, y1 - y0);
  const fs = fit('600 Montserrat|latin', 'Lifestyle Platform', L * 0.8, H * 0.13);
  drawText(ctx, '600 Montserrat|latin', 'Lifestyle Platform', fs, W * 0.06 + t * 2.5 + fs.w / 2, H * 0.52, { color: '#FFFFFF' });
  const fn = fit('700 Noto Sans KR|ko', '홍대점', L * 0.5, H * 0.11);
  drawText(ctx, '700 Noto Sans KR|ko', '홍대점', fn, W * 0.94 - t * 2.5 - fn.w / 2, H * 0.6, { color: '#C9CDD2' });
  const m = d.main;
  const f = fit(m.font, m.text, W - 2 * (W * 0.06 + L) - H * 0.6, H * 0.5);
  drawText(ctx, m.font, m.text, f, W / 2, H * 0.5, { parts: m.parts, color: m.color });
  drawText(g, m.font, m.text, f, W / 2, H * 0.5, { color: '#ffffff' });
  g.fillStyle = '#ffffff';
  g.fillRect(W * 0.06, y0, L, t);
  g.fillRect(W * 0.06, y0, t, y1 - y0);
  g.fillRect(W * 0.94 - L, y0, L, t);
  g.fillRect(W * 0.94 - t, y0, t, y1 - y0);
}

// CU-type fascia: small 'Nice to', the wordmark, then a long rounded bar.
function paintCU(d, ctx, g, W, H) {
  fillBg(ctx, d.bg, W, H);
  const m = d.main;
  const fn = fit('600 Montserrat|latin', 'Nice to', H * 1.6, H * 0.16);
  let x = H * 0.45;
  drawText(ctx, '600 Montserrat|latin', 'Nice to', fn, x + fn.w / 2, H * 0.52, { color: '#FFFFFF' });
  x += fn.w + H * 0.12;
  const f = fit(m.font, m.text, W * 0.3, H * 0.44);
  drawText(ctx, m.font, m.text, f, x + f.w / 2, H * 0.5, { color: '#FFFFFF' });
  x += f.w + H * 0.25;
  const bh = H * 0.26;
  ctx.fillStyle = '#B3D335';
  ctx.beginPath();
  ctx.roundRect(x, H * 0.5 - bh / 2, Math.max(H, W - x - H * 0.45), bh, bh / 2);
  ctx.fill();
}

function paintH(d, ctx, g, W, H) {
  if (d.layout === 'bands7') return paintBands7(d, ctx, g, W, H);
  if (d.layout === 'gg') return paintGG(d, ctx, g, W, H);
  if (d.layout === 'cu') return paintCU(d, ctx, g, W, H);
  const m = d.main;
  const layout = d.layout || 'center';
  fillBg(ctx, d.bg, W, H);
  const { R, bot } = markR(d, H);
  if (d.stripes) {
    let y = bot;
    for (const s of d.stripes) {
      ctx.fillStyle = s.c;
      ctx.fillRect(0, y, W, s.t * H + 0.6);
      y += s.t * H;
    }
  }
  let x0 = H * 0.35;
  let x1 = W - H * 0.35;
  const band = layout === 'band';
  const top = 0;
  if (band) {
    ctx.fillStyle = d.bg.c2 && d.bg.c2 !== d.bg.c1 ? d.bg.c2 : mix(d.bg.c1, '#000000', 0.35);
    ctx.fillRect(0, bot, W, H - bot);
  }
  const midY = (top + bot) / 2;
  const glowMark = d.glow === 'letters' && d.mark && d.mark.type !== 'seal';
  if (d.split) {
    const bw = H * d.split.k;
    ctx.fillStyle = d.split.c;
    ctx.fillRect(0, 0, bw, bot);
    if (d.mark) drawMark(ctx, d.mark, bw / 2, midY, bot * 0.34);
    x0 = bw + H * 0.3;
  } else if (d.mark) {
    drawMark(ctx, d.mark, x0 + R * 1.05, midY, R);
    if (glowMark) drawMark(g, d.mark, x0 + R * 1.05, midY, R, '#ffffff');
    x0 += R * 2.1 + H * 0.22;
  }
  if (d.floorTag) {
    const f = fit('900 Noto Sans KR', d.floorTag.text, H * 0.6, H * 0.32);
    drawText(ctx, '900 Noto Sans KR', d.floorTag.text, f, x0 + H * 0.3, midY, { color: d.floorTag.color, stroke: '#1A1A1A', strokeW: 0.1 });
    x0 += H * 0.75;
  }
  // Sub lines on the right.
  const subs = d.sub;
  if (subs.length && layout === 'right') {
    const subH = H * (subs.length > 1 ? 0.15 : 0.19);
    const fits = subs.map((s) => fit(s.font, s.text, (x1 - x0) * 0.42, subH));
    const subRightW = Math.max(...fits.map((f, i) => f.w + (subs[i].pill ? f.px * 0.9 : 0)));
    const gap = H * 0.1;
    const total = fits.length * subH + (fits.length - 1) * gap;
    fits.forEach((f, i) => subLine(ctx, g, d, subs[i], f, x1 - subRightW / 2, midY - total / 2 + subH / 2 + i * (subH + gap)));
    x1 -= subRightW + H * 0.3;
  }
  if (d.dot) x1 -= H * 0.2;
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
  const opt = { color: m.color, parts: m.parts, stroke: m.stroke, strokeW: m.strokeW, shadow: m.shadow, ret: m.ret, extrude: m.extrude, halo: m.halo };
  if (m.metal) opt.fillStyle = metalGrad(ctx, m.color, mainY - f.asc, mainY + f.desc);
  if (m.neon) {
    opt.fillStyle = mix(m.color, '#FFFFFF', 0.55);
    opt.glowColor = m.color;
    opt.stroke = m.color;
    opt.strokeW = 0.05;
  }
  drawText(ctx, m.font, m.text, f, cx, mainY, opt);
  if (d.dot) {
    ctx.fillStyle = d.dot;
    ctx.beginPath();
    ctx.arc(cx + f.w / 2 + H * 0.08, Math.max(H * 0.13, mainY - f.asc * 0.8), H * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  if (d.glow === 'letters') drawText(g, m.font, m.text, f, cx, mainY, { color: '#fff', stroke: m.neon ? '#fff' : null, strokeW: 0.08 });
  if (d.glow === 'halo') {
    // Back-lit letters: only the halo around them glows.
    drawText(g, m.font, m.text, f, cx, mainY, { color: '#fff', halo: '#fff' });
    drawText(g, m.font, m.text, f, cx, mainY, { color: '#000' });
  }
  if (hasBelow) {
    const s = subs[0];
    const subY = band ? (bot + H) / 2 : top + (bot - top) * 0.8;
    const subH = band ? (H - bot) * 0.55 : (bot - top) * 0.16;
    const fs = fit(s.font, s.text, band ? W - H * 0.6 : (x1 - x0) * 0.9, subH, (s.spacing || 0) * (subH / 100));
    const bandC = band ? (d.bg.c2 && d.bg.c2 !== d.bg.c1 ? d.bg.c2 : mix(d.bg.c1, '#000000', 0.35)) : null;
    const col = band ? (lum(bandC) > 0.55 ? '#111111' : '#FFFFFF') : s.color;
    subLine(ctx, g, d, { ...s, color: col, pill: band ? null : s.pill }, fs, band ? W / 2 : cx, subY);
  }
}

// ------------------------------------------------------------ vertical
function paintV(d, ctx, g, W, H) {
  const m = d.main;
  fillBg(ctx, d.bg.type === 'blocks' ? { type: 'solid', c1: d.bg.c1 } : d.bg, W, H);
  let y0 = W * 0.18;
  let y1 = H - W * 0.18;
  if (d.mark) {
    drawMark(ctx, d.mark, W / 2, y0 + W * 0.4, W * 0.36);
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
    let topY = y + W * 0.24 + tagH;
    if (t.glyph && ph > W * 3.2) {
      drawMark(ctx, { type: 'badge', glyph: t.glyph, bg: t.fg, fg: t.bg, ring: t.fg }, W / 2, topY + W * 0.32, W * 0.3);
      topY += W * 0.72;
    }
    const chars = [...t.text.replace(/\s+/g, '')];
    const bot = y + ph - W * 0.12;
    const cell = Math.min(W * 1.0, (bot - topY) / chars.length);
    const st = (topY + bot) / 2 - (cell * chars.length) / 2;
    chars.forEach((ch, i) => {
      const f = fit(t.font, ch, W * 0.78, Math.min(cell * 0.76, W * 0.72), 0, 0.7);
      drawText(ctx, t.font, ch, f, W / 2, st + cell * (i + 0.5), { color: t.fg });
    });
  });
}

// ------------------------------------------------------------ billboards
function drawProduct(ctx, kind, cx, cy, s, fg, bg) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = s * 0.08;
  ctx.shadowOffsetY = s * 0.03;
  const grad = (c, a, b) => {
    const gr = ctx.createLinearGradient(-s * 0.3, 0, s * 0.3, 0);
    gr.addColorStop(0, mix(c, '#000000', a));
    gr.addColorStop(0.45, mix(c, '#FFFFFF', b));
    gr.addColorStop(1, mix(c, '#000000', a));
    return gr;
  };
  if (kind === 'phone') {
    ctx.rotate(-0.12);
    ctx.fillStyle = '#18191B';
    ctx.beginPath();
    ctx.roundRect(-s * 0.22, -s * 0.44, s * 0.44, s * 0.88, s * 0.06);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    const sc = ctx.createLinearGradient(0, -s * 0.4, 0, s * 0.4);
    sc.addColorStop(0, '#5B8CFF');
    sc.addColorStop(0.5, '#B26BFF');
    sc.addColorStop(1, '#FF7AB6');
    ctx.fillStyle = sc;
    ctx.beginPath();
    ctx.roundRect(-s * 0.2, -s * 0.42, s * 0.4, s * 0.84, s * 0.05);
    ctx.fill();
    ctx.fillStyle = '#18191B';
    ctx.beginPath();
    ctx.arc(0, -s * 0.37, s * 0.015, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'cup') {
    ctx.fillStyle = grad('#FFFFFF', 0.12, 0.0);
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, -s * 0.3);
    ctx.lineTo(s * 0.22, -s * 0.3);
    ctx.lineTo(s * 0.16, s * 0.42);
    ctx.lineTo(-s * 0.16, s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(-s * 0.205, -s * 0.08);
    ctx.lineTo(s * 0.205, -s * 0.08);
    ctx.lineTo(s * 0.19, s * 0.14);
    ctx.lineTo(-s * 0.19, s * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#F2F2F2';
    ctx.beginPath();
    ctx.roundRect(-s * 0.25, -s * 0.37, s * 0.5, s * 0.08, s * 0.03);
    ctx.fill();
    ctx.fillStyle = '#E4E4E4';
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.37, s * 0.17, s * 0.06, 0, Math.PI, 0);
    ctx.fill();
  } else if (kind === 'bowl') {
    ctx.fillStyle = '#F6C343';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(-s * 0.18 + i * s * 0.06, -s * 0.02, s * 0.05, s * 0.09, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = grad('#D7191C', 0.25, 0.15);
    ctx.beginPath();
    ctx.moveTo(-s * 0.42, 0);
    ctx.lineTo(s * 0.42, 0);
    ctx.quadraticCurveTo(s * 0.38, s * 0.4, 0, s * 0.42);
    ctx.quadraticCurveTo(-s * 0.38, s * 0.4, -s * 0.42, 0);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#8B5A2B';
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(s * 0.05, -s * 0.05);
    ctx.lineTo(s * 0.42, -s * 0.42);
    ctx.moveTo(s * 0.12, -s * 0.03);
    ctx.lineTo(s * 0.48, -s * 0.36);
    ctx.stroke();
  } else if (kind === 'bottle') {
    ctx.fillStyle = grad('#2E8B57', 0.3, 0.25);
    ctx.beginPath();
    ctx.moveTo(-s * 0.06, -s * 0.46);
    ctx.lineTo(s * 0.06, -s * 0.46);
    ctx.lineTo(s * 0.06, -s * 0.26);
    ctx.quadraticCurveTo(s * 0.16, -s * 0.18, s * 0.16, -s * 0.06);
    ctx.lineTo(s * 0.16, s * 0.44);
    ctx.lineTo(-s * 0.16, s * 0.44);
    ctx.lineTo(-s * 0.16, -s * 0.06);
    ctx.quadraticCurveTo(-s * 0.16, -s * 0.18, -s * 0.06, -s * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#F4F4F4';
    ctx.fillRect(-s * 0.16, s * 0.02, s * 0.32, s * 0.2);
    ctx.fillStyle = bg;
    ctx.fillRect(-s * 0.16, s * 0.08, s * 0.32, s * 0.06);
    ctx.fillStyle = '#2B6E3F';
    ctx.fillRect(-s * 0.065, -s * 0.5, s * 0.13, s * 0.06);
  } else if (kind === 'tube') {
    ctx.rotate(0.25);
    ctx.fillStyle = grad('#F4F1EA', 0.12, 0.05);
    ctx.beginPath();
    ctx.roundRect(-s * 0.12, -s * 0.36, s * 0.24, s * 0.66, s * 0.04);
    ctx.fill();
    ctx.fillStyle = bg;
    ctx.fillRect(-s * 0.12, -s * 0.1, s * 0.24, s * 0.08);
    ctx.fillStyle = '#2B2B2B';
    ctx.beginPath();
    ctx.roundRect(-s * 0.09, s * 0.3, s * 0.18, s * 0.14, s * 0.02);
    ctx.fill();
  } else if (kind === 'box') {
    ctx.fillStyle = '#C69C6D';
    ctx.fillRect(-s * 0.36, -s * 0.22, s * 0.72, s * 0.5);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#A57A4C';
    ctx.beginPath();
    ctx.moveTo(-s * 0.36, -s * 0.22);
    ctx.lineTo(-s * 0.26, -s * 0.36);
    ctx.lineTo(s * 0.46, -s * 0.36);
    ctx.lineTo(s * 0.36, -s * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = bg;
    ctx.fillRect(-s * 0.05, -s * 0.22, s * 0.1, s * 0.5);
  } else if (kind === 'car') {
    ctx.fillStyle = '#FFD200';
    ctx.beginPath();
    ctx.roundRect(-s * 0.48, -s * 0.02, s * 0.96, s * 0.24, s * 0.06);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.28, -s * 0.02);
    ctx.lineTo(-s * 0.16, -s * 0.2);
    ctx.lineTo(s * 0.18, -s * 0.2);
    ctx.lineTo(s * 0.32, -s * 0.02);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#9FC6E0';
    ctx.fillRect(-s * 0.14, -s * 0.17, s * 0.13, s * 0.13);
    ctx.fillRect(s * 0.02, -s * 0.17, s * 0.13, s * 0.13);
    ctx.fillStyle = '#1A1A1A';
    for (const x of [-0.28, 0.28]) {
      ctx.beginPath();
      ctx.arc(x * s, s * 0.22, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-s * 0.07, -s * 0.28, s * 0.14, s * 0.07);
  } else if (kind === 'scooter') {
    ctx.strokeStyle = fg;
    ctx.lineWidth = s * 0.05;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(-s * 0.3, -s * 0.12, s * 0.42, s * 0.22, s * 0.08);
    ctx.fill();
    ctx.fillStyle = '#1A1A1A';
    for (const x of [-0.26, 0.3]) {
      ctx.beginPath();
      ctx.arc(x * s, s * 0.2, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(s * 0.12, s * 0.05);
    ctx.lineTo(s * 0.3, -s * 0.3);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-s * 0.36, -s * 0.36, s * 0.26, s * 0.22);
  } else {
    // Shopping bag.
    ctx.fillStyle = grad('#FFFFFF', 0.1, 0.0);
    ctx.fillRect(-s * 0.26, -s * 0.18, s * 0.52, s * 0.6);
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = bg;
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.arc(0, -s * 0.18, s * 0.13, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = bg;
    ctx.fillRect(-s * 0.26, s * 0.08, s * 0.52, s * 0.08);
  }
  ctx.restore();
}

function paintBoard(d, ctx, g, W, H) {
  fillBg(ctx, d.bg, W, H);
  // Soft light shapes behind the product.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#FFFFFF';
  for (const [x, y, r] of [[0.8, 0.5, 0.5], [0.95, 0.1, 0.25]]) {
    ctx.beginPath();
    ctx.arc(W * x, H * y, H * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  drawProduct(ctx, d.product, W * 0.8, H * 0.52, H * 0.85, d.main.color, mix(d.bg.c1, '#000000', 0.25));
  const m = d.main;
  const f = fit(m.font, m.text, W * 0.6, H * 0.24);
  drawText(ctx, m.font, m.text, f, W * 0.34, H * 0.36, { color: m.color, shadow: true });
  const s = d.sub[0];
  const fs = fit(s.font, s.text, W * 0.4, H * 0.2);
  drawText(ctx, s.font, s.text, fs, W * 0.34, H * 0.7, { color: s.color });
  ctx.fillStyle = mix(m.color, d.bg.c1, 0.4);
  ctx.fillRect(W * 0.34 - fs.w * 0.6, H * 0.84, fs.w * 1.2, Math.max(1, H * 0.012));
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

// ------------------------------------------------------------ shop-front extras
function paintDecal(d, ctx, g, W, H) {
  if (d.led) {
    // LED open sign: tube border and letters, both lit.
    const L = d.led;
    const bw = W * 0.62;
    const bh = H * 0.72;
    for (const [c, col] of [[ctx, null], [g, '#ffffff']]) {
      c.save();
      c.lineWidth = H * 0.07;
      c.strokeStyle = col || mix(L.ring, '#FFFFFF', 0.4);
      if (!col) {
        c.shadowColor = L.ring;
        c.shadowBlur = H * 0.12;
      }
      c.beginPath();
      c.roundRect((W - bw) / 2, (H - bh) / 2, bw, bh, bh * 0.3);
      c.stroke();
      c.restore();
      const f = fit('800 Montserrat|latin', L.text, bw * 0.78, bh * 0.5);
      drawText(c, '800 Montserrat|latin', L.text, f, W / 2, H / 2, col ? { color: col } : { color: mix(L.color, '#FFFFFF', 0.5), glowColor: L.color, stroke: L.color, strokeW: 0.06 });
    }
    return;
  }
  const m = d.main;
  let x0 = W * 0.06;
  const x1 = W * 0.94;
  if (d.mark) {
    drawMark(ctx, d.mark, x0 + H * 0.3, H * 0.4, H * 0.24);
    x0 += H * 0.62;
  }
  const f = fit(m.font, m.text, x1 - x0, H * 0.4);
  drawText(ctx, m.font, m.text, f, (x0 + x1) / 2, H * 0.36, { color: m.color });
  if (d.rule) {
    ctx.fillStyle = m.color;
    ctx.fillRect((x0 + x1) / 2 - f.w / 2, H * 0.62, f.w, Math.max(1.2, H * 0.025));
  }
  const s = d.sub[0];
  const fs = fit(s.font, s.text, (x1 - x0) * 0.95, H * 0.18);
  drawText(ctx, s.font, s.text, fs, (x0 + x1) / 2, H * 0.79, { color: s.color });
}

function paintStand(d, ctx, g, W, H) {
  fillBg(ctx, d.bg, W, H);
  const pad = W * 0.08;
  if (d.chalk) {
    // Chalk dust and a hand-lettered menu.
    const r = prng(W * 5 + H);
    for (let i = 0; i < W * H * 0.02; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.05})`;
      ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1);
    }
    const m = d.main;
    drawText(ctx, m.font, m.text, fit(m.font, m.text, W - pad * 2, H * 0.11), W / 2, H * 0.12, { color: m.color });
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(pad, H * 0.21, W - pad * 2, Math.max(1, H * 0.006));
  } else {
    // Light box: coloured header with the mark and title.
    ctx.fillStyle = d.acc;
    ctx.fillRect(0, 0, W, H * 0.24);
    if (d.mark) drawMark(ctx, d.mark, W / 2, H * 0.36, W * 0.17);
    const m = d.main;
    drawText(ctx, m.font, m.text, fit(m.font, m.text, W - pad * 2, H * 0.1), W / 2, H * 0.12, { color: lum(d.acc) > 0.55 ? '#111111' : '#FFFFFF' });
  }
  const y0 = d.chalk ? H * 0.3 : H * 0.5;
  const rowH = Math.min(H * 0.11, (H * 0.92 - y0) / d.items.length);
  d.items.forEach((it, i) => {
    const y = y0 + rowH * (i + 0.5);
    const fn = fit(it.font, it.n, W * 0.5, rowH * 0.5);
    const fp = fit(it.font, it.p, W * 0.32, rowH * 0.45);
    drawText(ctx, it.font, it.n, fn, pad + fn.w / 2, y, { color: it.color });
    drawText(ctx, it.font, it.p, fp, W - pad - fp.w / 2, y, { color: it.color });
  });
}

// Awning tile: rows [0, 0.7) slope, [0.7, 1] valance with its edge.
function paintAwning(d, ctx, g, W, H) {
  const n = 4;
  const sw = W / n;
  const yv = H * 0.7;
  const stripes = (y0, y1, shade) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = mix(d.stripes2 ? d.stripes2[i % 2] : d.c1, '#000000', shade);
      ctx.fillRect(i * sw, y0, sw + 0.5, y1 - y0);
    }
  };
  // Slope: fabric gets a little darker towards the front edge.
  for (let k = 0; k < 6; k++) stripes((yv * k) / 6, (yv * (k + 1)) / 6 + 0.5, k * 0.012);
  // Valance shape, clipped.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, yv);
  ctx.lineTo(W, yv);
  const eb = H * 0.9;
  if (d.edge === 'scallop') {
    ctx.lineTo(W, eb);
    for (let i = n - 1; i >= 0; i--) ctx.ellipse(i * sw + sw / 2, eb, sw / 2, H - eb - 1, 0, 0, Math.PI);
  } else if (d.edge === 'zigzag') {
    ctx.lineTo(W, eb);
    for (let i = n - 1; i >= 0; i--) {
      ctx.lineTo(i * sw + sw / 2, H - 1);
      ctx.lineTo(i * sw, eb);
    }
  } else {
    ctx.lineTo(W, H - 1);
    ctx.lineTo(0, H - 1);
  }
  ctx.closePath();
  ctx.clip();
  stripes(yv, H, 0.05);
  if (d.trim) {
    ctx.fillStyle = d.trim;
    ctx.fillRect(0, yv + (H - yv) * 0.55, W, Math.max(1.5, H * 0.03));
  }
  ctx.restore();
  // Seam between slope and valance.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, yv - 1, W, 2);
}

// Window band tile: [logo] name  [icon] goods, evenly spaced so it repeats.
function paintBand(d, ctx, g, W, H) {
  const b = d.band;
  ctx.fillStyle = b.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#C9C9C4';
  ctx.fillRect(0, 0, W, Math.max(1, H * 0.05));
  ctx.fillRect(0, H - Math.max(1, H * 0.05), W, Math.max(1, H * 0.05));
  const half = W / 2;
  const R = H * 0.32;
  drawMark(ctx, b.mark.type === 'six' ? { ...b.mark } : b.mark, half * 0.12 + R, H / 2, R);
  const fn = fit('900 Noto Sans KR', b.name, half * 0.6, H * 0.46);
  drawText(ctx, '900 Noto Sans KR', b.name, fn, half * 0.12 + R * 2.4 + fn.w / 2, H / 2, { color: b.ink });
  glyph(ctx, b.glyph, half + half * 0.1 + R, H / 2, R * 1.6, b.ink);
  const fg = fit('700 Noto Sans KR', b.goods, half * 0.62, H * 0.42);
  drawText(ctx, '700 Noto Sans KR', b.goods, fg, half + half * 0.1 + R * 2.3 + fg.w / 2, H / 2, { color: b.ink });
}

// Rooftop church cross: red neon tubes on a cut-out frame.
function paintCross(d, ctx, g, W, H) {
  const bw = W * 0.2;
  const barH = bw;
  ctx.fillStyle = '#B5121B';
  ctx.fillRect(W / 2 - bw / 2, H * 0.01, bw, H * 0.98);
  ctx.fillRect(W * 0.03, H * 0.24, W * 0.94, barH);
  ctx.fillStyle = '#FF5A5A';
  ctx.fillRect(W / 2 - bw * 0.16, H * 0.03, bw * 0.32, H * 0.94);
  ctx.fillRect(W * 0.05, H * 0.24 + barH * 0.34, W * 0.9, barH * 0.32);
  g.fillStyle = '#ffffff';
  g.fillRect(W / 2 - bw / 2, H * 0.01, bw, H * 0.98);
  g.fillRect(W * 0.03, H * 0.24, W * 0.94, barH);
}

function paintDisc(d, ctx, g, W, H) {
  const R = Math.min(W, H) / 2 - 1;
  drawMark(ctx, d.mark, W / 2, H / 2, R);
}

// ------------------------------------------------------------ pipeline
const FULL = new Set(['vflex', 'stack', 'board', 'banner', 'exit', 'decal', 'stand', 'awning', 'disc', 'band', 'cross']);
function sizeOf(d) {
  const D = DENSITY[d.kind] * (d._scale || 1) * (d.dens || 1);
  const H = Math.max(8, Math.round(d.h * D));
  const full = Math.max(8, Math.round(d.w * D));
  if (FULL.has(d.style) || d.full) return { W: full, H, D };
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

const PAINT = { vflex: paintV, stack: paintStack, board: paintBoard, banner: paintBanner, exit: paintExit, decal: paintDecal, stand: paintStand, awning: paintAwning, disc: paintDisc, band: paintBand, cross: paintCross };

async function loadFonts(designs) {
  // Load every font subset the designs need.
  const need = new Map();
  const add = (spec, text) => { if (spec && text) need.set(spec, (need.get(spec) || '') + text); };
  const emo = (gl) => { if (gl) need.set('EMOJI', (need.get('EMOJI') || '') + gl); };
  const addMark = (mk) => {
    if (!mk) return;
    emo(mk.glyph);
    if (mk.letter) add(mk.font || '900 Noto Sans KR', mk.letter);
    if (mk.type === 'seal') add('900 Noto Serif TC|zhT', mk.text);
    if (mk.type === 'numeral') add('Archivo Black|latin', mk.text);
    if (mk.type === 'six') add('Archivo Black|latin', '6' + mk.text);
    if (mk.ringText || mk.ringText2) add('800 Montserrat|latin', (mk.ringText || '') + (mk.ringText2 || ''));
  };
  for (const d of designs) {
    add(d.main?.font, d.main?.text);
    if (d.style === 'exit') { add('900 Noto Sans KR', d.no); add('700 Noto Sans KR', '출구홍대입구역'); add('500 Montserrat', 'Exit'); }
    d.sub.forEach((s) => add(s.font, s.text + '☎ '));
    d.tenants?.forEach((t) => { add(t.font, t.text); add('900 Noto Sans KR', t.floor); emo(t.glyph); });
    d.items?.forEach((it) => add(it.font, it.n + it.p));
    if (d.led) add('800 Montserrat|latin', d.led.text);
    if (d.layout === 'gg') { add('600 Montserrat|latin', 'Lifestyle Platform'); add('700 Noto Sans KR|ko', '홍대점'); }
    if (d.layout === 'cu') add('600 Montserrat|latin', 'Nice to');
    if (d.band) { add('900 Noto Sans KR', d.band.name); add('700 Noto Sans KR', d.band.goods); emo(d.band.glyph); addMark(d.band.mark); }
    if (d.floorTag) add('900 Noto Sans KR', d.floorTag.text);
    addMark(d.mark);
  }
  add('Do Hyeon', '가나다ABC0123');
  add('900 Noto Sans KR', '0123456789F-☎');
  await Promise.all([...need].map(([spec, text]) => {
    const uniq = [...new Set([...text])].join('');
    return spec === 'EMOJI' ? document.fonts.load(`40px "${EMOJI}"`, uniq) : document.fonts.load(fontStr(spec, 40), uniq);
  }));
  await document.fonts.ready;

}

window.signgen = async (reqs, maxPages) => {
  const designs = reqs.map((r, i) => withFallbacks(makeDesign(r, i)));
  await loadFonts(designs);

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
    try {
      (PAINT[d.style] || paintH)(d, ctx, g, W, H);
    } catch (e) {
      throw new Error(`sign ${i} (${d.kind}/${d.style} ${d.text}): ${e.message}\n${JSON.stringify(d).slice(0, 600)}`);
    }
    const img = encodeSign(ctx, g, W, H);
    const p = packed.pos[i];
    blit(pages[p.page], img, W, H, p.x, p.y);
    meta.push({
      t: d.text || '',
      st: d.style,
      l: p.page,
      // u0, v_bottom, u1, v_top (v = 0 is the first image row).
      r: [p.x / S, (p.y + H) / S, (p.x + W) / S, p.y / S].map((v) => +v.toFixed(6)),
      // Artwork width in metres; negative = horizontal tile period (awnings).
      iw: +((d.style === 'awning' || d.tile ? -1 : 1) * (W / D)).toFixed(3),
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

// Preview: paint designs onto a contact sheet over a wall colour so cut-out
// styles read as they do on a building (tools/signgen/preview.mjs).
window.signSheet = async (reqs, cols = 3, px = 90) => {
  const designs = reqs.map((r) => withFallbacks(makeDesign(r, r.i ?? 0)));
  await loadFonts(designs);
  const tiles = designs.map((d) => {
    d._scale = px / DENSITY[d.kind];
    const { W, H } = sizeOf(d);
    const cv = document.createElement('canvas');
    const gv = document.createElement('canvas');
    cv.width = gv.width = W;
    cv.height = gv.height = H;
    const ctx = cv.getContext('2d');
    const g = gv.getContext('2d');
    g.fillStyle = d.glow === 'face' ? '#ffffff' : '#000000';
    g.fillRect(0, 0, W, H);
    (PAINT[d.style] || paintH)(d, ctx, g, W, H);
    return { cv, W, H, d };
  });
  const cellW = Math.max(...tiles.map((t) => t.W)) + 24;
  const rows = Math.ceil(tiles.length / cols);
  const rowH = [];
  for (let r = 0; r < rows; r++) rowH.push(Math.max(...tiles.slice(r * cols, r * cols + cols).map((t) => t.H)) + 40);
  const out = document.createElement('canvas');
  out.width = cellW * cols;
  out.height = rowH.reduce((a, b) => a + b, 0);
  const o = out.getContext('2d');
  o.fillStyle = '#6E6A64';
  o.fillRect(0, 0, out.width, out.height);
  let y = 0;
  tiles.forEach((t, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    if (c === 0 && r > 0) y += rowH[r - 1];
    o.drawImage(t.cv, c * cellW + 12, y + 8);
    o.fillStyle = '#F0F0F0';
    o.font = '12px sans-serif';
    o.fillText(`${t.d.kind}/${t.d.style}  ${t.d.text || ''}`.slice(0, 60), c * cellW + 12, y + t.H + 26);
  });
  return out.toDataURL('image/png');
};
window.signgenReady = true;
