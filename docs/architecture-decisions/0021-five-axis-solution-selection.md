# ADR 0021 — M13 다해 후보·비용 기반 결정론적 해 선택

- 상태: bounded 후보/비용 선택 구현·검증 완료, M13 전체 완료 아님
- 날짜: 2026-09-24
- 참조: ADR 0019/0020, 기술 백서 §4.5.3, QA harness M13 DoD 3

후속: 표본 기반 특이점/자세 급변 진단과 비실행형 rewind 계획은 ADR 0022를 참조한다.
기존 비용 정책과 이 문서의 선택기 범위는 변경하지 않는다.

## 탐색 범위와 계약

`FiveAxisSolutionSelector.select(target, reference, weights)`는 기존 FK/국소 IK 위의
별도 모듈이다. 플러그인·목표·참조 상태는 기존 엄격한 schema로 검증하고 복제한다.
정규 단위는 mm/rad이며 비용만 무차원이다. 입력 배열은 UUID 오름차순으로 정렬한다.
기존 Worker/project schema나 WASM ABI, UI 실행 경로는 변경하지 않는다.

고정된 시작 자세 27개에 ADR 0020의 국소 IK를 실행한다.

1. seed 0: 직전/참조 자세.
2. seed 1: 모든 축 home.
3. seed 2–26: 선형축 home, UUID 순 두 회전축 각각 min·25%·50%·75%·max의
   5×5 grid. 첫 회전축이 바깥 loop다. 양 끝은 정확한 inclusive 한계로 지정한다.

유한 travel 차가 표현되지 않으면 탐색 전 `numeric-range-unsupported`로 실패한다.
각 국소 IK의 80회·12 backtrack 예산을 유지한다. 후보는 엄격한 travel 검증과
IK→FK 위치 <=1e-9 mm·방향 <=1e-9 rad 검증을 통과한 해만 사용한다.
모든 축 차가 선형 <=1e-6 mm·회전 <=1e-8 rad이면 같은 수치 해로 합치며
먼저 도착한 seed의 해를 남긴다. 이는 기존 parity 축 비교 기준이며 pose 오차
gate를 완화하지 않는다. modulo/자동 rewind는 하지 않아 다른 winding을 합치지 않는다.

이는 **발견한 유효 후보 중 최소 비용** 선택이다. 모든 branch/winding/연속 해의
완전 열거, 전역 최적, 모든 도달 가능한 목표의 수렴은 보증하지 않는다.
`no-candidate-found`는 이 예산에서 못 찾았다는 뜻이지 전역 도달 불가가 아니다.

## 비용 정책 version 1

각 축의 구간 길이를 `s=max-min`, 선택값을 `q`, 참조값을 `r`로 둔다.

- 축 이동량: 5축의 `((q-r)/s)^2` 평균. 회전축도 실제 unwrapped 차를 쓴다.
- 한계 페널티: 5축의 `(1-2*min(q-min,max-q)/s)^2` 평균.
  가운데에서 0, 한계에서 1이며 단위가 다른 축을 구간으로 정규화한다.
- 특이점 위험: 회전축 ±1e-5 rad(한계에서 clipped)의 3×2 공구 방향 Jacobian
  최소 특이값을 `sigmaMin`이라 할 때 `1-clamp(sigmaMin,0,1)`.
  수치 소거를 피하려고 두 열의 cross norm / sqrt(최대 고유값)으로 구한다.
  최대 고유값 <=1e-20이면 sigmaMin=0이다. 표현 불가능/비유한 비용 후보는
  `cost-unavailable`로 제외한다. 이것은 자세별 방향 Jacobian 위험 지표이며
  위치 Jacobian·동역학·연속 경로의 특이점 안전 인증이 아니다.

세 성분을 [0,1]로 제한한 뒤 `floor(value*100000000+0.5)`로 정수화한다.
`SolutionWeights`는 axisTravel/limitPenalty/singularityRisk 각각 0–1000 정수,
하나 이상 양수이며 기본값은 **10/1/2**다. 각 정수 성분×가중치의 합이 totalUnits다.
최대 합 300000000000은 JavaScript 정확한 정수 범위 안이다. 비용 해상도 1e-8은
순위 정책일 뿐 mm/rad pose 허용치나 FK/IK 계산의 반올림이 아니다.
비용 동률이면 작은 sourceSeedIndex가 이긴다. 런타임 시계/난수/입력 배열 순서에
의존하지 않는다. 정책/탐색/가중치가 바뀌면 결과도 바뀔 수 있으므로 policyVersion=1을 반환한다.

결과는 순위가 매겨진 후보·각 비용 성분·selectedSeedIndex·attemptedSeeds·
실패 seed와 코드다. 후보가 없으면 selectedSeedIndex=null, candidates=[]다.
TCP 비활성은 `tcp-disabled`이며 탐색하지 않는다. 잘못된 입력은 검증 오류다.

## 안전 및 연결 제한

기술 백서의 충돌 위험 비용은 아직 구현하지 않았다. 모든 결과에
**collisionEvaluation="not-evaluated"**를 반환하며 충돌 비용 0 또는 안전한 해로
표현하지 않는다. 향후 5축 충돌 모듈에서 별도 feasibility/risk를 연결해야 한다.
백서의 orientationDiscontinuity 항목도 연속 경로 진단과 함께 후속 구현한다.
특이점 경고·rewind·급격한 자세 변화 진단(M13 DoD 4), 5축 충돌·재료 제거·lesson,
G-code/Worker/WASM/UI 연결은 이 단위가 아니다. 현재 선택기를 장비 제어에 사용하지 않는다.

Rust `simulation-cli`의 `five-axis-select`는 plugin/target/reference/선택적 weights와
repetitions(1–100)를 받고 `{stable,result}`를 반환하는 native 검증 전용 경로다.
TypeScript와 Rust는 같은 정책을 독립 구현한다. 임계값 부근에서는 부동소수점의
미세한 차이로 국소 수렴 경로가 갈릴 수 있으므로 모든 가능한 입력의 언어 간 bit 동등성을
보증하지 않는다. 검증 fixture에서는 후보·순위·정수 비용·선택까지 정확히 비교하고,
각 후보의 최종 pose에는 원래의 엄격한 오차 gate를 적용한다.

## 검증

- 세 구조의 다해 후보·정렬·비용 합·입력 비변경·배열 순서 독립성.
- TT 독립 해석 두 branch `(A,C)`와 `(-A,C-π)`, 기존 Golden 목표 19개.
- HH 연속 해에서 이동량/한계 가중치에 따른 선택 변경 및 특이점 비용 동률 처리.
- TT pole/regular 자세의 Jacobian 위험, 비대칭 travel grid의 inclusive 끝점.
- 고정 seed 0x13002421로 세 구조×12 목표의 변경된 참조 자세에서 native parity.
- 가중치별 native 100회 반복과 별도 프로세스 재현성, 실패·잘못된 계약·예산 상한.

2026-09-24: 신규 unit 10/parity 5, 전체 verify(unit 400/contracts 94/parity 87),
WASM/프로덕션 빌드와 Rust fmt/clippy/workspace test 통과. 상세 결과와
기준 장비 증거 지문 불일치 실패는 PROGRESS.md에 기록했다. 기존 실장비 성능 증거는
새 런타임 소스 지문으로 재측정하기 전 릴리스 증거로 재사용하지 않는다.
