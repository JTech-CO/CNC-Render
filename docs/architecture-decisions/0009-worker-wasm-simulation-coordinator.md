# ADR-0009: 전용 Worker가 Rust/WASM 시뮬레이션 실행을 소유한다

- 상태: Accepted
- 날짜: 2026-08-01
- 마일스톤: M7 — G-code부터 renderer까지 Worker/WASM 전체 파이프라인

## 맥락

M2의 Rust G-code parser와 Toolpath IR, M4의 운동학·충돌, M5·M6의 밀링·선반
재료 제거를 브라우저의 실제 실행 경로로 연결해야 한다. 이 계산을 메인 스레드나
React 상태에서 수행하면 프레임마다 UI tree가 갱신되고 대형 Stock 배열이 복제될 수
있다. 재생 배속과 빠른 실행이 논리 결과를 바꾸거나, 취소된 실행의 늦은 메시지가 새
장면을 덮는 것도 막아야 한다.

## 결정

1. 전용 module Worker가 G-code parse, Toolpath IR, 논리 시계, 축 상태, 충돌,
   재료 제거와 실행 lifecycle을 소유한다. React는 실행 프레임을 소유하지 않으며
   UI shell과 명령 전달만 담당한다.
2. 수치 core는 `cnc-render-wasm` Rust crate를 `wasm32-unknown-unknown`으로 빌드해
   실행한다. 외부 glue 생성기 없이 versioned C ABI를 사용하고, JSON 제어 결과와
   별도 binary buffer의 pointer/length를 노출한다.
3. Stock 전체 배열과 dirty patch는 WASM·Worker·renderer 메모리에만 둔다.
   Worker 메시지는 엄격한 JSON envelope와 binary slice descriptor를 보내며,
   실제 `ArrayBuffer`는 별도 Transferable로 수신자에게 소유권을 넘긴다.
4. 메인 스레드 coordinator는 모든 메시지를 runtime schema로 검증한다. Worker
   generation, `runId`, 단조 증가 event sequence가 현재 실행과 다르면 renderer와
   UI listener에 전달하지 않고 stale event로 계수한다.
5. 논리 시간은 Toolpath와 운동학 결과에서만 계산한다. `0.1x..100x` 재생 배속과
   realtime/fast-forward mode는 다음 Worker step의 표시 지연만 바꾸며, core 입력,
   step 순서, Stock hash와 최종 semantic hash를 바꾸지 않는다.
6. pause는 예정된 step을 취소하고 WASM snapshot을 반환한다. resume 전까지 논리
   시간, Stock revision/hash, 축 위치와 diagnostics는 변하지 않는다. cancel·dispose와
   Worker restart는 generation을 올리고 이전 callback과 timer를 무효화한다.
7. renderer dirty update는 Worker 메시지마다 즉시 소비하되 일반 수치 UI는 최대
   10 Hz, 축 위치 UI는 최대 20 Hz로 독립 sampling한다. terminal update는 두 UI
   channel에 즉시 전달한다.
8. WebGPU와 WebGL 2는 동일한 CPU/WASM surface snapshot·patch 계약을 소비한다.
   WebGL 2에는 compute 기반 재구성이 없지만 M7의 밀링·선반 결과와 lifecycle 기능은
   동일하게 검증한다.
9. production build는 고정 Rust toolchain으로 WASM을 만든 뒤
   `dist/client/wasm/cnc_render_wasm.wasm`에 게시한다. Worker는 같은 origin의
   `/wasm/cnc_render_wasm.wasm`만 로드한다.

## 거부한 대안

- 메인 스레드 TypeScript core 실행: UI long task와 구현 drift를 만들고 Rust parity를
  실제 제품 경로로 승격하지 못한다.
- React 또는 Zustand에 Stock·축 frame 저장: 대형 배열 복제와 frame 단위 commit을
  유발하므로 저장하지 않는다.
- inline JSON 숫자 배열: 구조화 복제 비용과 소유권이 불명확해 별도 Transferable
  buffer와 descriptor를 사용한다.
- 배속에 따라 core time step 변경: 결과가 재생 모드에 의존하므로 표시 지연만 바꾼다.
- 취소 시 UI에서만 결과 무시: Worker timer와 WASM session까지 명시적으로 취소하고
  세대·실행·sequence 세 경계에서 늦은 이벤트를 차단한다.

## 결과와 제한

- 대표 밀링·선반 G-code가 실제 Rust/WASM core를 거쳐 WebGPU·WebGL 2 renderer의
  dirty surface 갱신까지 도달한다.
- 동일 입력은 realtime과 fast-forward에서 같은 최종 semantic/Stock hash를 만들며,
  pause와 cancel/restart lifecycle을 독립적으로 검증할 수 있다.
- M7 fixture는 단일 공구의 대표 직선 공정이다. 임의 공구 교환, macro/subprogram,
  controller look-ahead, servo 오차, 다중 spindle·turret, 장시간 대형 Stock streaming은
  후속 범위다.
- 결과는 E2 교육용 근사 검증이며 산업용 CAM verification, 공작기계 안전 인증 또는
  실제 controller 결과와 동일하다고 표현하지 않는다.
