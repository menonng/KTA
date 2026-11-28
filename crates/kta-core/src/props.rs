//! Seoul street kit: procedural props placed from the map with deterministic
//! rules (building seed / road index), streamed as merged meshes per 128 m
//! cell. Primitives are stored compactly (36 B each); geometry is only built
//! for cells near the camera, into a reused scratch buffer.

use crate::data::{kind, road, MapData, ONEWAY};
use crate::geom::{centroid, closest_on_segment, point_in_polygon, signed_area, P2};
use std::collections::HashMap;

pub const CELL: f32 = 128.0;

#[derive(Clone, Copy)]
pub struct Rng(u32);

impl Rng {
    pub fn new(s: u32) -> Rng {
        Rng(s.wrapping_mul(2654435761).wrapping_add(0x9e3779b9) | 1)
    }
    pub fn f(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        (x >> 8) as f32 / 16_777_216.0
    }
    pub fn range(&mut self, a: f32, b: f32) -> f32 {
        a + (b - a) * self.f()
    }
    pub fn pick<T: Copy>(&mut self, v: &[T]) -> T {
        v[((self.f() * v.len() as f32) as usize).min(v.len() - 1)]
    }
}

pub const SHAPE_BOX: u8 = 0;
pub const SHAPE_CYL: u8 = 1;
pub const SHAPE_OCT: u8 = 2;
pub const SHAPE_ICO: u8 = 3;

/// One primitive: box/cylinder (origin at bottom center) or octahedron (center).
#[derive(Clone, Copy)]
pub struct Prim {
    pub shape: u8,
    pub segs: u8,
    pub color: [u8; 4],
    pub pos: [f32; 3],
    pub yaw: f32,
    pub pitch: f32,
    pub size: [f32; 3],
}

const fn rgb(c: u32) -> [u8; 4] {
    [(c >> 16) as u8, (c >> 8) as u8, c as u8, 255]
}
const fn glow(c: u32) -> [u8; 4] {
    [(c >> 16) as u8, (c >> 8) as u8, c as u8, 0]
}

#[derive(Default)]
pub struct PropMesh {
    pub pos: Vec<f32>,
    pub nrm: Vec<i8>,
    pub col: Vec<u8>,
    pub idx: Vec<u32>,
}

impl PropMesh {
    fn clear(&mut self) {
        self.pos.clear();
        self.nrm.clear();
        self.col.clear();
        self.idx.clear();
    }
    fn v(&mut self, p: [f32; 3], n: [f32; 3], c: [u8; 4]) -> u32 {
        let i = (self.pos.len() / 3) as u32;
        self.pos.extend_from_slice(&p);
        self.nrm.extend_from_slice(&[(n[0] * 127.0) as i8, (n[1] * 127.0) as i8, (n[2] * 127.0) as i8]);
        self.col.extend_from_slice(&c);
        i
    }
}

struct Xf {
    cy: f32,
    sy: f32,
    cp: f32,
    sp: f32,
    t: [f32; 3],
}

impl Xf {
    fn new(pr: &Prim) -> Xf {
        Xf { cy: pr.yaw.cos(), sy: pr.yaw.sin(), cp: pr.pitch.cos(), sp: pr.pitch.sin(), t: pr.pos }
    }
    /// Rotate (pitch about X, then yaw about Y). Local +z maps to (sin yaw, 0, cos yaw).
    fn rot(&self, v: [f32; 3]) -> [f32; 3] {
        let y = v[1] * self.cp - v[2] * self.sp;
        let z = v[1] * self.sp + v[2] * self.cp;
        [v[0] * self.cy + z * self.sy, y, -v[0] * self.sy + z * self.cy]
    }
    fn p(&self, v: [f32; 3]) -> [f32; 3] {
        let r = self.rot(v);
        [r[0] + self.t[0], r[1] + self.t[1], r[2] + self.t[2]]
    }
}

fn emit(m: &mut PropMesh, pr: &Prim) {
    let x = Xf::new(pr);
    let s = pr.size;
    let c = pr.color;
    match pr.shape {
        SHAPE_BOX => {
            let (hx, hz) = (s[0] * 0.5, s[2] * 0.5);
            // (normal, u axis, v axis, center offset)
            let faces: [([f32; 3], [f32; 3], [f32; 3], [f32; 3]); 6] = [
                ([0.0, 0.0, 1.0], [hx, 0.0, 0.0], [0.0, s[1] * 0.5, 0.0], [0.0, s[1] * 0.5, hz]),
                ([0.0, 0.0, -1.0], [-hx, 0.0, 0.0], [0.0, s[1] * 0.5, 0.0], [0.0, s[1] * 0.5, -hz]),
                ([1.0, 0.0, 0.0], [0.0, 0.0, -hz], [0.0, s[1] * 0.5, 0.0], [hx, s[1] * 0.5, 0.0]),
                ([-1.0, 0.0, 0.0], [0.0, 0.0, hz], [0.0, s[1] * 0.5, 0.0], [-hx, s[1] * 0.5, 0.0]),
                ([0.0, 1.0, 0.0], [hx, 0.0, 0.0], [0.0, 0.0, -hz], [0.0, s[1], 0.0]),
                ([0.0, -1.0, 0.0], [hx, 0.0, 0.0], [0.0, 0.0, hz], [0.0, 0.0, 0.0]),
            ];
            for (n, u, v, o) in faces {
                let nn = x.rot(n);
                let corner = |a: f32, b: f32| x.p([o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b]);
                let i0 = m.v(corner(-1.0, -1.0), nn, c);
                let i1 = m.v(corner(1.0, -1.0), nn, c);
                let i2 = m.v(corner(1.0, 1.0), nn, c);
                let i3 = m.v(corner(-1.0, 1.0), nn, c);
                m.idx.extend_from_slice(&[i0, i1, i2, i0, i2, i3]);
            }
        }
        SHAPE_CYL => {
            let n = pr.segs.max(3) as usize;
            let (rx, rz) = (s[0] * 0.5, s[2] * 0.5);
            let base = (m.pos.len() / 3) as u32;
            for i in 0..=n {
                let a = i as f32 / n as f32 * std::f32::consts::TAU;
                let (ca, sa) = (a.cos(), a.sin());
                let nn = x.rot([ca, 0.0, sa]);
                m.v(x.p([ca * rx, 0.0, sa * rz]), nn, c);
                m.v(x.p([ca * rx, s[1], sa * rz]), nn, c);
            }
            for i in 0..n as u32 {
                let b0 = base + i * 2;
                let t0 = b0 + 1;
                let b1 = b0 + 2;
                let t1 = b0 + 3;
                m.idx.extend_from_slice(&[b0, t1, b1, b0, t0, t1]);
            }
            let up = x.rot([0.0, 1.0, 0.0]);
            let ctr = m.v(x.p([0.0, s[1], 0.0]), up, c);
            let ring = (m.pos.len() / 3) as u32;
            for i in 0..n {
                let a = i as f32 / n as f32 * std::f32::consts::TAU;
                m.v(x.p([a.cos() * rx, s[1], a.sin() * rz]), up, c);
            }
            for i in 0..n as u32 {
                m.idx.extend_from_slice(&[ctr, ring + (i + 1) % n as u32, ring + i]);
            }
        }
        _ => {
            let (rx, ry, rz) = (s[0] * 0.5, s[1] * 0.5, s[2] * 0.5);
            let oct_pts = [[rx, 0.0, 0.0], [-rx, 0.0, 0.0], [0.0, ry, 0.0], [0.0, -ry, 0.0], [0.0, 0.0, rz], [0.0, 0.0, -rz]];
            let oct_faces: [[usize; 3]; 8] = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
            let t = 1.618034f32;
            let k = 1.0 / (1.0 + t * t).sqrt();
            let ico_unit = [
                [-1.0, t, 0.0], [1.0, t, 0.0], [-1.0, -t, 0.0], [1.0, -t, 0.0],
                [0.0, -1.0, t], [0.0, 1.0, t], [0.0, -1.0, -t], [0.0, 1.0, -t],
                [t, 0.0, -1.0], [t, 0.0, 1.0], [-t, 0.0, -1.0], [-t, 0.0, 1.0],
            ];
            let ico_faces: [[usize; 3]; 20] = [
                [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
                [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
            ];
            let ico_pts: Vec<[f32; 3]> = ico_unit.iter().map(|v| [v[0] * k * rx, v[1] * k * ry, v[2] * k * rz]).collect();
            let (pts, faces): (Vec<[f32; 3]>, Vec<[usize; 3]>) = if pr.shape == SHAPE_ICO {
                (ico_pts, ico_faces.to_vec())
            } else {
                (oct_pts.to_vec(), oct_faces.to_vec())
            };
            for f in faces {
                let a = pts[f[0]];
                let b = pts[f[1]];
                let cc = pts[f[2]];
                let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                let e2 = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
                let mut nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
                let l = (nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]).sqrt().max(1e-6);
                nn = x.rot([nn[0] / l, nn[1] / l, nn[2] / l]);
                let i0 = m.v(x.p(a), nn, c);
                let i1 = m.v(x.p(b), nn, c);
                let i2 = m.v(x.p(cc), nn, c);
                m.idx.extend_from_slice(&[i0, i1, i2]);
            }
        }
    }
}

/// Uniform grid over 2D segments (roads or building walls) for proximity queries.
struct Grid {
    min: P2,
    cell: f32,
    w: i32,
    h: i32,
    cells: Vec<Vec<u32>>,
}

impl Grid {
    fn new(min: P2, max: P2, cell: f32) -> Grid {
        let w = (((max[0] - min[0]) / cell).ceil() as i32).max(1) + 1;
        let h = (((max[1] - min[1]) / cell).ceil() as i32).max(1) + 1;
        Grid { min, cell, w, h, cells: vec![Vec::new(); (w * h) as usize] }
    }
    fn insert_box(&mut self, lo: P2, hi: P2, id: u32) {
        let x0 = ((lo[0] - self.min[0]) / self.cell).floor().max(0.0) as i32;
        let x1 = (((hi[0] - self.min[0]) / self.cell).floor() as i32).min(self.w - 1);
        let z0 = ((lo[1] - self.min[1]) / self.cell).floor().max(0.0) as i32;
        let z1 = (((hi[1] - self.min[1]) / self.cell).floor() as i32).min(self.h - 1);
        for z in z0..=z1 {
            for x in x0..=x1 {
                self.cells[(z * self.w + x) as usize].push(id);
            }
        }
    }
    fn near(&self, p: P2, out: &mut Vec<u32>) {
        out.clear();
        let cx = ((p[0] - self.min[0]) / self.cell).floor() as i32;
        let cz = ((p[1] - self.min[1]) / self.cell).floor() as i32;
        for z in cz - 1..=cz + 1 {
            for x in cx - 1..=cx + 1 {
                if x < 0 || z < 0 || x >= self.w || z >= self.h {
                    continue;
                }
                for &id in &self.cells[(z * self.w + x) as usize] {
                    if !out.contains(&id) {
                        out.push(id);
                    }
                }
            }
        }
    }
}

/// Instanced CC0 models (web/public/models, order of MODEL_NAMES in the client).
pub const M_AIRCON: u8 = 0;
pub const M_POWERBOX: u8 = 1;
pub const M_CHAIR: u8 = 2;
pub const M_CRATE: u8 = 3;
pub const M_MANHOLE: u8 = 4;
pub const M_SHUTTER: u8 = 5;
pub const M_COVEREDCAR: u8 = 6;
pub const M_TREE: u8 = 7;
/// Street-tree species models follow the ginkgo: M_TREE + species::* (7..=15).
pub const M_SHELTER: u8 = 16;
pub const M_SMART_SHELTER: u8 = 17;
pub const M_STOP_POLE: u8 = 18;
pub const M_PARASOL: u8 = 19;

/// Tactile paving (점자블록) kinds for `Props::tactile`.
pub const TACTILE_DOTS: f32 = 0.0;
pub const TACTILE_LINES: f32 = 1.0;

/// Vehicle types (matches web/src/render/cars.ts CAR_TYPES) and their
/// footprint half-extents (width, length) in meters.
pub const CAR_HALF: [(f32, f32); 6] = [(0.93, 2.42), (0.81, 1.82), (0.95, 2.34), (0.93, 2.42), (0.88, 2.56), (1.26, 5.5)];

fn pick_car(rng: &mut Rng, main: bool) -> u8 {
    let r = rng.f();
    if main {
        // taxi, 1-ton truck, sedan, SUV
        if r < 0.38 { 3 } else if r < 0.68 { 4 } else if r < 0.86 { 0 } else { 2 }
    } else {
        // sedan, compact (경차), SUV, 1-ton truck
        if r < 0.38 { 0 } else if r < 0.62 { 1 } else if r < 0.88 { 2 } else { 4 }
    }
}

pub struct Props {
    cells: HashMap<(i32, i32), Vec<Prim>>,
    /// Model instances per cell: model, x, y, z, yaw, sx, sy, sz.
    insts: HashMap<(i32, i32), Vec<[f32; 8]>>,
    /// Solid footprints (corner quads) for the collision grid: parked cars,
    /// street cabinets.
    pub obstacles: Vec<([P2; 4], f32)>,
    pub wires: Vec<f32>,
    /// Parked vehicles: x, z, yaw, type (see CAR_HALF), paint seed.
    pub parked: Vec<f32>,
    /// x, z, yaw, width, length
    pub crosswalks: Vec<f32>,
    /// x, z of light pools under street lamps
    pub lamps: Vec<f32>,
    /// Tactile paving: x, y, z, yaw, size x, size z, kind (TACTILE_*). Lines run along local z.
    pub tactile: Vec<f32>,
    /// Median bus platforms (raised walking surface): four corners each, height.
    pub platforms: Vec<([P2; 4], f32)>,
    pub scratch: PropMesh,
    pub prim_count: usize,
}

struct Ctx<'a> {
    m: &'a MapData,
    road_grid: Grid,
    road_segs: Vec<(P2, P2, f32, u8)>,
    bld_grid: Grid,
    tmp: Vec<u32>,
}

impl<'a> Ctx<'a> {
    /// Nearest road (distance beyond its edge, kind) within `r` of p.
    fn road_near(&mut self, p: P2, r: f32) -> Option<(f32, u8)> {
        self.road_grid.near(p, &mut self.tmp);
        let mut best: Option<(f32, u8)> = None;
        for &i in &self.tmp {
            let (a, b, half, k) = self.road_segs[i as usize];
            let (c, _) = closest_on_segment(p, a, b);
            let d = crate::geom::dist2(p, c).sqrt() - half;
            if d < r && best.map_or(true, |bb| d < bb.0) {
                best = Some((d, k));
            }
        }
        best
    }
    /// If p lies on a carriageway (or within `margin` of its edge), the point
    /// pushed out to `margin` beyond the edge, with that road's kind.
    fn out_of_carriageway(&mut self, p: P2, margin: f32) -> Option<(P2, u8)> {
        self.road_grid.near(p, &mut self.tmp);
        let mut best: Option<(f32, P2, u8)> = None;
        for &i in &self.tmp {
            let (a, b, half, k) = self.road_segs[i as usize];
            if matches!(k & !ONEWAY, road::FOOTWAY | road::PEDESTRIAN) {
                continue;
            }
            let (c, _) = closest_on_segment(p, a, b);
            let d = crate::geom::dist2(p, c).sqrt();
            if d < half + margin {
                let pen = half + margin - d;
                if best.map_or(true, |bb| pen > bb.0) {
                    let n = if d > 1e-3 {
                        [(p[0] - c[0]) / d, (p[1] - c[1]) / d]
                    } else {
                        let l = crate::geom::dist2(a, b).sqrt().max(1e-3);
                        [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]
                    };
                    best = Some((pen, [c[0] + n[0] * (half + margin), c[1] + n[1] * (half + margin)], k));
                }
            }
        }
        best.map(|b| (b.1, b.2))
    }
    /// Direction of the nearest road segment.
    fn road_dir(&mut self, p: P2) -> Option<P2> {
        self.road_grid.near(p, &mut self.tmp);
        let mut best: Option<(f32, P2)> = None;
        for &i in &self.tmp {
            let (a, b, _, _) = self.road_segs[i as usize];
            let (c, _) = closest_on_segment(p, a, b);
            let d = crate::geom::dist2(p, c);
            if best.map_or(true, |bb| d < bb.0) {
                let l = crate::geom::dist2(a, b).sqrt().max(1e-3);
                best = Some((d, [(b[0] - a[0]) / l, (b[1] - a[1]) / l]));
            }
        }
        best.map(|b| b.1)
    }
    fn in_building(&mut self, p: P2, margin: f32) -> bool {
        self.bld_grid.near(p, &mut self.tmp);
        for &i in &self.tmp {
            let b = &self.m.buildings[i as usize];
            if point_in_polygon(p, &b.pts) {
                return true;
            }
            if margin > 0.0 {
                let n = b.pts.len();
                for k in 0..n {
                    let (c, _) = closest_on_segment(p, b.pts[k], b.pts[(k + 1) % n]);
                    if crate::geom::dist2(p, c) < margin * margin {
                        return true;
                    }
                }
            }
        }
        false
    }
    /// Nearest building wall point within r: (point, outward normal).
    fn wall_near(&mut self, p: P2, r: f32) -> Option<(P2, P2)> {
        self.bld_grid.near(p, &mut self.tmp);
        let mut best: Option<(f32, P2, P2)> = None;
        for &i in &self.tmp {
            let b = &self.m.buildings[i as usize];
            let n = b.pts.len();
            for k in 0..n {
                let (a, c) = (b.pts[k], b.pts[(k + 1) % n]);
                let (cp, _) = closest_on_segment(p, a, c);
                let d2 = crate::geom::dist2(p, cp);
                if d2 < r * r && best.map_or(true, |bb| d2 < bb.0) {
                    let d = [c[0] - a[0], c[1] - a[1]];
                    let l = (d[0] * d[0] + d[1] * d[1]).sqrt().max(1e-5);
                    best = Some((d2, cp, [d[1] / l, -d[0] / l]));
                }
            }
        }
        best.map(|b| (b.1, b.2))
    }
}

fn yaw_of(n: P2) -> f32 {
    n[0].atan2(n[1])
}

fn make_ctx(m: &MapData) -> Ctx<'_> {
    let mut mn = [f32::MAX, f32::MAX];
    let mut mx = [f32::MIN, f32::MIN];
    for b in &m.buildings {
        for p in &b.pts {
            mn = [mn[0].min(p[0]), mn[1].min(p[1])];
            mx = [mx[0].max(p[0]), mx[1].max(p[1])];
        }
    }
    for r in &m.roads {
        for p in &r.pts {
            mn = [mn[0].min(p[0]), mn[1].min(p[1])];
            mx = [mx[0].max(p[0]), mx[1].max(p[1])];
        }
    }
    if mn[0] > mx[0] {
        mn = [0.0, 0.0];
        mx = [1.0, 1.0];
    }
    let mut road_grid = Grid::new(mn, mx, 24.0);
    let mut road_segs = Vec::new();
    for r in &m.roads {
        for s in r.pts.windows(2) {
            let id = road_segs.len() as u32;
            road_segs.push((s[0], s[1], r.width * 0.5, r.kind));
            let pad = r.width * 0.5 + 6.0;
            road_grid.insert_box(
                [s[0][0].min(s[1][0]) - pad, s[0][1].min(s[1][1]) - pad],
                [s[0][0].max(s[1][0]) + pad, s[0][1].max(s[1][1]) + pad],
                id,
            );
        }
    }
    let mut bld_grid = Grid::new(mn, mx, 24.0);
    for (i, b) in m.buildings.iter().enumerate() {
        let mut lo = [f32::MAX, f32::MAX];
        let mut hi = [f32::MIN, f32::MIN];
        for p in &b.pts {
            lo = [lo[0].min(p[0]), lo[1].min(p[1])];
            hi = [hi[0].max(p[0]), hi[1].max(p[1])];
        }
        bld_grid.insert_box([lo[0] - 2.0, lo[1] - 2.0], [hi[0] + 2.0, hi[1] + 2.0], i as u32);
    }
    Ctx { m, road_grid, road_segs, bld_grid, tmp: Vec::new() }
}

impl Props {
    pub fn new(m: &MapData) -> Props {
        let mut ctx = make_ctx(m);
        let mut p = Props {
            cells: HashMap::new(),
            wires: Vec::new(),
            crosswalks: Vec::new(),
            lamps: Vec::new(),
            tactile: Vec::new(),
            platforms: Vec::new(),
            scratch: PropMesh::default(),
            prim_count: 0,
            insts: HashMap::new(),
            obstacles: Vec::new(),
            parked: Vec::new(),
        };
        p.place_buildings(&mut ctx);
        p.place_streets(&mut ctx);
        p.place_trees(&mut ctx);
        p.place_stops(&mut ctx);
        p.prim_count = p.cells.values().map(|v| v.len()).sum();
        p
    }

    fn add(&mut self, pr: Prim) {
        let key = ((pr.pos[0] / CELL).floor() as i32, (pr.pos[2] / CELL).floor() as i32);
        self.cells.entry(key).or_default().push(pr);
    }

    fn inst(&mut self, model: u8, pos: [f32; 3], yaw: f32, scale: [f32; 3]) {
        let key = ((pos[0] / CELL).floor() as i32, (pos[2] / CELL).floor() as i32);
        self.insts.entry(key).or_default().push([model as f32, pos[0], pos[1], pos[2], yaw, scale[0], scale[1], scale[2]]);
    }

    /// Box footprint centred on c, rotated by yaw (local x = width, z = depth).
    fn obstacle(&mut self, c: P2, yaw: f32, hx: f32, hz: f32, height: f32) {
        let (sn, cs) = yaw.sin_cos();
        let ax = [cs, -sn];
        let az = [sn, cs];
        let corner = |i: f32, j: f32| [c[0] + ax[0] * hx * i + az[0] * hz * j, c[1] + ax[1] * hx * i + az[1] * hz * j];
        self.obstacles.push(([corner(-1.0, -1.0), corner(1.0, -1.0), corner(1.0, 1.0), corner(-1.0, 1.0)], height));
    }

    /// Model instances of one cell, flattened (8 floats each).
    pub fn cell_instances(&self, cx: i32, cz: i32) -> Vec<f32> {
        self.insts.get(&(cx, cz)).map(|v| v.iter().flatten().copied().collect()).unwrap_or_default()
    }

    fn bx(&mut self, pos: [f32; 3], yaw: f32, size: [f32; 3], color: [u8; 4]) {
        self.add(Prim { shape: SHAPE_BOX, segs: 0, color, pos, yaw, pitch: 0.0, size });
    }
    fn cyl(&mut self, pos: [f32; 3], r: f32, h: f32, segs: u8, color: [u8; 4]) {
        self.add(Prim { shape: SHAPE_CYL, segs, color, pos, yaw: 0.0, pitch: 0.0, size: [r * 2.0, h, r * 2.0] });
    }
    fn ico(&mut self, pos: [f32; 3], yaw: f32, size: [f32; 3], color: [u8; 4]) {
        self.add(Prim { shape: SHAPE_ICO, segs: 0, color, pos, yaw, pitch: 0.0, size });
    }

    fn place_buildings(&mut self, ctx: &mut Ctx) {
        let m = ctx.m;
        for (bi, b) in m.buildings.iter().enumerate() {
            let n = b.pts.len();
            if n < 3 {
                continue;
            }
            let mut rng = Rng::new(b.seed as u32 * 7919 + bi as u32);
            let h = b.height.max(3.0);
            let lv = b.levels.max(1) as usize;
            let area = signed_area(&b.pts).abs();
            let shopish = b.kind != kind::RESIDENTIAL || rng.f() < 0.45;
            let villa = (b.kind == kind::RESIDENTIAL || b.kind == kind::OTHER) && (3..=6).contains(&lv) && area < 500.0;
            let c = centroid(&b.pts);
            let mut ac_left = if b.kind == kind::RESIDENTIAL { 7 } else { 5 };
            let mut best_edge: Option<(f32, usize, bool)> = None;
            for e in 0..n {
                let a = b.pts[e];
                let cc = b.pts[(e + 1) % n];
                let d = [cc[0] - a[0], cc[1] - a[1]];
                let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
                if len < 2.0 {
                    continue;
                }
                let dir = [d[0] / len, d[1] / len];
                let nrm = [dir[1], -dir[0]];
                let yaw = yaw_of(nrm);
                let mid = [a[0] + d[0] * 0.5, a[1] + d[1] * 0.5];
                let street = ctx.road_near([mid[0] + nrm[0] * 3.0, mid[1] + nrm[1] * 3.0], 4.0);
                let facing = street.is_some();
                let alley = street.map_or(false, |s| matches!(s.1 & !ONEWAY, road::RESIDENTIAL | road::SERVICE | road::FOOTWAY));
                if best_edge.map_or(true, |be| (facing as u8, len) > (be.2 as u8, be.0)) {
                    best_edge = Some((len, e, facing));
                }
                let at = |u: f32, out: f32| [a[0] + dir[0] * u + nrm[0] * out, a[1] + dir[1] * u + nrm[1] * out];

                // Wall AC units (실외기) hanging under windows (not across the
                // ground-floor sign band of shop fronts).
                let first_floor = if facing && shopish { 2 } else { 1 };
                for f in first_floor..lv.min(9) {
                    if ac_left == 0 || len < 2.6 {
                        break;
                    }
                    if rng.f() < if b.kind == kind::RESIDENTIAL { 0.22 } else { 0.12 } {
                        let u = rng.range(0.6, len - 0.6);
                        let p = at(u, 0.21);
                        self.inst(M_AIRCON, [p[0], f as f32 * 3.3 - 0.08, p[1]], yaw, [1.0, 1.0, 1.0]);
                        ac_left -= 1;
                    }
                }

                // Ground floor shopfront kit on street-facing edges.
                if facing && shopish && len > 3.0 {
                    let w = (len - 0.5).min(9.0);
                    let u = len * 0.5;
                    let p = at(u, 0.16);
                    // Roller-shutter housing just under the sign band (awnings are
                    // printed fabric, drawn with the signs).
                    self.bx([p[0], 2.82, p[1]], yaw, [w, 0.24, 0.22], rgb(0x8c9095));
                    if rng.f() < 0.14 {
                        // Parked scooter along the wall.
                        let ps = at(rng.range(0.8, len - 0.8), 1.25);
                        let sy = yaw_of(dir);
                        let col = rng.pick(&[0xb02a2a, 0xe8e8e8, 0x222222, 0x2d4f8a]);
                        self.bx([ps[0], 0.25, ps[1]], sy, [0.45, 0.45, 1.5], rgb(col));
                        self.bx([ps[0], 0.7, ps[1]], sy, [0.32, 0.12, 0.7], rgb(0x1a1a1a));
                        self.bx([ps[0], 0.7, ps[1] ], sy + 0.0, [0.4, 0.55, 0.06], rgb(0x2a2a2a));
                    }
                }
                // Trash bag piles by alley walls.
                if alley && rng.f() < 0.1 {
                    let pt = at(rng.range(0.6, (len - 0.6).max(0.7)), 0.55);
                    for k in 0..3 {
                        let o = [rng.range(-0.4, 0.4), rng.range(-0.25, 0.25)];
                        let col = rng.pick(&[0x1b1b1d, 0x1b1b1d, 0xe5e5e0, 0x3f5f9a, 0x6a8a3a]);
                        let s = rng.range(0.45, 0.7);
                        self.ico([pt[0] + o[0], s * 0.4 + if k == 2 { 0.3 } else { 0.0 }, pt[1] + o[1]], rng.range(0.0, 3.0), [s, s * 0.8, s], rgb(col));
                    }
                }
            }

            // Drain pipes at one or two corners.
            for _ in 0..(1 + (rng.f() < 0.4) as usize) {
                let k = (rng.f() * n as f32) as usize % n;
                let p = b.pts[k];
                let prev = b.pts[(k + n - 1) % n];
                let next = b.pts[(k + 1) % n];
                let o = [(p[0] - prev[0]) + (p[0] - next[0]), (p[1] - prev[1]) + (p[1] - next[1])];
                let l = (o[0] * o[0] + o[1] * o[1]).sqrt().max(1e-4);
                let q = [p[0] + o[0] / l * 0.12, p[1] + o[1] / l * 0.12];
                self.cyl([q[0], 0.0, q[1]], 0.055, h + 0.6, 5, rgb(if rng.f() < 0.5 { 0xcfcfcf } else { 0x6b6b6b }));
            }

            // Rooftop clutter (옥상): stair tower (계단실/옥탑) by a corner and a
            // water tank on a stand on many mid-rise blocks.
            if h >= 8.0 && area > 45.0 {
                let k0 = (rng.f() * n as f32) as usize % n;
                let v0 = b.pts[k0];
                let dc = [c[0] - v0[0], c[1] - v0[1]];
                let dl = (dc[0] * dc[0] + dc[1] * dc[1]).sqrt().max(1e-3);
                let sz = (area.sqrt() * 0.28).clamp(2.2, 4.2);
                let q = [v0[0] + dc[0] / dl * (sz * 0.85), v0[1] + dc[1] / dl * (sz * 0.85)];
                let e = b.pts[(k0 + 1) % n];
                let ey = yaw_of([e[1] - v0[1], v0[0] - e[0]]);
                if crate::geom::point_in_polygon(q, &b.pts) && rng.f() < 0.7 {
                    let col = rng.pick(&[0xd8d4ca, 0xc9c4b8, 0xb9b2a4, 0xe2ddd2, 0x9aa0a4]);
                    let th = rng.range(2.5, 2.9);
                    self.bx([q[0], h + th * 0.5, q[1]], ey, [sz, th, sz * rng.range(0.8, 1.1)], rgb(col));
                    self.bx([q[0], h + th + 0.08, q[1]], ey, [sz + 0.3, 0.16, sz * 1.1 + 0.3], rgb(0x8a8a84));
                    // Door on one face.
                    let (sn, cs) = ey.sin_cos();
                    self.bx([q[0] + sn * (sz * 0.5 + 0.01), h + 1.0, q[1] + cs * (sz * 0.5 + 0.01)], ey, [0.9, 2.0, 0.04], rgb(0x4a5058));
                }
                if rng.f() < 0.5 {
                    let q2 = [c[0] + rng.range(-1.5, 1.5), c[1] + rng.range(-1.5, 1.5)];
                    if crate::geom::point_in_polygon(q2, &b.pts) {
                        let tank = rng.pick(&[0xc7cbcf, 0xc7cbcf, 0x3a6ea5, 0x2f7d52, 0xd9d2c0]);
                        let r = rng.range(0.6, 0.85);
                        self.bx([q2[0], h + 0.25, q2[1]], 0.0, [r * 2.2, 0.5, r * 2.2], rgb(0x6b6e70));
                        self.cyl([q2[0], h + 0.5, q2[1]], r, rng.range(1.4, 1.9), 12, rgb(tank));
                    }
                }
            }
            // Outdoor AC units grouped on flat roofs.
            if h >= 6.0 && area > 60.0 && rng.f() < 0.55 {
                let n = 1 + (rng.f() * 3.0) as usize;
                for k in 0..n {
                    let q = [c[0] + rng.range(-2.0, 2.0) + k as f32 * 0.95, c[1] + rng.range(-2.0, 2.0)];
                    if crate::geom::point_in_polygon(q, &b.pts) {
                        self.inst(M_AIRCON, [q[0], h, q[1]], rng.range(0.0, 6.28), [1.0, 1.0, 1.0]);
                    }
                }
            }
            // Balconies on villa-type buildings (빌라), longest street-facing edge.
            if villa && rng.f() < 0.5 {
                if let Some((len, e, _)) = best_edge {
                    if len > 4.0 {
                        let a = b.pts[e];
                        let cc = b.pts[(e + 1) % n];
                        let d = [(cc[0] - a[0]) / len, (cc[1] - a[1]) / len];
                        let nrm = [d[1], -d[0]];
                        let yaw = yaw_of(nrm);
                        let w = (len * 0.7).min(7.0);
                        let mid = [a[0] + d[0] * len * 0.5, a[1] + d[1] * len * 0.5];
                        let rail = rng.pick(&[0x2b2d30, 0xdedcd6, 0x3d4f5c]);
                        for f in 1..lv {
                            let y = f as f32 * 3.3;
                            self.bx([mid[0] + nrm[0] * 0.55, y - 0.14, mid[1] + nrm[1] * 0.55], yaw, [w, 0.14, 1.1], rgb(0xbdb8ae));
                            self.bx([mid[0] + nrm[0] * 1.08, y, mid[1] + nrm[1] * 1.08], yaw, [w, 1.0, 0.05], rgb(rail));
                        }
                    }
                }
            }

            // Rooftop: water tank, rooftop room (옥탑방), AC clusters.
            let inside = |p: P2| point_in_polygon(p, &b.pts);
            if lv <= 8 && rng.f() < 0.55 {
                let p = [c[0] + rng.range(-2.0, 2.0), c[1] + rng.range(-2.0, 2.0)];
                if inside(p) {
                    let col = rng.pick(&[0x3a6fb0, 0xd9d9d9, 0x9aa0a6, 0x5f8c4a, 0x2f8fbf]);
                    self.cyl([p[0], h, p[1]], rng.range(0.55, 0.8), 1.35, 8, rgb(col));
                }
            }
            if b.kind != kind::COMMERCIAL && (3..=7).contains(&lv) && area > 90.0 && rng.f() < 0.4 {
                if let Some((len, e, _)) = best_edge {
                    let a = b.pts[e];
                    let cc = b.pts[(e + 1) % n];
                    let d = [(cc[0] - a[0]) / len.max(0.01), (cc[1] - a[1]) / len.max(0.01)];
                    let yaw = yaw_of(d);
                    let (sx, sz) = (3.4, 3.0);
                    let p = [c[0] + rng.range(-1.0, 1.0), c[1] + rng.range(-1.0, 1.0)];
                    let corners = [[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]];
                    let ok = corners.iter().all(|k| {
                        let lx = k[0] * sx * 0.5;
                        let lz = k[1] * sz * 0.5;
                        let w = [p[0] + lx * yaw.cos() + lz * yaw.sin(), p[1] - lx * yaw.sin() + lz * yaw.cos()];
                        inside(w)
                    });
                    if ok {
                        let col = rng.pick(&[0x6f8fb3, 0xe8e4dc, 0x8fae7d, 0xc96b4b, 0x9db7c9]);
                        self.bx([p[0], h, p[1]], yaw, [sx, 2.4, sz], rgb(col));
                        self.bx([p[0], h + 2.4, p[1]], yaw, [sx + 0.3, 0.1, sz + 0.3], rgb(0x6a6d70));
                    }
                }
            }
            if (b.kind == kind::COMMERCIAL || b.kind == kind::OTHER) && area > 220.0 {
                let k = 2 + (rng.f() * 4.0) as usize;
                for _ in 0..k {
                    let p = [c[0] + rng.range(-5.0, 5.0), c[1] + rng.range(-5.0, 5.0)];
                    if inside(p) {
                        self.bx([p[0], h, p[1]], rng.range(0.0, 1.0), [1.0, 0.9, 0.7], rgb(0xc9c7bf));
                    }
                }
            }
        }
    }

    fn place_streets(&mut self, ctx: &mut Ctx) {
        let m = ctx.m;
        // Junctions: road vertices shared by 2+ roads (0.5 m grid).
        let mut verts: HashMap<(i32, i32), Vec<(usize, usize)>> = HashMap::new();
        for (ri, r) in m.roads.iter().enumerate() {
            for (vi, p) in r.pts.iter().enumerate() {
                verts.entry(((p[0] * 2.0).round() as i32, (p[1] * 2.0).round() as i32)).or_default().push((ri, vi));
            }
        }
        let mut junction_pts: Vec<P2> = Vec::new();
        for (key, list) in &verts {
            let mut roads: Vec<usize> = list.iter().map(|x| x.0).collect();
            roads.sort();
            roads.dedup();
            if roads.len() < 2 {
                continue;
            }
            let jp = [key.0 as f32 * 0.5, key.1 as f32 * 0.5];
            junction_pts.push(jp);
            let max_half = roads.iter().map(|&r| m.roads[r].width * 0.5).fold(0.0, f32::max);
            for &(ri, vi) in list {
                let r = &m.roads[ri];
                let base = r.kind & !ONEWAY;
                if !matches!(base, road::PRIMARY | road::SECONDARY | road::TERTIARY | road::LINK) {
                    continue;
                }
                for nb in [vi.wrapping_sub(1), vi + 1] {
                    if nb >= r.pts.len() {
                        continue;
                    }
                    let q = r.pts[nb];
                    let d = [q[0] - jp[0], q[1] - jp[1]];
                    let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
                    let off = max_half + 2.5;
                    if len < off + 4.0 {
                        continue;
                    }
                    let dir = [d[0] / len, d[1] / len];
                    let cpos = [jp[0] + dir[0] * (off + 2.0), jp[1] + dir[1] * (off + 2.0)];
                    self.crosswalks.extend_from_slice(&[cpos[0], cpos[1], yaw_of(dir), r.width, 3.6]);
                    if matches!(base, road::PRIMARY | road::SECONDARY) {
                        // Traffic light on the right side, facing oncoming traffic.
                        let side = [dir[1], -dir[0]];
                        let tp = [cpos[0] - side[0] * (r.width * 0.5 + 0.9), cpos[1] - side[1] * (r.width * 0.5 + 0.9)];
                        let yaw = yaw_of(dir);
                        self.cyl([tp[0], 0.0, tp[1]], 0.1, 5.2, 6, rgb(0x5b6066));
                        let arm = [tp[0] + side[0] * 2.2, tp[1] + side[1] * 2.2];
                        self.bx([tp[0] + side[0] * 1.1, 5.0, tp[1] + side[1] * 1.1], yaw_of(side), [0.1, 0.1, 2.2], rgb(0x5b6066));
                        self.bx([arm[0], 4.55, arm[1]], yaw, [1.2, 0.42, 0.3], rgb(0x1e2124));
                        let red = [arm[0] + dir[0] * 0.16, arm[1] + dir[1] * 0.16];
                        self.bx([red[0] - side[0] * 0.38, 4.62, red[1] - side[1] * 0.38], yaw, [0.24, 0.24, 0.02], glow(0xff3020));
                        self.bx([red[0] + side[0] * 0.38, 4.62, red[1] + side[1] * 0.38], yaw, [0.24, 0.24, 0.02], glow(0x20e070));
                    }
                }
            }
        }
        let near_junction = |p: P2, r: f32| junction_pts.iter().any(|j| crate::geom::dist2(*j, p) < r * r);

        for (ri, r) in m.roads.iter().enumerate() {
            let base = r.kind & !ONEWAY;
            let oneway = r.kind & ONEWAY != 0;
            let half = r.width * 0.5;
            let mut rng = Rng::new(ri as u32 * 1013 + 17);
            let major = matches!(base, road::PRIMARY | road::SECONDARY | road::TERTIARY);
            let alley = matches!(base, road::RESIDENTIAL | road::SERVICE);
            // Walk the polyline emitting points every `step` meters.
            let walk = |step: f32, start: f32, f: &mut dyn FnMut(P2, P2)| {
                let mut carry = start;
                for s in r.pts.windows(2) {
                    let d = [s[1][0] - s[0][0], s[1][1] - s[0][1]];
                    let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
                    if len < 1e-3 {
                        continue;
                    }
                    let dir = [d[0] / len, d[1] / len];
                    let mut t = carry;
                    while t < len {
                        f([s[0][0] + dir[0] * t, s[0][1] + dir[1] * t], dir);
                        t += step;
                    }
                    carry = t - len;
                }
            };

            if major {
                let sides: &[f32] = if oneway { &[-1.0] } else { &[1.0, -1.0] };
                // Procedural ginkgo rows only when the map has no surveyed trees.
                let mut trees = Vec::new();
                if m.trees.is_empty() {
                    walk(9.0, 4.0, &mut |p, dir| trees.push((p, dir)));
                }
                for &(p, dir) in &trees {
                    for &sd in sides {
                        let nrm = [dir[1] * sd, -dir[0] * sd];
                        let q = [p[0] + nrm[0] * (half + 1.3), p[1] + nrm[1] * (half + 1.3)];
                        if near_junction(q, half + 6.0) || ctx.in_building(q, 1.2) {
                            continue;
                        }
                        let mut tr = Rng::new((q[0] * 13.0) as i32 as u32 ^ (q[1] * 7.0) as i32 as u32);
                        // Ginkgo street tree (instanced model, yellow in late November).
                        let sc = tr.range(0.85, 1.15);
                        self.inst(M_TREE, [q[0], 0.1, q[1]], tr.range(0.0, 6.28), [sc, sc * tr.range(0.92, 1.12), sc]);
                        // Tree guard grate
                        self.bx([q[0], 0.0, q[1]], yaw_of(dir), [1.2, 0.1, 1.2], rgb(0x3b3b3b));
                    }
                }
                // Street lamps.
                let mut lamps = Vec::new();
                walk(30.0, 12.0, &mut |p, dir| lamps.push((p, dir)));
                for &(p, dir) in &lamps {
                    for &sd in sides {
                        let nrm = [dir[1] * sd, -dir[0] * sd];
                        let q = [p[0] + nrm[0] * (half + 0.55), p[1] + nrm[1] * (half + 0.55)];
                        if ctx.in_building(q, 0.6) {
                            continue;
                        }
                        let inward = [-nrm[0], -nrm[1]];
                        self.cyl([q[0], 0.0, q[1]], 0.09, 8.2, 6, rgb(0x4a4f55));
                        self.bx([q[0] + inward[0] * 0.9, 8.05, q[1] + inward[1] * 0.9], yaw_of(inward), [0.08, 0.1, 1.8], rgb(0x4a4f55));
                        let hp = [q[0] + inward[0] * 1.75, q[1] + inward[1] * 1.75];
                        self.bx([hp[0], 7.9, hp[1]], yaw_of(inward), [0.32, 0.12, 0.62], glow(0xfff1d0));
                        self.lamps.extend_from_slice(&[hp[0], hp[1]]);
                    }
                }
                // Telecom / power cabinets on the pavement, facing the road.
                let mut cab = Vec::new();
                walk(85.0, 33.0, &mut |p, dir| cab.push((p, dir)));
                for &(p, dir) in &cab {
                    // One-way carriageways only have the right-hand pavement (the other side is the median).
                    let sd = if oneway || rng.f() < 0.5 { -1.0 } else { 1.0 };
                    let nrm = [dir[1] * sd, -dir[0] * sd];
                    let q = [p[0] + nrm[0] * (half + 1.05), p[1] + nrm[1] * (half + 1.05)];
                    if ctx.in_building(q, 0.7) || near_junction(q, half + 5.0) {
                        continue;
                    }
                    let yaw = yaw_of([-nrm[0], -nrm[1]]);
                    self.inst(M_POWERBOX, [q[0], 0.1, q[1]], yaw, [1.0, 1.0, 1.0]);
                    self.obstacle(q, yaw, 0.48, 0.23, 1.1);
                }
                // Manhole covers along the carriageway.
                let mut mh = Vec::new();
                walk(52.0, 21.0, &mut |p, dir| mh.push((p, dir)));
                for &(p, dir) in &mh {
                    let lat = rng.range(-0.35, 0.35) * half;
                    let q = [p[0] + dir[1] * lat, p[1] - dir[0] * lat];
                    if near_junction(q, half + 3.0) {
                        continue;
                    }
                    self.inst(M_MANHOLE, [q[0], 0.1, q[1]], rng.range(0.0, 6.28), [1.0, 0.15, 1.0]);
                }
            } else if base == road::PEDESTRIAN {
                let mut lamps = Vec::new();
                walk(22.0, 6.0, &mut |p, dir| lamps.push((p, dir)));
                for &(p, dir) in &lamps {
                    let nrm = [dir[1], -dir[0]];
                    let q = [p[0] + nrm[0] * (half - 0.6), p[1] + nrm[1] * (half - 0.6)];
                    if ctx.in_building(q, 0.5) {
                        continue;
                    }
                    self.cyl([q[0], 0.0, q[1]], 0.07, 4.2, 6, rgb(0x2f3438));
                    self.ico([q[0], 4.4, q[1]], 0.0, [0.5, 0.5, 0.5], glow(0xffe2b0));
                    self.lamps.extend_from_slice(&[q[0], q[1]]);
                }
            }

            if alley || base == road::TERTIARY {
                // Utility poles on one side with sagging wires (전봇대와 전선).
                let side = if rng.f() < 0.5 { 1.0 } else { -1.0 };
                let mut poles: Vec<(P2, P2)> = Vec::new();
                walk(27.0, 5.0, &mut |p, dir| poles.push((p, dir)));
                let mut placed: Vec<(P2, P2)> = Vec::new();
                for &(p, dir) in &poles {
                    let mut ok = None;
                    for sd in [side, -side] {
                        let nrm = [dir[1] * sd, -dir[0] * sd];
                        let q = [p[0] + nrm[0] * (half + 0.35), p[1] + nrm[1] * (half + 0.35)];
                        if !ctx.in_building(q, 0.3) {
                            ok = Some(q);
                            break;
                        }
                    }
                    if let Some(q) = ok {
                        // A cabinet at the foot of some poles.
                        if rng.f() < 0.18 {
                            let inward = [p[0] - q[0], p[1] - q[1]];
                            let il = (inward[0] * inward[0] + inward[1] * inward[1]).sqrt().max(1e-3);
                            let inward = [inward[0] / il, inward[1] / il];
                            let cq = [q[0] + dir[0] * 0.9 - inward[0] * 0.1, q[1] + dir[1] * 0.9 - inward[1] * 0.1];
                            if !ctx.in_building(cq, 0.5) {
                                let yaw = yaw_of(inward);
                                self.inst(M_POWERBOX, [cq[0], 0.0, cq[1]], yaw, [0.8, 0.9, 0.8]);
                                self.obstacle(cq, yaw, 0.38, 0.19, 1.0);
                            }
                        }
                        self.cyl([q[0], 0.0, q[1]], 0.15, 10.5, 7, rgb(0x8f8f8a));
                        let across = [dir[1], -dir[0]];
                        self.bx([q[0], 9.75, q[1]], yaw_of(across), [0.1, 0.12, 1.7], rgb(0x5b5b58));
                        if rng.f() < 0.35 {
                            self.cyl([q[0] + dir[0] * 0.35, 8.1, q[1] + dir[1] * 0.35], 0.26, 0.85, 7, rgb(0x6d7276));
                        }
                        placed.push((q, across));
                    }
                }
                for w in placed.windows(2) {
                    let (a, aa) = w[0];
                    let (b, _) = w[1];
                    let span = crate::geom::dist2(a, b).sqrt();
                    if span > 45.0 {
                        continue;
                    }
                    for (lat, hgt, sag) in [(0.75, 9.8, 0.45), (-0.75, 9.8, 0.45), (0.0, 9.15, 0.6), (0.2, 7.9, 0.9), (-0.25, 7.6, 1.1)] {
                        let pa = [a[0] + aa[0] * lat, hgt, a[1] + aa[1] * lat];
                        let pb = [b[0] + aa[0] * lat, hgt, b[1] + aa[1] * lat];
                        self.wire(pa, pb, sag + span * 0.008, 8);
                    }
                }
                // Cars parked along alleys (one or both kerbs); a few under covers.
                if alley && half > 2.2 {
                    let mut spots = Vec::new();
                    walk(6.2, 4.0, &mut |p, dir| spots.push((p, dir)));
                    let both = half > 3.4;
                    let main_side = if rng.f() < 0.5 { 1.0 } else { -1.0 };
                    for &(p, dir) in &spots {
                        for sd in [main_side, -main_side] {
                            if sd != main_side && !both {
                                continue;
                            }
                            let chance = if sd == main_side { 0.5 } else { 0.22 };
                            if rng.f() > chance {
                                continue;
                            }
                            let ty = pick_car(&mut rng, false);
                            let (hw, hl) = CAR_HALF[ty as usize];
                            let nrm = [dir[1] * sd, -dir[0] * sd];
                            let off = half - hw - 0.2;
                            let q = [p[0] + nrm[0] * off, p[1] + nrm[1] * off];
                            if ctx.in_building(q, hw + 0.4) || near_junction(q, half + 6.5) {
                                continue;
                            }
                            let yaw = yaw_of(dir) + if rng.f() < 0.5 { std::f32::consts::PI } else { 0.0 };
                            if rng.f() < 0.12 {
                                self.inst(M_COVEREDCAR, [q[0], 0.0, q[1]], yaw, [1.0, 1.0, 1.0]);
                                self.obstacle(q, yaw, 0.86, 2.1, 1.4);
                            } else {
                                self.parked.extend_from_slice(&[q[0], q[1], yaw, ty as f32, rng.range(0.0, 1000.0).floor()]);
                                self.obstacle(q, yaw, hw, hl, 1.4);
                            }
                        }
                    }
                }
                // Occasional kerbside stops on two-way main streets (taxis, delivery trucks).
                if major && !oneway && half < 9.0 {
                    let mut spots = Vec::new();
                    walk(23.0, 11.0, &mut |p, dir| spots.push((p, dir)));
                    for &(p, dir) in &spots {
                        if rng.f() > 0.16 {
                            continue;
                        }
                        let ty = pick_car(&mut rng, true);
                        let (hw, hl) = CAR_HALF[ty as usize];
                        // Right-hand traffic: park on the right kerb of the travel direction.
                        let sd = if rng.f() < 0.5 { 1.0 } else { -1.0 };
                        let nrm = [dir[1] * -sd, -dir[0] * -sd];
                        let off = half - hw - 0.25;
                        let q = [p[0] + nrm[0] * off, p[1] + nrm[1] * off];
                        if near_junction(q, half + 10.0) || ctx.in_building(q, hw + 0.4) {
                            continue;
                        }
                        let fwd = if sd > 0.0 { dir } else { [-dir[0], -dir[1]] };
                        let yaw = yaw_of(fwd);
                        self.parked.extend_from_slice(&[q[0], q[1], yaw, ty as f32, rng.range(0.0, 1000.0).floor()]);
                        self.obstacle(q, yaw, hw, hl, 1.4);
                    }
                }
                // Service drops to nearby buildings.
                for &(q, _) in &placed {
                    if rng.f() < 0.55 {
                        if let Some((wp, wn)) = ctx.wall_near(q, 14.0) {
                            let pa = [q[0], 8.3, q[1]];
                            let pb = [wp[0] + wn[0] * 0.05, 6.2, wp[1] + wn[1] * 0.05];
                            self.wire(pa, pb, 0.5, 6);
                        }
                    }
                }
            }
        }
    }

    /// Surveyed street trees (서울시 가로수 위치정보): species model, size
    /// variation, and an iron guard grate where the tree stands in a main-road
    /// pavement. Survey points that land on a carriageway are nudged to its edge.
    fn place_trees(&mut self, ctx: &mut Ctx) {
        let m = ctx.m;
        for t in &m.trees {
            let mut p = [t.x, t.z];
            let mut main = false;
            for _ in 0..2 {
                if let Some((q, k)) = ctx.out_of_carriageway(p, 0.9) {
                    p = q;
                    main |= matches!(k & !ONEWAY, road::PRIMARY | road::SECONDARY | road::TERTIARY);
                }
            }
            if ctx.in_building(p, 0.5) {
                continue;
            }
            if let Some((d, k)) = ctx.road_near(p, 4.5) {
                main |= d > -0.2 && matches!(k & !ONEWAY, road::PRIMARY | road::SECONDARY | road::TERTIARY);
            }
            let mut tr = Rng::new((p[0] * 13.0) as i32 as u32 ^ ((p[1] * 7.0) as i32 as u32).rotate_left(16));
            let sc = 0.82 + t.size as f32 / 255.0 * 0.4;
            let model = M_TREE + t.species.min(crate::data::species::COUNT - 1);
            self.inst(model, [p[0], 0.0, p[1]], tr.range(0.0, 6.28), [sc, sc * tr.range(0.92, 1.1), sc]);
            if main {
                // 가로수 보호판: square cast-iron grate flush with the pavement.
                let yaw = ctx.road_dir(p).map_or(0.0, yaw_of);
                self.bx([p[0], 0.0, p[1]], yaw, [1.3, 0.02, 1.3], rgb(0x2e2f30));
            }
        }
    }

    /// Bus stops: Seoul roadside shelters, pole signs and the median platforms
    /// of the Yanghwa-ro bus lane (홍대입구: 스마트쉘터 on a 3-berth platform).
    fn place_stops(&mut self, ctx: &mut Ctx) {
        use crate::data::stop;
        let m = ctx.m;
        for s in &m.stops {
            let face = [s.yaw.sin(), s.yaw.cos()];
            let along = [face[1], -face[0]];
            let c = [s.x, s.z];
            match s.kind {
                stop::MEDIAN | stop::MEDIAN_SMART => {
                    let smart = s.kind == stop::MEDIAN_SMART;
                    let (hl, hw, ph) = (if smart { 24.0 } else { 15.0 }, 1.45, 0.22);
                    let corner = |i: f32, j: f32| [c[0] + along[0] * hl * i + face[0] * hw * j, c[1] + along[1] * hl * i + face[1] * hw * j];
                    let quad = [corner(-1.0, -1.0), corner(1.0, -1.0), corner(1.0, 1.0), corner(-1.0, 1.0)];
                    self.platforms.push((quad, ph));
                    // Platform slab with a granite edge, safety fence on the traffic side.
                    self.bx([c[0], 0.0, c[1]], yaw_of(along), [hw * 2.0, ph, hl * 2.0], rgb(0x9a9890));
                    let edge = [c[0] + face[0] * (hw - 0.15), c[1] + face[1] * (hw - 0.15)];
                    self.bx([edge[0], ph, edge[1]], yaw_of(along), [0.3, 0.005, hl * 2.0 - 0.4], rgb(0xd8d4c6));
                    let back = [c[0] - face[0] * (hw - 0.06), c[1] - face[1] * (hw - 0.06)];
                    self.bx([back[0], ph, back[1]], yaw_of(along), [0.05, 1.05, hl * 2.0 - 1.0], [180, 196, 200, 255]);
                    self.bx([back[0], ph + 1.05, back[1]], yaw_of(along), [0.08, 0.05, hl * 2.0 - 1.0], rgb(0x4a4f55));
                    self.obstacle(back, s.yaw, hl - 0.5, 0.08, 1.2);
                    // Tactile line along the platform edge, dots at each berth door.
                    self.tactile.extend_from_slice(&[edge[0] - face[0] * 0.45, 0.0, edge[1] - face[1] * 0.45, yaw_of(along), 0.3, hl * 2.0 - 1.0, TACTILE_LINES]);
                    if smart {
                        self.inst(M_SMART_SHELTER, [c[0] - face[0] * 0.2, ph, c[1] - face[1] * 0.2], s.yaw, [1.0, 1.0, 1.0]);
                        self.obstacle([c[0] - face[0] * 0.2, c[1] - face[1] * 0.2], s.yaw, 6.2, 1.2, 3.2);
                    } else {
                        self.inst(M_SHELTER, [c[0] - face[0] * 0.35, ph, c[1] - face[1] * 0.35], s.yaw, [1.0, 1.0, 1.0]);
                        self.obstacle([c[0] - face[0] * 0.9, c[1] - face[1] * 0.9], s.yaw, 3.9, 0.12, 2.6);
                    }
                }
                stop::SHELTER | stop::SMART => {
                    if ctx.in_building(c, 0.3) {
                        continue;
                    }
                    self.inst(M_SHELTER, [c[0], 0.0, c[1]], s.yaw, [1.0, 1.0, 1.0]);
                    let back = [c[0] - face[0] * 0.75, c[1] - face[1] * 0.75];
                    self.obstacle(back, s.yaw, 3.9, 0.12, 2.6);
                    let pad = [c[0] + face[0] * 1.0 + along[0] * 2.8, c[1] + face[1] * 1.0 + along[1] * 2.8];
                    self.tactile.extend_from_slice(&[pad[0], 0.0, pad[1], s.yaw, 0.9, 0.6, TACTILE_DOTS]);
                }
                _ => {
                    if ctx.in_building(c, 0.2) {
                        continue;
                    }
                    self.inst(M_STOP_POLE, [c[0], 0.0, c[1]], s.yaw, [1.0, 1.0, 1.0]);
                    self.obstacle(c, s.yaw, 0.12, 0.12, 3.0);
                    let pad = [c[0] + along[0] * 0.8, c[1] + along[1] * 0.8];
                    self.tactile.extend_from_slice(&[pad[0], 0.0, pad[1], s.yaw, 0.6, 0.6, TACTILE_DOTS]);
                }
            }
        }
    }

    /// Second pass once the walking surface is known: crossing kit, then sit
    /// ground-level props on raised pavements, ramps and platforms.
    pub fn finish(&mut self, m: &MapData, g: &crate::kerb::Ground) {
        let mut ctx = make_ctx(m);
        self.place_crossing_kit(&mut ctx, g);
        self.prim_count = self.cells.values().map(|v| v.len()).sum();
        self.lift(g);
    }

    /// At every crosswalk end on a raised pavement: a band of dot blocks across
    /// the ramp 30 cm back from the kerb with a guide line into the pavement
    /// (교통약자 편의시설 기준), and on the main roads a folded shade parasol
    /// (접이식 그늘막, wrapped for the winter from November).
    fn place_crossing_kit(&mut self, ctx: &mut Ctx, g: &crate::kerb::Ground) {
        let cw = self.crosswalks.clone();
        for c in cw.chunks(5) {
            let (sn, cs) = c[2].sin_cos();
            let az = [sn, cs];
            let ax = [cs, -sn];
            let (half_w, half_l) = (c[3] * 0.5, c[4] * 0.5);
            let Some((_, kind)) = ctx.road_near([c[0], c[1]], 0.0) else { continue };
            let sw = crate::kerb::pavement_width(kind);
            if sw <= 0.0 {
                continue;
            }
            let mut rng = Rng::new((c[0] * 31.0) as i32 as u32 ^ ((c[1] * 17.0) as i32 as u32).rotate_left(11));
            for side in [-1.0f32, 1.0] {
                let out = [ax[0] * side, ax[1] * side];
                let band = [c[0] + out[0] * (half_w + 0.6), c[1] + out[1] * (half_w + 0.6)];
                // Only where this end of the crossing lands on a raised pavement
                // (not the median of a dual carriageway).
                let top = [c[0] + out[0] * (half_w + 2.0), c[1] + out[1] * (half_w + 2.0)];
                if ctx.in_building(band, 0.0) || g.height(top) < crate::kerb::KERB_H - 0.01 {
                    continue;
                }
                // Dot band across the crosswalk width (local x = along the kerb).
                self.tactile.extend_from_slice(&[band[0], 0.0, band[1], yaw_of(out), half_l * 2.0, 0.6, TACTILE_DOTS]);
                let line_len = (sw - 1.2).max(0.6);
                let lc = [band[0] + out[0] * (0.3 + line_len * 0.5), band[1] + out[1] * (0.3 + line_len * 0.5)];
                if !ctx.in_building(lc, 0.0) {
                    self.tactile.extend_from_slice(&[lc[0], 0.0, lc[1], yaw_of(out), 0.3, line_len, TACTILE_LINES]);
                }
                let main = matches!(kind & !ONEWAY, road::PRIMARY | road::SECONDARY);
                if main && rng.f() < 0.7 {
                    let pp = [c[0] + out[0] * (half_w + 1.7) + az[0] * (half_l + 1.3), c[1] + out[1] * (half_w + 1.7) + az[1] * (half_l + 1.3)];
                    if !ctx.in_building(pp, 1.0) && g.height(pp) > crate::kerb::KERB_H - 0.01 {
                        self.inst(M_PARASOL, [pp[0], 0.0, pp[1]], rng.range(0.0, 6.28), [1.0, 1.0, 1.0]);
                        self.obstacle(pp, 0.0, 0.25, 0.25, 3.0);
                    }
                }
            }
        }
    }

    /// Sit ground-level props on the walking surface (raised pavements, ramps, platforms).
    fn lift(&mut self, g: &crate::kerb::Ground) {
        for list in self.cells.values_mut() {
            for pr in list.iter_mut() {
                if pr.pos[1] < 0.35 && pr.shape != SHAPE_OCT && pr.shape != SHAPE_ICO {
                    pr.pos[1] += g.height([pr.pos[0], pr.pos[2]]);
                }
            }
        }
        for list in self.insts.values_mut() {
            for it in list.iter_mut() {
                let m = it[0] as u8;
                // Manholes sit in the carriageway; everything else follows the ground.
                if it[2] < 0.35 && m != M_MANHOLE {
                    it[2] += g.height([it[1], it[3]]);
                }
            }
        }
        for t in self.tactile.chunks_mut(7) {
            t[1] = g.height([t[0], t[2]]);
        }
    }

    fn wire(&mut self, a: [f32; 3], b: [f32; 3], sag: f32, segs: usize) {
        let mut prev = a;
        for i in 1..=segs {
            let t = i as f32 / segs as f32;
            let p = [
                a[0] + (b[0] - a[0]) * t,
                a[1] + (b[1] - a[1]) * t - sag * 4.0 * t * (1.0 - t),
                a[2] + (b[2] - a[2]) * t,
            ];
            self.wires.extend_from_slice(&prev);
            self.wires.extend_from_slice(&p);
            prev = p;
        }
    }

    /// Cells that contain props: flattened (cx, cz, count).
    pub fn cell_list(&self) -> Vec<i32> {
        let mut v: Vec<(i32, i32, usize)> = self.cells.iter().map(|(k, p)| (k.0, k.1, p.len())).collect();
        for k in self.insts.keys() {
            if !self.cells.contains_key(k) {
                v.push((k.0, k.1, 0));
            }
        }
        v.sort();
        v.into_iter().flat_map(|(x, z, n)| [x, z, n as i32]).collect()
    }

    /// Build the merged mesh for one cell into the scratch buffer.
    pub fn build_cell(&mut self, cx: i32, cz: i32) -> usize {
        self.scratch.clear();
        if let Some(list) = self.cells.get(&(cx, cz)) {
            for pr in list {
                emit(&mut self.scratch, pr);
            }
        }
        self.scratch.idx.len()
    }
}

/// Soft contact shadow strips on the ground along building walls.
/// Night light spill from shop fronts onto the pavement: wide strips along
/// non-residential walls, drawn with multiply-add blending (albedo aware).
pub fn light_spill(m: &MapData) -> (Vec<f32>, Vec<u8>, Vec<u32>) {
    let mut pos = Vec::new();
    let mut alpha = Vec::new();
    let mut idx = Vec::new();
    for b in &m.buildings {
        if b.kind == crate::data::kind::RESIDENTIAL {
            continue;
        }
        let n = b.pts.len();
        for e in 0..n {
            let a = b.pts[e];
            let c = b.pts[(e + 1) % n];
            let d = [c[0] - a[0], c[1] - a[1]];
            let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
            if len < 2.0 {
                continue;
            }
            let nrm = [d[1] / len, -d[0] / len];
            let dir = [d[0] / len, d[1] / len];
            let w = 4.2;
            // Inset the ends so neighbouring strips do not double up at corners.
            let a2 = [a[0] + dir[0] * 0.4, a[1] + dir[1] * 0.4];
            let c2 = [c[0] - dir[0] * 0.4, c[1] - dir[1] * 0.4];
            let base = (pos.len() / 3) as u32;
            let y = 0.104;
            for (p, al) in [(a2, 255u8), (c2, 255u8), ([c2[0] + nrm[0] * w, c2[1] + nrm[1] * w], 0u8), ([a2[0] + nrm[0] * w, a2[1] + nrm[1] * w], 0u8)] {
                pos.extend_from_slice(&[p[0], y, p[1]]);
                alpha.push(al);
            }
            idx.extend_from_slice(&[base, base + 2, base + 3, base, base + 1, base + 2]);
        }
    }
    (pos, alpha, idx)
}

pub fn ao_skirts(m: &MapData) -> (Vec<f32>, Vec<u8>, Vec<u32>) {
    let mut pos = Vec::new();
    let mut alpha = Vec::new();
    let mut idx = Vec::new();
    for b in &m.buildings {
        let n = b.pts.len();
        for e in 0..n {
            let a = b.pts[e];
            let c = b.pts[(e + 1) % n];
            let d = [c[0] - a[0], c[1] - a[1]];
            let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
            if len < 0.5 {
                continue;
            }
            let nrm = [d[1] / len, -d[0] / len];
            let w = 1.6;
            let base = (pos.len() / 3) as u32;
            let y = 0.098;
            for (p, al) in [(a, 150u8), (c, 150u8), ([c[0] + nrm[0] * w, c[1] + nrm[1] * w], 0u8), ([a[0] + nrm[0] * w, a[1] + nrm[1] * w], 0u8)] {
                pos.extend_from_slice(&[p[0], y, p[1]]);
                alpha.push(al);
            }
            // Winding chosen so the strip faces +y.
            idx.extend_from_slice(&[base, base + 2, base + 3, base, base + 1, base + 2]);
        }
    }
    (pos, alpha, idx)
}
