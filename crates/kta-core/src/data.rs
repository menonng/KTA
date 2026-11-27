//! Compact binary map tile format ("KTA1").
//!
//! All coordinates are local meters around the tile origin, quantized to
//! 5 cm in i16 (range about ±1.6 km). x = east, z = south (north is -z).
//! A building costs 8 + 4·n bytes, so a whole district fits in ~100 KB.

pub const MAGIC: &[u8; 4] = b"KTA1";
pub const VERSION: u16 = 1;
pub const Q: f32 = 0.05;
/// Road kind flag: one-way carriageway (travel along point order).
pub const ONEWAY: u8 = 0x80;

#[derive(Clone, Debug, Default)]
pub struct Building {
    pub pts: Vec<[f32; 2]>,
    pub height: f32,
    pub levels: u8,
    pub kind: u8,
    pub seed: u16,
}

#[derive(Clone, Debug, Default)]
pub struct Road {
    pub pts: Vec<[f32; 2]>,
    pub kind: u8,
    pub width: f32,
}

#[derive(Clone, Debug, Default)]
pub struct Entrance {
    pub x: f32,
    pub z: f32,
    pub yaw: f32,
    pub exit_no: u8,
}

#[derive(Clone, Debug, Default)]
pub struct Sign {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: f32,
    pub w: f32,
    pub h: f32,
    pub label: u16,
    pub vertical: bool,
}

#[derive(Clone, Debug, Default)]
pub struct MapData {
    pub origin_lat: f64,
    pub origin_lon: f64,
    pub buildings: Vec<Building>,
    pub roads: Vec<Road>,
    pub entrances: Vec<Entrance>,
    pub signs: Vec<Sign>,
}

/// Building kinds (also used by the facade shader).
pub mod kind {
    pub const OTHER: u8 = 0;
    pub const RESIDENTIAL: u8 = 1;
    pub const COMMERCIAL: u8 = 2;
    pub const PUBLIC: u8 = 3;
    pub const TRANSPORT: u8 = 4;
}

/// Road classes.
pub mod road {
    pub const PRIMARY: u8 = 1;
    pub const SECONDARY: u8 = 2;
    pub const TERTIARY: u8 = 3;
    pub const RESIDENTIAL: u8 = 4;
    pub const SERVICE: u8 = 5;
    pub const PEDESTRIAN: u8 = 6;
    pub const FOOTWAY: u8 = 7;
    pub const LINK: u8 = 8;
}

#[derive(Debug)]
pub struct ParseError(pub &'static str);

struct Reader<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ParseError> {
        if self.p + n > self.b.len() {
            return Err(ParseError("unexpected end of data"));
        }
        let s = &self.b[self.p..self.p + n];
        self.p += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, ParseError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, ParseError> {
        let s = self.take(2)?;
        Ok(u16::from_le_bytes([s[0], s[1]]))
    }
    fn i16(&mut self) -> Result<i16, ParseError> {
        let s = self.take(2)?;
        Ok(i16::from_le_bytes([s[0], s[1]]))
    }
    fn u32(&mut self) -> Result<u32, ParseError> {
        let s = self.take(4)?;
        Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn f64(&mut self) -> Result<f64, ParseError> {
        let s = self.take(8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(s);
        Ok(f64::from_le_bytes(a))
    }
    fn pt(&mut self) -> Result<[f32; 2], ParseError> {
        let x = self.i16()? as f32 * Q;
        let z = self.i16()? as f32 * Q;
        Ok([x, z])
    }
}

fn yaw_from_u16(v: u16) -> f32 {
    v as f32 / 65535.0 * std::f32::consts::TAU
}

fn yaw_to_u16(y: f32) -> u16 {
    let t = y.rem_euclid(std::f32::consts::TAU) / std::f32::consts::TAU;
    (t * 65535.0).round() as u16
}

pub fn parse(bytes: &[u8]) -> Result<MapData, ParseError> {
    let mut r = Reader { b: bytes, p: 0 };
    if r.take(4)? != MAGIC {
        return Err(ParseError("bad magic"));
    }
    if r.u16()? != VERSION {
        return Err(ParseError("unsupported version"));
    }
    let _reserved = r.u16()?;
    let origin_lat = r.f64()?;
    let origin_lon = r.f64()?;
    let nb = r.u32()? as usize;
    let nr = r.u32()? as usize;
    let ne = r.u32()? as usize;
    let ns = r.u32()? as usize;

    let mut buildings = Vec::with_capacity(nb);
    for _ in 0..nb {
        let n = r.u16()? as usize;
        let height = r.u16()? as f32 * 0.1;
        let levels = r.u8()?;
        let kind = r.u8()?;
        let seed = r.u16()?;
        let mut pts = Vec::with_capacity(n);
        for _ in 0..n {
            pts.push(r.pt()?);
        }
        buildings.push(Building { pts, height, levels, kind, seed });
    }
    let mut roads = Vec::with_capacity(nr);
    for _ in 0..nr {
        let n = r.u16()? as usize;
        let kind = r.u8()?;
        let width = r.u8()? as f32 * 0.25;
        let mut pts = Vec::with_capacity(n);
        for _ in 0..n {
            pts.push(r.pt()?);
        }
        roads.push(Road { pts, kind, width });
    }
    let mut entrances = Vec::with_capacity(ne);
    for _ in 0..ne {
        let p = r.pt()?;
        let yaw = yaw_from_u16(r.u16()?);
        let exit_no = r.u8()?;
        let _pad = r.u8()?;
        entrances.push(Entrance { x: p[0], z: p[1], yaw, exit_no });
    }
    let mut signs = Vec::with_capacity(ns);
    for _ in 0..ns {
        let p = r.pt()?;
        let y = r.u16()? as f32 * 0.01;
        let yaw = yaw_from_u16(r.u16()?);
        let w = r.u16()? as f32 * 0.01;
        let h = r.u16()? as f32 * 0.01;
        let label = r.u16()?;
        let flags = r.u8()?;
        let _pad = r.u8()?;
        signs.push(Sign { x: p[0], y, z: p[1], yaw, w, h, label, vertical: flags & 1 != 0 });
    }
    Ok(MapData { origin_lat, origin_lon, buildings, roads, entrances, signs })
}

fn q(v: f32) -> i16 {
    (v / Q).round().clamp(i16::MIN as f32, i16::MAX as f32) as i16
}

pub fn write(m: &MapData) -> Vec<u8> {
    let mut o = Vec::new();
    o.extend_from_slice(MAGIC);
    o.extend_from_slice(&VERSION.to_le_bytes());
    o.extend_from_slice(&0u16.to_le_bytes());
    o.extend_from_slice(&m.origin_lat.to_le_bytes());
    o.extend_from_slice(&m.origin_lon.to_le_bytes());
    for n in [m.buildings.len(), m.roads.len(), m.entrances.len(), m.signs.len()] {
        o.extend_from_slice(&(n as u32).to_le_bytes());
    }
    let pt = |o: &mut Vec<u8>, p: &[f32; 2]| {
        o.extend_from_slice(&q(p[0]).to_le_bytes());
        o.extend_from_slice(&q(p[1]).to_le_bytes());
    };
    for b in &m.buildings {
        o.extend_from_slice(&(b.pts.len() as u16).to_le_bytes());
        o.extend_from_slice(&((b.height * 10.0).round() as u16).to_le_bytes());
        o.push(b.levels);
        o.push(b.kind);
        o.extend_from_slice(&b.seed.to_le_bytes());
        for p in &b.pts {
            pt(&mut o, p);
        }
    }
    for r in &m.roads {
        o.extend_from_slice(&(r.pts.len() as u16).to_le_bytes());
        o.push(r.kind);
        o.push((r.width / 0.25).round().clamp(1.0, 255.0) as u8);
        for p in &r.pts {
            pt(&mut o, p);
        }
    }
    for e in &m.entrances {
        pt(&mut o, &[e.x, e.z]);
        o.extend_from_slice(&yaw_to_u16(e.yaw).to_le_bytes());
        o.push(e.exit_no);
        o.push(0);
    }
    for s in &m.signs {
        pt(&mut o, &[s.x, s.z]);
        o.extend_from_slice(&((s.y * 100.0).round() as u16).to_le_bytes());
        o.extend_from_slice(&yaw_to_u16(s.yaw).to_le_bytes());
        o.extend_from_slice(&((s.w * 100.0).round() as u16).to_le_bytes());
        o.extend_from_slice(&((s.h * 100.0).round() as u16).to_le_bytes());
        o.extend_from_slice(&s.label.to_le_bytes());
        o.push(s.vertical as u8);
        o.push(0);
    }
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let m = MapData {
            origin_lat: 37.5,
            origin_lon: 126.9,
            buildings: vec![Building {
                pts: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]],
                height: 12.3,
                levels: 4,
                kind: 2,
                seed: 77,
            }],
            roads: vec![Road { pts: vec![[0.0, 0.0], [5.0, 5.0]], kind: 1, width: 20.0 }],
            entrances: vec![Entrance { x: 1.0, z: 2.0, yaw: 1.0, exit_no: 9 }],
            signs: vec![Sign { x: 1.0, y: 3.5, z: 2.0, yaw: 0.5, w: 3.0, h: 0.9, label: 3, vertical: true }],
        };
        let b = write(&m);
        let p = parse(&b).unwrap();
        assert_eq!(p.buildings[0].pts.len(), 3);
        assert!((p.buildings[0].height - 12.3).abs() < 0.05);
        assert_eq!(p.entrances[0].exit_no, 9);
        assert!(p.signs[0].vertical);
        assert!((p.roads[0].width - 20.0).abs() < 0.01);
    }
}
