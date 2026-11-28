#!/usr/bin/env bash
# Source data for people/build_people.mjs (sparse clones, only the needed files):
#   Microsoft Rocketbox avatars (MIT): FBX + textures of the avatars listed below.
#   CMU motion capture in BVH (free for any use): walks 35_01 07_01 08_01 02_01, run 35_17.
# Usage: ./fetch_people.sh <work dir>
#   node people/extract_fbx.mjs <work>/extract.json <work>/rb/Assets/Avatars/*/*/Export/<name>.fbx ...
#   CMU=<work>/cmu/data node people/build_people.mjs <work>/extract.json <work>/rb ../../web/public/models ../../web/public/textures
set -euo pipefail
W=${1:-work}
mkdir -p "$W" && cd "$W"
AVATARS="Professions/Sports_Male_04 Adults/Male_Adult_12 Adults/Male_Adult_09 Adults/Male_Adult_04 Adults/Male_Adult_07
Professions/Business_Male_01 Professions/Business_Male_02 Professions/Business_Male_06
Adults/Female_Adult_05 Adults/Female_Adult_07 Adults/Female_Adult_11 Adults/Female_Adult_12 Adults/Female_Adult_14
Professions/Business_Female_03 Professions/Business_Female_04 Professions/Sports_Female_02"
if [ ! -d rb ]; then
  git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/microsoft/Microsoft-Rocketbox rb
  P=""
  for a in $AVATARS; do n=$(basename "$a"); P="$P /Assets/Avatars/$a/Export/$n.fbx /Assets/Avatars/$a/Textures/"; done
  (cd rb && git sparse-checkout init --no-cone && git sparse-checkout set /LICENSE.md $P && git checkout -q HEAD)
fi
if [ ! -d cmu ]; then
  git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/una-dinosauria/cmu-mocap cmu
  (cd cmu && git sparse-checkout init --no-cone && \
    git sparse-checkout set /data/035/35_01.bvh /data/035/35_17.bvh /data/007/07_01.bvh /data/008/08_01.bvh /data/002/02_01.bvh && git checkout -q HEAD)
fi
echo "ok: $W/rb $W/cmu/data"
