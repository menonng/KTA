# 라이선스 목록

| 대상 | 출처 | 라이선스 | 의무 |
|---|---|---|---|
| 지도 데이터 (`data-src/osm/hongdae.osm`, `web/public/data/*`) | © OpenStreetMap contributors | ODbL 1.0 | 게임 화면에 출처 표기(HUD 오른쪽 아래), 가공한 데이터베이스를 배포하면 ODbL로 공개 |
| 건물 윤곽·높이·층수 (`data-src/gis/hongdae_buildings.tsv`, 지도 범위로 자른 것) | 국토교통부 GIS건물통합정보 (AL_D010_11, 2026-11-09 기준) | 공공데이터포털 표기: 이용허락범위 제한 없음 | 출처 표기 유지. 원본 SHP(140MB)는 저장소에 넣지 않음 |
| 가로수 위치·수종 (지도 바이너리에 그루별로 들어감) | 서울특별시 「서울시 가로수 위치정보」 2026 (data.seoul.go.kr OA-23040) | 공공누리 제4유형: 출처표시 + 상업적 이용금지 + 변경금지 | 출처 표기 유지. 원본 XLSX와 추출본은 저장소에 넣지 않음(`tools/asset-pipeline/fetch_trees.sh`). 상업적으로 배포하려면 이 데이터를 대체해야 함 |
| 매장 위치 2곳 좌표 | Nominatim(OpenStreetMap) 지오코딩 | ODbL 1.0 | OSM 출처 표기에 포함 |
| 한글 폰트 Pretendard | orioncactus/pretendard | SIL Open Font License 1.1 | 폰트 단독 판매 금지, 라이선스 고지 |
| three.js | mrdoob/three.js | MIT | 저작권 고지 |
| wasm-bindgen | rustwasm/wasm-bindgen | MIT / Apache-2.0 | 저작권 고지 |
| roxmltree | RazrFalcon/roxmltree | MIT / Apache-2.0 | 저작권 고지 (데이터 변환 도구에만 사용) |
| Binaryen (wasm-opt) | WebAssembly/binaryen | Apache-2.0 | 빌드 도구로만 사용 |
| 벽·바닥 사진 텍스처 (`web/public/textures/walls_*`, `ground_*`) | Poly Haven (red_brick_03, brick_wall_10, beige_wall_001, rectangular_facade_tiles(_02), granite_tile_03, concrete_wall_004, exterior_wall_cladding, concrete_floor_02, asphalt_02, brick_pavement_02, interlocking_concrete_pavers, concrete_pavers_03) | CC0 1.0 | 의무 없음(출처 기록만 유지) |
| 3D 모델 (`web/public/models/*.glb`) | Poly Haven (exterior_aircon_unit, utility_box_02, plastic_monobloc_chair_01, plastic_crate_02, water_manhole_cover, rollershutter_door, covered_car) — 폴리곤 감소·텍스처 압축해 사용 | CC0 1.0 | 의무 없음(출처 기록만 유지) |
| 나무껍질 텍스처 (`web/public/textures/tree_bark_n.ktx2`, `tree_bark_sp.ktx2`의 일반 수피 칸) | Poly Haven (bark_brown_02) | CC0 1.0 | 의무 없음 |
| 수종별 잔가지·잎 카드, 양버즘·벚·소나무 수피 (`web/public/textures/tree_cards.ktx2`, `tree_bark_sp.ktx2`) | 직접 제작(`tools/asset-pipeline/build_species.mjs`가 그림) | 프로젝트 자체 | — |
| 사람 모델 (`web/public/models/people.*`, `web/public/textures/person_*`) | Microsoft Rocketbox Avatar Library (github.com/microsoft/Microsoft-Rocketbox) — 아바타 15종을 머리 교체·피부톤·옷 색 보정해 사용(`tools/asset-pipeline/people/build_people.mjs`) | MIT | 저작권·라이선스 고지 유지: `web/public/licenses/Microsoft-Rocketbox-LICENSE.txt` (Copyright (c) 2020 Microsoft) |
| 사람 동작 (걷기 35_01, 달리기 35_17, 서 있기 77_02, Rocketbox 골격에 리타깃) | CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH 변환본(cgspeed / una-dinosauria/cmu-mocap) | 연구·상업 모두 자유 사용 | 감사 문구 권장: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." |
| glTF Transform, meshoptimizer | donmccurdy/glTF-Transform, zeux/meshoptimizer | MIT | 빌드 도구로만 사용(모델 감소·압축). 게임은 three.js에 포함된 meshopt 디코더(MIT)를 씁니다 |
| Basis Universal 트랜스코더 (`web/public/basis/`) | BinomialLLC/basis_universal (three.js 배포본) | Apache-2.0 | 저작권 고지 |
| ktx2-encoder | gz65555/ktx2-encoder | MIT | 빌드 도구로만 사용 |
| 간판 이미지 제작용 폰트 61종 — 한글·라틴 44종 (Black Han Sans, Do Hyeon, Jua, Nanum Pen/Brush Script, Noto Sans/Serif KR, Nanum Myeongjo, Gugi, Yeon Sung, Sunflower, Song Myung, East Sea Dokdo, Gaegu, Dongle, Hi Melody, Gothic A1, Dokdo, Gamja Flower, Single Day, Stylish, Black And White Picture, Kirang Haerang, Cute Font, Poor Story, Gowun Batang/Dodum, Hahmlet, Orbit, Bebas Neue, Pacifico, Lobster, Oswald, Anton, Righteous, Monoton, Playfair Display, Abril Fatface, Great Vibes, Montserrat, Archivo Black, Permanent Marker, Bungee, Noto Emoji), 일본어 8종 (Noto Sans/Serif JP, Yuji Syuku, Yuji Boku, Zen Antique, Dela Gothic One, Shippori Mincho, RocknRoll One), 중국어 6종 (Noto Sans/Serif TC, Noto Serif SC, Ma Shan Zheng, ZCOOL XiaoWei, LXGW WenKai TC), 태국어 3종 (Noto Sans Thai, Kanit, Sriracha) | Google Fonts (@fontsource 패키지) | SIL Open Font License 1.1 | 빌드 때 간판 그림을 그리는 데만 쓰고 폰트 파일은 배포하지 않습니다. OFL은 폰트로 만든 결과물(이미지)에 제한을 두지 않습니다 |
| 간판 이미지 제작용 폰트 Kosugi Maru (일본어 둥근고딕) | Google Fonts (@fontsource 패키지) | Apache License 2.0 | 위와 같이 빌드 때만 쓰고 배포하지 않습니다. 결과 이미지에 제한 없음 |

에셋을 추가할 때마다 이 표에 출처와 라이선스를 기록합니다. 무료 도구만 사용하는 결정(계획서 6.5)에 따라 CC0·오픈소스만 추가합니다.
