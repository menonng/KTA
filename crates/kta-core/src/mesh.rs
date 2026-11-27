//! Procedural mesh generation from the compact tile.
//!
//! Buildings: extruded footprints split into ground chunks so the renderer can
//! frustum-cull per chunk. Vertex = 12 B position + 3 B normal + 8 B facade
//! attributes; the facade (windows, shopfronts, colors) is drawn by the shader,
//! so buildings need no textures at all.

use crate::data::{road, MapData, ONEWAY};
use crate::geom::{triangulate, P2};
use std::collections::HashMap;

pub const ROOF_FLAG: u16 = 1 << 4;

#[derive(Default, Clone)]
pub struct MeshBuf {
    pub pos: Vec<f32>,
    pub nrm: Vec<i8>,
    /// Per vertex: u (cm along facade), v (cm up / roof coord), seed, kindflags.
    pub attr: Vec<u16>,
    pub idx: Vec<u16>,
    /// Bounding sphere: cx, cy, cz, r.
    pub bounds: [f32; 4],
    pub buildings: u32,
}

impl MeshBuf {
    fn vcount(&self) -> usize {
        self.pos.len() / 3
    }
    fn push(&mut self, p: [f32; 3], n: [i8; 3], a: [u16; 4]) -> u16 {
        let i = self.vcount() as u16;
        self.pos.extend_from_slice(&p);
        self.nrm.extend_from_slice(&n);
        self.attr.extend_from_slice(&a);
        i
    }
    fn finish_bounds(&mut self) {
        if self.pos.is_empty() {
            return;
        }
        let mut mn = [f32::MAX; 3];
        let mut mx = [f32::MIN; 3];
        for v in self.pos.chunks(3) {
            for k in 0..3 {
                mn[k] = mn[k].min(v[k]);
                mx[k] = mx[k].max(v[k]);
            }
        }
        let c = [(mn[0] + mx[0]) * 0.5, (mn[1] + mx[1]) * 0.5, (mn[2] + mx[2]) * 0.5];
        let mut r2: f32 = 0.0;
        for v in self.pos.chunks(3) {
            let d = (v[0] - c[0]).powi(2) + (v[1] - c[1]).powi(2) + (v[2] - c[2]).powi(2);
            r2 = r2.max(d);
        }
        self.bounds = [c[0], c[1], c[2], r2.sqrt()];
    }
}

/// Pack kind (4 bits), roof flag (1 bit) and height in 0.5 m (11 bits).
pub fn kindflags(kind: u8, roof: bool, height: f32) -> u16 {
    let h = ((height * 2.0).round() as u32).min(2047) as u16;
    (kind as u16 & 0xF) | if roof { ROOF_FLAG } else { 0 } | (h << 5)
}

fn cm(v: f32) -> u16 {
    (v * 100.0).round().clamp(0.0, 65535.0) as u16
}

fn wrap_cm(v: f32) -> u16 {
    ((v * 100.0).round() as i64).rem_euclid(65536) as u16
}

pub fn build_chunks(m: &MapData, cell: f32) -> Vec<MeshBuf> {
    let mut map: HashMap<(i32, i32), Vec<MeshBuf>> = HashMap::new();
    let mut tri = Vec::new();
    for b in &m.buildings {
        let p = &b.pts;
        let n = p.len();
        if n < 3 {
            continue;
        }
        let h = b.height.max(3.0);
        let c = crate::geom::centroid(p);
        let key = ((c[0] / cell).floor() as i32, (c[1] / cell).floor() as i32);
        let need = n * 4 + n;
        let list = map.entry(key).or_default();
        if list.last().map_or(true, |mb| mb.vcount() + need > 65000) {
            list.push(MeshBuf::default());
        }
        let mb = list.last_mut().unwrap();
        mb.buildings += 1;
        let kf_wall = kindflags(b.kind, false, h);
        let kf_roof = kindflags(b.kind, true, h);
        let seed = b.seed;

        // Walls
        let mut u = 0.0f32;
        for i in 0..n {
            let a = p[i];
            let bb = p[(i + 1) % n];
            let d = [bb[0] - a[0], bb[1] - a[1]];
            let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
            if len < 1e-3 {
                continue;
            }
            let nx = d[1] / len;
            let nz = -d[0] / len;
            let nn = [(nx * 127.0) as i8, 0, (nz * 127.0) as i8];
            let u0 = cm(u);
            let u1 = cm(u + len);
            let hv = cm(h);
            let b0 = mb.push([a[0], 0.0, a[1]], nn, [u0, 0, seed, kf_wall]);
            let t0 = mb.push([a[0], h, a[1]], nn, [u0, hv, seed, kf_wall]);
            let t1 = mb.push([bb[0], h, bb[1]], nn, [u1, hv, seed, kf_wall]);
            let b1 = mb.push([bb[0], 0.0, bb[1]], nn, [u1, 0, seed, kf_wall]);
            mb.idx.extend_from_slice(&[b0, t0, t1, b0, t1, b1]);
            u += len;
        }

        // Roof (flat)
        let base = mb.vcount() as u16;
        for v in p {
            mb.push([v[0], h, v[1]], [0, 127, 0], [wrap_cm(v[0]), wrap_cm(v[1]), seed, kf_roof]);
        }
        tri.clear();
        triangulate(p, &mut tri);
        for t in tri.chunks(3) {
            // CCW in (x,z) math => flip to face +y.
            mb.idx.extend_from_slice(&[base + t[0] as u16, base + t[2] as u16, base + t[1] as u16]);
        }
    }
    let mut out: Vec<MeshBuf> = map.into_values().flatten().collect();
    for mb in &mut out {
        mb.finish_bounds();
    }
    // Deterministic order (by bounds) for stable draw order.
    out.sort_by(|a, b| {
        a.bounds[0]
            .partial_cmp(&b.bounds[0])
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.bounds[2].partial_cmp(&b.bounds[2]).unwrap_or(std::cmp::Ordering::Equal))
    });
    out
}

#[derive(Default)]
pub struct RoadBuf {
    pub pos: Vec<f32>,
    /// Per vertex: along (m), across (m), kind, half width (m).
    pub attr: Vec<f32>,
    pub idx: Vec<u32>,
}

pub const SIDEWALK: u8 = 9;

fn road_y(kind: u8) -> f32 {
    match kind {
        road::PRIMARY => 0.080,
        road::SECONDARY => 0.072,
        road::LINK => 0.068,
        road::TERTIARY => 0.064,
        road::PEDESTRIAN => 0.058,
        road::RESIDENTIAL => 0.054,
        road::SERVICE => 0.050,
        road::FOOTWAY => 0.046,
        _ => 0.030,
    }
}

/// Ribbon between two signed offsets along the left normal (left > right).
fn ribbon(rb: &mut RoadBuf, pts: &[P2], left: f32, right: f32, y: f32, kind_attr: f32, half: f32) {
    let n = pts.len();
    if n < 2 {
        return;
    }
    let base = (rb.pos.len() / 3) as u32;
    let mut along = 0.0f32;
    let seg = |a: P2, b: P2| {
        let d = [b[0] - a[0], b[1] - a[1]];
        let l = (d[0] * d[0] + d[1] * d[1]).sqrt().max(1e-6);
        [d[0] / l, d[1] / l]
    };
    for i in 0..n {
        let t_in = if i > 0 { Some(seg(pts[i - 1], pts[i])) } else { None };
        let t_out = if i + 1 < n { Some(seg(pts[i], pts[i + 1])) } else { None };
        let t = match (t_in, t_out) {
            (Some(a), Some(b)) => {
                let s = [a[0] + b[0], a[1] + b[1]];
                let l = (s[0] * s[0] + s[1] * s[1]).sqrt();
                if l < 1e-4 { b } else { [s[0] / l, s[1] / l] }
            }
            (Some(a), None) => a,
            (None, Some(b)) => b,
            _ => [1.0, 0.0],
        };
        let nrm = [t[1], -t[0]];
        let ref_t = t_out.or(t_in).unwrap();
        let ref_n = [ref_t[1], -ref_t[0]];
        let k = 1.0 / (nrm[0] * ref_n[0] + nrm[1] * ref_n[1]).abs().max(0.5);
        if i > 0 {
            along += crate::geom::dist2(pts[i - 1], pts[i]).sqrt();
        }
        let p = pts[i];
        rb.pos.extend_from_slice(&[p[0] + nrm[0] * left * k, y, p[1] + nrm[1] * left * k]);
        rb.attr.extend_from_slice(&[along, left, kind_attr, half]);
        rb.pos.extend_from_slice(&[p[0] + nrm[0] * right * k, y, p[1] + nrm[1] * right * k]);
        rb.attr.extend_from_slice(&[along, right, kind_attr, half]);
    }
    for i in 0..(n as u32 - 1) {
        let l0 = base + i * 2;
        let r0 = l0 + 1;
        let l1 = l0 + 2;
        let r1 = l0 + 3;
        let pa = [rb.pos[(l0 * 3) as usize], rb.pos[(l0 * 3 + 2) as usize]];
        let pb = [rb.pos[(r0 * 3) as usize], rb.pos[(r0 * 3 + 2) as usize]];
        let pc = [rb.pos[(l1 * 3) as usize], rb.pos[(l1 * 3 + 2) as usize]];
        let cr = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
        if cr < 0.0 {
            rb.idx.extend_from_slice(&[l0, r0, l1, r0, r1, l1]);
        } else {
            rb.idx.extend_from_slice(&[l0, l1, r0, r0, l1, r1]);
        }
    }
}

pub fn build_roads(m: &MapData) -> RoadBuf {
    let mut rb = RoadBuf::default();
    // Sidewalks first (under roads). One-way carriageways get a sidewalk on
    // the right-hand side of travel only, so dual carriageways keep a median.
    for (i, r) in m.roads.iter().enumerate() {
        let base = r.kind & !ONEWAY;
        let oneway = r.kind & ONEWAY != 0;
        let sw = match base {
            road::PRIMARY => 4.0,
            road::SECONDARY => 3.2,
            road::TERTIARY => 2.6,
            _ => 0.0,
        };
        if sw > 0.0 {
            let eps = (i % 8) as f32 * 0.0006;
            let h = r.width * 0.5;
            let left = if oneway { -h + 0.4 } else { h + sw };
            ribbon(&mut rb, &r.pts, left, -(h + sw), 0.026 + eps, SIDEWALK as f32, h + sw);
        }
    }
    for (i, r) in m.roads.iter().enumerate() {
        let base = r.kind & !ONEWAY;
        let oneway = r.kind & ONEWAY != 0;
        let eps = (i % 16) as f32 * 0.0004;
        let h = r.width * 0.5;
        let kind_attr = base as f32 + if oneway { 16.0 } else { 0.0 };
        ribbon(&mut rb, &r.pts, h, -h, road_y(base) + eps, kind_attr, h);
    }
    rb
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::Building;

    #[test]
    fn box_building_has_outward_walls_and_up_roof() {
        let mut pts = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        crate::geom::clean_polygon(&mut pts, 0.1);
        let m = MapData {
            buildings: vec![Building { pts, height: 9.0, levels: 3, kind: 2, seed: 1 }],
            ..Default::default()
        };
        let ch = build_chunks(&m, 100.0);
        assert_eq!(ch.len(), 1);
        let mb = &ch[0];
        assert_eq!(mb.vcount(), 4 * 4 + 4);
        assert_eq!(mb.idx.len(), 4 * 6 + 2 * 3);
        // Check every triangle's geometric normal agrees with its vertex normal.
        for t in mb.idx.chunks(3) {
            let v = |i: u16| {
                let i = i as usize * 3;
                [mb.pos[i], mb.pos[i + 1], mb.pos[i + 2]]
            };
            let (a, b, c) = (v(t[0]), v(t[1]), v(t[2]));
            let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
            let ni = t[0] as usize * 3;
            let n = [mb.nrm[ni] as f32, mb.nrm[ni + 1] as f32, mb.nrm[ni + 2] as f32];
            assert!(g[0] * n[0] + g[1] * n[1] + g[2] * n[2] > 0.0);
        }
    }
}
