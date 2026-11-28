"""Clip the MOLIT GIS building integrated dataset (GIS건물통합정보, SHP,
EPSG:5186) to the OSM map bounds and keep only what the game needs.

Usage: python3 extract_buildings.py <shp_base> <map.osm> <out.tsv>
Output (one building per line, read by kta-datatool):
  height_m <TAB> floors <TAB> kind <TAB> lat,lon;lat,lon;...   (outer ring)
  kind: 0 other, 1 residential, 2 commercial/office, 3 public, 4 transport
Lines starting with # are comments (source, licence note).
Fields used (layout of AL_D010): A9 용도명, A16 높이(m), A24 건물명, A26 지상층수.
"""
import json, re, sys
import shapefile
from pyproj import Transformer

base, osm, out = sys.argv[1:4]
head = open(osm, encoding='utf-8').read(4000)
b = dict(re.findall(r'(minlat|minlon|maxlat|maxlon)="([0-9.]+)"', head))
minlat, minlon, maxlat, maxlon = (float(b[k]) for k in ('minlat', 'minlon', 'maxlat', 'maxlon'))
to5186 = Transformer.from_crs('EPSG:4326', 'EPSG:5186', always_xy=True)
to4326 = Transformer.from_crs('EPSG:5186', 'EPSG:4326', always_xy=True)
xs, ys = zip(*[to5186.transform(lo, la) for lo, la in ((minlon, minlat), (maxlon, minlat), (minlon, maxlat), (maxlon, maxlat))])
box = (min(xs) - 30, min(ys) - 30, max(xs) + 30, max(ys) + 30)

r = shapefile.Reader(base, encoding='euc_kr')
names = [f[0] for f in r.fields[1:]]
ix = {k: names.index(k) for k in ('A9', 'A16', 'A24', 'A26')}
res = []
for i in range(r.numRecords):
    sh = r.shape(i)
    bx = sh.bbox
    if bx[2] < box[0] or bx[0] > box[2] or bx[3] < box[1] or bx[1] > box[3]:
        continue
    rec = r.record(i)
    parts = list(sh.parts) + [len(sh.points)]
    ring = sh.points[parts[0]:parts[1]]  # outer ring
    pts = [[round(la, 7), round(lo, 7)] for lo, la in (to4326.transform(x, y) for x, y in ring)]
    res.append({'pts': pts, 'h': round(float(rec[ix['A16']] or 0), 2), 'fl': int(rec[ix['A26']] or 0),
                'use': rec[ix['A9']] or '', 'name': (rec[ix['A24']] or '').strip()})
def kind_of(use):
    if '주택' in use or '아파트' in use:
        return 1
    if any(k in use for k in ('근린생활', '판매', '업무', '숙박', '위락')):
        return 2
    if any(k in use for k in ('교육', '문화', '종교', '의료', '노유자', '공공', '방송통신', '수련')):
        return 3
    if '운수' in use:
        return 4
    return 0


with open(out, 'w', encoding='utf-8') as f:
    f.write('# Source: 국토교통부 GIS건물통합정보 (AL_D010_11, 2026-11-09 기준), 공공데이터포털 이용허락범위: 제한 없음\n')
    f.write('# Clipped to the OSM map bounds; WGS84 lat,lon converted from EPSG:5186.\n')
    for x in res:
        f.write(f"{x['h']}\t{x['fl']}\t{kind_of(x['use'])}\t" + ';'.join(f'{la},{lo}' for la, lo in x['pts']) + '\n')
hs = [x['h'] for x in res]
print(len(res), 'buildings;', sum(1 for h in hs if h > 0), 'with height;', sum(1 for x in res if x['fl'] > 0), 'with floors')
