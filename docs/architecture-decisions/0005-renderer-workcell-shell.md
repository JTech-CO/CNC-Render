# ADR 0005: M3 렌더러·3D 작업실 셸

- 상태: 승인
- 날짜: 2026-07-29
- 적용 버전: renderer fixture `1`, Three.js `0.180.0`

## 맥락

M1은 mm 기반 좌표와 Worker 메시지 계약을, M2는 결정론적 Toolpath IR를
고정했다. M3는 이 불변 데이터를 화면에 표시하되 React 렌더 주기, 시뮬레이션
메모리와 GPU 자원 수명을 분리해야 한다. 브라우저별 WebGPU 지원 차이 때문에
단일 backend만 제공할 수 없고, 폴백이 지원 수준을 숨겨서도 안 된다.

## 결정

### 1. backend 선택과 공개 한계

`auto`는 WebGPU를 먼저 선택하고 사용할 수 없으면 WebGL 2로 폴백한다.
호출자는 진단 목적에 한해 `webgpu` 또는 `webgl2`를 요청할 수 있다.
WebGPU 초기화가 실패했지만 WebGL 2가 가능하면 안전하게 폴백하고 경고를
표시한다. 둘 다 없으면 장면을 만들지 않고 명시적 오류로 끝낸다.

현재 backend, 선택 이유와 다음 기능 차이를 작업실 inspector에 항상 노출한다.

| 항목 | WebGPU | WebGL 2 |
|---|---|---|
| 표면 프리뷰 | 최대 2048 × 2048 texel | 최대 1024 × 1024 texel |
| 공구 경로 | 최대 1,000,000 segments | 최대 250,000 segments |
| 소재 갱신 | GPU compute 준비 | CPU/WASM 메시 프리뷰 |
| 안티앨리어싱 | 4× MSAA | 최대 4× MSAA |

이 값은 M3 교육용 프리뷰 budget이다. 절삭 재료 제거 정확도나 산업용 검증
등가성을 의미하지 않는다.

### 2. 소유권과 프레임 루프

React는 canvas와 작업실 UI 셸만 소유한다. `WorkcellRenderer`가 Three.js
scene, camera, controls, GPU renderer, selection과 자원 해제를 소유한다.
프레임은 상시 실행하지 않고 camera·selection·visibility·resize가 바뀔 때만
`requestAnimationFrame`으로 무효화한다. telemetry는 ref를 통해 DOM에 쓰며
프레임마다 React state 또는 Zustand 전체 트리를 갱신하지 않는다.

renderer는 simulation이나 storage를 import하지 않는다. 이후 Toolpath와
machine state는 readonly snapshot으로 전달하며 대형 TypedArray는
Worker/WASM/GPU 메모리에 남긴다.

### 3. 장면 단위와 좌표계

M3 render boundary는 `1 scene unit = 1 mm`다. CNC domain은 Z-up
`[X, Y, Z]`, Three.js scene은 Y-up `[X, Z, -Y]`로 한 번 변환한다.
표시 단위와 내부 계산을 섞지 않으며 camera range, near/far와 inspector
수치에는 mm를 표시한다.

기계, 소재, 절삭 공구, 공구 홀더, 고정구와 공구 경로는 독립 scene layer다.
각 layer는 고유한 collision group ID와 1-bit mask를 가지지만 M3에서 실제
충돌 판정은 수행하지 않는다. Rapier를 절삭 재료 제거에 사용하지 않는다.

### 4. camera와 선택

오른쪽 drag는 Orbit, 가운데 drag는 Pan, wheel은 Zoom이다. 왼쪽 click은
semantic object selection에 남겨 둔다. 정면·평면·우측·등각 preset,
Fit과 layer focus를 제공한다. keyboard shortcut은 canvas focus 안에서만
동작하고 focus range는 `180..5000 mm`로 제한한다.

### 5. 결정론과 회귀 자산

`tests/fixtures/m3/machine-scene.fixture.json`은 고정 camera, major object
bounds와 backend별 projection matrix를 독립 Golden으로 보존한다. 같은
fixture의 WebGPU/WebGL 2 projected bounds 차이는 `0.75 px` 이하이어야 한다.
WebGL 2 software renderer의 canvas screenshot은
`machine-scene.png` 시각 회귀 기준으로 사용한다.

renderer resource snapshot은 geometry, texture와 program 수를 기록한다.
빠른 E2E는 200회 camera invalidation 뒤 자원과 React commit이 안정적인지
검사한다. 완료 전 수동 gate는 backend마다 10분 idle과 10분 camera soak를
실행한다.

### 6. Windows 빌드·production E2E 경로

Vite 8/Rolldown native bundler는 긴 비 ASCII Windows workspace에서 RSC
link 단계가 종료 코드 `0xC0000409`로 중단될 수 있다. 소스나 패키지를
복제하지 않고 `scripts/run-vinext-build.mjs`가 빌드 동안만 사용 가능한
drive letter에 같은 workspace를 `subst`로 매핑한다. 빌드 성공·실패와
관계없이 매핑을 해제한다. ASCII 경로와 Windows 이외 환경은 Vinext를
직접 실행한다.

Vinext `0.0.50`의 production static cache는 Windows `path.relative()`
결과의 `\`를 URL `/`로 정규화하지 않아 빌드된 `/assets/*`를 찾지 못한다.
`packages/e2e/start-test-server.mjs`는 production build 후 app 요청을
내부 Vinext 서버로 전달하고, `/assets/*`만 `dist/client` 아래인지 검증한
뒤 직접 제공한다. 이는 E2E 전용 workaround이며 upstream 수정 버전으로
갱신할 때 제거 여부를 재검증한다.

## 결과와 비범위

M3는 E2 정확도 배지를 표시하는 학습용 scene shell이다. 실제 controller
timing, 충돌 판정, 재료 제거, machine kinematics, 공구 보정 검증은 후속
마일스톤 범위다. WebGL 2 폴백의 budget과 기능 차이는 이후 구현에서도
문서·UI·테스트를 함께 갱신해야 한다.

## 검증

- backend capability와 공개 limit 단위 테스트
- 여섯 semantic layer·collision group 계약 테스트
- backend별 projected bounds Golden 비교
- WebGPU와 WebGL 2 viewport E2E
- camera shortcut·focus range·layer visibility E2E
- machine-scene visual regression
- renderer smoke benchmark
- 10분 idle + 10분 camera resource soak
