/* tslint:disable */
/* eslint-disable */

export class Game {
    free(): void;
    [Symbol.dispose](): void;
    building_count(): number;
    chunk_bounds(i: number): Float32Array;
    chunk_count(): number;
    /**
     * [pos_ptr, pos_len, nrm_ptr, nrm_len, attr_ptr, attr_len, idx_ptr, idx_len, buildings]
     */
    chunk_desc(i: number): Uint32Array;
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
     * Footprints for the minimap: n, x0, z0, x1, z1, ... per building.
     */
    minimap_buildings(): Float32Array;
    /**
     * Roads for the minimap: n, kind, width, x0, z0, ... per road.
     */
    minimap_roads(): Float32Array;
    constructor(data: Uint8Array | number[], seed: number, crowd: number);
    /**
     * Pointer to 6 floats: x, y, z, yaw, speed, phase.
     */
    player_ptr(): number;
    /**
     * [pos_ptr, pos_len, attr_ptr, attr_len, idx_ptr, idx_len]
     */
    roads_desc(): Uint32Array;
    /**
     * Flattened signs: x, y, z, yaw, w, h, label, vertical.
     */
    signs(): Float32Array;
    spawn(x: number, z: number): void;
    step(dt: number, bits: number, fx: number, fz: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_game_free: (a: number, b: number) => void;
    readonly game_building_count: (a: number) => number;
    readonly game_chunk_bounds: (a: number, b: number) => [number, number];
    readonly game_chunk_count: (a: number) => number;
    readonly game_chunk_desc: (a: number, b: number) => [number, number];
    readonly game_crowd_count: (a: number) => number;
    readonly game_crowd_ptr: (a: number) => number;
    readonly game_entrances: (a: number) => [number, number];
    readonly game_free_meshes: (a: number) => void;
    readonly game_minimap_buildings: (a: number) => [number, number];
    readonly game_minimap_roads: (a: number) => [number, number];
    readonly game_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly game_player_ptr: (a: number) => number;
    readonly game_roads_desc: (a: number) => [number, number];
    readonly game_signs: (a: number) => [number, number];
    readonly game_spawn: (a: number, b: number, c: number) => void;
    readonly game_step: (a: number, b: number, c: number, d: number, e: number) => void;
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
