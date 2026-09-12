# 브라우저 검증 매트릭스

2026-09-12 로컬 Pages, benchmark workload v1의 **대표 공정 검증**이다.
모든 제품 기능이나 최신 브라우저 배포 채널을 인증한 결과가 아니다.
공개 Pages와 현재 작업 브랜치의 배포 시점도 다를 수 있다.

## 측정 환경

- Windows build 10.0.26200, Intel Core i7-13620H, logical CPU 16개,
  OS 보고 RAM 68,406,099,968 bytes, Node 24.18.0.
- viewport 1440×900 CSS px, DPR 1, headless, 새 browser context, localhost Pages,
  네트워크 throttling 없음. 실제 canvas 크기는 각 JSON sample에 기록한다.
- 밀링·외경 선삭·센터 드릴링: balanced / seed 7. 실제 전용 Worker/Rust WASM 실행.
- fast-forward 1회 warmup 후 realtime 100배속 반복, 최소 8초 측정,
  camera orbit 15°/s. demand-driven renderer에 지속적으로 렌더 기회를 제공한다.
- 소스 기반 SHA `2f48a6f…`, 제품/엔진 0.9.0, schema/protocol 1,
  `sourceDirty: true`인 개발 산출물이며 공개 릴리스가 아니다.

## 최종 관찰값

| 브라우저·설치 버전 | 관찰 GPU | WebGPU | WebGL 2 | 세 공정 FPS 범위 |
|---|---|---|---|---|
| Chromium 140.0.7339.16 | 명시적 SwiftShader | 기능/예산 gate 통과 | 기능/예산 gate 통과 | WebGPU 5.92–11.44 / WebGL 2 10.88–21.81; 실장비 FPS 판정 제외 |
| Chrome 152.0.7977.83 | WebGPU: NVIDIA lovelace / WebGL 2: RTX 4060 Laptop GPU | 기능/예산 gate 통과 | 기능/예산 gate 통과 | 118.80–119.78 |
| Edge 153.0.4234.32 | WebGPU: Intel gen-12lp / WebGL 2: Intel UHD Graphics | 기능/예산 gate 통과 | 기능/예산 gate 통과 | 119.46–119.85 |
| Firefox | 미측정 | 미검증 | 미검증 | 별도 Gecko 검사 필요 |
| Safari | 미측정 | 미검증 | 미검증 | macOS 실제 Safari 검사 필요 |

- 18/18 테스트와 세 공정의 cross-browser/backend semantic·Stock hash·최종 XYZ mm·
  진단 코드·제거 체적·단계 수의 **정확한 일치**를 확인했다.
- 모든 조합에서 실행 중 workspace React commit 증가 0, 최대 main handler < 50 ms,
  공정당 50 ms 초과 long task <= 1을 통과했다. 실제 최종 long task는 전부 0이었다.
- 로컬 cold-context 셸 준비는 약 515–2,268 ms였다. landing LCP 또는 광대역 공개
  cold-load로 해석하지 않는다. GPU/Worker 전체 메모리는 측정하지 않았다.
- Chrome과 Edge가 서로 다른 GPU를 사용했으므로 순수 브라우저 성능 우열 비교가 아니다.
  headless 완료 프레임 관찰이며 GPU timestamp query 또는 실제 모니터 표시율 측정도 아니다.

## 초기 실패와 제한

- 최초 프레임당 고정각 camera 조사에서는 Chrome WebGPU drilling handler가 66.9 ms,
  Chrome WebGL 2 milling long task가 5회로 **16/18**만 통과했다.
- 프레임 속도에 따라 카메라 속도가 달라지지 않도록 시간 기준으로 정규화한 뒤
  최종 v1을 재실행해 18/18 통과했다. 렌더러/엔진 최적화를 한 것은 아니며, 이 보정이
  초기 초과를 해결했다고 단정하지 않는다. GPU 초기화·캐시·전원 상태를 통제한 반복
  cold 측정으로 변동성을 확인해야 한다. 최초 실패 리포트도 보존한다.
- Medium 대표 후보 측정은 60 FPS 기준을 충족했지만 기준 장비 승인은 별도다.
  독립 High 파이프라인은 아직 없고, 총 메모리·장기 soak·대형 Toolpath/Stock·전체
  collision matrix·Firefox/Safari·최신 버전 확인·공개 LCP가 남아 있다.
- 따라서 JSON의 `releaseStatus`는 계속 `incomplete`다. `gateStatus`는 메인 스레드
  예산까지 포함한 실행 검사, `functionalStatus`는 기능/가공 동등성 판정이다.

## 재현과 증거

```sh
pnpm bench -- --report=artifacts/benchmark-reference-v1.json --matrix=all
```

- 최종 로컬 JSON: `artifacts/benchmark-reference-v1.json`
  (`2026-09-12T10:48:28.008Z`, workloadVersion 1).
- 초기 조사 JSON: `artifacts/benchmark-report.json` (16 passed / 2 failed).
- 생성 JSON은 git에서 제외한다. CI는 software 조합을 따로 측정해
  `benchmark-software-matrix` artifact로 성공/실패 결과를 30일 보존하도록 구성했다.
  이번 작업에서 원격 CI를 실행하거나 공개 배포하지 않았다.
- 상세 방법·한계·명령: [ADR 0017](architecture-decisions/0017-reference-benchmark-matrix.md).
