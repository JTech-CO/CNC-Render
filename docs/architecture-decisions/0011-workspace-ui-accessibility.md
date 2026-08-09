# ADR-0011: 작업실 UI는 라이트 단일 토큰과 저빈도 React 투영을 사용한다

- 상태: Accepted
- 날짜: 2026-08-09
- 마일스톤: M9 — 디자인 시스템·Workspace UI·접근성

## 맥락

M3의 3D 작업실, M7의 Worker/WASM 전체 파이프라인과 M8의 로컬 저장은 각각
동작했지만 공개 작업실에서는 도움말과 작업 영역이 연결되지 않았고, 재료 제거 및 공구
이동도 사용자가 시작하고 관찰할 수 없었다. 작업실을 하나의 React 상태 트리로 묶으면
Stock TypedArray와 10~20Hz 축 갱신이 React commit을 유발해 렌더 성능과 접근성 DOM을
동시에 악화시킨다. 한편 디자인 백서는 라이트모드, 9개 목표 해상도, 200% 확대,
WCAG 2.2 AA 목표와 정량 UI 예산을 요구한다.

## 결정

1. `design/tokens/cnc-render.tokens.json`을 색상·간격·타이포그래피·반경의 단일
   소스로 사용한다. 생성기는 CSS custom property와 TypeScript 상수를 만들며
   `pnpm check:tokens`가 drift를 거부한다.
2. 시스템 색상 설정과 무관하게 `color-scheme: light`만 제공한다. 다크 토큰,
   테마 토글, `prefers-color-scheme: dark` 분기를 두지 않는다.
3. `packages/ui`는 Button, native Dialog, Tabs, UnitInput, ParameterRow와 DataTable의
   의미 구조와 키보드 동작을 제공한다. 애플리케이션은 동일한 토큰 CSS를 직접 사용하고
   Storybook은 컴포넌트의 기본·비활성·대화상자·탭 상태를 문서화한다.
4. React는 Global Command Bar, Activity/Context Rail, Inspector와 Bottom Dock의
   저빈도 선택·명령 상태만 소유한다. 복셀·덱셀·반경 필드와 대형 TypedArray는
   React/Zustand에 넣지 않는다.
5. Worker의 Stock full/patch 이벤트는 렌더러 버퍼에 직접 적용한다. 축 요약은 최대
   20Hz로 holder/cutter 레이어에 직접 전달하고, 일반 실행 요약과 HUD 텍스트는 최대
   10Hz로 DOM에 투영한다. 이 경로는 시뮬레이션 프레임마다 React commit을 만들지 않는다.
6. 공구 위치는 도메인 mm 좌표를 장면 좌표로 변환한다. 교육용 VMC 장면의 공구 끝
   home은 Z 340 mm로 문서화하며 holder와 cutter가 같은 translation을 공유한다.
7. 1440×900의 상단 작업 콘텐츠에서 뷰포트 영역을 60% 이상 확보한다. 뷰포트 너비가
   720px 미만이면 좌우 패널 중 하나를 접고, 작은 화면에서도 작업 영역 탐색과
   실행·정지·저장·도움말을 유지한다.
8. 도움말은 native modal dialog로 제공하고 닫힐 때 호출 버튼으로 포커스를 되돌린다.
   탭은 Enter/Space와 Arrow Left/Right, Home/End를 지원한다. 상태는 색상만 사용하지
   않고 문구, 단위, 진단 항목, G-code 줄과 3D 마커로 함께 표현한다.
9. WebGPU와 WebGL 2는 동일한 작업실 명령 및 Worker/WASM 절삭 경로를 사용한다.
   WebGL 2의 기존 CPU/WASM 메시 프리뷰 제한은 상태 텍스트로 계속 노출한다.
10. 보이는 DOM 2,000개, 대표 UI 처리 평균 4ms, CSS gzip 80KiB, 초기 WOFF2
    400KiB, HUD 10~20Hz 예산을 자동 검증한다. axe Critical/Serious 0건, 200% 확대,
    9개 해상도, 라이트 팔레트 불변과 금지 스타일 검사를 CI 가능한 명령으로 둔다.
    M7 Long Task 관측은 첫 대표 공정 실행 직전에 시작하고 이후 실행에는 누적해 초기
    UI·렌더러 준비 비용과 시뮬레이션 실행 비용을 분리한다.

## 결과와 제한

- 도움말, 코드·학습·결과 탐색, 상단 실행/정지/저장 명령이 실제 작업실 기능과 연결된다.
- 재료 제거와 공구 이동은 Worker/WASM 결과를 점진적으로 표시하면서 React 프레임
  갱신 불변식을 지킨다.
- native dialog와 button을 우선해 포커스와 고대비 모드의 브라우저 동작을 활용한다.
- M9의 학습 영역은 안내와 대표 절삭 실행만 제공한다. 단계 검증·힌트·채점·정식
  밀링/선삭/드릴링 튜토리얼은 M10 범위다.
- 코드 영역은 현재 프로그램 탐색만 제공한다. Monaco 편집, 줄 진단, breakpoint,
  측정·목표 비교·heatmap·내보내기는 M11 범위다.
- 산업용 검증 도구와 동일성을 주장하지 않으며 현재 대표 공정과 결과에는 E2를 표시한다.
