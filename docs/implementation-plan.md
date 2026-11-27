# My Life in Korea (가칭) — 3D 구현 계획서

> 문서 버전 **v0.1 (초안)** · 작성일 2026-11-27
> 상태: **원본 레퍼런스 이미지 미확인.** 2장은 가정을 바탕으로 썼고, 레퍼런스를 확인한 뒤 v0.2에서 갱신한다.

---

## 0. 한눈에 보기

| 항목 | 결론 |
|---|---|
| **추천 구조** | **Rust 게임 코어(WASM) + TypeScript/Three.js 렌더러 + HTML/CSS HUD**를 정적 웹으로 호스팅 |
| "Rust만"으로 네이티브 | 성능은 가장 좋다. 하지만 SNS 링크를 눌러 바로 실행할 수 없어서 유행 콘텐츠와 맞지 않는다. 후순위로 두고, 필요하면 나중에 데스크톱판을 추가한다 |
| "Rust 엔진(Bevy) → 웹" | 가능하다. 다만 첫 다운로드가 크고, WebGL2/WebGPU용 빌드를 따로 만들어야 하고, 한글 UI와 메모리 관리에 불리하다. **Phase 0에서 실측 비교한 뒤 최종 결정** |
| 호스팅 | GitHub Pages로 시작할 수는 있다. 하지만 월 100GB 소프트 한도가 있고 커스텀 헤더를 쓸 수 없어서 **Cloudflare Pages(또는 에셋만 CDN)를 권장** |
| 실현 가능성 | 쿼터뷰/탑다운 + 스타일라이즈드 3D는 **높음**. 3인칭 풀 오픈월드 + 사실적 그래픽은 **낮음**(메모리 예산을 넘을 위험) |
| 가장 큰 리스크 | 기술보다 **에셋 제작량**과 **IP(GTA 상표, 한국 실존 브랜드)** |
| 다음 단계 | **Phase 0:** 같은 테스트 장면을 2개 구조로 만들어 메모리·CPU·로딩을 실측한다(1~2주) |

---

## 1. 목표와 제약 (측정 가능한 숫자로)

"크롬 탭 5개보다 적게", "외장 그래픽 불필요", "CPU를 너무 먹지 않게"를 검증할 수 있는 숫자로 바꾼다.

### 1.1 메모리: 목표 300MB, 상한 400MB

근거:

- 2026년 측정 자료에 따르면 가벼운 페이지 탭 하나의 상주 메모리는 약 76MB(위키백과)~110MB(해커뉴스)다. 유튜브 같은 무거운 탭은 470~530MB다.
- Tom's Guide 테스트에서는 크롬 탭 10개가 952MB였다(탭당 약 95MB).
- 따라서 **크롬 탭 5개 ≈ 400~500MB**로 본다. 무거운 탭 기준이면 훨씬 커지지만, 보수적으로 가벼운 탭을 기준으로 잡는다.

| 구분 | 목표 | 상한 |
|---|---|---|
| 게임 전체(탭 렌더러 프로세스 + GPU 프로세스 몫) | **300MB** | **400MB** |

> ⚠️ **핵심:** 내장 GPU에는 별도 VRAM이 없고 시스템 RAM을 나눠 쓴다. 텍스처와 버퍼가 곧 RAM 사용량이다. 그래서 이 프로젝트에서는 **텍스처 예산이 메모리 예산의 핵심**이다.

### 1.2 GPU: 외장 그래픽 없이

| 등급 | 예시 기기 | 목표 |
|---|---|---|
| 최저 | Intel UHD 620 (8세대 i5 노트북, RAM 8GB) | 1080p, 렌더 배율 0.75, **30fps 이상** |
| 표준 | Intel Iris Xe / AMD Radeon 내장(Ryzen 5000U급) | 1080p, **60fps** |
| 표준 | Apple M1 (RAM 8GB) | **60fps** |
| 참고 | 중급 안드로이드·아이폰(인스타·스레드 인앱 브라우저) | '낮음' 프리셋, 30fps |

### 1.3 CPU

- 표준 기기 60fps에서 **CPU 전체 사용률 25% 이하**(4코어 기준 약 1코어). 절전 모드(30fps)에서는 15% 이하.
- 탭이 비활성이거나 일시정지 중이면 사실상 0%.
- 120/144Hz 모니터에서도 **60fps로 캡**한다. 그냥 두면 `requestAnimationFrame`이 주사율만큼 돌아서 CPU·GPU 부하가 두 배 이상 된다.

### 1.4 로딩

- 첫 플레이까지 다운로드 **15MB 이하**(압축 기준). 나머지는 플레이 중에 스트리밍한다.
- SNS 인앱 브라우저에서 링크를 누르고 LTE 기준 10초 안에 플레이를 시작하는 것이 목표다.

---

## 2. 원본 레퍼런스와 아트 방향

### 2.1 현재 상태

- 받은 레퍼런스 링크: arca.live 게시물 1개, Instagram 게시물 1개.
- 이 작업 환경에서는 두 링크를 열지 못했다(클라우드 환경의 네트워크·권한 제한). **스크린샷이나 이미지 파일을 `docs/reference/`에 넣어주면 이 장을 갱신한다.**
- 웹 자료조사로도 이 유행의 원문은 확인하지 못했고, 비슷한 사례만 찾았다(2.4).

### 2.2 해석 가설과 그 영향

| | 가설 A: 지도/탑다운형 | 가설 B: 일러스트/장면형 |
|---|---|---|
| 원본 모습(추정) | Python(PIL/matplotlib/pygame)으로 그린 위에서 본 동네 지도와 GTA풍 HUD(미니맵, 돈, 수배 별) | GTA 로딩 화면풍의 일러스트나 한 장면 |
| 3D 카메라 | 기울어진 탑다운/쿼터뷰(각도 고정, 줌만 허용) | 3인칭 추적 카메라 |
| 렌더 비용 | **낮음.** 시야 거리가 짧아 컬링이 쉽고, 그림자 범위도 맞추기 쉽다 | **높음.** 원경, LOD, 스트리밍이 필요하다 |
| 메모리 300MB 달성 | 쉬움 | 어려움(가능하지만 콘텐츠량 제한) |
| 권장 | ✅ **MVP** | 후속 확장(시점 전환 옵션) |

두 가설 모두 렌더 스타일은 **스타일라이즈드(NPR)**가 맞다.

### 2.3 "원본 그래픽 유지 + 고퀄 3D"를 어떻게 구현할까

여기서 고퀄은 고해상도 텍스처가 아니라 **형태, 실루엣, 조명, 후처리**의 품질이다. 이 방향은 메모리 예산과도 잘 맞는다.

- **셀 셰이딩:** 명암 2~3단계 + 림 라이트.
- **외곽선:** 깊이·노멀 기반 후처리 에지 검출(화면 전체 1패스). 오브젝트마다 외곽선 메시를 하나씩 더 그리는 inverted hull 방식보다 draw call이 적다.
- **팔레트 아틀라스:** 대부분의 오브젝트가 256×256 그라디언트/팔레트 텍스처 한 장을 공유한다. 텍스처 메모리가 거의 들지 않고, 원본 이미지의 평면적인 색감을 재현하기에도 유리하다.
- **조명:** 정점에 구운 AO + 하늘 반구광 + 태양 1개.
- 원본이 Python으로 그린 '평면 도형' 느낌이라면, 형태는 단순하게 하고 색면은 크게 쓴다.

### 2.4 비슷한 사례 (참고용)

- **Seoul Crashers:** 서울이 배경인 GTA 영감의 웹게임. 탑다운이고 외부 의존성이 없다.
- **"Claude로 내 도시를 GTA풍 게임으로 만들기" 튜토리얼:** Phaser와 Claude 앱을 사용한다.
- **GTA-in-Claude:** Claude Code 대화 뒤에서 돌아가는 픽셀아트 도시.

---

## 3. 구조 후보 비교

### 3.1 후보

| 코드 | 구조 |
|---|---|
| A | **Rust만, 네이티브 데스크톱** (Bevy 또는 wgpu 직접 사용) |
| B | **Rust 엔진(Bevy) → WASM → 웹** (GitHub Pages 등) |
| B' | Rust + wgpu 직접(엔진 없음) → WASM |
| C | TypeScript + Three.js 단독 |
| **D** | **Rust 코어(WASM) + Three.js 렌더러 + DOM HUD** ← 추천 |
| E | Godot 4 웹 내보내기 |

### 3.2 비교표

◎ 매우 좋음 · ○ 좋음 · △ 보통 · ✕ 나쁨

| 기준 | A 네이티브 | B Bevy→웹 | B' wgpu 직접 | C Three.js | **D 하이브리드** | E Godot 웹 |
|---|---|---|---|---|---|---|
| 첫 다운로드 크기 | △ 설치 필요 | ✕ 수 MB~10MB대 wasm | ○ | ◎ 엔진 약 170KB(gz) | ◎ 엔진 + 코어 1MB 안팎 | ✕ 엔진 전체가 wasm |
| 메모리 | ◎ 브라우저 오버헤드 없음 | △ | ○ | ○ | ○ | △ |
| CPU | ◎ 멀티스레드 | △ 웹에서는 단일 스레드 | △ | ○ | ○ | △ 단일 스레드 내보내기 |
| 렌더 품질 상한 | ◎ | ○ | ○ (직접 구현할 양이 큼) | ○ | ○ | ○ |
| 한글 UI | △ 폰트 아틀라스 | △ | ✕ 직접 구현 | ◎ 브라우저 | ◎ 브라우저 | ○ |
| SNS 링크로 즉시 실행 | ✕ | ◎ | ◎ | ◎ | ◎ | ◎ |
| 개발 속도 | △ | △ | ✕ | ◎ | ○ | ◎ 에디터 |
| Rust 활용도 | ◎ 100% | ◎ 100% | ◎ 100% | ✕ 0% | ○ 게임 로직 전부 | ✕ |
| 유지보수 | △ 3개 OS 빌드·서명 | △ 메이저 업데이트마다 마이그레이션 | △ | ○ | ○ | ○ |

### 3.3 후보별 근거

**A. Rust만, 네이티브**
- 장점: 성능과 메모리 효율이 가장 좋다. 멀티스레드를 자유롭게 쓸 수 있다.
- 단점: 사용자가 실행 파일을 내려받아 설치해야 한다. Windows SmartScreen 경고, macOS 공증 같은 배포 장벽이 있다. **인스타·스레드에서 링크를 눌러 바로 하는 경험이 불가능해서** 유행을 타고 퍼지기에 치명적이다.

**B. Bevy → WASM → 웹**
- Bevy의 웹 기본 백엔드는 WebGL2이고, WebGPU는 `webgpu` 기능으로 켠다. 켜면 WebGL2 지원을 대체한다(0.16 문서 기준). 그래서 **두 백엔드를 모두 지원하려면 wasm을 두 벌 빌드해서 실행 시 골라야 한다.**
- 바이너리 크기: 2023년 보고로는 단순한 예제도 약 22MB였고, 크기 최적화(opt-level="z", LTO, wasm-opt)를 하면 12MB 이하였다. 오래된 수치라서 Phase 0에서 다시 잰다(metrics.bevy.org가 바이너리 크기를 추적한다).
- 릴리스 주기: 0.18(2026-01-13), 0.19(2026-06-19). 릴리스마다 호환성이 깨지는 변경이 있어 마이그레이션이 필요하다.
- 웹에서 멀티스레드를 쓰려면 SharedArrayBuffer가 필요하고, 그러려면 COOP/COEP 헤더가 필요하다. **GitHub Pages는 이 헤더를 보낼 수 없다.**
- 한글: 게임 안의 텍스트를 엔진이 직접 그려야 한다. 한글 완성형은 11,172자라서 폰트 파일이 크고 글리프 아틀라스가 메모리를 차지한다.

**B'. wgpu 직접**
- glTF 로딩, KTX2 트랜스코딩, 그림자, 컬링, 후처리를 전부 직접 구현해야 한다. 1인 개발이라면 렌더러를 만들다가 게임을 못 만든다.

**C. Three.js 단독**
- Three.js는 min+gzip 기준 약 168KB(r175)로 가볍다. WebGPU 빌드는 노드 시스템이 들어가서 더 크므로 Phase 0에서 측정한다.
- `WebGPURenderer`는 WebGPU가 없으면 WebGL2로 자동 폴백한다. TSL로 쓴 셰이더는 WGSL과 GLSL 양쪽으로 컴파일되어 한 코드로 두 백엔드를 지원한다. 단, compute 셰이더는 WebGL2 폴백에서 쓸 수 없다.
- 단점: 큰 게임 로직을 JS로 짜면 GC 끊김과 구조 관리 부담이 생긴다. Rust를 쓰고 싶다는 요구도 충족하지 못한다.

**D. Rust 코어 + Three.js (추천)**
- C의 장점을 그대로 가져가면서 게임 로직은 Rust로 쓴다. 근거는 3.4절.

**E. Godot 4 웹**
- Godot 4.3부터 단일 스레드 웹 내보내기가 기본이라 GitHub Pages에서도 돌아간다. 하지만 멀티스레드보다 느리다. 느린 기기에서 오디오가 끊기는 문제가 있었고, 이후 샘플 재생 방식으로 개선됐다.
- 엔진 런타임 전체를 받아야 해서 초기 다운로드와 메모리 기준선이 크다. 에디터 생산성은 가장 좋다.

**참고: 데스크톱 래핑(Tauri)**
- 웹 빌드를 Tauri로 감싸면 데스크톱판을 쉽게 만들 수 있다. 다만 Windows의 WebView2는 크로미움 기반이라 Electron과 메모리 차이가 작다. 이득이 큰 쪽은 macOS(WKWebView)와 설치 파일 크기다.

### 3.4 결론: D를 추천하는 이유

1. **유행 콘텐츠에서는 "링크 탭 → 바로 플레이"가 최우선이다.** 웹 배포가 사실상 필수다.
2. **첫 다운로드가 가장 작다.** 렌더 엔진이 수백 KB라서 인앱 브라우저나 모바일 데이터 환경에서도 이탈이 적다.
3. **게임 로직은 Rust로 쓴다.** 시뮬레이션, 교통·NPC AI, 물리, 미션, 세이브를 Rust로 짜서 성능과 안정성을 얻고, 결정론적 테스트도 할 수 있다. 렌더러를 바꿔도 코어는 그대로이므로 **나중에 네이티브(wgpu/Bevy) 클라이언트를 붙일 수 있다.**
4. **한글 HUD, 메뉴, 대화창을 브라우저 텍스트 엔진에 맡긴다.** 폰트·아틀라스 메모리 부담이 없고 접근성도 좋다.
5. **WebGPU/WebGL2 폴백을 빌드 하나로 처리한다.** WebGPU는 2025년 11월 기준 Chrome·Edge, Firefox 141(Windows)/145(macOS ARM), Safari 26에 들어갔다. 하지만 Linux·Android Firefox는 아직 진행 중이고 인앱 브라우저 지원도 불확실해서 **WebGL2가 기본 경로**여야 한다.

> **결정 게이트:** Phase 0에서 D와 B(Bevy)를 같은 장면으로 실측한다. D가 1장의 기준을 넘지 못하면 다시 검토한다.

---

## 4. 추천 아키텍처 상세

### 4.1 구성도

```
┌──────────────────────────── 브라우저 탭 ────────────────────────────┐
│                                                                     │
│  HTML/CSS HUD (미니맵·돈·수배·대화창·메뉴)  ◀── 이벤트 ──┐            │
│                                                        │            │
│  TypeScript 메인 루프 (rAF, 60fps 캡, 고정 스텝 누적)    │            │
│     │ 입력 비트마스크 + dt                              │            │
│     ▼                                                  │            │
│  ┌────────────── kta-core (Rust → WASM) ─────────────┐ │            │
│  │ 월드 상태(ECS) · rapier3d 물리                      │ │            │
│  │ 교통/NPC AI · 미션 · 경제 · 세이브 직렬화             ├─┘ 이벤트 큐 │
│  │ 청크 스트리밍 결정(무엇을 로드/해제할지)               │             │
│  └───────────────┬───────────────────────────────────┘             │
│                  │ 공유 메모리: Float32Array 뷰 (위치·회전, SoA)      │
│                  ▼                                                  │
│  Three.js 렌더러 (WebGPU → WebGL2 자동 폴백)                         │
│     InstancedMesh/BatchedMesh · TSL 셀 셰이딩 · 에지 후처리           │
│                                                                     │
│  Web Worker: KTX2 트랜스코드 · meshopt 디코드 (Three.js 로더 내장)    │
└─────────────────────────────────────────────────────────────────────┘
            ▲ 정적 파일(.wasm / .js / .glb / .ktx2): CDN 호스팅
```

### 4.2 계층별 책임

| 계층 | 맡는 일 | 맡지 않는 일 |
|---|---|---|
| kta-core (Rust) | 게임 규칙, 물리, AI, 미션, 경제, 세이브 데이터, 스트리밍 판단 | 메시·텍스처·DOM. 에셋은 `asset_id`로만 다룬다 |
| 렌더러 (TS + Three.js) | 씬 그래프, 머티리얼·셰이더, 인스턴싱, 후처리, 에셋 로드·해제 | 게임 규칙 |
| HUD (DOM/CSS) | 미니맵(Canvas 2D), 수치 표시, 메뉴, 대화, 설정 | 3D 렌더 |
| 플랫폼 계층 (TS) | 입력(키보드·게임패드·터치), 오디오, 저장, 페이지 가시성 | — |

### 4.3 Rust ↔ JS 경계 원칙

- **프레임당 호출은 1~2회:** `core.step(dt, input)`, `core.drain_events()`. 개체 단위 호출은 금지한다. JS↔WASM 호출에는 비용이 있으니 묶어서 부른다.
- **복사 없는 변환 데이터:** Rust가 `Vec<f32>` SoA 버퍼를 소유하고, JS는 `new Float32Array(memory.buffer, ptr, len)` 뷰로 직접 읽는다. wasm 메모리가 늘어나면 기존 뷰가 무효화되므로, `memory.buffer`가 바뀐 것을 감지해 뷰를 다시 만든다.
- **이벤트:** 고정 크기 링버퍼(미션 완료, 수배 변화, 사운드 트리거).
- **물리:** `rapier3d` Rust 크레이트를 코어에 직접 넣는다. JS 패키지를 따로 쓰면 wasm이 두 개가 되고 경계 비용도 두 배가 된다.

### 4.4 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 코어 언어 | Rust stable, `wasm32-unknown-unknown`, wasm-bindgen | |
| ECS | `bevy_ecs` 단독 또는 `hecs` | `bevy_ecs`를 쓰면 나중에 Bevy 네이티브 클라이언트로 옮기기 쉽다 |
| 물리 | `rapier3d` | 코어 wasm 안에 포함 |
| 렌더 | three.js (버전 고정) | `WebGPURenderer` + TSL |
| 빌드 | Vite + wasm-pack | |
| HUD | 순수 DOM + CSS (필요하면 Preact 정도의 초경량) | |
| 폰트 | Pretendard 등 OFL 한글 폰트, 쓰는 글자만 서브셋 | woff2 수백 KB 목표 |
| 오디오 | Web Audio API, BGM은 스트리밍 | 디코드된 PCM 메모리 절약 |
| 저장 | IndexedDB(세이브), localStorage(설정) | |
| 에셋 | Blender → glTF → gltf-transform | 5장 |
| 테스트 | `cargo test`(코어 결정론), Playwright(웹 스모크) | |

### 4.5 저장소 구조 (제안)

```
KTA/
├─ crates/
│  ├─ kta-core/          # 플랫폼 독립 게임 로직 (네이티브에서도 테스트 가능)
│  └─ kta-wasm/          # wasm-bindgen 바인딩 (얇게)
├─ web/
│  ├─ src/
│  │  ├─ main.ts         # 루프, 프레임 캡, 가시성 처리
│  │  ├─ render/         # 렌더러, TSL 셰이더, 청크 로더
│  │  ├─ hud/            # DOM HUD, 미니맵
│  │  └─ platform/       # 입력, 오디오, 저장
│  └─ public/assets/     # 파이프라인 결과물 (.glb, .ktx2) — 커밋하지 않고 빌드 시 생성
├─ assets-src/           # .blend 원본 (용량이 크면 저장소 밖에 보관)
├─ tools/asset-pipeline/ # gltf-transform 스크립트
└─ docs/
   ├─ implementation-plan.md
   └─ reference/         # 원본 레퍼런스 이미지
```

---

## 5. 에셋 파이프라인

### 5.1 흐름

```
Blender(.blend 원본)
  → glTF 2.0 내보내기
  → gltf-transform: dedup → weld → simplify(LOD1/2 생성) → quantize → meshopt
                    → KTX2 (기본 ETC1S, 품질이 필요한 곳만 UASTC)
  → 청크 단위 .glb
  → CDN
```

### 5.2 텍스처 메모리 계산 (GPU 상주, 밉맵 포함)

| 2048×2048 텍스처 1장 | GPU 메모리 |
|---|---|
| PNG/JPG (디코드 후 RGBA8) | 약 **21.3MB** |
| KTX2 UASTC → BC7/ASTC 4×4 (픽셀당 1바이트) | 약 **5.3MB** |
| KTX2 ETC1S → BC1/ETC (픽셀당 0.5바이트) | 약 **2.7MB** |

PNG 10장만으로 213MB가 되어 예산을 넘는다. 팔레트 아틀라스와 KTX2를 함께 쓰면 전체 텍스처가 수십 MB 안에 들어간다. KTX2는 GPU 메모리에서도 압축된 상태로 유지된다.

### 5.3 에셋 출처

| 출처 | 용도 | 라이선스 주의 |
|---|---|---|
| 직접 모델링(Blender) | 한국 특유 소품: 아파트, 편의점, 지하철 입구, 포장마차, 치킨집, 버스정류장, 배달 오토바이, 마을버스 | — |
| CC0 팩(Kenney, Quaternius) | 범용 소품, 임시 에셋 | CC0 |
| Poly Haven | HDRI, 참고 텍스처 | CC0 |
| AI 3D 생성(Tripo, Meshy, Hunyuan3D 등) | 초안. **리토폴로지와 폴리곤 감량 필수** | 서비스별 상업 이용 조건 확인 |
| 지도 | 실제 서울을 복제하지 않고 **'서울 느낌의 가상 동네'**로 | OpenStreetMap을 쓰면 ODbL 출처 표기·공유 의무 |

AI가 만든 메시는 보통 수십만 폴리곤에 UV가 지저분하다. 그대로 쓰면 메모리 예산이 무너진다.

### 5.4 폴리곤·LOD 기준 (초안)

| 대상 | LOD0 | LOD1 | LOD2 / 대체 |
|---|---|---|---|
| 플레이어·주요 NPC | 8~15k tri | 3k | — |
| 일반 NPC | 2~4k | 800 | 빌보드 |
| 자동차 | 5~8k | 1.5k | 300 |
| 건물(블록 단위) | 2~10k | 1k | 박스 |
| 소품 | 0.2~2k | 인스턴싱 | 생략 |

**모듈식 건물 키트**(벽, 창, 간판, 실외기, 에어컨 배관을 조합)로 적은 에셋에서 많은 건물을 만든다. 에셋 제작량 리스크를 줄이는 가장 효과적인 방법이다.

---

## 6. 성능·메모리 예산

### 6.1 메모리 예산 (목표 300MB)

| 항목 | 예산 | 수단 |
|---|---|---|
| 브라우저 탭 기본 | 약 80MB | 고정비(1.1절 측정 자료 기준) |
| JS 힙(Three.js 객체, HUD) | 40MB 이하 | 객체 풀링, 프레임당 할당 0 |
| WASM 선형 메모리(코어 + 물리) | 48MB 이하 | 초기·최대 크기 지정, 아레나 할당. **wasm 메모리는 한 번 늘면 줄지 않는다** |
| GPU: 텍스처 | 64MB 이하 | KTX2, 팔레트 아틀라스, 청크 해제 |
| GPU: 지오메트리 | 32MB 이하 | 양자화, 인스턴싱, LOD |
| GPU: 렌더 타깃 | 24MB 이하 | 1080p RGBA8 한 장 ≈ 8MB. MSAA 대신 FXAA, 렌더 배율 조절 |
| 오디오 | 12MB 이하 | BGM 스트리밍, 효과음만 디코드 |
| **합계** | **약 300MB** | 상한 400MB까지 여유 100MB |

### 6.2 렌더 예산 (표준 기기, 60fps)

- **draw call 300 이하/프레임.** WebGL은 호출당 CPU 비용이 커서 CPU 사용률과 바로 연결된다.
- 화면 안 삼각형 50만 이하.
- **그림자:** 태양 1개, 2048 그림자맵 1장(탑다운 카메라에 맞춰 범위를 좁게). NPC와 차량에는 블롭 그림자.
- **동적 광원 4개 이하.** 야간 가로등은 발광 텍스처와 가짜 광원 데칼로 처리한다.
- **픽셀 비율 상한 1.0~1.25.** 고DPI 노트북에서 2.0으로 두면 그려야 할 픽셀이 4배가 된다.
- **동적 해상도:** 프레임 시간 p95가 기준을 넘으면 렌더 배율을 1.0에서 0.67까지 자동으로 낮춘다.
- 품질 프리셋 낮음/중간/높음 + 첫 실행 시 자동 감지.

### 6.3 CPU 절약 전략

- 60fps 캡(rAF 콜백에서 경과 시간 확인), 절전 모드 30fps.
- 시뮬레이션은 고정 30Hz로 돌리고 렌더에서 보간한다. 먼 AI는 5Hz로 돌리고, 화면 밖 교통은 경로 위의 점으로만 추상화한다.
- 페이지가 숨겨지면(Page Visibility API) 루프와 오디오를 멈춘다. 창 포커스를 잃으면 일시정지 메뉴를 띄운다.
- 프레임당 메모리 할당 0(JS GC 끊김 방지).
- 무거운 디코드는 워커에서(Three.js의 KTX2Loader와 meshopt 디코더가 기본 지원).
- 메뉴나 대화처럼 화면이 멈춰 있을 때는 렌더를 멈춘다.

### 6.4 측정과 회귀 방지

- **벤치마크 모드:** 고정 카메라 경로를 60초 재생하고 프레임 시간 p50/p95, draw call, 삼각형 수, `renderer.info.memory`, 힙 크기를 JSON으로 출력한다.
- 실측 도구: 크롬 작업 관리자(메모리 사용량과 GPU 메모리 열), DevTools Performance/Memory, Spector.js(draw call).
- `performance.measureUserAgentSpecificMemory()`는 cross-origin isolation(COOP/COEP 헤더)이 필요하다. GitHub Pages에서는 쓸 수 없고 Cloudflare Pages에서는 쓸 수 있다.
- **CI(GitHub Actions):** 번들 크기 예산 검사, Rust 코어 단위 테스트, Playwright 스모크 테스트. 헤드리스 환경은 소프트웨어 렌더링이라 성능 수치는 참고만 하고, draw call과 메모리 카운터의 회귀만 확인한다.
- 기준 기기 실측은 마일스톤마다 수동으로 한다. 30분 연속 플레이(소크 테스트)로 메모리 누수를 확인한다.

---

## 7. 호스팅과 배포

| | GitHub Pages | Cloudflare Pages |
|---|---|---|
| 크기 제한 | 사이트 1GB | 무료: 파일 20,000개, 파일당 25MiB |
| 대역폭 | **월 100GB 소프트 한도** | 공식 수치 재확인 필요(무료 요금제에 대역폭 과금이 없는 것으로 알려짐) |
| 커스텀 헤더(COOP/COEP) | **불가.** wasm 멀티스레드와 정밀 메모리 측정을 쓸 수 없다 | `_headers` 파일로 가능 |
| 빌드 | Actions로 배포하면 빌드 횟수 제한 없음 | 무료 월 500회 |

**계산:** 첫 로딩 15MB × 1만 명 = 150GB. 유행을 타면 GitHub Pages의 월 소프트 한도를 금방 넘는다.

**권장:**
- 개발 중 미리보기는 GitHub Pages.
- 공개 배포는 **Cloudflare Pages**(또는 GitHub Pages + 에셋만 별도 CDN).
- 파일명에 해시를 넣고 장기 캐시, Brotli/gzip 압축(.wasm이 크게 줄어든다).

---

## 8. 게임 디자인 범위 (MVP 제안)

**컨셉:** 한국 일상 생존 + GTA식 혼돈 패러디.

**핵심 루프:** 출근·알바·배달로 돈을 번다 → 월세와 물가로 돈이 나간다 → 사고를 치면 수배 단계가 오른다 → 하루가 끝나면 '오늘의 한국 생활' 카드가 나온다.

**MVP 콘텐츠**
- 가상 동네 1곳(4~6청크): 아파트 단지, 편의점, 지하철역 입구, 버스정류장, 치킨집, PC방, 한강 느낌의 공원.
- 이동: 걷기, 자전거, 자동차, 마을버스 탑승.
- 미션 5개(예시): 지옥철 출근, 편의점 알바, 배달, 분리수거 대작전, 야식 심부름.
- 시스템: 돈(₩), 체력, 수배 단계, 시간(낮/밤), 세이브.
- **공유 카드:** 플레이한 하루를 요약해 원본 유행 이미지 같은 감성의 카드로 만든다(Canvas 2D로 생성, 이미지 저장·공유). 유행과 게임을 잇는 **바이럴 루프**다.
- 조작: 키보드+마우스, 게임패드(Gamepad API). 터치는 Phase 3.

**HUD 색상(초안).** 기본은 흰색·검정 중성색이고, 강조색은 한 화면에 2~3개까지만 쓴다. 3D 에셋 텍스처는 이 규칙에서 제외한다.

| 용도 | 색 |
|---|---|
| 돈(₩) | 노랑 `#FFCC11` |
| 체력 | 초록 `#55BB44` |
| 위험·수배 | 빨강 `#FF0045` |
| 경찰·정보 | 파랑 `#3355BB` |
| 미니맵 물·지하철 | 하늘 `#39C5BB` |
| 미션 마커 | 주황 `#FF7E00` |
| 밤·특수 상태 | 보라 `#660099` |
| 선택 강조 | 분홍 `#FFB4CC` |

---

## 9. 법적·IP 리스크

- **GTA 상표와 트레이드 드레스:** 게임명, 로고, 전용 폰트풍 타이틀, 로딩 화면 일러스트 화풍, UI 레이아웃, 캐릭터를 그대로 따라 하지 않는다. 오픈월드, 수배 단계, 미니맵 같은 장르 공통 요소는 독자적으로 디자인한다. 공개 타이틀은 독자 브랜드로 정한다(가칭 "My Life in Korea"). GTA를 직접 연상시키는 이름을 공개 타이틀로 쓰면 리스크가 크다.
- **한국 실존 브랜드:** 편의점, 배달앱, 통신사, 지하철 로고는 패러디 이름과 독자 로고로 바꾼다.
- **원본 유행 이미지:** 원작자의 이미지를 게임 안에 그대로 쓰지 않는다. 구도와 감성만 참고한다. 공유 카드도 독자 디자인으로 만든다.
- **라이선스 목록:** 폰트, 에셋, 지도 데이터의 라이선스를 `docs/licenses.md`로 관리한다.
- **등급분류:** 국내 공개 형태(무료 웹, 스토어, 유료)에 따라 게임물관리위원회 등급분류 대상인지 확인해야 한다. 폭력 표현 수위도 영향을 준다.

---

## 10. 로드맵

1인 개발 + Claude Code 보조, 주 20~30시간 기준 대략치.

| 단계 | 기간 | 산출물 | 통과 기준(게이트) |
|---|---|---|---|
| **Phase 0** 기술 검증 | 1~2주 | 같은 테스트 장면(건물 200, 차 50, NPC 100)을 D와 B(Bevy)로 구현 + 벤치마크 모드 | 최저 기기 30fps, 메모리 400MB 이하, 첫 로딩 15MB 이하 → **구조 확정** |
| **Phase 1** 버티컬 슬라이스 | 3~4주 | 블록 1개(아파트, 편의점, 정류장), 캐릭터 이동과 차량, 카메라, 셀 셰이딩 + 외곽선, HUD, 미션 1개 | 원본 레퍼런스와 나란히 놓고 "그 느낌"에 합의 |
| **Phase 2** MVP | 6~8주 | 동네 1곳(4~6청크), 교통·NPC, 미션 5개, 낮/밤, 세이브, 사운드, 공유 카드 | 6장의 예산 전부 충족, 외부 테스터 10명 |
| **Phase 3** 공개 | 3~4주 | 모바일 터치, 저사양 프리셋, 한/영, 성능 다듬기, Cloudflare 배포 | 인스타·스레드 인앱 브라우저에서 동작 확인 |
| **Phase 4** 선택 | — | 지역 추가, 데스크톱판(Tauri 또는 네이티브 클라이언트) | — |

MVP까지 약 **3~4개월**.

---

## 11. 리스크

| 리스크 | 가능성 | 영향 | 대응 |
|---|---|---|---|
| 에셋 제작량이 일정의 병목 | 높음 | 높음 | 팔레트 아틀라스, 모듈식 건물 키트, AI 초안 + 정리 |
| 원본 스타일 재현 기준이 모호 | 높음 | 중 | Phase 1 끝에 레퍼런스 비교 게이트 |
| 내장 GPU에서 후처리(외곽선) 비용 | 중 | 중 | 렌더 배율 조절, 저사양에서는 외곽선 단순화 |
| 인앱 브라우저의 WebGPU 미지원 | 중 | 낮음 | WebGL2 폴백을 기본 경로로 |
| 장시간 플레이 시 메모리 누수 | 중 | 높음 | 명시적 `dispose()`, 청크 LRU, 30분 소크 테스트 |
| Three.js `WebGPURenderer` API 변화 | 중 | 중 | 버전 고정, 분기별 업그레이드 |
| IP 분쟁 | 낮음~중 | 높음 | 9장 원칙 |
| 트래픽 급증 | 중 | 중 | CDN, 해시 기반 장기 캐시 |

---

## 12. 결정이 필요한 것

1. **레퍼런스 이미지 공유:** 스크린샷을 채팅에 첨부하거나 `docs/reference/`에 넣어주세요. 2장의 가설 A/B를 확정한다.
2. **카메라 시점:** 쿼터뷰/탑다운(권장) 또는 3인칭.
3. **플랫폼 우선순위:** 웹 우선(권장) 또는 데스크톱 우선.
4. **호스팅:** Cloudflare Pages(권장) 또는 GitHub Pages.
5. **공개 타이틀(가칭).**

---

## 13. 참고 자료

**메모리·브라우저**
- [Chrome RAM Per Tab in 2026 (측정 자료)](https://www.superchargebrowser.com/library/chrome-ram-usage-per-tab-2026/)
- [Tom's Guide: Chrome vs Firefox vs Edge RAM 비교](https://www.tomsguide.com/uk/news/chrome-firefox-edge-ram-comparison)
- [web.dev: WebGPU is now supported in major browsers](https://web.dev/blog/webgpu-supported-major-browsers)

**엔진·렌더러**
- [Bevy 0.18 릴리스](https://bevy.org/news/bevy-0-18/) · [Bevy 0.19 릴리스](https://bevy.org/news/bevy-0-19/) · [Bevy + WebGPU](https://bevy.org/news/bevy-webgpu/)
- [Bevy 0.16 cargo features (webgpu/webgl2)](https://docs.rs/crate/bevy/0.16.0/source/docs/cargo_features.md)
- [Bevy cheatbook: WASM 크기 최적화](https://bevy-cheatbook.github.io/platforms/wasm/size-opt.html) · [metrics.bevy.org](https://metrics.bevy.org/)
- [three.js WebGPURenderer 매뉴얼](https://threejs.org/manual/en/webgpurenderer.html)
- [three.js 포럼: TSL과 WebGL2 vs WebGPU](https://discourse.threejs.org/t/tsl-and-webgl2-vs-webgpu/87974)
- [Three.js vs Babylon.js vs PlayCanvas (2026)](https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison)
- [Godot: Exporting for the Web](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html) · [Godot 4.3 웹 내보내기 진행 보고](https://godotengine.org/article/progress-report-web-export-in-4-3/)
- [Tauri 메모리 벤치마크 관련 이슈](https://github.com/tauri-apps/tauri/issues/5889)
- [Realm of Echoes: Three.js + Rust/Wasm 사례](https://discourse.threejs.org/t/realm-of-echoes-a-real-time-browser-mmorpg-built-with-three-js-and-rust-wasm/93006)

**에셋·텍스처**
- [Khronos KTX 아티스트 가이드](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md)
- [Don McCurdy: Choosing texture formats for WebGL and WebGPU](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)

**호스팅**
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) · [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)

**비슷한 사례**
- [Seoul Crashers (GitHub)](https://github.com/ddallabenetta/Seoul-Crashers)
- [GTA-in-Claude (GitHub)](https://github.com/alexisdelestre/GTA-in-Claude)
- [How to Build Your Own GTA-Style Game of Your City with Claude (X)](https://x.com/free_ai_guides/status/2122638477263081679)
