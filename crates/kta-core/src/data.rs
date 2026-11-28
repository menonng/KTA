//! Compact binary map tile format ("KTA1", version 3).
//!
//! All coordinates are local meters around the tile origin, quantized to
//! 5 cm in i16 (range about ±1.6 km). x = east, z = south (north is -z).
//! A building costs 8 + ceil(n/8) + 4·n bytes, so a district fits in ~130 KB.
//!
//! Version 3 adds a string table (road and bus-stop names), a name index per
//! road, real street trees (one record per tree, species from the Seoul
//! street-tree register), bus stops and point features (signals, crossings).
//! Version 2 files still parse (the new lists come back empty).

pub const MAGIC: &[u8; 4] = b"KTA1";
pub const VERSION: u16 = 3;
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
    /// Ground floor is a shop front (glass, signage) on street-facing walls.
    pub shop: bool,
    /// Per edge (pts[i] -> pts[i+1]): the wall faces a street.
    pub street: Vec<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct Road {
    pub pts: Vec<[f32; 2]>,
    pub kind: u8,
    pub width: f32,
    /// Index into `MapData::names` (0 = unnamed).
    pub name: u16,
}

/// One street tree at its surveyed position.
#[derive(Clone, Debug, Default)]
pub struct Tree {
    pub x: f32,
    pub z: f32,
    /// `species::*`
    pub species: u8,
    /// 0..255 size variation (crown and height scale).
    pub size: u8,
}

/// Street-tree species groups (서울시 가로수 위치정보 수종).
pub mod species {
    /// 은행나무
    pub const GINKGO: u8 = 0;
    /// 양버즘나무 (London plane)
    pub const PLANE: u8 = 1;
    /// 느티나무
    pub const ZELKOVA: u8 = 2;
    /// 이팝나무
    pub const FRINGE: u8 = 3;
    /// 벚나무류, 왕벚나무, 살구나무
    pub const CHERRY: u8 = 4;
    /// 회화나무
    pub const PAGODA: u8 = 5;
    /// 소나무, 향나무 (evergreen)
    pub const PINE: u8 = 6;
    /// 단풍나무, 공작단풍, 복자기, 중국단풍
    pub const MAPLE: u8 = 7;
    /// Everything else (라일락, 배롱나무, 무궁화, 대왕참나무 ...)
    pub const OTHER: u8 = 8;
    pub const COUNT: u8 = 9;
}

/// A bus stop.
#[derive(Clone, Debug, Default)]
pub struct Stop {
    pub x: f32,
    pub z: f32,
    /// Direction the waiting side faces (towards the kerb / bus).
    pub yaw: f32,
    /// `stop::*`
    pub kind: u8,
    /// Index into `MapData::names`.
    pub name: u16,
}

pub mod stop {
    /// Pole sign only.
    pub const POLE: u8 = 0;
    /// Roadside shelter (서울 가로변 표준 쉘터).
    pub const SHELTER: u8 = 1;
    /// Roadside 스마트쉘터.
    pub const SMART: u8 = 2;
    /// Median (중앙버스전용차로) platform with a shelter.
    pub const MEDIAN: u8 = 3;
    /// Median platform with a 스마트쉘터 (홍대입구, 2021-08-27).
    pub const MEDIAN_SMART: u8 = 4;
}

/// A point feature on the street network.
#[derive(Clone, Debug, Default)]
pub struct Node {
    pub x: f32,
    pub z: f32,
    /// `node::*`
    pub kind: u8,
}

pub mod node {
    /// highway=traffic_signals (junction signal stop position)
    pub const SIGNALS: u8 = 1;
    /// highway=crossing with crossing=traffic_signals
    pub const CROSSING_SIGNALS: u8 = 2;
    /// highway=crossing marked (zebra) without signals
    pub const CROSSING_MARKED: u8 = 3;
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
    /// Mounting: 0 wall sign, 1 window decal, 2 awning, 3 standing sign
    /// (light box on the pavement), 4 round projecting disc, 5 rooftop cross,
    /// 6 roller shutter of an empty unit (model, no artwork).
    /// Stored in the
    /// flags byte (bits 1-3) next to `vertical` (bit 0).
    pub mount: u8,
}

#[derive(Clone, Debug, Default)]
pub struct MapData {
    pub origin_lat: f64,
    pub origin_lon: f64,
    pub buildings: Vec<Building>,
    pub roads: Vec<Road>,
    pub entrances: Vec<Entrance>,
    pub signs: Vec<Sign>,
    /// String table; entry 0 is the empty string.
    pub names: Vec<String>,
    pub trees: Vec<Tree>,
    pub stops: Vec<Stop>,
    pub nodes: Vec<Node>,
}

impl MapData {
    pub fn name(&self, i: u16) -> &str {
        self.names.get(i as usize).map_or("", |s| s.as_str())
    }
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
    /// Median bus-only carriageway (highway=busway, 중앙버스전용차로).
    pub const BUS: u8 = 10;
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
    let ver = r.u16()?;
    if ver != 2 && ver != VERSION {
        return Err(ParseError("unsupported version"));
    }
    let _reserved = r.u16()?;
    let origin_lat = r.f64()?;
    let origin_lon = r.f64()?;
    let nb = r.u32()? as usize;
    let nr = r.u32()? as usize;
    let ne = r.u32()? as usize;
    let ns = r.u32()? as usize;
    let (nt, nst, nn, nnames) = if ver >= 3 {
        (r.u32()? as usize, r.u32()? as usize, r.u32()? as usize, r.u32()? as usize)
    } else {
        (0, 0, 0, 0)
    };

    let mut buildings = Vec::with_capacity(nb);
    for _ in 0..nb {
        let n = r.u16()? as usize;
        let height = r.u16()? as f32 * 0.1;
        let levels = r.u8()?;
        let kraw = r.u8()?;
        let seed = r.u16()?;
        let mask = r.take(n.div_ceil(8))?;
        let street = (0..n).map(|i| mask[i / 8] & (1 << (i % 8)) != 0).collect();
        let mut pts = Vec::with_capacity(n);
        for _ in 0..n {
            pts.push(r.pt()?);
        }
        buildings.push(Building { pts, height, levels, kind: kraw & 0x3F, seed, shop: kraw & 0x40 != 0, street });
    }
    let mut roads = Vec::with_capacity(nr);
    for _ in 0..nr {
        let n = r.u16()? as usize;
        let kind = r.u8()?;
        let width = r.u8()? as f32 * 0.25;
        let name = if ver >= 3 { r.u16()? } else { 0 };
        let mut pts = Vec::with_capacity(n);
        for _ in 0..n {
            pts.push(r.pt()?);
        }
        roads.push(Road { pts, kind, width, name });
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
        signs.push(Sign { x: p[0], y, z: p[1], yaw, w, h, label, vertical: flags & 1 != 0, mount: (flags >> 1) & 7 });
    }
    let mut trees = Vec::with_capacity(nt);
    for _ in 0..nt {
        let p = r.pt()?;
        let species = r.u8()?;
        let size = r.u8()?;
        trees.push(Tree { x: p[0], z: p[1], species, size });
    }
    let mut stops = Vec::with_capacity(nst);
    for _ in 0..nst {
        let p = r.pt()?;
        let yaw = yaw_from_u16(r.u16()?);
        let kind = r.u8()?;
        let _pad = r.u8()?;
        let name = r.u16()?;
        stops.push(Stop { x: p[0], z: p[1], yaw, kind, name });
    }
    let mut nodes = Vec::with_capacity(nn);
    for _ in 0..nn {
        let p = r.pt()?;
        let kind = r.u8()?;
        nodes.push(Node { x: p[0], z: p[1], kind });
    }
    let mut names = Vec::with_capacity(nnames.max(1));
    for _ in 0..nnames {
        let len = r.u8()? as usize;
        let b = r.take(len)?;
        names.push(String::from_utf8_lossy(b).into_owned());
    }
    if names.is_empty() {
        names.push(String::new());
    }
    Ok(MapData { origin_lat, origin_lon, buildings, roads, entrances, signs, names, trees, stops, nodes })
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
    let names: Vec<&str> = if m.names.is_empty() { vec![""] } else { m.names.iter().map(|s| s.as_str()).collect() };
    for n in [m.buildings.len(), m.roads.len(), m.entrances.len(), m.signs.len(), m.trees.len(), m.stops.len(), m.nodes.len(), names.len()] {
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
        o.push((b.kind & 0x3F) | if b.shop { 0x40 } else { 0 });
        o.extend_from_slice(&b.seed.to_le_bytes());
        let mut mask = vec![0u8; b.pts.len().div_ceil(8)];
        for (i, &f) in b.street.iter().enumerate().take(b.pts.len()) {
            if f {
                mask[i / 8] |= 1 << (i % 8);
            }
        }
        o.extend_from_slice(&mask);
        for p in &b.pts {
            pt(&mut o, p);
        }
    }
    for r in &m.roads {
        o.extend_from_slice(&(r.pts.len() as u16).to_le_bytes());
        o.push(r.kind);
        o.push((r.width / 0.25).round().clamp(1.0, 255.0) as u8);
        o.extend_from_slice(&r.name.to_le_bytes());
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
        o.push(s.vertical as u8 | (s.mount & 7) << 1);
        o.push(0);
    }
    for t in &m.trees {
        pt(&mut o, &[t.x, t.z]);
        o.push(t.species);
        o.push(t.size);
    }
    for s in &m.stops {
        pt(&mut o, &[s.x, s.z]);
        o.extend_from_slice(&yaw_to_u16(s.yaw).to_le_bytes());
        o.push(s.kind);
        o.push(0);
        o.extend_from_slice(&s.name.to_le_bytes());
    }
    for n in &m.nodes {
        pt(&mut o, &[n.x, n.z]);
        o.push(n.kind);
    }
    for s in &names {
        // Truncate on a char boundary to fit the u8 length.
        let mut end = s.len().min(255);
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        o.push(end as u8);
        o.extend_from_slice(&s.as_bytes()[..end]);
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
                shop: true,
                street: vec![true, false, true],
            }],
            roads: vec![Road { pts: vec![[0.0, 0.0], [5.0, 5.0]], kind: 1, width: 20.0, name: 1 }],
            entrances: vec![Entrance { x: 1.0, z: 2.0, yaw: 1.0, exit_no: 9 }],
            signs: vec![Sign { x: 1.0, y: 3.5, z: 2.0, yaw: 0.5, w: 3.0, h: 0.9, label: 3, vertical: true, mount: 4 }],
            names: vec![String::new(), "양화로".into(), "홍대입구역".into()],
            trees: vec![Tree { x: 3.0, z: -4.0, species: species::PLANE, size: 200 }],
            stops: vec![Stop { x: 7.0, z: 1.0, yaw: 2.0, kind: stop::MEDIAN_SMART, name: 2 }],
            nodes: vec![Node { x: -2.0, z: 9.0, kind: node::SIGNALS }],
        };
        let b = write(&m);
        let p = parse(&b).unwrap();
        assert_eq!(p.buildings[0].pts.len(), 3);
        assert!((p.buildings[0].height - 12.3).abs() < 0.05);
        assert!(p.buildings[0].shop && p.buildings[0].kind == 2);
        assert_eq!(p.buildings[0].street, vec![true, false, true]);
        assert_eq!(p.entrances[0].exit_no, 9);
        assert!(p.signs[0].vertical);
        assert_eq!(p.signs[0].mount, 4);
        assert!((p.roads[0].width - 20.0).abs() < 0.01);
        assert_eq!(p.name(p.roads[0].name), "양화로");
        assert_eq!(p.trees[0].species, species::PLANE);
        assert_eq!(p.trees[0].size, 200);
        assert_eq!(p.stops[0].kind, stop::MEDIAN_SMART);
        assert_eq!(p.name(p.stops[0].name), "홍대입구역");
        assert_eq!(p.nodes[0].kind, node::SIGNALS);
        assert!((p.nodes[0].z - 9.0).abs() < 0.05);
    }
}
