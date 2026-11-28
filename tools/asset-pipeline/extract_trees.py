"""Street trees around the map from the Seoul street-tree register.

Source: 서울시 가로수 위치정보 (data.seoul.go.kr OA-23040, 2026 edition, XLSX,
one sheet per managing office; columns 자치구, 노선, 수종, 도로명 주소,
지번 주소, 좌표(경도), 좌표(위도), WGS84). Licence: 공공누리 제4유형
(출처표시, 상업적 이용금지, 변경금지) - the raw file and this extract stay out
of the repository; only the game map built from them is committed.

Usage: python3 extract_trees.py <register.xlsx> <out.tsv> [lat0 lat1 lon0 lon1]
"""
import sys

import openpyxl

src, out = sys.argv[1], sys.argv[2]
LAT0, LAT1, LON0, LON1 = (float(v) for v in sys.argv[3:7]) if len(sys.argv) >= 7 else (37.535, 37.575, 126.890, 126.945)
wb = openpyxl.load_workbook(src, read_only=True)
rows = []
for ws in wb.worksheets:
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i < 3 or not r or len(r) < 7 or r[5] in (None, ''):
            continue
        try:
            lon, lat = float(r[5]), float(r[6])
        except (TypeError, ValueError):
            continue
        if LAT0 <= lat <= LAT1 and LON0 <= lon <= LON1:
            rows.append((lat, lon, (r[2] or '').strip(), (r[1] or '').strip(), (r[0] or '').strip(), (r[3] or r[4] or '').strip()))
with open(out, 'w', encoding='utf-8') as f:
    f.write('# lat\tlon\tspecies\troute\tmanager\taddress  (서울시 가로수 위치정보 2026, 공공누리 4유형)\n')
    for r in rows:
        f.write('%.7f\t%.7f\t%s\t%s\t%s\t%s\n' % r)
print(f'{len(rows)} trees -> {out}')
