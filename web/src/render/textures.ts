// CC0 photo textures (Poly Haven) packed as KTX2 2D arrays: one sampler for
// all wall materials, one for all ground materials (plan 5.2/5.3).

import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export interface TextureSet {
  wallA: THREE.Texture;
  wallN: THREE.Texture;
  groundA: THREE.Texture;
  groundN: THREE.Texture;
  bytes: number;
}

export async function loadTextures(renderer: THREE.WebGLRenderer): Promise<TextureSet> {
  const loader = new KTX2Loader().setTranscoderPath('basis/').detectSupport(renderer);
  const [wallA, wallN, groundA, groundN] = await Promise.all(
    ['walls_albedo', 'walls_normal', 'ground_albedo', 'ground_normal'].map((n) => loader.loadAsync(`textures/${n}.ktx2`)),
  );
  let bytes = 0;
  for (const t of [wallA, wallN, groundA, groundN]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    const mips = t.mipmaps as unknown as { data: Uint8Array }[];
    for (const m of mips) bytes += m.data.byteLength; // actual transcoded GPU size
    // Free the transcoded CPU copy after upload (it would otherwise stay in the JS heap).
    t.onUpdate = () => {
      for (const m of mips) m.data = new Uint8Array(0);
    };
  }
  wallA.colorSpace = groundA.colorSpace = THREE.SRGBColorSpace;
  wallN.colorSpace = groundN.colorSpace = THREE.NoColorSpace;
  loader.dispose();
  return { wallA, wallN, groundA, groundN, bytes };
}
