# ADR 0018 — M12 업로드·정밀도·로딩·메모리 게이트

- 상태: 로컬 검증 통과 — 원격 CI·릴리스 검증 대기
- 참조: QA harness M12 DoD 1–11, ADR-0010·0016·0017

## 보안

- `.cncrender` browser File의 크기·확장자·MIME을 바이트 읽기 전에 검사한다.
  사용자 브라우저가 MIME을 비워 두는 경우만 허용하며, 알려진 다른 MIME은 거부한다.
- 기존 ZIP 크기·경로·압축률·CRC·manifest/hash 검증을 유지한다. 모델 역할은
  현재 검증 가능한 binary STL(`model/stl`, 1..500000 triangles)만 수용한다.
  선언 길이와 실제 길이, 유한 좌표/법선을 검사한다. OBJ/glTF/ASCII STL 및 CAD
  디코딩·UI 파일 업로드는 아직 제공하지 않는다. 이는 완전한 메시 건전성 인증이 아니다.
- Pages CSP는 same-origin 스크립트·Worker·연결만 허용하며, WASM 컴파일과 로컬 blob은
  필요한 범위에서 허용한다. E2E는 실제 Monaco·절삭·내보내기와 외부 HTTP 요청 0을 검사한다.
- 런타임은 ArrayBuffer/Transferable을 사용한다. SAB를 생성하지 않으므로 SAB 조건부
  COOP/COEP gate는 해당하지 않는다. Pages가 cross-origin isolation을 제공한다고 주장하지 않는다.
- cloud persistence/원격 telemetry는 비활성이다. 원본 모델·G-code·개인 프로젝트명을
  원격 전송하지 않는다. 벤치마크는 저장소의 고정 Fixture만 사용한다.

## 정밀도와 기준 장비

- 사용자가 현재 PC를 기준 장비로 승인했다(i7-13620H, 64GB RAM, Windows,
  설치된 Chrome/Edge, 1440×900 CSS px·DPR 1). GPU probe와 실제 backend를 별도 기록한다.
- M7 실행 옵션 `qualityPreset`은 balanced(기본)와 precision을 실제 WASM 계약에 전달한다.
  Precision은 Rust의 기존 0.5 격자 배율이다. 밀링 1125→4500 cells, 선삭 120→240 cells.
  Medium/High의 Stock 결과를 서로 같다고 요구하지 않고 같은 프리셋의 브라우저/백엔드끼리
  비교한다. Lesson과 저장 Operation의 기본 balanced 계약은 바꾸지 않는다.
- hardware 측정의 60/30 FPS 및 cold shell 5000 ms 실패는 명령 실패로 반환한다.
  software FPS는 실장비 인증으로 대체하지 않는다. JSON releaseStatus는 별도 미완료 상태다.

## 로딩

- Lighthouse 13.4.1을 고정한다. production Pages 진입 화면이 현재 landing이자 workspace다.
- 새 작업 전용 Chrome 프로필 3회, desktop 1440×900·DPR 1,
  실제 DevTools 10 Mbps/40 ms·CPU 배율 1 조건에서 각 LCP <=2500 ms를 요구한다.
- 프로필은 개인 프로필과 격리하며 `.cache/`에 남긴다. 오류 보고 전송은 비활성화한다.
  Windows chrome-launcher 임시 프로필 정리 경쟁을 피하려고 Playwright가 브라우저 수명을 소유한다.

## 메모리 — 승인된 앱 귀속 범위 검증

- 후속 사용자 승인으로 한도는 유지하고 빈 브라우저 고정 비용을 제외한 앱 귀속 사용량을 판정한다.
  새 브라우저에서 빈 페이지 3회 측정의 CPU private commit 합과 GPU 보고값 각각의 최솟값을
  기준으로 고정한다. 실행 시 각 항목의 양의 증가분을 합하며 감소분으로 상쇄하지 않는다.
  Worker/WASM은 해당 renderer의 private commit에, GPU 메모리는 WDDM 계측에 포함된다.
  공유 GPU/CPU 중복 가능성이 남아 있는 보수적 추정이며 JS heap으로 대체하지 않는다.
  이전 전체 브라우저 원본은 유지하고 새 증거는 `artifacts/app-memory-*.json`에 남긴다.
- cold blank 첫 측정 중에도 GPU 프로세스가 초기화되어 고정 비용이 변하는 것을 관찰했다.
  따라서 별도의 1×1 vanilla canvas에 동일 backend를 초기화·clear·완료 대기·폐기한 뒤
  다시 빈 페이지에서 3회 기준값을 측정한다. CNC 코드·Three.js·WASM·머신 자산·Stock은
  로드하지 않으며 resource 요청 0과 pipeline 부재를 검증한다. 초기 cold blank 3회도 보존한다.
  각 browser/backend/quality는 새 브라우저 프로세스로 실행하여 이전 공정 캐시를 기준에서
  빼지 않는다. GPU 초기화 후 기준값에도 앱의 geometry·shader·texture 비용은 포함하지 않는다.

- 별도 Windows reference test가 CDP에 속한 브라우저·renderer·Worker·GPU 프로세스만 측정한다.
  60초간 세 대표 공정을 100배속 반복하며 1초 이상 간격으로 샘플링한다.
- 프로세스 속성은 WDDM 조회 전에 한 번 캡처한다. 페이지 전환 중 종료된 renderer로
  CDP/OS 목록이 다르면 한 샘플 취득당 최대 2회 목록을 새로 조회하고 횟수를 기록한다.
  수치가 유효한 샘플이나 메모리 예산 초과는 재시도하지 않는다. 프로세스 누락이
  계속되거나 GPU 카운터가 없으면 실패한다. PID 포함 원본 JSONL은 로컬에만 보존한다.
- 이전 전체 브라우저 측정식은 `sum(max(privateCommit, workingSet)) + WDDM dedicated/shared GPU`다.
  브라우저 고정 비용과 공유 메모리 중복을 포함한 보수적 관측 상한이지 실제 앱 소유 메모리의
  정확한 합계가 아니다. 빈 브라우저 기준도 따로 기록한다. 기준을 넘었다고 실제 사용량을
  그 값으로 단정하지 않지만, 이 증거만으로 600 MB/1.5 GB gate를 통과시키지도 않는다.
- [Microsoft 문서](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/gpu-process-memory-counters-report-wrong-value)는 WDDM process counter 과대 보고 가능성을 명시한다.
  따라서 부족한 총 메모리 증거를 JS heap 값으로 대체하지 않는다.
- 반복 교체에서 선택 목록과 공유 material/shadow render-object 참조 누적을 발견했다.
  선택 참조 해제, 동적 material 소유·폐기, 공정별 Mesh 식별자 두 개 재사용으로 수명을 제한한다.
  같은 격자는 geometry/material/버퍼를 재사용하며, 비호환 격자 교체와 최종 폐기를 검사한다.
- 최종 새 브라우저 8조합 모두 통과했다. balanced 최대 504.30 MB, precision 최대
  526.73 MB. 기준은 각각 600,000,000/1,500,000,000 bytes이며 변경하지 않았다.
  60초 대표 반복 관측이지 모든 프로젝트·장시간 실행의 상한 보증은 아니다.

## 증거와 최종 로컬 회귀

- 2026-09-19 최신 브라우저 재측정: Chrome 153.0.8010.50 / Edge 153.0.4234.48.
  실장비 24/24, 메모리 유효 8/8 통과. 최소 FPS 기본 117.867 / 고정밀 119.522,
  cold shell 최대 1652.5 ms, handler 최대 10.8 ms, 모든 long task 0.
  메모리 최대 기본 481.92 MB / 고정밀 512.95 MB, LCP 964.8/980.5/969.6 ms.
  Edge 2개 조합의 프로세스 종료 취득 오류를 보존하고 새 브라우저로 해당 조합만 재취득했다.
  최신 지문은 `f00362e1f9450a2bc469f919691ab121e8cde07283f711594ce3423a48dfd7ab`.
  ADR 0017에 따라 실행별 Long Task를 판정하고 전체 누적과 원본 구간도 보존한다.
  증거 envelope v2는 긴 원본을 누락하지 않도록 압축 payload를 8192자 이하 청크로
  저장하며 기존 v1 읽기를 지원한다. 최종 unit 339/contracts 64/parity 69, visual 5,
  E2E 88(기존 opt-in soak 2 skipped), a11y 6, Pages 2, bundle 통과.
  원격 CI·공개 릴리스 검증은 아직 대기다.

- 2026-09-13 회전 소재 최적화 후 이전 증거: 메모리 8조합 최대 balanced 445.85 MB /
  precision 475.80 MB, 실장비 24조합 최저 FPS 119.784 / 119.665, cold shell 최대
  1513.8 ms, handler 최대 23.4 ms, long task 0. LCP 835.9/795.6/807.4 ms.
  동일 full profile의 법선·경계 재사용 및 각도/정점 임시 할당 제거를 적용하고 기존
  정점·winding·변경 profile의 법선/경계 완전 일치를 회귀 검사했다.
  런타임 지문 `702e06a7a60ced9f1d4889dd0ad2bedcbf0844f3013d999932e1f97067e291d8`.
  아래 수치는 이전 이력이다. Linux CI의 기존 handler 초과는 새 CI로 별도 판정한다.
- 학습 레이아웃 수정 후 재측정: 메모리 8조합 최대 balanced 489.05 MB / precision
  521.24 MB, 실장비 24조합 최저 FPS 119.289 / 109.684, cold shell 최대 1175.3 ms.
  새 지문으로 증거를 교체했으며 이전 수치는 이력으로 보존한다.
- Linux software WebGPU는 Xvfb와 Vulkan/SwiftShader 합성 옵션으로 실제 캔버스 캡처를
  검사한다. 고정 sleep 대신 렌더 프레임 및 픽셀 변경을 기다리며 blank 화면은 실패한다.
  OS별 system font 차이는 Windows/Linux 별도 기준 이미지로 검토한다. pixel 허용치는 유지한다.
  참고: [WebGPU 재현](https://github.com/visgl/luma.gl/issues/2874),
  [Playwright 시각 비교](https://playwright.dev/docs/test-snapshots).
- 기준 장비 24조합, software 12조합, 전체 E2E 88개, visual 5개 및 a11y/Pages 통과.
  실장비 최저 FPS balanced 119.028 / precision 112.013, cold shell 최대 1585.8 ms.
  Lighthouse 최종 LCP 925.0/948.5/979.1 ms. 이전 실패 보고서는 별도로 보존한다.
- `docs/verification/m12-reference-evidence.json`은 sanitized gzip-base64 보고서다.
  수집기는 원시 PID를 제거하고, 검증기는 모든 메모리 산술·한도와 실장비 성능·동등성을
  재계산한다. git clean-filter 정규화 런타임 지문이 바뀌면 재측정을 요구한다.
  문서·테스트만의 변경은 런타임 지문에 포함하지 않는다. 증거는 자체 기록이며 독립 인증이 아니다.
- CI는 이 증거의 읽기 쉬운 JSON, software 결과, Lighthouse, 핵심 Fixture를 보존하고
  clean release의 version/commit/schema/engine/WASM 출처를 검사한다.

## 검증 명령

```sh
pnpm security:test-uploads
pnpm bench -- --report=artifacts/benchmark-reference-final.json --matrix=reference
pnpm bench:memory
node scripts/collect-reference-evidence.mjs
# Review artifacts/reference-evidence-envelope.json before updating the checked-in evidence.
node scripts/check-reference-evidence.mjs
pnpm lighthouse -- --output-path=artifacts/lighthouse.html
pnpm verify
pnpm test:e2e --project=chromium-webgpu
pnpm test:e2e --project=chromium-webgl2
pnpm test:visual
pnpm test:a11y
pnpm test:pages
```
