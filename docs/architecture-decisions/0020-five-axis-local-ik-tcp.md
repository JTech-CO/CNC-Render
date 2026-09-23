# ADR 0020 — M13 국소 IK·TCP 및 왕복 검증

- 상태: 국소 IK/TCP·왕복 검증 완료, M13 전체 완료 아님
- 날짜: 2026-09-24
- 참조: ADR 0019, 기술 백서 §4.5.3, QA harness M13 DoD 2

후속: ADR 0021에서 이 국소 solver 위의 bounded 다해 후보/비용 선택을 구현했다.
아래 내용은 국소 IK/TCP 단위의 범위와 당시 후속 과제를 보존한다.

## 범위

세 구조(Table-Table, Head-Table, Head-Head)의 기존 generic FK를 재사용한다.
`FiveAxisTarget`은 공작물 좌표계의 `tcpPositionMm`와 끝점→홀더 방향
`toolAxisUnit`이다. roll은 지정하지 않는다. 방향은 유한 unit vector인지
검증한 뒤 계산에서 정규화한다. 기존 project/Worker schema 1은 변경하지 않는다.

`FiveAxisInverseKinematics.inverse(target, seed)`는 명시적인 seed 주변의
국소 해 하나를 찾는다. seed는 전체 축 상태·플러그인 식별자·버전·모드·TCP
활성 상태를 포함하며 기존 상태 schema로 검증한다. 축은 UUID 오름차순으로
정렬하여 입력 배열 순서가 미분 순서나 결과 직렬화를 바꾸지 않게 한다.

다해 열거/전역 탐색/축 이동량·한계·특이점 비용 기반 최적 선택은 다음 단위다.
같은 seed의 결정론적 결과는 지원하지만 모든 seed에서 모든 도달 가능한
목표에 수렴한다고 보증하지 않는다. 반대 방향 정지점이나 회전축 한계에서
수렴하지 않을 수 있다. 이때 도달 불가능으로 확정하거나 근사 pose를 반환하지 않는다.

## 알고리즘과 고정 예산

선형축은 방향을 바꾸지 않으며, 회전축이 고정되면 끝점 위치는 선형축에 대한
affine 함수다. 따라서 mm와 rad를 하나의 무차원 비용에 섞지 않고 두 단계로 푼다.

1. 두 회전축 방향의 잔차를 3차원 방향 벡터 차로 계산한다.
2. 회전축 ±1e-5 rad 유한차분(한계에서 구간을 잘라 one-sided 포함)으로
   3×2 Jacobian을 구한다. `(JᵀJ + 1e-8 I) Δq = Jᵀr`을 푼다.
3. 한 번의 최대 회전량은 0.35 rad다. 최대 12회 반감 line search에서 방향
   잔차 제곱합이 엄격히 줄어들 때만 진행한다. 회전축은 한계 안으로 제한하며
   modulo나 자동 rewind를 적용하지 않는다. 최대 80회에서 중단한다.
4. 내부 방향 수렴은 <=1e-12 rad다. 초기 <=1e-9 rad 구현에서 남은 각도 오차가
   선형축 travel 경계의 위치 보정에 증폭되는 회귀를 발견하여 더 엄격하게 했다.
5. 회전축을 고정하고 모든 선형축을 home에 놓은 FK를 기준으로 최대 1 mm
   probe(좁은 travel에서는 가용 구간)를 적용해 3×3 위치 계수 행렬을 계산한다.
   partial-pivot Gaussian elimination을 사용하며 pivot <1e-10이면 거부한다.
   probe가 표현 불가능하거나 선형축이 독립적이지 않아도 성공을 만들어내지 않는다.
6. 계산한 축 값이 travel을 1e-9 mm 넘게 벗어나면 `linear-limit`이다.
   그 이내의 부동소수점 잔차만 inclusive 경계로 투영하며, 반환 상태는 기존의
   엄격한 축 한계 검증과 최종 FK 잔차 검증을 다시 통과해야 한다.

성공 판정은 최종 IK→FK 위치 Euclidean 오차 <=1e-9 mm,
방향 `atan2(|actual×target|, actual·target)` <=1e-9 rad다.
이는 수치 검증이며 실제 장비·가공 S1 정확도 인증이 아니다. 임계치를 호출자가
완화하는 옵션은 제공하지 않는다. 입력/플러그인은 변경하지 않고 결과에 새 상태를 반환한다.

## TCP 끝점 보정

`compensateTcp(reference, commanded)`는 reference의 공작물 기준 끝점을
유지하면서 commanded의 회전축 자세를 채택한다. 해당 회전축을 고정한 채 위의
선형축 보정만 계산한다. commanded의 선형축 값은 유효성만 검증하며 보정 계산에서
새로 구한다. 회전축 값 자체는 변경하지 않는다. 모드 변경은 거부한다.

두 API 모두 TCP 지원 capability와 활성 상태를 요구한다. FK만 계산하는 API는
기존처럼 TCP 비활성 상태도 허용한다. 3plus2와 simultaneous-5axis의 discrete
pose 보정을 각각 검사하지만 경로 보간·인덱스 중 절삭 차단·충돌 안전은 아직 아니다.
공구 길이는 현재 `toolMount`의 유효 끝점 offset으로 보정하며 공구 교체 이벤트는
연결하지 않았다.

home의 끝점 (0,0,-220) mm를 유지하며 A=π/2, C=0으로 바꿀 때 독립 기대값은
TT의 XYZ=(0,+220,+220) mm, HT/HH의 XYZ=(0,-220,-220) mm다.
기존 FK Golden의 피벗과 장착 offset에서 손계산하며 solver 출력으로 생성하지 않았다.

## 실패와 실행 경계

- 구조/단위/비유한 목표/미지원 모드 등의 입력 오류: 기존 검증 예외/오류.
- `tcp-disabled`: 활성화되지 않은 TCP 호출.
- `orientation-not-converged`: 국소 반복/line search 종료. 전역 도달 불가가 아님.
- `linear-singular`: 선형 위치 계수 행렬이 수치적으로 풀리지 않음.
  회전축 특이점 검출 기능이 구현되었다는 뜻이 아니다.
- `linear-limit`: 계산된 선형축 해가 travel 밖임. 다른 IK branch의 존재를 배제하지 않는다.
- `nonfinite`: 내부 overflow/퇴화 계산 실패.
- `residual-exceeded`: 반환 후보의 최종 FK 검증 실패.

실패에는 pose·축 해를 포함하지 않는다. UI나 Worker에 NaN/Infinity를 넘기지 않는다.
Rust `simulation-cli`의 `five-axis-inverse`는 ik/tcp 작업을 받아 결과와 반복
직렬화 안정성을 반환한다. 요청당 1–1024개 작업, 반복 1–100회, 작업×반복
<=10000으로 제한한다. 이 CLI는 native 검증 경로이며 WASM/Worker ABI가 아니다.

## 검증과 남은 범위

2026-09-24: 신규 unit 26·native parity 7 및 전체 verify(unit 390/contracts 94/
parity 82)·빌드·Rust fmt/clippy/workspace test 통과. 결과는 PROGRESS.md에도 기록한다.

- 기존 독립 Golden 목표 19개에서 seed의 회전축을 0.13 rad 변경한 뒤 IK→FK 왕복.
- seed 0x13002410, 구조별 100개(총 300개)의 다른 축 상태에서 국소 IK 왕복.
  HH에는 기울어진 공구축 (0.6,0,0.8)을 사용하여 C축도 방향에 기여하게 한다.
- 두 언어 각각 위의 엄격한 FK 잔차 gate를 통과해야 한다. 동일 seed의 branch
  회귀에서 두 언어 축 값은 <=1e-6 mm/1e-8 rad 이내도 검사한다. 이 축 값 비교
  허용치는 최종 목표 pose 오차의 대체 기준으로 쓰지 않는다.
- 독립 TCP 보정 세 사례, 두 모드×세 구조×5개 회전 명령, 선형축 min/max 6개.
- Rust 반복/별도 프로세스 및 TypeScript 반복·입력 비변경·배열 재배열 재현성.
- 실패 상태/잘못된 입력/capability와 요청 예산을 검사한다.

다해 비용 기반 선택, 회전 특이점/rewind, 5축 충돌·희소 복셀 제거·lesson,
G-code 회전축 IR 및 Worker/WASM/UI 연결은 미완료다. 실장비 성능 증거도
새 소스 지문으로 재측정해야 하며 기존 M12 증거와 승인된 P2는 보존한다.

```sh
pnpm test:unit --filter kinematics-5axis-inverse
pnpm test:parity --filter fk-ik-inverse
pnpm verify
node scripts/run-cargo.mjs fmt --all -- --check
node scripts/run-cargo.mjs clippy --workspace --all-targets --locked -- -D warnings
pnpm cargo:test
```
