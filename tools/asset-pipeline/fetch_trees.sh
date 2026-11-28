#!/usr/bin/env bash
# Street-tree register for the datatool (real positions and species).
#   서울시 가로수 위치정보 (data.seoul.go.kr OA-23040), 공공누리 제4유형:
#   출처표시 + 상업적 이용금지 + 변경금지. Not committed (data-src/trees is ignored).
# Usage: ./fetch_trees.sh [out dir]   (default ../../data-src/trees)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-$HERE/../../data-src/trees}
mkdir -p "$OUT"
if [ ! -f "$OUT/seoul_trees_2026.xlsx" ]; then
  curl -sSfL -A "kta-asset-pipeline/0.1" -X POST \
    "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false" \
    --data "infId=OA-23040&seqNo=&seq=1&infSeq=4" -o "$OUT/seoul_trees_2026.xlsx"
fi
python3 -I "$HERE/extract_trees.py" "$OUT/seoul_trees_2026.xlsx" "$OUT/hongdae_trees.tsv"
