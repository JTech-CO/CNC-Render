# ADR 0004: M2 G-code 파서·모달 상태·Toolpath IR

- 상태: 승인
- 날짜: 2026-07-28
- 적용 버전: G-code fixture schema `1`, dialect `common-v1`

## 맥락

M1은 mm 기반 좌표와 Toolpath IR wire 계약을 고정했지만 G-code 문법·모달
상태·오류 처리는 정하지 않았다. 같은 텍스트가 단위, 평면, 거리 모드, 작업
좌표와 고정 사이클에 따라 다른 경로를 만든다. Fanuc, Haas와 LinuxCNC는
문법을 일부 공유하지만 macro, variable, cycle과 보정 의미가 다르므로
프리셋 이름만으로 전체 호환을 암시하거나 모르는 코드를 무시할 수 없다.

## 결정

### 1. `common-v1` 부분집합

실행 의미는 `common-v1` 하나다. Fanuc-like, Haas-like,
LinuxCNC-like는 입력 출처와 향후 확장 지점을 나타낼 뿐 서로 다른 의미
엔진을 선택하지 않는다. 정확한 상태는 `docs/gcode-support-matrix.md`와
`tests/fixtures/gcode/support-matrix.json`이 함께 소유한다.

매트릭스 밖 G/M-code와 주소, G41/G42, G84~G89, 제조사 macro·variable은
조용히 건너뛰지 않고 명시적 오류로 실행을 막는다. CNC Render는 E1/E2
교육용 시뮬레이터이며 결과를 산업용 검증 도구와 동등하다고 표현하지 않는다.

### 2. 단계와 경계

```text
UTF-8 source
  → lexer
  → block parser
  → modal state machine
  → semantic validator
  → canonical motion + program control events
  → Toolpath IR + source line map
```

lexer는 원문 위치를 보존하고 parser는 중복·modal group 충돌을 검사한다.
modal state와 semantic validation 뒤의 lowering만 M1 Toolpath IR를 만든다.
코어는 UI, renderer, collision, material removal에 의존하지 않는다.

### 2.1 Resource ceilings

모든 resource ceiling은 inclusive다.

| resource | inclusive limit | 공개 상수 |
|---|---:|---|
| CLI JSON stdin UTF-8 envelope | 20 MiB | `MAX_CLI_JSON_STDIN_BYTES` |
| decoded G-code source UTF-8 | 16 MiB | `MAX_GCODE_SOURCE_BYTES` |
| single G-code line UTF-8 | 1 MiB | `MAX_GCODE_LINE_BYTES` |
| G-code lines | 250,000 | `MAX_GCODE_LINES` |
| lexed words | 1,000,000 | `MAX_GCODE_WORDS` |
| canonical motions | 400,000 | `MAX_CANONICAL_MOTIONS` |
| diagnostics, terminal 진단 포함 | 10,000 | `MAX_DIAGNOSTICS` |
| parity repetitions | 1..=100 | `MAX_REPETITIONS` |

CLI envelope와 decoded G-code source는 별도 byte budget이다. envelope
초과와 범위 밖 repetitions는 ParseResult를 만들기 전 exit 2와 top-level
`request.resource_limit` 요청 오류로 끝난다. repetitions는 조용히 clamp하지
않는다. source, line, line count, word count와 diagnostic count 초과는
ParseResult의 terminal `request.resource_limit` fatal이다. diagnostic
cap에서는 마지막 slot을 terminal resource 진단에 쓰고 이후 진단 생성을
멈춘다. source 크기 초과는 1:1, line 크기는 해당 line의 column 1, line
count는 첫 초과 line의 column 1, word count는 첫 초과 word, diagnostic
count는 초과를 유발한 진단의 실제 line/column에 고정한다.

400,000개 canonical motion까지 허용하고 다음 motion을 만들려는 source
block은 `semantic.motion.limit` fatal이다. ParseResult를 만들 수 있는 모든
resource 초과는 toolpath, canonical motion, program event와 부분 길이를
노출하지 않는 fail-closed 결과다.

production 크기의 대형 Golden은 저장소에 넣지 않는다. Rust
`GcodeResourceLimits` injected-limit tests가 축소한 ceiling으로 경계값 허용,
한도+1 진단 위치, terminal diagnostic, block rollback과 fail-closed를
검증한다. production 상수와 공개 진단 이름은 contract test로 고정한다.

### 3. canonical 상태와 수치

- 선형 수치는 mm다. G20은 `25.4 mm/in`으로 한 번 변환한다.
- source의 A/B/C는 숫자 word로 인식하지만 자세·단위 lowering 없이
  `semantic.rotary.not_lowered` fatal을 낸다. `initialState.rotaryRad`도
  정확히 0이어야 하며 nonzero 초기 자세는 같은 진단으로 거부한다.
- 기본 상태는 G17, G21, G54, G90, G94, G97, G40, G49, G98이고 motion은
  명시 전까지 없다.
- 호출자가 G54~G59 mm 오프셋을 주입하고 lowering은 machine-space 좌표를
  만든다.
- T와 H는 양의 정수다. G43은 매핑된 `toolLengthOffsetsMm` scalar를 요구한다.
  보정은 선택 평면의 normal이 아니라 항상 machine Z에 적용한다. 절대 Z와
  Z-axis cycle의 depth/R에는 작업 좌표와 공구 길이를 각각 한 번 더한다.
  증분 Z는 현재 위치에 delta만 더해 공구 길이를 반복 가산하지 않는다.
  G49가 취소한다.
- I/J/K는 G90/G91과 무관하게 시작점 기준 증분이다.
- G94↔G95는 이전 F를 무효화한다. 다음 feed motion에 새 F가 필요하며
  G95는 spindle 상태로 scalar `mm/min`을 해석할 수 있어야 한다.
- G96은 같은 블록의 양수 S가 필수다. 이미 G96이 활성이어도 새 explicit
  G96 block은 이전 S를 재사용하지 않는다. G21에서 S는 m/min, G20에서
  ft/min, G97에서 rpm이다. G96↔G97은 이전 S를 무효화한다.
- F, S, P와 Q는 0보다 커야 한다. G-code text의 `X-0` 같은 word는 유효하며
  canonical `+0`으로 정규화한다. 반면 JSON ParseOptions의 raw wire `-0`은
  M1 wire 계약 위반으로 거부한다. 모든 파생 좌표·속도·길이는 finite이고
  음의 0이 아니어야 하며, 단위 변환이나 누적 합에서 wire-safe하지 않은
  값이 생기면 `semantic.numeric.non_finite`로 해당 블록과 전체 결과를
  거부한다.

M1 Toolpath segment는 feed를 scalar `mm/min`으로만 보존한다. 따라서 G95에서
G97은 `feedMmPerMin = F × rpm`이고, G96은 각 segment의 canonical 끝점
X 절댓값을 직경으로 해석해 다음 식을 한 번 적용한다.

```text
rpm = surfaceSpeedMmPerMin / (π × |endpointXMm|)
feedMmPerMin = feedLengthPerRevMm × rpm
```

이는 동일 입력에 동일 값을 주기 위한 E1/E2 근사다. segment 내부에서
연속으로 변하는 RPM, 기계별 최대·최소 RPM clamp, 가감속과 실제 제어기
보간은 후속 운동학 범위다.

### 4. 원호

기하 평면은 G17=XY, G18=XZ, G19=YZ다. G2/G3의 oriented plane pair는
XY/ZX/YZ이며 양의 회전축 끝(+Z/+Y/+X)에서 원점을 바라본다. 이 시점에서
G2는 clockwise, G3는 counterclockwise다. 구현 내부 축 배열 순서로 이
방향을 재정의하지 않는다.

IJK는 시작점에서 중심까지의 증분 오프셋이다. 활성 평면의 두 중심 성분 중
적어도 하나가 있어야 하며 생략한 나머지 성분은 0이다. center-format은
동일 시작·끝의 full circle을 허용한다.

양수 R은 180° 미만 minor arc, 음수 R은 180° 초과 major arc다. 동일
시작·끝의 R full circle, IJK/R 동시 지정과 불가능한 반경은 오류다.
P turn-count 표기는 인식하지만 M2에서 다회전 경로로 내리지 않으며 P word
위치에 `semantic.arc.turns.unsupported` fatal을 낸다. 프로그램 종료 이후에도
explicit G2/G3 또는 종료 시 동결된 active arc mode와 함께 나타난 P는 동일한
정적 지원 진단을 낸다.

IJK 시작 반경 `r`과 끝 반경 차이 `d`는 LinuxCNC의 unit-aware 조건으로
검증한다. G21은 `d > 0.5 mm` 또는
(`d > 0.005 mm` 그리고 `d > 0.001 × r`)일 때 불일치다. G20의 canonical
threshold는 각각 `1.27 mm`, `0.0127 mm`다. 비교가 strict `>`이므로
경계값은 허용한다.

경로 길이는 rapid, linear와 arc/helix의 3차원 기하 길이 합이다. dwell과
tool-change는 길이 0이다. 원호는 programmed start radius와 swept angle의
곱이고 helix는 `sqrt(planarArcLength² + orthogonalDelta²)`다.

### 5. 고정 사이클

G80, G98와 G99를 G81~G83의 전제 기능으로 지원한다. 선택 평면의 cycle
axis는 G17=Z, G18=Y, G19=X다. `common-v1` drilling은 cycle-axis 좌표가
감소하는 방향이므로 R은 depth보다 커야 한다.

- 현재 cycle-axis가 R보다 낮으면 먼저 같은 위치에서 R까지 axis-only rapid
- 그다음 선택 평면과 평행하게 hole 위치로 rapid하고 R plane으로 rapid
- G81: depth까지 feed한 뒤 return
- G82: depth에서 양수 P초 dwell한 뒤 return
- G83: 양수 Q feed peck, 중간 R retract, 이전 bottom보다 0.254 mm 앞까지
  rapid approach를 반복한 뒤 return

좌표-only 블록은 활성 cycle을 반복하며 R, depth와 필요한 P/Q는 sticky다.
G98은 `max(series initial plane, R)`, G99는 R이고 기본은 G98이다.
G81↔G82↔G83은 initial plane을 보존한다. G80이나 다른 group-1 motion만
이를 버린다.

활성 G81~G83에서 axis word와 explicit G81/G82/G83 없이 허용된 R/P/Q만
있는 블록은 canonical motion과 Toolpath segment를 만들지 않고 sticky
parameter만 갱신한다. R은 모든 활성 cycle, P는 G82, Q는 G83에서만
허용한다. 이후 좌표-only repeat는 커밋된 새 값을 사용한다.

R/P/Q는 finite여야 하고 P/Q는 양수여야 한다. R update는 기존 sticky
depth와 `R > depth`를 즉시 검증한다. 위반은 해당 word 또는 블록 위치에
fatal 진단을 내고 block 전 sticky 상태로 transaction rollback한 뒤 parse
전체를 fail-closed 처리한다.

G90 R/depth는 unit conversion만 끝낸 programmed work-coordinate mm로
보존한다. 매 cycle 실행과 좌표-only repeat에서 현재 G54~G59를 적용하며,
G17은 현재 G43/H 또는 G49까지 적용해 machine R/depth를 다시 푼다. 따라서
cycle 중 work coordinate나 tool-length offset을 바꾸면 같은 programmed
값도 새 machine 위치로 이동한다.

G91 explicit R은 block-start current cycle-axis machine position 기준
delta다. 증분 cycle-axis depth word는 R 기준 sticky delta로 보존한다.
마지막 programmed depth가 증분 Z였다면 이후 explicit R 또는 R-only
갱신에서 새 R에 같은 Z delta를 다시 적용한다.

활성 G81~G83에서 같은 plane 재지정은 허용한다. 다른 G17/G18/G19로
바꾸면 sticky cycle-axis scalar의 재해석을 막기 위해 plane G word 위치에
`semantic.cycle.plane_change` fatal을 낸다. G80 또는 다른 group-1 motion으로
cycle을 끝낸 뒤 plane을 바꾸고 새 cycle의 depth/R/P/Q를 명시해야 한다.

preliminary motion과 0.010 inch clearance의 canonical 0.254 mm는
[LinuxCNC 공식 G-code 문서](https://www.linuxcnc.org/docs/html/gcode/g-code.html)의
G80~G89와 G98/G99를 공통 기준으로 삼는다. 식, L 반복, UVW와 제조사별
확장은 포함하지 않는다.

G83은 parse 전체에 누적 peck budget 100,000회를 둔다. 첫 G83과 sticky
좌표-only repeat가 요구하는 `ceil(|depth-R|/Q)`의 합이 이 budget을
초과하면 초과를 유발한 block에서 `semantic.cycle.expansion_limit`을 내고
전체 parse를 fail-closed 처리한다. 수치 정밀도 때문에 다음 peck으로
전진하지 못할 때도 같은 진단을 사용한다.

필수 R/depth/P/Q가 없으면 `semantic.cycle.parameter_missing`, 값이 0 이하이거나
R/depth 방향을 위반하면 `semantic.cycle.invalid_parameter`다.

### 6. 프로그램 제어와 실패 원자성

M0, M1, M2와 M30은 source 순서의 공개 이벤트로 보존한다.

```text
programControlEvents: [
  { sourceLine: number, control: "m0" | "m1" | "m2" | "m30" }
]
```

M0/M1은 정지 의도를 기록하되 lowering을 계속한다. M2/M30이 포함된 block의
motion은 먼저 반영하고, 그 block이 끝나면 이후 source block의 motion lowering과
modal mutation을 수행하지 않는다. 단, 이후 block도 끝까지 G/M/주소의 정적 지원
여부를 검증해 미지원 구문을 진단한다. `finalState.lastProgramControl`은 마지막 이벤트의 요약이고
`finalState.programEnd`는 `none|m2|m30`이다.

fatal 진단이 하나라도 있으면 결과 전체를 fail-closed 처리한다.

- `accepted=false`
- `toolpath=null`
- `canonicalMotions=[]`
- `programControlEvents=[]`
- `pathLengthMm.total|rapid|feed=0`
- endpoint와 final modal state는 요청 initial/default로 복원
- `programEnd=none`, `lastProgramControl=none`

따라서 오류 전 유효 motion이나 프로그램 제어를 부분 결과처럼 소비할 수
없다. M1 Toolpath schema 적합성은 별도 contract gate에서 모든 accepted
Golden 출력에 대해 검증하며, 실행 중 공개 진단 목록은 support matrix에
실제로 발생 가능한 코드만 둔다.

### 7. 진단과 source map

진단은 `code`, 1-based `line`·`column`, `severity`, `recoverable`을 항상
가진다. terminal `request.resource_limit`를 제외한 일반 진단 prefix는 source
위치와 같은 위치의 emission order로 안정 정렬한다. diagnostic cap terminal은
자체 source 위치와 관계없이 항상 마지막 entry에 둔다.

`lexer.comment.unterminated`만 해당 줄의 남은 문자를 주석으로 안전하게
대체하므로 `recoverable=true`다. 이 진단만 있으면 해당 줄의 유효 워드와
이후 줄을 계속 실행해 `accepted=true`가 될 수 있다. 나머지 오류는 실행
의미를 안전하게 대체할 수 없어 `recoverable=false`다. 알려진 H/I/J/K/R/P/Q가
현재 motion 문맥에 맞지 않으면 word 위치에 `semantic.word.context`를 낸다.

각 IR segment는 정확히 한 source line에 매핑한다. cycle expansion은 실행
줄에, 좌표-only modal repeat는 반복 줄에 매핑한다. 프로그램 제어 이벤트도
원래 M word의 source line을 보존한다.

### 8. 결정론적 ID

호출자가 `toolpathId`를 제공하면 그 UUID를 toolpath와 segment UUID 생성의
namespace로 사용한다. 제공하지 않으면 source, dialect, initial state,
operation ID, tool mapping, work offset와 H offset options 전체의 canonical
입력을 SHA-256으로 해시해 toolpath ID를 만든다. 이 custom SHA-256 UUID는
RFC 9562 version 8과 RFC variant bit를 설정한다.

segment ID는 toolpath namespace, source line, sequence와 segment kind에서
결정론적으로 만든다. 동일한 전체 입력은 동일 ID를 만들고, source가 같아도
초기 상태나 설정이 달라 경로가 달라지면 다른 ID를 만든다.

### 9. 독립 Golden Fixture

`tests/fixtures/gcode/{valid,invalid,modal,dialect}`의 source `.nc`마다 같은
basename의 `.manifest.json`을 둔다. schemaVersion `1` manifest는 입력,
초기 상태, 기대 accepted/종점/경로 길이/segment 유형/진단/source map,
프로그램 제어 이벤트, tolerance와 수학·도메인 근거를 가진다.

Golden은 구현 출력에서 복사하지 않는다. 직선은 Euclidean distance, 원호는
반경과 sweep, inch는 정확한 25.4 배, cycle은 명시적 구간 합으로 산정한다.
구현 변경만을 이유로 갱신하지 않는다. Production resource ceiling은 대형
fixture 대신 injected-limit Rust test로 검증한다.

## 결과와 비범위

후속 모듈은 canonical Toolpath IR, program control events와 source map을
소비한다. 방언 확장은 `common-v1` 회귀를 유지한 새 버전·매트릭스로 추가한다.
G41/G42, G84~G89, macro/variable, 식, 서브프로그램, G90.1/G91.1, P arc
turn lowering과 5축 lowering은 후속 ADR 없이는 지원하지 않는다.

## 검증

- JSON 매트릭스, 문서 code/status와 parser 공개 출력 일치
- TypeScript/Rust의 Golden 종점·경로·segment·진단·이벤트·source map 일치
- 같은 전체 입력 100회 Toolpath IR·진단·이벤트·ID 순서 일치
- injected-limit 경계/rollback 및 malformed fuzz의 panic·hang·silent acceptance 없음
