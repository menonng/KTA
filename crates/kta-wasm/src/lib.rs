//! Thin wasm-bindgen layer. Bulk data is exposed as (pointer, length) pairs
//! into WASM memory so JS can read it without per-object calls.

use kta_core::World;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Game {
    w: World,
}

fn ptr<T>(v: &[T]) -> u32 {
    v.as_ptr() as usize as u32
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8], seed: u32, crowd: u32) -> Result<Game, JsError> {
        World::new(data, seed, crowd as usize)
            .map(|w| Game { w })
            .map_err(|e| JsError::new(e.0))
    }

    pub fn chunk_count(&self) -> u32 {
        self.w.chunks.len() as u32
    }

    /// [pos_ptr, pos_len, nrm_ptr, nrm_len, attr_ptr, attr_len, idx_ptr, idx_len, buildings]
    pub fn chunk_desc(&self, i: u32) -> Vec<u32> {
        let c = &self.w.chunks[i as usize];
        vec![
            ptr(&c.pos), c.pos.len() as u32,
            ptr(&c.nrm), c.nrm.len() as u32,
            ptr(&c.attr), c.attr.len() as u32,
            ptr(&c.idx), c.idx.len() as u32,
            c.buildings,
        ]
    }

    pub fn chunk_bounds(&self, i: u32) -> Vec<f32> {
        self.w.chunks[i as usize].bounds.to_vec()
    }

    /// [pos_ptr, pos_len, attr_ptr, attr_len, idx_ptr, idx_len, nrm_ptr, nrm_len]
    pub fn roads_desc(&self) -> Vec<u32> {
        let r = &self.w.roads;
        vec![ptr(&r.pos), r.pos.len() as u32, ptr(&r.attr), r.attr.len() as u32, ptr(&r.idx), r.idx.len() as u32, ptr(&r.nrm), r.nrm.len() as u32]
    }

    /// Walking-surface height (raised pavements, kerb ramps, bus platforms).
    pub fn ground_y(&self, x: f32, z: f32) -> f32 {
        self.w.ground.height([x, z])
    }

    /// Pointer to one float per pedestrian: eased ground height under the feet.
    pub fn ped_y_ptr(&self) -> u32 {
        ptr(&self.w.ped_y)
    }

    /// Tactile paving: x, y, z, yaw, size x, size z, kind (0 dots, 1 lines).
    pub fn tactile(&self) -> Vec<f32> {
        self.w.props.tactile.clone()
    }

    /// Bus stops: x, z, yaw, kind per stop (kta_core::data::stop).
    pub fn stops(&self) -> Vec<f32> {
        self.w.map.stops.iter().flat_map(|s| [s.x, s.z, s.yaw, s.kind as f32]).collect()
    }

    pub fn stop_name(&self, i: u32) -> String {
        self.w.map.stops.get(i as usize).map(|s| self.w.map.name(s.name).to_string()).unwrap_or_default()
    }

    /// Signalised junction sites: x, z, axis yaw, id.
    pub fn signal_sites(&self) -> Vec<f32> {
        self.w.props.signal_sites.clone()
    }

    /// Junction points of signal sites: x, z, widest half width, site.
    pub fn signal_points(&self) -> Vec<f32> {
        self.w.props.signal_points.clone()
    }

    /// Signal heads: kind (0 vehicle, 1 pedestrian), x, z, yaw, group, site, reach.
    pub fn signal_heads(&self) -> Vec<f32> {
        self.w.props.signal_heads.clone()
    }

    /// Stop lines: x, z, yaw, width.
    pub fn stop_lines(&self) -> Vec<f32> {
        self.w.props.stop_lines.clone()
    }

    /// Point features (signals, crossings): x, z, kind.
    pub fn nodes(&self) -> Vec<f32> {
        self.w.map.nodes.iter().flat_map(|n| [n.x, n.z, n.kind as f32]).collect()
    }

    pub fn free_meshes(&mut self) {
        self.w.free_meshes();
    }

    pub fn building_count(&self) -> u32 {
        self.w.map.buildings.len() as u32
    }

    /// Flattened entrances: x, z, yaw, exit_no.
    pub fn entrances(&self) -> Vec<f32> {
        self.w.map.entrances.iter().flat_map(|e| [e.x, e.z, e.yaw, e.exit_no as f32]).collect()
    }

    /// Flattened signs: x, y, z, yaw, w, h, label, flags (bit 0 vertical, bits 1-3 mount).
    pub fn signs(&self) -> Vec<f32> {
        self.w
            .map
            .signs
            .iter()
            .flat_map(|s| [s.x, s.y, s.z, s.yaw, s.w, s.h, s.label as f32, (s.vertical as u8 | s.mount << 1) as f32])
            .collect()
    }

    /// Footprints for the minimap: n, x0, z0, x1, z1, ... per building.
    pub fn minimap_buildings(&self) -> Vec<f32> {
        let mut o = Vec::new();
        for b in &self.w.map.buildings {
            o.push(b.pts.len() as f32);
            for p in &b.pts {
                o.push(p[0]);
                o.push(p[1]);
            }
        }
        o
    }

    /// Roads for the minimap: n, kind, width, x0, z0, ... per road.
    pub fn minimap_roads(&self) -> Vec<f32> {
        let mut o = Vec::new();
        for r in &self.w.map.roads {
            o.push(r.pts.len() as f32);
            o.push(r.kind as f32);
            o.push(r.width);
            for p in &r.pts {
                o.push(p[0]);
                o.push(p[1]);
            }
        }
        o
    }

    pub fn spawn(&mut self, x: f32, z: f32) {
        self.w.spawn(x, z);
    }

    pub fn step(&mut self, dt: f32, bits: u32, fx: f32, fz: f32) {
        self.w.step(dt, bits, [fx, fz]);
    }

    /// Camera collision: free fraction of target -> camera (1 = clear).
    pub fn camera_clear(&self, tx: f32, ty: f32, tz: f32, cx: f32, cy: f32, cz: f32) -> f32 {
        self.w.camera_clear([tx, ty, tz], [cx, cy, cz])
    }

    /// Pointer to 6 floats: x, y, z, yaw, speed, phase.
    pub fn player_ptr(&self) -> u32 {
        ptr(&self.w.player.state)
    }

    /// Pointer to 4 floats per pedestrian: x, z, yaw, phase.
    pub fn crowd_ptr(&self) -> u32 {
        ptr(&self.w.crowd.out)
    }

    pub fn crowd_count(&self) -> u32 {
        self.w.crowd.len() as u32
    }

    /// Prop cells: flattened (cx, cz, primitive count). Cell size is 128 m.
    pub fn prop_cells(&self) -> Vec<i32> {
        self.w.props.cell_list()
    }

    pub fn prop_count(&self) -> u32 {
        self.w.props.prim_count as u32
    }

    /// Build one prop cell into the reused scratch mesh.
    /// Returns [pos_ptr, pos_len, nrm_ptr, nrm_len, col_ptr, col_len, idx_ptr, idx_len].
    pub fn build_prop_cell(&mut self, cx: i32, cz: i32) -> Vec<u32> {
        self.w.props.build_cell(cx, cz);
        let m = &self.w.props.scratch;
        vec![ptr(&m.pos), m.pos.len() as u32, ptr(&m.nrm), m.nrm.len() as u32, ptr(&m.col), m.col.len() as u32, ptr(&m.idx), m.idx.len() as u32]
    }

    /// Model instances of one prop cell: model, x, y, z, yaw, sx, sy, sz per instance.
    pub fn prop_cell_instances(&self, cx: i32, cz: i32) -> Vec<f32> {
        self.w.props.cell_instances(cx, cz)
    }

    /// Parked vehicles: x, z, yaw, type, paint seed per car.
    pub fn parked_cars(&self) -> Vec<f32> {
        self.w.props.parked.clone()
    }

    /// Wire line segments: x0, y0, z0, x1, y1, z1, ...
    pub fn wires(&self) -> Vec<f32> {
        self.w.props.wires.clone()
    }

    /// Crosswalks: x, z, yaw, width, length.
    pub fn crosswalks(&self) -> Vec<f32> {
        self.w.props.crosswalks.clone()
    }

    /// Street lamp light pools: x, z.
    pub fn lamps(&self) -> Vec<f32> {
        self.w.props.lamps.clone()
    }

    /// [pos_ptr, pos_len, alpha_ptr, alpha_len, idx_ptr, idx_len] for ground contact shadows.
    pub fn skirt_desc(&self) -> Vec<u32> {
        let s = &self.w.skirt;
        vec![ptr(&s.0), s.0.len() as u32, ptr(&s.1), s.1.len() as u32, ptr(&s.2), s.2.len() as u32]
    }

    /// [pos_ptr, pos_len, alpha_ptr, alpha_len, idx_ptr, idx_len] for night light spill.
    pub fn spill_desc(&self) -> Vec<u32> {
        let s = &self.w.spill;
        vec![ptr(&s.0), s.0.len() as u32, ptr(&s.1), s.1.len() as u32, ptr(&s.2), s.2.len() as u32]
    }
}
