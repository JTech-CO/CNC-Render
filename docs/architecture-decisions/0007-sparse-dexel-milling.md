# ADR 0007 — 희소 Z-덱셀 기반 3축 밀링 재료 제거

- 상태: 채택
- 날짜: 2026-08-01
- 범위: M5 3축 밀링 재료 제거, 측정, 표면 갱신

## 배경

M5는 face, slot, pocket, outer contour 절삭을 결정론적으로 재현하고,
해석 부피와 비교 가능한 Stock 상태를 만들어야 한다. 매 절삭 단계마다 전체
복셀 또는 메시를 다시 만들면 브라우저 메모리와 GPU 업로드 비용이 Stock 전체
크기에 비례한다. 또한 대형 배열을 React/Zustand에 넣으면 렌더 프레임과
시뮬레이션 프레임이 결합된다.

## 결정

1. packages/simulation과 Rust simulation-core가 재료 제거 상태를 소유한다.
   React는 엔진 핸들과 숫자 요약만 다루며 덱셀 배열을 상태 저장소에 넣지 않는다.
2. M5의 표준 표현은 16×16 XY 브릭으로 나눈 희소 Z-덱셀이다. 할당되지 않은
   브릭은 손상되지 않은 원재료를 뜻한다. 각 덱셀은 Stock 바닥부터 현재 표면까지
   하나의 solid interval을 갖는다. 이 형태는 multi-dexel interval 계약의
   3축·언더컷 없음 부분집합이다.
3. 내부 길이 단위는 canonical mm이다. 경로·부피·측정과 Rust 기준 계산은
   f64/JavaScript number를 사용하고 렌더러 경계에서만 Float32Array로
   변환한다.
4. Stock의 resolutionMm에 Preview 2×, Balanced 1×, Precision 0.5×를
   적용한다. Golden fixture 상대 부피 오차 상한은 각각 5%, 2%, 1%다.
5. flat-end mill의 선형 이동은 XY capsule 안에 들어오는 덱셀별로 swept
   interval을 해석해 가장 낮은 공구 끝 Z를 구한다. cutter만 재료를 제거하며
   holder는 M4 충돌 경로에 남는다.
6. 절삭으로 깊이가 실제 증가한 덱셀만 dirty로 기록한다. 초기 전체 표면
   스냅샷 뒤에는 dirty 브릭의 변경 덱셀만 renderer composition 경계로 보낸다.
   renderer는 하나의 사전 할당 BufferGeometry를 유지하고 해당 vertex range만
   갱신한다. WebGPU와 WebGL 2 모두 같은 CPU/WASM 패치를 소비하며, WebGL 2
   폴백은 compute 표면 추출 없이 CPU 패치 업로드만 제공한다.
7. Stock hash는 버전, seed, preset, 해상도, 경계, grid, 정렬된 희소 브릭의
   정수 깊이 레이어를 canonical JSON으로 만든 뒤 SHA-256으로 계산한다.
   입력·버전·설정·seed가 같으면 TypeScript와 Rust에서 같은 hash를 내야 한다.
8. 거리, 깊이, 벽 두께 측정은 표현 해상도를 결과와 함께 반환한다. 결과를
   메시 정밀도나 산업용 검증 공차와 동일하다고 표현하지 않는다.

## 거부한 대안

- Stock 전체의 dense 3D voxel: 단순하지만 빈 공간까지 상시 할당해 M5 메모리
  상한과 5분 연속 절삭 안정성에 불리하다.
- 매 step 전체 marching-cubes remesh: 결과가 매끄러워도 부피 정확도를
  증명하지 못하며 CPU와 GPU 업로드가 전체 Stock 크기에 비례한다.
- Rapier 형상 차집합: 충돌 라이브러리의 책임을 재료 제거까지 확장하므로
  사용하지 않는다.
- Zustand에 높이 필드 저장: 시뮬레이션 프레임마다 React 구독 트리를
  갱신하므로 사용하지 않는다.

## 결과와 제한

- 변경 비용은 전체 Stock이 아니라 접촉한 브릭과 덱셀에 비례한다.
- 비접촉 이동은 정확히 0 부피, 0 브릭 할당, 0 GPU 패치를 보장한다.
- M5는 axis-aligned box Stock, flat-end mill, 수직 3축, 언더컷 없는 한 개
  Z interval만 지원한다. 원통 Stock, ball/bull tool, 다중 interval,
  X/Y dexel field와 local SDF는 후속 마일스톤 범위다.
- 브라우저는 M7 Worker/WASM coordinator 전까지 TypeScript reference core를
  사용한다. 정확도 표시는 교육용 E2이며 산업용 CAM 검증·기계 안전 인증과
  동일하지 않다.
