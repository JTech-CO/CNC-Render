# 브라우저 검증 매트릭스

2026-09-19 로컬 Pages의 **대표 공정 검증**과 이전 이력이다.
모든 제품 기능이나 최신 브라우저 배포 채널을 인증한 결과가 아니다.
공개 Pages와 현재 작업 브랜치의 배포 시점도 다를 수 있다.

## M12 후속 검증 상태

### 공개 릴리스 확인 (2026-09-20)

- PR #13이 `43db00c`로 main에 병합됐으며 main CI/Pages 35451660934가 성공했다.
- 공개 Pages 기능·출처 검사 2개 통과: 도움말·탭·Monaco/Worker·WASM 절삭·결과 저장,
  공개 commit SHA·WASM MIME/해시 일치를 확인했다. main CI LCP는 773.612/783.719/782.089 ms다.
- 과거 단발 LCP 6273.8 ms는 사용자 승인된 미해결 P2로 남긴다. 실패 기록·2.5초 기준은 유지한다.
- M12 릴리스 완료는 아래 승인 장비의 대표 공정 범위와 명시된 제한에 해당한다.
  Firefox/실제 Safari, 임의 대형 프로젝트 및 장시간 실행을 새로 인증한 것이 아니다.
  아래 대기/미완료 표현은 각 측정 당시의 이력이며 현재 완료 판정은 PROGRESS.md를 따른다.

### 실행별 Long Task 판정 및 최신 브라우저 재측정 (2026-09-19)

- Chrome 153.0.8010.50 / Edge 153.0.4234.48, 기존 승인 PC·1440×900·DPR 1.
  Chrome은 NVIDIA RTX 4060 Laptop, Edge는 Intel UHD 경로로 관찰했다.
- 실장비 24/24 및 Toolpath·축·진단·Stock 동등성 통과. 최소 FPS 기본 117.867,
  고정밀 119.522, cold shell 최대 1652.5 ms, handler 최대 10.8 ms, 모든 long task 0.
- software 12/12 통과. WebGPU 고정밀 선삭의 관찰 누적 11회는 실행별 최대 1회이며
  두 값을 모두 보존한다. warmup 0, 전체 handler 최대 10.4 ms. ADR 0017의 승인된
  실행별 판정이며 전체 누적을 삭제하거나 software FPS를 실장비 증거로 사용하지 않는다.
- 메모리 유효 8/8 통과. 각 60초 이상·33–37 samples, 한도와 산식은 유지했다.

| Browser / backend | Balanced peak MB | Precision peak MB |
|---|---:|---:|
| Chrome / WebGPU | 455.54 | 462.69 |
| Chrome / WebGL 2 | 346.60 | 376.93 |
| Edge / WebGPU | 481.92 | 512.95 |
| Edge / WebGL 2 | 349.27 | 391.10 |

- Edge 2개 조합의 프로세스 종료 취득 오류 원본은 보존하고 해당 조합만 새 브라우저로
  다시 취득했다. 유효한 예산 초과 측정값은 없었으며 수치 샘플을 제외하지 않았다.
- LCP 964.8/980.5/969.6 ms. 런타임 지문:
  `f00362e1f9450a2bc469f919691ab121e8cde07283f711594ce3423a48dfd7ab`.
  최신 브라우저 visual 5·E2E 88·a11y 6·Pages 2·bundle 검증 통과.
  기존 opt-in soak 2개는 별도 실행이며 새 원격 CI·공개 릴리스 검증은 대기 중이다.
  아래는 이전 측정 이력이며 현재 수치와 혼합하지 않는다.

### 회전 소재 최적화 후 이전 결과 (2026-09-13)

- 기준 장비 24/24 및 Toolpath·축·진단·Stock 동등성 통과.
  최저 FPS balanced 119.784 / precision 119.665, cold shell 최대 1513.8 ms,
  handler 최대 23.4 ms, long task 0, 실행 중 React commit 증가 0.
- 메모리 8개 유효 조합 통과. 각 60초 이상, 26–37 samples, 332–355회 세 공정 반복.
  승인된 앱 귀속 산식 및 600 MB/1.5 GB 한도는 그대로다.

| Browser / backend | Balanced peak MB | Precision peak MB |
|---|---:|---:|
| Chrome / WebGPU | 441.11 | 470.30 |
| Chrome / WebGL 2 | 310.82 | 311.33 |
| Edge / WebGPU | 445.85 | 475.80 |
| Edge / WebGL 2 | 351.79 | 341.54 |

- 프로세스 종료 중 취득 오류는 별도 보존했고, 목록 갱신으로 새 유효 샘플을 취득했다.
  값이 있는 샘플이나 한도 초과를 제외·재시도하지 않았다. 자세한 산식·제한은 ADR 0018 참조.
- Lighthouse LCP 835.9/795.6/807.4 ms, 로컬 software 12/12, 전체 E2E 88개,
  visual 5개, a11y·Pages·bundle 통과. 원격 CI의 이전 handler 초과는 재검증 대기다.
- 최신 증거 지문: `702e06a7a60ced9f1d4889dd0ad2bedcbf0844f3013d999932e1f97067e291d8`.
  아래 측정은 모두 이전 이력이며 최신 수치와 혼합하지 않는다.

### 최종 학습 레이아웃 수정 후 (로컬 검증)

- 기본 119.289 / 고정밀 109.684 최저 FPS, cold shell 최대 1175.3 ms,
  handler 최대 21.7 ms, long task 0. 기준 장비 24/24 및 동등성 통과.
- 메모리 8/8 통과. 같은 승인 산식·600 MB/1.5 GB 한도이며 각 60초 이상,
  39–41 samples, 126–290회 세 공정 반복이다.

| Browser / backend | Balanced peak MB | Precision peak MB |
|---|---:|---:|
| Chrome / WebGPU | 438.58 | 457.40 |
| Chrome / WebGL 2 | 304.66 | 361.59 |
| Edge / WebGPU | 489.05 | 521.24 |
| Edge / WebGL 2 | 363.63 | 378.08 |

- Windows visual 5개 및 a11y/Pages 통과. Linux는 Xvfb+SwiftShader Vulkan 합성으로
  전체 E2E 88개를 통과했다. OS system font 차이는 별도 baseline으로 검토하며 1% 기준 유지.
  좁은 학습 측정 행의 겹침도 수정·검사한다. 최종 통합 CI/공개 배포는 아직 대기 중이다.
- 현재 증거의 런타임 지문은 `c164223c566b2aa1529ce4d0228a78644e82b8fe9372d412d2f4cd52e20b9066`.
  아래 이전 측정 수치는 이력이며 최신 값과 섞어 비교하지 않는다.

### 리소스 수명 수정 후, 학습 레이아웃 수정 전

- `benchmark-reference-final.json`: 실장비 24/24 통과. 최저 FPS balanced 119.028,
  precision 112.013, cold shell 최대 1585.8 ms, handler 최대 21.7 ms, long task 0.
  같은 프리셋의 Toolpath·축·진단·Stock 결과가 브라우저/backend 간 정확히 일치했다.
- Lighthouse 최종 3회 LCP 925.0/948.5/979.1 ms, 전체 E2E 88개 및 visual 5개,
  a11y/Pages/bundle 통과. 원격 CI·공개 배포 검증은 별도 진행한다.
- `benchmark-software-v5.json`: 두 backend × 세 공정 × 두 프리셋 12/12 통과,
  최대 handler 42.5 ms, long task 0. 아래 v3/v4 실패 이력은 그대로 보존한다.
- 메모리는 매 조합 새 브라우저를 사용하고, CNC 코드가 없는 1×1 vanilla GPU 컨텍스트를
  초기화·폐기한 뒤 빈 페이지에서 3회 최솟값으로 브라우저/드라이버 고정 비용을 측정한다.
  앱 자산 요청 0을 검증한다. CPU private commit 및 GPU 보고값의 양의 증가분만 합산한다.
  cold blank 기준과 이전 기준 초과 결과도 보존하며 총 브라우저 비용이 600 MB라는 뜻은 아니다.

| Browser / backend | Balanced peak MB | Precision peak MB | Result |
|---|---:|---:|---|
| Chrome / WebGPU | 476.05 | 454.59 | pass |
| Chrome / WebGL 2 | 356.00 | 354.24 | pass |
| Edge / WebGPU | 504.30 | 526.73 | pass |
| Edge / WebGL 2 | 368.85 | 421.54 | pass |

- MB는 1,000,000 bytes. 각 60초 이상 세 공정 반복, 30–40 samples. 공정 횟수는 보고서에
  별도 기록하며 preset/브라우저 우열 비교가 아니다. 장시간 모든 프로젝트의 메모리 보증도 아니다.
- 현재 PC 승인과 앱 귀속 메모리 산정 승인을 받았다. 최종 로컬 회귀 통과, 원격 CI·릴리스 대기.
- Chrome 152.0.7977.83은 조회 시 공식 Version History API의 활성 Windows Stable 배포에 포함된다.
  Edge 153.0.4234.32는 공식 enterprise update API의 최신 Windows x64 Stable 버전과 일치한다.
  단계적 배포를 고려하며 미측정 브라우저를 지원 인증하지 않는다.
- 확인 출처: [Chrome Version History](https://versionhistory.googleapis.com/v1/chrome/platforms/win/channels/stable/versions/all/releases?filter=endtime=none),
  [Edge Update API](https://edgeupdates.microsoft.com/api/products?view=enterprise).
- PID를 제거한 [기준 장비 증거](verification/m12-reference-evidence.json)는
  `node scripts/check-reference-evidence.mjs`로 검증·확장한다. 원본 sourceDirty 표시는
  측정 당시 상태이며, 런타임 지문으로 현재 코드와 일치 여부를 확인한다.

### 이전 측정 이력

- 사용자가 현재 PC를 기준 장비로 승인했다. 아래 v1 기록의 장비 승인 대기와
  High 미구현 설명은 당시 상태이며, 현재는 balanced/precision을 실제 Worker/WASM으로 검증한다.
- `benchmark-reference-v2.json`: Chrome/Edge × 두 backend × 세 공정 × 두 프리셋
  24/24 통과. Medium 최저 119.706 FPS, High 최저 119.086 FPS,
  cold localhost shell 최대 1341.1 ms. 리소스 수명 수정 전 측정이다.
- 수명 수정 후 `benchmark-reference-v3.json`은 34/36 통과했다. 기능/Stock 동등성은
  전부 통과했으나 software Chromium High 밀링 handler가 WebGPU 57.9 ms,
  WebGL 2 51.4 ms로 50 ms 미만 기준을 넘었다. 이 실패를 숨기거나 기준을 낮추지 않는다.
- 셀별 임시 배열 제거 후 `benchmark-reference-v4.json`은 27/36 통과했다.
  실장비 24조합과 모든 기능/Stock 동등성은 통과했지만 software 9조합에서
  handler/long task 예산을 넘었다(최대 handler 994.7 ms, 공정당 long task 최대 85회).
  실장비 cold shell 최대 1536.9 ms. 소프트웨어 성능 안정화는 미완료이며,
  정점 동일성 테스트 통과만으로 성능 원인까지 해결했다고 선언하지 않는다.
- Lighthouse 13.4.1의 새 Chrome 프로필 3회, 10 Mbps/40 ms·CPU×1에서
  LCP 814.9/795.3/820.4 ms를 관측했다. 공개 Pages 배포 후 측정은 아니다.
- 전체 E2E 88 passed/2 opt-in soak skipped, visual 5 passed,
  a11y 6 passed/3 별도 visual project skipped, Pages 2 passed를 확인했다.
- 보수적 전체 브라우저 메모리 측정은 아직 600 MB 기준을 통과하지 못했다.
  브라우저 고정 비용과 공유 메모리 중복을 포함하므로 앱 소유 메모리와 같다고 주장하지 않는다.
  산정 범위를 사용자 확인 중이며, M12 완료·병합·공개 배포는 보류한다.
- Firefox/실제 Safari는 미검증이며 지원을 보증하지 않는다. 현재 검증 범위는 아래 설치된
  Chrome/Edge의 대표 공정이다. WebGPU adapter 정보는 별도 probe이며 실제 고성능 adapter
  선택과 항상 일치한다고 보장하지 않는다.
- 추가 방법과 제한: [ADR 0018](architecture-decisions/0018-release-hardening-and-resource-gates.md).

## 최초 balanced 측정 이력 (workload v1)

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
