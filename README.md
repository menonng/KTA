# KTA

SNS에서 유행한 "Life in Korea" GTA풍 이미지(한국 일상을 보내는 오픈월드 게임 주인공)를 반실사 3D 웹게임으로 구현하는 프로젝트입니다.

- 구현 계획서: [docs/implementation-plan.md](docs/implementation-plan.md)
- 패러디 브랜드·국가기관 표기 규칙: [docs/brand-bible.md](docs/brand-bible.md)
- 라이선스 목록: [docs/licenses.md](docs/licenses.md)
- 에셋 스타일: GTA 시리즈 감성을 베이스로, 레퍼런스 이미지들을 기반으로 했습니다. Rockstar의 에셋·캐릭터·로고는 사용하지 않습니다.

## 현재 상태 (Phase 0 일부)

홍대입구역 주변 약 1km × 1km를 OpenStreetMap 데이터로 만들었습니다. 건물 2,225동, 도로, 지하철 출입구 9곳, 보행자 90명이 있습니다. 간판은 약 15,500개(유리창 시트·어닝·입간판·옥상 십자가 포함)입니다. 한국식 작명의 가상 상호와 로고 마크, 폰트 62종(한글·영문·일본어·중국어·태국어)으로 미리 그린 그림 3,280종을 씁니다. 프랜차이즈는 실제 매장 사진에 맞춘 외관을 따릅니다. 거리 소품(실외기, 전기함, 의자·상자, 맨홀, 셔터, 덮개 씌운 차)은 Poly Haven CC0 3D 모델, 가로수는 은행잎 카드형 나무입니다. 차량은 코드로 만든 6종(세단·경차·SUV·택시·1톤 트럭·시내버스)이 골목과 갓길에 주차되어 있고, 큰길에서는 72대가 차선을 따라 달립니다. 하늘·안개·날씨(맑음·흐림·비·눈)는 시각에 따라 바뀝니다. 실사 질감은 Poly Haven CC0 텍스처입니다.

## 구조

```
crates/kta-core      게임 코어(Rust): 데이터 형식, 절차적 메시 생성, 충돌, 보행자
crates/kta-wasm      wasm-bindgen 바인딩
crates/kta-datatool  OSM → 압축 타일 + 간판 요청 목록 변환 도구
tools/signgen        간판 그림 생성기(빌드 때만 실행, 폰트는 배포하지 않음)
tools/asset-pipeline 사진 텍스처·3D 모델(CC0) 내려받기, 폴리곤 감소, KTX2 압축, 가로수 텍스처
web/                 Three.js 렌더러, HUD, 입력 (Vite)
data-src/osm         원본 지도 데이터
```

## 빌드

필요한 도구: Rust(stable) + `wasm32-unknown-unknown` 타깃, `wasm-bindgen-cli 0.2.130`, Node 22.

```bash
cd web && npm ci && cd ..
(cd tools/signgen && npm ci)   # 간판 그림을 다시 만들 때만 필요(폰트 약 360MB)
./scripts/build.sh          # 데이터 변환 → 간판 그림 → WASM 빌드 → 웹 번들(web/dist)
# 3D 모델·가로수 텍스처를 다시 만들 때만:
# (cd tools/asset-pipeline && npm ci && python3 fetch_models.py work && node build_models.mjs work ../../web/public/models && node build_trees.mjs work ../../web/public/textures)
cd web && npm run preview   # http://localhost:4173
```

`web/src/wasm`(WASM 빌드 결과), `web/public/data`(변환된 지도), `web/public/textures`(압축 텍스처·간판 그림), `web/public/models`(압축 3D 모델)는 저장소에 포함합니다. 그래서 웹 쪽만 빌드할 때는 Rust 없이 `cd web && npm ci && npm run build`로 충분합니다.

## 조작

WASD 이동 · Shift 달리기 · 드래그 시점 · 휠 줌 · N 낮/밤 전환 · F3 성능 정보. B 날씨 전환. URL 옵션: `?debug`(성능 정보), `?weather=rain`(날씨), `?notraffic`(주행 차량 끄기), `?time=21.5`(시작 시각), `?scale=0.75`(렌더 배율), `?bench`(벤치마크), `?fps=30`(프레임 상한).

## 배포 (Cloudflare Pages)

Cloudflare 대시보드 → Workers & Pages → 만들기 → Pages → Git에 연결 → 이 저장소를 고르고 아래처럼 설정합니다.

| 항목 | 값 |
|---|---|
| 프로덕션 브랜치 | `claude/korea-gta-implementation-plan-cu0rom` (나중에 main으로 변경) |
| 프레임워크 프리셋 | 없음 |
| 빌드 명령 | `npm run build` (의존성 설치는 Cloudflare가 먼저 자동으로 합니다) |
| 빌드 출력 디렉터리 | `dist` |
| 루트 디렉터리 | `web` |
| 환경 변수 | 필요 없음(`web/.nvmrc`가 Node 22를 지정) |

푸시할 때마다 자동으로 배포되고, 브랜치마다 미리보기 주소가 생깁니다. 캐시 헤더는 `web/public/_headers`에 있습니다.
