# ADR 0014 — M10 Worker/WASM 증거 어댑터와 결정론적 점수

- 상태: 승인
- 날짜: 2026-08-13
- 마일스톤: M10 — 튜토리얼·샌드박스 MVP(E2)

## 배경

ADR 0013은 강의 스키마와 단계 판정을 순수 규칙으로 고정했지만, 첫 fixture의
증거와 점수는 아직 테스트 상수였다. M10의 판정은 실제 Worker/WASM 실행 결과를
사용해야 하며, 재생 속도·브라우저 부하·렌더 프레임에 따라 점수가 달라져서는 안
된다. 또한 Worker가 소유하지 않는 목표 형상 측정값을 임의로 추정하거나 누락값을
0으로 간주하면 잘못된 통과 결과를 만들 수 있다.

## 결정

1. `packages/lesson-engine`은 `@cnc-render/contracts`의
   `CoordinatorCoreSummary`만 읽는 순수 어댑터를 제공한다. simulation, renderer,
   storage 또는 React 구현은 import하지 않는다.
2. 어댑터는 완료 또는 충돌 정지 상태와 최종 semantic hash가 있는 요약만 받는다.
   `logicalTimeS`, `removedVolumeMm3`, 충돌 유무를 엔진 소유 증거로 변환하고,
   run ID·fixture ID·공정 종류·최종 상태 hash·Stock hash를 provenance로 보존한다.
3. 현재 Coordinator는 첫 충돌에서 정지하므로 `collisionCount`는 충돌 record가
   없으면 `0`, 있으면 `1`인 E2 값이다. 다중 충돌 누적은 Coordinator 계약이 이를
   제공할 때 확장한다.
4. 설정 완료·측정 기록·결과 검토 이벤트와 공구 수·형상 편차·과절삭·미절삭·절입
   깊이는 해당 소유 경계가 명시적으로 전달한다. 어댑터는 이벤트를 정식 순서로
   중복 제거하며 누락된 점수 metric을 대신 채우지 않는다.
5. 강의 JSON은 총 100점인 여섯 기준을 정확히 한 번씩 선언한다. 각 기준은
   `fullPointsAtOrBelow` 이하에서 만점, `zeroPointsAtOrAbove` 이상에서 0점이며 그
   사이는 다음 식으로 선형 감점한다.

   ```text
   ratio = 1 - (value - fullBoundary) / (zeroBoundary - fullBoundary)
   points = round(weight × clamp(ratio, 0, 1), 2)
   total = round(sum(points), 2)
   ```

6. 첫 평면 밀링 fixture의 정책은 다음과 같고 통과 기준은 `80 / 100`이다.

   | 기준 | 배점 | 만점 경계 | 0점 경계 |
   |---|---:|---:|---:|
   | 최대 형상 편차 | 30 | `0.2 mm` | `1.0 mm` |
   | 충돌 횟수 | 25 | `0 회` | `1 회` |
   | 논리 가공 시간 | 15 | `55 s` | `110 s` |
   | 공구 수 | 10 | `1 개` | `3 개` |
   | 과절삭 체적 | 10 | `0 mm³` | `35,788.8 mm³` |
   | 미절삭 체적 | 10 | `0 mm³` | `35,788.8 mm³` |

   체적 0점 경계는 대표 제거 체적 `357,888 mm³`의 10%다. 이는 E2 교육 fixture
   기준이며 산업용 공차 판정이 아니다.
7. 시간에는 Worker/WASM Toolpath IR의 `logicalTimeS`만 사용한다. 화면에 표시되는
   실제 재생 경과와 `performance.now()` 값은 점수 입력이 아니다.
8. 점수에 필요한 metric이 하나라도 없으면 `lesson.score.metric-missing` 오류를
   반환한다. 누락값을 0 또는 최적값으로 대체하지 않는다.
9. 평면 밀링 측정 경계는 `packages/simulation`에 둔다. 완료된 Worker/WASM의
   `milling-full` Stock surface와 별도로 작성된 평엔드밀 목표 sweep을 같은 덱셀
   셀 중심·해상도에서 비교한다. 실제 표면이 목표보다 낮으면 과절삭, 높으면
   미절삭으로 정의하고 셀 가장자리 면적까지 반영해 체적을 `mm³`로 적분한다.
   목표는 실제 surface 배열에서 역산하지 않고 fixture의 Stock 경계, 공구 지름과
   공구 경로로 생성한다.
10. 전체 `Float32Array`는 측정 호출 안에서만 읽고 Lesson/React에는 비교 셀 수,
    표현 해상도, 최대·평균 편차, 실제·목표 제거 체적, 과절삭·미절삭 체적의 작은
    summary만 전달한다. `simulation.snapshot` reply는 checkpoint 호출자에게만
    반환하고 renderer 구독 스트림에는 재방송하지 않는다. 사용자가 명시적으로
    checkpoint를 렌더하도록 요청한 경우에만 별도 render API를 사용한다.

## 결과와 제약

- 독립적인 실제 WASM 재실행은 같은 증거와 점수를 만들고, 실제 충돌 fixture는
  `execute.collision` 실패와 25점 감점을 함께 만든다.
- 대표 평면 밀링의 실제 Worker/WASM Stock `1,125`셀과 목표 sweep의 절삭 대상
  `699`셀을 비교하면 실제·목표 제거 체적은 모두 `357,888 mm³`, 최대 편차와
  과절삭·미절삭은 모두 0으로 재현된다. 이 summary가 5단계 Lesson controller의
  측정·평가 증거와 결정론적 점수로 전달된다.
- 대표 fixture의 balanced dexel 해상도는 `8 mm`다. 측정은 셀 중심과 양자화 높이를
  사용하므로 `8 mm` 미만의 국부 형상·표면 조도·열 변형은 평가하지 않는다.
- 점수는 학습 피드백이며 E2 정확도 등급을 넘는 산업용 합격 판정으로 표현하지 않는다.
