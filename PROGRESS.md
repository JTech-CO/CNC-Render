# CNC Render Progress

- Current phase: M10 튜토리얼·샌드박스 MVP(E2) 진행 중
- Status: Lesson 규칙·Worker/WASM 증거 어댑터·결정론적 점수 계약 완료
- Last completed: 실제 WASM 평면 밀링 재실행·충돌 정지 scoring parity 통과
- Next task: 실제 목표 형상 측정 요약과 평면 밀링 Lesson 5단계 controller 연결
- Open questions: 없음
- Known regressions: 없음

## M10 Lesson 규칙·Worker/WASM 증거·점수 계약 (2026-08-13, 완료)

### 구현

- `content/lessons/ko/face-milling.lesson.json`에 E2 평면 밀링의 준비→설정→실행→
  측정→평가 5단계, 허용 행동, 순서 밖 행동의 이유·체크포인트 복구 경로와
  성공·실패 규칙을 선언했다. 잘못된 공구, `5 mm` 초과 절입과 충돌은 작성 순서에
  따라 서로 다른 실패 이유를 반환한다.
- `packages/lesson-engine`은 strict Zod schema와 순수 단계 판정 계층으로 두었다.
  알 수 없는 필드, 비유한 수치, 중복 ID·행동·점수 metric, 역행 단계와 100점이
  아닌 배점 합계를 거부한다.
- Worker/WASM Coordinator 완료 요약 또는 실제 충돌 정지만 Lesson evidence로
  변환한다. `logicalTimeS`, 제거 체적, 첫 충돌 유무를 엔진 소유 metric으로 쓰고
  run·fixture·공정 ID와 최종 semantic/Stock hash를 provenance로 보존한다.
  렌더 프레임과 실제 재생 경과는 판정·점수에 사용하지 않는다.
- 형상 편차 30점, 충돌 25점, 논리 시간 15점, 공구 수 10점, 과절삭·미절삭 각
  10점인 100점 정책을 fixture에 선언했다. 만점/0점 경계 사이를 선형 감점하고
  항목별·총점을 소수 둘째 자리로 반올림한다. 통과 기준은 `80 / 100`이며 필요한
  metric 누락은 `lesson.score.metric-missing`으로 거부한다.
- ADR 0013에 강의 규칙 경계를, ADR 0014에 실제 엔진 증거와 점수 공식·단위·
  평면 밀링 임계값을 기록했다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| 변경 소스·테스트 ESLint | 통과 |
| `pnpm test:unit --filter tutorial-rules` | 통과 — 1 file, 10 tests |
| `pnpm test:parity --filter scoring` | 통과 — 실제 WASM 독립 재실행·충돌 정지 2 tests |
| `pnpm typecheck` | 통과 |
| `pnpm check:boundaries` | 통과 — 98 modules, 215 dependencies, 위반 0 |
| `pnpm verify` | 통과 — unit 149, contracts 51, parity 65, Cargo check, production build |
| production WASM | 793,536 bytes, SHA-256 `d788f5b38bc27cd0429f5500e63ad6523fc1b9dce07574c2983a78b444bd9fec` |

### 남은 위험과 다음 M10 단위

- 현재 정식 Lesson 콘텐츠는 평면 밀링 1개다. 외경 선삭·드릴링 Lesson,
  샌드박스 operation 생성·저장, Tutorial UI와 M10 E2E·visual gate는 남아 있다.
- Worker/WASM가 직접 제공하는 점수 값은 논리 시간, 제거 체적과 첫 충돌 유무다.
  최대 형상 편차·과절삭·미절삭은 아직 명시적 측정 입력이며 실제 Stock과 목표
  형상을 비교하는 measurement adapter에 연결해야 한다.
- 현재 엔진은 첫 충돌에서 정지하므로 충돌 횟수는 `0` 또는 `1`인 E2 값이다.
  다중 충돌 누적은 Coordinator 계약 확장 전까지 지원하지 않는다.

## 작업실 탭·공정 재생·밀링 설정 안정화 (2026-08-13, 완료)

### 원인과 수정

- 장면 패널과 코드·학습·결과 Context 패널이 같은 grid cell에 동시에 렌더링되어
  겹쳤다. Activity에 따라 두 패널을 상호 배타적으로 렌더링하도록 수정했다.
- 공개 외경 선삭 fixture는 모션이 3개뿐이어서 약 `0.6 s` 만에 끝났고 VMC
  장면에 선삭 좌표를 적용해 공구가 소재를 관통하는 것처럼 보였다. 선삭 전용
  척·holder·insert·toolpath를 분리하고 controller X 지름을 장면 반경 `X / 2`로
  변환했다.
- 외경 선삭을 지름 `80 mm`, 길이 `120 mm` 소재의 4개 종방향 패스와 안전
  복귀를 포함한 18단계 fixture로 교체했다. 회전 Stock이 선삭 presentation을
  자동 선택하며 실행 시작 후 소재 범위에 camera focus를 맞춘다.
- 3축 밀링에 표준 블록 `360 × 200 × 88 mm`, 소형 블록
  `280 × 160 × 72 mm`와 X축·Y축 왕복 절삭 방향을 추가했다. 설정은 결정론적
  G-code, toolpath guide, Worker/WASM 실행, Stock 교체와 M8 저장 프로젝트에
  같은 값으로 전달된다. 선삭·충돌 정지에서는 밀링 전용 설정을 비활성화한다.
- 전체 E2E에서 M8 저장 후 이전 run ID를 기준으로 다음 실행을 기다리던 테스트
  경합을 발견했다. 저장 직후 활성 run ID를 기준으로 수정하고 WebGPU 3회 반복과
  전체 순서를 다시 통과했다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| `pnpm verify` | 통과 — unit 139, contract 51, parity 63, dependency 위반 0, Cargo check, production build |
| `pnpm test:a11y` | 통과 — WebGPU·WebGL 2 2 passed, visual 중복 1 skipped |
| 탭·선삭·소재/방향 핵심 E2E | 통과 — WebGPU·WebGL 2 6 passed, visual 중복 3 skipped |
| WebGPU 소재/방향/저장 반복 | 통과 — 3/3 passed |
| `pnpm test:e2e` | 통과 — WebGPU·WebGL 2 63 passed, 조건부 visual 18 skipped, 실패 0 |
| production WASM | 793,536 bytes, SHA-256 `d788f5b38bc27cd0429f5500e63ad6523fc1b9dce07574c2983a78b444bd9fec` |

### 남은 위험과 M10 경계

- 공개 선삭 선택기는 현재 외경 선삭 대표 공정 하나다. 단면·테이퍼 fixture와
  드릴링을 준비→설정→실행→측정→판정의 정식 lesson으로 노출하는 작업은 M10 범위다.
- 밀링 소재는 두 개의 검증된 박스 preset이다. 임의 치수·재료·공구·절삭 조건과
  저장 후 UI control 재구성은 M10 sandbox project model에서 완성한다.
- 선삭 장면과 segment 끝점 단위 재생은 E2 교육용 표현이다. 실제 선반 기구학,
  서보 보간, 공구 보정 또는 산업용 검증과 동일하지 않다.

## M9 공개 릴리스 안정화 (2026-08-09)

### 원인과 수정

- GitHub Pages용 `apps/pages-demo/main.tsx`는 Vinext의 `app/layout.tsx`를
  통과하지 않아 `tokens.css`와 `primitives.css`가 공개 번들에서 누락됐다.
- Pages HTML이 두 생성 CSS를 명시적으로 로드하고, 권위 원본과
  `public/styles/` 복사본의 byte drift를 `check:pages-styles`로 차단한다.
- Pages build가 CSS·앱 chunk·전용 Worker·WASM 산출물을 모두 검증하고,
  CI가 실제 `/CNC-Render/` base path의 Chromium E2E를 실행한다.
- E2E는 2048×1009에서 계산된 토큰·버튼 크기·가로 overflow를 확인하고
  도움말, 코드·학습·장면 클릭과 Worker/WASM 절삭 완료·Stock revision을 검증한다.
- 제품·엔진 버전을 `0.9.0`으로 통일했다. 8개 JavaScript manifest, 5개
  Rust crate, Cargo lock, UI, Worker handshake, WASM core와 저장 엔진이
  공용 버전을 사용하며 schema/protocol version `1`은 독립 계약으로 유지한다.
- README는 실행 링크, 현재 기능, 사용법과 실제 제한만 남긴 사용자 문서로
  교체했다. 공개 UI의 M9/M10/M11 계획 표기도 제품 상태 문구로 교체했다.
- `main`만 장기·배포 브랜치로 두고 `codex/<scope>`를 PR 병합 뒤 삭제하는
  규칙을 `CONTRIBUTING.md`와 ADR 0012에 기록했다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| `pnpm check:versions` | 통과 — 제품·엔진·8 JS manifests·5 Rust crates 0.9.0 일치 |
| `pnpm test:contracts --filter m0` | 통과 — 1 file, 6 tests; README 공개 문서 계약 포함 |
| `pnpm verify` | 통과 — unit 135, contract 50, parity 63, 92 modules/204 dependencies 위반 0, Cargo locked check, production build |
| `pnpm test:pages` | 통과 — 실제 Pages base path, Chromium 1 test, 5.6 s |
| 2048×1009 시각 확인 | 통과 — 패널·버튼·3D 작업실 정상 비율, 가로 overflow 없음 |

Pages build는 156 modules를 만들었고 production WASM은 793,536 bytes,
SHA-256은 `d788f5b38bc27cd0429f5500e63ad6523fc1b9dce07574c2983a78b444bd9fec`다.

### 남은 위험

- 로컬 검증 시점에는 안정화 변경이 아직 공개 배포되지 않았다. 공개 URL은
  해당 변경의 병합과 Pages 배포가 끝날 때까지 이전 bundle을 제공한다.
- 로컬 검증 시점에는 이미 병합된 원격 작업 브랜치 7개가 남아 있어
  승인된 릴리스 작업에서 `main`을 제외하고 정리해야 한다.
- Pages CSS는 정적 엔트리 때문에 생성 복사본을 사용한다. CI의
  `check:pages-styles`를 우회하면 다시 drift할 수 있으므로 필수 gate로 유지한다.

## 재생 경과·가공 추정 시간 표시 분리 (2026-08-11)

### 원인과 수정

- 화면의 `52.260 s`는 재생이 실제로 소비한 시간이 아니라 G-code 이송 거리와
  feed rate로 계산한 결정론적 논리 가공 시간이었다. ADR 0009에 따라 재생 속도는
  화면 지연만 바꾸며 이 논리 시간을 바꾸지 않지만, UI가 이를 단순히 `시간`으로
  표시해 약 3초의 재생 경과와 같은 값처럼 오해하게 했다.
- 브라우저 adapter가 실행 시작부터 완료·충돌 정지·사용자 정지까지의 벽시계
  경과를 `performance.now()`로 별도 계측한다. 이 값은 UI·browser harness 전용이며
  Worker 메시지, WASM 결과, 저장 schema와 semantic hash에는 포함하지 않는다.
- Inspector와 결과 영역을 `재생 경과`와 `가공 추정`으로 분리했다. 전자는 실제
  표시 재생 시간을, 후자는 기존 `logicalTimeS`를 초 단위로 보여 준다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| TypeScript·변경 파일 ESLint | 통과 |
| `pnpm test:unit` | 통과 — 18 files, 136 tests |
| `pnpm test:contracts` | 통과 — 13 files, 51 tests |
| `pnpm test:parity` | 통과 — 8 files, 63 tests |
| 시간 분리·점진 절삭 E2E | 통과 — WebGPU·WebGL 2, 4/4 passed; 재생 경과 1.5–10 s, 가공 추정 50 s 초과 |
| `pnpm verify` | 통과 — 정책·버전·의존성·Cargo check·250 tests·production build |
| `pnpm build:pages`·`pnpm test:pages` | 통과 — `/CNC-Render/` 정적 경로, Chromium 1/1 |
| 전체 `pnpm test:e2e` | 미통과 — 두 연속 실행 모두 56 passed, 15 skipped, WebGL 2 장기 작업 성능 gate 1건 실패; 동일 테스트 단독 재실행 1/1 통과 |

### 남은 위험

- `재생 경과`는 브라우저 부하와 일시정지 시간을 포함하는 표시 telemetry다. 저장,
  결과 비교, 채점에는 결정론적인 `가공 추정(logicalTimeS)`만 사용해야 한다.
- 전체 E2E 연속 실행에서는 WebGL 2 프로젝트의 기존 성능 gate가 각각
  `maximumMainHandlerMs = 213.3 ms`, `longTasksOver50Ms = 2`로 간헐 실패했다.
  단독 실행은 통과했지만 전체 gate가 안정적으로 통과하기 전에는 이 작업을
  완전 완료로 기록하지 않는다. 성능 기준은 변경하거나 완화하지 않았다.
- PR #12는 CI run `31475757460` 통과 후 `main`에 병합됐고, main run
  `31476057436`의 Pages smoke와 배포가 merge SHA `3bf41dd4b11ae032f9f834e55588afb8b999c9d9`로 완료됐다.

## WebGL 2 전체 E2E 성능 게이트 안정화 (2026-08-12, 완료)

### 원인과 수정

- `SimulationCoordinator.maximumMainHandlerMs`가 첫 대표 재생 전 Worker handshake와
  초기화 처리 시간까지 누적해 실제 재생 성능 gate를 오염시켰다. 첫 대표 재생에서
  handler 계측 창을 명시적으로 시작하되 50 ms 기준은 변경하지 않았다.
- Long Task observer가 첫 재생 이후 계속 열린 채 테스트 assertion과 재생 사이 유휴
  작업까지 누적했다. 각 재생의 시작·종료 시각을 별도 창으로 기록하고 entry 시작
  시각이 실제 재생 창 안에 있을 때만 집계하며, `takeRecords()`로 지연 전달도 비운다.
- E2E는 재생 창 밖에서 의도적으로 60 ms 작업 두 개를 만들고 누적치가 변하지 않는지
  검증한다. 이 검사는 기준 완화가 아니라 gate가 대표 재생 비용만 측정하는지 확인한다.
- 렌더 업데이트를 별도 프레임 큐로 옮기거나 Worker 처리를 microtask로 미루는 실험은
  현재 머신의 Long Task 수를 줄이지 못해 최종 변경에서 제외했다. 렌더·파서·UI 샘플링
  순서와 결정론 계약은 기존 경로를 유지한다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| TypeScript·변경 파일 ESLint | 통과 |
| `pnpm test:unit --filter simulation-coordinator` | 통과 — 1 file, 2 tests |
| 고정 Node 24.18.0 `pnpm verify` | 통과 — unit 136, contract 51, parity 63, dependency 위반 0, Cargo check, production build |
| WebGL 2 결정론 성능 시나리오 10회 | 통과 — 10/10, 1.0 min; 50 ms handler·Long Task 기준 유지 |
| WebGL 2 전체 프로젝트 | 통과 — 23 passed, 조건부 1 skipped, 43.5 s |
| 전체 `pnpm test:e2e` 순서 | 통과 — WebGPU·WebGL 2 57 passed, 조건부 visual 15 skipped, 1.9 min |
| 외부 Vite 우선순위 복원 | 통과 — 각 검증 종료 후 `Idle`에서 원래 `Normal`로 복원 |

### 남은 위험

- Playwright는 SwiftShader software renderer를 사용하므로 실제 GPU 기기별 frame-time은
  별도 benchmark 범위다. 이 gate는 Worker handler와 Long Task 회귀를 검출한다.
- 동일 머신의 별도 고CPU 작업과 동시에 실행하면 scheduler 경합이 실제 Long Task를
  만들 수 있다. 완료 검증은 승인된 외부 Vite 우선순위 조정 조건에서 수행했고, 테스트
  임계값·retry·fixture 복잡도는 변경하지 않았다.

## 3축 밀링 재생·절삭 표시 결함 수정 (2026-08-10)

### 원인과 수정

- 공개판 대표 밀링 fixture는 `40 × 30 × 10 mm`, 중심 `Z = 0 mm`와
  공구 경로 `Z = 8 → 4 mm`를 사용했지만, VMC 장면의 소재는
  `360 × 200 × 88 mm`, 중심 `Z = 298 mm`(상면 `Z = 342 mm`)였다.
  Worker 좌표가 renderer 장면에 직접 적용되어 공구가 소재를 가공하는 대신
  테이블 방향으로 관통해 보였다.
- 기존 5단계 재생은 공개판에서 약 `0.879 s` 만에 끝나고 절삭 frame이 사실상
  한 번만 관측됐다. 대표 공정을 안전 높이 `Z = 370 mm`, 절삭 높이
  `Z = 338 mm`, 40 mm 간격의 5개 왕복 패스로 교체하고 표시 속도를
  `0.1×`로 조정했다.
- 수정된 대표 공정은 12단계, Stock revision 10회, 약 `3.03 s` 동안 실행되며
  제거 체적과 dirty Stock patch가 단계별로 증가한다. 마지막 공구 위치는
  `X = 170 mm, Y = 80 mm, Z = 370 mm`로 안전 복귀한다.
- 동적 Stock이 시작되면 교육용 정적 소재와 outline을 함께 숨기도록 scene
  계층을 고쳤다. 부분 Stock patch 생성 비용은 축 정렬 면의 고정 normal을
  직접 기록해 불필요한 전체 normal·bounds 재계산을 제거했다.

### 검증

| Gate | Result |
|---|---|
| `pnpm test:unit` | 통과 — 18 files, 136 tests; Stock normal·정적 outline 전환 포함 |
| `pnpm test:contracts` | 통과 — 13 files, 51 tests; VMC fixture 좌표·공구·복귀 계약 포함 |
| `pnpm test:parity` | 통과 — 8 files, 63 tests; production WASM 793,536 bytes |
| 결정론 반복 E2E | 통과 — WebGPU·WebGL 2, 6/6 passed |
| 전체 `pnpm test:e2e` | 통과 — 57 passed, 조건부 visual 15 skipped, 실패 0 |
| TypeScript·ESLint·dependency-cruiser | 통과 — 92 modules, 204 dependencies, 위반 0 |
| 문서 용어·툴체인·금지 UI·Cargo check | 통과 |
| production build·Pages build | 통과 — `/CNC-Render/` Worker·WASM 경로 검증 |
| Pages base-path E2E | 통과 — GitHub Pages Chromium 1/1, styled UI·Worker·WASM 실행 |

### 남은 위험

- 현재 교육용 재생은 G-code 구간 끝점 단위로 공구 위치와 Stock patch를 표시한다.
  서보 주기 보간이나 실제 이송 시간 재현은 아니며 E2 등급 preview다.
- 수정은 PR #11로 `main`에 병합되었으며 GitHub Pages에 재배포됐다.

## M9 validation run

2026-08-09에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`, Playwright `1.55.0`과 `wasm32-unknown-unknown` target으로
실행했다. production WASM은 793,271 bytes이며 SHA-256은
`75aea4d133cceedd1514dd74c493989e991ce515556bcac658ba9e868fdb3be8`이다.

| Gate | Result |
|---|---|
| `pnpm check:tokens` | 통과 — 단일 JSON source와 생성 CSS/TypeScript 44 tokens 일치 |
| `pnpm storybook:build` | 통과 — Button·Dialog·Tabs·UnitInput·ParameterRow·DataTable catalog |
| `pnpm test:a11y` | 통과 — WebGPU·WebGL 2 axe Critical/Serious 0, 2 passed; visual 중복 1건 의도적 skip |
| `pnpm test:visual` | 통과 — WebGPU·WebGL 2·visual 3 projects, M9 기준 canvas 923×883 px |
| `pnpm test:e2e -- --grep="M9 workspace UI"` | 통과 — WebGPU·WebGL 2에서 8 passed, visual 중복 4건 의도적 skip |
| `pnpm bench --filter ui-budget` | 통과 — 10/20Hz 상한·대표 UI 처리 평균 4ms·DOM source 예산 3 tests |
| `pnpm check:bundle` | 통과 — CSS gzip 6,207/81,920 B, WOFF2 0/409,600 B, JS gzip report 436,361 B |
| `pnpm verify` | 통과 — unit 135, contract 49, parity 63, 89 modules/193 dependencies 경계 위반 0, Cargo check, forbidden UI, production build |
| `pnpm test:e2e` | 통과 — 전체 57 passed; 장시간 soak 3건과 M7·M8·M9 visual 중복 12건 의도적 skip |

## Delivered M9 design system, workspace, and accessibility

- 토큰·프리미티브
  - `design/tokens/cnc-render.tokens.json`에서 light-only 색상·간격·타이포그래피·반경을
    CSS custom properties와 TypeScript 상수로 생성하고 drift를 계약으로 차단
  - 공용 Button, native Dialog, Tabs, UnitInput, ParameterRow, DataTable과
    Storybook 상태 catalog 제공
  - 본문·핵심 수치 12px 이상, tabular figures·단위 표기, 시스템 dark 설정에서도
    `color-scheme: light`와 동일 팔레트 유지
- 실제 Workspace 상호작용
  - Global Command Bar의 실행·일시정지·계속·정지·저장과 native 도움말 modal 연결
  - 장면·코드·학습·결과 Activity 영역과 G-code·Diagnostics Bottom Dock을 클릭·키보드
    Arrow/Home/End로 탐색 가능
  - Worker/WASM full/patch를 Stock buffer에 직접 적용하고 최대 20Hz 축 요약으로
    holder/cutter를 이동해 소재 제거와 공구 움직임을 점진적으로 표시
  - 실행 상태를 별도 command UI subtree로 격리해 M7 실행 중 MachineWorkspace React
    commit 0회 불변식 유지
- 반응형·접근성·성능
  - 9개 목표 해상도, 1440×900 콘텐츠의 3D 영역 60% 이상, 720px 미만 패널 접기,
    가로 overflow 없음과 200% 확대 핵심 기능 보존을 Playwright로 검증
  - 도움말 focus return, native control 의미 구조, 텍스트·아이콘·진단·G-code 줄·3D marker를
    함께 쓰는 충돌 표현과 forced-colors 대응
  - 보이는 DOM 2,000개, HUD 10~20Hz, CSS·font 번들, 금지 효과를 자동 gate로 고정
  - M7 Long Task 관측은 첫 대표 공정 실행 직전 시작해 이후 실행에 누적하며 초기
    UI/WebGL 준비 비용과 실제 시뮬레이션 비용을 분리

## M9 limitations and remaining risks

- M9 학습 영역은 안내와 대표 절삭 실행 preview다. 준비→설정→실행→측정→판정,
  결정론적 scoring, 힌트와 밀링·선삭·드릴링 정식 lesson은 M10 범위다.
- 코드 영역은 현재 G-code 탐색용 read-only preview다. Monaco lazy load, 편집,
  줄 진단·현재 줄·breakpoint, 측정·목표 비교·heatmap·report export는 M11 범위다.
- 상단 수동 저장은 실제 M8 persistence에 연결됐다. M8 autosave controller는
  계약 검증됐지만 M9에는 durable project model을 바꾸는 editor가 없으므로 실제 edit
  event 연결은 M10 sandbox 또는 M11 G-code editor의 첫 durable mutation과 함께 한다.
- WebGL 2는 WebGPU와 같은 명령·Worker/WASM 결과 계약을 사용하지만 표면 preview는
  기존 CPU/WASM mesh와 1K surface 한계를 상태 문구로 계속 노출한다.
- Storybook의 axe·docs bundle은 개발 catalog 전용이며 production 초기 JS에 포함되지
  않는다. production은 system font stack을 사용해 초기 WOFF2 전송량이 0 B다.

## GitHub Pages 배포 복구 (2026-08-09)

- 상태: 공개 배포·검증 완료 — https://jtech-co.github.io/CNC-Render/
- 원인: 저장소 Pages가 build_type legacy, main:/ 소스로 설정되어 Jekyll이
  애플리케이션 대신 루트 README.md를 진입 문서로 렌더링했다.
- 구현:
  - 일반 Vinext/Sites 빌드와 분리된 apps/pages-demo 순수 Vite 정적 엔트리
  - /CNC-Render/ base URL을 갖는 앱 JS·CSS·Worker·WASM·OG 자산
  - 전체 CI 통과 후 actions/upload-pages-artifact와 actions/deploy-pages로만
    main을 배포하는 Pages job
  - Worker가 Vite BASE_URL을 사용해 프로젝트 하위 경로의 WASM을 로드하는 계약
- 검증:
  - Node 24 런타임에서 Pages build 통과 — 151 modules, 정적 index.html,
    simulation Worker, 793,271-byte WASM, SHA-256
    75aea4d133cceedd1514dd74c493989e991ce515556bcac658ba9e868fdb3be8
  - 기존 Vinext/Sites production build 통과
  - TypeScript, 변경 파일 ESLint, dependency-cruiser 통과 —
    80 modules/178 dependencies, 위반 0
  - simulation-coordinator unit 2 tests 통과
  - /CNC-Render/ 로컬 HTTP smoke 통과 — index, app JS, Worker, WASM,
    OG image 모두 200; WASM MIME application/wasm
- 공개 배포 검증:
  - PR #7 merge commit c6ec688, Pages build_type workflow 전환 완료
  - main CI run 31295252832에서 고정 Node 24.18.0 전체 verify, Pages build,
    artifact upload, deploy-pages 통과
  - 공개 HTTP smoke 통과 — index, app JS, simulation Worker, 793,527-byte WASM,
    OG image 모두 200; WASM MIME application/wasm
  - Chromium 첫 렌더 통과 — 앱 셸·command bar·canvas 1개 확인,
    page error와 console error 0
- 남은 위험:
  - GitHub Actions가 Node 20 기반 일부 공식 action을 Node 24로 강제 실행했다는
    deprecation 경고를 표시했다. 배포에는 영향이 없었으며 후속 major action
    릴리스가 나오면 갱신한다.

## M8 validation run

2026-08-09에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`, Playwright `1.55.0`과 `wasm32-unknown-unknown` target으로
실행했다. production WASM은 793,271 bytes이며 SHA-256은
`75aea4d133cceedd1514dd74c493989e991ce515556bcac658ba9e868fdb3be8`이다.

| Gate | Result |
|---|---|
| `pnpm test:unit --filter persistence` | 통과 — 3 files, 11 tests, 결정론적 ZIP·v0→v1 migration·원자적 generation·중단 복구/격리·30초 autosave |
| `pnpm test:contracts --filter project-container` | 통과 — 1 file, 4 tests, 100 MiB·strict manifest·2~5초 checkpoint·redacted telemetry/cloud stub |
| `pnpm test:parity --filter persisted-project` | 통과 — 1 file, 2 tests, 실제 WASM milling·turning 전체 Stock checkpoint와 동일 step full replay byte parity |
| `pnpm test:e2e --grep "save-load\|checkpoint\|migration\|corruption"` | 통과 — WebGPU·WebGL 2에서 8 passed, visual 중복 4건 의도적 skip |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 전체, `cnc-render-wasm` native 4 tests 포함 |
| `pnpm verify` | 통과 — unit 134, contract 49, parity 63, 71 modules/158 dependencies 경계 위반 0, Cargo check, forbidden UI, production build |
| `pnpm test:e2e` | 통과 — 전체 49 passed, 장시간 soak 3건·M7 visual 중복 4건·M8 visual 중복 4건 의도적 skip |
| `pnpm test:visual --grep "machine-scene"` | 통과 — WebGPU·WebGL 2·visual 3 projects |

## Delivered M8 persistence and checkpoints

- `.cncrender` 공개 컨테이너
  - 고정 timestamp·UTF-8 이름·STORE 방식의 결정론적 ZIP writer와 STORE/DEFLATE importer
  - `schemaVersion`, `engineVersion`, `unitSystem`, project semantic hash,
    authoritative project hash와 manifest checksum을 포함하는 strict manifest
  - ZIP magic·CRC-32·SHA-256·경로 순회·정규화 충돌·중복 entry·symlink·암호화·다중 disk,
    4,096 entries·JSON 깊이 64·압축률 100:1·기본 100 MiB 상한 방어
  - schema v0 원본 byte를 immutable하게 보존하면서 순수 registry로 v1을 생성하는 migration
- IndexedDB metadata와 OPFS generation
  - IndexedDB에 active generation pointer, component hash, checkpoint index와
    `staging|ready|quarantined` metadata 저장
  - OPFS에 generation별 immutable project·G-code·Stock/checkpoint chunk와 마지막
    `generation.json` commit marker 저장
  - 모든 길이·SHA-256과 IndexedDB/OPFS metadata 일치를 확인한 뒤 하나의 IndexedDB
    transaction으로 active pointer 전환
  - 중단된 partial save는 정상 load에서 제외하고, 완전한 staging은 승격하며 불완전·손상
    staging은 안정된 diagnostic code로 격리
- WASM checkpoint·autosave
  - Rust/WASM snapshot이 milling top-Z 전체 surface 또는 turning inner/outer radius 전체
    profile을 explicit binary layout으로 반환
  - little-endian float payload, strict metadata, payload SHA-256과 state·Stock hash를 가진
    checkpoint codec 및 3초 기본/2~5초 계약·operation/terminal boundary
  - 저장 checkpoint를 renderer에 직접 복원한 reverse scrub 결과를 동일 step 전체 WASM
    replay와 milling·turning 모두 byte 단위 비교
  - 일반 변경은 30초 window로 합치고 중요 변경은 즉시 flush하며 동시 save를 직렬화하는
    autosave controller
- browser·privacy·cloud 경계
  - 실제 Chromium restart에서 machine, tool, operation, G-code, Stock, diagnostics,
    measurements와 project의 8개 semantic hash가 동일함을 OPFS·IndexedDB로 검증
  - WebGPU와 WebGL 2 모두 동일 persistence·checkpoint 기능을 제공하고 React render loop를
    추가하지 않음
  - storage telemetry 계약은 source content를 구조적으로 허용하지 않으며 cloud port는
    사용자 동의 전 `enabled: false`, D1/R2 `null`, project byte 미포함으로 고정
  - OPFS/IndexedDB 미지원 환경은 memory fallback으로 위장하지 않고 persistence만
    `unavailable` diagnostic으로 노출

## M8 limitations and remaining risks

- M8 checkpoint는 결정론적 reverse scrub용 full renderer Stock과 상태 hash를 복원한다.
  WASM 내부 절삭 engine session 자체를 역직렬화해 checkpoint 이후부터 forward 실행을
  재개하는 기능은 아직 없다.
- deterministic export는 재현성을 위해 STORE를 사용하므로 대형 프로젝트의 압축 효율이
  낮다. DEFLATE import는 브라우저 `DecompressionStream("deflate-raw")` 지원이 필요하다.
- 기본 100 MiB·entry·깊이·압축률 상한과 손상 방어는 검증했지만 실제 quota 부족,
  100 MiB 근접 파일과 장시간 다중 checkpoint의 memory plateau는 별도 soak가 필요하다.
- migration registry는 현재 대표 v0→v1 fixture만 제공한다. 이후 schema version마다 원본
  보존 golden fixture와 순차 migration을 추가해야 한다.
- autosave controller의 실제 편집 event 연결은 read-only M9 preview가 아니라 durable
  project mutation을 도입하는 M10 sandbox 또는 M11 G-code editor에서 수행한다. M9의
  상단 수동 저장은 실제 persistence 경로에 연결됐다.
- cloud persistence는 사용자 동의·계정·권한·충돌 병합 정책이 정의될 때까지 의도적으로
  비활성이다. 현재 결과는 E2 교육용 근사 검증이며 산업용 CAM 검증과 동일하지 않다.

## M7 validation run

2026-08-09에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`, Playwright `1.55.0`과 `wasm32-unknown-unknown` target으로
실행했다. production WASM은 793,311 bytes이며 public·client bundle 사본의
SHA-256은 `a48ee9b2ecd85e0b8e803aeb4bcc9d823b103096b9a372d9269ca9f11dac1d13`으로
동일하다.

| Gate | Result |
|---|---|
| `pnpm test:contracts --filter worker-protocol` | 통과 — 1 file, 3 tests, strict run·배속·Transferable 소유권·상호 배타 terminal 상태 |
| `pnpm test:parity --filter replay` | 통과 — 1 file, 4 tests, 실제 WASM 밀링·선반 realtime/fast-forward hash parity·pause freeze·collision-stop |
| `pnpm test:unit --filter simulation-coordinator` | 통과 — 1 file, 2 tests, Worker generation·runId·sequence stale 차단과 10/20 Hz UI sampling |
| `pnpm test:e2e --grep "playback\|pause\|cancel\|collision-stop"` | 통과 — 11 passed, M7 WebGPU·WebGL 2 lifecycle 8건과 M4 회귀 3건; visual 중복 4건 의도적 skip |
| `pnpm bench --filter coordinator` | 통과 — 2,000 validated Worker updates, 개별 main-thread handler 50 ms 미만·전체 3초 예산 |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 전체, `cnc-render-wasm` native 3 tests 포함 |
| `pnpm lint` / `pnpm typecheck` | 통과 — 59 modules/119 dependencies, 경계 위반 0, 문서·도구 체인 일치 |
| `pnpm verify` | 통과 — unit 123, contract 45, parity 61, Cargo check, forbidden UI, WASM production build |
| `pnpm test:e2e` | 통과 — 전체 41 passed, 장시간 soak 3건과 M7 visual 중복 4건 의도적 skip |
| `pnpm test:visual --grep "machine-scene"` | 통과 — WebGPU·WebGL 2·visual 3 projects |

## Delivered M7 Worker/WASM pipeline

- Rust/WASM 실행 core
  - `cnc-render-wasm` crate가 M2 Rust parser·Toolpath IR과 M4~M6 운동학,
    충돌, 밀링·선반 재료 제거를 한 session으로 실행
  - versioned bare C ABI로 input resize, initialize, step, snapshot, cancel과
    JSON·binary output pointer/length 제공
  - 밀링 top-Z와 선반 내·외경 dirty cell만 별도 binary layout으로 인코딩하며
    16 MiB 입력·128 MiB binary 출력 상한 적용
  - collision-stop과 정상 completed를 상호 배타 상태로 반환하고 두 terminal 모두
    최종 semantic hash 보존
- 전용 Worker와 coordinator lifecycle
  - strict Zod command/event envelope, 별도 `ArrayBuffer`와 receiver-owned
    Transferable slice descriptor
  - Worker generation, `runId`, 단조 event sequence의 세 stale-event 방벽
  - `0.1x..100x`는 표시 지연만 변경하고 논리 step·Stock·최종 hash에는 영향 없음
  - pause snapshot은 시간·Stock·축·진단을 고정하며 cancel·dispose·restart가
    timer와 이전 run을 무효화
  - renderer update는 즉시 전달하고 일반 수치 UI는 최대 10 Hz, 축 UI는 최대
    20 Hz로 독립 sampling
- renderer·browser·build 연결
  - React/Zustand를 거치지 않는 adapter가 밀링·선반 full/dirty patch와 충돌 marker를
    `WorkcellRenderer`에 직접 반영
  - WebGPU와 WebGL 2가 같은 WASM surface 계약과 완료 frame을 소비하고 실행 중
    React commit을 만들지 않음
  - production build가 고정 Rust target으로 WASM을 생성해
    `dist/client/wasm/cnc_render_wasm.wasm`에 게시하며 E2E gateway도 같은 경로를 제공
  - browser harness가 replay parity, pause freeze, cancel/restart, collision-stop,
    render frame과 Long Task telemetry를 검증

## M7 limitations and remaining risks

- 현재 Worker는 한 번에 하나의 WASM session만 소유한다. 동시 비교 실행,
  multi-worker scheduling과 session pool은 지원하지 않는다.
- M7 browser fixture는 단일 공구의 작은 대표 직선 밀링·선반 공정이다. 임의 공구
  교환, macro/subprogram, controller look-ahead, servo 오차, 다중 spindle·turret과
  대형 장시간 프로그램은 후속 범위다.
- WASM 메모리에서 Worker로 dirty binary를 한 번 복사한 뒤 Transferable로 넘긴다.
  `SharedArrayBuffer`·cross-origin isolation 기반 zero-copy ring buffer는 사용하지 않는다.
- 50 ms Long Task와 coordinator 처리 예산은 대표 fixture와 2,000-event 합성 부하로
  검증했다. 대형 CAD·Stock 및 수 시간 경로의 메모리 plateau·복구는 M8 이후 별도
  soak와 checkpoint 검증이 필요하다.
- Vinext `0.0.50`의 Windows 정적 자산 경로 제약 때문에 build wrapper와 E2E gateway가
  `/wasm/*`를 명시적으로 게시한다. upstream 동작이 바뀌면 workaround 제거 여부를
  재검증해야 한다.
- 결과는 E2 교육용 근사 검증이며 산업용 CAM verification, 공작기계 안전 인증,
  실제 controller 결과와 동일하지 않다.

## M6 validation run

2026-08-01에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`, Playwright `1.55.0`으로 실행했다. Golden gate는 facing, OD,
taper, groove, parting, drilling, boring을 세 preset에서 검증했다.

| Gate | Result |
|---|---|
| `pnpm test:unit --filter turning` | 통과 — 3 files, 14 tests, 7개 대표 공정·반경 오차·단조 제거·충돌·저장/복원·renderer dirty range |
| `pnpm test:unit --filter spindle-mode` | 통과 — 1 file, 3 tests, G96·G97와 machine/tool 최대 RPM clamp |
| `pnpm test:parity --filter lathe-profile` | 통과 — 1 file, 2 tests, 7 fixtures × 3 presets TypeScript↔Rust profile·hash·측정 parity와 Rust 100회 |
| `pnpm test:e2e --grep "facing\|od-turning\|taper"` | 통과 — WebGPU·WebGL 2·visual 3 projects × 3 fixtures, 9 tests |
| `pnpm test:e2e` | 통과 — 전체 33 tests, 장시간 soak 3 tests opt-in skip |
| `pnpm test:visual --grep "machine-scene"` | 통과 — WebGPU·WebGL 2·visual 3 projects |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 전체, simulation-core M6 포함 6 tests |
| `pnpm lint` | 통과 — ESLint, 53 modules/105 dependencies, 경계 위반 0, 문서·도구 체인 일치 |
| `pnpm verify` | 통과 — unit 121, contract 42, parity 57, Cargo check, forbidden UI, production build |

## Delivered M6 lathe material removal

- 반경 필드·절삭 core
  - canonical Z축 동축 원통과 축방향 셀별 `outerRadiusLayers`·`innerRadiusLayers`
    정수 반경 필드
  - Preview 2×·Balanced 1×·Precision 0.5× 해상도와 셀 크기 이하 OD 반경 오차
  - 외경은 감소하고 내경은 증가하는 단조 제거와
    `0 <= inner <= outer <= initial` 불변식
  - facing, OD, taper, groove, parting, drilling, boring 대표 프로파일
  - 같은 또는 덜 공격적인 재절삭에서 Stock 성장·부호 반전·불필요 revision 없음
- 주축·충돌·결정론
  - G96 `1000 × Vc / (π × D)`와 G97 지령 RPM, machine/tool 최대 RPM 중
    작은 값으로 clamp하고 요청값·유효값을 함께 반환
  - 공구 끝의 회전축 반대편 통과와 설정된 척 파지 영역 진입을 fail-closed 감지
  - version·seed·preset·해상도·축 경계·정수 layer 배열의 canonical SHA-256 hash
  - snapshot에 revision과 내·외경 layer를 저장하며 복원 후 hash·측정 동일
  - TypeScript reference와 Rust core의 7 fixtures × 3 presets parity
- dirty surface·browser integration
  - 축방향 셀 × 고정 radial segment의 BufferGeometry를 한 번 할당하고 변경 셀만 재작성
  - WebGPU와 WebGL 2가 같은 CPU profile patch를 소비하며 backend별 update range 기록
  - 대형 반경 배열은 React/Zustand가 아닌 simulation core와 renderer 메모리에 유지
  - facing·OD turning·taper fixture에서 renderer frame 완료와 React commit 분리

## M6 limitations and remaining risks

- M6는 Z축 동축 원통과 회전 대칭 형상, 이상화된 인서트·드릴만 지원한다.
  나사산, 편심 가공, 임의 spline 프로파일, 공구 코너의 실제 swept volume,
  척 jaw 형상과 절단 후 분리된 강체 동역학은 후속 범위다.
- 브라우저는 M7 Worker/WASM coordinator 전까지 TypeScript reference core를
  사용한다. Rust parity CLI는 최종 profile·hash·측정을 검증하지만 현재
  renderer의 실시간 실행 주체는 아니다.
- 회전체 surface는 셀별 독립 geometry와 고정 radial segment를 사용한다.
  dirty cell은 부분 갱신하지만 인접 셀을 잇는 매끄러운 법선·공유 topology와
  compute 기반 표면 재구성은 아직 제공하지 않는다.
- browser fixture는 결정론적 교육용 facing·OD·taper 경로다. 임의 사용자
  G-code playback, 공구 교환, 절단 부품 분리 lifecycle 연결은 M7 이후 범위다.
- 결과는 E2 교육용 근사 검증이며 산업용 CAM verification, 공작기계 안전 인증,
  실제 controller 결과와 동일하지 않다.

## M5 validation run

2026-08-01에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`, Playwright `1.55.0`으로 실행했다. Golden gate는 face, slot,
pocket, outer contour의 해석 부피를 세 preset에서 각각 검증했다.

| Gate | Result |
|---|---|
| `pnpm test:unit --filter material-removal-milling` | 통과 — 2 files, 24 tests, Golden 부피·비접촉 0·100회 hash·측정·dirty range |
| `pnpm test:parity --filter stock-hash` | 통과 — 1 file, 2 tests, 4 fixtures × 3 presets TypeScript↔Rust hash·부피·브릭 parity와 Rust 100회 |
| `pnpm bench --filter milling-golden` | 통과 — 1 file, 2 tests, 12 Golden 실행과 18,000-step 논리적 5분/60 Hz 절삭의 메모리 plateau·5초 CPU 예산 |
| `pnpm test:e2e --grep "face-milling\|slot\|pocket"` | 통과 — WebGPU·WebGL 2·visual 3 projects × 3 fixtures, 9 tests |
| `pnpm test:e2e` | 통과 — 기존 viewport·collision 포함 24 tests, 장시간 soak 3 tests opt-in skip |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 전체, simulation-core M5 포함 4 tests |
| `pnpm lint` | 통과 — ESLint, 49 modules/93 dependencies, 경계 위반 0, 문서·도구 체인 일치 |
| `pnpm verify` | 통과 — unit 107, contract 42, parity 55, Cargo check, forbidden UI, production build |

## Delivered M5 milling material removal

- Stock·swept-volume core
  - M1 `Stock`·`ToolAssembly` API를 소비하는 axis-aligned box와 flat-end mill
  - canonical mm와 Preview 2×·Balanced 1×·Precision 0.5× 해상도
  - 16×16 희소 브릭, 미할당 브릭은 손상되지 않은 원재료, 덱셀별 정수 깊이 layer
  - XY capsule의 유효 매개변수 구간에서 최저 cutter-tip Z를 구하는 선형 swept volume
  - cutter만 재료를 제거하고 cutting length·메모리 cap·Uint32 grid 상한을 fail-closed 검증
  - 성공한 동일 sweep을 최대 1,024개까지 bounded cache하여 단조 제거의 반복 무변경 경로를 O(1) 처리
- 정확도·결정론·측정
  - face, slot, stadium pocket, closed rectangular outer contour 해석 부피 fixture
  - 상대 부피 오차 상한 Preview 5%, Balanced 2%, Precision 1%
  - 비접촉 이동의 정확한 0 부피·0 브릭·0 patch
  - seed·preset·해상도·경계·grid·정렬된 브릭 깊이로 canonical SHA-256 Stock hash
  - TypeScript와 Rust의 4 fixtures × 3 presets hash·부피·할당 상태 일치
  - 거리·깊이·벽 두께 결과와 representation resolution 동시 반환
- dirty surface·browser integration
  - 초기 surface snapshot 1회 뒤 변경 덱셀만 `Uint32Array` index와
    `Float32Array` 높이 patch로 추출
  - renderer가 하나의 사전 할당 BufferGeometry를 유지하고 연속 vertex range만 갱신
  - 같은 frame 전 들어온 update range를 누적하고 render 완료 뒤 해제
  - WebGPU는 GPU 부분 buffer update, WebGL 2는 CPU/WASM 부분 메시 update로 차이 공개
  - engine과 대형 배열은 React state/Zustand가 아닌 simulation ref와 renderer 메모리에 유지
  - face-milling·slot·pocket browser fixture의 Stock patch가 그려진 frame과 React commit 분리

## M5 limitations and remaining risks

- 표현은 axis-aligned box Stock, flat-end mill, 수직 3축, 언더컷 없는 단일
  Z solid interval만 지원한다. cylinder Stock, ball/bull tool, 다중 interval,
  X/Y dexel과 local SDF는 후속 범위다.
- 브라우저는 M7 Worker/WASM coordinator 전까지 TypeScript reference core를
  사용한다. Rust parity CLI는 같은 최종 Stock 상태를 검증하지만 현재 renderer의
  실시간 실행 주체는 아니다.
- M5 surface는 변경 덱셀별 독립 column geometry다. 전체 remesh는 하지 않지만
  marching-cubes/dual-contouring 기반의 매끄러운 국부 표면 추출은 후속 범위다.
- 5분 gate는 18,000 simulation step을 실행하는 논리적 soak다. 실제 wall-clock
  5분 browser/GPU 장시간 절삭과 다양한 고유 toolpath의 cache 압력은 M7 통합 뒤
  별도 장시간 gate로 다시 검증해야 한다.
- browser fixture는 결정론적 교육용 face·slot·pocket 경로다. 임의 사용자
  G-code playback과 공구 교환 lifecycle 연결은 M7 이후 범위다.
- 결과는 E2 교육용 근사 검증이며 산업용 CAM verification, 공작기계 안전 인증,
  실제 controller 결과와 동일하지 않다.

## M4 validation run

2026-08-01에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`로 실행했다. browser gate는 Playwright `1.55.0`의 WebGPU,
WebGL 2와 visual 세 프로젝트에서 같은 CPU collision event를 검증했다.

| Gate | Result |
|---|---|
| `pnpm test:unit --filter kinematics-3axis` | 통과 — 1 file, 10 tests |
| `pnpm test:unit --filter collision` | 통과 — 2 files, 14 tests |
| `pnpm test:parity --filter poses` | 통과 — 1 file, 2 tests, TypeScript↔Rust 100회·별도 프로세스 parity |
| `pnpm test:e2e --grep "collision-stop"` | 통과 — WebGPU·WebGL 2·visual 3 projects, next-frame stop·3D 위치·G-code 3행 연결 |
| `pnpm bench --filter collision-fixtures` | 통과 — 121 proxies × 2,000 frames, total 1,500 ms·평균 0.75 ms/frame budget |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 125 tests, M4 simulation core 2 tests |
| `pnpm lint` | 통과 — ESLint, 45 modules/81 dependencies, violation 0, 문서·도구체인 일치 |
| `pnpm verify` | 통과 — unit 83, contract 42, parity 53, Cargo check, forbidden UI, production build |

## Delivered M4 kinematics and collision verification

- 3축 VMC 운동학
  - 하나의 분기 없는 linear-axis kinematic tree와 직교 unit direction 검증
  - `TCP = tcpAtHome + Σ direction × (position - home)`의 canonical mm FK
  - home/min/max inclusive travel, rapid/feed velocity와 midpoint acceleration guard
  - 최대 axis step 기반 결정론적 보간과 1,000,000 step 자원 상한
  - TypeScript browser reference와 `cnc-render-simulation-core` Rust `f64` parity
- 충돌 core
  - renderer visual object와 독립된 UUID collision proxy·group·양방향 mask
  - Sweep and Prune/AABB broad phase
  - sphere-sphere, sphere-box, box-box analytic narrow phase
  - endpoint 사이 rapid 충돌을 찾는 bounded translation interpolation
  - malformed proxy·frame·run ID·event에서 빈 결과 대신 `CollisionInputError`
- event와 정지 연결
  - M1 `simulation.collision`의 time, object pair, world mm position,
    severity, penetration과 source line 보존
  - object ID 기준 안정 정렬, contact-enter 발행과 동시 contact 후 frame stop
  - 3D collision marker를 scene에 적용한 renderer frame 완료 후에만 UI `stopped`
  - viewport 정지 문구, semantic object, mm 위치, diagnostics count와 G-code 3행 연결
  - DOM ref 기반 telemetry로 collision frame과 React commit 분리
- 검증 자산
  - VMC home/min/max/representative-cut Golden Pose
  - safe 0-event fixture와 cutter·holder·chuck·vise impact fixture
  - rapid tunneling, group mask, 세 analytic pair, fail-closed, 100회 결정론 테스트
  - browser collision-stop fixture와 121-proxy CPU benchmark

## M4 limitations and remaining risks

- 운동학은 정확히 세 개의 직교 linear axis를 가진 VMC만 지원한다. rotary axis,
  branch, 3+2축과 동시 5축은 근사하지 않고 거부하며 M13 범위로 남긴다.
- collision proxy는 sphere와 axis-aligned box다. triangle mesh, convex hull,
  capsule/cylinder와 임의 방향 box narrow phase는 아직 지원하지 않는다.
- rapid 검사는 bounded discrete interpolation이다. 분석적 continuous time of
  impact나 controller look-ahead·jerk·servo following error·실제 정지 거리를
  보증하지 않는다.
- browser는 TypeScript reference core를 사용한다. Rust core의 Worker/WASM
  coordinator 연결과 실제 Toolpath playback lifecycle은 M7 범위다.
- 현재 작업실 버튼은 source-mapped M4 교육 fixture를 실행한다. 임의 사용자
  G-code를 실제 machine state와 연결하는 UI 실행 경로는 M7 이후 범위다.
- 결과는 E2 교육용 단순 형상 검증이며 산업용 CAM verification, 기계 안전
  인증 또는 실제 controller 결과와 동일하지 않다.

## M3 validation run

2026-07-29에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`으로 실행했다.
WebGPU와 WebGL 2 E2E는 Chromium `140.0.7339.16`, Playwright `1.55.0`을
사용했다.

| Gate | Result |
|---|---|
| `pnpm lint` | 통과 — ESLint, 41 modules/74 dependencies, violation 0, 문서·도구체인 일치 |
| `pnpm typecheck` | 통과 |
| `pnpm test:unit --filter renderer` | 통과 — 1 file, 7 tests |
| `pnpm test:unit` | 통과 — 5 files, 59 tests |
| `pnpm test:contracts` | 통과 — 11 files, 42 tests |
| `pnpm test:parity` | 통과 — 3 files, 51 tests |
| `pnpm test:e2e --project=chromium-webgpu --grep "viewport"` | 통과 — 4 passed, full soak 1 skipped |
| `pnpm test:e2e --project=chromium-webgl2 --grep "viewport"` | 통과 — 4 passed, full soak 1 skipped |
| `pnpm test:visual --grep "machine-scene"` | 통과 — WebGPU·WebGL 2·visual 3 projects |
| Linux Playwright `visual` project | 통과 — official `v1.55.0-noble`, 1 visual regression |
| `pnpm bench --filter renderer-smoke` | 통과 — 20,000 bounds projections, 750 ms budget |
| `pnpm check:forbidden-ui` | 통과 |
| `pnpm build` | 통과 — Vinext 5단계 production build |
| `CNC_RENDER_SOAK_PHASE_MS=600000` backend별 soak | 통과 — WebGPU·WebGL 2 각 20.3분, 2 passed/21.9분 |

visual baseline은 `875 × 609 px`이고 `#E9EDF1` 배경 432,281 px,
백색 소재 14,576 px와 고대비 소재 윤곽 892 px를 포함한다. 같은 baseline은
공식 Playwright Ubuntu Noble 이미지에서 고정 Node `24.18.0`, pnpm `11.5.3`,
Playwright `1.55.0`으로 재검증했다. 브라우저 제어 플러그인은 로컬 Windows
ACL 적용 오류로 시작하지 못했으므로 자동 Playwright screenshot·픽셀
통계로 대체했다.

## Delivered M3 renderer shell

- renderer contract
  - WebGPU 우선, WebGL 2 안전 폴백과 backend별 limit 공개
  - `1 scene unit = 1 mm`, CNC Z-up에서 Three.js Y-up으로 단일 변환
  - 기계·소재·절삭 공구·공구 홀더·고정구·공구 경로 독립 layer와 collision ID
  - backend projection Golden 허용 오차 `0.75 px`
- renderer-owned scene
  - 기계, fixture, 백색 소재와 윤곽, tool assembly, toolpath guide
  - 오른쪽 Orbit, 가운데 Pan, wheel Zoom, 왼쪽 semantic selection
  - 정면·평면·우측·등각·Fit·layer focus, `180..5000 mm` focus range
  - on-demand frame invalidation, resource telemetry와 명시적 dispose
- React 작업실 셸
  - light-only command bar, scene graph, viewport, inspector와 program dock
  - backend·기능 한계·단위·E2 정확도와 교육용 비검증 고지
  - React commit과 renderer frame을 분리한 browser harness
- 검증 자산
  - WebGPU/WebGL 2 E2E, machine-scene visual baseline, renderer smoke benchmark
  - 10+10분 soak 전용 opt-in gate
  - production E2E 서버에서 app 요청은 Vinext로 전달하고 `/assets/*`는
    `dist/client`에서 경로 이탈 방지 후 직접 제공하는 Windows test gateway
  - 긴 비 ASCII Windows 경로에서만 임시 `subst`를 쓰는 Vinext build wrapper

## M3 limitations and remaining risks

- Vinext `0.0.50` production static cache는 Windows의 `path.relative()` 결과를
  URL 구분자로 정규화하지 않아 `/assets/*`를 404로 반환한다. E2E 전용
  gateway가 해당 자산만 직접 제공하며, upstream 수정 버전으로 갱신할 때
  workaround 제거 여부를 재검증해야 한다.
- WebGPU material update는 capability budget과 준비 상태만 표시한다. 실제
  재료 제거, collision, machine kinematics와 Toolpath 실행 연결은 후속 범위다.
- 현재 scene은 결정론적 교육 fixture이며 실제 장비 형상이나 산업용 검증
  결과와 동일하지 않다.

## M2 validation run

2026-07-28에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`로 실행했다.

| Gate | Result |
|---|---|
| `pnpm test:unit --filter gcode` | 통과 — 1 file, 44 tests, Golden 44쌍 |
| `pnpm test:contracts --filter toolpath-ir` | 통과 — 1 file, 3 tests |
| `pnpm test:parity --filter gcode` | 통과 — 1 file, 45 tests |
| `pnpm cargo:check` | 통과 — workspace all targets, locked |
| `pnpm fuzz:gcode -- --time=60` | 통과 — 8,120 cases: raw 3,294 / structured 3,208 / mutated 1,618 |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 123 tests, 그중 M2 G-code core 89 tests |
| `pnpm check:boundaries` | 통과 — 17 modules, 33 dependencies, violation 0 |
| `pnpm verify` | 통과 — lint, typecheck, Cargo check, unit 52, contract 42, parity 51, forbidden UI, production build |

## Delivered M2 core

- `cnc-render-gcode-core`
  - UTF-8 lexer, block parser, modal state machine, semantic validator
  - canonical mm motion, program control event, M1 `ToolpathIR`, source line map
  - G0~G3, G17~G21, G43/G49, G54~G59, G80~G83, G90/G91,
    G94~G99와 지원 M-code lowering
  - G17/G18/G19 원호, R minor·major arc, unit-aware IJK radius tolerance
  - G81/G82/G83 sticky cycle, G98/G99 return, absolute·incremental coordinate rebinding
  - G94/G95와 G96/G97 feed·spindle mode 경계
  - M0/M1/M2/M30 event와 M2/M30 이후 비실행 block 정적 지원 검증
- 결정론과 실패 원자성
  - 전체 입력·옵션을 scope로 하는 RFC 9562 version 8 Toolpath·segment ID
  - fatal 진단에서 motion·event·길이·상태를 노출하지 않는 fail-closed 결과
  - terminal `request.resource_limit`를 마지막에 두고 일반 진단 prefix를
    source 위치와 emission order로 안정 정렬
  - block transaction rollback과 같은 입력 100회 byte parity
- 자원 경계
  - CLI envelope 20 MiB, decoded source 16 MiB, line 1 MiB
  - 250,000 lines, 1,000,000 words, 400,000 canonical motions
  - 10,000 diagnostics, G83 parse-wide 100,000 pecks, parity repetitions 1..=100
  - 모든 한도는 inclusive이며 다음 항목에서 명시적 fatal 또는 요청 오류
- 검증 자산
  - `valid`, `invalid`, `modal`, `dialect` 범주의 44쌍 `.nc`·manifest
  - machine-readable support matrix와 코드·문서·공개 진단 일치 계약
  - raw·structured·mutated corpus, panic·hang·silent acceptance·결정론·수치
    불변식을 검사하는 고정-seed fuzz

## M2 limitations and remaining risks

- 실행 방언은 `common-v1` 하나다. Fanuc-like, Haas-like, LinuxCNC-like
  전체 호환을 보증하지 않는다.
- G41/G42, G84~G89, macro·variable, 식, 서브프로그램, G90.1/G91.1,
  다회전 arc와 5축 lowering은 명시적으로 거부한다.
- G95+G96은 segment 끝점 X를 지름으로 사용해 scalar `mm/min` feed를
  계산하는 E1/E2 근사다. 구간 내 연속 RPM, 기계별 clamp, 가감속은 M4 이후
  운동학 범위다.
- 60초 fuzz는 grammar-aware deterministic mutation smoke다. 장시간
  coverage-guided fuzz와 다양한 corpus 확장은 후속 hardening 범위다.
- Rust 코어는 아직 Worker/WASM, renderer, 충돌과 재료 제거에 연결하지
  않았다. UI에서 G-code를 실행하거나 3D 가공 결과를 보여 주지 않는다.

## Environment notes

- 로컬 Windows Rust 실행 검증은 Visual Studio Build Tools 2022의 MSVC x64
  toolchain을 사용했다.
- `scripts/run-cargo.mjs`는 Windows에서 `VsDevCmd.bat`를 탐지해 PATH, LIB,
  INCLUDE 환경을 자식 Cargo 프로세스에만 적용한다. Linux CI 동작은 그대로다.
- 프로젝트가 고정한 Node `24.18.0`은 격리된 `C:\tmp` 도구 경로에서 실행해
  시스템 Node와 섞이지 않도록 했다.
- M2는 UI 변경이 아니므로 브라우저·visual regression 검증은 수행하지 않았다.
  production build와 기존 rendered HTML 계약은 유지했다.
- M2 구현과 검증은 로컬에서 완료했으며, 게시 이력은 GitHub PR과 Sites
  배포 기록을 단일 출처로 사용한다.

## Previous milestone

M1은 TypeScript·JSON Schema·Rust의 strict UUID·UTC·nullable·단위 규칙,
RFC 8785 semantic hash, Project·Worker 계약과 공용 fixture를 완료했다.
M2는 이 계약과 기존 34개 Rust 테스트를 유지한 채 추가되었다.

## Decision log

| Date | Decision | Reason | Affected files |
|---|---|---|---|
| 2026-07-26 | 루트 `vinext` 스캐폴드는 배포 adapter로 유지하고 `apps/web`을 애플리케이션 composition root로 사용한다. | 초기 Cloudflare adapter 계약을 보존하면서 UI, simulation, renderer, storage의 조립 책임을 한곳에 둔다. | `app/`, `worker/`, `apps/web/`, `docs/architecture-decisions/0001-repository-boundaries.md` |
| 2026-07-26 | Node `24.18.0`, pnpm `11.5.3`, Rust `1.97.1`을 로컬 도구 파일과 CI에 정확히 고정한다. | 개발 환경과 CI의 재현성을 유지한다. | `.tool-versions`, `rust-toolchain.toml`, `.github/workflows/ci.yml` |
| 2026-07-26 | 프로젝트 형식은 `.cncrender` ZIP 컨테이너, MIME `application/vnd.cnc-render.project+zip`, schema ID `urn:cnc-render:schema:project:1`, `schemaVersion` 정수 `1`을 사용한다. | 제품명과 저장 형식을 통일하고 명확한 버전·전송 경계를 제공한다. | `docs/architecture-decisions/0002-project-container-format.md`, `.gitattributes` |
| 2026-07-27 | TypeScript와 Rust 계약은 strict UUID·UTC·nullable·단위 규칙과 RFC 8785 semantic hash를 공유한다. | 파서·Worker·저장 구현 전에 wire 의미와 실패 규칙을 고정한다. | `packages/contracts/`, `crates/cnc-render-contracts/`, `docs/architecture-decisions/0003-domain-contracts.md` |
| 2026-07-27 | Worker command는 명시적 null `replyTo`, ready와 project result는 검증 가능한 reply UUID를 사용하고 `run.dispose`는 one-way stale barrier로 둔다. | 메시지 상관관계와 이전 run 이벤트 유입을 M1 계약 수준에서 차단한다. | `packages/contracts/src/worker.ts`, `crates/cnc-render-contracts/src/worker.rs` |
| 2026-07-28 | M2 실행 방언을 versioned `common-v1` 부분집합으로 고정하고 지원 매트릭스 밖 기능은 조용히 무시하지 않는다. | 제조사 전체 호환을 과장하지 않으면서 결정론적 교육용 E1/E2 경로를 제공한다. | `crates/gcode-core/`, `docs/architecture-decisions/0004-gcode-parser.md`, `docs/gcode-support-matrix.md` |
| 2026-07-28 | fatal parse는 전체 결과를 fail-closed하고, 자원 상한·진단 순서·결정론적 ID를 공개 계약으로 둔다. | 부분 경로 소비, 자원 고갈, 실행 간 결과 drift를 M2 경계에서 차단한다. | `crates/gcode-core/`, `tests/fixtures/gcode/`, `tests/parity/gcode-determinism.test.ts` |
| 2026-07-29 | renderer가 scene·camera·GPU loop를 소유하고 WebGPU 우선·WebGL 2 공개 폴백을 제공한다. | React frame 결합과 backend 기능 과장을 막고 같은 mm fixture의 결정론적 교육용 E2 장면을 제공한다. | `packages/renderer/`, `app/components/`, `docs/architecture-decisions/0005-renderer-workcell-shell.md` |
| 2026-08-01 | 3축 FK·축 guard와 sphere/AABB collision proxy를 simulation core에 두고 stop UI는 marker가 그려진 renderer frame 뒤에 전환한다. | 수치·충돌 결정론, visual/collision 분리와 React frame 독립성을 M4 계약으로 고정한다. | `packages/simulation/`, `crates/simulation-core/`, `packages/renderer/`, `docs/architecture-decisions/0006-three-axis-kinematics-collision.md` |
| 2026-08-01 | 3축 재료 제거는 16×16 희소 Z-dexel 브릭과 정수 깊이 layer를 simulation core가 소유하고 renderer에는 dirty cell patch만 전달한다. | 비접촉 0, 부피 정확도, Stock hash 결정론과 전체 remesh 없는 부분 GPU 갱신을 같은 계약으로 고정한다. | `packages/simulation/`, `crates/simulation-core/`, `packages/renderer/`, `docs/architecture-decisions/0007-sparse-dexel-milling.md` |
| 2026-08-01 | 선반 Stock은 Z축 정수 내·외경 필드로 표현하고 renderer에는 dirty axial cell patch만 전달한다. | 대표 회전 대칭 공정의 단조 제거·셀 크기 이하 반경 오차·저장 해시 결정론과 부분 GPU 갱신을 같은 계약으로 고정한다. | `packages/simulation/`, `crates/simulation-core/`, `packages/renderer/`, `docs/architecture-decisions/0008-lathe-radius-field.md` |
| 2026-08-09 | 전용 Worker가 bare C ABI Rust/WASM session을 소유하고 renderer에는 receiver-owned Transferable dirty buffer만 전달한다. | G-code부터 Stock·충돌·renderer까지 실제 Rust 실행 경로, 재생 결정론, pause/cancel lifecycle과 stale-event 차단을 하나의 공개 계약으로 고정한다. | `crates/cnc-render-wasm/`, `packages/contracts/src/coordinator.ts`, `packages/simulation/src/coordinator.ts`, `docs/architecture-decisions/0009-worker-wasm-simulation-coordinator.md` |
