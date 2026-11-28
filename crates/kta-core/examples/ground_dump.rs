//! Debug: rasterise walking-surface heights and road centrelines around a
//! point into a PGM (white = raised pavement).
//! cargo run --release -p kta-core --example ground_dump -- web/public/data/hongdae.bin x z half out.pgm
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let (x, z, h): (f32, f32, f32) = (a[2].parse().unwrap(), a[3].parse().unwrap(), a[4].parse().unwrap());
    let w = kta_core::World::new(&bytes, 1, 0).unwrap();
    let n = 600;
    let mut img = vec![0u8; n * n];
    for j in 0..n {
        for i in 0..n {
            let p = [x - h + (i as f32 + 0.5) / n as f32 * 2.0 * h, z - h + (j as f32 + 0.5) / n as f32 * 2.0 * h];
            let g = w.ground.height(p);
            img[j * n + i] = if g > 0.14 { 230 } else if g > 0.01 { 150 } else { 40 };
        }
    }
    for r in &w.map.roads {
        for s in r.pts.windows(2) {
            for k in 0..400 {
                let t = k as f32 / 400.0;
                let p = [s[0][0] + (s[1][0] - s[0][0]) * t, s[0][1] + (s[1][1] - s[0][1]) * t];
                let i = ((p[0] - x + h) / (2.0 * h) * n as f32) as i32;
                let j = ((p[1] - z + h) / (2.0 * h) * n as f32) as i32;
                if i >= 0 && j >= 0 && (i as usize) < n && (j as usize) < n {
                    img[j as usize * n + i as usize] = 90 + (r.kind & 0x7f) * 10;
                }
            }
        }
    }
    let mut out = format!("P5 {} {} 255\n", n, n).into_bytes();
    out.extend_from_slice(&img);
    std::fs::write(&a[5], out).unwrap();
}
