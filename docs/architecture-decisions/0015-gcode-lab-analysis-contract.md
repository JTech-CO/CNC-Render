# ADR-0015: G-code Lab은 지연 로드된 분석 Worker와 결정론적 진단 계약을 사용한다

- 상태: Accepted
- 날짜: 2026-09-04
- 마일스톤: M11 — G-code Lab·진단·측정·결과 비교(S1 기초)

## 맥락

M2의 Rust G-code parser는 source 위치, 지원 여부와 Toolpath source map을
결정론적으로 만들지만, 현재 브라우저 경로는 시뮬레이션 초기화 과정에서 parser를
호출한 뒤 motion과 요약 code만 보존한다. 오류가 있으면 첫 code와 message만 반환하므로
편집기 marker와 진단 목록을 정확한 원본 범위에 연결할 수 없다. 반대로 React나
Monaco extension에서 G-code를 다시 해석하면 parser와 실행 의미가 달라질 수 있다.

Monaco는 큰 선택 기능이다. 작업실의 기본 장면·학습·샌드박스 사용자가 G-code Lab에
들어가지 않았는데도 Monaco와 분석용 WASM을 초기 번들에서 내려받으면 M9의 작업실
성능 예산과 M11의 명시적 lazy-load 완료 조건을 위반한다. 또한 향후 축 한계, 충돌,
가공 경고를 같은 화면에 연결하려면 진단의 source 위치, 관련 객체와 도움말 의미를
화면별 임시 상태가 아닌 하나의 계약으로 고정해야 한다.

## 결정

### 1. G-code Lab과 분석 runtime을 Code 탭에서만 로드한다

1. 작업실의 Code 탭을 선택하기 전에는 G-code Lab 컴포넌트, Monaco editor,
   Monaco worker, G-code 분석 Worker와 분석용 WASM을 import하거나 요청하지 않는다.
2. Code 탭 진입 시 애플리케이션이 G-code Lab 경계를 동적으로 import한다. 이 경계가
   준비된 뒤 Monaco와 분석 Worker를 lazy-load하며, 로딩·실패 상태를 텍스트로
   명시한다.
3. 분석 Worker는 시뮬레이션 Coordinator Worker와 분리한다. 자체 WASM instance를
   소유하고 parser-only ABI만 호출하며 시뮬레이션 session, Stock, renderer buffer와
   재생 clock을 생성하거나 변경하지 않는다.
4. parser-only ABI는 기존 `gcode-core`의 lexer→block parser→modal state→semantic
   validator 결과를 그대로 직렬화한다. TypeScript나 Monaco provider에서 G-code
   의미를 중복 구현하지 않는다.

### 2. 분석 요청과 결과는 strict하고 결정론적이다

분석 envelope는 protocol version과 request UUID를, payload는 schemaVersion,
source text와 `common-v1` dialect를 명시한다. parser options는 해당 버전의 기본값으로
고정한다. 분석 결과는 accepted 상태, coreVersion, 원본 UTF-8 바이트의 SHA-256,
진단과 source-map을 반환한다. 더 최신
version, 알 수 없는 필드, 비유한 수치와 resource ceiling 초과는 fail-closed로
거부한다.

진단은 최소한 다음 의미를 가진다.

- `id`: 원본 hash, coreVersion, origin, code, severity, recoverable,
  source range와 안정된 emission index의 canonical 입력에서 만든 결정론적 ID
- 분석 진단의 `origin`은 `parser`다. 공간이 있는 실행 진단은 Coordinator의
  별도 `runtimeDiagnostics` 계약에서 `axis-limit | collision | machining-warning`를 사용한다.
- `code`, `severity`, `recoverable`과 원인 message
- `range.start/end.line/column`: 시작 포함·끝 제외, 1-based 위치
- `supportLevel`: `supported | recognized-unsupported | unsupported`
- `replacementAvailability: unavailable`: 안전한 자동 대체는 제공하지 않는다.
  G41/G42에는 공구 중심 경로를 직접 작성하는 수정 지침을 제공한다.
- `helpKey`: 지원 범위, 원인과 수정 방법을 조회하는 안정된 콘텐츠 key
- 실행 진단의 `objectId`, `positionMm`, `sourceLine`은 실제 엔진 증거에서만 채운다.
  parser 계약에는 공간 필드 자체가 없고 UI에서는 `3D 위치 없음`으로 표시한다.

같은 전체 입력과 parser version은 같은 진단 ID, 범위와 순서를 만든다. 표시 문구의
locale 변경은 ID를 바꾸지 않는다. 시작 위치만 있는 기존 parser 진단은 lexer가
보존한 token 또는 source block 범위로 end-exclusive 범위를 만들며 UI가 임의로
문자 폭을 추정하지 않는다.

### 3. editor와 진단 목록은 같은 ID를 선택한다

1. Monaco marker와 Diagnostic Panel item은 분석 결과의 동일한 `diagnosticId`를
   사용한다. 별도 화면용 진단을 복제해 새 ID를 만들지 않는다.
2. editor marker 또는 오류 줄을 선택하면 같은 ID의 목록 항목을 선택·노출하고,
   목록 항목을 선택하면 editor가 해당 source range를 reveal하고 focus한다.
3. 현재 줄, 오류 줄과 breakpoint는 색상뿐 아니라 서로 다른 gutter 모양,
   icon과 `현재 줄`·`오류`·`중단점` label로 구분한다.
4. parser 진단에 실제로 존재하지 않는 3D 좌표나 충돌 객체를 부여하지 않는다.
  spatial target이 없으면 3D 이동 동작을 비활성화하고 `3D 위치 없음`을
   명시한다. 이후 실제 axis-limit, collision과 machining-warning만 엔진이 제공한
   객체·좌표를 같은 진단 계약에 추가한다.

### 4. 초기 번들 제외는 build artifact로 검증한다

`pnpm check:bundle`은 전체 산출물에서 Monaco 문자열이 존재하는지를 검사하지 않는다.
Monaco는 정상적인 lazy chunk에는 존재해야 하기 때문이다. 대신 build manifest의
초기 HTML entry dependency graph를 순회해 Monaco, Monaco worker, G-code 분석
Worker와 분석용 WASM이 포함되지 않았음을 검증한다. G-code Lab lazy entry에서는
해당 자원을 찾을 수 있어야 한다. E2E는 Code 탭 진입 전 요청 0건과 진입 후 요청을
함께 확인한다.

### 5. 실행 제어의 source-line 의미를 고정한다

M11은 Rust parser의 source map에서 계산한 nullable
`currentSourceLine`을 Worker 실행 요약에 추가한다. React가 `currentStep` 또는
재생 시간으로 원본 줄을 추정하지 않는다.

- step은 canonical motion 한 개가 아니라 원본 source line 한 개를 실행하는 명령이다.
- 고정 cycle처럼 한 원본 줄이 여러 canonical motion으로 확장되면 같은 source line의
  motion을 모두 완료한 뒤 멈춘다.
- breakpoint는 해당 원본 줄의 첫 motion을 실행하기 전에 멈춘다.
- step과 breakpoint 판정은 Coordinator/Worker가 담당한다. 10 Hz UI sampling이나
  렌더 frame에서 판정하지 않는다.
- motion이 없는 modal-only 줄도 0초 source step으로 처리한다. M0/M1은 pause,
  M2/M30은 종료이며 빈 줄·주석은 실행 블록이 아니다. 별도 fixture로 검증하고 UI가
  임의로 건너뛰지 않는다. M1 optional-stop 토글은 제공하지 않아 항상 멈춘다.

### 6. 단위, 정확도와 데이터 소유권을 유지한다

source와 진단 위치에는 물리 단위를 섞지 않는다. 향후 진단의 공간 좌표와 측정값은
canonical `mm`/`rad`를 사용하고 inch/degree는 표시 경계에서만 변환한다. 표시
반올림 값을 분석, 실행, 저장 또는 비교 입력으로 되돌리지 않는다.

G-code Lab과 결과 화면은 현재 Stock 해상도와 함께 E2 교육용 근사 및 산업용 검증이
아니라는 고지를 유지한다. `S1 기초`라는 마일스톤 이름만으로 8 mm 밀링 덱셀이나
1 mm 선반 layer 결과를 S1 정밀도로 재표기하지 않는다.

전체 source map, Toolpath, 편차 field와 대형 TypedArray는 분석 Worker,
Simulation Worker 또는 renderer가 소유한다. React에는 선택된 진단 ID, 현재 줄,
작은 진단 summary와 표시 상태만 투영하며 시뮬레이션 frame마다 commit하지 않는다.

## 대안 검토

- Monaco와 parser를 작업실 초기 client entry에 정적 import하는 방식은 장면·학습
  사용자도 큰 편집기와 분석 runtime을 받으므로 선택하지 않았다.
- 시뮬레이션용 WASM instance를 분석과 공유하는 방식은 편집 중 debounce 분석이 실행
  session과 output buffer를 교란할 수 있으므로 선택하지 않았다.
- Monaco language provider에서 정규식으로 G-code 지원 여부를 판정하는 방식은 Rust
  parser와 모달·방언 의미가 갈라지므로 선택하지 않았다.
- parser 오류를 마지막 유효 공구 위치에 표시하는 방식은 실제 오류 위치라는 잘못된
  인상을 주므로 선택하지 않았다.
- breakpoint를 UI summary 수신 시 판정하는 방식은 throttling 사이의 source line을
  건너뛸 수 있으므로 선택하지 않았다.

## M11 후속 구현 — 실행·측정·비교·내보내기 (2026-09-08)

- 편집은 150 ms debounce 분석과 요청 세대 비교를 사용한다. source map과 program
  control 배열은 UI 상태에 넣지 않고 진단·metadata만 투영한다. 실행은 같은 편집 source를
  Coordinator에 넘기며 React 작업실 전체가 아니라 Lab만 최대 10 Hz 요약을 구독한다.
- `startPaused`, `simulation.step-source-line`, `simulation.breakpoints` 명령과
  `currentSourceLine`, `nextSourceLine`, `paused`, `pauseReason`으로 실행을 제어한다.
  Rust가 modal-only 줄과 M0/M1/M30도 source-block 순서대로 다룬다. 같은 줄의 cycle
  확장은 한 source step에 묶이고, breakpoint는 첫 motion 전에 멈춘다. 기존 canonical
  motion ABI는 유지하며 실행 제어 메타데이터는 기존 Stock/semantic hash에 섞지 않는다.
- 런타임 축 한계·충돌·비절삭 feed 경고는 실제 object·source·position과 연결한다.
  3D 마커와 코드·목록 선택은 같은 ID를 사용한다. parser 오류에 위치를 합성하지 않는다.
- 완료 또는 진단으로 중단된 Stock snapshot과 별도 작성한 M10 목표를 dedicated comparison Worker에서 비교한다.
  결과 Float64 field는 renderer-side comparison view가 소유하고 React에는 유한 scalar
  report만 둔다. Overlay/Split/Heatmap은 동일 field를 투영하며 표시 모드가 통계를 바꾸지 않는다.
- 화면은 최대 4,096개의 실제 표본을 결정론적으로 선택해 그리기·정렬·picking 비용을
  제한한다. 생략 여부를 표시하며 원본 전체 field와 Worker 통계 정밀도는 변경하지 않는다.
- 3D에는 최대 256개 마커를 표시하되 선택한 진단을 우선 포함하여 그 이후 진단도 이동할
  수 있다. 진단 목록은 50개씩 페이지를 나누며 선택 ID가 속한 페이지로 이동한다.
  전송 진단은 최대 10,000개이며 경고가 상한에 도달해도 마지막 축 한계·충돌 증거는
  반드시 보존한다. 초과 경고만 생략하므로 보고서 개수는 보존된 실행 진단 개수다.
- 좌표 또는 Stock 표면 sampling으로 거리·직경·반경·각도·깊이·벽 두께를 측정한다.
  길이 mm, 각도 rad를 저장하고 in/deg는 표시 전용이다. 직경/반경의 중심점 및 평행
  기준면 법선은 사용자가 지정하며 CAD feature 자동 인식·최소 벽두께 탐색은 수행하지 않는다.
- JSON/CSV/인쇄 HTML은 화면과 동일 report와 metric 정의를 사용한다. HTML escaping과
  CSV formula injection 방어를 적용한다. provenance에는 run/fixture·state/Stock hash,
  가공 추정 시간, 완료/중단 구분과 충돌·경고·진단 개수를 기록한다.
- 새 실행은 이전 비교·내보내기를 즉시 무효화한다. M8 불러오기는 renderer checkpoint만
  복원하므로 기존 실행 세션과 혼합한 비교를 거부하고 재실행을 요구한다. snapshot 전후의
  run ID와 terminal 상태도 검증하여 측정 중 실행 변경을 거부한다.
- 결과 상태는 별도 `M11ResultBridge`의 안정된 scalar snapshot을 결과 Loader만 구독한다.
  같은 run summary는 알림을 만들지 않으며 결과 화면이 없어도 새 실행·복원 출처를
  보존한다. 시뮬레이션이 작업실 React commit 수를 늘리는 회귀는 허용하지 않는다.
- 편집 코드는 세션 한정이다. M8의 대표 fixture 저장은 새 대표 공정을 재실행하는
  기존 계약이므로 Code 탭의 헤더 저장은 명시적으로 거부하고 편집 source·Stock을
  보존한다. 프로젝트에 편집 source를 영속화하는 기능은 이번 단위에 포함하지 않는다.

## 결과와 제한

- G-code Lab 진입 전 초기 번들을 유지하면서 실제 Rust parser의
  미지원 코드 진단을 Monaco와 Diagnostic Panel에 같은 ID로 연결할 수 있다.
- 지원 매트릭스에는 support level과 별도로 작성된 replacement/help 정보가 필요하다.
  `recoverable`과 `replacement`는 같은 의미가 아니며 서로 추론하지 않는다.
- parser 진단은 editor↔목록, 공간 증거가 있는 실행 진단은 editor↔목록↔3D로 연결한다.
- 비교는 밀링 상면 dexel과 회전 Stock 반경 profile 범위다. 임의 CAD 목표 import,
  산업용 최소 벽두께·표면조도·열변형 검증, 자동 공구 보정은 포함하지 않는다.
- 비교 목표는 대표 공정으로 독립 작성되어 있다. 사용자가 코드를 바꿔도 목표를 결과에
  맞춰 역산하지 않으므로 편차가 생길 수 있으며 보고서에 targetId를 노출한다.

## 검증

- contract test가 strict 분석 request/result, 1-based end-exclusive range,
  결정론적 ID, 자동 대체 불가와 실제 실행 공간 증거를 검증한다.
- Rust test가 기존 Golden의 진단 code·범위·순서와 parser-only ABI 결과가 같음을
  검증한다.
- E2E가 Code 탭 진입 전/후 resource 요청과 editor↔목록 양방향 선택을 검증한다.
- visual test가 오류 marker, gutter icon·label과 Diagnostic Panel의 동일 오류 상태를
  고정한다.
- bundle manifest gate가 Monaco·분석 Worker·분석 WASM의 초기 entry 유입을 거부한다.
