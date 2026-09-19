# ADR 0017 — 기준 벤치마크와 브라우저 증거 매트릭스

- 상태: 승인
- 날짜: 2026-09-12
- 참조: 기술 백서 §2.8·§4.6·§9.4, 디자인 백서 §7.2–§7.8,
  QA harness M12 DoD 1–6·10, ADR-0005·0009·0016

## 결정

> 2026-09-12 후속: [ADR 0018](0018-release-hardening-and-resource-gates.md)이 High 경로,
> 사용자 기준 장비 승인, Lighthouse 및 메모리 검증을 추가한다. 아래 초기 v1의
> High 미구현/장비 미승인 설명은 당시 상태이며, 전체 릴리스 미완료 판단은 유지한다.

1. 기존 `pnpm bench`의 Node smoke budget을 유지한다. `--report`를 지정하면 전체
   Node gate 뒤 production Pages에서 별도의 Playwright benchmark matrix를 실행한다.
   Node wall-clock gate도 간섭을 피하도록 파일 단위 직렬 실행하며 임계값은 바꾸지 않는다.
2. `software`는 bundled Chromium + SwiftShader 2개 backend, `reference`는 설치된
   Chrome/Edge channel의 기본 headless GPU 설정 4개 backend, `all`은 총 6개다.
   새 브라우저 설치나 사용자 프로필 접근을 하지 않는다. 실행하지 못한 조합은 실패로 남긴다.
3. 각각 실제 M7 milling/turning/drilling fixture를 실행한다. balanced·seed 7 입력,
   고정 1440×900 CSS px·DPR 1, fast-forward 1회 warmup 후 realtime 100배속 반복을
   최소 8,000 ms 관찰한다. 완료 공정 경계에서 종료하므로 실제 측정 길이·반복 횟수도 기록한다.
4. demand-driven renderer를 idle FPS로 평가하지 않는다. 측정 중 카메라 orbit을
   wall-clock 기준 초당 15°로 계속 무효화해 렌더 기회를 제공하면서 실제 절삭·Stock upload를 함께 실행한다.
   프레임 수에 비례해 회전 속도가 달라지지 않도록 한다(`workloadVersion: 1`).
   완료 프레임 수 / wall-clock 초를 FPS로 쓰고, rAF에서 관찰한 완료 프레임 간격 P95를
   보조 지표로 쓴다. CPU render 제출 시간의 역수나 rAF callback 수를 GPU FPS로 쓰지 않는다.
5. 실제 backend가 요청과 다르면 실패한다. 각 공정의 Toolpath semantic hash,
   Stock hash, 최종 XYZ mm·진단 코드·제거 체적·단계 수를 모든 조합에서 정확히 비교한다.
   현재 같은 WASM Stock 계약이므로 backend별 오차를 새로 허용하지 않는다.
6. 실행 중 workspace React commit 0, coordinator maximumMainHandlerMs < 50,
   공정별 longTasksOver50Ms <= 1은 기존 기준을 유지한다. 카메라·측정 오버헤드도 포함한다.
7. GPU 정보는 WebGL 실제 canvas의 debug renderer 또는 WebGPU adapter probe로 읽는다.
   SwiftShader 등은 항상 software, 비공개/빈 adapter는 unverified다. 나머지도
   hardware-candidate일 뿐 승인된 기준 실장비라고 자동 인증하지 않는다.
8. fresh browser context의 local Pages shell 준비 시간을 기록한다. 이는 localhost·
   비스로틀링·headless 증거이며 광대역 landing LCP/Lighthouse나 공개 cold-load 검증이 아니다.
9. `performance.memory.usedJSHeapSize`는 선택적 페이지 JS heap 참고값이다.
   Worker/WASM/GPU 전체 또는 peak 메모리라고 표현하지 않고 총 메모리 gate는 미측정으로 남긴다.
10. 현재 전체 파이프라인은 독립 High 프리셋이 없어 `not-implemented`다. 해상도 확대를
    High로 이름만 바꾸지 않는다. 60 FPS·30 FPS·5,000 ms·600 MB·1.5 GB 기준은 유지한다.
11. 리포트에 OS·CPU·RAM·브라우저 실제 버전·GPU probe·실제 canvas 크기·릴리스 SHA와
    WASM 해시를 남긴다. 사용자명/hostname/로컬 프로젝트명/원본 G-code는 넣지 않는다.
    실행 실패는 원문 예외(로컬 경로 포함 가능) 대신 고정 reason code로 기록한다.
12. `functionalStatus`(실행/동등성)와 `gateStatus`(메인 스레드 예산을 포함한 테스트),
    개별 성능 판정, `releaseStatus: incomplete`를 분리한다. 예산 초과 테스트는 계속
    실패하지만 확보된 유효 semantic/Stock 증거까지 동등성 비교에서 버리지 않는다.
    명령 성공은 측정과 기능/parity gate 통과이지 FPS/전체 M12 릴리스 승인과 같지 않다.
    CI는 software matrix만 자동 실행하고 JSON을 실패 시에도 30일 보존한다.

## 사용

### 2026-09-19 실행별 Long Task 판정 (사용자 승인)

- 앱 생애 누적 `longTasksOver50Ms`를 실행별 최대값으로 잘못 사용하던 판정식을 수정한다.
  각 realtime 실행에 영향을 준 50 ms 초과 task의 개수를 계산하고 그 최대값에 <=1을 적용한다.
  warmup도 별도 실행으로 기록하며 동일한 <=1 기준을 적용한다. handler <50 ms는 그대로다.
- 독립 PerformanceObserver의 원본 시작 시각·길이와 실행 구간을 보존한다. observer 전달 지연은
  귀속에 영향을 주지 않는다. task와 실행의 반열린 시간 구간이 최초로 겹치는 실행에 한 번만
  귀속한다. 종료 task 안의 Promise continuation이 다음 실행을 시작해도 중복 집계하지 않는다.
  warmup + 실행별 합계 + 실행 사이 발생분은 전체 관찰 누적과 정확히 일치한다.
- `longTaskAggregationVersion: 2`, 실행별 배열·최대값·warmup 값과 관찰 전체 누적을 저장한다.
  실행 사이 발생분 및 앱 자체의 기존 생애 누적도 별도 보존한다. 누적값에 실행당 한도를 적용하지 않는다.
  원본 구간에서 집계를 다시 계산해 증거 산술을 검증하므로 구형/누락/변조 증거는 통과할 수 없다.
- FPS 관찰 창, 공정 반복 횟수 결정, warmup 작업량, handler 기준은 바꾸지 않는다.
  기존 실패 보고서는 유지하고 새 판정은 새 측정으로 검증한다.

### 2026-09-19 Windows software 스케줄링 보정

- Playwright 1.63.0 / Chromium 153으로 고정한다. Chrome/Edge 153 지원은
  [공식 릴리스](https://playwright.dev/docs/release-notes#version-163)를 따른다.
- Windows Chromium은 GPU 프로세스를 `AboveNormal`로 올린다
  ([Chromium 소스](https://chromium.googlesource.com/chromium/src.git/+/refs/tags/141.0.7390.112/content/gpu/gpu_main.cc)).
  SwiftShader는 CPU에서 GPU 작업을 실행하므로 Normal인 renderer/Worker를 밀어낼 수 있다.
  로컬 trace에서 171 ms 메시지 처리의 스레드 CPU 시간은 1.5 ms였으며, 장기 선삭 진단의
  long task 99회가 작업 전용 GPU를 Normal로 맞춘 동일 60초 진단에서 0회로 줄었다.
  진단은 gate 대신 사용하지 않는다.
- **Windows의 명시적 software benchmark만** CDP가 반환한 단일 GPU PID를 사용해
  Normal로 맞춘다. 실행 파일 전체 경로와 `--type=gpu-process`를 교차 검사하고, 예기치 않은
  우선순위·식별 실패는 테스트 실패다. 사용자 브라우저·다른 프로세스·전원 설정은 변경하지 않는다.
  작업 브라우저 종료와 함께 설정도 소멸한다. 실제 GPU reference 및 Linux CI는 변경하지 않는다.
- shell readiness는 기존 시점에 측정하고, 스케줄링 보정은 첫 Fixture 실행 전에 적용한다.
  보고서 `softwareGpuScheduling`에 정책·전후 우선순위를 남긴다. 화질, 격자, warmup,
  최소 8초 관찰, handler <50 ms, long task <=1, 60/30 FPS 및 메모리 한도는 그대로다.
- 별도 GPU fence 및 새 브라우저 프로세스/공정 실험은 실패를 해결하지 못해 제거했다.
  기존 fresh-context 매트릭스와 프로파일 원본·실패 보고서는 유지한다.
- Chromium 140 → 153의 Windows 문자 굵기·줄바꿈 차이는 동일 앱/이전 브라우저 대조와
  이미지 직접 비교로 확인했다. G-code 오류·Lesson 성공/실패 3개 기준 이미지만 갱신하며
  겹침·잘림 검증과 1% pixel 한도는 유지한다. machine/heatmap 기준은 그대로다.

```sh
pnpm bench
pnpm bench -- --report=artifacts/benchmark-software.json --matrix=software
pnpm bench -- --report=artifacts/benchmark-reference.json --matrix=reference
pnpm bench -- --report=artifacts/benchmark-report.json --matrix=all
```

- matrix 보고서는 전체 Node suite와 함께 실행한다. `--filter` 또는 임의 Vitest 옵션과
  혼합하지 않는다. 리포트 경로는 workspace `artifacts/*.json` 하위로 제한한다.
- 과거 성공 리포트가 재사용되지 않도록 시작 시 incomplete marker로 덮어쓴다.
- 벤치마크 동안 다른 build/E2E/성능 검사를 병렬 실행하지 않는다.
- 이 명령은 로컬 테스트 서버만 사용한다. 공개 배포나 데이터 전송이 없다.

## 남은 검증

- Chrome/Edge 버전은 설치된 실행 파일의 관찰값이며 최신 배포 채널 일치 여부는 릴리스
  시점에 별도 확인한다. 승인된 장비의 실제 화면/주사율·전원·드라이버 설정도 필요하다.
- Firefox는 별도 Gecko 기능 검사, Safari는 macOS 실제 Safari 검사가 필요하다.
  Playwright WebKit 통과를 Safari 인증으로 치환하지 않는다.
- High 경로, 100K/1M/10M Toolpath·대형 Stock, 장시간 peak/누수 메모리,
  총 메모리·공개 LCP, 프레임 단위 충돌 전체 matrix는 별도 단위다.
- 이 matrix는 E2 대표 공정 증거이며 산업용 검증 정확도나 모든 브라우저 기능을 보증하지 않는다.
