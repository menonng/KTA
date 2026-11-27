//! KTA game core: platform-independent world state, procedural meshes and
//! simulation. Compiled to WASM for the web client and tested natively.

pub mod data;
pub mod geom;
pub mod mesh;
pub mod sim;

use data::MapData;
use mesh::{MeshBuf, RoadBuf};
use sim::{Crowd, Player, SegGrid};

pub struct World {
    pub map: MapData,
    pub chunks: Vec<MeshBuf>,
    pub roads: RoadBuf,
    pub grid: SegGrid,
    pub player: Player,
    pub crowd: Crowd,
}

impl World {
    pub fn new(bytes: &[u8], seed: u32, crowd: usize) -> Result<World, data::ParseError> {
        let map = data::parse(bytes)?;
        let chunks = mesh::build_chunks(&map, 96.0);
        let roads = mesh::build_roads(&map);
        let grid = SegGrid::new(&map, 12.0);
        let crowd = Crowd::new(&map, crowd, seed);
        Ok(World { map, chunks, roads, grid, player: Player::default(), crowd })
    }

    /// Release generated mesh buffers once the renderer has uploaded them.
    pub fn free_meshes(&mut self) {
        self.chunks = Vec::new();
        self.roads = RoadBuf::default();
    }

    pub fn spawn(&mut self, x: f32, z: f32) {
        self.player.state[0] = x;
        self.player.state[2] = z;
        let mut p = [x, z];
        self.grid.resolve(&mut p, 0.32);
        self.player.state[0] = p[0];
        self.player.state[2] = p[1];
    }

    pub fn step(&mut self, dt: f32, bits: u32, fwd: [f32; 2]) {
        // Fixed sub-steps keep collision stable at low frame rates.
        let mut left = dt.min(0.25);
        while left > 1e-5 {
            let h = left.min(1.0 / 30.0);
            self.player.step(&self.grid, h, bits, fwd);
            left -= h;
        }
        self.crowd.step(dt.min(0.25));
    }
}
