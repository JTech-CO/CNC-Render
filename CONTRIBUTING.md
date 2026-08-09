# CNC Render에 기여하기

## 브랜치 수명 주기

- `main`은 유일한 장기 브랜치이자 GitHub Pages 배포 기준입니다.
- 작업은 최신 `main`에서 `codex/<scope>` 형식의 짧은 브랜치를 만듭니다.
- 한 브랜치는 한 가지 검증 가능한 변경과 한 개의 Pull Request만 담당합니다.
- 필수 CI가 모두 통과한 뒤 `main`에 병합합니다.
- 병합한 브랜치는 로컬과 원격에서 삭제하고 다음 작업에 재사용하지 않습니다.
- 긴급 수정도 같은 흐름을 사용하며 `main`에 직접 커밋하지 않습니다.

## 버전 정책

- 루트 `package.json`의 SemVer가 제품과 엔진 버전의 단일 출처입니다.
- 모든 JavaScript workspace package와 Rust workspace crate는 같은 버전을
  사용합니다.
- 브라우저 UI, Worker handshake, WASM core와 저장 엔진 표기도 공용
  `PRODUCT_VERSION` 또는 `ENGINE_VERSION` 상수를 사용합니다.
- `schemaVersion`과 `protocolVersion`은 제품 SemVer와 독립된 정수
  계약입니다. 호환성이 깨질 때만 각각 올립니다.
- 릴리스 태그는 검증을 통과한 `main`에서 `vX.Y.Z` 형식으로 만듭니다.
- 계획용 마일스톤 번호는 `PROGRESS.md`와 ADR에만 기록하고 공개 제품 UI나
  사용자용 README의 버전으로 사용하지 않습니다.

버전 일치는 다음 명령으로 검사합니다.

```bash
pnpm check:versions
```

## 개발 흐름

고정 도구 체인은 Node.js 24.18.0, pnpm 11.5.3, Rust 1.97.1입니다.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
pnpm test:pages
```

변경 범위에 필요한 단위·계약·E2E 테스트를 추가하고, 전체 표준 게이트가
통과한 범위만 완료로 기록합니다. 생성 산출물은 원본과 함께 갱신하고 테스트나
성능 기준을 완화해 통과시키지 않습니다.

## Pull Request 확인 항목

- 변경 목적과 사용자 영향을 설명했는가
- 정확도 등급과 WebGPU/WebGL 2 기능 차이를 필요한 곳에 표시했는가
- 큰 시뮬레이션 데이터가 React/Zustand 상태로 유입되지 않았는가
- `pnpm verify`와 배포 경로용 `pnpm test:pages`가 통과했는가
- `PROGRESS.md`에 검증 결과와 남은 위험을 기록했는가
- 병합 뒤 작업 브랜치를 삭제할 준비가 되었는가
