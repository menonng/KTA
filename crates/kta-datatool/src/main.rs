//! Converts an OpenStreetMap XML extract into the compact KTA1 tile plus a
//! sign label table. Brand names are mapped to parody names (docs/brand-bible.md);
//! independent shops get generic category signs instead of their real names.
//!
//! Usage: kta-datatool <input.osm> <out_dir> <name>

use kta_core::data::{self, kind, road, Building, Entrance, MapData, Road, Sign};
use kta_core::geom::{clean_polygon, closest_on_segment, signed_area, P2};
use std::collections::HashMap;
use std::fmt::Write as _;

type Tags<'a> = HashMap<&'a str, &'a str>;

fn tags_of<'a>(n: roxmltree::Node<'a, 'a>) -> Tags<'a> {
    let mut t = HashMap::new();
    for c in n.children().filter(|c| c.has_tag_name("tag")) {
        if let (Some(k), Some(v)) = (c.attribute("k"), c.attribute("v")) {
            t.insert(k, v);
        }
    }
    t
}

fn hash(mut x: u64) -> u64 {
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    x = x.wrapping_mul(0xc4ceb9fe1a85ec53);
    x ^= x >> 33;
    x
}

fn parse_num(s: &str) -> Option<f32> {
    let t: String = s.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    t.parse().ok()
}

struct Proj {
    lat0: f64,
    lon0: f64,
    kx: f64,
    kz: f64,
}

impl Proj {
    fn new(lat0: f64, lon0: f64) -> Proj {
        Proj { lat0, lon0, kx: 111_320.0 * lat0.to_radians().cos(), kz: 110_574.0 }
    }
    fn p(&self, lat: f64, lon: f64) -> P2 {
        [((lon - self.lon0) * self.kx) as f32, (-(lat - self.lat0) * self.kz) as f32]
    }
}

const LIMIT: f32 = 1400.0;

fn inside(p: P2) -> bool {
    p[0].abs() < LIMIT && p[1].abs() < LIMIT
}

struct Label {
    text: String,
    fg: &'static str,
    bg: &'static str,
    brand: bool,
}

const GENERIC_PALETTE: [(&str, &str); 8] = [
    ("#C8102E", "#FFE14D"),
    ("#1D4E9E", "#FFFFFF"),
    ("#FFD400", "#C8102E"),
    ("#0B7A3E", "#FFFFFF"),
    ("#111111", "#FFD400"),
    ("#FFFFFF", "#C8102E"),
    ("#5B2C83", "#FFFFFF"),
    ("#E8650A", "#FFFFFF"),
];

/// Returns (text, fg, bg, is_brand) for a POI, or None if it gets no sign.
fn classify(t: &Tags, id: u64) -> Option<(String, &'static str, &'static str, bool)> {
    let name = t.get("name").copied().unwrap_or("");
    let brand = t.get("brand").or(t.get("brand:ko")).copied().unwrap_or("");
    let en = t.get("name:en").copied().unwrap_or("");
    let all = format!("{} | {} | {}", name, brand, en);
    let has = |s: &str| all.contains(s);
    let word_cu = name == "CU" || brand == "CU" || name.starts_with("CU ") || has("씨유");

    let b = |txt: &str, fg: &'static str, bg: &'static str| Some((txt.to_string(), fg, bg, true));
    // Parody brands (design kept, name changed). Order matters.
    if has("GS25") {
        return b("GG24", "#FFFFFF", "#00A0E2");
    }
    if word_cu {
        return b("CUZ", "#FFFFFF", "#652F8D");
    }
    if has("세븐일레븐") || has("7-Eleven") || has("7-ELEVEN") || has("7-eleven") {
        return b("식스텐", "#FFFFFF", "#F47920");
    }
    if has("스타벅스") || has("Starbucks") {
        return b("스타덕스", "#FFFFFF", "#00704A");
    }
    if has("메가박스") || has("MEGABOX") || has("Megabox") {
        return b("기가박스", "#FFFFFF", "#351F66");
    }
    if has("메가MGC") || has("메가커피") || has("MEGA MGC") || has("MGC") {
        return b("기가커피", "#3A2416", "#FFD400");
    }
    if has("빽다방") {
        return b("빡다방", "#1B3A8F", "#FFE600");
    }
    if has("올리브영") || has("Olive Young") || has("OLIVE YOUNG") {
        return b("올리브올드", "#FFFFFF", "#8DC63F");
    }
    if has("다이소") || has("Daiso") || has("DAISO") {
        return b("다사소", "#FFFFFF", "#E60012");
    }
    if has("롯데리아") || has("Lotteria") {
        return b("라떼리아", "#FFFFFF", "#DA291C");
    }
    if has("롯데시네마") {
        return b("라떼시네마", "#FFFFFF", "#ED1C24");
    }
    if has("롯데") {
        let txt = name.replace("롯데", "라떼");
        return b(if txt.is_empty() { "라떼" } else { &txt }, "#FFFFFF", "#DA291C");
    }
    if has("신세계") {
        let txt = name.replace("신세계", "신세기");
        return b(if txt.is_empty() { "신세기" } else { &txt }, "#FFFFFF", "#333333");
    }
    if has("무신사") || has("MUSINSA") {
        return b(if has("스탠다드") || has("STANDARD") { "뭐신사 스탠다드" } else { "뭐신사" }, "#FFFFFF", "#000000");
    }
    if has("엽기떡볶이") {
        return b("기겁떡볶이", "#FFFFFF", "#C8102E");
    }
    if has("CGV") {
        return b("CZV", "#FFFFFF", "#E71A0F");
    }
    if has("인생네컷") {
        return b("인생여덟컷", "#FFFFFF", "#111111");
    }
    if has("우리은행") || has("Woori") {
        return b("너희은행", "#FFFFFF", "#0067AC");
    }
    if has("SK텔레콤") || has("T world") || has("티월드") || has("SKT") {
        return b("SQ텔레콤", "#FFFFFF", "#EA002C");
    }
    if has("LG U+") || has("LGU+") || has("유플러스") {
        return b("LZ U-", "#FFFFFF", "#E6007E");
    }
    if brand == "KT" || name.starts_with("KT ") || has("KT플라자") {
        return b("QT", "#FF3B30", "#1A1A1A");
    }
    if has("삼성") || has("Samsung") || has("SAMSUNG") {
        return b("심송", "#FFFFFF", "#1428A0");
    }
    if has("따릉이") || has("Ttareungyi") {
        return b("또롱이", "#FFFFFF", "#3BAA34");
    }

    // Generic category signs (no real small-business names).
    let amenity = t.get("amenity").copied().unwrap_or("");
    let shop = t.get("shop").copied().unwrap_or("");
    let tourism = t.get("tourism").copied().unwrap_or("");
    let cuisine = t.get("cuisine").copied().unwrap_or("");
    let h = hash(id);
    let pick = |v: &[&str]| v[(h % v.len() as u64) as usize].to_string();
    let txt: Option<String> = if has("노래") || amenity == "karaoke_box" {
        Some(if has("코인") { "코인노래방".into() } else { "노래방".into() })
    } else if has("PC") || has("피시") || amenity == "internet_cafe" {
        Some("PC방".into())
    } else if has("버거") || has("Burger") || has("맥도날드") || has("KFC") || has("맘스터치") || cuisine.contains("burger") {
        Some("버거".into())
    } else if has("파리바게") || has("뚜레쥬르") || shop == "bakery" {
        Some("베이커리".into())
    } else if has("은행") || amenity == "bank" {
        Some("은행".into())
    } else {
        match (amenity, shop, tourism) {
            ("cafe", _, _) => Some(pick(&["카페", "카페", "디저트 카페", "COFFEE"])),
            ("restaurant", _, _) => Some(match cuisine {
                c if c.contains("korean") => pick(&["한식", "백반", "국밥"]),
                c if c.contains("chicken") => "치킨".into(),
                c if c.contains("japanese") || c.contains("sushi") || c.contains("ramen") => pick(&["일식", "라멘", "이자카야"]),
                c if c.contains("chinese") => "중식".into(),
                c if c.contains("pizza") => "피자".into(),
                c if c.contains("barbecue") || c.contains("bbq") => pick(&["고기", "삼겹살"]),
                c if c.contains("italian") || c.contains("western") => "양식".into(),
                _ => pick(&["식당", "식당", "맛집", "분식"]),
            }),
            ("fast_food", _, _) => Some(pick(&["분식", "김밥", "떡볶이"])),
            ("bar", _, _) | ("pub", _, _) => Some(pick(&["호프", "포차", "BAR", "주점"])),
            ("nightclub", _, _) => Some("CLUB".into()),
            ("pharmacy", _, _) => Some("약국".into()),
            ("clinic", _, _) | ("doctors", _, _) => Some("의원".into()),
            ("dentist", _, _) => Some("치과".into()),
            ("hospital", _, _) => Some("병원".into()),
            ("place_of_worship", _, _) if t.get("religion") == Some(&"christian") => Some("교회".into()),
            ("ice_cream", _, _) => Some("아이스크림".into()),
            (_, "convenience", _) => Some("편의점".into()),
            (_, "clothes", _) | (_, "boutique", _) | (_, "fashion", _) => Some(pick(&["옷가게", "SALE", "의류"])),
            (_, "shoes", _) => Some("신발".into()),
            (_, "cosmetics", _) | (_, "beauty", _) => Some(pick(&["화장품", "네일"])),
            (_, "hairdresser", _) => Some("미용실".into()),
            (_, "mobile_phone", _) => Some("휴대폰".into()),
            (_, "optician", _) => Some("안경".into()),
            (_, "books", _) => Some("서점".into()),
            (_, "supermarket", _) => Some("마트".into()),
            (_, "gift", _) | (_, "variety_store", _) => Some("소품샵".into()),
            (_, "tattoo", _) => Some("TATTOO".into()),
            (_, "massage", _) => Some("마사지".into()),
            (_, "laundry", _) | (_, "dry_cleaning", _) => Some("세탁".into()),
            (_, "stationery", _) => Some("문구".into()),
            (_, "musical_instrument", _) | (_, "music", _) => Some("악기".into()),
            (_, "alcohol", _) => Some("주류".into()),
            (_, "photo", _) => Some("사진관".into()),
            (_, _, "hostel") | (_, _, "guest_house") => Some("게스트하우스".into()),
            (_, _, "hotel") => Some("호텔".into()),
            _ => None,
        }
    };
    let txt = txt?;
    let (bg, fg) = GENERIC_PALETTE[(hash(id ^ 0x9e37) % GENERIC_PALETTE.len() as u64) as usize];
    Some((txt, fg, bg, false))
}

/// Clamp that tolerates lo > hi (returns the midpoint).
fn sclamp(v: f32, lo: f32, hi: f32) -> f32 {
    if lo > hi { (lo + hi) * 0.5 } else { v.clamp(lo, hi) }
}

fn char_units(s: &str) -> f32 {
    s.chars().map(|c| if c.is_ascii() { if c == ' ' { 0.35 } else { 0.62 } } else { 1.0 }).sum()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: kta-datatool <input.osm> <out_dir> <name>");
        std::process::exit(2);
    }
    let text = std::fs::read_to_string(&args[1]).expect("read osm");
    let doc = roxmltree::Document::parse(&text).expect("parse osm");
    let root = doc.root_element();

    let mut nodes: HashMap<i64, (f64, f64)> = HashMap::new();
    let mut poi_nodes = Vec::new();
    let mut station_pts = Vec::new();
    let mut entrance_nodes = Vec::new();
    let mut bounds = None;
    for n in root.children().filter(|n| n.is_element()) {
        match n.tag_name().name() {
            "bounds" => {
                let g = |k| n.attribute(k).and_then(|v: &str| v.parse::<f64>().ok()).unwrap_or(0.0);
                bounds = Some(((g("minlat") + g("maxlat")) * 0.5, (g("minlon") + g("maxlon")) * 0.5));
            }
            "node" => {
                let id: i64 = n.attribute("id").unwrap().parse().unwrap();
                let lat: f64 = n.attribute("lat").unwrap().parse().unwrap();
                let lon: f64 = n.attribute("lon").unwrap().parse().unwrap();
                nodes.insert(id, (lat, lon));
                let t = tags_of(n);
                if t.is_empty() {
                    continue;
                }
                let name = t.get("name").copied().unwrap_or("");
                let is_station = t.get("railway") == Some(&"station") || t.get("public_transport") == Some(&"station");
                if is_station && name.contains("홍대입구") {
                    station_pts.push((lat, lon));
                }
                if t.get("railway") == Some(&"subway_entrance") || t.get("entrance") == Some(&"subway") {
                    let r = t.get("ref").or(t.get("name")).copied().unwrap_or("");
                    let no = parse_num(r.trim_start_matches(|c: char| !c.is_ascii_digit())).unwrap_or(0.0) as u8;
                    entrance_nodes.push((lat, lon, no));
                }
                if t.contains_key("shop") || t.contains_key("amenity") || t.contains_key("tourism") {
                    poi_nodes.push((id, lat, lon, t));
                }
            }
            _ => {}
        }
    }
    let (lat0, lon0) = if !station_pts.is_empty() {
        let k = station_pts.len() as f64;
        (station_pts.iter().map(|p| p.0).sum::<f64>() / k, station_pts.iter().map(|p| p.1).sum::<f64>() / k)
    } else {
        bounds.unwrap_or((37.5572, 126.9245))
    };
    let pr = Proj::new(lat0, lon0);

    let mut ways: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut buildings: Vec<Building> = Vec::new();
    let mut roads: Vec<Road> = Vec::new();

    let make_building = |id: u64, ring: Vec<P2>, t: &Tags| -> Option<Building> {
        let mut pts = ring;
        if !pts.iter().all(|p| inside(*p)) {
            return None;
        }
        clean_polygon(&mut pts, 0.25);
        if pts.len() < 3 {
            return None;
        }
        let area = signed_area(&pts).abs();
        if area < 6.0 {
            return None;
        }
        let bt = t.get("building").copied().unwrap_or("yes");
        if bt == "roof" || bt == "no" {
            return None;
        }
        let k = match bt {
            "house" | "detached" | "apartments" | "residential" | "semidetached_house" | "dormitory" | "terrace" => kind::RESIDENTIAL,
            "commercial" | "retail" | "office" | "hotel" | "mixed" => kind::COMMERCIAL,
            "school" | "university" | "college" | "church" | "public" | "civic" | "hospital" | "government" => kind::PUBLIC,
            "train_station" | "transportation" | "station" => kind::TRANSPORT,
            _ => kind::OTHER,
        };
        let h = hash(id);
        let r = (h % 1000) as f32 / 1000.0;
        let levels_tag = t.get("building:levels").and_then(|v| parse_num(v));
        let height = if let Some(hm) = t.get("height").or(t.get("building:height")).and_then(|v| parse_num(v)) {
            hm
        } else if let Some(lv) = levels_tag {
            lv * 3.3 + 0.6
        } else {
            let lv = match bt {
                "house" | "detached" => 2.0,
                "apartments" if area > 800.0 => 12.0 + (r * 8.0).floor(),
                "apartments" => 4.0 + (r * 2.0).floor(),
                "church" => 3.0,
                "school" | "university" | "college" => 5.0,
                _ if area < 150.0 => 2.0 + (r * 3.0).floor(),
                _ if area < 600.0 => 3.0 + (r * 4.0).floor(),
                _ if area < 2000.0 => 5.0 + (r * 5.0).floor(),
                _ => 8.0 + (r * 7.0).floor(),
            };
            lv * 3.3 + 0.6
        };
        let height = height.clamp(3.0, 250.0);
        Some(Building {
            pts,
            height,
            levels: (height / 3.3).round().clamp(1.0, 255.0) as u8,
            kind: k,
            seed: (h >> 16) as u16,
        })
    };

    for w in root.children().filter(|n| n.has_tag_name("way")) {
        let id: i64 = w.attribute("id").unwrap().parse().unwrap();
        let refs: Vec<i64> = w
            .children()
            .filter(|c| c.has_tag_name("nd"))
            .filter_map(|c| c.attribute("ref").and_then(|r| r.parse().ok()))
            .collect();
        let t = tags_of(w);
        let pts: Vec<P2> = refs.iter().filter_map(|r| nodes.get(r)).map(|&(la, lo)| pr.p(la, lo)).collect();
        if t.contains_key("building") && refs.len() >= 4 && refs.first() == refs.last() {
            if let Some(b) = make_building(id as u64, pts.clone(), &t) {
                buildings.push(b);
            }
        } else if let Some(&hw) = t.get("highway") {
            let skip = matches!(hw, "corridor" | "steps" | "platform" | "busway" | "construction" | "proposed" | "elevator")
                || t.get("tunnel").map_or(false, |v| *v != "no")
                || t.get("area") == Some(&"yes")
                || t.get("layer").and_then(|v| v.parse::<i32>().ok()).map_or(false, |l| l < 0);
            let rk = match hw {
                "primary" | "trunk" => road::PRIMARY,
                "secondary" => road::SECONDARY,
                "tertiary" => road::TERTIARY,
                "primary_link" | "secondary_link" | "tertiary_link" | "trunk_link" => road::LINK,
                "residential" | "unclassified" | "living_street" => road::RESIDENTIAL,
                "service" => road::SERVICE,
                "pedestrian" => road::PEDESTRIAN,
                "footway" | "path" | "cycleway" => road::FOOTWAY,
                _ => 0,
            };
            if !skip && rk != 0 {
                let ow = t.get("oneway").copied().unwrap_or("");
                let oneway = matches!(ow, "yes" | "1" | "true" | "-1") || t.get("junction") == Some(&"roundabout");
                let reverse = ow == "-1";
                let default_w = match rk {
                    road::PRIMARY => 24.0,
                    road::SECONDARY => 16.0,
                    road::TERTIARY => 11.0,
                    road::LINK => 8.0,
                    road::RESIDENTIAL => 6.0,
                    road::SERVICE => 4.0,
                    road::PEDESTRIAN => 8.0,
                    _ => 2.6,
                };
                let width = t
                    .get("width")
                    .and_then(|v| parse_num(v))
                    .or_else(|| t.get("lanes").and_then(|v| parse_num(v)).map(|l| l * 3.25 + 1.0))
                    .unwrap_or(if oneway { default_w * 0.5 + 1.0 } else { default_w })
                    .clamp(1.5, 60.0);
                let rk = if oneway { rk | data::ONEWAY } else { rk };
                let mut pts = pts;
                if reverse {
                    pts.reverse();
                }
                // Split into runs that stay inside the quantization range.
                let mut run: Vec<P2> = Vec::new();
                let flush = |run: &mut Vec<P2>, roads: &mut Vec<Road>| {
                    run.dedup_by(|a, b| kta_core::geom::dist2(*a, *b) < 0.01);
                    if run.len() >= 2 {
                        roads.push(Road { pts: std::mem::take(run), kind: rk, width });
                    } else {
                        run.clear();
                    }
                };
                for p in pts {
                    if inside(p) {
                        run.push(p);
                    } else {
                        flush(&mut run, &mut roads);
                    }
                }
                flush(&mut run, &mut roads);
            }
        }
        ways.insert(id, refs);
    }

    // Multipolygon building relations: use closed outer rings.
    for r in root.children().filter(|n| n.has_tag_name("relation")) {
        let t = tags_of(r);
        if !t.contains_key("building") || t.get("type") != Some(&"multipolygon") {
            continue;
        }
        let id: u64 = r.attribute("id").unwrap().parse().unwrap();
        for m in r.children().filter(|c| c.has_tag_name("member")) {
            if m.attribute("type") != Some("way") || m.attribute("role") != Some("outer") {
                continue;
            }
            let wid: i64 = m.attribute("ref").unwrap().parse().unwrap();
            if let Some(refs) = ways.get(&wid) {
                if refs.len() >= 4 && refs.first() == refs.last() {
                    let pts: Vec<P2> = refs.iter().filter_map(|r| nodes.get(r)).map(|&(la, lo)| pr.p(la, lo)).collect();
                    if let Some(b) = make_building(id ^ wid as u64, pts, &t) {
                        buildings.push(b);
                    }
                }
            }
        }
    }

    // Subway entrances, oriented along the nearest road.
    let nearest_road_dir = |p: P2| -> f32 {
        let mut best = (f32::MAX, 0.0f32);
        for r in &roads {
            for s in r.pts.windows(2) {
                let (c, _) = closest_on_segment(p, s[0], s[1]);
                let d2 = kta_core::geom::dist2(p, c);
                if d2 < best.0 {
                    best = (d2, (s[1][0] - s[0][0]).atan2(s[1][1] - s[0][1]));
                }
            }
        }
        best.1
    };
    let mut entrances = Vec::new();
    for (lat, lon, no) in &entrance_nodes {
        let p = pr.p(*lat, *lon);
        if inside(p) {
            entrances.push(Entrance { x: p[0], z: p[1], yaw: nearest_road_dir(p), exit_no: *no });
        }
    }

    // Signs: map POIs to labels and place them on the nearest building wall.
    let mut labels: Vec<Label> = Vec::new();
    let mut label_ix: HashMap<(String, &str, &str), u16> = HashMap::new();
    let mut occupancy: HashMap<(usize, usize), Vec<(f32, f32, u32)>> = HashMap::new();
    let mut signs: Vec<Sign> = Vec::new();
    let (mut brand_count, mut generic_count, mut skipped) = (0, 0, 0);
    for (id, lat, lon, t) in &poi_nodes {
        let Some((txt, fg, bg, is_brand)) = classify(t, *id as u64) else { continue };
        let p = pr.p(*lat, *lon);
        if !inside(p) {
            continue;
        }
        // Nearest wall within 30 m.
        let mut best: Option<(f32, usize, usize, f32)> = None;
        for (bi, b) in buildings.iter().enumerate() {
            let c = b.pts[0];
            if (c[0] - p[0]).abs() > 120.0 || (c[1] - p[1]).abs() > 120.0 {
                continue;
            }
            let n = b.pts.len();
            for ei in 0..n {
                let (cp, tt) = closest_on_segment(p, b.pts[ei], b.pts[(ei + 1) % n]);
                let d2 = kta_core::geom::dist2(p, cp);
                if d2 < 900.0 && best.map_or(true, |bb| d2 < bb.0) {
                    best = Some((d2, bi, ei, tt));
                }
            }
        }
        let Some((_, bi, ei, tt)) = best else {
            skipped += 1;
            continue;
        };
        let b = &buildings[bi];
        let n = b.pts.len();
        let (a, c) = (b.pts[ei], b.pts[(ei + 1) % n]);
        let d = [c[0] - a[0], c[1] - a[1]];
        let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
        if len < 1.0 {
            skipped += 1;
            continue;
        }
        let dir = [d[0] / len, d[1] / len];
        let nrm = [dir[1], -dir[0]];
        let key = (txt.clone(), fg, bg);
        let li = *label_ix.entry(key).or_insert_with(|| {
            labels.push(Label { text: txt.clone(), fg, bg, brand: is_brand });
            (labels.len() - 1) as u16
        });
        let units = char_units(&txt);
        let hsh = hash(*id as u64 ^ 0x51ed);
        let vertical = !is_brand && b.height >= 9.0 && hsh % 3 == 0 && units <= 6.0;
        let start_floor = t.get("level").and_then(|v| parse_num(v)).unwrap_or(0.0).max(0.0) as u32;
        if vertical {
            let h = (units * 0.62 + 0.6).min(b.height - 4.5).min(5.5);
            if h < 1.6 || len < 1.6 {
                skipped += 1;
                continue;
            }
            let s = sclamp(tt * len, 0.6, len - 0.6);
            let occ = occupancy.entry((bi, ei)).or_default();
            if occ.iter().any(|&(s0, s1, f)| f == 99 && s > s0 - 2.0 && s < s1 + 2.0) {
                skipped += 1;
                continue;
            }
            occ.push((s, s, 99));
            signs.push(Sign {
                x: a[0] + dir[0] * s + nrm[0] * 0.55,
                z: a[1] + dir[1] * s + nrm[1] * 0.55,
                y: 3.7 + h * 0.5,
                yaw: dir[0].atan2(dir[1]),
                w: 0.72,
                h,
                label: li,
                vertical: true,
            });
        } else {
            let mut w = (units * 0.8 + 1.4).max(len * 0.7).clamp(2.4, 10.0);
            if w > len - 0.3 {
                w = len - 0.3;
            }
            if w < 1.2 {
                skipped += 1;
                continue;
            }
            let s = sclamp(tt * len, w * 0.5 + 0.15, len - w * 0.5 - 0.15);
            let hgt = 1.15;
            let occ = occupancy.entry((bi, ei)).or_default();
            let mut floor = start_floor;
            let mut placed = false;
            while floor < 12 {
                let y = if floor == 0 { 3.55 } else { floor as f32 * 3.3 + 1.7 };
                if y + hgt * 0.5 > b.height - 0.2 {
                    break;
                }
                let s0 = s - w * 0.5;
                let s1 = s + w * 0.5;
                if !occ.iter().any(|&(o0, o1, f)| f == floor && s0 < o1 + 0.2 && s1 > o0 - 0.2) {
                    occ.push((s0, s1, floor));
                    signs.push(Sign {
                        x: a[0] + dir[0] * s + nrm[0] * 0.25,
                        z: a[1] + dir[1] * s + nrm[1] * 0.25,
                        y,
                        yaw: nrm[0].atan2(nrm[1]),
                        w,
                        h: if floor == 0 { hgt } else { 0.95 },
                        label: li,
                        vertical: false,
                    });
                    placed = true;
                    break;
                }
                floor += 1;
            }
            if !placed {
                skipped += 1;
                continue;
            }
        }
        if is_brand {
            brand_count += 1;
        } else {
            generic_count += 1;
        }
    }


    // ---- Streetscape density pass (generic names only; brands via billboards) ----
    let upper: [&str; 18] = ["노래연습장", "PC방", "호프", "당구장", "BAR", "헤어", "네일", "필라테스", "영어학원", "치과", "부동산", "오락실", "룸카페", "보드게임", "스튜디오", "만화카페", "코인노래방", "방탈출"];
    let vert: [&str; 10] = ["노래방", "PC방", "호프", "당구장", "BAR", "CLUB", "룸카페", "오락실", "포차", "맛집"];
    let ads: [(&str, &str, &str); 12] = [
        ("기가커피", "#3A2416", "#FFD400"), ("라떼", "#FFFFFF", "#DA291C"), ("심송", "#FFFFFF", "#1428A0"),
        ("CUZ", "#FFFFFF", "#652F8D"), ("스타덕스", "#FFFFFF", "#00704A"), ("농담식품 매운라면", "#FFFFFF", "#C8102E"),
        ("참아슬", "#FFFFFF", "#0B6E4F"), ("다음처럼", "#FFFFFF", "#1D4E9E"), ("올리브올드", "#FFFFFF", "#8DC63F"),
        ("꾸팡", "#FFFFFF", "#E8501E"), ("배달의겨레", "#FFFFFF", "#2AC1BC"), ("코코아T", "#1A1A1A", "#FFE000"),
    ];
    let window_style: [(&str, &str); 3] = [("#1A2026", "#FFD400"), ("#1A2026", "#FFFFFF"), ("#10161C", "#FF6FA8")];
    fn lab(labels: &mut Vec<Label>, ix: &mut HashMap<(String, &'static str, &'static str), u16>, t: &str, fg: &'static str, bg: &'static str, brand: bool) -> u16 {
        *ix.entry((t.to_string(), fg, bg)).or_insert_with(|| {
            labels.push(Label { text: t.to_string(), fg, bg, brand });
            (labels.len() - 1) as u16
        })
    }
    let road_dist = |p: P2| -> (f32, u8) {
        let mut best = (f32::MAX, 0u8);
        for r in &roads {
            for sgm in r.pts.windows(2) {
                let (c, _) = closest_on_segment(p, sgm[0], sgm[1]);
                let d = kta_core::geom::dist2(p, c).sqrt() - r.width * 0.5;
                if d < best.0 {
                    best = (d, r.kind & !data::ONEWAY);
                }
            }
        }
        best
    };
    let mut signed_edges: Vec<(usize, usize)> = occupancy.keys().copied().collect();
    signed_edges.sort();
    let mut extra_n = 0usize;
    let mut done_bld: HashMap<usize, ()> = HashMap::new();
    for &(bi, ei) in &signed_edges {
        if done_bld.contains_key(&bi) {
            continue;
        }
        done_bld.insert(bi, ());
        let b = &buildings[bi];
        let lv = b.levels as u32;
        if lv < 3 {
            continue;
        }
        let n = b.pts.len();
        let (a, c) = (b.pts[ei], b.pts[(ei + 1) % n]);
        let d = [c[0] - a[0], c[1] - a[1]];
        let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
        if len < 3.0 {
            continue;
        }
        let dir = [d[0] / len, d[1] / len];
        let nrm = [dir[1], -dir[0]];
        let mut h = hash(bi as u64 * 31 + 7);
        let mut rnd = || {
            h = hash(h);
            (h % 10_000) as f32 / 10_000.0
        };
        // Upper-floor horizontal signs (some styled as window lettering).
        let k = 1 + (rnd() * (lv.min(4) - 1) as f32) as u32;
        for _ in 0..k {
            let floor = 1 + (rnd() * (lv - 1) as f32) as u32;
            let txt = upper[(rnd() * upper.len() as f32) as usize % upper.len()];
            let (bg, fg) = if rnd() < 0.45 {
                window_style[(rnd() * 3.0) as usize % 3]
            } else {
                GENERIC_PALETTE[(rnd() * GENERIC_PALETTE.len() as f32) as usize % GENERIC_PALETTE.len()]
            };
            let w = (char_units(txt) * 0.7 + 1.2).max(len * 0.5).min(len - 0.4).min(9.0);
            if w < 1.5 {
                continue;
            }
            let s = sclamp(rnd() * len, w * 0.5 + 0.2, len - w * 0.5 - 0.2);
            let y = floor as f32 * 3.3 + 1.7;
            if y + 0.6 > b.height {
                continue;
            }
            let occ = occupancy.entry((bi, ei)).or_default();
            if occ.iter().any(|&(o0, o1, f)| f == floor && s - w * 0.5 < o1 + 0.2 && s + w * 0.5 > o0 - 0.2) {
                continue;
            }
            occ.push((s - w * 0.5, s + w * 0.5, floor));
            let li = lab(&mut labels, &mut label_ix, txt, fg, bg, false);
            signs.push(Sign { x: a[0] + dir[0] * s + nrm[0] * 0.25, z: a[1] + dir[1] * s + nrm[1] * 0.25, y, yaw: nrm[0].atan2(nrm[1]), w, h: 0.95, label: li, vertical: false });
            extra_n += 1;
        }
        // Vertical LED sign stack at an edge end.
        if lv >= 4 && rnd() < 0.55 {
            let s = if rnd() < 0.5 { 0.7 } else { len - 0.7 };
            let mut y0 = 3.9;
            for _ in 0..(1 + (rnd() < 0.5) as u32) {
                let txt = vert[(rnd() * vert.len() as f32) as usize % vert.len()];
                let hh = (char_units(txt) * 0.62 + 0.6).min(5.0);
                if y0 + hh > b.height - 0.3 {
                    break;
                }
                let (bg, fg) = GENERIC_PALETTE[(rnd() * GENERIC_PALETTE.len() as f32) as usize % GENERIC_PALETTE.len()];
                let li = lab(&mut labels, &mut label_ix, txt, fg, bg, false);
                signs.push(Sign { x: a[0] + dir[0] * s + nrm[0] * 0.6, z: a[1] + dir[1] * s + nrm[1] * 0.6, y: y0 + hh * 0.5, yaw: dir[0].atan2(dir[1]), w: 0.72, h: hh, label: li, vertical: true });
                y0 += hh + 0.25;
                extra_n += 1;
            }
        }
    }
    // Rooftop billboards on taller buildings along major roads.
    let mut cand: Vec<(f32, usize, usize)> = Vec::new();
    for (bi, b) in buildings.iter().enumerate() {
        if b.height < 16.0 {
            continue;
        }
        let n = b.pts.len();
        for ei in 0..n {
            let (a, c) = (b.pts[ei], b.pts[(ei + 1) % n]);
            let d = [c[0] - a[0], c[1] - a[1]];
            let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
            if len < 7.0 {
                continue;
            }
            let nrm = [d[1] / len, -d[0] / len];
            let mid = [a[0] + d[0] * 0.5 + nrm[0] * 4.0, a[1] + d[1] * 0.5 + nrm[1] * 4.0];
            let (dist, rk) = road_dist(mid);
            if dist < 5.0 && matches!(rk, road::PRIMARY | road::SECONDARY) {
                cand.push((b.height + len * 0.1, bi, ei));
            }
        }
    }
    cand.sort_by(|x, y| y.0.partial_cmp(&x.0).unwrap());
    let mut used: HashMap<usize, ()> = HashMap::new();
    let mut boards = 0usize;
    for &(_, bi, ei) in &cand {
        if boards >= 14 || used.contains_key(&bi) {
            continue;
        }
        used.insert(bi, ());
        let b = &buildings[bi];
        let n = b.pts.len();
        let (a, c) = (b.pts[ei], b.pts[(ei + 1) % n]);
        let d = [c[0] - a[0], c[1] - a[1]];
        let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
        let nrm = [d[1] / len, -d[0] / len];
        let (txt, fg, bg) = ads[boards % ads.len()];
        let li = lab(&mut labels, &mut label_ix, txt, fg, bg, true);
        let w = (len * 0.8).min(13.0);
        let hh = 3.2;
        signs.push(Sign {
            x: a[0] + d[0] * 0.5 - nrm[0] * 0.4,
            z: a[1] + d[1] * 0.5 - nrm[1] * 0.4,
            y: b.height + 1.4 + hh * 0.5,
            yaw: nrm[0].atan2(nrm[1]),
            w,
            h: hh,
            label: li,
            vertical: false,
        });
        boards += 1;
    }
    eprintln!("density pass: +{} signs, {} rooftop billboards", extra_n, boards);

    let map = MapData { origin_lat: lat0, origin_lon: lon0, buildings, roads, entrances, signs };
    let bin = data::write(&map);
    let out_dir = std::path::Path::new(&args[2]);
    std::fs::create_dir_all(out_dir).unwrap();
    std::fs::write(out_dir.join(format!("{}.bin", args[3])), &bin).unwrap();

    let mut js = String::from("{\"attribution\":\"© OpenStreetMap contributors (ODbL)\",\"labels\":[");
    for (i, l) in labels.iter().enumerate() {
        if i > 0 {
            js.push(',');
        }
        let esc = l.text.replace('\\', "\\\\").replace('"', "\\\"");
        let _ = write!(js, "{{\"t\":\"{}\",\"fg\":\"{}\",\"bg\":\"{}\",\"b\":{}}}", esc, l.fg, l.bg, l.brand as u8);
    }
    js.push_str("]}");
    std::fs::write(out_dir.join(format!("{}.labels.json", args[3])), js).unwrap();

    eprintln!(
        "origin {:.6},{:.6} | buildings {} roads {} entrances {} signs {} (brand {}, generic {}, skipped {}) labels {} | {} bytes",
        lat0,
        lon0,
        map.buildings.len(),
        map.roads.len(),
        map.entrances.len(),
        map.signs.len(),
        brand_count,
        generic_count,
        skipped,
        labels.len(),
        bin.len()
    );
}
