#!/usr/bin/env bash
# Source data for build_humans.mjs (sparse clones, only the needed files):
#   MakeHuman system assets (CC0): base mesh, macro/breast targets, default rig + weights, eyes.
#   CMU motion capture in BVH (free for any use): walk 35_01, run 35_17, standing 77_02.
# Usage: ./fetch_humans.sh <work dir>
#   node build_humans.mjs <work>/makehuman/makehuman/data <work>/cmu-mocap/data ../../web/public/models ../../web/public/textures
set -euo pipefail
W=${1:-work}
mkdir -p "$W" && cd "$W"
if [ ! -d makehuman ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/makehumancommunity/makehuman makehuman
  (cd makehuman && git sparse-checkout set makehuman/data/3dobjs makehuman/data/rigs makehuman/data/eyes \
    makehuman/data/targets/macrodetails makehuman/data/targets/breast)
fi
if [ ! -d cmu-mocap ]; then
  git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/una-dinosauria/cmu-mocap cmu-mocap
  (cd cmu-mocap && git sparse-checkout init --no-cone && \
    git sparse-checkout set /data/035/35_01.bvh /data/035/35_17.bvh /data/077/77_02.bvh && git checkout -q HEAD)
fi
echo "ok: $W/makehuman/makehuman/data $W/cmu-mocap/data"
