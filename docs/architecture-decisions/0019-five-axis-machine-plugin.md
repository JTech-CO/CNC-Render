# ADR 0019 — M13 머신 플러그인 계약

- 상태: 첫 검증 단위 구현, M13 전체 DoD 미완료
- 날짜: 2026-09-24
- 참조: 기술 백서 §2.3.D·§4.5.3·§8 Phase 3·§9.3, QA harness M13, ADR 0006

## 범위와 경계

`MachinePluginSchema`는 실행 코드가 아닌 버전 고정 데이터 계약이다.
기존 `MachineDefinitionSchema`와 linear/rotary axis를 재사용한다. renderer,
React, Worker 및 Rust 계산 모듈에 의존하지 않는다. M4의 3축 계산기를
5축 입력에 적용하거나 rotary 축을 무시하지 않는다.

기존 프로젝트/Worker schema 1은 변경하지 않는다. 플러그인 계약은 별도의
`contractVersion: 1`, `pluginId`, `pluginVersion`으로 식별한다. 아직 프로젝트
파일에 저장하거나 Worker로 실행할 수 없으며 URL/스크립트 실행 필드는 거부한다.

## 구조와 좌표

- 정확히 선형 3축 + 회전 2축의 machining center만 받는다.
- 기계의 고정 base를 공통 좌표계로 사용한다. 공구와 공작물 attachment는 각각
  root→leaf chain이다. 빈 chain은 base에 고정됨을 뜻한다.
- 두 chain은 서로 겹치지 않고 모든 축을 정확히 한 번 포함한다. 공유 이동축,
  폐루프 및 추가 분기는 이 계약 버전에서 지원하지 않는다.
- Table-Table / Head-Table / Head-Head는 공구 chain의 회전축이 각각 0/1/2개다.
- 축의 direction/pivot은 parent frame에서 정의한다. root는 base frame이다.
  home에서 상대 변위 0이며 선형축은 `positionMm - homeMm`, 회전축은
  `positionRad - homeRad`이다. 오른손 좌표계·오른손 양의 회전을 사용한다.
- 후속 FK에서 선형 변환은 T(direction × displacement), 회전 변환은
  T(pivot) × R(direction, angle) × T(-pivot)이다. column vector를 사용해
  root부터 곱한다. 고정 장착 변환은 마지막 축 뒤에 적용한다.
- `toolMount.positionMm`는 현재 공구 끝점의 leaf-local 위치,
  `toolAxisUnit`은 공구 끝에서 홀더 쪽으로 향하는 단위 벡터다.
  공구 교체 시 장착 길이 보정이 필요하며 별도 spin 각도는 지정하지 않는다.
- `workpieceMount`는 공작물 좌표계의 leaf-local 변환이며 rotation은
  Rz(zRad) × Ry(yRad) × Rx(xRad), position은 mm다.
- 후속 FK의 공작물 기준 공구 pose는 inverse(base→workpiece) × (base→tool)다.
  이번 단위에서는 해당 계산이나 Golden Pose 통과를 주장하지 않는다.

## 상태 검증

`createMachinePluginStateSchema`는 입력을 검증·복사하여 외부 변경과 분리한다.
정확한 plugin/version/machine에 바인딩하고 모든 축을 한 번씩 요구한다.
선형 값은 positionMm, 회전 값은 positionRad만 허용한다. 회전각을 암묵적으로
modulo 처리하지 않아 회전 한계나 이후 rewind 필요성을 숨기지 않는다.
여기서는 min/max inclusive를 엄격히 검증한다. FK/IK 오차 허용치와 달리
입력 여행 한계에는 별도 epsilon을 적용하지 않는다.

3plus2와 simultaneous-5axis 모드는 구분되며 TCP 지원과 활성화 상태도
분리한다. fixture의 supported는 계약 테스트 데이터일 뿐 앱의 실행 기능
선언이 아니다. capability만으로 S1 정확도나 충돌 안전을 인증하지 않는다.
향후 실행기는 구현된 solver registry와 대조해 미지원 플러그인을 거부해야 한다.

## 검증 및 후속 단위

세 구조의 계약 fixture, 100회 canonical JSON 왕복, 단위·경계·유한값·연결·
버전·capability의 잘못된 입력을 검증한다. WebGPU/WebGL 2 모두 동일한
데이터 계약을 사용하며 이번 단위에는 렌더러별 신규 기능이 없다.

다음은 회전축 FK와 독립적으로 계산한 세 구조 Golden Pose, Rust/TypeScript
parity다. 이후 IK/TCP/결정론적 해 선택/특이점·rewind/5축 충돌/희소 복셀
제거/블레이드 또는 임펠러 S1 lesson을 차례로 구현한다. 제거 체적·잔삭의
Precision 허용 기준은 해당 단위에서 승인·고정해야 하며 임의로 만들지 않는다.

소스 지문이 바뀌었으므로 M12 기준 장비 증거는 이전 릴리스의 기록으로
보존한다. 새 릴리스 전 기준 장비 재측정이 필요하며 게이트를 완화하지 않는다.

```sh
pnpm test:contracts --filter machine-plugin
pnpm test:contracts
pnpm test:unit
pnpm typecheck
pnpm lint
```
