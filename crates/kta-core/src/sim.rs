//! Simulation: player movement with building collision, and pedestrians.
//! Uses a uniform grid of wall segments; no physics engine is needed yet.

use crate::data::{road, MapData};
use crate::geom::{closest_on_segment, P2};

pub struct SegGrid {
    pub min: P2,
    pub cell: f32,
    pub w: usize,
    pub h: usize,
    pub cells: Vec<Vec<u32>>,
    pub segs: Vec<[P2; 2]>,
    /// Wall height per segment (for the camera ray test).
    pub heights: Vec<f32>,
}

impl SegGrid {
    pub fn new(m: &MapData, cell: f32) -> SegGrid {
        SegGrid::with_obstacles(m, cell, &[])
    }

    /// Walls plus extra solid footprints (corner quads with a height), e.g.
    /// parked cars and street cabinets from the prop generator.
    pub fn with_obstacles(m: &MapData, cell: f32, obstacles: &[([P2; 4], f32)]) -> SegGrid {
        let mut segs = Vec::new();
        let mut heights = Vec::new();
        let mut mn = [f32::MAX, f32::MAX];
        let mut mx = [f32::MIN, f32::MIN];
        for b in &m.buildings {
            let n = b.pts.len();
            for i in 0..n {
                let a = b.pts[i];
                let c = b.pts[(i + 1) % n];
                segs.push([a, c]);
                heights.push(b.height + if b.height > 5.0 { 0.9 } else { 0.0 });
                for p in [a, c] {
                    mn[0] = mn[0].min(p[0]);
                    mn[1] = mn[1].min(p[1]);
                    mx[0] = mx[0].max(p[0]);
                    mx[1] = mx[1].max(p[1]);
                }
            }
        }
        // Standing light boxes on the pavement are solid too (low: the camera
        // ray passes over them).
        for sg in m.signs.iter().filter(|s| s.mount == 3) {
            let (sn, cs) = sg.yaw.sin_cos();
            let ax = [cs, -sn]; // face width axis
            let az = [sn, cs]; // face normal
            let (hx, hz) = (sg.w * 0.5 + 0.07, 0.22);
            let c = [sg.x, sg.z];
            let corner = |i: f32, j: f32| [c[0] + ax[0] * hx * i + az[0] * hz * j, c[1] + ax[1] * hx * i + az[1] * hz * j];
            let q = [corner(-1.0, -1.0), corner(1.0, -1.0), corner(1.0, 1.0), corner(-1.0, 1.0)];
            for i in 0..4 {
                segs.push([q[i], q[(i + 1) % 4]]);
                heights.push(1.2);
            }
        }
        for (q, hgt) in obstacles {
            for i in 0..4 {
                segs.push([q[i], q[(i + 1) % 4]]);
                heights.push(*hgt);
            }
        }
        if segs.is_empty() {
            mn = [0.0, 0.0];
            mx = [1.0, 1.0];
        }
        let w = (((mx[0] - mn[0]) / cell).ceil() as usize).max(1) + 1;
        let h = (((mx[1] - mn[1]) / cell).ceil() as usize).max(1) + 1;
        let mut cells = vec![Vec::new(); w * h];
        for (i, s) in segs.iter().enumerate() {
            let x0 = ((s[0][0].min(s[1][0]) - mn[0]) / cell).floor().max(0.0) as usize;
            let x1 = ((s[0][0].max(s[1][0]) - mn[0]) / cell).floor().max(0.0) as usize;
            let z0 = ((s[0][1].min(s[1][1]) - mn[1]) / cell).floor().max(0.0) as usize;
            let z1 = ((s[0][1].max(s[1][1]) - mn[1]) / cell).floor().max(0.0) as usize;
            for z in z0..=z1.min(h - 1) {
                for x in x0..=x1.min(w - 1) {
                    cells[z * w + x].push(i as u32);
                }
            }
        }
        SegGrid { min: mn, cell, w, h, cells, segs, heights }
    }

    /// First wall hit along the 3D segment a -> b (x, y, z), as a fraction of
    /// its length in [0, 1] (1 = clear). Used to keep the camera out of walls.
    pub fn raycast(&self, a: [f32; 3], b: [f32; 3]) -> f32 {
        let (x0, x1) = (a[0].min(b[0]), a[0].max(b[0]));
        let (z0, z1) = (a[2].min(b[2]), a[2].max(b[2]));
        let cx0 = (((x0 - self.min[0]) / self.cell).floor() as i64).max(0);
        let cx1 = (((x1 - self.min[0]) / self.cell).floor() as i64).min(self.w as i64 - 1);
        let cz0 = (((z0 - self.min[1]) / self.cell).floor() as i64).max(0);
        let cz1 = (((z1 - self.min[1]) / self.cell).floor() as i64).min(self.h as i64 - 1);
        let d = [b[0] - a[0], b[2] - a[2]];
        let mut best = 1.0f32;
        for z in cz0..=cz1 {
            for x in cx0..=cx1 {
                for &si in &self.cells[z as usize * self.w + x as usize] {
                    let s = self.segs[si as usize];
                    let e = [s[1][0] - s[0][0], s[1][1] - s[0][1]];
                    let den = d[0] * e[1] - d[1] * e[0];
                    if den.abs() < 1e-8 {
                        continue;
                    }
                    let w = [s[0][0] - a[0], s[0][1] - a[2]];
                    let t = (w[0] * e[1] - w[1] * e[0]) / den;
                    let u = (w[0] * d[1] - w[1] * d[0]) / den;
                    if t >= 0.0 && t < best && (0.0..=1.0).contains(&u) {
                        let y = a[1] + (b[1] - a[1]) * t;
                        if y < self.heights[si as usize] {
                            best = t;
                        }
                    }
                }
            }
        }
        best
    }

    /// Push a circle out of nearby wall segments.
    pub fn resolve(&self, p: &mut P2, r: f32) {
        for _ in 0..3 {
            let cx = ((p[0] - self.min[0]) / self.cell).floor() as i64;
            let cz = ((p[1] - self.min[1]) / self.cell).floor() as i64;
            let mut moved = false;
            for dz in -1..=1 {
                for dx in -1..=1 {
                    let x = cx + dx;
                    let z = cz + dz;
                    if x < 0 || z < 0 || x >= self.w as i64 || z >= self.h as i64 {
                        continue;
                    }
                    for &si in &self.cells[z as usize * self.w + x as usize] {
                        let s = self.segs[si as usize];
                        let (c, _) = closest_on_segment(*p, s[0], s[1]);
                        let d = [p[0] - c[0], p[1] - c[1]];
                        let l2 = d[0] * d[0] + d[1] * d[1];
                        if l2 < r * r {
                            let l = l2.sqrt();
                            let (nx, nz) = if l > 1e-5 {
                                (d[0] / l, d[1] / l)
                            } else {
                                // On the wall: push along the outward normal.
                                let e = [s[1][0] - s[0][0], s[1][1] - s[0][1]];
                                let el = (e[0] * e[0] + e[1] * e[1]).sqrt().max(1e-5);
                                (e[1] / el, -e[0] / el)
                            };
                            p[0] += nx * (r - l);
                            p[1] += nz * (r - l);
                            moved = true;
                        }
                    }
                }
            }
            if !moved {
                break;
            }
        }
    }
}

pub mod input {
    pub const FWD: u32 = 1;
    pub const BACK: u32 = 2;
    pub const LEFT: u32 = 4;
    pub const RIGHT: u32 = 8;
    pub const RUN: u32 = 16;
}

/// Player state laid out for zero-copy reads from JS: x, y, z, yaw, speed, phase.
#[derive(Default)]
pub struct Player {
    pub state: [f32; 6],
    vel: P2,
}

impl Player {
    pub fn step(&mut self, grid: &SegGrid, dt: f32, bits: u32, fwd: P2) {
        let right = [-fwd[1], fwd[0]];
        let mut mv = [0.0f32, 0.0f32];
        if bits & input::FWD != 0 {
            mv[0] += fwd[0];
            mv[1] += fwd[1];
        }
        if bits & input::BACK != 0 {
            mv[0] -= fwd[0];
            mv[1] -= fwd[1];
        }
        if bits & input::RIGHT != 0 {
            mv[0] += right[0];
            mv[1] += right[1];
        }
        if bits & input::LEFT != 0 {
            mv[0] -= right[0];
            mv[1] -= right[1];
        }
        let l = (mv[0] * mv[0] + mv[1] * mv[1]).sqrt();
        let speed = if bits & input::RUN != 0 { 5.2 } else { 1.8 };
        let target = if l > 1e-4 { [mv[0] / l * speed, mv[1] / l * speed] } else { [0.0, 0.0] };
        let k = (dt * 10.0).min(1.0);
        self.vel[0] += (target[0] - self.vel[0]) * k;
        self.vel[1] += (target[1] - self.vel[1]) * k;
        let mut p = [self.state[0], self.state[2]];
        p[0] += self.vel[0] * dt;
        p[1] += self.vel[1] * dt;
        grid.resolve(&mut p, 0.32);
        self.state[0] = p[0];
        self.state[2] = p[1];
        let sp = (self.vel[0] * self.vel[0] + self.vel[1] * self.vel[1]).sqrt();
        if sp > 0.2 {
            let want = self.vel[0].atan2(self.vel[1]);
            let mut d = want - self.state[3];
            while d > std::f32::consts::PI {
                d -= std::f32::consts::TAU;
            }
            while d < -std::f32::consts::PI {
                d += std::f32::consts::TAU;
            }
            self.state[3] += d * (dt * 12.0).min(1.0);
        }
        self.state[4] = sp;
        self.state[5] = (self.state[5] + dt * sp * 1.9) % 1000.0;
    }
}

/// Pedestrians walking along walkable polylines. SoA output: x, z, yaw, phase.
pub struct Crowd {
    pub out: Vec<f32>,
    agents: Vec<Agent>,
    paths: Vec<Vec<P2>>,
    widths: Vec<f32>,
    /// Path index weighted by length, for respawning near the player.
    cum: Vec<f32>,
    seed: u32,
}

/// Pedestrians farther than this from the player are moved back near them.
const RECYCLE: f32 = 190.0;

struct Agent {
    path: usize,
    seg: usize,
    t: f32,
    dir: f32,
    speed: f32,
    lateral: f32,
    phase: f32,
}

fn rng(state: &mut u32) -> f32 {
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    (*state as f32) / (u32::MAX as f32)
}

impl Crowd {
    pub fn new(m: &MapData, count: usize, seed: u32) -> Crowd {
        let mut paths = Vec::new();
        let mut widths = Vec::new();
        for r in &m.roads {
            let base = r.kind & !crate::data::ONEWAY;
            let ok = matches!(
                base,
                road::PEDESTRIAN | road::FOOTWAY | road::RESIDENTIAL | road::SERVICE | road::TERTIARY | road::SECONDARY | road::PRIMARY
            );
            if ok && r.pts.len() >= 2 {
                paths.push(r.pts.clone());
                widths.push(match base {
                    road::PRIMARY | road::SECONDARY | road::TERTIARY => r.width * 0.5 + 1.5,
                    _ => (r.width * 0.5 - 0.6).max(0.0),
                });
            }
        }
        let mut s = seed | 1;
        let mut agents = Vec::new();
        if !paths.is_empty() {
            for _ in 0..count {
                let path = (rng(&mut s) * paths.len() as f32) as usize % paths.len();
                let segs = paths[path].len() - 1;
                let w = widths[path];
                let side = if rng(&mut s) < 0.5 { -1.0 } else { 1.0 };
                let lateral = if w > 3.0 { side * w } else { (rng(&mut s) * 2.0 - 1.0) * w };
                agents.push(Agent {
                    path,
                    seg: (rng(&mut s) * segs as f32) as usize % segs,
                    t: rng(&mut s),
                    dir: if rng(&mut s) < 0.5 { 1.0 } else { -1.0 },
                    speed: 1.0 + rng(&mut s) * 0.6,
                    lateral,
                    phase: rng(&mut s) * 10.0,
                });
            }
        }
        let out = vec![0.0; agents.len() * 4];
        let mut cum = Vec::with_capacity(paths.len());
        let mut acc = 0.0;
        for p in &paths {
            for w in p.windows(2) {
                acc += ((w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sqrt();
            }
            cum.push(acc);
        }
        let mut c = Crowd { out, agents, paths, widths, cum, seed: s };
        c.step(0.0, None);
        c
    }

    pub fn len(&self) -> usize {
        self.agents.len()
    }

    /// Put agent `i` on a random walkway point 40..150 m from `c` (keeps it if none is found).
    fn respawn(&mut self, i: usize, c: P2) {
        let total = *self.cum.last().unwrap_or(&0.0);
        if total <= 0.0 {
            return;
        }
        for _ in 0..24 {
            let r = rng(&mut self.seed) * total;
            let path = self.cum.partition_point(|&x| x < r).min(self.paths.len() - 1);
            let pts = &self.paths[path];
            let seg = (rng(&mut self.seed) * (pts.len() - 1) as f32) as usize % (pts.len() - 1);
            let t = rng(&mut self.seed);
            let p = [pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t];
            let d = ((p[0] - c[0]).powi(2) + (p[1] - c[1]).powi(2)).sqrt();
            if !(40.0..150.0).contains(&d) {
                continue;
            }
            let w = self.widths[path];
            let side = if rng(&mut self.seed) < 0.5 { -1.0 } else { 1.0 };
            let a = &mut self.agents[i];
            a.path = path;
            a.seg = seg;
            a.t = t;
            a.dir = if rng(&mut self.seed) < 0.5 { 1.0 } else { -1.0 };
            a.lateral = if w > 3.0 { side * w } else { (rng(&mut self.seed) * 2.0 - 1.0) * w };
            return;
        }
    }

    pub fn step(&mut self, dt: f32, player: Option<P2>) {
        if let Some(c) = player {
            for i in 0..self.agents.len() {
                let (x, z) = (self.out[i * 4], self.out[i * 4 + 1]);
                if ((x - c[0]).powi(2) + (z - c[1]).powi(2)).sqrt() > RECYCLE {
                    self.respawn(i, c);
                }
            }
        }
        for (i, a) in self.agents.iter_mut().enumerate() {
            let path = &self.paths[a.path];
            let p0 = path[a.seg];
            let p1 = path[a.seg + 1];
            let d = [p1[0] - p0[0], p1[1] - p0[1]];
            let len = (d[0] * d[0] + d[1] * d[1]).sqrt().max(0.01);
            a.t += a.dir * a.speed * dt / len;
            if a.t > 1.0 {
                if a.seg + 2 < path.len() {
                    a.seg += 1;
                    a.t -= 1.0;
                } else {
                    a.t = 1.0;
                    a.dir = -1.0;
                }
            } else if a.t < 0.0 {
                if a.seg > 0 {
                    a.seg -= 1;
                    a.t += 1.0;
                } else {
                    a.t = 0.0;
                    a.dir = 1.0;
                }
            }
            let p0 = path[a.seg];
            let p1 = path[a.seg + 1];
            let d = [p1[0] - p0[0], p1[1] - p0[1]];
            let len = (d[0] * d[0] + d[1] * d[1]).sqrt().max(0.01);
            let n = [d[1] / len, -d[0] / len];
            let x = p0[0] + d[0] * a.t + n[0] * a.lateral;
            let z = p0[1] + d[1] * a.t + n[1] * a.lateral;
            let yaw = (d[0] * a.dir).atan2(d[1] * a.dir);
            a.phase += dt * a.speed * 1.9;
            let o = i * 4;
            self.out[o] = x;
            self.out[o + 1] = z;
            self.out[o + 2] = yaw;
            self.out[o + 3] = a.phase;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::Building;

    #[test]
    fn camera_ray_hits_wall_below_roof_only() {
        let pts = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        let m = MapData { buildings: vec![Building { pts, height: 9.0, levels: 3, kind: 2, seed: 1, ..Default::default() }], ..Default::default() };
        let g = SegGrid::new(&m, 12.0);
        // From x = -5 towards x = 5 at head height: hits the wall at x = 0 (t = 0.5).
        let t = g.raycast([-5.0, 1.5, 5.0], [5.0, 1.5, 5.0]);
        assert!((t - 0.5).abs() < 1e-4, "{t}");
        // Above the parapet: clear.
        assert_eq!(g.raycast([-5.0, 12.0, 5.0], [5.0, 12.0, 5.0]), 1.0);
    }
}
