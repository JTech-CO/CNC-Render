# CNC Render M2 G-code 지원 매트릭스

- 매트릭스 버전: `1`
- 실행 방언: `common-v1`
- 범위: 교육·대화형 실습(E1/E2)용 공통 부분집합

`common-v1`은 Fanuc-like, Haas-like, LinuxCNC-like에서 겹치는 문법을
의도적으로 작게 고른 CNC Render 계약이다. 프리셋 이름은 입력 출처와 향후
확장 지점을 표시할 뿐 어느 제어기와도 전체 호환을 보증하지 않는다. CNC
Render의 결과를 산업용 검증 도구와 동등하다고 표현하지 않는다.

| status | 의미 |
|---|---|
| `supported` | 파싱·검증 후 정규 명령, 제어 이벤트 또는 Toolpath IR로 내린다. |
| `recognized-unsupported` | 코드는 인식하지만 실행하지 않고 오류를 낸다. |
| `unsupported` | 매트릭스 밖의 주소·코드이며 오류를 낸다. |

## G-code

| code | status | 의미 |
|---|---|---|
| `G0` | `supported` | rapid |
| `G1` | `supported` | linear |
| `G2` | `supported` | 시계 방향 arc |
| `G3` | `supported` | 반시계 방향 arc |
| `G17` | `supported` | XY 평면 |
| `G18` | `supported` | XZ 평면 |
| `G19` | `supported` | YZ 평면 |
| `G20` | `supported` | inch 입력 |
| `G21` | `supported` | mm 입력 |
| `G40` | `supported` | 공구 반경 보정 취소 |
| `G41` | `recognized-unsupported` | 좌측 반경 보정 |
| `G42` | `recognized-unsupported` | 우측 반경 보정 |
| `G43` | `supported` | H 공구 길이 보정 활성 |
| `G49` | `supported` | 공구 길이 보정 취소 |
| `G54` | `supported` | 작업 좌표 오프셋 1 |
| `G55` | `supported` | 작업 좌표 오프셋 2 |
| `G56` | `supported` | 작업 좌표 오프셋 3 |
| `G57` | `supported` | 작업 좌표 오프셋 4 |
| `G58` | `supported` | 작업 좌표 오프셋 5 |
| `G59` | `supported` | 작업 좌표 오프셋 6 |
| `G80` | `supported` | 고정 사이클 취소 |
| `G81` | `supported` | 드릴 사이클 |
| `G82` | `supported` | dwell 드릴 사이클 |
| `G83` | `supported` | peck 드릴 사이클 |
| `G84` | `recognized-unsupported` | 탭 사이클 |
| `G85` | `recognized-unsupported` | 보링 사이클 |
| `G86` | `recognized-unsupported` | 주축 정지 보링 |
| `G87` | `recognized-unsupported` | 백 보링 |
| `G88` | `recognized-unsupported` | 수동 복귀 보링 |
| `G89` | `recognized-unsupported` | dwell 보링 |
| `G90` | `supported` | 절대 거리 |
| `G91` | `supported` | 증분 거리 |
| `G94` | `supported` | length/min 이송 |
| `G95` | `supported` | length/rev 이송 |
| `G96` | `supported` | 일정 절삭 속도 |
| `G97` | `supported` | 일정 rpm |
| `G98` | `supported` | initial plane 복귀 |
| `G99` | `supported` | R plane 복귀 |

그 밖의 G-code는 `parser.gcode.unsupported`, 같은 블록의 모달 그룹 충돌은
`parser.modal.conflict` 오류다. G41/G42는 일반 미지원 코드가 아니라
`semantic.cutter_comp.unsupported`로 구분한다.

## M-code와 프로그램 제어

| code | status | 의미 |
|---|---|---|
| `M0` | `supported` | 프로그램 정지 이벤트 |
| `M1` | `supported` | 선택적 정지 이벤트 |
| `M2` | `supported` | 프로그램 종료 이벤트 |
| `M3` | `supported` | 주축 정회전 |
| `M4` | `supported` | 주축 역회전 |
| `M5` | `supported` | 주축 정지 |
| `M6` | `supported` | 공구 교환 |
| `M8` | `supported` | 절삭유 켜기 |
| `M9` | `supported` | 절삭유 끄기 |
| `M30` | `supported` | 프로그램 종료·되감기 이벤트 |

M0/M1은 lowering을 끝내지 않는다. M2/M30이 있는 블록의 motion은 반영하고
그다음 블록부터 motion lowering과 modal mutation을 중단한다. 다만 이후 블록도
끝까지 G/M/주소의 정적 지원 여부를 검증하므로 미지원 코드는 조용히 무시하지
않는다. 네 제어 명령은 source 순서대로
`programControlEvents: [{ sourceLine, control: "m0"|"m1"|"m2"|"m30" }]`에
보존한다. 최종 요약은 `finalState.lastProgramControl`이고, 종료 종류는
`finalState.programEnd`의 `none|m2|m30`이다. 그 밖의 M-code는
`parser.mcode.unsupported` 오류다.

## 워드

| code | status | 문맥 |
|---|---|---|
| `T` | `supported` | 양의 정수 공구 번호 |
| `S` | `supported` | rpm 또는 절삭 속도 |
| `F` | `supported` | length/min 또는 length/rev |
| `X` | `supported` | X 위치·끝점·사이클 |
| `Y` | `supported` | Y 위치·끝점·사이클 |
| `Z` | `supported` | Z 위치·끝점·사이클 |
| `A` | `recognized-unsupported` | 파싱 후 rotary fatal |
| `B` | `recognized-unsupported` | 파싱 후 rotary fatal |
| `C` | `recognized-unsupported` | 파싱 후 rotary fatal |
| `I` | `supported` | 증분 X 중심 오프셋 |
| `J` | `supported` | 증분 Y 중심 오프셋 |
| `K` | `supported` | 증분 Z 중심 오프셋 |
| `H` | `supported` | G43의 양의 정수 길이 오프셋 번호 |
| `R` | `supported` | 원호 반경 또는 cycle retract |
| `P` | `supported` | G82 dwell 시간(s), arc turn 표기는 인식 후 fatal |
| `Q` | `supported` | G83 peck 깊이 |

주소 대소문자와 공백은 의미를 바꾸지 않는다. 중복 주소는
`parser.word.duplicate`, 그 밖 주소는 `parser.word.unsupported`다. 알려진
H/I/J/K/R/P/Q가 현재 motion 문맥에 맞지 않으면 `semantic.word.context`다.

## 모달·단위·이송 규칙

- 기본은 G17, G21, G54, G90, G94, G97, G40, G49, G98이고 motion은 없다.
- G20 값은 정확히 `25.4 mm/in`으로 변환한다. 모든 canonical 좌표와 길이는
  mm, 모든 Toolpath segment feed는 scalar `mm/min`이다.
- G54~G59 오프셋은 호출자가 mm로 주입하며 lowering 결과는 machine-space다.
- G43은 양의 정수 H와 해당 `toolLengthOffsetsMm` scalar를 요구한다. 보정은
  평면과 무관하게 machine Z에 적용한다. 절대 Z와 Z-axis cycle depth/R에는
  한 번 더하고 증분 delta에는 반복 가산하지 않는다.
- G94↔G95 전환은 이전 F를 무효화하므로 새 feed motion 전에 F가 필요하다.
  G95는 활성 spindle 값이 있어야 하며 `F(length/rev) × rpm`으로 해석한다.
- G96은 같은 블록에 양수 S가 필수다. 이미 G96이 활성이어도 새 explicit
  G96 block은 이전 S를 재사용하지 않는다. G21의 S는 m/min, G20의 S는
  ft/min, G97의 S는 rpm이다. G96↔G97 전환도 이전 S를 무효화한다.
- source의 A/B/C뿐 아니라 `initialState.rotaryRad`도 정확히 0이어야 한다.
  nonzero rotary pose는 XYZ-only M1 Toolpath IR에서 보존할 수 없으므로
  `semantic.rotary.not_lowered` fatal이다.
- G-code text의 `X-0` 같은 word는 유효하며 canonical `+0`으로 정규화한다.
  반면 JSON ParseOptions의 raw wire `-0`은 M1 wire 계약 위반으로 거부한다.
  단위 변환, 오프셋, endpoint와 누적 길이는 모두 finite이고 음의 0이
  아니어야 하며, lexing 뒤 산술에서 wire-safe하지 않은 값이 생겨도
  fail-closed 처리한다.

M1 Toolpath segment의 feed가 scalar이므로 G95+G96은 각 segment의 canonical
끝점 X 절댓값을 직경(mm)으로 보고
`rpm = surfaceSpeedMmPerMin / (π × |endpointXMm|)`로 한 번 계산한다. 이는
결정론적인 E1/E2 교육용 근사다. 구간 안에서 연속으로 변하는 RPM, 기계별
최대·최소 RPM clamp, 가감속과 실제 제어기 보간은 후속 운동학 범위이며
산업용 검증과 동등하지 않다.

## 원호 규칙

- 기하 평면은 G17=XY, G18=XZ, G19=YZ다. G2/G3 방향 판정의 oriented pair는
  각각 XY/ZX/YZ이고 양의 회전축 끝(+Z/+Y/+X)에서 원점을 바라본다. 이
  시점에서 G2는 clockwise, G3는 counterclockwise다.
- I/J/K는 G90/G91과 무관하게 원호 시작점 기준 증분이다. 활성 평면의 두
  중심 성분 중 적어도 하나가 있어야 하며, 생략한 나머지 성분은 0이다.
- IJK center-format은 시작점과 끝점이 같은 full circle을 허용한다.
- 양수 R은 180° 미만 minor arc, 음수 R은 180° 초과 major arc다.
- R full circle, IJK/R 동시 지정, 불가능한 반경은 오류다.
- P turn-count 표기는 인식하지만 M2에서는 P가 있는 arc를 다회전 경로로
  내리지 않는다. P 위치에 `semantic.arc.turns.unsupported` fatal을 낸다.
  프로그램 종료 이후에도 explicit G2/G3 또는 종료 시 동결된 active arc mode와
  함께 나타난 P는 같은 정적 지원 진단을 낸다.
- 원호 길이는 `radius × sweep`; helix는
  `sqrt(planarArcLength² + orthogonalDelta²)`다.

IJK center-format의 시작 반경을 `r`, 끝 반경과의 절대 차이를 `d`라 한다.
G21에서 반경 불일치는 `d > 0.5 mm` 또는
`d > 0.005 mm`이면서 `d > 0.001 × r`일 때다. G20은 같은 비교를 canonical
mm의 `1.27 mm`와 `0.0127 mm`로 수행한다. 비교는 strict `>`이므로 경계값은
허용된다. 동치인 허용식은
`d <= min(bigTolerance, max(smallTolerance, 0.001 × r))`이다.

## 고정 사이클 규칙

G81/G82/G83은 선택 평면에서 명시적 구간으로 확장된다. cycle axis는
G17=Z, G18=Y, G19=X이고 drilling은 cycle-axis 좌표가 감소하는 방향이다.
따라서 R은 depth보다 커야 한다. R·depth·필수 P/Q는 sticky이며, G82 P와
G83 Q는 0보다 커야 한다.

활성 G81~G83에서 axis word와 explicit G81/G82/G83이 없이 허용된 R/P/Q만
있는 블록은 motion과 Toolpath segment를 만들지 않고 sticky parameter만
갱신한다. R은 모든 활성 cycle, P는 G82, Q는 G83에서만 허용하며 이후
좌표-only repeat가 커밋된 새 값을 사용한다. 새 값은 모두 finite여야 하고
P/Q는 양수여야 하며, R을 바꾸면 기존 sticky depth와 `R > depth`를 즉시
검증한다. 위반은 해당 word 또는 블록에 fatal 진단을 내고 블록 전 sticky
상태로 transaction rollback한 뒤 parse 전체를 fail-closed 처리한다.

G90의 sticky R/depth는 단위만 canonical mm로 바꾼 programmed work-coordinate
값을 보존한다. 매 실행과 좌표-only repeat에서 현재 G54~G59를 적용하고,
G17에서는 현재 G43/H 또는 G49까지 적용해 machine R/depth를 다시 푼다.
따라서 cycle 도중 work coordinate나 tool-length offset이 바뀌면 같은
programmed R/depth도 새 machine 위치로 이동한다.

G91의 explicit R은 그 블록 시작 시점의 현재 cycle-axis machine 위치에 R
delta를 더한 값이다. 증분 cycle-axis depth word는 R 기준 sticky delta로
보존한다. 마지막 programmed depth가 증분 Z였다면 이후 R-only 갱신이나
좌표 repeat에서 새 R에 그 Z delta를 다시 적용한다.

한 hole의 순서는 다음과 같다.

1. 현재 cycle-axis가 R보다 낮으면 같은 위치에서 R까지 axis-only rapid
2. 선택 평면과 평행하게 hole 위치로 rapid
3. R plane으로 rapid
4. depth로 feed하고 G82는 P초 dwell, G83은 Q peck 반복
5. G98 또는 G99 return plane으로 rapid

활성 G81~G83에서 같은 plane을 재지정하는 것은 허용한다. 다른 G17/G18/G19로
바꾸면 sticky cycle-axis scalar의 재해석을 막기 위해 plane G word 위치에
`semantic.cycle.plane_change` fatal을 낸다. G80 또는 다른 group-1 motion으로
cycle을 끝낸 뒤 plane을 바꾸고 새 cycle의 depth/R/P/Q를 명시해야 한다.

G98은 `max(series initial plane, R)`, G99는 R이며 기본은 G98다. G83은
중간 peck마다 R로 복귀하고 이전 bottom보다 0.254 mm 앞까지 rapid 접근한다.
G83은 parse 전체에 누적 peck budget 100,000회를 둔다. 첫 G83과 sticky
좌표-only repeat가 요구하는 `ceil(|depth-R|/Q)`의 합이 budget을 초과하면
초과를 유발한 블록에서 `semantic.cycle.expansion_limit`을 내고 전체
결과를 fail-closed 처리한다. 수치상 다음 peck으로 전진하지 못할 때도 같은
진단을 사용한다. 근거는
[LinuxCNC 공식 G-code 문서](https://www.linuxcnc.org/docs/html/gcode/g-code.html)의
원호, G80~G89 preliminary motion, G81~G83과 G98/G99 정의다.

## Resource limits

모든 한도는 inclusive다. 한도와 같은 입력은 허용하고 다음 하나 또는 다음
한 byte에서 즉시 중단한다.

| resource | inclusive limit | 공개 상수 |
|---|---:|---|
| CLI JSON stdin UTF-8 envelope | 20 MiB (20,971,520 bytes) | `MAX_CLI_JSON_STDIN_BYTES` |
| decoded G-code source UTF-8 | 16 MiB (16,777,216 bytes) | `MAX_GCODE_SOURCE_BYTES` |
| single G-code line UTF-8 | 1 MiB (1,048,576 bytes) | `MAX_GCODE_LINE_BYTES` |
| G-code lines | 250,000 | `MAX_GCODE_LINES` |
| lexed words | 1,000,000 | `MAX_GCODE_WORDS` |
| canonical motions | 400,000 | `MAX_CANONICAL_MOTIONS` |
| parse diagnostics, terminal 진단 포함 | 10,000 | `MAX_DIAGNOSTICS` |
| parity `repetitions` | 1..=100 | `MAX_REPETITIONS` |

CLI JSON envelope는 decoded `source`와 별도다. envelope 초과와 범위 밖
`repetitions`는 ParseResult를 만들기 전 exit 2와 top-level
`request.resource_limit` 요청 오류로 끝나며, repetitions를 조용히 clamp하지
않는다. source·line·line count·word count와 diagnostic count 초과는
ParseResult의 terminal `request.resource_limit` fatal이다. diagnostic cap의
마지막 entry는 이 terminal 진단이고 이후 진단은 만들지 않는다. terminal을 제외한
일반 진단 prefix는 source 위치와 같은 위치의 emission order로 안정 정렬한다. source
크기 초과는 1:1, line 크기는 해당 line의 column 1, line count는 첫 초과
line의 column 1, word count는 첫 초과 word, diagnostic count는 초과를
유발한 진단의 실제 line/column에 고정한다.

400,000개까지 허용하며 400,001번째 canonical motion을 만들려는 source
block은 line column 1에 `semantic.motion.limit` fatal을 낸다. ParseResult를
만들 수 있는 resource 초과는 motion, event, endpoint와 path length를
노출하지 않는 fail-closed 결과다.

실제 크기의 대형 Golden은 저장소와 CI 메모리를 불필요하게 키우므로 만들지
않는다. Rust의 injected-limit 테스트가 작은 한도로 정확한 경계값 허용,
한도+1의 진단 위치, terminal diagnostic, motion rollback과 fail-closed를
검증한다. production 상수와 공개 이름은 contract test로 고정한다.

## 공개 진단 코드

| code | 조건 |
|---|---|
| `request.resource_limit` | CLI/request/source/lexer/diagnostic/repetition 한도 초과 |
| `request.dialect.unsupported` | 지원하지 않는 dialect |
| `request.uuid.invalid` | 요청 UUID 오류 |
| `request.work_offset.invalid` | 작업 좌표 오프셋 오류 |
| `lexer.macro.unsupported` | macro·variable·program construct |
| `lexer.symbol.unsupported` | 안전하게 해석할 수 없는 기호 |
| `lexer.number.invalid` | 숫자 없음·비유한·잘못된 숫자 |
| `lexer.comment.unterminated` | 닫히지 않은 괄호 주석 |
| `parser.word.unsupported` | 매트릭스 밖 주소 |
| `parser.word.duplicate` | 같은 블록의 중복 주소 |
| `parser.gcode.unsupported` | 미지원 G-code |
| `parser.mcode.unsupported` | 미지원 M-code |
| `parser.modal.conflict` | 같은 모달 그룹 충돌 |
| `semantic.word.context` | 알려진 워드가 현재 motion 문맥에 맞지 않음 |
| `semantic.cutter_comp.unsupported` | 공구 반경 보정 의미 미지원 |
| `semantic.numeric.non_finite` | 요청 또는 산술 결과가 M1 wire-safe하지 않음 |
| `semantic.motion.missing` | 초기 motion 없는 축 워드 |
| `semantic.motion.limit` | canonical motion 400,000개 초과 |
| `semantic.feed.missing` | feed motion의 F 없음 |
| `semantic.feed.non_positive` | F가 0 이하 |
| `semantic.feed.unresolved_per_revolution` | G95 feed를 mm/min으로 해석 불가 |
| `semantic.arc.missing_center` | 활성 평면의 IJK와 R이 모두 없음 |
| `semantic.arc.invalid_radius` | 불가능한 R |
| `semantic.arc.radius_mismatch` | IJK 시작·끝 반경 허용식 위반 |
| `semantic.arc.full_circle_r_unsupported` | R full circle |
| `semantic.arc.center_conflict` | IJK와 R 동시 지정 |
| `semantic.arc.turns.unsupported` | arc P turn-count lowering 미지원 |
| `semantic.cycle.parameter_missing` | cycle 필수 R/depth/P/Q 없음 |
| `semantic.cycle.invalid_parameter` | cycle 파라미터 범위 또는 방향 오류 |
| `semantic.cycle.plane_change` | 활성 cycle에서 다른 plane으로 변경 |
| `semantic.cycle.expansion_limit` | parse 누적 100,000회 초과 또는 전진 불가 peck |
| `semantic.tool_length.missing_h` | G43의 유효한 양의 정수 H 없음 |
| `semantic.tool_length.unmapped` | H 매핑 없음 |
| `semantic.tool.not_selected` | M6 전 T 없음 |
| `semantic.tool.unmapped` | T 공구 UUID 매핑 없음 |
| `semantic.tool.invalid` | T 번호 오류 |
| `semantic.rotary.not_lowered` | source 또는 initial rotary를 3축 IR로 lowering 불가 |
| `semantic.spindle.missing` | 필수 S 없음 |
| `semantic.spindle.non_positive` | S가 0 이하 |

`lexer.comment.unterminated`만 해당 줄의 나머지를 주석으로 안전하게 대체하므로
`recoverable: true`다. 이 진단만 있는 입력은 안전하게 파싱을 계속하고
`accepted=true`가 될 수 있다. 실행 의미를 안전하게 정할 수 없는 나머지
오류는 `recoverable: false`다.

## 실패 원자성과 Source line map

fatal 진단이 하나라도 있으면 `accepted=false`, `toolpath=null`,
`canonicalMotions=[]`, `programControlEvents=[]`, 세 path length는 0,
endpoint와 final state는 초기값(`programEnd=none`,
`lastProgramControl=none`)으로 돌아간다. 유효한 앞부분을 부분 결과로
노출하지 않는다.

모든 IR segment는 원문 줄 하나에 대응한다. cycle expansion은 실행 줄에,
좌표-only repeat는 반복 줄에 매핑한다. 이 문서의 code/status와 진단 목록은
`tests/fixtures/gcode/support-matrix.json`을 machine-readable 기준으로 삼는다.
