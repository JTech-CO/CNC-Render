# ADR 0012 — 공개 릴리스 식별자와 Pages 스타일 진입점

- 상태: 승인
- 날짜: 2026-08-09

## 배경

GitHub Pages용 Vite 엔트리는 Vinext 애플리케이션의 `app/layout.tsx`를
통과하지 않는다. 그 결과 Pages HTML에는 `app/globals.css`만 포함되고
디자인 토큰과 공용 프리미티브 CSS가 누락되어, 공개 배포에서 레이아웃이
브라우저 기본 스타일로 무너지고 버튼의 클릭 영역도 예측할 수 없게 됐다.

저장소의 JavaScript package, Rust crate, Worker/WASM handshake, 저장 엔진과
공개 UI가 서로 다른 숫자를 사용했고, 계획용 마일스톤 번호도 제품 버전처럼
노출됐다. 병합된 작업 브랜치가 원격에 계속 남아 기준 브랜치도 불분명했다.

## 결정

1. `main`을 유일한 장기 브랜치이자 GitHub Pages 배포 기준으로 사용한다.
   작업 브랜치는 최신 `main`에서 `codex/<scope>`로 만들고 한 Pull
   Request 병합 뒤 로컬과 원격에서 삭제한다.
2. 루트 `package.json`의 SemVer를 제품과 엔진 버전의 단일 출처로 사용한다.
   모든 JavaScript workspace package와 Rust workspace crate, 브라우저 UI,
   Worker handshake, WASM core, 저장 엔진은 같은 버전을 사용한다.
3. 프로젝트 `schemaVersion`과 Worker `protocolVersion`은 제품 SemVer와
   독립된 정수 호환성 계약으로 유지한다.
4. Pages HTML은 `/styles/tokens.css`와 `/styles/primitives.css`를
   명시적으로 로드한다. 두 파일은 권위 원본에서 생성하며
   `check:pages-styles`가 byte 단위 drift를 차단한다.
5. Pages build는 스타일, 앱 chunk, 전용 Worker와 WASM 산출물을 모두
   검증한다. CI는 실제 `/CNC-Render/` base path를 제공하는 Chromium
   E2E에서 계산된 스타일, 도움말·작업 영역 클릭과 절삭 완료를 확인한다.
6. 공개 UI와 사용자용 README에는 제품 SemVer, Preview 상태와 E1/E2/S1/S2
   정확도만 표시한다. 계획용 마일스톤과 Definition of Done은
   `PROGRESS.md` 및 ADR에만 기록한다.

## 대안 검토

- Pages 엔트리에서 `app/layout.tsx`를 재사용하는 방식은 Vinext/RSC와 순수
  Vite 정적 엔트리의 실행 모델을 다시 결합하므로 선택하지 않았다.
- 각 package와 crate가 독립 버전을 갖는 방식은 현재 단일 제품 배포에서
  사용자와 런타임 handshake의 식별자를 더 모호하게 하므로 선택하지 않았다.
- 마일스톤 번호를 제품 버전으로 사용하는 방식은 계획 순서와 호환성 의미를
  혼합하므로 선택하지 않았다.

## 결과와 제약

- 공개 배포 경로와 개발 앱이 같은 토큰·프리미티브 원본을 사용한다.
- 새 스타일 원본을 추가할 때 Pages 생성 목록도 명시적으로 갱신해야 한다.
- `pnpm check:versions`, `pnpm check:pages-styles`, `pnpm test:pages`가
  릴리스 회귀를 차단한다.
- 이미 병합된 원격 작업 브랜치는 외부 상태 변경 승인을 받은 뒤 별도로
  삭제해야 한다.
