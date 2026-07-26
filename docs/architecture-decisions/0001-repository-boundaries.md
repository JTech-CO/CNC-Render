# ADR 0001: 저장소 경계와 실행 계층

- 상태: 승인
- 날짜: 2026-07-26
- 결정 범위: UI, simulation, renderer, storage, Worker, Rust/WASM, 테마

## 맥락

CNC Render는 React 기반 학습 UI, 실시간 3D 렌더러, G-code·운동학·충돌·재료 제거 시뮬레이션, 로컬 우선 저장을 한 브라우저 애플리케이션에서 제공한다. 이 기능들은 실행 빈도, 메모리 크기, 정확도 책임이 서로 다르다.

React 상태에 매 프레임 계산 결과나 대형 `TypedArray`를 넣으면 UI 렌더링과 시뮬레이션 시간이 결합된다. 렌더러가 도메인 상태를 직접 수정하거나 저장 계층이 실행 중인 WASM 메모리를 직렬화하면 재현성과 마이그레이션 가능성도 잃는다. 따라서 저장소의 디렉터리 경계뿐 아니라 데이터 흐름과 메모리 소유권을 함께 고정해야 한다.

디자인 백서는 라이트모드만 지원하도록 결정했으며, 이 결정은 기술 구현과 시각 회귀 기준에도 동일하게 적용되어야 한다.

근거 문서:

- 기술 백서 v1.0 §3.3, §4.1~§4.3, §4.7, §6, §7
- 디자인 백서 v1.0 §2.1 테마 정책, §5, §6, §9
- Codex 작업 하네스 v0.1 §0.5, M0

## 결정

### 1. 의존성은 계약을 향하고, 구현 계층끼리는 역참조하지 않는다

애플리케이션 조립점인 `apps/web`만 UI, simulation client, renderer, storage 어댑터의 구체 구현을 함께 알고 초기화한다. 공유 도메인 스키마, 단위, 메시지, 렌더 스냅샷과 저장 포트는 구현에 의존하지 않는 계약 패키지에 둔다.

```text
                         apps/web
                    (composition root)
                  /       |       |       \
                UI   simulation renderer  storage
                  \       |       |       /
                   domain + public contracts
                              |
                     generated WASM boundary
                              |
                         Rust core crates
```

화살표는 위 계층이 아래의 공개 계약에 의존할 수 있음을 뜻한다. UI, simulation, renderer, storage 구현 사이의 직접 import는 기본적으로 허용하지 않는다. 협업은 조립점에서 주입한 포트와 버전이 있는 메시지로 수행한다.

| 경계 | 소유 책임 | 의존 가능 | 금지 |
|---|---|---|---|
| `apps/web` | 부트스트랩, 기능 감지, 포트 연결, 라우팅 | 모든 계층의 공개 진입점 | 도메인 계산 구현, 프레임별 상태 복제 |
| UI | React 화면 셸, 접근성, 입력, 패널·튜토리얼 상태, 요약 메트릭 표시 | 도메인 스키마, 명령·이벤트·포트 계약 | simulation/renderer/storage 내부 구현, WASM 메모리, GPU 버퍼 |
| simulation | G-code 정규화, 논리 시간, Toolpath IR, 운동학, 충돌, 재료 제거, 메트릭 | 도메인·메시지 계약, Rust/WASM 공개 함수 | React, Zustand, DOM, renderer 장면 객체, storage 어댑터 |
| renderer | Three.js 장면, 카메라, GPU 자원, 가시화와 프레임 스케줄 | 렌더 스냅샷·자산 계약 | 도메인 기준 상태 변경, simulation 내부 구현, React 상태, storage |
| storage | 프로젝트 검증, 직렬화, 마이그레이션, OPFS·IndexedDB·선택적 클라우드 어댑터 | 프로젝트 스키마, 저장 포트, 체크포인트 코덱 계약 | React, renderer, 실행 중 simulation 객체 또는 WASM 포인터 |
| Rust/WASM | 결정론적 수치 코어와 대형 계산 메모리 | Rust 내부의 명시적 crate API | 브라우저 UI, DOM, Zustand, 영속 저장소 직접 접근 |

세부 디렉터리 이름은 책임이 실제로 생길 때 만든다. 빈 패키지를 선제적으로 생성하지 않는다. 패키지를 분리하더라도 위 개념 경계와 lint 규칙은 유지한다.

### 2. 명령과 결과의 흐름을 단방향으로 유지한다

```text
사용자 입력
  → UI command
  → Simulation Coordinator (Worker)
  → Rust/WASM core
  → simulation event + render snapshot/changed-region handle
       ├→ renderer: 프레임 단위 시각화
       ├→ UI: 제한된 빈도의 요약 상태·진단
       └→ storage port: 명시적 프로젝트/체크포인트 저장
```

- UI는 명령을 발행하고 이벤트를 구독하지만 계산 상태를 직접 수정하지 않는다.
- simulation이 기계, 공구, 소재, 충돌, 논리 시간의 기준 상태를 소유한다.
- renderer는 읽기 전용 스냅샷 또는 버퍼 핸들을 소비한다. 장면 객체와 카메라 상태는 renderer가 소유하지만 도메인 기준값이 아니다.
- storage는 로드 결과와 저장 성공·실패를 반환한다. 재생 프레임마다 호출하지 않고 자동 저장, 중요 변경, 공정 경계와 체크포인트 시점에 호출한다.
- 저장된 프로젝트를 열 때 storage가 검증·마이그레이션한 DTO를 조립점이 simulation으로 전달한다. storage가 Worker 내부를 직접 생성하거나 변경하지 않는다.

### 3. React, Worker와 WASM의 책임을 분리한다

#### React와 Zustand

- React는 라우팅, 폼, 명령 바, Inspector, Bottom Dock, 튜토리얼, 보고서와 접근 가능한 상태 표현을 담당한다.
- Zustand에는 프로젝트 ID와 메타데이터, 선택 항목 ID, 패널 상태, 재생 명령 상태, 제한된 크기의 진단·요약 메트릭만 둔다.
- 복셀, 덱셀, SDF, 메시·공구 경로 대형 배열, 가속 구조와 GPU 자원을 넣지 않는다.
- 시뮬레이션 프레임마다 React 또는 Zustand 전체 트리를 갱신하지 않는다. 화면에 필요한 요약값은 선택적으로 구독하고 제한된 빈도로 배치한다.
- renderer의 `requestAnimationFrame` 루프는 React 렌더 주기와 독립적이다.

#### Simulation Worker

- Simulation Coordinator와 논리 시계는 전용 Worker가 소유한다.
- 명령은 구조화되고 버전이 있는 메시지 계약으로 전달한다. 이벤트에는 실행 ID와 단조 증가 순서를 포함해 오래된 응답을 구분할 수 있게 한다.
- 대형 데이터는 `Transferable`, `SharedArrayBuffer` 또는 불투명 핸들로 전달하고 불필요한 복사를 피한다.
- `SharedArrayBuffer`가 없을 때도 같은 의미 계약을 유지하며, 복사 기반 폴백의 기능·성능 차이를 기록한다.
- Monaco 편집기 입력, 파일명, G-code 원문은 데이터로만 취급한다.

#### Rust/WASM

- G-code parser, Toolpath IR, 운동학, 충돌, 소재 표현, 측정과 공정 근사는 서로의 공개 API를 통해서만 연결한다.
- Rust 계산은 길이 `mm`와 문서화된 각도 단위를 사용하고, 정밀 계산은 기본적으로 `f64`를 사용한다. 렌더링용 `Float32` 변환은 경계에서 수행한다.
- WASM은 대형 배열과 공간 자료구조의 소유자다. JavaScript에는 수명이 명시된 복사본, 뷰 또는 핸들만 노출한다.
- 동일 입력·코어 버전·설정·시드에서 결과가 재현되어야 한다. 난수가 필요한 효과는 simulation 결과와 분리하고 시드를 명시한다.
- WASM 통합 facade는 제품명에 맞는 `cnc-render-wasm` 명칭만 사용한다.
- Rapier는 강체와 보조 충돌 질의에 사용할 수 있지만 절삭 재료 제거 엔진으로 사용하지 않는다.

### 4. 렌더러는 시뮬레이션의 표현 계층이다

- 기본 경로는 Three.js `WebGPURenderer`, 폴백은 WebGL 2다.
- 기능 감지 뒤 백엔드를 선택하며, WebGPU 전용 기능을 추가할 때는 WebGL 2의 기능 차이와 해상도 제한을 문서화하고 테스트한다.
- 소재 기준 상태와 재료 제거 알고리즘은 simulation 책임이다. renderer의 메시나 파티클을 계산의 원본으로 역사용하지 않는다.
- 칩, 냉각수, 음향과 장식 효과는 시뮬레이션 결과와 분리된 표현이다. 효과가 없어도 충돌·재료 제거·측정 결과는 동일해야 한다.
- renderer에는 React 컴포넌트를 두지 않는다. React viewport 컴포넌트는 캔버스 수명과 renderer facade만 관리한다.

### 5. 저장은 로컬 우선이며 스키마 경계를 통과한다

- 프로젝트 바이너리와 대형 체크포인트는 OPFS, 검색 가능한 메타데이터와 설정은 IndexedDB에 둔다.
- UI나 simulation 객체를 그대로 직렬화하지 않는다. 모든 저장은 `schemaVersion`이 있는 프로젝트 DTO와 명시적 바이너리 청크를 통과한다.
- 자동 저장은 기본 30초 간격 또는 중요 변경 시 수행하고, 실행 중 대형 상태는 일관된 체크포인트를 만든 뒤 기록한다.
- 클라우드 동기화는 선택적 storage 어댑터다. UI·simulation·renderer는 특정 공급자 API에 의존하지 않는다.
- 가져오기·내보내기 형식은 ADR 0002의 `.cncrender` ZIP 컨테이너를 사용한다.

### 6. 라이트모드만 지원한다

- 제품 UI의 유일한 색상 체계는 `light`다. `color-scheme: light`를 명시한다.
- `design/tokens/cnc-render.tokens.json`을 라이트 토큰의 단일 출처로 사용하고 CSS, 컴포넌트 문서와 시각 테스트 입력은 이 파일에서 생성하거나 참조한다.
- 다크 토큰, 테마 토글, `prefers-color-scheme: dark`, 시스템 테마 자동 반영, 사용자별 테마 저장 필드를 추가하지 않는다.
- 3D 뷰포트의 제한된 스튜디오 배경 선택은 장면 설정이며 애플리케이션 테마가 아니다. 밝은 UI의 대비·가독성 기준은 항상 유지한다.
- 시각 회귀와 접근성 검증의 기준 테마도 라이트 하나다.
- 네온, 글로우, 배경 그라데이션, `backdrop-filter`, 상시 장식 애니메이션과 입체 베벨은 사용하지 않는다.

## 경계 검증

1. dependency-cruiser 또는 동등 lint 규칙으로 UI/simulation/renderer/storage의 금지 import를 실패 처리한다.
2. Worker 메시지 계약은 TypeScript와 Rust 직렬화 fixture로 검증한다.
3. 대형 `TypedArray`, 복셀·덱셀·SDF 타입이 UI Store 계약에 들어오면 계약 테스트를 실패 처리한다.
4. simulation core 테스트는 DOM·React·Three.js·영속 저장소 없이 실행 가능해야 한다.
5. renderer 테스트는 고정된 렌더 스냅샷 fixture를 사용하고 simulation 구현을 불러오지 않는다.
6. storage 테스트는 스키마 버전, 손상 파일, 마이그레이션과 원자적 저장 실패를 검증한다.
7. 금지 UI 검사에서 다크 테마 분기와 금지 시각 효과를 탐지한다.

## 결과

### 이점

- UI 프레임 저하가 계산 정확도와 논리 시간에 영향을 주지 않는다.
- simulation core를 브라우저 UI 없이 수치·결정론 테스트할 수 있다.
- renderer와 storage 백엔드를 도메인 계산을 바꾸지 않고 교체할 수 있다.
- 대형 메모리의 소유자와 수명이 명확해져 복사와 누수를 줄일 수 있다.
- 라이트 단일 테마로 시각·접근성 테스트 기준이 일관된다.

### 비용과 제약

- 메시지, DTO, 스냅샷과 포트 계약을 명시적으로 유지해야 한다.
- Worker 경계의 비동기 오류·취소·버전 불일치를 처리해야 한다.
- 디버깅 시 UI, Worker, WASM과 GPU의 여러 실행 컨텍스트를 추적해야 한다.
- 시스템 다크 테마 사용자의 선호를 자동 반영하지 않는다.

## 채택하지 않은 대안

- **React/Zustand에 전체 시뮬레이션 상태 저장**: 프레임별 재렌더, 직렬화 비용과 대형 메모리 복제를 유발하므로 채택하지 않는다.
- **renderer 장면을 도메인 상태로 사용**: 시각 LOD와 계산 정확도를 결합하므로 채택하지 않는다.
- **storage가 실행 객체를 직접 스냅샷**: 구현 세부가 파일 형식에 누출되고 마이그레이션이 어려워 채택하지 않는다.
- **메인 스레드 단일 루프**: 편집·접근성 UI와 고부하 계산이 서로 차단되므로 채택하지 않는다.
- **시스템 테마 자동 전환**: 단일 라이트 디자인 정책과 검증 기준을 깨므로 채택하지 않는다.
