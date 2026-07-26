# CNC Render Progress

- Current phase: M1 — 도메인 스키마·단위·Worker 메시지 계약
- Status: complete
- Last completed: TypeScript·JSON Schema·Rust 도메인 및 Worker 계약 parity
- Next task: M2 — G-code lexer·parser·modal state·Toolpath IR 생성
- Open questions: M2 dialect 우선순위는 M2 진입 시 백서 기준으로 확정
- Known regressions: 없음

## M1 validation run

2026-07-27에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`로 실행했다.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | 통과 — 7 workspace projects |
| `pnpm test:contracts` | 통과 — 10 files, 39 tests |
| `pnpm test:parity --filter schema` | 통과 — 2 files, 6 tests |
| `pnpm test:unit --filter units` | 통과 — 2 files, 6 tests |
| `pnpm cargo:check` | 통과 — workspace all targets, locked |
| `pnpm cargo:test` | 통과 — M1 contracts 33 tests와 M0 foundation 1 test |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy -p cnc-render-contracts --all-targets --locked -- -D warnings` | 통과 |
| `pnpm verify` | 통과 — lint, typecheck, Cargo check, unit 8, contract 39, parity 6, forbidden UI, production build |
| `pnpm check:boundaries` | 통과 — 17 modules, 33 dependencies, violation 0 |

## Delivered contracts

- `@cnc-render/contracts`
  - strict Zod schema와 draft 2020-12 Project·Worker JSON Schema
  - explicit-unit 값 객체와 mm↔inch, degree↔radian, rpm↔rev/s,
    feed 단위 golden conversion
  - Project 참조·전역 ID·축 그래프·Toolpath·resource semantic validator
  - Worker protocol version, reply correlation, monotonic sequence와 dispose
    stale barrier
  - UI Store의 대형 binary state 금지 계약
- `cnc-render-contracts`
  - 동일 wire object의 serde `deny_unknown_fields` 타입
  - nullable key presence, UUID, UTC, 수치, 참조와 Worker 상태의 동일 검증
  - RFC 8785/JCS canonical JSON과 SHA-256 semantic parity
- 공용 fixture
  - 유효·무효 프로젝트, Worker messages, unit golden cases
  - TypeScript와 Rust가 공유하는 `valid-project.sha256`
- 생성 artifact
  - `packages/contracts/schemas/project.schema.json`
  - `packages/contracts/schemas/worker.schema.json`

## Environment notes

- 로컬 Windows Rust 실행 검증을 위해 Visual Studio Build Tools 2022의 MSVC
  x64 toolchain을 설치했다.
- `scripts/run-cargo.mjs`는 Windows에서 `VsDevCmd.bat`를 탐지해 PATH, LIB,
  INCLUDE 환경을 자식 Cargo 프로세스에만 적용한다. Linux CI 동작은 그대로다.
- 프로젝트가 고정한 Node `24.18.0`은 격리된 `C:\tmp` 도구 경로에서 실행해
  시스템 Node와 섞이지 않도록 했다.
- M1은 UI 변경 마일스톤이 아니므로 브라우저·visual regression 검증은
  수행하지 않았다. production build와 기존 rendered HTML 계약은 유지된다.

## Decision log

| Date | Decision | Reason | Affected files |
|---|---|---|---|
| 2026-07-26 | 루트 `vinext` 스캐폴드는 배포 adapter로 유지하고 `apps/web`을 애플리케이션 composition root로 사용한다. | 초기 Cloudflare adapter 계약을 보존하면서 UI, simulation, renderer, storage의 조립 책임을 한곳에 둔다. | `app/`, `worker/`, `apps/web/`, `docs/architecture-decisions/0001-repository-boundaries.md` |
| 2026-07-26 | Node `24.18.0`, pnpm `11.5.3`, Rust `1.97.1`을 로컬 도구 파일과 CI에 정확히 고정한다. | 개발 환경과 CI의 재현성을 유지한다. | `.tool-versions`, `rust-toolchain.toml`, `.github/workflows/ci.yml` |
| 2026-07-26 | 프로젝트 형식은 `.cncrender` ZIP 컨테이너, MIME `application/vnd.cnc-render.project+zip`, schema ID `urn:cnc-render:schema:project:1`, `schemaVersion` 정수 `1`을 사용한다. | 제품명과 저장 형식을 통일하고 명확한 버전·전송 경계를 제공한다. | `docs/architecture-decisions/0002-project-container-format.md`, `.gitattributes` |
| 2026-07-27 | TypeScript와 Rust 계약은 strict UUID·UTC·nullable·단위 규칙과 RFC 8785 semantic hash를 공유한다. | 파서·Worker·저장 구현 전에 wire 의미와 실패 규칙을 고정한다. | `packages/contracts/`, `crates/cnc-render-contracts/`, `docs/architecture-decisions/0003-domain-contracts.md` |
| 2026-07-27 | Worker command는 명시적 null `replyTo`, ready와 project result는 검증 가능한 reply UUID를 사용하고 `run.dispose`는 one-way stale barrier로 둔다. | 메시지 상관관계와 이전 run 이벤트 유입을 M1 계약 수준에서 차단한다. | `packages/contracts/src/worker.ts`, `crates/cnc-render-contracts/src/worker.rs` |
