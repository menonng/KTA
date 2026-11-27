//! 2D geometry helpers on the (x, z) ground plane.
//!
//! Orientation convention: "CCW" means positive signed area when z is treated
//! as the math y axis. For a CCW polygon, the outward normal of edge d is
//! (d.z, -d.x).

pub type P2 = [f32; 2];

pub fn signed_area(p: &[P2]) -> f32 {
    let n = p.len();
    let mut a = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
    }
    a * 0.5
}

/// Remove duplicate, near-collinear and too-short vertices; make CCW.
pub fn clean_polygon(p: &mut Vec<P2>, min_edge: f32) {
    if p.len() > 1 && dist2(p[0], *p.last().unwrap()) < 1e-6 {
        p.pop();
    }
    let mut changed = true;
    while changed && p.len() >= 3 {
        changed = false;
        let n = p.len();
        for i in 0..n {
            let a = p[(i + n - 1) % n];
            let b = p[i];
            let c = p[(i + 1) % n];
            let short = dist2(a, b) < min_edge * min_edge;
            let ab = [b[0] - a[0], b[1] - a[1]];
            let bc = [c[0] - b[0], c[1] - b[1]];
            let cr = ab[0] * bc[1] - ab[1] * bc[0];
            let la = (ab[0] * ab[0] + ab[1] * ab[1]).sqrt();
            let lb = (bc[0] * bc[0] + bc[1] * bc[1]).sqrt();
            let collinear = la > 0.0 && lb > 0.0 && (cr / (la * lb)).abs() < 0.02 && (ab[0] * bc[0] + ab[1] * bc[1]) > 0.0;
            if short || collinear {
                p.remove(i);
                changed = true;
                break;
            }
        }
    }
    if p.len() >= 3 && signed_area(p) < 0.0 {
        p.reverse();
    }
}

#[inline]
pub fn dist2(a: P2, b: P2) -> f32 {
    let dx = a[0] - b[0];
    let dz = a[1] - b[1];
    dx * dx + dz * dz
}

#[inline]
fn cross(o: P2, a: P2, b: P2) -> f32 {
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

fn point_in_tri(p: P2, a: P2, b: P2, c: P2) -> bool {
    let d1 = cross(a, b, p);
    let d2 = cross(b, c, p);
    let d3 = cross(c, a, p);
    d1 >= 0.0 && d2 >= 0.0 && d3 >= 0.0
}

/// Ear-clipping triangulation of a CCW simple polygon.
/// Pushes local index triples (into `p`) to `out`. Falls back to a fan.
pub fn triangulate(p: &[P2], out: &mut Vec<u32>) {
    let n = p.len();
    if n < 3 {
        return;
    }
    let mut idx: Vec<usize> = (0..n).collect();
    let mut guard = 0;
    while idx.len() > 3 && guard < n * n {
        guard += 1;
        let m = idx.len();
        let mut clipped = false;
        for i in 0..m {
            let ia = idx[(i + m - 1) % m];
            let ib = idx[i];
            let ic = idx[(i + 1) % m];
            let (a, b, c) = (p[ia], p[ib], p[ic]);
            if cross(a, b, c) <= 1e-7 {
                continue; // reflex or degenerate
            }
            let mut inside = false;
            for &k in &idx {
                if k == ia || k == ib || k == ic {
                    continue;
                }
                if point_in_tri(p[k], a, b, c) {
                    inside = true;
                    break;
                }
            }
            if inside {
                continue;
            }
            out.extend_from_slice(&[ia as u32, ib as u32, ic as u32]);
            idx.remove(i);
            clipped = true;
            break;
        }
        if !clipped {
            break;
        }
    }
    if idx.len() == 3 {
        out.extend_from_slice(&[idx[0] as u32, idx[1] as u32, idx[2] as u32]);
    } else if idx.len() > 3 {
        for i in 1..idx.len() - 1 {
            out.extend_from_slice(&[idx[0] as u32, idx[i] as u32, idx[i + 1] as u32]);
        }
    }
}

/// Closest point on segment ab to p, and the parameter t in [0,1].
#[inline]
pub fn closest_on_segment(p: P2, a: P2, b: P2) -> (P2, f32) {
    let ab = [b[0] - a[0], b[1] - a[1]];
    let l2 = ab[0] * ab[0] + ab[1] * ab[1];
    if l2 < 1e-12 {
        return (a, 0.0);
    }
    let t = (((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2).clamp(0.0, 1.0);
    ([a[0] + ab[0] * t, a[1] + ab[1] * t], t)
}

pub fn point_in_polygon(p: P2, poly: &[P2]) -> bool {
    let mut inside = false;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (poly[i], poly[j]);
        if (a[1] > p[1]) != (b[1] > p[1]) {
            let x = (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0];
            if p[0] < x {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

pub fn centroid(p: &[P2]) -> P2 {
    let mut c = [0.0, 0.0];
    for v in p {
        c[0] += v[0];
        c[1] += v[1];
    }
    let n = p.len().max(1) as f32;
    [c[0] / n, c[1] / n]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triangulates_l_shape() {
        let mut p = vec![[0.0, 0.0], [4.0, 0.0], [4.0, 1.0], [1.0, 1.0], [1.0, 4.0], [0.0, 4.0]];
        clean_polygon(&mut p, 0.1);
        let mut out = vec![];
        triangulate(&p, &mut out);
        assert_eq!(out.len(), (p.len() - 2) * 3);
        let mut area = 0.0;
        for t in out.chunks(3) {
            area += cross(p[t[0] as usize], p[t[1] as usize], p[t[2] as usize]) * 0.5;
        }
        assert!((area - 7.0).abs() < 1e-3);
    }

    #[test]
    fn makes_ccw() {
        let mut p = vec![[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0]];
        clean_polygon(&mut p, 0.1);
        assert!(signed_area(&p) > 0.0);
    }
}
