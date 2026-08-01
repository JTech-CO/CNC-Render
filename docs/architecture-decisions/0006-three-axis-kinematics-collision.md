# ADR 0006: M4 3축 운동학·충돌 검증

- 상태: 승인
- 날짜: 2026-08-01
- 적용 버전: kinematics fixture `1`, collision fixture `1`

## 맥락

M1은 mm 기반 MachineDefinition과 simulation event 계약을, M2는 source map을
포함한 결정론적 Toolpath IR를, M3는 renderer-owned scene과 on-demand frame
loop를 고정했다. M4는 이 경계를 깨지 않고 3축 VMC의 축 위치를 TCP 위치로
변환하고 축 동작을 검증한 뒤, 시각 메시와 독립된 단순 형상으로 충돌을 찾아
기존 Worker 이벤트와 작업실 진단에 연결해야 한다.

충돌 검사 실패를 안전으로 해석하면 안 된다. 같은 입력·버전·설정에서는
축 진단, 충돌 순서와 정지 프레임이 반복 실행마다 같아야 한다.

## 결정

### 1. 좌표·운동학 계약

M4 계산 경계는 JavaScript와 Rust 모두 IEEE-754 `f64`와 canonical mm를
사용한다. 축 입력은 MachineDefinition의 절대 축 좌표이며 TCP는 다음처럼
계산한다.

```text
TCP = tcpAtHome + Σ directionUnit(axis) × (position - home)
```

`tcpAtHomeMm`은 모델 자산에서 암묵적으로 추측하지 않고 기계 보정 입력으로
명시한다. 결과의 axis map은 kinematic tree 순서로 직렬화하고 `-0`은 `0`으로
정규화한다.

초기 범위는 다음 조건을 모두 만족하는 VMC만 허용한다.

- 정확히 세 개의 linear axis
- 하나의 root와 분기 없는 parent-child chain
- 서로 직교하는 finite unit direction
- finite이며 `min < home < max` 또는 inclusive boundary에 놓인 travel range

rotary axis, branch, 비직교 방향과 잘못된 수치는 근사하지 않고 configuration
error로 거부한다. 3+2축과 동시 5축은 M13 범위다.

### 2. 축 보간과 동작 guard

축 위치의 최소·최대는 inclusive이고 수치 비교 허용치는 `1e-9 mm`다.
각 segment의 선형축 속도는 `abs(Δposition / Δtime) × 60` mm/min으로,
TCP feed는 3차원 이동 거리와 segment 시간으로 계산한다. 가속도는 인접
segment 속도의 차이를 두 segment midpoint 사이 시간으로 나눈 mm/s²다.

보간은 모든 축의 최대 이동량을 기준으로 고정된 최대 mm step 이하가 되도록
분할한다. 시간은 엄격히 증가해야 하고 한 segment는 최대 1,000,000 step이다.
누락·미지·비finite 축, 역전 시간, step 상한 초과는 진단 또는 예외로
fail-closed 처리한다.

### 3. TypeScript와 Rust 경계

`@cnc-render/simulation`은 browser에서 사용하는 renderer·storage 독립
reference implementation을 소유한다. `cnc-render-simulation-core`는 같은
Golden Pose를 계산하는 Rust `f64` core와 CLI를 제공한다. pose fixture는
100회 반복과 별도 프로세스에서 TypeScript와 Rust 결과가 허용치 `1e-9 mm`
이내이며 byte-stable인지 확인한다.

실제 Worker/WASM coordinator 연결은 M7 범위다. M4는 대형 TypedArray를
React나 Zustand로 옮기지 않으며 공개 event contract를 변경하지 않는다.

### 4. 충돌 형상과 단계

renderer visual object와 collision proxy는 서로 다른 ID와 수명을 가진다.
현재 proxy는 sphere와 axis-aligned box이며 visual geometry, Three.js object,
triangle mesh를 포함하지 않는다.

1. group과 양방향 bit mask로 검사 대상 pair를 제한한다.
2. X축 정렬 Sweep and Prune와 3축 AABB overlap으로 broad phase를 수행한다.
3. sphere-sphere, sphere-box, box-box 분석식으로 narrow phase와 penetration을
   계산한다.
4. penetration이 `1e-9 mm`보다 큰 contact만 이벤트로 만든다.

rapid 이동은 proxy translation을 문서화된 최대 step으로 보간해 endpoint
사이 충돌을 검사한다. frame·proxy·shape·mask·run ID가 잘못되면
`CollisionInputError`로 중단하며 빈 collision 결과를 반환하지 않는다.

### 5. 이벤트·정지 순서

충돌은 M1 `simulation.collision` schema를 그대로 사용한다. 각 이벤트에는
run ID, monotonic sequence, simulation time, warning/stop severity, 정렬된 두
object UUID, world position mm, 양의 penetration estimate와 nullable source
line이 포함된다.

pair는 object ID 순서로 안정 정렬하고 contact 진입 시 한 번만 이벤트를
발행한다. 같은 frame의 동시 contact는 모두 발행한 뒤 stop severity가 하나라도
있으면 그 frame에서 timeline을 중단한다. 이 규칙으로 object 누락과 실행별
순서 변화를 막는다.

### 6. renderer frame과 UI 연결

simulation은 renderer를 import하지 않는다. app composition root가 stop
event의 world position을 `WorkcellRenderer.setCollisionMarker()`에 전달하고
on-demand frame을 invalidation한다. 3D marker가 그려진 frame의 telemetry를
받은 뒤에만 UI 상태를 `stopped`로 전환한다.

정지 진단은 다음 네 경로를 동시에 제공한다.

- viewport의 명시적 정지 문구
- 두 semantic object 이름과 UUID 연결
- mm 단위 3D marker 위치
- 원본 G-code 줄 강조와 diagnostics count

frame telemetry와 stop 표시는 DOM ref로 갱신한다. 시뮬레이션 frame마다
React state 또는 Zustand tree를 갱신하지 않는다.

## 정확도와 비범위

M4 결과는 교육용 E2 검증이다. sphere/AABB proxy와 bounded interpolation은
현재 Golden fixture에 맞는 보수적 단순화이며 다음 항목을 보증하지 않는다.

- 임의 triangle mesh, convex hull, capsule/cylinder narrow phase
- controller look-ahead, jerk, servo following error와 실제 정지 거리
- rotary axis, 3+2축, 동시 5축, 기계 link 자체 충돌
- 산업용 CAM verification 또는 실제 기계 안전 인증과의 등가성

Rapier를 재료 제거 엔진으로 사용하지 않는다. M4 충돌 core도 Rapier에
의존하지 않으며 이후 보조 rigid-body 기능을 도입해도 절삭 제거와 경계를
유지한다.

## 결과

- Golden Pose, home/min/max, rapid/feed, velocity/acceleration boundary가
  결정론적으로 검증된다.
- safe fixture는 0 event, impact fixture는 cutter·holder·chuck·vise pair와
  source line을 누락 없이 반환한다.
- WebGPU와 WebGL 2는 같은 CPU collision event를 소비하며 기능 차이가 없다.
- visual mesh와 collision proxy, simulation과 renderer 의존 방향이 분리된다.

## 검증

- `pnpm test:unit --filter kinematics-3axis`
- `pnpm test:unit --filter collision`
- `pnpm test:parity --filter poses`
- `pnpm test:e2e --grep "collision-stop"`
- `pnpm bench --filter collision-fixtures`
- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets --locked -- -D warnings`
- `pnpm verify`
