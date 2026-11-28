//! Raised pavements (보도) with granite kerbs (화강석 경계석) along the main
//! roads. Each pavement is cut back where another carriageway crosses it (so
//! junction corners get a kerb line of their own), and the kerb is lowered to
//! a ramp at both ends of every crosswalk (보도 턱낮춤). The same shapes answer
//! "how high is the ground here" for the player and pedestrians.
//!
//! Plain stretches stay one quad per polyline segment; only quads touched by
//! another carriageway or a ramp are split into ~1 m cells and clipped.

use crate::data::{road, MapData, ONEWAY};
use crate::geom::{closest_on_segment, dist2, point_in_polygon, P2};
use crate::mesh::RoadBuf;
use std::collections::HashMap;

/// Kerb height above the carriageway (서울 보도 경계석 노출 높이 약 15 cm).
pub const KERB_H: f32 = 0.15;
/// Road-mesh kind ids beyond the road classes.
pub const SIDEWALK: u8 = crate::mesh::SIDEWALK;
pub const KERB: u8 = 11;
pub const SKIRT: u8 = 12;

/// Pavement width per road class (one side).
pub fn pavement_width(kind: u8) -> f32 {
    match kind & !ONEWAY {
        road::PRIMARY => 4.0,
        road::SECONDARY => 3.2,
        road::TERTIARY => 2.6,
        _ => 0.0,
    }
}

const GC: f32 = 8.0;

fn key(p: P2) -> (i32, i32) {
    ((p[0] / GC).floor() as i32, (p[1] / GC).floor() as i32)
}

fn insert_box(grid: &mut HashMap<(i32, i32), Vec<u32>>, lo: P2, hi: P2, id: u32) {
    let (x0, z0) = key(lo);
    let (x1, z1) = key(hi);
    for z in z0..=z1 {
        for x in x0..=x1 {
            grid.entry((x, z)).or_default().push(id);
        }
    }
}

fn bbox(poly: &[P2]) -> (P2, P2) {
    let mut lo = [f32::MAX; 2];
    let mut hi = [f32::MIN; 2];
    for p in poly {
        lo = [lo[0].min(p[0]), lo[1].min(p[1])];
        hi = [hi[0].max(p[0]), hi[1].max(p[1])];
    }
    (lo, hi)
}

/// Lowered kerb at one end of a crosswalk.
struct Ramp {
    c: P2,
    /// Across the road (crosswalk walking direction).
    ax: P2,
    /// Along the road.
    az: P2,
    half_w: f32,
    half_l: f32,
}

impl Ramp {
    /// How far the pavement surface is lowered at p.
    fn drop(&self, p: P2) -> f32 {
        let d = [p[0] - self.c[0], p[1] - self.c[1]];
        let x = (d[0] * self.ax[0] + d[1] * self.ax[1]).abs();
        let z = (d[0] * self.az[0] + d[1] * self.az[1]).abs();
        let e = x - self.half_w;
        if !(-0.6..=1.8).contains(&e) || z > self.half_l + 1.2 {
            return 0.0;
        }
        // 1.6 m ramp (about 1:12) from 2 cm at the kerb line to full height.
        let t = (e / 1.6).clamp(0.0, 1.0);
        let s = 1.0 - ((z - self.half_l) / 1.2).clamp(0.0, 1.0);
        let s = s * s * (3.0 - 2.0 * s);
        (KERB_H - 0.02) * (1.0 - t) * s
    }
}

pub struct Ground {
    polys: Vec<Vec<P2>>,
    /// Surface height per polygon (pavements KERB_H, bus platforms higher).
    heights: Vec<f32>,
    grid: HashMap<(i32, i32), Vec<u32>>,
    ramps: Vec<Ramp>,
    ramp_grid: HashMap<(i32, i32), Vec<u32>>,
}

impl Default for Ground {
    fn default() -> Ground {
        Ground { polys: Vec::new(), heights: Vec::new(), grid: HashMap::new(), ramps: Vec::new(), ramp_grid: HashMap::new() }
    }
}

impl Ground {
    fn ramp_drop(&self, p: P2) -> f32 {
        let mut d = 0.0f32;
        if let Some(list) = self.ramp_grid.get(&key(p)) {
            for &i in list {
                d = d.max(self.ramps[i as usize].drop(p));
            }
        }
        d
    }

    /// Walking surface height at p (0 on carriageways, alleys and plazas).
    pub fn height(&self, p: P2) -> f32 {
        let mut best = 0.0f32;
        if let Some(list) = self.grid.get(&key(p)) {
            for &i in list {
                if point_in_polygon(p, &self.polys[i as usize]) {
                    let h = self.heights[i as usize];
                    best = best.max(if h == KERB_H { KERB_H - self.ramp_drop(p) } else { h });
                    if h != KERB_H {
                        return h;
                    }
                }
            }
        }
        best
    }

    /// Extra raised surfaces (median bus platforms).
    pub fn add_platforms(&mut self, list: &[([P2; 4], f32)]) {
        for (q, h) in list {
            let id = self.polys.len() as u32;
            let (lo, hi) = bbox(q);
            insert_box(&mut self.grid, lo, hi, id);
            self.polys.push(q.to_vec());
            self.heights.push(*h);
        }
    }

    pub fn pavement_cells(&self) -> usize {
        self.polys.len()
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Edge {
    None,
    Kerb,
    Skirt,
}

/// Keep the part of a convex polygon where dot(p - o, n) >= 0; new edges on
/// the cut line are kerbs.
fn clip(poly: &[(P2, Edge)], o: P2, n: P2) -> Vec<(P2, Edge)> {
    let side = |p: P2| (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1];
    let mut out = Vec::with_capacity(poly.len() + 2);
    let len = poly.len();
    for i in 0..len {
        let (a, ea) = poly[i];
        let (b, _) = poly[(i + 1) % len];
        let (sa, sb) = (side(a), side(b));
        if sa >= 0.0 {
            out.push((a, ea));
            if sb < 0.0 {
                let t = sa / (sa - sb);
                // Edge from the crossing point to the next kept point is the cut line.
                out.push(([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], Edge::Kerb));
            }
        } else if sb >= 0.0 {
            let t = sa / (sa - sb);
            out.push(([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ea));
        }
    }
    out
}

struct Seg {
    a: P2,
    b: P2,
    half: f32,
    road: usize,
}

fn seg_poly_near(s: &Seg, poly: &[P2], margin: f32) -> bool {
    let r = s.half + margin;
    for &p in poly {
        let (c, _) = closest_on_segment(p, s.a, s.b);
        if dist2(p, c) < r * r {
            return true;
        }
    }
    if point_in_polygon(s.a, poly) || point_in_polygon(s.b, poly) {
        return true;
    }
    // Segment passing through the polygon between corners.
    let n = poly.len();
    for i in 0..n {
        let (p, q) = (poly[i], poly[(i + 1) % n]);
        let mid = [(p[0] + q[0]) * 0.5, (p[1] + q[1]) * 0.5];
        let (c, _) = closest_on_segment(mid, s.a, s.b);
        if dist2(mid, c) < r * r {
            return true;
        }
    }
    false
}

/// Builds the raised pavements into `rb` and returns the walkable index.
/// `crosswalks` holds x, z, yaw, width, length per crosswalk (Props).
pub fn build(m: &MapData, crosswalks: &[f32], rb: &mut RoadBuf) -> Ground {
    let mut g = Ground::default();
    for c in crosswalks.chunks(5) {
        let (sn, cs) = c[2].sin_cos();
        let ramp = Ramp { c: [c[0], c[1]], az: [sn, cs], ax: [cs, -sn], half_w: c[3] * 0.5, half_l: c[4] * 0.5 };
        let reach = ramp.half_w + 2.0 + ramp.half_l;
        let id = g.ramps.len() as u32;
        insert_box(&mut g.ramp_grid, [c[0] - reach, c[1] - reach], [c[0] + reach, c[1] + reach], id);
        g.ramps.push(ramp);
    }

    // Carriageways that cut pavements (footways do not: they often run on them).
    let mut segs: Vec<Seg> = Vec::new();
    let mut seg_grid: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
    for (ri, r) in m.roads.iter().enumerate() {
        let base = r.kind & !ONEWAY;
        if base == road::FOOTWAY {
            continue;
        }
        for s in r.pts.windows(2) {
            let h = r.width * 0.5;
            let id = segs.len() as u32;
            insert_box(
                &mut seg_grid,
                [s[0][0].min(s[1][0]) - h, s[0][1].min(s[1][1]) - h],
                [s[0][0].max(s[1][0]) + h, s[0][1].max(s[1][1]) + h],
                id,
            );
            segs.push(Seg { a: s[0], b: s[1], half: h, road: ri });
        }
    }

    let mut cand: Vec<u32> = Vec::new();
    for (ri, r) in m.roads.iter().enumerate() {
        let sw = pavement_width(r.kind);
        let n = r.pts.len();
        if sw <= 0.0 || n < 2 {
            continue;
        }
        // Short pieces inside junctions (turn slips, split carriageway stubs)
        // would leave pavement islands in the middle of the crossing.
        let total: f32 = r.pts.windows(2).map(|w| dist2(w[0], w[1]).sqrt()).sum();
        if total < 22.0 {
            continue;
        }
        let h = r.width * 0.5;
        let oneway = r.kind & ONEWAY != 0;
        let eps = (ri % 8) as f32 * 0.0007;
        // Mitred left normals per vertex.
        let seg_dir = |a: P2, b: P2| {
            let d = [b[0] - a[0], b[1] - a[1]];
            let l = (d[0] * d[0] + d[1] * d[1]).sqrt().max(1e-6);
            [d[0] / l, d[1] / l]
        };
        let mut nrm = Vec::with_capacity(n);
        for i in 0..n {
            let t_in = if i > 0 { Some(seg_dir(r.pts[i - 1], r.pts[i])) } else { None };
            let t_out = if i + 1 < n { Some(seg_dir(r.pts[i], r.pts[i + 1])) } else { None };
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
            let rt = t_out.or(t_in).unwrap();
            let nv = [t[1], -t[0]];
            let k = 1.0 / (nv[0] * rt[1] - nv[1] * rt[0]).abs().max(0.5);
            nrm.push((nv, k));
        }
        let sides: &[f32] = if oneway { &[-1.0] } else { &[1.0, -1.0] };
        for &sd in sides {
            let (inner, outer) = (h * sd, (h + sw) * sd);
            let mut along0 = 0.0f32;
            for i in 0..n - 1 {
                let (p0, p1) = (r.pts[i], r.pts[i + 1]);
                let seg_len = dist2(p0, p1).sqrt();
                if seg_len < 1e-3 {
                    continue;
                }
                let dir = seg_dir(p0, p1);
                let sn = [dir[1], -dir[0]];
                let off = |p: P2, (nv, k): (P2, f32), o: f32| [p[0] + nv[0] * o * k, p[1] + nv[1] * o * k];
                let in0 = off(p0, nrm[i], inner);
                let in1 = off(p1, nrm[i + 1], inner);
                let out0 = off(p0, nrm[i], outer);
                let out1 = off(p1, nrm[i + 1], outer);
                let quad = [in0, in1, out1, out0];
                // Texture frame: metres along the road, metres in from the kerb line.
                let frame = |p: P2| -> [f32; 2] {
                    let d = [p[0] - p0[0], p[1] - p0[1]];
                    let a = along0 + d[0] * dir[0] + d[1] * dir[1];
                    let x = (d[0] * sn[0] + d[1] * sn[1]) * sd;
                    [a, (x - h).max(0.0)]
                };
                // Anything to cut here?
                let (lo, hi) = bbox(&quad);
                cand.clear();
                {
                    let (x0, z0) = key(lo);
                    let (x1, z1) = key(hi);
                    for z in z0..=z1 {
                        for x in x0..=x1 {
                            if let Some(l) = seg_grid.get(&(x, z)) {
                                for &id in l {
                                    if segs[id as usize].road != ri && !cand.contains(&id) && seg_poly_near(&segs[id as usize], &quad, 0.0) {
                                        cand.push(id);
                                    }
                                }
                            }
                        }
                    }
                }
                let mid = [(lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5];
                let ramp_near = g.ramp_grid.get(&key(mid)).map_or(false, |l| {
                    l.iter().any(|&i| {
                        let rp = &g.ramps[i as usize];
                        let reach = rp.half_w + 2.0 + rp.half_l + (hi[0] - lo[0]).max(hi[1] - lo[1]) * 0.5;
                        dist2(rp.c, mid) < reach * reach
                    })
                });
                let first = i == 0;
                let last = i == n - 2;
                if cand.is_empty() && !ramp_near {
                    let poly = [(in0, Edge::Kerb), (in1, if last { Edge::Skirt } else { Edge::None }), (out1, Edge::Skirt), (out0, if first { Edge::Skirt } else { Edge::None })];
                    emit(rb, &mut g, &poly, eps, sw, &frame);
                } else {
                    let na = ((seg_len / 1.0).ceil() as usize).clamp(1, 400);
                    let nc = ((sw / 0.8).ceil() as usize).max(1);
                    let at = |u: f32, v: f32| {
                        let a = [in0[0] + (in1[0] - in0[0]) * u, in0[1] + (in1[1] - in0[1]) * u];
                        let b = [out0[0] + (out1[0] - out0[0]) * u, out0[1] + (out1[1] - out0[1]) * u];
                        [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v]
                    };
                    for ia in 0..na {
                        for ic in 0..nc {
                            let (u0, u1) = (ia as f32 / na as f32, (ia + 1) as f32 / na as f32);
                            let (v0, v1) = (ic as f32 / nc as f32, (ic + 1) as f32 / nc as f32);
                            let e_in = if ic == 0 { Edge::Kerb } else { Edge::None };
                            let e_out = if ic == nc - 1 { Edge::Skirt } else { Edge::None };
                            let e_end = if last && ia == na - 1 { Edge::Skirt } else { Edge::None };
                            let e_start = if first && ia == 0 { Edge::Skirt } else { Edge::None };
                            let mut poly = vec![(at(u0, v0), e_in), (at(u1, v0), e_end), (at(u1, v1), e_out), (at(u0, v1), e_start)];
                            let mut dropped = false;
                            for &id in &cand {
                                let s = &segs[id as usize];
                                let pts: Vec<P2> = poly.iter().map(|q| q.0).collect();
                                if !seg_poly_near(s, &pts, 0.0) {
                                    continue;
                                }
                                let c = [pts.iter().map(|p| p[0]).sum::<f32>() / pts.len() as f32, pts.iter().map(|p| p[1]).sum::<f32>() / pts.len() as f32];
                                let (cp, _) = closest_on_segment(c, s.a, s.b);
                                // Unclamped position along the segment; strips run on past the
                                // ends by their half width so joints and junction centres clip
                                // cleanly instead of dropping whole cells.
                                let sl2 = dist2(s.a, s.b).max(1e-6);
                                let u = ((c[0] - s.a[0]) * (s.b[0] - s.a[0]) + (c[1] - s.a[1]) * (s.b[1] - s.a[1])) / sl2;
                                let ext = s.half / sl2.sqrt();
                                let all_in = pts.iter().all(|&p| {
                                    let (q, _) = closest_on_segment(p, s.a, s.b);
                                    dist2(p, q) < s.half * s.half
                                });
                                if all_in {
                                    dropped = true;
                                    break;
                                }
                                if u > -ext && u < 1.0 + ext {
                                    let sdir = seg_dir(s.a, s.b);
                                    let snrm = [sdir[1], -sdir[0]];
                                    let side = if (c[0] - s.a[0]) * snrm[0] + (c[1] - s.a[1]) * snrm[1] >= 0.0 { 1.0 } else { -1.0 };
                                    let nn = [snrm[0] * side, snrm[1] * side];
                                    let o = [s.a[0] + nn[0] * s.half, s.a[1] + nn[1] * s.half];
                                    poly = clip(&poly, o, nn);
                                    if poly.len() < 3 {
                                        dropped = true;
                                        break;
                                    }
                                } else if dist2(c, cp) < s.half * s.half {
                                    dropped = true;
                                    break;
                                }
                            }
                            if !dropped {
                                emit(rb, &mut g, &poly, eps, sw, &frame);
                            }
                        }
                    }
                }
                along0 += seg_len;
            }
        }
    }
    g
}

fn push_v(rb: &mut RoadBuf, p: [f32; 3], attr: [f32; 4], n: [i8; 3]) -> u32 {
    let i = (rb.pos.len() / 3) as u32;
    rb.pos.extend_from_slice(&p);
    rb.attr.extend_from_slice(&attr);
    rb.nrm.extend_from_slice(&n);
    i
}

fn emit(rb: &mut RoadBuf, g: &mut Ground, poly: &[(P2, Edge)], eps: f32, sw: f32, frame: &dyn Fn(P2) -> [f32; 2]) {
    if poly.len() < 3 {
        return;
    }
    let pts: Vec<P2> = poly.iter().map(|q| q.0).collect();
    // Orientation: make the fan face up (+y) whatever the winding.
    let mut area = 0.0;
    for i in 0..pts.len() {
        let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
        area += a[0] * b[1] - b[0] * a[1];
    }
    if area.abs() < 1e-4 {
        return;
    }
    let id = g.polys.len() as u32;
    let (lo, hi) = bbox(&pts);
    insert_box(&mut g.grid, lo, hi, id);
    g.polys.push(pts.clone());
    g.heights.push(KERB_H);
    let top = |g: &Ground, p: P2| KERB_H + eps - g.ramp_drop(p);
    let base = (rb.pos.len() / 3) as u32;
    for &p in &pts {
        let f = frame(p);
        push_v(rb, [p[0], top(g, p), p[1]], [f[0], f[1], SIDEWALK as f32, sw], [0, 127, 0]);
    }
    for k in 1..pts.len() as u32 - 1 {
        // In (x, z) a positive shoelace area is clockwise seen from +y.
        if area > 0.0 {
            rb.idx.extend_from_slice(&[base, base + k + 1, base + k]);
        } else {
            rb.idx.extend_from_slice(&[base, base + k, base + k + 1]);
        }
    }
    // Vertical faces: kerbs on the road side, a low skirt at the back.
    let cx = pts.iter().map(|p| p[0]).sum::<f32>() / pts.len() as f32;
    let cz = pts.iter().map(|p| p[1]).sum::<f32>() / pts.len() as f32;
    for i in 0..poly.len() {
        let e = poly[i].1;
        if e == Edge::None {
            continue;
        }
        let (a, b) = (poly[i].0, poly[(i + 1) % poly.len()].0);
        let d = [b[0] - a[0], b[1] - a[1]];
        let l = (d[0] * d[0] + d[1] * d[1]).sqrt();
        if l < 1e-3 {
            continue;
        }
        let mut nv = [d[1] / l, -d[0] / l];
        let mid = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
        if (mid[0] - cx) * nv[0] + (mid[1] - cz) * nv[1] < 0.0 {
            nv = [-nv[0], -nv[1]];
        }
        let ni = [(nv[0] * 127.0) as i8, 0, (nv[1] * 127.0) as i8];
        let kind = if e == Edge::Kerb { KERB } else { SKIRT } as f32;
        let (ya, yb) = (top(g, a), top(g, b));
        let fa = frame(a)[0];
        let fb = frame(b)[0];
        let v0 = push_v(rb, [a[0], ya, a[1]], [fa, ya, kind, 0.0], ni);
        let v1 = push_v(rb, [b[0], yb, b[1]], [fb, yb, kind, 0.0], ni);
        let v2 = push_v(rb, [b[0], -0.02, b[1]], [fb, -0.02, kind, 0.0], ni);
        let v3 = push_v(rb, [a[0], -0.02, a[1]], [fa, -0.02, kind, 0.0], ni);
        // Face outward: (b - a) x up points along nv when nv = [d.z, -d.x].
        let same = (d[1] / l) * nv[0] + (-d[0] / l) * nv[1] > 0.0;
        if same {
            rb.idx.extend_from_slice(&[v0, v2, v1, v0, v3, v2]);
        } else {
            rb.idx.extend_from_slice(&[v0, v1, v2, v0, v2, v3]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::Road;

    #[test]
    fn pavement_is_raised_and_cut_by_crossing_road() {
        // East-west primary crossed by a north-south residential street at x = 0.
        let m = MapData {
            roads: vec![
                Road { pts: vec![[-60.0, 0.0], [60.0, 0.0]], kind: road::PRIMARY, width: 16.0, name: 0 },
                Road { pts: vec![[0.0, -60.0], [0.0, 60.0]], kind: road::RESIDENTIAL, width: 6.0, name: 0 },
            ],
            ..Default::default()
        };
        let mut rb = RoadBuf::default();
        let g = build(&m, &[], &mut rb);
        // On the pavement (8..12 m off the centreline), away from the side street.
        assert!((g.height([30.0, 10.0]) - KERB_H).abs() < 1e-4);
        assert!((g.height([-30.0, -10.0]) - KERB_H).abs() < 1e-4);
        // Carriageway, side street mouth and beyond the pavement stay at 0.
        assert_eq!(g.height([30.0, 2.0]), 0.0);
        assert_eq!(g.height([0.0, 10.0]), 0.0);
        assert_eq!(g.height([30.0, 14.0]), 0.0);
        // Just outside the side street's edge is pavement again.
        assert!(g.height([3.4, 10.0]) > 0.1);
        assert_eq!(rb.pos.len() / 3, rb.nrm.len() / 3);
    }

    #[test]
    fn crosswalk_ramp_lowers_the_kerb() {
        let m = MapData { roads: vec![Road { pts: vec![[-60.0, 0.0], [60.0, 0.0]], kind: road::PRIMARY, width: 16.0, name: 0 }], ..Default::default() };
        let mut rb = RoadBuf::default();
        // Crosswalk across the road at x = 20 (dir along the road = +x, yaw = atan2(1, 0)).
        let cw = [20.0, 0.0, std::f32::consts::FRAC_PI_2, 16.0, 4.0];
        let g = build(&m, &cw, &mut rb);
        assert!(g.height([20.0, 8.1]) < 0.05);
        assert!((g.height([20.0, 11.5]) - KERB_H).abs() < 1e-3);
        assert!((g.height([40.0, 8.1]) - KERB_H).abs() < 1e-4);
    }
}
