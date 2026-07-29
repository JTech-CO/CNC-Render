# ADR 0003: M1 도메인·단위·Worker 계약

- 상태: 승인
- 날짜: 2026-07-26
- 적용 버전: project schema `1`, Worker protocol `1`

## 맥락

M2 이후의 파서, 시뮬레이션, 렌더링과 저장 구현은 같은 기계·공구·소재·공정
의미를 공유해야 한다. 단위 없는 숫자, UI 표시 반올림의 영속 값 혼입,
TypeScript와 Rust의 서로 다른 직렬화, 실행 세대가 다른 Worker 이벤트 유입은
후속 계산을 복구하기 어렵게 만든다.

M1은 실제 G-code 실행이나 재료 제거를 구현하지 않는다. 대신 이후 모듈이
의존할 수 있는 공개 wire contract와 실패 규칙을 먼저 고정한다.

## 결정

### 1. 단일 저수준 계약 패키지를 둔다

TypeScript 계약은 `@cnc-render/contracts`, Rust 계약은
`cnc-render-contracts`가 소유한다. 두 구현은 UI, simulation, renderer,
storage, 브라우저 API와 영속 저장소 구현에 의존하지 않는다.

계약 범위는 다음과 같다.

- `ProjectSchema`
- `MachineDefinition`
- `MaterialProfile`, `Setup`
- `ToolAssembly`
- `Stock`
- `Operation`
- `ToolpathIR`
- `SimulationEvent`
- Worker command/event envelope
- 단위 변환, RFC 8785 canonical JSON과 의미 해시

`MaterialProfile`과 `Setup`은 독립 기능이 아니라 `Stock.materialId`와
`Operation.setupId`의 참조 무결성을 위해 포함한다.

### 2. wire 이름에 단위를 포함한다

| 물리량 | canonical 단위 | wire 이름 예 |
|---|---|---|
| 길이·좌표 | `mm` | `diameterMm`, `positionMm` |
| 계산 각도 | `rad` | `minRad`, `rotationRad` |
| 시간 | `s` | `timeS`, `durationS` |
| 직선 축 속도 | `mm/min` | `maxVelocityMmPerMin` |
| 직선 축 가속도 | `mm/s²` | `maxAccelerationMmPerS2` |
| 회전 축 속도 | `rad/s` | `maxVelocityRadPerS` |
| 회전 축 가속도 | `rad/s²` | `maxAccelerationRadPerS2` |
| 주축 회전수 | `rpm` | `spindleSpeedRpm` |
| 분당 이송 | `mm/min` | `feedMmPerMin` |
| 회전당 이송 | `mm/rev` | `feedMmPerRev` |
| 날당 이송 | `mm/tooth` | `feedMmPerTooth` |

`unitSystem`은 표시 선호다. 영속 수치와 계산 수치는 항상 canonical 단위를
사용한다. inch와 degree 입력은 계약 경계에서 한 번 변환하며, 표시 반올림은
저장 값과 분리한다.

모든 수치는 유한해야 하며 `-0`은 wire 경계에서 거부한다. 직경·해상도·이송·
회전수처럼 물리적으로 양수인 값은 `0`보다 커야 한다. 축은 `min < max`이고
home은 해당 범위 안에 있어야 한다.

`Operation.feed`는 분당·회전당·날당 가공 입력을 보존한다. M1
`ToolpathIR`의 이동 segment에 기록되는 `feedMmPerMin`은 공구·주축 조건을
적용한 뒤의 canonical resolved feed다. `feedMode`와 `spindleMode`는 원본
프로그램 또는 controller mode의 provenance이며, per-tooth 입력은 Toolpath를
만들기 전에 resolved feed로 변환한다. 실제 modal 해석은 M2 범위다.

### 3. 식별자, 시간과 버전을 고정한다

- 영속 엔티티와 Worker 메시지 ID는 길이 36의 RFC 9562 UUID다.
- UUID version은 1~8, variant는 RFC variant만 허용하며 nil/max UUID와 끝
  개행은 거부한다.
- 시간 문자열은 실제 달력과 시각 범위를 만족하는 UTC RFC 3339다.
- 모든 영속·직렬화 최상위 모델은 정수 `schemaVersion: 1`을 가진다.
- 프로젝트 JSON Schema `$id`는 `urn:cnc-render:schema:project:1`이다.
- Worker envelope는 `protocolVersion: 1`을 가진다.
- payload의 `schemaVersion`과 transport의 `protocolVersion`은 서로 다른
  버전 경계다.
- nullable wire key는 생략하지 않고 `null` 또는 값으로 명시한다.
- 알 수 없는 필드, 더 새로운 스키마와 지원하지 않는 메시지 종류는 거부한다.

호환되지 않는 프로젝트 변경은 `schemaVersion`과 schema URN을 함께 올린다.
호환되지 않는 Worker envelope나 payload 변경은 `protocolVersion`을 올린다.

### 4. 구조 스키마와 의미 검증을 함께 제공한다

Zod runtime schema는 strict object와 discriminated union으로 wire 구조를
검사한다. JSON Schema draft 2020-12 artifact는 같은 구조를
`additionalProperties: false`로 발행한다.

축 범위, home, 그래프 cycle, 참조 무결성, 공구 형상 관계처럼 JSON Schema로
표현되지 않는 교차 필드 규칙은 TypeScript와 Rust의 semantic validator가
동일하게 검사한다. 따라서 JSON Schema만 통과한 값은 아직 완전한 프로젝트가
아니며 공개 `ProjectSchema` 또는 Rust `Project::from_json_*` 검증까지
통과해야 한다.

프로젝트는 기계, 재료, 설정, 공구, 소재, 공정과 Toolpath 컬렉션을 포함한다.
전역 중복 ID, 누락 참조, 축 parent cycle, 잘못된 root, collision group의
resource 참조와 tool-change의 공구 참조를 거부한다.

자원 설명자는 정규화된 상대 `/` 경로, 역할, 미디어 타입, 안전한 정수 바이트
길이와 소문자 SHA-256을 가진다. 절대·드라이브·UNC 경로, 역슬래시, 빈
세그먼트, `.`·`..`, 제어 문자, Unicode NFC 또는 대소문자 정규화 충돌을
거부한다. 자원은 데이터이며 URL, 스크립트 또는 모듈로 실행하지 않는다.

ZIP magic·CRC·압축률·스트리밍 한도와 OPFS 원자적 import는 M8 importer
책임이다. M1은 JSON 계약과 순수 검증만 제공한다.

### 5. Worker 메시지는 명시적 JSON envelope를 사용한다

공통 envelope는 `protocolVersion`, `messageId`, `kind`, `type`, `runId`,
run별 `sequence`, `replyTo`와 typed `payload`를 가진다. sequence는 같은
kind와 run 안에서 단조 증가해야 하며 중복 message ID와 오래된 순서를
거부한다.

command의 `replyTo`는 명시적 `null`이다. `worker.ready`는
`worker.handshake`에, `project.accepted`·`project.rejected`는 같은 run의
`project.load`에 답해야 한다. 그 밖의 선택적 `replyTo`도 이미 수락된
message ID와 run이 일치해야 한다.

M1은 handshake, project load, run dispose와 ready, project accepted,
project rejected, simulation event, error 메시지만 고정한다. `run.dispose`는
즉시 stale-event barrier를 세우는 one-way terminal command이며 별도 ack는
M1에 두지 않는다. 재생 시계, play/pause/seek/cancel, replay, dispose ack와
실제 Worker lifecycle은 M7 범위다.

대형 바이너리는 JSON payload나 UI Store에 넣지 않는다. JSON에는 불투명
binary handle 설명자만 두고 실제 버퍼는 Transferable,
`SharedArrayBuffer` 또는 명시적 copy fallback으로 전달한다.
`ToolpathIR.segments`처럼 의미가 있는 구조 JSON은 프로젝트에 영속될 수
있지만, 대형 수치 배열·복셀·덱셀·SDF·메시·checkpoint는
Worker/WASM/GPU가 소유한다.

### 6. semantic parity는 RFC 8785와 SHA-256으로 검증한다

의미 해시 입력은 다음 순서로 canonicalize한다.

1. 객체 키를 UTF-16 code unit 순서로 정렬한다.
2. 배열 순서는 보존한다.
3. 숫자는 IEEE-754 double 의미로 정규화하고 ECMAScript 숫자 표기로 기록한다.
4. `NaN`, `Infinity`와 `-0`은 canonicalize 전에 거부한다.
5. 문자열, 불리언과 `null`은 RFC 8785 JSON 표현을 사용한다.
6. UTF-8 canonical bytes에 SHA-256을 적용한다.

Rust는 raw `serde_json::Number`도 double 의미로 정규화한 뒤 JCS를 적용해
JavaScript의 JSON number 의미와 맞춘다. ZIP timestamp, 압축 바이트와
resource 본문은 프로젝트 JSON 의미 해시에 포함되지 않는다. 프로젝트에
기록된 resource descriptor와 checksum은 의미 해시에 포함된다.

TypeScript와 Rust는 같은 프로젝트 fixture와 기대 SHA-256을 사용한다.
숫자 지수 경계, 안전 정수 경계와 Unicode 키 정렬도 별도 parity case로
검증한다.

## 검증

- Zod runtime validation과 생성 JSON Schema를 byte-stable artifact로 비교한다.
- TypeScript unit test가 단위 golden case, 표시 반올림 분리와 저장 왕복
  정밀도를 확인한다.
- TypeScript와 Rust contract test가 유효·무효 fixture와 같은 semantic hash를
  확인한다.
- dependency-cruiser가 계약 패키지에서 구현 패키지 또는 앱으로 향하는
  import를 실패 처리한다.
- CI가 TypeScript parity와 Rust 실행 테스트를 모두 수행한다.

## 비범위

- G-code lexer, modal state와 Toolpath 생성·실행: M2
- Three.js renderer와 작업실: M3
- 운동학과 충돌: M4
- 소재 표현과 재료 제거: M5·M6
- 실제 Worker Coordinator와 재생 lifecycle: M7
- ZIP, OPFS, IndexedDB, 마이그레이션과 체크포인트: M8
- React/Zustand UI와 튜토리얼: M9·M10
