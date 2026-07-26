# CNC Render

CNC Render는 웹에서 CNC 가공을 시뮬레이션하고 단계적으로 학습하기 위한
프로젝트입니다. 현재 저장소는 **M1 — 도메인 스키마·단위·Worker 메시지
계약**까지 구현했습니다. 실제 G-code 실행, 재료 제거 또는 완성된 3D
작업실은 아직 제공하지 않습니다.

## M1 범위

| 경계 | 현재 책임 |
|---|---|
| `@cnc-render/contracts` | Zod 도메인·단위·Worker wire 계약과 JSON Schema |
| `cnc-render-contracts` | 동일 wire 모델의 Rust serde·semantic validator |
| `@cnc-render/ui` | React UI 셸과 접근 가능한 입력의 경계 |
| `@cnc-render/simulation` | Worker·Rust/WASM 계산 코어가 따를 조립 경계 |
| `@cnc-render/renderer` | 계산 결과를 읽기 전용으로 표현할 렌더링 경계 |
| `@cnc-render/storage` | 버전이 있는 프로젝트·체크포인트 저장 경계 |

M1은 `ProjectSchema`, `MachineDefinition`, `ToolAssembly`, `Stock`,
`Operation`, `ToolpathIR`, `SimulationEvent`와 Worker protocol version
`1`을 TypeScript와 Rust 양쪽에 고정합니다. 공용 fixture의 RFC 8785
canonical JSON SHA-256으로 두 구현의 의미 parity를 확인합니다.

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
진행합니다. `pnpm dev`는 현재 CNC Render foundation 페이지를 실행합니다.
이 페이지의 VMC 도식은 CSS로 만든 정적 개념 표현이며 시뮬레이션 결과가
아닙니다.

## 표준 검증

전체 로컬 검증은 다음 명령으로 실행합니다.

```bash
pnpm verify
pnpm cargo:test
```

M1 하네스의 독립 게이트는 다음과 같습니다.

```bash
pnpm test:contracts
pnpm test:parity --filter schema
pnpm test:unit --filter units
pnpm cargo:check
```

JSON Schema와 공용 semantic hash fixture를 의도적으로 갱신할 때만
`pnpm generate:contracts`를 실행합니다. 일반 계약 테스트는 체크인 산출물과
생성 결과가 byte 단위로 같은지 확인합니다.

후속 릴리스 게이트에서는 다음 독립 검증도 사용합니다.

```bash
pnpm test:e2e
pnpm test:visual
pnpm test:a11y
pnpm bench
pnpm check:bundle
pnpm check:forbidden-ui
```

테스트를 삭제·완화하거나 성능 기준을 임의로 낮춰 마일스톤을 통과시키지
않습니다.

## 저장소 구조

```text
app/                              루트 제품 셸과 Cloudflare Worker adapter
apps/web/                         웹 애플리케이션 조립 경계
packages/contracts/               TypeScript 도메인·Worker 계약과 JSON Schema
packages/ui/                      도메인 중립 UI
packages/simulation/              렌더링·저장과 분리된 시뮬레이션 경계
packages/renderer/                3D 표현 adapter 경계
packages/storage/                 프로젝트 영속화 경계
crates/cnc-render-contracts/      Rust 계약·검증·semantic hash
design/tokens/                    라이트모드 디자인 토큰 단일 출처
docs/                             용어집과 아키텍처 결정 기록
tests/                            공용 fixture와 단위·계약·parity 검증
```

책임이 생기기 전 빈 디렉터리를 선제적으로 만들지 않습니다.

## 핵심 불변식

- UI는 라이트모드 전용입니다. 다크 토큰, 테마 토글과 시스템 테마 자동 반영을
  추가하지 않습니다.
- React는 UI 셸만 담당합니다. 시뮬레이션 프레임마다 전체 UI 상태를 갱신하지
  않습니다.
- 복셀, 덱셀, SDF와 대형 `TypedArray`는 Worker, WASM 또는 GPU 메모리에
  두며 UI Store에 저장하지 않습니다.
- 모든 영속 물리량은 이름에 `Mm`, `Rad`, `Rpm`, `MmPerMin`,
  `MmPerRev`, `MmPerTooth`처럼 단위를 포함합니다.
- 표시 단위와 반올림은 canonical 저장·계산 값과 분리합니다.
- 영속 object는 `schemaVersion`, Worker envelope는 `protocolVersion`을
  명시하며 알 수 없는 필드는 거부합니다.
- G-code parser, Toolpath IR, 운동학, 충돌, 재료 제거와 렌더링의 모듈 경계를
  유지합니다.
- Rapier를 절삭 재료 제거 엔진으로 사용하지 않습니다.
- 같은 입력·버전·설정·시드의 결과는 결정론적으로 재현되어야 합니다.
- CNC Render 결과에는 E1/E2/S1/S2 정확도 등급과 근사 한계를 노출합니다.
- 제품은 산업용 검증 도구 또는 실제 CNC 장비 제어기로 표현하지 않습니다.

## 프로젝트 형식과 계약

프로젝트 교환 형식은 ZIP 기반 `.cncrender`이며 미디어 타입은
`application/vnd.cnc-render.project+zip`입니다. 현재 프로젝트 schema와
Worker protocol version은 모두 `1`입니다. 가져온 프로젝트는 신뢰할 수 없는
데이터로 보고 구조·수치·참조를 검증합니다.

- [Project JSON Schema](packages/contracts/schemas/project.schema.json)
- [Worker JSON Schema](packages/contracts/schemas/worker.schema.json)
- [프로젝트 컨테이너 ADR](docs/architecture-decisions/0002-project-container-format.md)
- [M1 도메인·Worker 계약 ADR](docs/architecture-decisions/0003-domain-contracts.md)

## 문서

- [CNC 표준 용어집](docs/terminology.md)
- [저장소 경계 ADR](docs/architecture-decisions/0001-repository-boundaries.md)
- [기술 백서](docs/technical-whitepaper.md)
- [디자인 백서](docs/design-whitepaper.md)
- [QA 작업 하네스](docs/qa-harness.md)

## 다음 마일스톤

M2는 고정된 `ToolpathIR` 계약 위에서 G-code lexer, parser, modal state와
정규화된 Toolpath 생성을 구현합니다. 실제 시뮬레이션과 3D 작업실은 각 후속
마일스톤의 검증 기준을 통과한 뒤 연결합니다.
