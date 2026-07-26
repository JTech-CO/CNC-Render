# CNC Render 기술 백서 (Technical Whitepaper)

**버전**: 1.0  
**작성일**: 2026년 7월 26일  
**작성자**: Bryan  
**프로젝트 상태**: 기술 기획 및 프로토타입 설계 단계  
**참고 문서**: 웹 프로젝트용 기술 백서 템플릿 v1.0, CNC 가공 조사 자료, 추후 작성 예정인 디자인 백서·콘텐츠 명세서·QA 하네스·API 명세서  
**프로젝트 명**: CNC Render — Web CNC Machining Simulator & Learning Lab

> 본 문서는 브라우저에서 밀링·선반·3+2축·동시 5축 CNC 가공을 학습하고 시뮬레이션하는 교육형 디지털 트윈 플랫폼인 CNC Render의 기술 기준을 정의합니다.

---

## 1. 프로젝트 개요 (Project Overview)

### 1.1. 프로젝트 명

**CNC Render**  
부제: **Web CNC Machining Simulator & Learning Lab**

### 1.2. 목적 (Purpose)

CNC Render는 실제 CNC 공작기계의 크기, 가격, 안전 위험, 설치 공간, 숙련도 요구 때문에 일반 사용자가 직접 경험하기 어려운 절삭가공 과정을 웹 브라우저에서 단계적으로 학습하고 실험할 수 있도록 하는 것을 목적으로 합니다.

핵심 목표는 다음과 같습니다.

1. **교육 접근성 개선**: 밀링, 선반, 드릴링, 3+2축, 동시 5축 가공의 기계 구조와 절삭 원리를 설치 없이 체험할 수 있게 합니다.
2. **가공 과정의 시각화**: 공구 경로, 재료 제거, 칩 발생, 충돌, 축 이동, 절삭 부하, 예상 표면 상태를 실시간 3D로 표현합니다.
3. **튜토리얼과 자유 실습 통합**: 외경 절삭, 단면 절삭, 테이퍼 절삭, 포켓·슬롯·페이스 밀링, 드릴링 등 작업을 단계별로 배우고, 샌드박스에서는 재료·기계·공구·가공 조건을 직접 조합합니다.
4. **CNC 코드 이해 지원**: G-code를 읽고 수정하며 기계 좌표, 작업 좌표, 공구 보정, 이송, 주축 회전, 원호 보간이 실제 움직임으로 어떻게 변환되는지 보여줍니다.
5. **확장 가능한 디지털 트윈 기반 확보**: 웹 버전을 먼저 구축하되, 렌더링·입력·상호작용 계층을 분리하여 추후 WebXR 기반 VR 조작 모드로 확장합니다.

### 1.3. 핵심 차별점 (Key Differentiators)

1. **하이브리드 재료 제거 엔진**: 단순 애니메이션이 아니라, 선반 전용 반경 필드와 밀링용 다중 덱셀·희소 복셀 엔진을 조합하여 공작물 형상이 실제 절삭 경로에 따라 변화하도록 구현합니다.
2. **교육 콘텐츠와 공정 시뮬레이션의 통합**: 설명 영상만 제공하는 방식이 아니라 사용자가 기계 설정, 공구 선택, 절삭 조건 입력, 조그 운전, G-code 실행, 측정까지 직접 수행합니다.
3. **다층 사실성 모델**: 기하학적 사실성, 기계 운동학, 충돌, 절삭 부하, 열·공구 마모의 근사 모델, PBR 렌더링, 절삭음·칩 효과를 서로 분리하여 장치 성능에 맞게 단계적으로 활성화합니다.

### 1.4. 제품 범위 (Scope)

#### 포함 범위

- 3축 수직 머시닝센터
- 2축 CNC 선반(X/Z)
- 3+2축 인덱스 가공
- 동시 5축 밀링
- 기초 밀턴 기능은 후속 단계에서 제한적으로 지원
- 기본 공작물 생성과 STL/OBJ/glTF 불러오기
- 선택적 STEP/IGES 불러오기
- G-code 편집·파싱·시각화·실행
- 공구·홀더·바이스·척·클램프·테이블 충돌 검출
- 치수 측정, 잔삭 표시, 공차 비교, 사이클 타임 추정
- 튜토리얼, 과제, 점수, 샌드박스, 결과 리포트
- 한국어·영어 다국어 구조

#### 초기 비포함 범위

- 실제 CNC 장비로의 네트워크 전송 또는 원격 제어
- 특정 제조사 CNC 컨트롤러의 완전한 에뮬레이션
- 인증 가능한 산업용 NC 검증 소프트웨어 대체
- 실제 칩 하나하나의 연속체역학 해석
- 완전한 열-구조 연성 유한요소해석(FEA)
- 공구 파손을 정량적으로 보증하는 예측
- 모바일 기기에서 데스크톱과 동일한 고정밀 시뮬레이션

### 1.5. 사실성 및 정확도 등급

| 등급 | 명칭 | 목적 | 제공 기능 | 한계 |
|---|---|---|---|---|
| E1 | 교육 시각화 | 원리 이해 | 기계 애니메이션, 기본 재료 제거, 공구 경로 | 공정 검증용으로 사용 금지 |
| E2 | 대화형 실습 | 조작 학습 | 파라미터, 조그, G-code, 측정, 튜토리얼 | 절삭력·열은 근사치 |
| S1 | 시뮬레이션 | 오류 탐지 | 축 한계, 충돌, 잔삭, 과절삭, 시간 추정 | 컨트롤러별 세부 동작 차이 존재 |
| S2 | 고정밀 시뮬레이션 | 고급 교육·연구 | 고해상도 복셀, 5축 운동학, 상세 부하 모델 | 산업 인증·실기계 보증 아님 |
| V1 | 산업 검증 | 장기 연구 목표 | 실제 포스트프로세서·제어기 모델 검증 | 별도 검증 데이터와 전문가 인증 필요 |

MVP의 목표는 **E2**, 정식 웹 버전의 목표는 **S1**, 장기 고급 모드의 목표는 **S2**입니다.

---

## 2. 상세 기능 요구사항 (Detailed Requirements)

### 2.1. 시스템 환경 및 인터페이스 (System & Interface)

- **뷰 모드**: Desktop First + Fluid Layout
  - 1440px 이상: 전체 작업실 UI
  - 1024~1439px: 축소형 작업실 UI
  - 768~1023px: 튜토리얼·뷰어 중심 제한 모드
  - 767px 이하: 콘텐츠 학습, 결과 확인, 간단한 공구 경로 재생만 지원
- **테마 정책**: CSS Variables 기반 라이트 모드
- **기본 단위**: 미터법(mm, m/min, mm/rev, mm/tooth, N, N·m, kW)
- **선택 단위**: 인치법(in, SFM, IPR, IPT, lbf)
- **좌표계 표시**: 기계 좌표(MCS), 작업 좌표(WCS), 공구 좌표(TCS), 모델 좌표를 색상과 라벨로 구분
- **카메라**: Orbit, Pan, Zoom, Fit, Isometric, Front/Top/Right, Tool Follow, Operator View, Section View
- **렌더링 품질**: Auto, Low, Medium, High, Ultra
- **접근성**: 키보드 탐색, 고대비 경고, 자막, 모션 감소, 색상 외 아이콘·패턴 병행

### 2.2. 사용자 상호작용 로직 (Interaction Logic)

#### 입력 방식

- 마우스: 카메라, 공구·공작물 선택, 측정, 조작 핸들
- 키보드: 축 조그, 재생 제어, 단계 실행, 비상정지 시뮬레이션
- 터치: 카메라와 단순 파라미터 조작
- 게임패드: 선택 기능으로 조그·카메라 제어
- 코드 입력: Monaco Editor 기반 G-code 편집
- 파일 입력: `.nc`, `.tap`, `.gcode`, `.stl`, `.obj`, `.glb`, 선택적으로 `.step/.stp/.iges/.igs`

#### 핵심 이벤트 처리

1. 사용자가 재료·기계·공구를 선택합니다.
2. 시스템이 기계 축 한계, 공구 직경·길이, 공작물 크기, 고정구 간섭 가능성을 사전 검증합니다.
3. 가공 파라미터가 변경되면 150ms 디바운스 후 절삭 속도·주축 회전수·이송·예상 부하를 재계산합니다.
4. 실행 시 G-code 또는 생성된 공구 경로를 정규화된 Toolpath IR로 변환합니다.
5. 운동학 엔진이 축 위치를 계산하고 충돌·한계 초과를 검사합니다.
6. 재료 제거 엔진이 변경된 영역만 갱신합니다.
7. UI는 타임라인, 공구 부하, 잔여 재료, 경고, 점수를 갱신합니다.

#### 데이터 검증 규칙

- NaN, Infinity, 음수 직경, 0 이하 이송, 비정상 RPM 차단
- 공구 최대 RPM, 기계 최대 RPM, 축 속도·가속도·이동거리 제한
- 공작물 바운딩 박스와 기계 작업영역 비교
- 공구 돌출 길이와 홀더·척 간섭 검증
- 밀링 공구가 선반 전용 터렛에 배치되는 등 호환성 오류 차단
- G-code 파싱 시 지원하지 않는 코드, 컨트롤러 종속 코드, 매크로를 명시적으로 경고
- 업로드 파일 크기 기본 100MB 제한, 고급 설정 최대 500MB
- 압축 폭탄, 비정상 삼각형 수, 자기 교차 메시, 손상된 CAD 파일 차단

### 2.3. 학습 모드 요구사항

#### A. 입문 과정

1. CNC와 절삭가공의 개념
2. 기계 구조와 안전장치
3. 기계 좌표·작업 좌표·원점
4. 공작물, 척, 바이스, 클램프
5. 공구·홀더·인서트 구조
6. 주축 회전수, 절삭 속도, 이송, 절입 깊이
7. 황삭과 정삭
8. 공차, 표면 거칠기, 버, 잔삭

#### B. 밀링 과정

- 페이스 밀링
- 숄더 밀링
- 외곽 윤곽 가공
- 포켓 가공
- 슬롯 가공
- 램핑·헬리컬 진입
- 드릴링·보링·리밍
- 챔퍼·카운터싱크
- 탭·나사 밀링
- 볼 엔드밀 3D 프로파일 가공
- 황삭·잔삭·정삭 비교

#### C. 선반 과정

- 단면 절삭(Facing)
- 외경 종방향 절삭(OD Turning)
- 내경 보링
- 테이퍼 절삭
- 프로파일 절삭
- 홈 가공
- 절단(Parting-off)
- 드릴링
- 나사 절삭
- 일정 절삭속도(CSS)와 일정 RPM 비교
- 척·심압대·공구 오버행 영향

#### D. 5축 과정

- 회전축 A/B/C의 개념
- Table-Table, Head-Table, Head-Head 구조
- 3+2축 인덱스 가공
- 동시 5축 공구 자세 제어
- 공구 중심점 제어(TCP) 개념
- 축 한계, 리와인드, 특이점, 급격한 자세 변화
- 홀더·스핀들·테이블·공작물 충돌
- 블레이드·임펠러 예제

#### E. 과제 평가

- 목표 형상과의 최대·평균 편차
- 과절삭·미절삭 부피
- 표면 거칠기 근사치
- 충돌 및 축 한계 초과 횟수
- 공구 수명 소비량
- 사이클 타임
- 재료 제거율(MRR)
- 에너지 사용량 근사치
- 사용 공구 수와 공정 수

### 2.4. 샌드박스 모드 요구사항

- 기계 선택: 3축 VMC, CNC 선반, 3+2축, 동시 5축
- 공작물 생성: 직육면체, 원통, 튜브, 사용자 모델
- 재료 선택: 알루미늄, 탄소강, 합금강, 스테인리스, 황동, 구리, 티타늄, 주철, POM, ABS, PC, PEEK, 목재
- 공구 선택·조립: 공구 본체, 인서트, 홀더, 콜릿, 연장 길이
- 고정구 선택: 바이스, 3조 척, 4조 척, 콜릿 척, 클램프, 로터리 테이블
- 수동 조그와 MDI 입력
- 공구 경로 생성기: Face, Contour, Pocket, Slot, Drill, Turning Profile
- G-code 직접 작성·불러오기
- 시뮬레이션 속도: 0.1×~100×, 단계 실행, 역방향 스크럽은 체크포인트 기반 지원
- 단면 절개, 투명도, 잔삭 히트맵, 충돌 표시, 공구 부하 그래프
- 측정: 거리, 직경, 반경, 각도, 홀 깊이, 벽 두께, 편차
- 결과 저장·복제·공유

### 2.5. 재료 모델

각 재료는 단순 색상 프리셋이 아니라 가공성 및 시뮬레이션 파라미터를 포함합니다.

| 속성 | 예시 | 용도 |
|---|---|---|
| `densityKgM3` | 2700 | 질량·관성·칩 양 추정 |
| `hardness` | HB/HRC | 난삭성·마모 보정 |
| `specificCuttingForce` | N/mm² | 절삭력 근사 |
| `thermalConductivity` | W/m·K | 열 분산 시각화 |
| `heatCapacity` | J/kg·K | 온도 상승 근사 |
| `machinabilityIndex` | 0~1 | 추천 조건·난이도 |
| `chipType` | short/long/stringy | 칩 효과와 배출 경고 |
| `frictionCoefficient` | 0~1 | 열·부하 보정 |
| `recommendedVcRange` | m/min | 절삭 속도 가이드 |
| `recommendedFeedRange` | mm/rev 또는 mm/tooth | 이송 가이드 |
| `recommendedDepthRange` | mm | 절입 가이드 |
| `pbrMaterial` | metalness/roughness/color | 렌더링 |

초기 재료 프리셋은 범용 교육용 값으로 제공하고, 특정 제조사의 권장 절삭 조건을 그대로 복제하지 않습니다. 모든 값은 공구 재질·코팅·기계 강성·냉각 조건에 따라 달라질 수 있음을 표시합니다.

### 2.6. 공구 라이브러리

#### 밀링·홀 가공 공구

- Flat End Mill
- Ball Nose End Mill
- Bull Nose End Mill
- Face Mill
- Shoulder Mill
- Slot Cutter
- T-slot Cutter
- Dovetail Cutter
- Chamfer Mill
- Center Drill
- Twist Drill
- Step Drill
- Reamer
- Boring Bar
- Tap
- Thread Mill
- Engraving Tool

#### 선반 공구

- 외경 선삭 홀더와 범용 인서트
- 내경 보링 바
- 홈·절단 공구
- 나사 절삭 공구
- 프로파일 공구
- 센터 드릴·드릴

#### 공구 데이터

- 절삭부 형상과 실제 충돌용 형상을 분리
- 직경, 코너 반경, 플루트 수, 절삭 길이, 전체 길이
- 홀더 직경, 게이지 길이, 돌출 길이
- 공구 재질: HSS, 초경, 세라믹, CBN, PCD
- 코팅: None, TiN, TiAlN 등 일반화된 프리셋
- 최대 RPM, 권장 절삭 조건, 마모 상태
- ISO 13399 호환 필드로 확장 가능한 내부 스키마

### 2.7. 데이터 모델 (Data Model)

1. **Project**
   - `id(UUID)`, `name`, `schemaVersion`, `createdAt`, `updatedAt`, `unitSystem`, `machineId`, `stockId`, `operationIds`, `settings`
2. **MachineDefinition**
   - `id`, `type(Enum)`, `kinematicTree`, `axes[]`, `spindles[]`, `workEnvelope`, `maxRpm`, `maxFeed`, `modelAsset`, `collisionGroups`
3. **KinematicAxis**
   - `name`, `kind(linear|rotary)`, `vector`, `pivot`, `min`, `max`, `maxVelocity`, `maxAcceleration`, `home`, `parentId`
4. **Stock**
   - `id`, `primitiveType`, `dimensions`, `transform`, `materialId`, `representationType`, `resolution`, `sourceModel`
5. **MaterialProfile**
   - `id`, `name`, `materialGroup`, `physicalProperties`, `machiningProperties`, `renderProperties`
6. **ToolAssembly**
   - `id`, `toolType`, `cutterGeometry`, `holderGeometry`, `gaugeLength`, `maxRpm`, `wearState`, `materialCompatibility`
7. **Operation**
   - `id`, `type`, `setupId`, `toolId`, `strategy`, `parameters`, `targetGeometry`, `generatedToolpathId`
8. **GCodeProgram**
   - `id`, `dialect`, `sourceText`, `parsedBlocks`, `diagnostics`, `toolTable`, `workOffsets`
9. **ToolpathIR**
   - `segments[]`, `feedMode`, `spindleMode`, `toolState`, `coordinateSystem`, `sourceLineMap`
10. **SimulationSession**
    - `id`, `projectId`, `time`, `machineState`, `toolState`, `stockCheckpointRefs`, `events`, `metrics`
11. **CollisionEvent**
    - `time`, `severity`, `objectA`, `objectB`, `position`, `sourceLine`, `penetrationEstimate`
12. **MeasurementResult**
    - `type`, `points`, `value`, `unit`, `target`, `deviation`
13. **TutorialLesson**
    - `id`, `prerequisites`, `steps`, `allowedActions`, `successRules`, `failureRules`, `hints`
14. **UserProgress**
    - `userId`, `lessonId`, `status`, `score`, `attempts`, `bestMetrics`

### 2.8. 출력 및 성능 기준 (Output & Performance)

#### 결과물 형식

- 프로젝트: `.cncrender` ZIP 컨테이너(JSON 매니페스트 + 바이너리 청크), 잠정 스키마 ID `urn:cnc-render:schema:project:1`, MIME `application/vnd.cnc-render.project+zip`
- 공구 경로: `.nc`, `.tap`, `.gcode`, 내부 `ToolpathIR`
- 결과 모델: STL, glTF/GLB, 선택적 OBJ
- 리포트: JSON, CSV, 인쇄용 HTML/PDF
- 이미지: PNG/WebP 스냅샷
- 영상: 브라우저 `MediaRecorder` 기반 WebM 선택 지원
- 로컬 저장: OPFS + IndexedDB 메타데이터
- 클라우드 저장: 사용자 동의 시 객체 스토리지 + PostgreSQL 메타데이터

#### 품질 기준

| 항목 | 목표 |
|---|---|
| 랜딩 페이지 LCP | 일반 광대역 환경 2.5초 이내 |
| 시뮬레이터 핵심 셸 로딩 | 캐시 미적용 5초 이내 목표 |
| 입력 반응 | 일반 UI 100ms 이내 |
| 렌더링 | Medium 기준 60 FPS, High 기준 30 FPS 이상 |
| 메인 스레드 장기 작업 | 50ms 초과 Long Task 최소화 |
| 기본 메모리 | 600MB 이하 목표 |
| 고정밀 모드 메모리 | 1.5GB 이하 권장 상한 |
| 체크포인트 생성 | 기본 2~5초 간격 또는 공정 단위 |
| 충돌 경고 | 이벤트 발생 후 1프레임 이내 표시 |
| 재현성 | 동일 버전·설정·시드에서 결과 일치 |
| 브라우저 | 최신 Chrome/Edge 우선, Safari/Firefox 단계 지원 |

#### 해상도 프리셋

| 프리셋 | 공작물 표현 | 용도 |
|---|---|---|
| Preview | 저해상도 덱셀/복셀 | 빠른 공구 경로 확인 |
| Balanced | 적응형 희소 복셀 + 국소 표면 추출 | 기본 샌드박스 |
| Precision | 고해상도 ROI 복셀 + 작은 시간 간격 | 측정·잔삭 분석 |
| Ultra | 데스크톱 고성능 GPU 전용 | 데모·연구 |

---

## 3. 기술 스택 및 라이브러리 (Tech Stack)

### 3.1. Core

- **Frontend**: React 19.x, TypeScript, Vite, CSS Modules 또는 Vanilla Extract
- **3D Rendering**: Three.js `WebGPURenderer`, WebGPU/WGSL, WebGL 2 fallback
- **Simulation Core**: Rust + WebAssembly + `wasm-bindgen`
- **Physics & Rigid-body**: Rapier 3D WebAssembly
- **Material Removal**: 자체 Rust/WASM + WebGPU Compute 엔진
- **CAD Kernel**: OpenCascade.js 선택적 지연 로드
- **State Management**: Zustand 5.x + Worker message bus
- **Code Editor**: Monaco Editor
- **Local Persistence**: OPFS, IndexedDB
- **Backend**: 초기 버전은 정적·로컬 우선, 계정 기능 도입 시 Cloudflare Workers 또는 Node.js API
- **Database**: PostgreSQL/Supabase 또는 동급 관리형 DB
- **Object Storage**: Cloudflare R2 또는 S3 호환 스토리지
- **Deployment**: Cloudflare Pages 우선, GitHub Pages는 제한형 데모 빌드에 사용 가능

### 3.2. Libraries & Tools

> 버전은 2026년 7월 기준 목표 범위이며, 실제 개발 시작 시 lockfile과 호환성 테스트를 통해 고정합니다.

1. **Three.js** (필수)
   - **버전**: r180 이상 안정 릴리스
   - **용도**: 머신·공구·공작물 렌더링, 카메라, PBR, 후처리, WebXR 확장
   - **설정**: WebGPU 우선, WebGL 2 fallback, MSAA 4× 선택, 톤매핑, LOD
2. **Rapier 3D** (필수)
   - **버전**: 0.19.x 계열
   - **용도**: 고정구·문·칩·낙하물 등 강체, 광역 충돌 검사, 조인트
   - **주의**: 절삭 형상 제거 엔진으로 사용하지 않음
3. **Rust + wasm-bindgen** (필수)
   - **버전**: 최신 안정 Rust, `wasm-bindgen` 0.2.x
   - **용도**: G-code 파서, 운동학, 공간 자료구조, 복셀 업데이트, 측정
4. **Zustand** (필수)
   - **버전**: 5.0.x
   - **용도**: UI·프로젝트·도구 상태
   - **주의**: 대용량 복셀·메시 버퍼는 Store에 넣지 않고 Worker/WASM 메모리에 유지
5. **Monaco Editor** (필수)
   - **용도**: G-code 구문 강조, 오류 표시, 현재 실행 줄 추적
6. **OpenCascade.js** (선택)
   - **용도**: STEP/IGES/BREP 해석, 테셀레이션, 형상 분석
   - **정책**: 별도 Worker에서 지연 로드하며 기본 번들에서 제외
7. **OpenCAMLib** (기술 검증 선택)
   - **용도**: Drop-cutter, Waterline 등 CAM 알고리즘 참고·프로토타입
   - **정책**: LGPL 라이선스와 유지보수 상태 검토 후 채택 여부 결정
8. **three-mesh-bvh** (선택)
   - **용도**: 삼각형 메시 레이캐스트와 정밀 충돌 가속
9. **glTF-Transform / Draco / Meshopt** (선택)
   - **용도**: 머신 모델 압축, LOD 생성, 네트워크 전송량 절감
10. **Vitest** (필수)
    - **용도**: 단위·수치·파서 테스트
11. **Playwright** (필수)
    - **용도**: 브라우저 E2E, 그래픽 회귀, 입력 시나리오
12. **Storybook** (선택)
    - **용도**: UI 컴포넌트 독립 검증

### 3.3. 기술 선택 원칙

- React는 UI 셸만 담당하고 시뮬레이션 루프와 분리합니다.
- 고부하 연산은 Rust/WASM, Web Worker, WebGPU Compute로 이동합니다.
- WebGPU 미지원 환경은 시뮬레이션 기능과 해상도를 낮춘 WebGL 2 모드로 폴백합니다.
- STEP/IGES와 대형 머신 모델은 사용 시점에만 로드합니다.
- 라이브러리의 물리·충돌 기능과 절삭 재료 제거 기능을 혼동하지 않습니다.
- 공개 API와 프로젝트 파일에는 `schemaVersion`을 두고 마이그레이션을 지원합니다.

---

## 4. 아키텍처 및 로직 (Architecture & Logic)

### 4.1. 전체 아키텍처

```text
┌──────────────────────────────── Browser UI ────────────────────────────────┐
│ React UI │ Tutorial │ G-code Editor │ Inspector │ Timeline │ Reports      │
└───────────────┬──────────────────────────────┬─────────────────────────────┘
                │ commands/events              │ render state
┌───────────────▼──────────────┐  ┌────────────▼─────────────────────────────┐
│ Simulation Coordinator       │  │ Three.js Renderer                        │
│ TypeScript message bus       │  │ WebGPU → WebGL2 fallback                 │
└───────┬──────────┬───────────┘  └───────┬──────────────────────────────────┘
        │          │                      │ GPU buffers/textures
┌───────▼───┐ ┌────▼────────────┐  ┌──────▼──────────────────────────────────┐
│ G-code    │ │ Kinematics &    │  │ Material Removal Compute               │
│ Parser    │ │ Collision WASM  │  │ Multi-dexel / Sparse voxel / SDF       │
└───────┬───┘ └────┬────────────┘  └──────┬──────────────────────────────────┘
        │ ToolpathIR│ axis state           │ changed bricks / surface mesh
┌───────▼───────────▼──────────────────────▼─────────────────────────────────┐
│ Shared Simulation Memory: toolpath, machine state, stock field, metrics    │
└─────────────────────────────────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────────────────┐
│ OPFS / IndexedDB / Optional Cloud Sync                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2. 상태 관리 전략 (State Management)

#### Scope

- **React/Zustand 전역 상태**: 프로젝트 메타데이터, 선택한 기계·공구·재료, 패널 상태, 현재 튜토리얼 단계
- **지역 상태**: 폼 입력, 드롭다운, 모달, 카메라 일시 상태
- **Simulation Worker 상태**: Toolpath IR, 축 상태, 충돌 검사, 절삭 이벤트
- **WASM/WebGPU 메모리**: 복셀, 덱셀, SDF, 가속구조, 표면 버퍼
- **영속 상태**: 프로젝트, 체크포인트, 사용자 진행도, 설정

```typescript
interface AppStore {
  projectId: string | null;
  machineId: string | null;
  selectedToolId: string | null;
  mode: 'tutorial' | 'sandbox' | 'gcode';
  playback: {
    status: 'idle' | 'running' | 'paused' | 'stopped';
    speed: number;
    time: number;
  };
  diagnostics: SimulationDiagnostic[];
  setPlaybackSpeed(speed: number): void;
  dispatchSimulation(command: SimulationCommand): void;
}
```

대용량 TypedArray를 Zustand에 직접 저장하지 않습니다. UI에는 요약 메트릭과 참조 ID만 전달합니다.

### 4.3. 주요 동작 파이프라인 (Main Workflow)

1. **초기화 (Init)**
   - 브라우저 기능 감지: WebGPU, WebGL 2, WebAssembly, SharedArrayBuffer, OPFS
   - 성능 티어 산정
   - 기본 머신·재료·공구 카탈로그 메타데이터 로드
   - Worker와 WASM 초기화
   - 프로젝트 복원 또는 새 프로젝트 생성
2. **입력 정규화 (Normalize)**
   - 사용자가 입력한 G-code 또는 UI 공정을 내부 Operation 모델로 변환
   - 단위와 좌표계 통일
   - 공구·오프셋·주축·이송 모달 상태 해석
3. **공구 경로 생성·해석 (Toolpath)**
   - 직선, 원호, 헬릭스, 드웰, 공구 교환, 좌표 변경을 Toolpath IR로 생성
   - 원호와 회전축 이동은 오차 허용치에 따라 적응형 샘플링
4. **운동학 계산 (Kinematics)**
   - 공구 끝점과 자세를 각 기계 축의 위치로 변환
   - 축 한계, 속도, 가속도, 특이점, 리와인드 필요 여부 확인
5. **충돌 검사 (Verification)**
   - Broad Phase: AABB/BVH
   - Narrow Phase: 삼각형·볼록체·분석형 공구 충돌
   - 기계-기계, 기계-공작물, 공구 홀더-공작물, 고정구-공구 검사
6. **재료 제거 (Stock Update)**
   - 공구의 swept volume을 시간 구간별로 계산
   - 변경되는 복셀 브릭·덱셀만 갱신
   - 표면 메시와 법선을 부분 재생성
7. **공정 물리 근사 (Process Model)**
   - 접촉 폭·깊이·칩 두께·MRR 계산
   - 절삭력, 토크, 주축 동력, 열, 공구 마모 위험 계산
8. **렌더링·피드백 (Render & Feedback)**
   - 공작물, 공구, 칩, 냉각수, 열 지도, 경고 표시
   - 절삭음의 주파수·음량을 RPM과 부하에 연동
9. **체크포인트·저장 (Persist)**
   - 일정 시간 또는 공정 경계에서 압축 체크포인트 생성
   - 역방향 스크럽 시 가장 가까운 체크포인트부터 재생

### 4.4. G-code 파서 및 중간 표현

#### 지원 우선순위

- G0, G1, G2, G3
- G17/G18/G19 평면
- G20/G21 단위
- G54~G59 작업 좌표
- G90/G91 절대·증분
- G94/G95 이송 모드
- G96/G97 선반 주축 모드
- G40/G41/G42 공구 반경 보정은 단계적 지원
- G43/G49 공구 길이 보정
- G81~G89 고정 사이클은 내부 동작으로 확장
- M3/M4/M5, M6, M8/M9, M0/M1/M2/M30
- T, S, F, X/Y/Z/A/B/C/I/J/K/R/P/Q

#### 파서 구조

```text
Source Text
  → Lexer
  → Block Parser
  → Modal State Machine
  → Semantic Validation
  → Canonical Motion Commands
  → Toolpath IR
  → Machine Kinematics
```

#### 컨트롤러 방언

`dialect` 필드를 통해 Fanuc-like, Haas-like, LinuxCNC-like 프리셋을 지원하되 초기 버전은 공통 부분집합을 사용합니다. 제조사 고유 매크로와 사용자 변수는 완전 지원으로 오해되지 않도록 별도 경고합니다.

### 4.5. 핵심 알고리즘 (Core Algorithms)

#### 4.5.1. 재료 제거 표현

1. **선반 반경 필드**
   - 공작물 축을 따라 `r(z)` 또는 2D XZ 격자를 저장
   - 회전 대칭 외경·내경 절삭을 매우 빠르게 계산
   - 홈, 테이퍼, 단면, 프로파일, 드릴·보링에 최적화
2. **다중 덱셀(Multi-dexel)**
   - X/Y/Z 방향 깊이 구간을 저장
   - 2.5D·3축 밀링 프리뷰와 얇은 형상 표현에 사용
   - 전체 복셀보다 메모리 효율이 높음
3. **희소 복셀 브릭(Sparse Voxel Bricks)**
   - 16³ 또는 32³ 단위 브릭을 필요할 때만 할당
   - 동시 5축, 언더컷, 임의 방향 절삭 지원
4. **국소 SDF**
   - 변경 영역에 한해 부호 거리장 생성
   - 부드러운 표면 법선과 고품질 메시 추출에 사용
5. **표면 추출**
   - Preview: 덱셀 기반 직접 표면
   - Balanced/Precision: Marching Cubes 또는 Dual Contouring
   - 변경 브릭만 재생성하고 GPU 버퍼를 부분 업데이트

#### 4.5.2. Swept Volume 근사

- 선형·원호·5축 자세 변화 구간을 위치 오차와 각도 오차에 따라 적응형 분할
- 각 구간의 공구 형상 합집합을 분석형 또는 샘플 기반으로 계산
- 공구 반경, 코너 반경, 홀더 형상을 별도 레이어로 관리
- 절삭부는 재료 제거, 비절삭부는 충돌만 수행
- 5축에서는 위치 변화와 공구축 방향 변화 모두 샘플링 기준에 반영

#### 4.5.3. 기계 운동학

- 기계를 parent-child 노드의 Kinematic Tree로 표현
- 선형축은 변환행렬, 회전축은 pivot + axis-angle로 계산
- 3+2축은 목표 자세를 먼저 고정한 후 XYZ 공구 경로 계산
- 동시 5축은 Tool Center Point와 Tool Axis Vector를 축 값으로 변환
- 다해가 존재할 경우 축 이동량, 한계 여유, 특이점 거리, 충돌 위험을 비용 함수로 평가

```text
cost = w1·axisTravel + w2·limitPenalty + w3·singularityRisk
     + w4·collisionRisk + w5·orientationDiscontinuity
```

#### 4.5.4. 절삭 조건과 부하 근사

기본 공식은 교육용 계산기로 제공하며 단위 검증을 포함합니다.

- 주축 회전수: `n = (1000 × Vc) / (π × Dc)`
- 밀링 이송: `Vf = fz × z × n`
- 선반 이송: `Vf = fn × n`
- 밀링 재료 제거율: `Q = ap × ae × Vf`
- 선반 재료 제거율: `Q ≈ π × D × n × fn × ap`
- 주절삭력 근사: `Fc ≈ kc × A_chip`
- 절삭 동력 근사: `Pc = Fc × Vc / 60000`

여기서 `Vc`는 m/min, `Dc`와 `D`는 mm, `n`은 rpm, `fz`는 mm/tooth, `fn`은 mm/rev, `ap`와 `ae`는 mm입니다. 실제 절삭력은 공구 형상, 날끝 반경, 경사각, 마모, 재료 상태, 냉각, 진동에 따라 달라지므로 결과에는 신뢰 구간과 “근사” 표기를 붙입니다.

#### 4.5.5. 표면 거칠기·공구 마모 근사

- 선반 이상적 이론 거칠기: `Ra ≈ f² / (32 × rε)`
- 볼 엔드밀 스캘럽 높이: 공구 반경과 스텝오버 기반 기하학적 근사
- 공구 수명: Taylor 식 `V × T^n = C`를 재료·공구 프리셋에 맞춰 상대 지수화
- 온도: 절삭 동력 중 열 전환 비율과 재료 열용량을 이용한 lumped model
- 채터: 공구 오버행, 공작물 얇기, 절입량, 날 통과 주파수 기반 위험 점수

채터와 파손은 확정 판정이 아니라 **Low/Medium/High Risk**로 표시합니다.

#### 4.5.6. 충돌 검사

- Broad Phase: 축별 AABB, Sweep and Prune 또는 BVH
- Narrow Phase: Convex/mesh, capsule/cylinder, triangle queries
- 검사 그룹:
  - Tool Cutter ↔ Stock: 정상 절삭 또는 과절삭
  - Tool Shank/Holder ↔ Stock: 충돌
  - Tool/Holder ↔ Fixture: 충돌
  - Spindle/Head ↔ Table/Fixture/Stock: 충돌
  - Turret ↔ Chuck/Tailstock: 충돌
  - Machine Link ↔ Machine Link: 자체 충돌
- “시각 애니메이션”과 “정밀 검증”을 분리해 고속 재생 중에도 백그라운드 검증을 유지

#### 4.5.7. 칩·냉각수·음향

- 칩은 제거된 부피, 공구 날 수, 재료 chipType을 기반으로 GPU 파티클 생성
- 실제 제거 형상과 칩 시각효과는 분리하여 성능을 확보
- 냉각수는 화면 공간 파티클 또는 곡선 스트림으로 표현
- 스핀들 기본음: RPM 기반 고조파 합성
- 절삭음: 날 통과 주파수 `n × z / 60`과 절삭 부하로 변조
- 채터 위험 시 측대역과 진폭 변조를 추가하되 청각 피로를 고려한 음량 제한 적용

### 4.6. 성능 티어

| 티어 | 조건 | 기능 |
|---|---|---|
| A | WebGPU + SharedArrayBuffer + 고성능 GPU | 고정밀 복셀, 5축, 고급 후처리 |
| B | WebGPU, 공유 메모리 제한 | Worker 복사 최소화, 중간 해상도 |
| C | WebGL 2 + WASM | 덱셀 중심, 단순 칩, 3축·선반 우선 |
| D | 저성능·모바일 | 공구 경로 재생, 튜토리얼, 결과 뷰어 |

### 4.7. 저장 및 동기화

- 프로젝트 바이너리와 체크포인트는 OPFS에 저장
- 검색 가능한 메타데이터와 설정은 IndexedDB에 저장
- 자동 저장은 30초 간격 또는 중요 변경 시 수행
- 클라우드 동기화는 콘텐츠 해시 기반 증분 업로드
- 충돌 시 로컬·클라우드 사본을 모두 보존하고 사용자가 병합 선택
- 대용량 체크포인트는 LZ4/Zstd-WASM 등 빠른 압축을 평가

---

## 5. UI 구현 가이드 (Implementation Guide)

### 5.1. 디자인 토큰 (Design Tokens)

- **Colors**
  - `--bg-primary`: `#0B0F14`
  - `--bg-panel`: `#151B23`
  - `--border`: `#2B3440`
  - `--text-primary`: `#E8EDF3`
  - `--text-secondary`: `#A8B2C1`
  - `--accent-toolpath`: `#22D3EE`
  - `--accent-safety`: `#FF8A00`
  - `--success`: `#22C55E`
  - `--warning`: `#F59E0B`
  - `--danger`: `#EF4444`
- **Typography**: Pretendard Variable, Inter fallback, JetBrains Mono for G-code·수치
- **Base Size**: 14px, 작업실 내 수치 최소 12px
- **Breakpoints**: Mobile 768px, Tablet 1024px, Desktop 1440px, Wide 1920px
- **Spacing**: 4px 기반 4/8/12/16/24/32
- **Radius**: 6px 기본, 기계 제어 패널은 과도한 라운드 금지

### 5.2. 화면 구성

#### 데스크톱 작업실

- 상단: 프로젝트, 모드, 실행, 저장, 품질, 도움말
- 좌측: 튜토리얼 또는 프로젝트 트리
- 중앙: 3D 머신 뷰포트
- 우측: 기계·공구·재료·가공 파라미터 Inspector
- 하단: G-code, 타임라인, 진단, 부하 그래프 탭
- 플로팅: 축 좌표, FPS, 품질 티어, 비상정지

#### 모바일·태블릿

- 전체 기계 조작 대신 공구 경로 재생과 단계별 학습에 집중
- 파라미터 패널은 Bottom Sheet
- 고해상도 재료 제거는 비활성화하거나 서버 렌더 결과만 표시

### 5.3. 공통 컴포넌트 (Shared Components)

- **Button**: `variant`, `size`, `danger`, `loading`, `shortcut`, `disabledReason`
- **UnitInput**: 단위 변환, 범위, 유효성, 스텝, 추천값 표시
- **ParameterSlider**: 숫자 직접 입력과 슬라이더 병행
- **MachineViewport**: 카메라, 선택, 단면, 측정, 품질 제어
- **MachineTree**: 축·부품·충돌 그룹 계층
- **ToolLibrary**: 검색, 필터, 공구 조립, 호환성
- **MaterialLibrary**: 물성, 가공성, 추천 조건
- **GCodeEditor**: 진단, 현재 줄, 브레이크포인트, MDI
- **SimulationTimeline**: 이벤트 마커, 체크포인트, 구간 반복
- **DiagnosticPanel**: 오류, 경고, 정보, 원인, 해결책
- **MeasurementOverlay**: 스냅, 치수, 공차, 편차
- **TutorialStep**: 목표, 허용 행동, 힌트, 성공 조건
- **PerformanceHUD**: FPS, GPU 시간, Worker 시간, 메모리, 복셀 수
- **EmergencyStop**: 시뮬레이션 즉시 정지, 상태 명확화

### 5.4. 오류·경고 표현

- 위험도: Info, Advisory, Warning, Critical
- 충돌은 3D 위치, 타임라인, G-code 줄을 동시에 연결
- 경고 색상만 사용하지 않고 아이콘·문구·패턴 병행
- 오류 메시지는 “무엇이 잘못되었는지–왜 발생했는지–어떻게 수정하는지” 순서로 작성

---

## 6. 파일 구조 (File Structure)

```text
cnc-render/
├── apps/
│   ├── web/                         # React 웹 애플리케이션
│   │   ├── public/
│   │   └── src/
│   │       ├── app/                 # 라우팅, Provider, 초기화
│   │       ├── assets/              # UI 정적 리소스
│   │       ├── components/
│   │       │   ├── common/
│   │       │   ├── editor/
│   │       │   ├── inspector/
│   │       │   ├── tutorial/
│   │       │   └── viewport/
│   │       ├── features/
│   │       │   ├── machines/
│   │       │   ├── materials/
│   │       │   ├── tools/
│   │       │   ├── operations/
│   │       │   ├── gcode/
│   │       │   ├── simulation/
│   │       │   ├── measurement/
│   │       │   └── reports/
│   │       ├── render/              # Three.js 렌더러·씬·셰이더
│   │       ├── workers/             # Worker 진입점
│   │       ├── store/               # Zustand UI 상태
│   │       ├── persistence/         # OPFS/IndexedDB
│   │       ├── i18n/
│   │       └── styles/
│   └── api/                         # 선택적 클라우드 API
├── crates/
│   ├── gcode-core/                  # Lexer, Parser, Modal State
│   ├── toolpath-core/               # Toolpath IR, interpolation
│   ├── kinematics-core/             # 3/5축 운동학
│   ├── collision-core/              # BVH, 충돌 규칙
│   ├── stock-core/                  # Dexel/Voxel/SDF
│   ├── process-physics/              # 힘·열·마모 근사
│   ├── measurement-core/            # 거리·편차·잔삭
│   └── cnc-render-wasm/              # wasm-bindgen 통합
├── packages/
│   ├── domain-models/               # TypeScript 스키마
│   ├── machine-schema/              # 머신 정의·검증
│   ├── tool-schema/                 # 공구 정의·검증
│   ├── material-schema/             # 재료 정의·검증
│   ├── lesson-engine/               # 튜토리얼 규칙
│   ├── ui/                          # 공통 UI
│   └── test-fixtures/               # 테스트 모델·G-code
├── shaders/
│   ├── stock-removal/               # WGSL compute
│   ├── surface-extraction/
│   ├── chips/
│   └── visualization/
├── content/
│   ├── lessons/ko/
│   ├── lessons/en/
│   ├── machines/
│   ├── tools/
│   └── materials/
├── tests/
│   ├── unit/
│   ├── geometry/
│   ├── gcode/
│   ├── kinematics/
│   ├── collision/
│   ├── performance/
│   ├── visual-regression/
│   └── e2e/
├── scripts/
│   ├── build-machine-pack/
│   ├── optimize-assets/
│   ├── validate-catalog/
│   └── benchmark/
├── docs/
│   ├── technical-whitepaper.md
│   ├── design-whitepaper.md
│   ├── content-spec.md
│   ├── machine-schema.md
│   ├── gcode-support-matrix.md
│   ├── performance-budget.md
│   └── qa-harness.md
├── package.json
├── pnpm-workspace.yaml
├── Cargo.toml
├── vite.config.ts
├── playwright.config.ts
└── README.md
```

---

## 7. 개발 시 주의사항 (Implementation Notes)

### 7.1. 보안 (Security)

1. G-code와 CAD 파일은 데이터로만 처리하며 `eval`, 동적 스크립트, 셸 명령을 실행하지 않습니다.
2. 업로드 파일은 확장자뿐 아니라 MIME, 매직 바이트, 구조를 검증합니다.
3. WASM 모듈과 머신 팩은 해시·무결성 검사를 수행합니다.
4. CSP를 적용하고 외부 스크립트·임의 iframe을 제한합니다.
5. SharedArrayBuffer 사용을 위해 COOP/COEP를 설정하고 모든 외부 리소스의 CORS/CORP 정책을 관리합니다.
6. 프로젝트 공유 링크는 기본 비공개이며 예측 불가능한 ID와 권한 검사를 사용합니다.
7. 서버 업로드 모델은 악성 메시, 과도한 다각형, 압축 폭탄, 비정상 재귀 구조를 제한합니다.
8. 실제 장비로의 전송 기능은 제공하지 않으며, 내보낸 G-code에는 교육용 시뮬레이션 결과임을 표시합니다.
9. 종속성은 lockfile, SBOM, OSV 검사, Dependabot/Renovate를 통해 관리합니다.

### 7.2. 성능 최적화 (Optimization)

1. UI, 운동학, 재료 제거, CAD import를 별도 스레드·모듈로 분리합니다.
2. 복셀 브릭은 변경 구역만 할당하고 dirty region만 재메시합니다.
3. 공구 경로는 화면 해상도와 시뮬레이션 오차에 따라 LOD를 적용합니다.
4. 머신 메시에는 LOD, Meshopt/Draco 압축, 인스턴싱을 적용합니다.
5. 공구·볼트·칩은 InstancedMesh 또는 GPU indirect rendering을 사용합니다.
6. Worker 간 데이터는 Transferable 또는 SharedArrayBuffer를 사용하여 복사를 최소화합니다.
7. 렌더링과 검증 주기를 분리합니다. 예: 렌더링 60Hz, 물리 60~120Hz, 고정밀 검증 비동기 배치.
8. 카메라 밖 기계 부품과 보이지 않는 칩은 컬링합니다.
9. CAD Kernel은 STEP/IGES 사용 시에만 지연 로드합니다.
10. 기기 성능에 따라 해상도·그림자·칩·후처리를 자동 조정합니다.

### 7.3. 수치 정밀도

- 내부 길이 단위는 mm로 통일합니다.
- 대형 기계 모델은 로컬 원점과 계층 변환을 사용해 부동소수점 오차를 줄입니다.
- 화면 렌더링은 Float32를 사용하되, 공구 경로·측정·운동학 계산은 Rust `f64`를 기본으로 합니다.
- 비교에는 절대 오차와 상대 오차를 함께 사용합니다.
- 메시 결과의 정밀도와 실제 공차를 동일시하지 않습니다. 복셀 해상도보다 작은 공차는 표시하지 않습니다.

### 7.4. 알려진 기술 이슈 (Known Issues)

1. WebGPU는 브라우저와 GPU 드라이버별 지원 차이가 있으므로 기능 탐지와 WebGL 2 폴백이 필수입니다.
2. 고해상도 3D 복셀은 메모리를 빠르게 소비합니다. 전체 512³ 밀집 배열은 기본 모드에 부적합합니다.
3. STEP/IGES 해석은 파일 구조에 따라 로딩 시간이 길고 WASM 번들이 큽니다.
4. 동시 5축 역기구학은 기계 구조마다 해가 다르고 특이점·리와인드 정책이 필요합니다.
5. G-code는 컨트롤러 방언 차이가 크므로 “지원 코드 목록”을 버전별로 공개해야 합니다.
6. 실시간 칩 형상을 물리적으로 정확하게 계산하는 것은 브라우저 범위에서 비현실적이므로 시각 효과로 분리합니다.
7. 절삭력, 열, 마모, 채터는 재료·공구 데이터 품질에 민감하며 초기값은 교육용 근사입니다.
8. Safari/iOS 및 일부 환경에서는 공유 메모리·파일 시스템·WebGPU 제약이 발생할 수 있습니다.
9. 모바일 브라우저는 발열·메모리·배터리 제약 때문에 고정밀 모드를 지원하지 않습니다.
10. Cross-origin isolation은 일부 로그인 팝업·외부 위젯과 충돌할 수 있으므로 인증 흐름을 리디렉션 방식으로 설계합니다.

### 7.5. 콘텐츠 정확성

- 모든 튜토리얼은 CNC 가공 경험자 또는 관련 전공자의 기술 검수를 거칩니다.
- 재료와 공구 추천값은 범위로 표시하며 절대값으로 보증하지 않습니다.
- 안전 교육은 실제 장비 제조사 매뉴얼과 작업장 규정을 대체하지 않습니다.
- “충돌 없음” 결과가 실제 장비에서의 안전을 보증하지 않는다는 고지를 항상 유지합니다.

---

## 8. 단계별 구현 로드맵 (Implementation Roadmap)

### Phase 0. 기술 프로토타입

- Three.js WebGPU/WebGL 2 듀얼 렌더러
- 원통·직육면체 공작물
- Flat End Mill과 단순 절삭
- 선반 반경 필드
- 기본 G0/G1 파서
- 3축·2축 기계 애니메이션
- 성능 벤치마크와 복셀 메모리 검증

**완료 기준**: 데스크톱 브라우저에서 기본 페이스 밀링과 외경 선삭을 30 FPS 이상으로 실행

### Phase 1. MVP 교육 실습

- 3축 밀링 + 2축 선반
- 10개 내외 공구와 6개 재료
- Face, Contour, Pocket, Slot, Drill, Facing, OD, Taper
- 기본 충돌, 축 한계, 측정, 점수
- 한국어 튜토리얼 12~20개
- 로컬 프로젝트 저장

**완료 기준**: E2 등급 달성

### Phase 2. G-code Lab 및 공정 분석

- 공통 G/M 코드 확대
- Monaco Editor 진단
- 원호·고정 사이클·보정
- 잔삭·과절삭 히트맵
- 절삭력·동력·열·마모 근사
- 리포트·결과 모델 내보내기

**완료 기준**: 공통 교육용 G-code 프로그램의 재생과 오류 진단

### Phase 3. 3+2축 및 동시 5축

- 2개 이상의 머신 운동학 프리셋
- TCP, 회전축, 특이점, 리와인드
- 희소 복셀 고정밀 모드
- 홀더·스핀들·테이블 충돌
- 임펠러·블레이드 예제

**완료 기준**: S1 등급의 5축 교육 시뮬레이션

### Phase 4. 플랫폼화

- 계정·진행도 동기화
- 과제·퀴즈·수료 시스템
- 사용자 프로젝트 공유
- 머신·공구·재료 팩 시스템
- 관리자 콘텐츠 편집기
- 영어 콘텐츠

### Phase 5. WebXR/VR

- WebXR 입력 추상화
- 1:1 스케일 작업실
- 컨트롤러 기반 조그·공구 선택·측정
- 데스크톱과 동일한 Simulation Core 재사용
- 멀미 저감 이동 방식과 안전 경계

---

## 9. QA 및 검증 전략 (Quality Assurance)

### 9.1. 수치·기하 테스트

- 직선 절삭 후 예상 바운딩 박스 비교
- 원통 외경 절삭 후 반경 오차 비교
- 드릴링 후 홀 직경·깊이 비교
- 구·평면·원통에 대한 공구 접촉 해석 테스트
- 복셀 해상도별 체적 오차 측정
- 회전축 0°, 90°, 180°의 변환행렬 검증

### 9.2. G-code 테스트

- LinuxCNC 공통 문법 기반 Golden Files
- 모달 상태, 단위, 절대·증분, 평면, 원호, 좌표 오프셋
- 잘못된 코드와 오류 위치 검증
- 동일 G-code의 Toolpath IR 스냅샷 테스트
- 실행 줄과 3D 위치의 source map 검증

### 9.3. 충돌 테스트

- 공구 절삭부와 공작물은 정상 절삭으로 분류
- 홀더와 공작물은 충돌로 분류
- Rapid move 중 공작물 침범 검출
- 축 한계와 overtravel 검출
- 5축 기계 링크 자체 충돌
- 시간 보간 간격 변화에 따른 누락률 검증

### 9.4. 성능 테스트

- 통합 GPU, 중급 GPU, 고급 GPU, Apple Silicon 분류
- 100K, 1M, 10M Toolpath segment 시나리오
- 128³, 256³, 희소 512³ 상당 해상도
- 5분·30분·2시간 연속 실행 메모리 누수
- 탭 비활성화·복귀, 화면 크기 변경, 컨텍스트 손실 복구

### 9.5. 시각 회귀

- 고정 카메라와 시드로 머신·공작물 스냅샷 비교
- PBR 재료, 경고 색, 단면, 히트맵
- WebGPU와 WebGL 2 간 허용 가능한 차이 범위 설정

### 9.6. 전문가 검수

- 밀링·선반·5축 각 분야 검수자 지정
- 공정 설명, 공구 선택, 경고 문구, 결과 해석 검토
- 사용자 테스트: 비전공자, 공학 전공자, 현장 경험자 그룹 분리

---

## 10. 위험요소 및 대응 (Risks & Mitigations)

| 위험 | 영향 | 대응 |
|---|---|---|
| WebGPU 지원 편차 | 기능 미작동 | WebGL 2 폴백, 티어 감지, Chromium 우선 QA |
| 복셀 메모리 폭증 | 탭 종료·OOM | 희소 브릭, ROI, 해상도 자동 조절, 메모리 HUD |
| 5축 운동학 복잡성 | 잘못된 축 경로 | 머신별 플러그인, Golden Pose, 다해 비용 함수 |
| G-code 방언 차이 | 잘못된 해석 | 지원 매트릭스, 명시적 dialect, 미지원 코드 차단 |
| 물리 정확도 과대 기대 | 사용자 오용 | 정확도 등급, 근사 표시, 산업 검증 비대체 고지 |
| CAD 파일 다양성 | import 실패 | 형식 제한, 사전 검증, 서버 변환 선택지 |
| 자산 라이선스 | 배포 제한 | 자체 모델 또는 적법 라이선스, SPDX 목록 |
| 외부 라이브러리 중단 | 유지보수 위험 | 핵심 알고리즘 자체 소유, 어댑터 계층, 포크 가능성 |
| 긴 초기 로딩 | 이탈률 증가 | 코드 분할, 머신 팩 지연 로드, 튜토리얼 셸 우선 표시 |
| 공유 메모리 보안 헤더 | 외부 로그인 충돌 | 리디렉션 인증, 리소스 자체 호스팅, COOP/COEP 테스트 |

---

## 11. 비기능 요구사항 (Non-functional Requirements)

### 11.1. 유지보수성

- Core는 UI 프레임워크와 독립된 Rust/TypeScript API로 유지
- 머신·공구·재료·튜토리얼을 코드 변경 없이 데이터 팩으로 추가
- 모든 스키마에 JSON Schema 또는 Zod/Rust 동등 검증 적용
- 변경 로그와 마이그레이션 도구 제공

### 11.2. 확장성

- 새로운 기계 운동학은 `MachineKinematicsPlugin`으로 추가
- 새로운 재료 모델은 파라미터 팩과 Process Model 확장으로 추가
- 절삭 외 레이저·워터젯·적층 공정은 별도 Process Engine으로 확장 가능
- WebXR은 입력·카메라 계층만 교체하고 Simulation Core를 재사용

### 11.3. 국제화

- UI 문자열, 튜토리얼, 단위, 소수점·천 단위 구분을 분리
- 기계 코드와 변수명은 영문 표준 유지
- 한국어·영어를 1차 지원하고 일본어·독일어 확장 고려

### 11.4. 관측성

- 로컬 Performance HUD
- 사용자 동의형 익명 성능 텔레메트리
- 오류 코드, GPU/브라우저 티어, 프로젝트 스키마 버전 기록
- 업로드 모델 원본이나 G-code 내용은 기본 수집 금지

---

## 12. 기술적 의사결정 요약 (Architecture Decision Summary)

| 결정 | 선택 | 이유 |
|---|---|---|
| 렌더링 | Three.js + WebGPU, WebGL 2 fallback | 최신 GPU 연산과 브라우저 호환성 균형 |
| 절삭 형상 | 다중 덱셀 + 희소 복셀 + 국소 SDF | 3축·선반·5축을 하나의 방식보다 효율적으로 처리 |
| 물리엔진 | Rapier는 보조 강체·충돌에 사용 | 절삭 제거와 일반 강체 물리는 문제 성격이 다름 |
| 고성능 코어 | Rust/WASM | 수치 연산, 메모리 제어, 테스트 가능성 |
| 상태 | UI와 시뮬레이션 메모리 분리 | React 리렌더링과 대용량 버퍼 문제 방지 |
| 저장 | OPFS + IndexedDB | 대형 바이너리와 메타데이터를 브라우저 로컬에 효율적으로 저장 |
| CAD | OpenCascade.js 지연 로드 | STEP/IGES 지원과 초기 번들 크기 분리 |
| 배포 | Cloudflare Pages + R2 | 정적 셸, 대형 자산, 보안 헤더, 글로벌 배포에 적합 |
| 정확도 | 교육·시뮬레이션 등급 명시 | 산업용 검증 도구로 오인되는 위험 방지 |

---

## 13. 참고 자료 (References)

1. CAPA, “CNC 가공 총정리: 공작 기계를 통한 제품 생산”  
   https://capa.ai/knowledge/post/cnc-%EA%B0%80%EA%B3%B5-%EC%B4%9D%EC%A0%95%EB%A6%AC-%EA%B3%B5%EC%9E%91-%EA%B8%B0%EA%B3%84%EB%A5%BC-%ED%86%B5%ED%95%9C-%EC%A0%9C%ED%92%88-%EC%83%9D%EC%82%B0
2. Sandvik Coromant, Metal Cutting Knowledge  
   https://www.sandvik.coromant.com/en-gb/knowledge
3. Sandvik Coromant, General Turning  
   https://www.sandvik.coromant.com/en-gb/knowledge/general-turning
4. Sandvik Coromant, Milling  
   https://www.sandvik.coromant.com/en-gb/knowledge/milling
5. Sandvik Coromant, Drilling  
   https://www.sandvik.coromant.com/en-gb/knowledge/drilling
6. Sandvik Coromant, Machining Formulas and Definitions  
   https://www.sandvik.coromant.com/en-gb/knowledge/machining-formulas-definitions
7. Autodesk Fusion Help, Simulation for Manufacturing  
   https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-REF-SIMULATION
8. LinuxCNC, G-code Overview  
   https://linuxcnc.org/docs/html/gcode/overview.html
9. MDN, WebGPU API  
   https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
10. Three.js, WebGPURenderer  
    https://threejs.org/docs/pages/WebGPURenderer.html
11. Rapier, JavaScript Getting Started  
    https://rapier.rs/docs/user_guides/javascript/getting_started_js/
12. Open CASCADE, OpenCascade.js  
    https://dev.opencascade.org/project/opencascadejs
13. MDN, Web Workers  
    https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
14. MDN, SharedArrayBuffer  
    https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
15. MDN, Origin Private File System  
    https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
16. OpenCAMLib  
    https://github.com/aewallin/opencamlib
17. Schnös et al., “GPU accelerated voxel-based machining simulation,” The International Journal of Advanced Manufacturing Technology, 2021  
    https://link.springer.com/article/10.1007/s00170-021-07001-w

---

## 14. 결론

CNC Render의 구현 가능성은 충분하지만, “사실적인 3D CNC 시뮬레이터”를 일반 게임형 3D 프로젝트로 접근해서는 목표를 달성하기 어렵습니다. 핵심은 기계 운동학, G-code 해석, 재료 제거, 충돌 검증, 절삭 공정 근사, 렌더링을 각각 독립된 계층으로 설계하고 장치 성능에 따라 사실성 수준을 조절하는 것입니다.

초기 MVP에서는 3축 밀링과 2축 선반의 대표 공정을 정확하고 빠르게 구현하여 교육 경험을 완성하고, 이후 3+2축과 동시 5축을 희소 복셀·운동학 플러그인 구조 위에 추가하는 순서가 가장 안정적입니다. 이 방식은 웹 버전의 성능과 접근성을 확보하면서도 추후 WebXR 기반 VR, 사용자 제작 머신 팩, 고급 공정 분석으로 확장할 수 있는 기술적 기반을 제공합니다.
