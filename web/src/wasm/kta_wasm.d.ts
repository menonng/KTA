/* tslint:disable */
/* eslint-disable */

export class Game {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Build one prop cell into the reused scratch mesh.
     * Returns [pos_ptr, pos_len, nrm_ptr, nrm_len, col_ptr, col_len, idx_ptr, idx_len].
     */
    build_prop_cell(cx: number, cz: number): Uint32Array;
    building_count(): number;
    /**
     * Camera collision: free fraction of target -> camera (1 = clear).
     */
    camera_clear(tx: number, ty: number, tz: number, cx: number, cy: number, cz: number): number;
    chunk_bounds(i: number): Float32Array;
    chunk_count(): number;
    /**
     * [pos_ptr, pos_len, nrm_ptr, nrm_len, attr_ptr, attr_len, idx_ptr, idx_len, buildings]
     */
    chunk_desc(i: number): Uint32Array;
    /**
     * Crosswalks: x, z, yaw, width, length.
     */
    crosswalks(): Float32Array;
    crowd_count(): number;
    /**
     * Pointer to 4 floats per pedestrian: x, z, yaw, phase.
     */
    crowd_ptr(): number;
    /**
     * Flattened entrances: x, z, yaw, exit_no.
     */
    entrances(): Float32Array;
    free_meshes(): void;
    /**
     * Street lamp light pools: x, z.
     */
    lamps(): Float32Array;
    /**
     * Footprints for the minimap: n, x0, z0, x1, z1, ... per building.
     */
    minimap_buildings(): Float32Array;
    /**
     * Roads for the minimap: n, kind, width, x0, z0, ... per road.
     */
    minimap_roads(): Float32Array;
    constructor(data: Uint8Array | number[], seed: number, crowd: number);
    /**
     * Parked vehicles: x, z, yaw, type, paint seed per car.
     */
    parked_cars(): Float32Array;
    /**
     * Pointer to 6 floats: x, y, z, yaw, speed, phase.
     */
    player_ptr(): number;
    /**
     * Model instances of one prop cell: model, x, y, z, yaw, sx, sy, sz per instance.
     */
    prop_cell_instances(cx: number, cz: number): Float32Array;
    /**
     * Prop cells: flattened (cx, cz, primitive count). Cell size is 128 m.
     */
    prop_cells(): Int32Array;
    prop_count(): number;
    /**
     * [pos_ptr, pos_len, attr_ptr, attr_len, idx_ptr, idx_len]
     */
    roads_desc(): Uint32Array;
    /**
     * Flattened signs: x, y, z, yaw, w, h, label, flags (bit 0 vertical, bits 1-3 mount).
     */
    signs(): Float32Array;
    /**
     * [pos_ptr, pos_len, alpha_ptr, alpha_len, idx_ptr, idx_len] for ground contact shadows.
     */
    skirt_desc(): Uint32Array;
    spawn(x: number, z: number): void;
    /**
     * [pos_ptr, pos_len, alpha_ptr, alpha_len, idx_ptr, idx_len] for night light spill.
     */
    spill_desc(): Uint32Array;
    step(dt: number, bits: number, fx: number, fz: number): void;
    /**
     * Wire line segments: x0, y0, z0, x1, y1, z1, ...
     */
    wires(): Float32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_game_free: (a: number, b: number) => void;
    readonly game_build_prop_cell: (a: number, b: number, c: number) => [number, number];
    readonly game_building_count: (a: number) => number;
    readonly game_camera_clear: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly game_chunk_bounds: (a: number, b: number) => [number, number];
    readonly game_chunk_count: (a: number) => number;
    readonly game_chunk_desc: (a: number, b: number) => [number, number];
    readonly game_crosswalks: (a: number) => [number, number];
    readonly game_crowd_count: (a: number) => number;
    readonly game_crowd_ptr: (a: number) => number;
    readonly game_entrances: (a: number) => [number, number];
    readonly game_free_meshes: (a: number) => void;
    readonly game_lamps: (a: number) => [number, number];
    readonly game_minimap_buildings: (a: number) => [number, number];
    readonly game_minimap_roads: (a: number) => [number, number];
    readonly game_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly game_parked_cars: (a: number) => [number, number];
    readonly game_player_ptr: (a: number) => number;
    readonly game_prop_cell_instances: (a: number, b: number, c: number) => [number, number];
    readonly game_prop_cells: (a: number) => [number, number];
    readonly game_prop_count: (a: number) => number;
    readonly game_roads_desc: (a: number) => [number, number];
    readonly game_signs: (a: number) => [number, number];
    readonly game_skirt_desc: (a: number) => [number, number];
    readonly game_spawn: (a: number, b: number, c: number) => void;
    readonly game_spill_desc: (a: number) => [number, number];
    readonly game_step: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly game_wires: (a: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
