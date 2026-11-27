#!/usr/bin/env bash
# Full build: OSM -> tile, Rust core -> WASM, then the web bundle.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo run --release -q -p kta-datatool -- data-src/osm/hongdae.osm web/public/data hongdae data-src/gen
# Sign artwork (fonts are build-time only): cd tools/signgen && npm ci
if [ -d tools/signgen/node_modules ]; then
  node tools/signgen/gen.mjs data-src/gen/hongdae.signreq.json web/public 10
fi
cargo build --release -q -p kta-wasm --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/release/kta_wasm.wasm --target web --out-dir web/src/wasm
if [ -x web/node_modules/.bin/wasm-opt ]; then
  web/node_modules/.bin/wasm-opt -O3 web/src/wasm/kta_wasm_bg.wasm -o web/src/wasm/kta_wasm_bg.wasm
fi
(cd web && npm run build)
