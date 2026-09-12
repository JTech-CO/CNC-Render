# ADR 0016 — 릴리스 산출물 출처와 WASM 무결성

- 상태: 승인
- 날짜: 2026-09-12
- 범위: M12 첫 단위, QA harness DoD 11
- 참조: 기술 백서 §2.8·§7.1·§9·§11.4, 디자인 백서 §7.2–§7.8, ADR-0012

## 결정

1. GitHub Pages를 배포 대상으로 유지한다. 백서의 Cloudflare preview 계획보다
   사용자가 지정한 `JTech-CO/CNC-Render`와 ADR-0012의 `main` 배포 정책이 우선한다.
2. `pnpm build`의 `dist/client/release.json`과 `pnpm build:pages`의
   `dist/pages/release.json`을 빌드 성공 후 생성한다. 원본 `public`에는 생성하지 않는다.
3. `metadataVersion: 1`, `version`, `engineVersion`, 프로젝트 `schemaVersion`,
   `workerProtocolVersion`, 전체 40자리 `commitSha`, `sourceDirty`, `target`을 기록한다.
   제품/엔진 버전은 기존 계약 상수를 재사용하고 package.json과 불일치하면 실패한다.
4. Git의 실제 HEAD를 사용한다. PR merge checkout에서는 merge SHA가 출처다.
   `GITHUB_SHA`가 존재하면 HEAD와 정확히 일치해야 한다. Git 없는 배포와 임의 SHA
   대체는 허용하지 않는다. 로컬 미커밋 빌드는 `sourceDirty: true`로 명시한다.
5. 산출물 내부 `wasm/cnc_render_wasm.wasm`의 헤더·바이트 수·SHA-256을 검사한다.
   `pnpm check:release --target=pages|client`는 현 checkout과 실제 배포 WASM을 다시
   대조하며 누락·추가 필드, 잘못된 버전·SHA·해시·대상을 거부한다.
6. GitHub Actions 빌드와 `--require-clean` 검사는 tracked/untracked 변경이 있으면
   실패한다(ignored 빌드 출력 제외). Pages 테스트 뒤 업로드 전에 다시 검사한다.
7. 타임스탬프를 넣지 않아 같은 입력에서 JSON은 결정론적이다. 사용자명·로컬 경로·
   브랜치명·프로젝트명·모델·G-code 원문은 기록하지 않는다. UI 프레임 경로는 변경하지 않는다.
8. 실제 `/CNC-Render/release.json` HTTP 응답과 배포 WASM의 해시가 일치하는지
   Pages E2E로 검증한다. 메타데이터는 브라우저 기능과 무관하므로 두 renderer에 공통이다.

## 제약

- 이 파일은 출처 확인용이며 서명·공급망 attestation 또는 런타임 WASM 로더의
  암호학적 신뢰 검증을 대체하지 않는다. JS/CSS 전체 해시 목록은 이번 범위가 아니다.
- `sourceDirty: true`의 SHA는 기반 커밋이다. 정확히 재생 가능한 공개 릴리스라고
  취급하지 않으며 CI 게시 게이트를 통과할 수 없다.
- M11이 아직 병합 전이라 이번 M12 브랜치는 M11 HEAD에서 이어진 임시 stacked
  작업 브랜치다. PR·병합 승인 시 선행 M11 병합을 확인한 후 `main` 기준으로 정리한다.
- 로컬 Pages 검증은 공개 재배포 증거가 아니다. 성능 기준 장비·메모리·다중 브라우저·
  보안·실배포 헤더·CI 전체 매트릭스는 나머지 M12 단위에서 검증한다.

## 검증

- `pnpm test:unit --filter release-metadata`
- `pnpm verify`
- `pnpm check:release --target=client`
- `pnpm test:pages`
- `pnpm check:release --target=pages`
- 미커밋 워크트리에서 `--require-clean` 실패 확인(정상적인 게시 차단)
