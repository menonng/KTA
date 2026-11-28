/* @ts-self-types="./kta_wasm.d.ts" */

export class Game {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GameFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_game_free(ptr, 0);
    }
    /**
     * Build one prop cell into the reused scratch mesh.
     * Returns [pos_ptr, pos_len, nrm_ptr, nrm_len, col_ptr, col_len, idx_ptr, idx_len].
     * @param {number} cx
     * @param {number} cz
     * @returns {Uint32Array}
     */
    build_prop_cell(cx, cz) {
        const ret = wasm.game_build_prop_cell(this.__wbg_ptr, cx, cz);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    building_count() {
        const ret = wasm.game_building_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Camera collision: free fraction of target -> camera (1 = clear).
     * @param {number} tx
     * @param {number} ty
     * @param {number} tz
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @returns {number}
     */
    camera_clear(tx, ty, tz, cx, cy, cz) {
        const ret = wasm.game_camera_clear(this.__wbg_ptr, tx, ty, tz, cx, cy, cz);
        return ret;
    }
    /**
     * @param {number} i
     * @returns {Float32Array}
     */
    chunk_bounds(i) {
        const ret = wasm.game_chunk_bounds(this.__wbg_ptr, i);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    chunk_count() {
        const ret = wasm.game_chunk_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * [pos_ptr, pos_len, nrm_ptr, nrm_len, attr_ptr, attr_len, idx_ptr, idx_len, buildings]
     * @param {number} i
     * @returns {Uint32Array}
     */
    chunk_desc(i) {
        const ret = wasm.game_chunk_desc(this.__wbg_ptr, i);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Crosswalks: x, z, yaw, width, length.
     * @returns {Float32Array}
     */
    crosswalks() {
        const ret = wasm.game_crosswalks(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    crowd_count() {
        const ret = wasm.game_crowd_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Pointer to 4 floats per pedestrian: x, z, yaw, phase.
     * @returns {number}
     */
    crowd_ptr() {
        const ret = wasm.game_crowd_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Flattened entrances: x, z, yaw, exit_no.
     * @returns {Float32Array}
     */
    entrances() {
        const ret = wasm.game_entrances(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    free_meshes() {
        wasm.game_free_meshes(this.__wbg_ptr);
    }
    /**
     * Walking-surface height (raised pavements, kerb ramps, bus platforms).
     * @param {number} x
     * @param {number} z
     * @returns {number}
     */
    ground_y(x, z) {
        const ret = wasm.game_ground_y(this.__wbg_ptr, x, z);
        return ret;
    }
    /**
     * Street lamp light pools: x, z.
     * @returns {Float32Array}
     */
    lamps() {
        const ret = wasm.game_lamps(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Footprints for the minimap: n, x0, z0, x1, z1, ... per building.
     * @returns {Float32Array}
     */
    minimap_buildings() {
        const ret = wasm.game_minimap_buildings(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Roads for the minimap: n, kind, width, x0, z0, ... per road.
     * @returns {Float32Array}
     */
    minimap_roads() {
        const ret = wasm.game_minimap_roads(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {Uint8Array | number[]} data
     * @param {number} seed
     * @param {number} crowd
     */
    constructor(data, seed, crowd) {
        const val2 = +seed;
        const val3 = +crowd;
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.game_new(ptr0, len0, val2, val3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        GameFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Point features (signals, crossings): x, z, kind.
     * @returns {Float32Array}
     */
    nodes() {
        const ret = wasm.game_nodes(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Parked vehicles: x, z, yaw, type, paint seed per car.
     * @returns {Float32Array}
     */
    parked_cars() {
        const ret = wasm.game_parked_cars(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Pointer to one float per pedestrian: eased ground height under the feet.
     * @returns {number}
     */
    ped_y_ptr() {
        const ret = wasm.game_ped_y_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Pointer to 6 floats: x, y, z, yaw, speed, phase.
     * @returns {number}
     */
    player_ptr() {
        const ret = wasm.game_player_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Model instances of one prop cell: model, x, y, z, yaw, sx, sy, sz per instance.
     * @param {number} cx
     * @param {number} cz
     * @returns {Float32Array}
     */
    prop_cell_instances(cx, cz) {
        const ret = wasm.game_prop_cell_instances(this.__wbg_ptr, cx, cz);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Prop cells: flattened (cx, cz, primitive count). Cell size is 128 m.
     * @returns {Int32Array}
     */
    prop_cells() {
        const ret = wasm.game_prop_cells(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    prop_count() {
        const ret = wasm.game_prop_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * [pos_ptr, pos_len, attr_ptr, attr_len, idx_ptr, idx_len, nrm_ptr, nrm_len]
     * @returns {Uint32Array}
     */
    roads_desc() {
        const ret = wasm.game_roads_desc(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Flattened signs: x, y, z, yaw, w, h, label, flags (bit 0 vertical, bits 1-3 mount).
     * @returns {Float32Array}
     */
    signs() {
        const ret = wasm.game_signs(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * [pos_ptr, pos_len, alpha_ptr, alpha_len, idx_ptr, idx_len] for ground contact shadows.
     * @returns {Uint32Array}
     */
    skirt_desc() {
        const ret = wasm.game_skirt_desc(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} x
     * @param {number} z
     */
    spawn(x, z) {
        wasm.game_spawn(this.__wbg_ptr, x, z);
    }
    /**
     * [pos_ptr, pos_len, alpha_ptr, alpha_len, idx_ptr, idx_len] for night light spill.
     * @returns {Uint32Array}
     */
    spill_desc() {
        const ret = wasm.game_spill_desc(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} dt
     * @param {number} bits
     * @param {number} fx
     * @param {number} fz
     */
    step(dt, bits, fx, fz) {
        wasm.game_step(this.__wbg_ptr, dt, bits, fx, fz);
    }
    /**
     * @param {number} i
     * @returns {string}
     */
    stop_name(i) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.game_stop_name(this.__wbg_ptr, i);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Bus stops: x, z, yaw, kind per stop (kta_core::data::stop).
     * @returns {Float32Array}
     */
    stops() {
        const ret = wasm.game_stops(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Tactile paving: x, y, z, yaw, size x, size z, kind (0 dots, 1 lines).
     * @returns {Float32Array}
     */
    tactile() {
        const ret = wasm.game_tactile(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Wire line segments: x0, y0, z0, x1, y1, z1, ...
     * @returns {Float32Array}
     */
    wires() {
        const ret = wasm.game_wires(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) Game.prototype[Symbol.dispose] = Game.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_208446807d0d1e30: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./kta_wasm_bg.js": import0,
    };
}

const GameFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_game_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('kta_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
