// Baking helpers: a BVH for ray casts (ambient occlusion per vertex) and
// UV-space rasterisation with seam dilation (texture painting).

/** Bounding volume hierarchy over triangles. pos: flat xyz, tri: flat vertex indices. */
export function buildBVH(pos, tri) {
  const n = tri.length / 3;
  const cen = new Float32Array(n * 3);
  const bmin = new Float32Array(n * 3);
  const bmax = new Float32Array(n * 3);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      let lo = Infinity, hi = -Infinity;
      for (let c = 0; c < 3; c++) {
        const v = pos[tri[t * 3 + c] * 3 + k];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      bmin[t * 3 + k] = lo;
      bmax[t * 3 + k] = hi;
      cen[t * 3 + k] = (lo + hi) / 2;
    }
  }
  const order = new Uint32Array(n).map((_, i) => i);
  const nodes = []; // [minx,miny,minz,maxx,maxy,maxz, left, right, start, count]
  const build = (s, e) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], bmin[t * 3 + k]);
        hi[k] = Math.max(hi[k], bmax[t * 3 + k]);
      }
    }
    const id = nodes.length;
    nodes.push([...lo, ...hi, -1, -1, s, e - s]);
    if (e - s <= 4) return id;
    const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const ax = ext[0] > ext[1] && ext[0] > ext[2] ? 0 : ext[1] > ext[2] ? 1 : 2;
    const sub = Array.from(order.subarray(s, e)).sort((a, b) => cen[a * 3 + ax] - cen[b * 3 + ax]);
    order.set(sub, s);
    const m = (s + e) >> 1;
    const l = build(s, m);
    const r = build(m, e);
    nodes[id][6] = l;
    nodes[id][7] = r;
    nodes[id][9] = 0;
    return id;
  };
  build(0, n);
  return { pos, tri, order, nodes };
}

function hitBox(nd, o, inv, tmax) {
  let t0 = 0, t1 = tmax;
  for (let k = 0; k < 3; k++) {
    let a = (nd[k] - o[k]) * inv[k];
    let b = (nd[k + 3] - o[k]) * inv[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

/** Does a ray from o along d hit any triangle closer than tmax? */
export function occluded(bvh, o, d, tmax) {
  const { pos, tri, order, nodes } = bvh;
  const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
  const stack = [0];
  while (stack.length) {
    const nd = nodes[stack.pop()];
    if (!hitBox(nd, o, inv, tmax)) continue;
    if (nd[9] > 0) {
      for (let i = nd[8]; i < nd[8] + nd[9]; i++) {
        const t = order[i];
        const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
        const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
        const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const id = 1 / det;
        const tx = o[0] - pos[a], ty = o[1] - pos[a + 1], tz = o[2] - pos[a + 2];
        const u = (tx * px + ty * py + tz * pz) * id;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * id;
        if (v < 0 || u + v > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * id;
        if (tt > 1e-4 && tt < tmax) return true;
      }
    } else stack.push(nd[6], nd[7]);
  }
  return false;
}

/** Ambient occlusion per point: fraction of cosine-weighted hemisphere rays that escape. */
export function bakeAO(bvh, points, normals, rays = 40, dist = 0.25) {
  const out = new Float32Array(points.length);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < points.length; i++) {
    const n = normals[i];
    // Tangent frame.
    const t = Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [0, -n[2], n[1]];
    const tl = Math.hypot(t[0], t[1], t[2]) || 1;
    t[0] /= tl; t[1] /= tl; t[2] /= tl;
    const b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const o = [points[i][0] + n[0] * 0.0015, points[i][1] + n[1] * 0.0015, points[i][2] + n[2] * 0.0015];
    let open = 0;
    for (let r = 0; r < rays; r++) {
      const u1 = (r + rnd()) / rays;
      const u2 = rnd();
      const rr = Math.sqrt(u1);
      const ph = 2 * Math.PI * u2;
      const x = rr * Math.cos(ph), y = rr * Math.sin(ph), z = Math.sqrt(Math.max(0, 1 - u1));
      const d = [t[0] * x + b[0] * y + n[0] * z, t[1] * x + b[1] * y + n[1] * z, t[2] * x + b[2] * y + n[2] * z];
      if (!occluded(bvh, o, d, dist)) open++;
    }
    out[i] = open / rays;
  }
  return out;
}

/**
 * Rasterise triangles in UV space. uv: flat per-corner uv (6 per triangle).
 * fn(texel, face, b0, b1, b2) is called for every texel centre inside a triangle.
 */
export function rasterUV(nFaces, uv, size, fn) {
  const covered = new Uint8Array(size * size);
  for (let f = 0; f < nFaces; f++) {
    const x0 = uv[f * 6] * size, y0 = uv[f * 6 + 1] * size;
    const x1 = uv[f * 6 + 2] * size, y1 = uv[f * 6 + 3] * size;
    const x2 = uv[f * 6 + 4] * size, y2 = uv[f * 6 + 5] * size;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const b1 = ((px - x0) * (y2 - y0) - (x2 - x0) * (py - y0)) / area;
        const b2 = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) / area;
        const b0 = 1 - b1 - b2;
        if (b0 < -1e-4 || b1 < -1e-4 || b2 < -1e-4) continue;
        const ti = y * size + x;
        covered[ti] = 1;
        fn(ti, f, b0, b1, b2);
      }
    }
  }
  return covered;
}

/** Grow painted texels into empty ones so filtering and mips do not pull in the background at seams. */
export function dilate(rgba, covered, size, steps = 8) {
  let cov = covered.slice();
  for (let s = 0; s < steps; s++) {
    const next = cov.slice();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (cov[i]) continue;
        let n = 0;
        const acc = [0, 0, 0, 0];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const j = yy * size + xx;
          if (!cov[j]) continue;
          for (let k = 0; k < 4; k++) acc[k] += rgba[j * 4 + k];
          n++;
        }
        if (!n) continue;
        for (let k = 0; k < 4; k++) rgba[i * 4 + k] = Math.round(acc[k] / n);
        next[i] = 1;
      }
    }
    cov = next;
  }
}
