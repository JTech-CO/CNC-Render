# CNC Render Progress

- Current phase: M0 — 저장소 기반·문서 정합성
- Status: complete
- Last completed: 모노레포·문서·도구 체인·CI 골격과 배포 가능한 M0 화면 검증
- Next task: M1 — 도메인 스키마·단위·Worker 메시지 계약
- Open questions: M0 범위에는 없음
- Known regressions: 없음

## Validation run

2026-07-26에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust `1.97.1`로 실행했다.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | 통과 |
| `pnpm verify` | 통과 — lint, typecheck, Cargo check, unit 2개, contract 6개, 금지 UI 검사, production build |
| `pnpm exec dependency-cruiser --config dependency-cruiser.config.cjs apps packages crates` | 통과 — 5 modules, 4 dependencies, violation 0 |
| 레거시 제품명·확장자·테마 표현 검색 | 통과 — 일치 0 |
| `node --test tests/rendered-html.test.mjs` | 통과 — 3개 |
| 로컬 HTTP smoke test | 통과 — `/`, 절대 소셜 이미지 메타데이터, `/og.png` 모두 정상 |

## Environment notes

- 현재 Codex 세션의 인앱 브라우저 브리지가 Windows 샌드박스 ACL 오류로 연결되지 않아, 브라우저 클릭 검증 대신 production render 테스트와 로컬 HTTP smoke test를 실행했다.
- 로컬 Windows 환경에는 MSVC `link.exe`가 없어 `cargo test` 링크 단계는 실행할 수 없다. M0 필수 게이트인 `cargo check --workspace --all-targets --locked`는 통과했으며, Rust 실행 테스트가 시작되는 M1부터 CI의 완전한 툴체인을 기준으로 검증한다.

## Decision log

| Date | Decision | Reason | Affected files |
|---|---|---|---|
| 2026-07-26 | 루트 `vinext` 스캐폴드는 배포 adapter로 유지하고 `apps/web`을 애플리케이션 composition root로 사용한다. | 초기 Sites·Cloudflare 배포 계약을 보존하면서 UI, simulation, renderer, storage의 조립 책임을 한곳에 둔다. | `app/`, `worker/`, `apps/web/`, `docs/architecture-decisions/0001-repository-boundaries.md` |
| 2026-07-26 | Node `24.18.0`, pnpm `11.5.3`, Rust `1.97.1`을 로컬 도구 파일과 CI에 정확히 고정한다. | LTS Node를 기준으로 개발 환경과 CI의 재현성을 유지하고, 비 LTS 런타임에서 관찰된 pnpm 프로세스 불안정을 제거한다. | `.tool-versions`, `rust-toolchain.toml`, `.github/workflows/ci.yml` |
| 2026-07-26 | pnpm 의존성 설치 스크립트는 네 패키지만 `allowBuilds`로 허용한다. | 설치 시 실행 가능한 제3자 코드를 명시적으로 검토·제한한다. | `pnpm-workspace.yaml` |
| 2026-07-26 | 프로젝트 형식은 `.cncrender` ZIP 컨테이너, MIME `application/vnd.cnc-render.project+zip`, 잠정 schema ID `urn:cnc-render:schema:project:1`, `schemaVersion` 정수 `1`을 사용한다. | 제품명과 저장 형식을 통일하고 M1 스키마 구현 전에도 명확한 버전·전송 경계를 제공한다. | `docs/architecture-decisions/0002-project-container-format.md`, `.gitattributes` |
| 2026-07-26 | M0 공개 화면은 밝은 교육용 기술 시각 체계와 정적 VMC 개념만 제공한다. | 아직 구현되지 않은 가공 시뮬레이션을 오인시키지 않으면서 다음 마일스톤의 계약 경계를 설명한다. | `app/`, `design/tokens/cnc-render.tokens.json`, `public/og.png` |
