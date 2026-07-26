# CNC Render

CNC Render는 웹에서 CNC 가공을 시뮬레이션하고 단계적으로 학습하기 위한
프로젝트입니다. 현재 저장소는 **M0 — 저장소 기반·문서 정합성** 단계입니다.
패키지 경계와 검증 하네스만 준비하며, 아직 G-code 실행, 재료 제거 또는 완성된
3D 작업실을 제공하지 않습니다.

## M0 범위

| 경계 | 현재 책임 |
|---|---|
| `@cnc-render/ui` | React UI 셸과 접근 가능한 입력의 경계 |
| `@cnc-render/simulation` | Worker·Rust/WASM 계산 코어가 따를 계약 경계 |
| `@cnc-render/renderer` | 계산 결과를 읽기 전용으로 표현할 렌더링 경계 |
| `@cnc-render/storage` | 버전이 있는 프로젝트·체크포인트 저장 경계 |

M0는 기능 데모가 아니라 이후 마일스톤이 서로의 내부 구현에 의존하지 않도록
기반을 고정하는 단계입니다.

## 시작하기

Node.js와 Rust 버전은 저장소의 버전 고정 파일을 따릅니다. 패키지 관리자는
정확히 **pnpm 11.5.3**을 사용하고, 작업 전 `pnpm --version`으로 확인합니다.

```bash
pnpm --version
pnpm install --frozen-lockfile
pnpm verify
pnpm dev
```

첫 명령의 출력이 `11.5.3`이 아니면 설치된 pnpm을 11.5.3으로 맞춘 뒤
진행합니다. `pnpm dev`는 루트의 CNC Render M0 foundation 페이지를 실행합니다.
이 페이지의 VMC 도식은 CSS로 만든 정적 개념 표현이며 시뮬레이션 결과가
아닙니다.

## 표준 검증

가장 먼저 실행할 명령은 다음과 같습니다.

```bash
pnpm verify
```

`verify`는 최소한 lint, TypeScript 타입 검사, Rust 검사, 단위·계약 테스트와
프로덕션 빌드를 순서대로 확인합니다. 전체 릴리스 게이트에서는 다음 독립 검증도
사용합니다.

```bash
pnpm test:e2e
pnpm test:visual
pnpm test:a11y
pnpm test:parity
pnpm bench
pnpm check:bundle
pnpm check:forbidden-ui
```

테스트를 삭제·완화하거나 성능 기준을 임의로 낮춰 마일스톤을 통과시키지
않습니다.

## 저장소 구조

```text
app/                    Sites용 제품 셸과 Cloudflare Worker 어댑터
apps/web/               웹 애플리케이션 조립 경계
packages/ui/            도메인 중립 UI
packages/simulation/    렌더링·저장과 분리된 시뮬레이션 경계
packages/renderer/      3D 표현 어댑터 경계
packages/storage/       프로젝트 영속화 경계
crates/                 Rust/WASM 수치 코어
design/tokens/          라이트모드 디자인 토큰 단일 출처
docs/                   용어집과 아키텍처 결정 기록
tests/                  빌드 산출물·계약 검증
```

책임이 생기기 전 빈 디렉터리를 선제적으로 만들지 않습니다.

## 핵심 불변식

- UI는 라이트모드 전용입니다. 다크 토큰, 테마 토글과 시스템 테마 자동 반영을
  추가하지 않습니다.
- React는 UI 셸만 담당합니다. 시뮬레이션 프레임마다 전체 UI 상태를 갱신하지
  않습니다.
- 복셀, 덱셀, SDF와 대형 `TypedArray`는 Worker, WASM 또는 GPU 메모리에 두며
  Zustand에 저장하지 않습니다.
- G-code parser, Toolpath IR, 운동학, 충돌, 재료 제거와 렌더링의 모듈 경계를
  유지합니다.
- Rapier를 절삭 재료 제거 엔진으로 사용하지 않습니다.
- 같은 입력·버전·설정·시드의 결과는 결정론적으로 재현되어야 합니다.
- 핵심 수치에는 단위를 표시하고 표시 단위와 내부 계산 단위를 분리합니다.
- CNC Render 결과에는 E1/E2/S1/S2 정확도 등급과 근사 한계를 노출합니다.
- 제품은 산업용 검증 도구 또는 실제 CNC 장비 제어기로 표현하지 않습니다.

## 프로젝트 형식

프로젝트 교환 형식은 ZIP 기반 `.cncrender`이며 미디어 타입은
`application/vnd.cnc-render.project+zip`입니다. 현재 스키마 버전은 `1`이고,
가져온 프로젝트는 신뢰할 수 없는 데이터로 검증합니다. 자세한 내용은
[프로젝트 컨테이너 ADR](docs/architecture-decisions/0002-project-container-format.md)을
참조하세요.

## 문서

- [CNC 표준 용어집](docs/terminology.md)
- [저장소 경계 ADR](docs/architecture-decisions/0001-repository-boundaries.md)
- [프로젝트 컨테이너 ADR](docs/architecture-decisions/0002-project-container-format.md)
- [기술 백서](docs/technical-whitepaper.md)
- [디자인 백서](docs/design-whitepaper.md)
- [QA 작업 하네스](docs/qa-harness.md)

## 다음 마일스톤

M1은 `ProjectSchema`, `MachineDefinition`, `ToolAssembly`, `Stock`,
`Operation`, `ToolpathIR`, `SimulationEvent`와 Worker 메시지 계약을
TypeScript·Rust 양쪽에 정의합니다. 실제 시뮬레이션과 3D 작업실은 각 후속
마일스톤의 검증 기준을 통과한 뒤 연결합니다.
