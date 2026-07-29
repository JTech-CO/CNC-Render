# CNC Render Progress

- Current phase: M2 — G-code 파서·모달 상태·Toolpath IR 생성
- Status: complete
- Last completed: Rust `common-v1` parser에서 canonical motion·Toolpath IR·source map 생성
- Next task: M3 — 렌더러·3D 작업실 셸
- Open questions: M3 진입 시 WebGPU/WebGL 2 기능 차이와 성능 budget을 하네스 기준으로 확정
- Known regressions: 없음

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
