# ADR 0022 — M13 특이점·자세 급변 진단과 rewind 계획

- 상태: 표본 기반 core 진단·비실행형 rewind 계획 검증 완료, M13 전체 완료 아님
- 날짜: 2026-09-24
- 참조: 기술 백서 §4.5.3, QA harness M13 DoD 4, ADR 0019–0021

## 범위와 안전 경계

`FiveAxisMotionGuard`는 기존 FK/IK/TCP 위에 독립된 전이 진단과 **실행 불가**
rewind 계획을 추가한다. TypeScript/Rust native core를 같은 정책으로 검증한다.
UI·G-code/Worker/WASM 5축 ABI·장비 제어에는 연결하지 않는다. 5축 충돌과
절삭 제거는 다음 단위이며 충돌을 평가한 것으로 표시하지 않는다.

진단에서 `clear`는 정해진 표본에서 해당 운동학 경고가 없다는 의미다.
모든 결과는 `collisionEvaluation="not-evaluated"`다. 속도/가속도·jerk·절삭
허용 여부·roll·전체 TCP Jacobian·연속 경로 안전을 인증하지 않는다.
시각/난수에 의존하지 않으며 입력을 복사하고 UUID 순으로 계산한다.
잘못된 플러그인·축 한계 밖 상태·모드/TCP 설정 변경은 기존 엄격한 계약 오류다.

## 전이 진단 policyVersion 1

`analyzeTransition(from,to)`는 **unwrapped 축 값의 선형 보간**을 검사한다.
TCP 직선 보간이나 controller 속도 프로파일이라는 뜻이 아니다. 끝점 각도만
최단각으로 줄여 큰 winding 이동이나 중간 특이점 통과를 숨기지 않는다.

| 코드 | 고정 판정 |
| --- | --- |
| axis-limit-reached | 현재 표본의 축 값이 inclusive min/max와 같음 |
| axis-limit-near | 구간 길이 대비 가까운 끝점 여유가 (0,0.01] |
| rotary-singularity | 방향 Jacobian 최소 특이값 <=1e-6 |
| rotary-near-singularity | 최소 특이값 (1e-6,0.05] |
| tool-axis-jump | 두 끝점 공구 방향각 >π/6 rad |
| rotary-axis-jump | 회전축 unwrapped 이동량 >π/2 rad |
| rewind-required | 회전축 이동량 >π rad 또는 진행 방향의 한계 여유 <=1% |
| sampling-budget-exceeded | 필요한 구간 수 >720 또는 수치 표현 불가 |
| numeric-unavailable | FK/Jacobian 또는 travel 비율을 유한 값으로 계산할 수 없음 |

rewind-required는 절삭 경로로 그대로 승인하지 말고 명시적인 rewind/재계획을
검토하라는 교육용 정책이다. 특정 기계가 실제로 한 바퀴 되감기 가능한지 또는
큰 회전 명령이 잘못되었는지를 단정하지 않는다. 한계에서 멀어지는 작은 이동에는
이 진단을 추가하지 않는다. tool-axis-jump는 시간 미분/각속도가 아닌 자세 차이다.

두 회전축 이동량 절댓값의 합을 1도(π/180 rad)로 나눈 올림값, 최소 1구간으로
분할하며 양 끝을 포함한다. 최대 720구간/721표본이고 예산 초과는 clear가 아니다.
선형축은 동일 비율로 보간한다. inclusive 끝점은 원본값 그대로 사용하며 중간
보간의 부동소수점 잔차만 입력의 travel 안에 제한한다. 임의로 축 명령을 감싸지 않는다.
표본 사이의 정확한 특이점이나 다른 보간 방식의 충돌을 모두 찾는다고 보증하지 않는다.
중간 극점 Fixture에서 끝점만 검사하면 놓치는 진단을 실제로 검증한다.

방향 Jacobian은 ADR 0021과 같은 회전 ±1e-5 rad clipped 차분과 최소 특이값
공식이다. 이는 무차원 방향/rad 미분 지표이며 기계별 산업용 임계값이 아니다.
HH에서 공구축 방향에 영향을 주지 않는 회전축도 rank 저하로 명시한다.
기계별 경고 임계값 UI나 학습된 정책은 추가하지 않는다.

각 code/axisId의 최초 표본을 남기며 진단 배열은 code/axisId 순으로 정렬한다.
sampleIndex, 유한 value 또는 null, rad/ratio/count 단위를 반환한다.
부동소수점 임계값 근처의 모든 입력에서 두 언어의 bit 동등성을 보증하지는 않는다.

## Rewind 요청과 단계

`planRewind(reference, {axisId,direction,retractDistanceMm})`:

- 알려진 회전축 하나만 지정한다. `direction`은 **다음 가공에서 진행할 방향**이며
  positive면 현재 축에서 -2π, negative면 +2π로 정확히 한 바퀴 되감는다.
- retractDistanceMm은 사용자가/호출자가 명시한 (0,500] mm다. 이는 기계의
  충돌 검증된 clearance가 아니다. 임의의 안전 높이를 가정하지 않는다.
- 양 모드(3plus2/simultaneous-5axis)와 TCP 활성 상태를 검증한다. TCP 비활성,
  한 바퀴 반대 회전이 travel 밖이거나 표현 불가능하면 명시적으로 실패한다.

계획의 모든 step은 cuttingEnabled=false이며 총 75개다.

1. stop: 원래 자세에서 절삭 중지 의도를 기록한다. 실제 제어 신호를 보내지 않는다.
2. retract: 공작물 좌표의 원래 끝점→홀더 방향으로 지정 거리 후퇴한다.
   기존 IK로 자세/축 한계를 검증한다.
3. rewind: 회전축을 5도 간격 72회에 걸쳐 한 바퀴 반대로 돌린다. 매 표본에서
   기존 TCP 보정으로 후퇴한 공작물 기준 끝점을 유지하고 XYZ 한계를 검사한다.
   다른 회전축은 그대로이며 원래 모드도 보존한다.
4. return: 한 바퀴 바뀐 회전축과 원래 선형축 값으로 복귀한다. 최종 FK가
   원래 위치 <=1e-9 mm·방향 <=1e-9 rad인지 독립 검증한다.

각 step의 자세에는 동일한 특이점/한계 진단을 붙인다. rewind 진단의 sampleIndex는
75개 step 배열 인덱스이며 최초 발생 순으로 보존한다. 이 표본들은 TCP 보정으로
계산된 자세이지 인접 축 값을 선형 보간해도 TCP가 항상 유지된다는 보증이 아니다.
이후 실행기가 TCP 경로 보간·회전 중 경로·후퇴/복귀 전 구간 충돌·속도/가속도를
검증해야 한다. 현재 모듈에는 실행 API가 없다.

성공적으로 계획해도 status=review-required, code=collision-review-required,
executionAllowed=false다. 특이점을 통과할 수 있으므로 진단을 지우거나 안전한
경로로 표현하지 않는다. retract/회전 표본의 국소 IK 실패, 축 한계, 비유한 계산,
최종 오차 초과는 status=failed이며 **부분 steps도 반환하지 않는다**.
회전 한계가 부족한 기계에서는 rewind-axis-limit로 거부하고 다른 branch나
경로 재설정은 자동으로 만들지 않는다.

## 검증 경로

Rust `five-axis-guard` CLI는 transition 또는 rewind 한 작업과 repetitions 1–100을
받아 `{stable,result}`를 반환한다. native 검증용이며 Worker/WASM ABI가 아니다.

- 정규 양 끝 사이 중간 극점, 방향 rank 저하, 선형/회전 한계, ±π winding,
  회전 한계 접근/이탈, 큰 방향 변화, 샘플 예산과 수치 실패를 검사한다.
- 세 구조×두 모드×양방향 rewind의 75개 자세, TCP 끝점 유지, 한 바퀴 후 원상 복귀.
- 기울기를 유지한 두 번째 회전축 rewind, HH의 기울어진 공구축도 검사한다.
- 독립 손계산: home와 등가인 A=+2π에서 20 mm 후퇴 후 A=3π/2일 때
  TT XYZ=(0,-200,220) mm, HT/HH=(0,220,-200) mm. 반대 방향은 Y 부호 반전.
  기존 fixture의 100 mm pivot, -120 mm tool mount, 100 mm work mount 기준이다.
- 후퇴 가능해도 중간 회전에서 선형축 한계를 넘으면 빈 실패 계획을 반환한다.
- 입력 비변경·배열 재배열·반복/별도 프로세스·Rust/TypeScript 일치.
  진단 code/axis/sampleIndex는 정확히, 수치 value는 <=1e-9로 비교한다.
  rewind의 모든 pose는 위치 <=1e-9 mm·방향 <=1e-9 rad 기준을 유지한다.

2026-09-24: 신규 unit 14/native parity 7 통과. 전체 verify(unit 411/contracts 94/
parity 94)·빌드·Rust fmt/clippy/test 통과 후, 두 번째 회전축 추가 사례까지
타입 검사·전체 unit 414·진단 parity 7을 다시 통과했다. 기준 장비 성능 증거는
소스 지문 변경으로 재측정이 필요하다. 상세 검증과 릴리스 제한은 PROGRESS.md에 기록한다. M13 전체 완료나
5축 충돌/희소 복셀 제거/튜토리얼 완성을 의미하지 않는다.
