# CNC Render — Codex 작업 하네스 (Harness)

**버전**: 0.1  
**작성일**: 2026년 7월 26일  
**대상 도구**: OpenAI Codex  
**관계 문서**: 루트 `AGENTS.md`(전역 규칙·불변식), `PROGRESS.md`(상태 인계), `docs/technical-whitepaper.md`, `docs/design-whitepaper.md`, `docs/terminology.md`, `docs/architecture-decisions/`

> 이 문서는 CNC Render에서 **무엇을 만드는가**가 아니라 **어떤 순서로 구현하고, 무엇으로 완료를 판정하며, 실패 시 어디까지 되돌아가는가**를 정의합니다. 각 Phase의 완료는 화면이 열리거나 코드가 실행되는 상태가 아니라, 재현 가능한 명령으로 측정된 Definition of Done(DoD)을 전부 통과한 상태입니다.

---

## 0. 사용법

### 0.1. Codex 세션 루프

1. **시작**
   - 루트 `AGENTS.md`를 읽습니다.
   - `PROGRESS.md`에서 현재 Phase, 직전 완료 항목, 다음 작업, 미결 질문, 결정 로그를 확인합니다.
   - 해당 Phase가 참조하는 기술·디자인 백서 절과 ADR을 읽습니다.
2. **작업**
   - 한 세션에서 원칙적으로 하나의 Phase 또는 하나의 검증 가능한 하위 작업만 수행합니다.
   - 핵심 수치 로직은 UI보다 먼저 순수 함수·Rust 테스트·고정 Fixture로 검증합니다.
   - 기능 추가와 리팩터링을 한 커밋에 섞지 않습니다.
3. **검증**
   - 작업 단위가 끝날 때 해당 Phase의 명령을 실행합니다.
   - 실패한 테스트를 삭제하거나 기준값을 낮추지 않습니다.
4. **종료**
   - `PROGRESS.md`를 갱신합니다.
   - 변경 파일, 실행한 검증, 결과, 남은 위험을 기록합니다.
   - 검증이 통과한 범위만 커밋합니다.

### 0.2. Phase 완료 판정

- DoD가 하나라도 미달이면 해당 Phase는 미완료입니다.
- `build 성공`, `에러 없음`, `화면이 보임`은 단독 완료 조건이 아닙니다.
- 성능·정확도·정합성 기준은 테스트 장비와 실행 환경을 함께 기록합니다.
- 실패를 숨기는 자동 폴백은 허용하지 않습니다. 폴백이 발생하면 UI·로그·테스트에서 식별 가능해야 합니다.
- `M13 — 5축`은 MVP 필수 범위가 아닙니다. M12까지 통과한 뒤 별도 브랜치 또는 승인된 마일스톤에서 진입합니다.

### 0.3. 의존 순서

```text
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10 → M11 → M12
                                                                  └→ M13
```

- M3 렌더링 셸과 M2 G-code 코어의 내부 구현은 일부 병렬 가능하지만, M7 통합 전까지 계약 테스트가 고정되어야 합니다.
- M5 밀링 재료 제거와 M6 선반 재료 제거는 공통 Stock API가 M1에서 확정된 뒤에만 병렬 진행할 수 있습니다.
- M13 5축은 M4의 3축 운동학·충돌 구조를 우회하여 별도 구현하지 않습니다.

### 0.4. `PROGRESS.md` 최소 구성

```markdown
# CNC Render Progress

- Current phase:
- Status: not-started | active | blocked | complete
- Last completed:
- Next task:
- Validation run:
- Open questions:
- Known regressions:

## Decision log
| Date | Decision | Reason | Affected files |
|---|---|---|---|
```

### 0.5. 루트 `AGENTS.md` 필수 불변식

1. UI는 **라이트모드 전용**입니다. 다크 테마 토큰·토글·시스템 테마 자동 반영을 추가하지 않습니다.
2. React는 UI 셸만 담당합니다. 시뮬레이션 프레임마다 React/Zustand 전체 트리를 갱신하지 않습니다.
3. 복셀·덱셀·SDF·대형 TypedArray는 Zustand에 저장하지 않습니다. Worker/WASM/WebGPU 메모리에 둡니다.
4. G-code 파서, Toolpath IR, 운동학, 충돌, 재료 제거, 렌더링은 모듈 경계를 유지합니다.
5. Rapier를 절삭 재료 제거 엔진으로 사용하지 않습니다.
6. WebGPU 전용 구현을 만들 때는 WebGL 2 폴백의 기능 차이를 명시하고 테스트합니다.
7. 동일 입력·버전·설정·시드에서 결과가 결정론적으로 재현되어야 합니다.
8. 수치 계산의 내부 단위는 SI 기반 또는 문서화된 정규 단위 하나로 통일하며, 표시 단위와 분리합니다.
9. 산업용 검증 도구와 동일하다고 표현하지 않습니다. E1/E2/S1/S2 정확도 등급을 노출합니다.
10. 네온, 글로우, 배경 그라데이션, backdrop blur, 상시 CSS 애니메이션, 입체 베벨, 원형 계기판 UI를 추가하지 않습니다.
11. 핵심 수치에는 단위를 표시하고 `NaN`, `Infinity`, 단위 없는 값이 사용자 화면에 노출되지 않게 합니다.
12. 테스트를 삭제·완화하거나 성능 기준을 임의로 낮춰 Phase를 통과시키지 않습니다.

### 0.6. 표준 검증 명령

M0에서 다음 스크립트를 루트 `package.json`에 생성하고 이후 모든 Phase에서 동일한 명령을 사용합니다.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contracts
pnpm test:parity
pnpm test:e2e
pnpm test:visual
pnpm test:a11y
pnpm cargo:check
pnpm build
pnpm bench
pnpm check:bundle
pnpm check:forbidden-ui
pnpm verify
```

`pnpm verify`는 최소한 `lint → typecheck → cargo:check → test:unit → test:contracts → build`를 순서대로 실행해야 합니다. E2E·시각 회귀·벤치마크는 CI의 별도 Job으로 분리할 수 있으나 릴리스 게이트에서는 모두 실행합니다.

---

## 1. Phase별 진입조건 · 할 일 · DoD · 검증

### M0 — 저장소 기반·문서 정합성

- **진입조건**: 신규 저장소 또는 초기 스캐폴딩 상태.
- **할 일**: `AGENTS.md` → `PROGRESS.md` → pnpm workspace → React/Vite 앱 → Rust workspace → 공통 scripts → CI skeleton → 문서 배치.
- **참조**: 기술 백서 §3, §6, §7, §12 / 디자인 백서 §6, §9.
- **DoD**:
  1. Node, pnpm, Rust 버전이 `.tool-versions` 또는 동등 파일과 CI에 고정되어 있습니다.
  2. `pnpm verify`가 빈 스캐폴딩에서 성공합니다.
  3. UI, simulation, renderer, storage 패키지 간 금지된 역방향 import가 lint에서 차단됩니다.
  4. 기술 백서의 라이트/다크 테마 충돌이 **라이트모드 전용**으로 정정되어 있습니다.
  5. 이전 저장 확장자를 `.cncrender` 또는 승인된 최종 확장자로 통일하고 schema ID와 MIME 초안을 기록합니다.
  6. `docs/terminology.md`에 한국어·영어 CNC 용어와 금지 혼용어가 정의되어 있습니다.
  7. 시크릿, 빌드 산출물, WASM 생성물, 대형 테스트 모델이 `.gitignore`와 LFS 정책에 맞게 분리되어 있습니다.
- **검증**:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm exec dependency-cruiser apps packages crates
rg -n "CNC[v]erse|\.cnc[v]erse|dark[ ]mode|다크[ ]모드" docs apps packages crates
```

- **주의**: 템플릿의 디렉터리를 모두 빈 폴더로 만들지 않습니다. 실제 책임이 생길 때 모듈을 생성합니다.

### M1 — 도메인 스키마·단위·계약 ★

- **진입조건**: M0 완료.
- **할 일**: `ProjectSchema` → `MachineDefinition` → `ToolAssembly` → `Stock` → `Operation` → `ToolpathIR` → `SimulationEvent` → Worker message contract → Rust/TypeScript schema parity.
- **참조**: 기술 백서 §2.5~§2.7, §4.2, §7.3, §11.1.
- **DoD**:
  1. 모든 영속 모델에 `schemaVersion`이 있으며 Zod/JSON Schema와 Rust 타입이 대응합니다.
  2. mm↔inch, rpm, mm/min, mm/rev, mm/tooth, degree↔radian 변환 Golden Case가 왕복 오차 허용치 이내입니다.
  3. 표시 반올림과 내부 정밀도가 분리되어 저장→로드 후 내부 값이 변하지 않습니다.
  4. `NaN`, `Infinity`, 음수 직경, 0 이하 이송, 축 범위 역전 값이 계약 계층에서 거부됩니다.
  5. TypeScript↔Rust 직렬화 Fixture 100%가 동일한 의미 해시를 생성합니다.
  6. 대용량 바이너리 필드가 UI Store 계약에 포함되지 않습니다.
- **검증**:

```bash
pnpm test:contracts
pnpm test:parity --filter schema
pnpm test:unit --filter units
pnpm cargo:check
```

- **불변식**: 단위가 명시되지 않은 거리·각도·속도 필드는 새로 추가하지 않습니다.

### M2 — G-code 파서·모달 상태·Toolpath IR ★

- **진입조건**: M1 계약 고정.
- **할 일**: Lexer → Block Parser → Modal State Machine → Semantic Validator → Canonical Motion → Toolpath IR → Source Line Map.
- **참조**: 기술 백서 §4.3~§4.4, §9.2.
- **DoD**:
  1. G0/G1/G2/G3, G17/18/19, G20/21, G54~59, G90/91, G94/95, G96/97, G43/49, G81~89의 지원 매트릭스가 코드·문서·테스트에서 일치합니다.
  2. M3/M4/M5, M6, M8/M9, M0/M1/M2/M30과 T/S/F/X/Y/Z/A/B/C/I/J/K/R/P/Q가 명시적으로 파싱 또는 미지원 진단됩니다.
  3. 동일 프로그램을 100회 파싱해 Toolpath IR 스냅샷과 진단 순서가 동일합니다.
  4. 절대/증분, mm/inch, 평면 변경, 원호 중심·반경 표현의 Golden Fixture가 기대 종점과 경로 길이에 일치합니다.
  5. 오류는 줄·열·코드·심각도·대체 가능 여부를 포함하며 파서 panic 또는 무한 루프가 없습니다.
  6. 지원하지 않는 제조사 매크로를 조용히 무시하지 않습니다.
  7. Source line ↔ IR segment 매핑이 100% 유지됩니다.
- **검증**:

```bash
pnpm test:unit --filter gcode
pnpm test:contracts --filter toolpath-ir
pnpm test:parity --filter gcode
pnpm cargo:check
pnpm fuzz:gcode -- --time=60
```

- **주의**: 초기 공통 부분집합을 Fanuc/Haas/LinuxCNC 전체 호환으로 표시하지 않습니다.

### M3 — 렌더러·3D 작업실 셸

- **진입조건**: M1 완료. M2는 독립 진행 가능하나 Toolpath 계약은 변경 금지.
- **할 일**: Capability detection → WebGPU renderer → WebGL 2 fallback → scene graph → machine/stock/tool layers → camera controls → semantic overlays → render loop telemetry.
- **참조**: 기술 백서 §2.1, §3, §4.1, §4.6 / 디자인 백서 §2.1~§2.2, §7.5.
- **DoD**:
  1. WebGPU 지원 환경은 WebGPU, 미지원 환경은 WebGL 2로 기동하며 현재 모드와 제한이 표시됩니다.
  2. Machine, stock, cutter, holder, fixture, toolpath가 독립 레이어와 collision group ID를 가집니다.
  3. Orbit/Pan/Zoom/Fit/Front/Top/Right/Isometric 조작과 포커스 범위가 E2E로 검증됩니다.
  4. WebGPU와 WebGL 2에서 동일 카메라 Fixture의 주요 객체 투영 바운딩 박스 차이가 승인된 허용치 이내입니다.
  5. 10분 유휴 및 10분 카메라 조작 후 WebGL/WebGPU 리소스 수가 지속 증가하지 않습니다.
  6. React commit이 렌더 프레임 속도와 1:1로 발생하지 않습니다.
  7. 흰색 공작물도 기본 `#E9EDF1` 계열 배경에서 실루엣이 식별됩니다.
- **검증**:

```bash
pnpm test:e2e --project=chromium-webgpu --grep "viewport"
pnpm test:e2e --project=chromium-webgl2 --grep "viewport"
pnpm test:visual --grep "machine-scene"
pnpm bench --filter renderer-smoke
```

- **주의**: 칩·냉각수·후처리 효과는 이 Phase의 완료 조건이 아닙니다.

### M4 — 3축 운동학·축 한계·충돌 검증 ★

- **진입조건**: M1, M3 완료. M2 Toolpath IR 사용 가능.
- **할 일**: Kinematic tree → FK → axis interpolation → velocity/acceleration guard → broad phase → narrow phase → collision event/source mapping.
- **참조**: 기술 백서 §4.3, §4.5.3, §4.5.6, §9.3.
- **DoD**:
  1. 3축 VMC Golden Pose에서 축 위치→TCP 위치 오차가 테스트 허용치 이내입니다.
  2. 홈, 최소·최대 축 위치, 급속 이동, 이송 이동의 경계 Fixture가 모두 통과합니다.
  3. 안전 Fixture에서는 충돌 0건, 의도 충돌 Fixture에서는 공구·홀더·척·바이스별 기대 이벤트가 누락 없이 발생합니다.
  4. 축 한계, 속도, 가속도 초과가 실행 전 또는 발생 시점에 결정론적으로 진단됩니다.
  5. 충돌 이벤트가 시간, 두 객체, 위치, 심각도, G-code 원본 줄을 포함합니다.
  6. 충돌 발생 후 다음 렌더 프레임에서 정지 상태와 진단 연결이 표시됩니다.
  7. 시각적 메시와 충돌용 단순 형상이 분리되어 있습니다.
- **검증**:

```bash
pnpm test:unit --filter kinematics-3axis
pnpm test:unit --filter collision
pnpm test:parity --filter poses
pnpm test:e2e --grep "collision-stop"
pnpm bench --filter collision-fixtures
```

- **불변식**: 충돌 계산 실패를 `충돌 없음`으로 처리하지 않습니다.

### M5 — 3축 밀링 재료 제거 엔진 ★

- **진입조건**: M1, M3, M4 완료.
- **할 일**: Stock API → multi-dexel prototype → sparse brick allocation → swept volume update → dirty-region surface extraction → measurement hooks → GPU buffer partial update.
- **참조**: 기술 백서 §4.5.1~§4.5.2, §7.2~§7.3, §9.1.
- **DoD**:
  1. 직육면체 페이스 절삭, 슬롯, 포켓, 외곽 윤곽 Golden Fixture에서 제거 체적이 분석값과 비교됩니다.
  2. 체적 상대 오차는 동일 Fixture 기준 Preview ≤5%, Balanced ≤2%, Precision ≤1%를 만족합니다.
  3. 공구가 스톡과 접촉하지 않는 이동에서 제거량은 정확히 0입니다.
  4. 동일 입력·시드·프리셋의 최종 stock hash가 반복 실행에서 동일합니다.
  5. 변경된 brick/dexel만 갱신되며 전체 stock 재메시가 매 스텝 발생하지 않습니다.
  6. 5분 연속 절삭에서 메모리가 설정 상한을 넘어 지속 증가하지 않습니다.
  7. 측정 API가 거리·깊이·벽 두께를 표현 해상도 이내 오차로 반환합니다.
- **검증**:

```bash
pnpm test:unit --filter material-removal-milling
pnpm test:parity --filter stock-hash
pnpm bench --filter milling-golden
pnpm test:e2e --grep "face-milling|slot|pocket"
```

- **주의**: 시각적으로 매끄러운 메시가 체적 정확성을 증명하지 않습니다. 체적·단면·해시를 별도로 검증합니다.

### M6 — CNC 선반 반경 필드·대표 공정 ★

- **진입조건**: M1, M3, M4 완료. 공통 Stock·Tool 계약은 M5와 공유.
- **할 일**: XZ/r(z) representation → rotational stock renderer → facing → OD turning → taper → groove/parting → drilling/boring → CSS/RPM modes.
- **참조**: 기술 백서 §2.3.C, §4.5.1, §9.1.
- **DoD**:
  1. 단면, 외경, 테이퍼, 홈, 절단, 드릴·보링 Fixture의 최종 프로파일이 분석값과 해상도 이내로 일치합니다.
  2. 원통 외경 절삭 후 반경 오차가 반경 필드 셀 크기 이하입니다.
  3. G96 일정 절삭속도와 G97 일정 RPM의 회전수 변화가 Golden Formula와 일치하며 기계 최대 RPM에서 제한됩니다.
  4. 공구가 회전축 반대편 또는 척 영역을 침범할 때 기대 충돌이 발생합니다.
  5. 외경·내경·단면에서 제거 부호가 뒤집히거나 stock이 증가하는 경우가 없습니다.
  6. 선반 프로파일 저장→로드 후 동일 해시와 측정 결과를 재현합니다.
- **검증**:

```bash
pnpm test:unit --filter turning
pnpm test:unit --filter spindle-mode
pnpm test:parity --filter lathe-profile
pnpm test:e2e --grep "facing|od-turning|taper"
```

### M7 — Simulation Coordinator·Worker 통합·정합성 ★

- **진입조건**: M2~M6 완료.
- **할 일**: command/event bus → Worker lifecycle → simulation clock → state snapshots → render interpolation → collision stop → metrics sampling → deterministic replay.
- **참조**: 기술 백서 §4.1~§4.3, §4.7, §11.4 / 디자인 백서 §4.5.
- **DoD**:
  1. `G-code → Toolpath IR → axis state → collision → stock update → renderer`의 전체 파이프라인이 대표 밀링·선반 Fixture에서 완료됩니다.
  2. 0.1×~100× 재생 속도가 물리 결과를 바꾸지 않고 표시 시간만 변경합니다.
  3. 일시정지 후 stock·축·공구·진단 상태가 변경되지 않습니다.
  4. 동일 프로젝트를 실시간 실행과 빠른 비가시 실행으로 처리했을 때 최종 의미 해시가 동일합니다.
  5. Worker 재시작 또는 취소 후 이전 세션 이벤트가 새 세션에 유입되지 않습니다.
  6. 일반 수치 UI는 10Hz, 축 좌표는 최대 20Hz로 제한되고 시뮬레이션 프레임과 분리됩니다.
  7. 메인 스레드 50ms 초과 Long Task가 대표 실행에서 반복적으로 발생하지 않습니다.
- **검증**:

```bash
pnpm test:contracts --filter worker-protocol
pnpm test:parity --filter replay
pnpm test:e2e --grep "playback|pause|cancel|collision-stop"
pnpm bench --filter coordinator
```

- **불변식**: UI가 Worker 내부 버퍼의 소유권을 암묵적으로 공유하지 않습니다. Transferable 또는 명시적 공유 메모리 계약을 사용합니다.

### M8 — 저장·체크포인트·프로젝트 마이그레이션

- **진입조건**: M7 완료.
- **할 일**: IndexedDB metadata → OPFS chunks → checkpoint index → export/import container → schema migration → corruption handling → optional cloud contract stub.
- **참조**: 기술 백서 §2.8, §4.7, §7.1, §11.1.
- **DoD**:
  1. 프로젝트 저장→브라우저 재시작→로드 후 머신, 공구, 작업, G-code, stock, 진단, 측정의 의미 해시가 동일합니다.
  2. 체크포인트 간격은 기본 2~5초 또는 공정 경계이며 역방향 스크럽 결과가 전체 재실행 결과와 일치합니다.
  3. 저장 도중 중단된 파일은 정상 프로젝트로 노출되지 않고 복구 또는 격리됩니다.
  4. 이전 schema Fixture가 최신 버전으로 마이그레이션되고 원본 보존 정책이 지켜집니다.
  5. 100MB 기본 업로드 제한과 손상 파일 진단이 E2E로 검증됩니다.
  6. export 파일에는 명시적 schemaVersion, engineVersion, unitSystem, manifest checksum이 있습니다.
  7. 원본 G-code·모델이 사용자 동의 없이 텔레메트리에 포함되지 않습니다.
- **검증**:

```bash
pnpm test:unit --filter persistence
pnpm test:contracts --filter project-container
pnpm test:e2e --grep "save-load|checkpoint|migration|corruption"
pnpm test:parity --filter persisted-project
```

### M9 — 디자인 시스템·Workspace UI·접근성 ★

- **진입조건**: M3과 M7 완료. 디자인 토큰이 단일 출처로 준비됨.
- **할 일**: tokens → primitives → UnitInput/ParameterRow/DataTable → Global Command Bar → Context Rail → Inspector → Bottom Dock → Viewport overlays → responsive policies → Storybook.
- **참조**: 디자인 백서 전체, 특히 §2, §4, §5, §7~§9.
- **DoD**:
  1. `design/tokens/cnc-render.tokens.json`이 색상·간격·타이포그래피·반경의 단일 출처이며 코드 생성 결과와 일치합니다.
  2. 라이트모드만 존재하고 시스템이 어두운 테마를 사용해도 색상 체계가 바뀌지 않습니다.
  3. 1440×900에서 3D 뷰포트가 콘텐츠 면적의 60% 이상이며, 양쪽 패널이 열린 상태에서 뷰포트 너비가 720px 미만이면 한쪽 패널이 접힙니다.
  4. 지정된 9개 해상도에서 의도하지 않은 가로 스크롤과 핵심 제어 잘림이 없습니다.
  5. 작업실 본문·입력·핵심 수치가 12px 미만으로 내려가지 않고 수치에 tabular figures와 단위가 적용됩니다.
  6. axe-core에서 Critical/Serious 위반 0건, 키보드 핵심 플로우 100%, 200% 확대에서 핵심 기능 손실 0건입니다.
  7. 기본 작업실의 보이는 DOM 노드는 2,000개 이하, UI JavaScript+Style+Paint 평균은 대표 실행에서 4ms 이하를 목표로 측정됩니다.
  8. 차트 10Hz/최대 20Hz, HUD 10~20Hz 상한이 코드와 테스트로 보장됩니다.
  9. WOFF2 초기 전송량 400KB 이하, 초기 UI CSS gzip 80KB 이하입니다.
  10. `backdrop-filter`, 배경 그라데이션, 네온/글로우, 상시 애니메이션, 16px 초과 일반 카드 반경, 원형 계기판이 정적 검사에서 0건입니다.
  11. 충돌 상태는 색상뿐 아니라 아이콘·문구·진단 항목·3D 위치 연결로 표현됩니다.
- **검증**:

```bash
pnpm storybook:build
pnpm test:a11y
pnpm test:visual
pnpm test:e2e --grep "workspace-layout|keyboard|zoom-200"
pnpm check:forbidden-ui
pnpm check:bundle
pnpm bench --filter ui-budget
```

- **주의**: 스켈레톤 애니메이션, 리플, 카드 hover 부상 효과를 임의로 추가하지 않습니다.

### M10 — 튜토리얼·샌드박스 MVP(E2) 수직 완성 ★

- **진입조건**: M2~M9 완료.
- **할 일**: lesson schema → allowed actions → step validation → hints → scoring → representative milling/turning/drilling lessons → sandbox operation creation → result summary.
- **참조**: 기술 백서 §1.5, §2.3~§2.4, §8 Phase 1 / 디자인 백서 §2.4, §8.
- **DoD**:
  1. 최소 대표 튜토리얼 3개가 완료됩니다: 페이스 밀링, 외경 선삭, 드릴링.
  2. 각 튜토리얼은 준비→설정→실행→측정→결과 판정의 전 과정을 실제 엔진으로 수행합니다.
  3. 성공 Fixture는 성공, 공구 오류·과도한 절입·충돌 Fixture는 기대 실패 사유를 반환합니다.
  4. 허용하지 않은 행동을 무조건 차단하지 않고 이유와 되돌리기 경로를 제공합니다.
  5. 점수는 목표 형상 편차, 충돌, 시간, 공구 수, 과절삭·미절삭 중 문서화된 항목으로 결정론적으로 계산됩니다.
  6. 튜토리얼 성공 상태에 전체 화면 축하 애니메이션이 없고 마지막 3D 결과가 유지됩니다.
  7. 샌드박스에서 기계·공작물·재료·공구를 선택해 대표 공정을 생성·실행·저장할 수 있습니다.
  8. 사용자 화면에 E2 등급과 근사 모델 한계가 표시됩니다.
- **검증**:

```bash
pnpm test:unit --filter tutorial-rules
pnpm test:parity --filter scoring
pnpm test:e2e --grep "tutorial-face|tutorial-turning|tutorial-drilling|sandbox"
pnpm test:visual --grep "tutorial-success|tutorial-failure"
```

### M11 — G-code Lab·진단·측정·결과 비교(S1 기초)

- **진입조건**: M10 완료.
- **할 일**: Monaco lazy load → diagnostics bridge → current-line tracking → breakpoint/step → unsupported-code help → measurement tools → deviation heatmap → report export.
- **참조**: 기술 백서 §2.2, §2.4, §8 Phase 2 / 디자인 백서 §2.4.E~F, §8.4~§8.5.
- **DoD**:
  1. Monaco는 G-code Lab 진입 전 초기 번들에 포함되지 않습니다.
  2. 파서 오류, 축 한계, 충돌, 가공 경고가 원본 코드 줄·3D 객체·진단 목록 사이에서 양방향 이동됩니다.
  3. 현재 실행 줄, 오류 줄, 브레이크포인트가 색상 외 모양·레이블로 구분됩니다.
  4. 지원하지 않는 코드가 줄 번호, 지원 수준, 대체 가능 여부와 함께 표시됩니다.
  5. 거리·직경·반경·각도·깊이·벽 두께 측정이 단위 변환 후에도 내부 정밀도를 유지합니다.
  6. 목표/결과 Overlay, Split, Heatmap 모드가 동일 편차 데이터에서 일관된 범례와 통계를 표시합니다.
  7. JSON/CSV/인쇄용 HTML 리포트의 핵심 값이 화면 결과와 일치합니다.
- **검증**:

```bash
pnpm test:e2e --grep "gcode-lab|diagnostic-link|measurement|result-compare"
pnpm test:contracts --filter report
pnpm test:visual --grep "gcode-error|heatmap"
pnpm check:bundle
```

### M12 — 성능·폴백·보안·CI·배포 릴리스 게이트 ★

- **진입조건**: M0~M11 완료.
- **할 일**: reference benchmark scenes → WebGPU/WebGL 2 matrix → memory profiling → Lighthouse → COOP/COEP → upload hardening → telemetry privacy → CI matrix → Cloudflare Pages preview/release.
- **참조**: 기술 백서 §2.8, §4.6, §7, §9~§11 / 디자인 백서 §7.2~§7.8.
- **DoD**:
  1. 랜딩 LCP 2.5초 이내, 시뮬레이터 셸 캐시 미적용 5초 이내 목표를 기준 환경에서 충족합니다.
  2. Medium 대표 장면은 60 FPS 목표, High는 30 FPS 이상을 기록하며 기준 장비·브라우저·해상도를 리포트에 남깁니다.
  3. 기본 대표 프로젝트 메모리 600MB 이하, 고정밀 모드는 1.5GB 권장 상한 이내입니다.
  4. 충돌 경고는 이벤트 발생 후 1렌더 프레임 이내 표시됩니다.
  5. WebGPU와 WebGL 2 결과의 Toolpath·축 상태·진단은 동일하고, stock 차이는 프리셋별 승인 오차 이내입니다.
  6. Chrome/Edge 최신 버전은 필수 통과, Safari/Firefox는 지원 매트릭스에 따라 기능 제한 또는 통과 상태가 명시됩니다.
  7. 업로드 파일의 크기·MIME·확장자·삼각형 수·손상·압축 폭탄 방어 테스트가 통과합니다.
  8. SharedArrayBuffer 사용 시 COOP/COEP와 서드파티 리소스 정책이 배포 환경에서 검증됩니다.
  9. 익명 텔레메트리에 원본 모델·G-code·개인 프로젝트명이 포함되지 않습니다.
  10. CI에서 lint, typecheck, Rust fmt/clippy/test, unit, contract, parity, build, E2E, accessibility, visual, bundle, benchmark smoke가 모두 그린입니다.
  11. 배포 산출물에 버전·commit SHA·schemaVersion·engineVersion이 기록됩니다.
- **검증**:

```bash
pnpm verify
pnpm test:e2e --project=chromium-webgpu
pnpm test:e2e --project=chromium-webgl2
pnpm test:a11y
pnpm test:visual
pnpm bench -- --report=artifacts/benchmark-report.json
pnpm lighthouse -- --output-path=artifacts/lighthouse.html
pnpm security:test-uploads
pnpm deploy:preview
pnpm smoke:preview
```

- **릴리스 조건**: P0/P1 버그 0건, 알려진 P2 이슈는 문서화·승인, 모든 핵심 Fixture와 성능 리포트가 CI Artifact로 보존되어야 합니다.

### M13 — 3+2축·동시 5축(S1) 확장 ★

- **진입조건**: M12 릴리스 게이트 완료 및 5축 범위 승인.
- **할 일**: machine plugin contract → rotary axes → FK/IK → TCP → solution selection → singularity/rewrite detection → rewind → 5-axis collision → sparse voxel 5-axis removal → blade/impeller lesson.
- **참조**: 기술 백서 §2.3.D, §4.5.3, §8 Phase 3, §9.3.
- **DoD**:
  1. Table-Table, Head-Table, Head-Head 유형별 Golden Pose의 FK 결과가 기대 TCP 위치·자세와 허용치 이내로 일치합니다.
  2. IK→FK 왕복 시 위치·자세 오차가 문서화된 허용치 이내입니다.
  3. 다해가 존재할 때 축 이동량·한계·특이점 비용 함수에 따라 결과가 결정론적으로 선택됩니다.
  4. 축 한계, 리와인드, 특이점, 급격한 자세 변화가 명시적으로 진단됩니다.
  5. 홀더·스핀들·테이블·공작물·고정구와 기계 링크 자체 충돌 Fixture가 통과합니다.
  6. 3+2축 인덱스와 동시 5축 결과가 별도 모드로 식별되고 TCP 지원 여부가 표시됩니다.
  7. 5축 제거 Fixture의 체적·잔삭 오차가 Precision 프리셋의 승인 기준 이내입니다.
  8. 블레이드 또는 임펠러 대표 튜토리얼이 S1 등급으로 실행됩니다.
- **검증**:

```bash
pnpm test:unit --filter kinematics-5axis
pnpm test:parity --filter fk-ik
pnpm test:unit --filter collision-5axis
pnpm bench --filter five-axis
pnpm test:e2e --grep "3plus2|simultaneous-5axis|singularity|rewind"
```

- **주의**: 3축 좌표에 A/B/C 값을 단순 보간한 구현을 5축 운동학으로 간주하지 않습니다.

---

## 2. 런북: 증상 → 흔한 원인 → 조치

| # | 증상 | 흔한 원인 | 조치 |
|---|---|---|---|
| 1 | 설치·빌드 실패 | Node/pnpm/Rust 버전 불일치, 깨진 lockfile | 고정 버전 확인 → 캐시가 아닌 lockfile 기준 재설치 → 임의 의존성 업그레이드 금지 |
| 2 | Rust는 통과하지만 WASM이 브라우저에서 실패 | wasm-bindgen 버전 차이, 잘못된 target, MIME/CORS | 생성 도구 버전 정렬 → 실제 배포 서버에서 WASM MIME·경로 확인 → smoke test 추가 |
| 3 | WebGPU가 지원되는데 WebGL 2로 실행 | adapter 요청 실패, 기능 탐지 순서 오류, 브라우저 플래그 | capability report 저장 → adapter/device 오류 표시 → 조용한 폴백 금지 |
| 4 | 공구는 움직이지만 재료가 제거되지 않음 | 좌표계·단위 불일치, cutter geometry 누락, dirty region 미표시 | Toolpath→world transform→stock local transform을 단계별 로그/Fixture로 비교 |
| 5 | 공구가 지나간 뒤 재료가 다시 생김 | 체크포인트 순서 오류, GPU buffer race, stock version 역전 | stock revision 단조 증가 검증 → 오래된 Worker/GPU 결과 폐기 → replay parity 실행 |
| 6 | 표면은 맞아 보이나 체적 오차가 큼 | 메시 스무딩으로 오차 은폐, 저해상도 표현 | 표면 스크린샷이 아닌 분석 체적·단면 Fixture로 회귀 → 프리셋별 오차 확인 |
| 7 | 안전 경로에서 충돌이 계속 발생 | 렌더 메시를 충돌 형상으로 직접 사용, tolerance 과대 | 단순 collision proxy와 margin 분리 → safe/impact Golden Fixture 비교 |
| 8 | 명백한 충돌을 놓침 | broad phase group 누락, 빠른 이동 tunneling, holder 미등록 | swept/continuous 검사 적용 → collision group manifest 검사 → 누락 객체 테스트 추가 |
| 9 | 원호·헬릭스가 비정상 궤적 | 평면·IJK/R·절대/증분 모달 상태 누수 | 해당 줄 이전 modal snapshot 비교 → 최소 G-code Fixture로 축소 → parser 수정 |
| 10 | inch 프로그램에서 형상이 25.4배 틀림 | 표시 단위와 내부 단위 혼용 | 입구에서 한 번만 정규화 → 내부 단위 불변식 검사 → round-trip 테스트 실행 |
| 11 | 일시정지 중에도 수치·stock이 변함 | Worker clock 미중지, queued event 잔류 | session token과 cancellation barrier 적용 → pause invariant 테스트 추가 |
| 12 | 재생 속도에 따라 최종 형상이 달라짐 | 렌더 delta를 물리 step으로 사용, 샘플링 간격 변화 | 고정 simulation time step 또는 경로 기반 제거 → real-time/fast parity 비교 |
| 13 | UI를 열면 FPS가 급락 | React 매 프레임 갱신, DOM 차트, Monaco 조기 로드, blur/shadow | React Profiler·Performance trace → 10/20Hz 샘플러 → 패널 비활성 시 언마운트 |
| 14 | 패널 리사이즈 중 캔버스가 깜빡임 | 매 pointermove마다 고해상도 resize | 저비용 프리뷰 → requestAnimationFrame 배치 → 종료 시 최종 해상도 적용 |
| 15 | 수치가 흔들리거나 열 폭이 변함 | 비탭형 숫자, 매 프레임 반올림, 자릿수 정책 부재 | tabular-nums → 표시 정밀도 고정 → 값과 표시 모델 분리 |
| 16 | 흰색 공작물이 배경에서 사라짐 | 뷰포트 완전 흰색, 환경광 과다 | 중립 회색 배경·접지 그림자·윤곽 대비 확인, 배경 그라데이션은 사용 금지 |
| 17 | G-code 오류가 Toast·패널에 중복 표시 | 진단 소스가 여러 UI에 복제 | Diagnostic store를 단일 출처로 사용 → Toast는 비진단 일회 이벤트에만 사용 |
| 18 | 저장 후 결과가 달라짐 | schema migration 누락, float 직렬화, 체크포인트 누락 | semantic hash 비교 → manifest/schema/engine 버전 확인 → migration Fixture 추가 |
| 19 | OPFS 저장 실패 | 사생활 보호 모드, quota, 권한·브라우저 차이 | capability에서 지원 여부 표시 → 메모리/다운로드 폴백 제공 → 데이터 유실 금지 |
| 20 | Monaco가 초기 로딩을 지연 | 정적 import, 언어 worker 번들 포함 | route/feature lazy import → bundle analyzer 확인 → G-code Lab 전 네트워크 요청 0건 검증 |
| 21 | WebGPU와 WebGL 2 결과 불일치 | 셰이더 정밀도·좌표 변환·표면 추출 차이 | Toolpath/axis/stock 단계별 의미 해시 비교 → 최초 불일치 계층에서 중지 |
| 22 | 5축 자세가 갑자기 뒤집힘 | Euler 각 직접 보간, IK 해 선택 변경, 특이점 | quaternion/축 해석 재검토 → 다해 비용 함수 고정 → Golden Pose·연속성 테스트 |
| 23 | CI에서만 COOP/COEP 실패 | preview와 production header 차이 | 배포 설정을 계약 파일 한 곳에서 관리 → preview smoke에서 SharedArrayBuffer 확인 |
| 24 | 테스트가 간헐적으로 실패 | 시간·GPU·시드·비동기 완료 조건 비결정적 | seed와 clock 고정 → `waitForTimeout` 제거 → 상태/이벤트 기반 대기 사용 |

반복되는 새 증상은 임시 해결 후 끝내지 않고 이 표에 추가합니다.

---

## 3. 멈춤 규칙(STOP)

### 3.1. 즉시 멈춰야 하는 상황

- 같은 실패를 서로 다른 방법으로 3회 시도했으나 원인이 좁혀지지 않았습니다.
- 수치·기하·충돌·재료 제거·저장 정합성 게이트를 통과하지 못한 상태에서 UI 또는 다음 Phase로 넘어가려 합니다.
- Rust/WASM/WebGPU 경계 또는 패키지 의존 방향을 크게 바꿔야 합니다.
- Multi-dexel, sparse voxel, SDF 중 핵심 재료 표현 방식을 교체해야 합니다.
- 프로젝트 파일 형식, public schema, Worker protocol의 호환성을 깨는 변경이 필요합니다.
- 성능을 맞추기 위해 정확도 기준이나 충돌 검사를 비활성화해야 합니다.
- 브라우저·GPU 한계로 백서의 목표를 달성할 수 없다는 근거가 나왔습니다.
- 라이선스, 보안 헤더, 외부 CAD 라이브러리, 업로드 모델 처리에 정책 위험이 있습니다.

### 3.2. 멈출 때 기록 형식

`PROGRESS.md`에 다음을 남깁니다.

```markdown
## Blocker — YYYY-MM-DD
- Phase:
- Symptom:
- Minimal reproduction:
- Expected / Actual:
- Attempts (max 3):
- Evidence: test output / trace / screenshot / benchmark
- Current hypothesis:
- Options and trade-offs:
- Decision required:
```

기록 후 사용자에게 선택지를 보고하고 결정 전까지 불변식을 깨는 임시 우회를 커밋하지 않습니다.

### 3.3. 절대 금지

- 실패 테스트 삭제, `skip`, 허용 오차 확대, 성능 기준 하향으로 통과를 위장합니다.
- 충돌·축 한계·파일 손상을 경고 없이 무시합니다.
- 시뮬레이션 결과가 다른데 화면만 비슷하게 보이도록 보정합니다.
- WebGPU 실패를 사용자와 로그에 알리지 않고 WebGL 2로 숨깁니다.
- 테스트 Fixture를 실제 구현 결과에 맞춰 근거 없이 다시 생성합니다.
- AI가 생성한 가공 공식·재료값·공구 권장값을 출처·검수 없이 확정값으로 넣습니다.
- 프로젝트 원본, G-code, 모델 파일을 동의 없이 서버나 텔레메트리로 전송합니다.
- `.env`, 토큰, 개인 식별 데이터, 대형 바이너리 산출물을 커밋합니다.
- 디자인 백서의 금지 스타일을 “임시”라는 이유로 추가합니다.
- 5축을 단순한 시각 애니메이션으로 구현하고 S1 시뮬레이션으로 표기합니다.

---

## 4. 검증 우선순위

```text
스키마·단위 불변식
> G-code 의미 정확성
> 운동학·축 한계
> 충돌 누락 방지
> 재료 제거 체적·형상 정확성
> 저장·재생 정합성
> 전체 수직 기능 실효
> 접근성·수치 가독성
> UI·렌더링 성능
> 배포·시각 완성도
```

앞 단계가 깨지면 뒤 단계 결과는 신뢰하지 않습니다. 특히 화면이 사실적으로 보이더라도 Toolpath, 운동학, 체적, 충돌, 저장 해시 중 하나가 불일치하면 완료로 판정하지 않습니다.

---

## 5. Fixture·Artifact 운영 규칙

### 5.1. Golden Fixture 분류

```text
tests/fixtures/
├── gcode/
│   ├── valid/
│   ├── invalid/
│   ├── modal/
│   └── dialect/
├── machines/
│   ├── vmc-3axis/
│   ├── lathe-2axis/
│   └── five-axis/
├── stock/
│   ├── milling/
│   └── turning/
├── collisions/
│   ├── safe/
│   └── impact/
├── projects/
│   ├── migrations/
│   └── corrupted/
└── visual/
```

- Fixture는 입력, 기대 출력, 허용 오차, 생성 근거, schemaVersion을 포함합니다.
- Golden 출력은 구현이 바뀌었다는 이유만으로 갱신하지 않습니다.
- 갱신 시 ADR 또는 PR 설명에 수학적·도메인적 근거를 남깁니다.
- 바이너리 Fixture는 가능한 한 작게 유지하고 큰 모델은 별도 다운로드·해시 검증 방식으로 관리합니다.

### 5.2. 벤치마크 Artifact

모든 성능 리포트에는 다음 메타데이터를 포함합니다.

- commit SHA
- 앱·엔진·schema 버전
- 브라우저와 버전
- OS
- GPU adapter·driver 정보
- CPU·RAM
- 해상도·DPR
- WebGPU/WebGL 2 모드
- 품질 프리셋과 stock 해상도
- Fixture ID
- 평균·P95 frame time, FPS, peak memory, Long Task, stock update time

### 5.3. 완료 보고 형식

Codex는 Phase 또는 하위 작업 완료 시 다음 형식으로 보고합니다.

```markdown
## Completed
- Phase / task:
- Changed:
- Why:

## Validation
- `command`: PASS/FAIL
- Accuracy/performance result:
- Artifacts:

## Remaining
- Known limitations:
- Next task:
- Decision needed: none | details
```

---

## 6. MVP 완료 정의

CNC Render의 첫 MVP는 M0~M10을 모두 통과한 상태입니다. 다음 조건을 추가로 만족해야 합니다.

1. 사용자가 브라우저에서 설치 없이 프로젝트를 생성할 수 있습니다.
2. 3축 밀링·2축 선반 중 대표 공정을 실제 재료 제거 엔진으로 실행할 수 있습니다.
3. 페이스 밀링, 외경 선삭, 드릴링 튜토리얼을 처음부터 결과 판정까지 완료할 수 있습니다.
4. G-code 또는 생성 공구 경로가 Toolpath IR과 기계 축 움직임으로 연결됩니다.
5. 축 한계와 대표 충돌을 탐지하며 오류 위치를 설명합니다.
6. 결과를 측정하고 로컬에 저장·복원할 수 있습니다.
7. 라이트모드 미니멀 UI, 수치·단위 규칙, 접근성 핵심 기준을 충족합니다.
8. 정확도 등급은 E2로 표시하며 산업용 검증 대체가 아님을 명시합니다.
9. WebGPU 미지원 환경에서는 가능한 WebGL 2 기능과 제한을 명확히 제공합니다.
10. 모든 MVP 핵심 경로가 CI에서 재현됩니다.

M11은 S1 기초 기능, M12는 공개 릴리스 품질, M13은 5축 확장 게이트입니다.
