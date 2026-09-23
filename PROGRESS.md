# CNC Render Progress

- Current phase: M13 3+2축·동시 5축 확장 — 다해 후보·비용 기반 결정론적 해 선택
- Status: in progress — bounded 후보/비용 선택 단위 완료; M13 전체 DoD 미완료
- Last completed: verify(unit 400/contracts 94/parity 87)·프로덕션 빌드 및 Rust fmt/clippy/test 통과
- Next task: 회전 특이점·축 한계·급격한 자세 변화 진단 및 rewind
- Open questions: 5축 제거 Precision 체적·잔삭 허용 기준은 해당 구현 단위에서 승인·고정 필요
- Known regressions: 과거 LCP 6273.8 ms 1회 초과는 원인 미확정인 승인된 P2. 해결됨으로 닫지 않으며 2.5초 기준·실패 증거를 유지

## 2026-09-24 M13 다해 후보·비용 기반 결정론적 해 선택

- 사용자 요청에 따라 `codex/m13-machine-plugin`에서 직전 미커밋 FK/IK/TCP
  변경을 포함해 검증했다. 아래 로컬 검증 결과를 포함한 누적 M13 변경을
  이번 커밋/푸시 대상으로 한다. PR·병합·Pages 배포는 범위에 포함하지 않는다.
- ADR 0021에 정책 version 1을 고정했다. reference/home/회전축 5×5 grid의
  고정 27개 seed에 국소 IK를 적용하고 중복 수치 해를 제거한다. travel 범위,
  최종 위치 <=1e-9 mm·방향 <=1e-9 rad 기준을 유지한다.
- 축 이동량/한계 페널티/방향 Jacobian 특이점 위험을 각각 정수 비용으로
  계산한다. 기본 가중치는 10/1/2, 동률은 작은 seed index가 우선이다.
  동일 입력·정책의 반복 재현성과 입력 배열 순서 독립성을 검사했다.
- 세 구조의 다해 후보, 독립 TT 두 branch, Golden 19개, 가중치에 따른
  선택 변경, pole/regular 위험, 비대칭 한계, 실패/잘못된 입력을 검사했다.
  신규 unit 10개·native parity 5개가 통과했다. 고정 seed의 세 구조×12개
  목표는 참조 자세를 변경한 뒤 후보·정수 비용·순위·선택을 두 언어에서
  정확히 비교했다. 가중치별 native 100회 반복과 별도 프로세스도 통과했다.
- 전체 `pnpm verify` 통과: unit 400/contracts 94/parity 87, 타입/lint/모듈
  경계/toolchain, WASM 및 프로덕션 빌드 포함. Rust fmt check/clippy
  (`-D warnings`)/workspace test와 `git diff --check`도 통과했다.
  기존 chunk >500 kB advisory와 Windows DLL linker 정보 warning은 유지된다.
- `check-reference-evidence`는 `runtime changed; remeasure on the approved
  reference host`로 실패했다. 이는 기존에 기록한 새 소스 지문 재측정 필요
  상태이며 증거를 재작성하거나 gate를 완화하지 않았다. 이번 단위에서
  UI E2E·bundle 예산·실장비 성능 재측정·원격 CI 완료를 주장하지 않는다.
- M13 DoD 3은 ADR 0021의 bounded 후보/fixture 범위에서 통과했다. 전체 해
  열거·전역 최적·산업용 안전을 보증하지 않는다. 충돌은 결과에 명시적으로
  `not-evaluated`이며 충돌 비용 0으로 간주하지 않는다. 방향 불연속 비용과
  경로 연속성 역시 후속 범위다. 특이점 위험 점수가 DoD 4 진단을 대체하지 않는다.
- M13 전체는 계속 진행 중이다. DoD 4–8의 진단/rewind/5축 충돌/제거/lesson,
  G-code IR·Worker/WASM/UI 연결, 릴리스 전 기준 장비 재측정이 남았다.

## 2026-09-24 M13 국소 IK·TCP 및 왕복 검증

- 기존 미커밋 FK 변경 위에 구현했다. `codex/m13-machine-plugin`을 유지하며
  이번 단위는 커밋·푸시·PR·병합·공개 배포하지 않았다. 원격 최신은 계약 커밋 8bf2272다.
- ADR 0020에 목표 pose 계약, seed-local IK와 TCP 단일 자세 보정의 수치 기준을
  고정했다. TypeScript/Rust 모두 회전축 방향 DLS 후 선형축 affine 해를 계산하고
  최종 FK 잔차·축 한계를 검증한다. 상태를 새로 반환하며 입력은 변경하지 않는다.
- 반복 80회, 회전 step 최대 0.35 rad, line search 최대 12회로 제한한다.
  실패는 코드와 반복 수만 반환하며 근사 해·NaN/Infinity pose를 만들지 않는다.
  `orientation-not-converged`는 국소 수렴 실패이지 전역 도달 불가가 아니다.
- Golden 목표 19개에서 회전 seed를 변경한 뒤 IK→FK 왕복을 검증했다.
  고정 seed 0x13002410으로 구조별 100개(총 300개)를 추가 검증했으며 HH는
  기울어진 공구축으로 C축의 방향 기여도 확인했다. 최종 오차 기준은 두 언어
  각각 위치 <=1e-9 mm·방향 <=1e-9 rad이며 그대로 유지한다.
- 공구 끝점 고정 TCP: A=π/2의 독립 손계산 세 사례 및 두 모드×세 구조×5개
  회전 명령을 통과했다. 회전축 명령은 그대로 두고 XYZ만 보정한다.
  3plus2와 simultaneous-5axis는 단일 자세 계산이며 경로 보간·절삭 안전 보증이 아니다.
- 초기 IK 선형축 min/max 테스트에서 TT/HT 두 사례가 실패했다. 방향 허용치에
  가까운 잔차가 travel 경계의 위치로 증폭된 원인이었다. 내부 방향 수렴을
  1e-12 rad로 강화한 후 min/max 6개를 두 언어 모두 통과했다. 공개 위치/방향
  gate나 엄격한 입력 travel 기준은 완화하지 않았다.
- 검증: 신규 IK/TCP unit 26개·native parity 7개, 타입 검사, Rust fmt/clippy
  (`-D warnings`)/workspace test 통과. clippy가 찾은 행렬 소거 loop는 iterator로
  수정했다. 전체 `pnpm verify` 통과: unit 390/contracts 94/parity 82,
  타입·lint·모듈 경계·고정 toolchain·WASM 빌드·프로덕션 빌드 포함.
  빌드는 기존 chunk >500 kB advisory를 출력했다. 별도 UI E2E·bundle 예산·
  실장비 성능 측정은 이 단위에서 실행하지 않았다.
- M13 DoD 2는 ADR 0020의 국소 IK/fixture 범위에서 통과했다. DoD 3–8은
  미완료이며 전역 수렴·최적 branch·산업용 검증 도구와 동등한 정확도를 주장하지 않는다.
- 남은 범위: 전역 다해 후보/비용 기반 선택, 회전 특이점·rewind 진단,
  5축 충돌·희소 복셀 제거·lesson, G-code IR·Worker/WASM/UI 연결.
  실장비 성능 재측정이 필요한 기존 지문 불일치와 승인된 P2도 그대로 남아 있다.

## 2026-09-24 M13 회전축 FK·Golden Pose·Rust/TypeScript 동등성

- 요청 순서대로 직전 계약 변경 6개 파일을 `8bf2272`로 커밋하고
  `origin/codex/m13-machine-plugin`에 푸시했다. 그 후 이 FK 단위를 구현했다.
  FK 단위는 아직 미커밋이며 PR 생성·병합·공개 배포는 하지 않았다.
- TypeScript `FiveAxisKinematics`는 점·방향 Rodrigues 회전, Rust는 rigid matrix
  합성으로 독립 구현했다. parent frame pivot, 비영점 home, root→leaf 순서,
  tool/workpiece 장착 좌표 및 workpiece inverse 변환을 적용한다.
- Rust에 plugin/state 계약을 추가하고 기존 domain의 수치 검증을 재사용했다.
  각 생성자는 자체 검증된 복사본을 소유하고 잘못된 구조·단위·축 한계·capability와
  finite 입력의 중간 overflow를 거부한다. 기존 3축 코어·CLI 분기는 유지했다.
- 세 구조 각각 home/양·음 회전/C 단독/공구 offset과 공작물 Euler 장착,
  비영점 home, 대각 회전축, 테이블 선형축 배치를 포함하는 Golden 19개를 고정했다.
  기대값은 구현 결과에서 생성하지 않았고 fixture README에 손계산 근거를 기록했다.
- 위치 Euclidean 오차 <=1e-9 mm, 공구축 방향 각도 <=1e-9 rad,
  방향 길이 오차 <=1e-12를 TypeScript·Rust 각각 Golden 및 상호 비교로 통과했다.
  고정 seed 0x13002409의 구조별 임의 100개+min/max 2개, 총 306개도 통과했다.
  100회 반복과 별도 Rust 프로세스의 JSON 바이트 재현성을 확인했다.
- 검증: `pnpm verify` 전체 통과(unit 364/contracts 94/parity 75, lint·타입·
  모듈 경계·WASM 빌드·프로덕션 빌드 포함), Rust fmt/clippy(`-D warnings`)/
  workspace test 통과. 신규 FK unit 21개와 native parity 6개 포함.
  clippy가 찾은 불필요한 변환 2곳과 CLI enum 크기 경고는 변환 제거·Box로 수정했고,
  최종 CLI 수정 후 5축 parity 6개도 재통과했다. 기준/테스트를 완화하지 않았다.
- 빌드는 chunk 크기 advisory, Windows native WASM DLL linker의 라이브러리 생성
  안내 경고를 출력했지만 성공했다. 별도 bundle/E2E/실장비 성능 측정은 실행하지 않았다.
- M13 DoD 1(세 구조 Golden FK)은 위 fixture 범위에서 통과했다. DoD 2–8은
  아직 미완료다. FK 출력은 공구 끝점과 홀더 방향이며 축 주위 roll은 포함하지 않는다.
  5축 Worker/WASM 연결, G-code 회전축 실행, IK/TCP 보정, 특이점·rewind,
  충돌·제거·lesson·UI 지원을 구현한 것으로 해석하지 않는다.
- 소스 변경 후 M12 기준 장비 증거의 지문은 계속 유효하지 않다. 새 릴리스 전
  재측정이 필요하며 승인된 기존 P2와 과거 실패 증거를 유지한다.

## 2026-09-24 M13 첫 단위 — 머신 플러그인 계약

- 사용자 M13 진행 요청에 따라 `main`에서 `codex/m13-machine-plugin`을 생성했다.
  기존 stash는 보존했다. 첫 단위 검증 당시에는 미커밋이었으며, 이후 커밋·푸시는 위 절에 기록했다.
- ADR 0019에 데이터 전용 플러그인 버전, 좌표·장착 변환, 모드/TCP 선언 및
  비범위를 고정했다. 기존 MachineDefinition/linear/rotary schema를 재사용하고
  M4의 3축 구현 및 프로젝트/Worker schema 1은 유지한다.
- Table-Table / Head-Table / Head-Head의 disjoint root→leaf chain과 정확히
  선형 3축+회전 2축을 검증한다. 입력 상태는 plugin/version/machine에 바인딩하고
  mm/rad 혼용, 축 누락·중복, 한계 초과, 비유한값 및 미지원 모드/TCP를 거부한다.
- 세 구조 fixture는 계약 검증용이다. FK/IK Golden Pose, 실제 TCP 제어,
  충돌 안전 또는 S1 가공 검증을 통과한 것으로 취급하지 않는다.
- 검증: contracts 94개(신규 30), unit 343개, typecheck 통과.
  lint·모듈 경계·문서 용어·고정 toolchain 검사도 통과했다. 식별자 개행
  거부 회귀 2개 추가 후 전체 계약·타입 검사와 변경 파일 lint도 재통과했다.
  최초 신규 3개 테스트는 스키마의 키 순서 정렬을 원본 JSON 삽입 순서와 비교해
  실패했다. 기존 canonicalJson 규칙으로 100회 왕복과 입력 비변경을 검증했다.
- `check-reference-evidence`는 소스 지문 변경으로 실패했다. 이전 M12 증거와
  기준은 그대로 보존하며 새 릴리스 전 승인 장비 재측정이 필요하다.
- 남은 M13: 회전축 FK/IK·Golden/parity, TCP·결정론적 해 선택, 특이점·자세 급변·
  rewind 진단, 5축 링크 충돌, 희소 복셀 제거, 3+2/동시 5축 UI 식별과 S1 lesson.
  이 단위는 데이터 계약만 추가하므로 렌더러/E2E·Rust parity는 실행하지 않았다.
  M13 DoD 1–8은 아직 완료 처리하지 않는다.

## 2026-09-20 M12 릴리스 완료

- 사용자가 알려진 P2 위험의 보존 및 최종 CI 통과 후 병합·Pages 게시를 승인했다.
  승인 기록은 기존 PR과 이 문서에 유지한다. 별도 공개 GitHub 이슈는 생성하지 않았다.
- 최종 PR head `901a011`의 전체 CI
  [35450789759](https://github.com/JTech-CO/CNC-Render/actions/runs/35450789759) 통과 후
  [PR #13](https://github.com/JTech-CO/CNC-Render/pull/13)을 main에 병합했다.
  병합 커밋은 `43db00c83f2ce54a5771a458f382371eaa94b233`이다.
- main 전체 CI와 Pages 게시
  [35451660934](https://github.com/JTech-CO/CNC-Render/actions/runs/35451660934)도 성공했다.
  PR LCP 750.315/767.066/745.926 ms, main LCP 773.612/783.719/782.089 ms로
  각각 고정 3회 모두 기존 2500 ms 기준을 통과했다. 기준 장비 측정과 CI 수치를 혼합하지 않는다.
- [공개 Pages](https://jtech-co.github.io/CNC-Render/)에서 `pages-deployment.spec.ts` 2개가
  통과했다. 스타일·도움말·탭 전환·Monaco/전용 분석 Worker·WASM 절삭·결과 비교·JSON 저장을
  확인했으며 page/console 오류와 외부 HTTP 요청이 없었다.
- 공개 `release.json`: v0.9.0 / schema 1 / engine 0.9.0, 위 병합 SHA,
  sourceDirty=false. WASM은 `application/wasm`, 857607 bytes,
  SHA-256 `497b6a767ecf3d4c9ecda61281f89dd4bc73a8d6601821906215dc5aabeccc15`로
  해당 Linux CI 산출물과 일치했다. Windows 로컬 WASM 바이트/해시와 구분하여 기록한다.
- 로컬 기준 브랜치를 main으로 동기화하고 완전 병합된 `codex/m12-release-gates`만
  로컬·원격에서 삭제했다. 커밋은 main/PR 이력에 남아 복구 가능하다. 기존 M10 stash와
  다른 브랜치는 보존했다. M13 코드는 아직 구현하지 않았다.

### M12 DoD 판정

| 항목 | 확인 결과 |
|---|---|
| 로딩 | 현재 후보 로컬 1122.4/1086.9/956.0 ms, 위 PR/main CI 3회 모두 통과. cold shell 최대 1652.5 ms. 과거 단발 지연은 승인 P2로 유지 |
| 대표 FPS | 승인된 기준 장비 24조합, 기본 최소 117.867 / 고정밀 최소 119.522 FPS |
| 메모리 | 승인된 앱 귀속 산식의 유효 8조합 통과, 기본 최대 481.92 MB / 고정밀 최대 512.95 MB. 기존 600 MB/1.5 GB 한도 유지 |
| 충돌 표시 | Worker collision-stop 및 다음 1렌더 프레임 표시 E2E 통과 |
| 백엔드 동등성 | 같은 프리셋의 Toolpath·축·진단·Stock 결과 일치, software 12조합 및 reference 24조합 통과 |
| 브라우저 | 승인 장비 Chrome/Edge 대표 공정 검증. Firefox/실제 Safari는 미검증 제한을 지원 매트릭스에 명시 |
| 업로드 방어 | 크기·MIME·확장자·구조·CRC·압축 폭탄·binary STL 삼각형/손상 검증 통과 |
| SAB/헤더 | SAB 미사용, ArrayBuffer/Transferable 경로. 공개 CSP와 same-origin Worker/WASM 동작 검증, COOP/COEP 지원으로 표현하지 않음 |
| 개인정보 | cloud persistence/telemetry 비활성, 검증에서 외부 HTTP 요청 0 |
| CI | unit 343/contracts 64/parity 69, Rust/fuzz, visual 5, E2E 88, a11y 6, bundle/보안/성능/Pages/출처 검사 통과. 기존 opt-in soak 2개는 별도 범위 |
| 배포 출처 | 공개 버전·commit SHA·schema·engine·WASM MIME/해시와 CI 산출물 일치 |

- 남은 P2의 원인 수정 또는 모든 장비·임의 대형 프로젝트·장시간 실행 성능 보증까지 완료한
  것은 아니다. 이후 LCP 실패도 그대로 실패로 판정한다. 이 완료 기록은 실제 공개 검증을
  마친 위 병합 산출물을 기준으로 하며, 후속 문서 커밋은 런타임 지문을 바꾸지 않는다.

## 2026-09-20 M12 병합 전 재검증

- 사용자 요청: M12 전체 완료·병합. PR #13의 코드 head `2edb5f6`은 CLEAN/MERGEABLE이며,
  최신 전체 CI [35449919292](https://github.com/JTech-CO/CNC-Render/actions/runs/35449919292)가
  성공했다. unit 343, contracts 64, parity 69, Rust/fuzz, software matrix, visual 5,
  E2E 88(기존 opt-in soak 2 skipped), a11y 6, bundle, 보안, 기준 장비 증거 검증,
  Pages 2, Lighthouse와 clean release 검사가 모두 통과했다. PR에서는 배포 job이 정상적으로 skipped다.
- 최신 CI LCP는 750.951/758.220/753.814 ms다. 원본 trace·DevTools log·보고서는 CI artifact와
  `artifacts/ci-35449919292/lighthouse`에 보존한다. software 원본도 해당 CI 디렉터리에 보존한다.
  직전 `5d18e29` CI 35449592501도 성공했으며 LCP 720.054/714.362/740.468 ms였다.
- 현재 `2edb5f6`의 로컬 strict clean-release 재검증: Pages 2, LCP 1122.4/1086.9/956.0 ms,
  v0.9.0 / schema 1 / engine 0.9.0, sourceDirty=false, commit SHA·WASM 해시 모두 일치.
  `lighthouse-m12-release-candidate*`에 보존한다. CI 환경 변수를 사용한 로컬 재현이므로
  JSON scope의 CI 표기를 원격 runner 또는 독립 장비 증거로 해석하지 않는다.
- 과거 6273.8 ms 지연의 전후 3분 Windows 이벤트에서 GPU 재시작·Chrome/DWM 오류는
  발견되지 않았다. 이는 원인 규명 또는 지연 부재의 증거가 아니다. 진단 9회와 현재 후보 통과를
  이유로 유효 실패를 삭제하거나 2.5초 기준을 완화하지 않는다.
- 알려진 P2로 문서화·승인하는 릴리스 조건 적용 여부를 사용자에게 요청했다. 답변 전에는
  승인된 위험으로 기록하지 않고 M12 완료·병합·공개 배포를 보류한다. PR 설명은 최신 수치와
  이 조건으로 갱신했다. 기존 M10 stash와 다른 브랜치에는 손대지 않았다.

## 2026-09-19 M12 재개 확인

- `5d18e29` 보고서 경로 수정 후 CI 모드 로컬 Pages 2개와 Lighthouse 빌드의 clean-release
  검사는 통과했다. 실제 LCP는 967.0/6273.8/1073.0 ms로 실패했다. 실패 보고서
  `artifacts/lighthouse-clean-release*`를 유지한다. release identity 후속 명령은 실행되지 않았다.
- 느린 실행은 FCP/LCP 이전 5066.551 ms의 Unattributable main-thread task를 포함한다.
  네트워크와 JS 실행 시간만으로 설명되지 않으며 아직 원인을 확정하지 않았다.
  별도 trace 진단 3회는 968.9/982.0/961.9 ms였지만 기존 실패를 취소하거나 완료 증거로
  대체하지 않는다. 이후 고정 6회 진단은 963.7/934.9/988.7/1039.6/942.4/978.2 ms였고,
  5초 지연이 재현되지 않았다. `artifacts/lcp-diagnostic-six*`에 6회 전체 trace·보고서를 보존한다.
  원인을 확인하지 못했으므로 실패를 해소 또는 면제하지 않는다.
- 앞으로 정상/실패 모두 Lighthouse 원본 trace와 DevTools log를 `--save-assets`로 저장한다.
  기존 CI `artifacts/lighthouse*` 업로드에 포함된다. 3회 전부 <=2500 ms 기준은 그대로다.
- 보고서 경로 수정 `5d18e29`는 푸시했고 PR #13 CI `35449592501`이 실행 중이다.
  로컬 LCP 문제 해결과 원격 CI·공개 배포 검증 전에는 M12 완료 또는 M13 진입으로 기록하지 않는다.
- trace 보존·진단 기록 추가 후 전체 unit 343개, Lighthouse script syntax/lint,
  doc-terms, 기준 장비 증거/현재 런타임 지문 검증과 diff check를 통과했다.

- `2cea36e` 커밋·푸시 후 CI `35447911674`: verify, 보안, Rust/fuzz, software 12,
  visual 5, E2E 88, a11y 6, 기준 장비 증거 일치, Pages 2 모두 통과했다.
  Linux software handler 최대 17.4 ms, 실행별 long task 최대 0, 전체 누적 최대 1이었다.
  Lighthouse는 수치 측정 전에 clean-release guard에서 차단됐다.
- 같은 CI 모드를 로컬 재현해 `packages/e2e/playwright-report/index.html` 생성을 확인했다.
  Pages reporter에 루트 `playwright-report/pages`를 지정하고 네 suite의 보고서 경로가
  실제 Git ignore 대상인지 검증한다. clean-release guard를 약화하거나 파일을 숨기는
  포괄적인 ignore는 추가하지 않는다. 잘못된 위치의 재현 보고서는 artifacts로 옮겨 보존한다.
- 보고서 경로 회귀 4개·typecheck·targeted lint·기준 장비 증거 일치 통과. 브라우저 진단
  업로드는 Pages/로딩 검사 뒤의 `always()` 단계로 이동해 Pages 보고서도 보존한다.
  수정 커밋 후 깨끗한 작업 폴더에서 CI 모드 Pages→Lighthouse→release 검증을 재현한다.
- 추가 로컬 보안 20개, Rust fmt/clippy/test, 60초 fuzz 9,692 cases도 통과했다.

- 사용자 승인에 따라 Long Task 집계를 실행별로 변경한다. warmup도 별도 <=1 gate로 유지하며,
  실행별 값·최대값·전체 관찰 누적·실행 사이 발생분·앱 생애 누적을 모두 보존한다.
  원본 task 시간/실행 구간에서 산술을 재검증한다. 구형 증거는 완료 근거로 재사용하지 않는다.
  아래 승인 대기 기록은 당시 상태이며 지금은 해소됐다. 새 테스트/측정 결과는 확인 후 기록한다.
- 실행별 집계 구현 후 단위 31개, typecheck, targeted eslint 통과. task 시간과 실행 구간,
  실행별 배열, warmup, 전체 관찰 누적, 앱 자체 누적을 보고서에 남긴다.
  최초 시도의 종료 task가 다음 실행 Promise continuation에 중복 귀속되는 문제는 실제 시간
  샘플 회귀로 수정했다. task가 최초로 겹치는 실행에 한 번만 귀속하며 합계를 검증한다.
  최초 실패 보고서 `benchmark-software-per-run.json`도 보존한다.
- 최종 `benchmark-software-per-run-v2.json`: 12/12 및 기능·Stock 동등성 통과,
  handler 최대 10.4 ms, warmup 모두 0. WebGPU precision turning은 관찰 누적 11회,
  실행별 최대 1회로 통과했다. 앱 자체 누적은 활성 playback 구간만 세어 0이며 별도 보존한다.
  최종 render 완료 대기까지 포함한 독립 관찰 값을 실제 gate로 사용한다.
- 최신 Playwright/Chrome/Edge 기준으로 메모리 8조합·성능 24조합·LCP 재측정을 시작했다.
- 최종 메모리 유효 8/8: Chrome GPU 기본/고정밀 455.54/462.69 MB, Chrome GL2
  346.60/376.93 MB, Edge GPU 481.92/512.95 MB, Edge GL2 349.27/391.10 MB.
  각 60초 이상·33–37개 샘플이다. 최초 Edge 2개 조합의 프로세스 종료 취득 오류는 원본을
  별도 보존하고 새 브라우저로 해당 조합만 다시 취득했다. 유효 예산 실패를 재시도하지 않았다.
- 기준 장비 24/24 및 가공 결과 동등성 통과: 최소 FPS 기본 117.867/고정밀 119.522,
  cold shell 최대 1652.5 ms, handler 최대 10.8 ms, warmup·실행별·전체 long task 모두 0.
  Chrome 153.0.8010.50 / Edge 153.0.4234.48, RTX 4060 Laptop / Intel UHD를 기록했다.
- Lighthouse 3회 LCP 964.8/980.5/969.6 ms 통과. 새 런타임 지문 189 files /
  `f00362e1f9450a2bc469f919691ab121e8cde07283f711594ce3423a48dfd7ab`.
  실행별 원본 구간을 포함한 증거는 envelope v2의 8192자 이하 base64 청크로 저장한다.
  v1 읽기 호환성·압축 해제 상한·구간 집계 산술을 검사하며 증거 단위 7개 통과했다.
  전체 회귀와 원격 CI·공개 배포가 남아 있어 아직 M12 완료가 아니다.
- 최종 `pnpm verify` 통과: 336 unit / 64 contracts / 69 parity, lint·typecheck·Rust check·build.
  새 증거 저장 helper의 nullable 타입 오류는 수정 후 전체 verify로 재검증했다.
- Chromium 153에서 Windows visual 3개가 문자 굵기·줄바꿈 차이로 실패했다. 동일 최신 앱을
  이전 Chromium 140으로 실행한 대조에서는 기존 3개 baseline 모두 통과했다.
  오류 화면·학습 성공/실패의 이전/실제/차이 이미지를 직접 확인해 겹침·잘림이 없음을 확인하고
  Windows 3개만 갱신한다. machine/heatmap·Linux baseline과 1% 허용치는 변경하지 않는다.
  최초 실패 이미지·trace와 대조 실험은 별도 로컬에 보존했다. 전체 UI 재검증 중이다.
- 최종 UI 회귀: visual 5, E2E 88(기존 opt-in soak 2 skipped), a11y 6(별도 visual
  project 3 skipped), Pages 2, bundle 모두 통과. PNG 갱신 후 업데이트 옵션 없이 재검증했다.
- 증거 검증기는 미측정 FPS·음수/비유한 handler·프리셋 불일치·Long Task 집계 변조를
  fail-closed한다. 최종 unit 339, typecheck, targeted lint, doc-terms, diff check 및
  현재 런타임 증거 검증을 통과했다. 전체 계약 64/parity 69와 빌드도 통과 상태다.
  M12 완료 표시는 새 원격 CI와 병합·공개 Pages 검증 후에만 한다.

- PR #13 / `d787726`은 OPEN, 원격 CI `34701348298`은 FAILURE다. M12는 미완료이며,
  사용자 요청에 따라 완료 후 커밋·푸시하고 M13으로 이어간다. M13의 5축 범위 승인은 받았지만
  harness의 M12 완료 진입조건을 생략하지 않는다.
- 현재 회전 소재 최적화 소스의 이전 로컬 검증은 verify 319 unit / 64 contracts /
  69 parity, visual 5, 관련 E2E 34, a11y 6, Pages 2, bundle 통과다.
  마지막 software는 5 passed / 7 failed였다(`benchmark-software-cold-geometry-final.json`).
- 재현 `benchmark-software-20260919.json`: WebGPU 6개 통과, WebGL 2 6개 실패.
  기능·Stock 동등성은 통과했지만 handler 최대 143.5 ms와 다수 long task가 남았다.
  기존 50 ms 미만·long task 1회 이하 기준과 8초 관찰 창을 변경하지 않았다.
- CPU 프로파일에서 WebGL clear 및 GC 대기가 반복 실행 후 증가했다. 비차단 GPU fence
  실험은 이 문제를 해결하지 못해 새 helper·테스트와 렌더러 연결을 모두 제거했다.
  설치 Chrome 153의 동일 SwiftShader 진단에서는 급증이 재현되지 않았으나 gate 대체 증거는 아니다.
- 최신 Chrome/Edge 153 지원을 위해 Playwright를 1.55.0 → 1.63.0으로 정확히 고정했다.
  lockfile 변경은 Playwright와 연결 peer 항목뿐이다. 공식 근거:
  https://playwright.dev/docs/release-notes#version-163.
  갱신 후 첫 software 3 passed / 9 failed 보고서도 보존한다(`benchmark-software-pw163.json`).
  해당 실행에는 Edge 설치/관리자 승인 대기가 겹쳤으므로 격리된 최종 증거로 사용하지 않는다.
  도구 업데이트만으로 성능 문제가 해결되었다고 판단하지 않는다.
- Chrome 153.0.8010.50은 공식 활성 Stable 배포에 포함된다. Edge 153.0.4234.32는
  공식 최신 153.0.4234.48보다 이전 버전이다. 사용자가 Edge 업데이트를 승인했다.
  Microsoft MSI의 SHA256·서명을 검증했으며 일반 설치는 1925(관리자 권한 부족)/1603으로
  실패했다. 이후 관리자 UAC 승인을 받아 설치 exit 0, 실제 버전 153.0.4234.48을 확인했다.
  개인 브라우저 프로필은 사용하지 않는다.
- 남은 항목: software 안정화, 최신 브라우저 전체 회귀, 최종 런타임의 기준 장비 성능·메모리·LCP
  재측정 및 증거 갱신, 원격 CI 통과와 릴리스 검증. 미완료 상태로 완료 커밋·병합하지 않는다.
- 업데이트 후 `pnpm verify` 재통과: 319 unit / 64 contracts / 69 parity 및 build.
  격리 software는 11 passed / 1 failed(WebGL 2 precision turning long task 14).
  fresh-browser-process 실험도 6 passed / 6 failed여서 되돌렸다. 두 보고서를 보존한다.
- 60초 trace에서 긴 메시지·GC의 대부분은 CPU 작업이 아니라 off-CPU 시간이었다.
  Windows GPU 프로세스 AboveNormal / renderer·Worker Normal, 절전 및 Job CPU 제한 없음.
  작업 전용 SwiftShader GPU만 Normal로 맞춘 비교에서는 handler 13.3 ms, long task 0이었다.
  실제 GPU 설정은 그대로 유지하며 Windows software 측정에만 소유권 검증을 거쳐 적용한다.
  단위 회귀 4개 통과. 전체 게이트 재측정 중이며 ADR 0017에 조건을 명시했다.
- 보정 통합 v1은 `Browser.getBrowserCommandLine`이 automation 플래그 부재로 거부되어
  fail-closed했다. v2는 CDP browser/GPU PID와 실제 부모 PID·실행 파일 경로·GPU 명령줄을
  교차 검증한다. raw PID·경로는 공개 보고서에 넣지 않는다.
- `benchmark-software-normal-priority-v2.json`: 11 passed / 1 failed, 모든 기능·가공 결과
  동등성과 handler <50 ms 통과. WebGL 2 전 조합 통과. WebGPU precision turning만
  `maximumLongTasksPerRun=2`로 실패했다. 이 값은 실제로 앱 생애 누적값을 최대화한 것이다.
  ADR의 '공정별'과 지표 이름의 'PerRun'에 맞춰 실행별로 고칠지, 반복 전체의 누적 상한을
  유지할지 사용자에게 확인했다. 응답 전에 판정식을 변경하거나 통과로 간주하지 않는다.
- 이 결정 전에는 완료 커밋·푸시·병합과 M13 착수를 보류한다. M13 백서와 기존 회전축
  스키마만 사전 확인했으며 새 구현은 아직 없다. 효과 없는 임시 GPU fence, 프로세스 격리,
  coordinator 계측 코드는 제거했다. 최종 기준 장비 증거는 아직 갱신하지 않았다.
- 보정 v2의 전체 12조합 handler 최대는 8.7 ms였다. 새 helper·테스트·benchmark의
  typecheck, targeted eslint, 문서 용어 검사도 통과했다. 추가 성능 한도 완화는 없다.

## M12 최초 회전 소재 생성 성능 후속

- `d787726` / CI `34701348298`: verify·G-code/fuzz·Rust·visual·전체 E2E·a11y·bundle
  통과, software는 다시 7 passed/5 failed였다. 최대 handler 103 ms, long task 최대 2회.
  모든 기능·가공 결과 동등성은 통과했으나 병합하지 않는다. 실패 보고서를 보존한다.
- 동일 profile reset 캐시만으로는 최초 생성 비용이 남는다. 최초 생성의 삼각형 법선을
  정점 3개마다 반복 정규화하지 않고 한 번 계산해 복제한다. Three.js의 중간 Float32
  반올림도 유지한다. 경계는 같은 삼각형 soup의 중복 정점을 제외한 8개 코너만 순회한다.
  위치·법선·경계 상자·경계 구를 독립 Three.js 기준과 완전히 비교한다.
- 정점·법선·경계 회귀 13개 및 리소스 수명 5개 통과. 로컬 최초 고정밀 드릴링 진단:
  WebGPU 12.3 ms / WebGL 2 18.4 ms; CPU×4 별도 진단 45.2/44.8 ms.
  진단은 gate가 아니며 프로파일 원본을 로컬에 보존한다. 성능 지표·50 ms 기준·워밍업
  집계 방식은 변경하지 않는다. 런타임 변경에 따른 기준 장비 증거 재측정이 필요하다.
- CI software gate를 전체 브라우저 검사보다 먼저 실행하여 같은 실패를 일찍 검출한다.
  검사 항목·한도·실패 판정은 그대로 유지한다.
- 첫 추가 최적화의 verify 316/64/69, visual 5, 관련 WebGPU/WebGL 2 E2E 34 및
  software 12/12 통과(최대 handler 32.5 ms, long task 0).
- 이어서 같은 반경의 연속 셀은 radial 좌표를 버퍼 복사하고 axial 값만 절대 좌표로
  기록한다. 법선은 실제 Float32 높이까지 같을 때만 복사한다. 동일 반경 구간은 경계
  극값이 양 끝에 있으므로 내부 셀의 중복 경계 순회를 생략한다. 16개 기하 회귀와
  5개 수명 테스트로 기존 정점·법선·경계 완전 일치, 소수 해상도 드리프트와 중간 굵은
  구간을 검증했다. 최초 고정밀 드릴링 진단 GPU/GL2 7.3/5.9 ms, CPU×4 31.6/26.5 ms.
- 최종 소스 지문 `07efdcc0723fbd66eb55d52a5fdcc2780424315d733d6d20f155ddfe5b0c886e`.
  런타임이 바뀌었으므로 이전 승인 장비 증거는 별도로 보존하고 전체 재측정 중이다.

## M12 회전 소재 최적화 후 최종 로컬 증거 (2026-09-13)

- 기준 장비 성능 24/24 및 모든 backend/browser 가공 결과 동등성 통과.
  최저 FPS balanced 119.784 / precision 119.665, cold shell 최대 1513.8 ms,
  main handler 최대 23.4 ms, long task 0, 실행 중 React commit 증가 0.
- 메모리 유효 결과 8/8 확보: 각 60초 이상, 26–37 samples, 332–355회 세 공정 반복.
  Chrome GPU/GL2 balanced 441.11/310.82 MB, precision 470.30/311.33 MB;
  Edge GPU/GL2 balanced 445.85/351.79 MB, precision 475.80/341.54 MB.
  MB=1,000,000 bytes이며 승인 산식·600 MB/1.5 GB 한도는 변경하지 않았다.
- 재측정 7개 통과 후 마지막 Edge/WebGL 2 precision은 속성 캡처 도중 종료된
  프로세스로 차단됐다. 캡처 전후 HasExited 검사로 실제 종료만 목록 갱신 오류로
  분류한 뒤 해당 조합을 새 브라우저에서 재측정해 통과했다. 값이 있는 샘플은 제외하지
  않았으며 예산 실패를 재시도하지 않았다. 모든 취득 실패 로그는 로컬에 보존한다.
- Lighthouse 새 Chrome 3회 LCP 835.9/795.6/807.4 ms 통과(10 Mbps/40 ms·CPU×1).
  로컬 production Pages 측정이며 CI 보고서도 기준 장비와 구분해 환경을 표기한다.
- 런타임 지문 189 files / `702e06a7a60ced9f1d4889dd0ad2bedcbf0844f3013d999932e1f97067e291d8`.
  새 압축 증거의 산술·예산·동등성·지문 검증 통과. 원격 CI·릴리스 검증 전 병합 금지.

## M12 CI software 회전 소재 성능 후속

- 최적화 후 로컬 verify 310 unit/64 contracts/69 parity, 전체 E2E 88 passed/2 opt-in
  soak skipped, visual 5·a11y 6·Pages 2·bundle 통과. software 12/12 통과,
  최대 handler 밀링 5.7 / 선삭 34.9 / 드릴링 29.9 ms, long task 0.
- 동일 reset 20회 진단은 14.38 ms로 줄었으며 법선·경계 재계산은 0회다.
  이 수치를 원격 CI 또는 실장비 gate의 대체 증거로 사용하지 않는다.
- 재측정 중 8개 메모리 조합 중 7개 통과, Edge/WebGL 2 balanced는 유효하지 않은
  process private bytes로 차단됐다. 원본 incomplete 보고서를 별도 보존했다.
  계측기가 느린 WDDM 조회 후 살아 있는 Process 객체의 속성을 다시 읽던 경로를
  제거하고 한 번의 스냅샷을 사용한다. 추가된 전체 PID 일치 검사에서 navigation으로
  종료된 renderer 목록 경쟁이 확인되어, 이 취득 오류만 최대 2회 CDP 목록을 갱신한다.
  실제 측정 값·예산 초과·GPU 카운터 오류는 재시도하거나 제외하지 않는다.
  갱신 횟수는 보고서에, PID 포함 원본은 ignored 로컬 JSONL에 남긴다. 전체 8개 재측정 예정.
- `8ecf61d` / CI `34698346169`: visual·전체 E2E·a11y·bundle 통과.
  software matrix 7 passed/5 failed, 모든 기능·Stock 동등성 통과.
  선삭/드릴링의 handler 55.3–101.1 ms와 일부 long task 2–3회가 기존 한도를 넘었다.
  보고서는 `artifacts/ci-34698346169/benchmark-report.json`에 보존하며 병합하지 않는다.
- 회전 소재 reset 20회 로컬 진단: 총 138.18 ms 중 법선 50.33 ms, 경계 상자 20.56 ms,
  경계 구 45.14 ms. 계측 진단은 성능 gate가 아니다.
- 동일 full profile의 법선·경계를 재사용하고 다른 profile일 때만 재계산한다.
  각도 삼각함수는 격자별로 한 번 계산하고 정점 임시 배열을 제거한다.
  이전 정점·winding·퇴화 반경·잘린 끝 셀의 완전 일치와 변경 profile 재계산을 검증한다.
  런타임 변경이므로 기준 장비 증거는 다시 측정하며 기존 한도를 유지한다.

## M12 학습 레이아웃 수정 후 최종 증거

- `5874e50` / CI `34697679929`: Linux visual 4개 통과, 새 성공 baseline 부재 1개 차단.
  실제 캡처에서 수치·단위·항목명의 가로 표시와 겹침 방지 검사를 확인해
  `tutorial-success-linux.png`를 등록했다. Windows/Linux 기준과 1% 허용치는 분리·유지한다.
- 로컬 최종 verify 306/64/69, visual 5, a11y 6, Pages 2 통과.
- CSS 수정 후 메모리 8/8 재통과(각 60초 이상, 39–41 samples, 126–290회 반복):
  Chrome GPU/GL2 balanced 438.58/304.66 MB, precision 457.40/361.59 MB;
  Edge GPU/GL2 balanced 489.05/363.63 MB, precision 521.24/378.08 MB.
  수치 변화는 실행 변동을 포함하며 CSS 수정에 따른 메모리 개선율로 해석하지 않는다.
- 실장비 성능 24/24 재통과. 최저 FPS balanced 119.289, precision 109.684,
  cold shell 최대 1175.3 ms, main handler 최대 21.7 ms, long task 0.
- 새 런타임 지문 189 files / `c164223c566b2aa1529ce4d0228a78644e82b8fe9372d412d2f4cd52e20b9066`.
  체크인 증거를 새 보고서로 갱신했고 검증기 통과. 이전 증거는 Git과 별도 로컬 파일에 보존한다.
  전체 원격 CI·clean release·공개 배포 확인 전 M12 전체 완료로 취급하지 않는다.

## M12 두 번째 CI — 시각 기준 환경 분리

- `5e489b8` / CI `34696796080`: WebGPU 합성 수정 후 전체 E2E 88 passed/2 skipped.
  시각 회귀에서 G-code 오류·튜토리얼 성공/실패의 Windows/Linux system font 차이를 확인했다.
  machine-scene/heatmap은 통과했다. 실패 원본은 `artifacts/ci-34696796080`에 보존한다.
- Playwright 권고대로 OS별로 동일 환경의 기준 이미지와 비교한다. 기존 Windows 기준은
  유지하며 Linux 글꼴 기준은 별도 이름으로 검토한다. 1% pixel 허용치는 변경하지 않는다.
  참고: https://playwright.dev/docs/test-snapshots.
- 비교 중 기존 좁은 학습 측정 행이 긴 값 때문에 항목명을 한 글자씩 줄바꾸는 문제를 확인했다.
  항목명/값을 별도 행에 배치하고, 세로 순서 및 가로 넘침을 검사한다. 성공 baseline은
  의도된 레이아웃 변경만 갱신하며, CSS 런타임 변경에 따라 성능/메모리 증거도 재측정한다.
- 수정 후 Windows visual 5/5, a11y 6/6(별도 visual project 3 skipped), Pages 2/2 통과.
  새 성공 이미지를 직접 검토해 측정 항목의 세로 찢김이 없어졌음을 확인했다.
  G-code/실패 상태의 Linux CI 생성 이미지도 직접 검토하여 별도 Linux 기준으로 등록한다.
  새 레이아웃의 Linux 성공 이미지는 다음 CI에서 검토한다. CI의 visual 순서를 앞으로
  옮겨 OS 기준 문제를 빠르게 검출하며, 전체 E2E/성능 gate는 모두 유지한다.
  기존 성능/메모리 원본은 `*-before-lesson-layout.json`으로도 보존했다.
- 수정 후 `pnpm verify` 재통과: 306 unit/64 contracts/69 parity, lint·typecheck·build.
  기준 장비 메모리/성능은 재측정 중이다. 체크인된 이전 evidence는 의도적으로 보존하며
  현재 CSS 지문과의 불일치를 통과 처리하지 않는다. 새 증거와 Linux 성공 기준 검토 전 병합 금지.

## M12 PR #13 첫 CI 후속

- `b8ed28a` 커밋·푸시와 PR #13 생성 완료. clean Pages 빌드의 version/SHA/WASM 검증 통과.
- CI run `34696170428`: verify·보안·60초 fuzz·Rust fmt/clippy/test 통과,
  전체 E2E 87 passed/2 skipped/1 failed. WebGPU 레이어 toggle의 전후 캔버스가 같았다.
  원본 screenshot/trace를 `artifacts/ci-34696170428`에 보존했다.
- 실패 이미지에는 3개 완료 프레임 신호에도 캔버스 전체가 비어 있었다. Linux headless의
  Dawn/ANGLE 합성 문제와 일치하는 재현 사례를 참고하여 Linux software WebGPU만
  enable-gpu/use-vulkan=swiftshader 및 Xvfb를 적용한다. Windows 기준 장비 설정은 그대로다.
  참고: https://github.com/visgl/luma.gl/issues/2874 및 https://playwright.dev/docs/ci.
- 이미지 비교를 삭제하지 않는다. 고정 120 ms sleep을 완료 프레임·실제 픽셀 변경 검사로
  교체하고 전후 이미지를 CI Artifact에 남긴다. 앱 런타임·기준값·visual baseline 변경 없음.
  재실행 CI 통과 전 M12 완료·병합으로 취급하지 않는다.
- CI 진단 다운로드 후 lint가 생성된 Playwright trace viewer 번들까지 검사하는 문제도
  발견했다. git 제외 산출물(.cache/artifacts/playwright-report/test-results)만 lint 제외에
  맞췄으며 앱·스크립트·테스트 소스 검사 범위는 유지한다.
- 후속 로컬 typecheck/lint·런타임 증거 검사 통과, WebGPU/WebGL 2 레이어 toggle
  각각 3회(총 6회) 통과. Linux 합성 수정의 최종 판정은 재실행 CI에서 수행한다.

## M12 최종 로컬 검증 (2026-09-12)

- `pnpm verify`: unit 306/41 files, contracts 64/16, parity 69/10, lint·경계
  151 modules/353 dependencies·typecheck·Cargo check·production build 통과.
  Rust fmt/clippy/test도 통과했다.
- 전체 WebGPU/WebGL 2 E2E 88 passed/2 opt-in soak skipped, visual 5 passed,
  a11y 및 Pages 전체 suite passed, bundle gate passed. 시각 기준 이미지는 변경하지 않았다.
- `benchmark-reference-final.json`: Chrome/Edge × 두 backend × 세 공정 × 두 프리셋
  24/24 통과. 최저 FPS balanced 119.028, precision 112.013; cold shell 최대
  1585.8 ms, handler 최대 21.7 ms, long task 0, React commit 증가 0.
  모든 브라우저/backend 간 같은 프리셋의 기능·Stock 결과가 일치했다.
- `lighthouse-final.json`: 새 Chrome 3회 LCP 925.0/948.5/979.1 ms, 모두 2500 ms 이내.
  로컬 production Pages·10 Mbps/40 ms 조건이며 공개 CDN 네트워크 측정은 아니다.
- `docs/verification/m12-reference-evidence.json`은 로컬 측정의 PID를 제거한 압축 증거다.
  `node scripts/check-reference-evidence.mjs`가 압축을 풀고 24개 성능 결과, 8개 메모리
  산술·한도 및 런타임 지문을 재검증한다. 현재 통과. CI가 원본 envelope와 읽기 쉬운
  JSON을 함께 보존한다. 이는 독립 하드웨어 인증/서명이 아니며 sourceDirty 원출처를 유지한다.
- 원격 CI는 software benchmark·Lighthouse·핵심 Fixture/visual baseline 보존까지 수행한다.
  런타임 파일 변경 시 기준 장비 증거를 다시 측정해야 한다. clean commit의 Pages
  버전·SHA·WASM 검사는 커밋 이후 수행하며, DoD 10/11 확인 전 완료로 올리지 않는다.
- 잔여 범위 제한: Firefox/Safari 미인증, 60초 대표 공정 외 장시간·대형 임의 프로젝트 미보증,
  binary STL만 수용, telemetry/SAB 비활성. 사용자 승인 배포 대상은 GitHub Pages다.

## M12 앱 귀속 메모리·소프트웨어 성능 재개

- 사용자 승인: 600 MB/1.5 GB 기준은 유지하고 브라우저 고정 비용을 제외한 앱 귀속 사용량을 산정한다.
  CPU private commit 합과 WDDM GPU 보고값 각각의 양의 증가량을 합하며 서로 상쇄하지 않는다.
  기준값은 빈 브라우저 3회 최솟값이고 잘못된 값/미측정은 실패한다. 산정 단위 테스트 5개 통과.
- cold blank 기준 Chrome WebGPU balanced는 815.841 MB, 버퍼 재사용 후 818.778 MB,
  탐지 컨텍스트 정리 후 819.073 MB로 미통과했다. 이전 보고서를 각기 다른 이름으로 보존했다.
- Stock은 동일 격자에서 geometry/material/버퍼를 재사용한다. 밀링/선삭 각 한 개만 보관하고,
  비활성 Stock의 선택/patch를 금지하며 최종 폐기와 격자 변경 시 교체 폐기를 테스트한다.
  형상·revision 초기화 포함 5개 테스트 통과. 해상도·재료 제거 계산을 변경하지 않았다.
- 기능 탐지용 WebGL 컨텍스트는 실제 렌더러와 같은 high-performance 선호도를 사용하고 즉시 해제한다.
  지원 여부/폴백 불변식 테스트 2개 통과.
- `benchmark-software-v5.json`: WebGPU/WebGL 2 × 3공정 × 2프리셋 12/12 통과,
  최대 handler 42.5 ms, long task 최대 0, 모든 기능/Stock 동등성 통과. v3/v4 실패도 보존한다.
- `profile-reference.mjs`는 새 작업용 브라우저의 memory-infra/CPU 진단 추적만 로컬 저장한다.
  계측된 실행은 성능 gate로 사용하지 않는다. GPU 프로세스 native malloc이 큰 비중이며,
  JS heap만으로 전체 사용량을 대체하지 않는다. 원시 추적의 환경 메타데이터는 공개하지 않는다.
- CNC 코드/자산이 없는 1×1 vanilla GPU 컨텍스트를 초기화·폐기한 뒤 빈 브라우저 고정 비용을
  분리했다. cold blank 단계 중에도 native GPU 초기화가 진행되는 것을 관측했다.
  최초 자산 요청 0 검사에서 브라우저 자동 favicon 요청을 발견해 빈 data icon으로 차단했다.
  검사 자체를 완화하지 않았으며 매 case 새 browser로 이전 앱 캐시를 배제했다.
- 최종 메모리 8/8 통과: Chrome GPU/GL2 balanced 476.05/356.00 MB,
  precision 454.59/354.24 MB; Edge GPU/GL2 balanced 504.30/368.85 MB,
  precision 526.73/421.54 MB. 각 60초 이상, 30–40 samples, 127–363회 세 공정 반복.
  총 브라우저 메모리가 아니라 초기화된 브라우저 고정 비용을 제외한 앱 귀속 관측값이다.
- 측정 런타임 지문: git-normalized-source-sha256-v1 / 189 files /
  `de53d7d17126ea552dff880efb90d119d36c66e37e8e4db97f88a4e3bb8e6e76`.
  최종 실장비 FPS 재측정 후 sanitized evidence를 CI Artifact로 보존하고 코드 불일치를 차단한다.
- 아직 커밋·푸시·PR·원격 CI·병합·배포는 진행하지 않았다.

## M12 완료 작업 재개 (2026-09-12)

### 추가 검증과 발견

- Medium/High를 실제 balanced/precision WASM 계약으로 연결했다. `benchmark-reference-v2.json`
  Chrome/Edge × WebGPU/WebGL 2 × 3공정 × 2프리셋 24 passed. 최저 FPS Medium 119.706,
  High 119.086; cold localhost shell 최대 1341.1 ms. 이 측정은 아래 리소스 수명 수정 전이다.
- Lighthouse 13.4.1, 새 Chrome 프로필 3회, 1440×900/DPR1, 10 Mbps/40 ms, CPU×1:
  LCP 814.9/795.3/820.4 ms 모두 2500 ms 이내. CLI 임시 프로필 정리 EPERM은
  작업 전용 Playwright 프로필 소유 방식으로 해결했다. `.cache/lighthouse-*`는 git 제외 로컬 프로필이다.
- 60초 반복 공정에서 이전 Stock이 selectableObjects와 WebGPU material/shadow 캐시에
  남는 경로를 확인했다. 선택 참조 해제, 동적 material 소유/폐기, 공정별 Mesh 2개 재사용을 구현했고
  교체 60회·폐기·식별자 재사용 단위 테스트 3개를 통과했다.
- 현재 메모리식은 모든 CDP 브라우저 프로세스의 max(privateCommit, workingSet) 합 +
  WDDM dedicated/shared GPU 값이다. 고정 브라우저 비용과 공유 메모리 중복 가능성이 있으므로
  실제 앱 메모리라고 표현하지 않는다. 기존 600 MB/1.5 GB 기준은 변경하지 않았다.
- Chrome WebGPU 보수적 관측 상한: 선택 참조 수정 전 2.797 GB/126회,
  선택 참조만 수정 5.286 GB/338회, material 폐기 추가 4.990 GB/331회,
  Mesh 식별자 재사용 후 1.560 GB/318회(시작 1.341→종료 1.465 GB).
  고정 60초 동안의 반복 횟수가 달라 비율을 직접 비교하지 않으며 누수 완전 해소로 선언하지 않는다.
- Chrome WebGL 2: 빈 브라우저 보수적 기준 약 580 MB, 328회 반복 상한 1.273 GB.
  memory JSON 원본과 수정 단계별 복사본을 artifacts에 보존했다. 아직 메모리 gate는 실패다.
- M12 메모리 기준을 앱 사용량(Worker/WASM/GPU 포함)으로 산정할지 브라우저 전체로
  산정할지 사용자 확인을 요청했다. 응답 전 산정식을 바꿔 통과 처리하지 않는다.
- 전체 CI를 두 backend 전체 E2E·전체 visual·a11y·Lighthouse로 강화했다.
  Worker 충돌 수신 프레임과 반영 프레임 차이 1을 검사하도록 보강했다. 원격 CI/병합은 미실행이다.
- `pnpm verify` 통과: unit 288/37 files, contracts 64/16 files, parity 69/10 files,
  lint·경계 150 modules/351 dependencies·typecheck·Cargo check·production build.
  최초 테스트 Three 타입 참조 오류는 렌더러 공개 타입 참조로 수정했다.
- 전체 WebGPU/WebGL 2 E2E 88 passed/2 opt-in soak skipped, visual 5 passed,
  a11y 6 passed/3 별도 visual project skipped, Pages 2 passed.
  Stock patch 없는 충돌 이벤트에서도 marker를 다음 렌더 프레임에 반영하도록 수정했고,
  실제 충돌 위치와 수신→반영 정확히 1프레임 차이를 검증했다.
  카메라 invalidation 검사는 동기 호출 병합 대신 10개 실제 완료 프레임에서 기존 불변식을 검사한다.
- 리소스 수명 수정 후 전체 성능 v3는 34/36 통과, 모든 기능/Stock 동등성 통과.
  software Chromium High 밀링의 handler 57.9/51.4 ms가 50 ms 미만 기준을 넘었다.
  셀별 임시 배열 생성을 제거한 후 기존 모든 정점·winding·경계 셀·patch 동일성 테스트 3개와
  typecheck를 통과했다.
- 최종 `benchmark-reference-v4.json`: 27 passed/9 failed. 실장비 Chrome/Edge 24조합과
  모든 기능/Stock 동등성은 통과했지만 software Chromium의 handler/long task 예산은
  9조합에서 실패했다. 최대 handler 994.7 ms, 공정당 long task 최대 85회.
  v3 실패가 해결되었다고 선언하지 않으며 v3/v4 원본을 함께 보존한다.
  실장비 cold shell 최대 1536.9 ms. 최종 geometry 변경은 정점 동일성 테스트로 검증했고,
  전체 E2E/visual 결과는 그 직전 리소스·충돌 수정 상태의 결과다.
  원격 CI·커밋·푸시·PR·병합·재배포는 아직 수행하지 않았다.
- 마지막 코드 기준 `pnpm lint`, `pnpm test:unit` 289/37 files, `pnpm check:bundle` 통과.
  CSS gzip 21420/81920 B, WOFF2 0/409600 B; G-code Lab lazy 경계 통과.
  WASM은 857623 B 및 기존 SHA-256을 유지했다. 메모리 산정 범위 회신과 software 성능
  프로파일링이 남아 있으므로 완료·병합으로 승격하지 않는다.

- 사용자가 M12 완료 후 커밋·푸시·병합을 승인했다. 현재 브랜치의 미병합 M10/M11 선행 변경도 전체 CI 대상으로 포함한다.
- 기준 장비로 현재 PC(i7-13620H, 64GB RAM, Chrome/NVIDIA RTX 4060 Laptop 및 Edge/Intel UHD, 1440×900·DPR 1)를 사용자 승인받았다. 승인과 실제 gate 통과는 별개다.
- 업로드 크기·확장자·MIME 사전 검사, binary STL 삼각형/구조/비유한 수 검사, ZIP 폭탄/손상 회귀를 보강했다. 현재 모델 경계는 binary STL만 수용하며 OBJ/glTF/CAD 디코딩·UI 업로드는 제공하지 않는다.
- Pages CSP는 외부 연결/스크립트/프레임을 차단하고 same-origin WASM/Worker를 허용한다. Pages E2E에서 Monaco·WASM·실행·내보내기와 외부 HTTP 요청 0을 확인했다. 실제 배포 검증은 아직 남았다.
- 검증: `pnpm security:test-uploads` 9+11 tests, `pnpm test:pages` 2 tests 통과. M12 전체 완료 아님.

## M12 커밋·푸시 인계 (2026-09-12)

- 사용자 승인에 따라 릴리스 출처 검증과 benchmark/browser matrix 두 로컬 단위를
  `origin/codex/m12-release-gates`의 커밋·푸시 대상으로 확정했다. 저장소는
  `JTech-CO/CNC-Render`이며 force push, PR 생성, 병합, 공개 배포는 수행 범위가 아니다.
- 커밋 직전 release-metadata 26 tests, benchmark-contract 16 tests,
  `check:versions`, `check:doc-terms`, `git diff --check`를 재통과했다.
  전체 verify 273/64/69와 최종 browser matrix 18 passed 증거는 아래 기록을 유지한다.
- 생성된 두 벤치마크 JSON과 dist 산출물은 로컬 증거로 보존하되 커밋에 포함하지 않는다.
  기존 산출물의 SHA/dirty 표시는 당시 측정 출처이며, 새 clean commit의 릴리스 검증은
  별도 재빌드가 필요하다. M11 선행 브랜치 병합·기준 정리와 M12 나머지 gate는 남아 있다.

## M12 기준 benchmark·브라우저 matrix (2026-09-12, 로컬 단위 완료)

- 기존 Node `bench`를 유지하면서 `--report=artifacts/<name>.json --matrix=software|reference|all`
  경로를 추가했다. 전체 Node gate 후 production Pages에서 실제 Worker/WASM 공정과
  renderer를 직렬 측정한다. CPU benchmark도 파일 단위 직렬화했으며 임계값은 유지했다.
- bundled Chromium/SwiftShader, 설치된 Chrome, 설치된 Edge 각각 WebGPU/WebGL 2에서
  밀링·외경 선삭·드릴링을 실행한다. fallback을 요청 backend의 성공으로 치환하지 않는다.
- balanced·seed 7·1440×900·DPR 1·fast-forward 1회 warmup·최소 8초 realtime 100배속,
  wall-clock 15°/s orbit으로 workload v1을 정의했다. 완료 프레임/경과 시간 FPS와
  관찰된 frame interval P95, 셸 준비 ms·main handler ms·long task·React commit을 기록한다.
- OS/CPU/RAM·브라우저 실제 버전·GPU probe·canvas 크기·버전/SHA/WASM 출처를 남긴다.
  page JS heap은 참고값이며 총 메모리로 판정하지 않는다. 원본 G-code/프로젝트명/hostname은 없다.
- 모든 요청 조합의 semantic/Stock hash·XYZ mm·진단·제거 체적·단계 수를 정확히 비교한다.
  기능·메인 스레드 gate·개별 FPS·전체 release 상태를 분리해 과대 통과를 막는다.
- CI에 software benchmark와 성공/실패 JSON 30일 보존을 연결했다. 원격 실행은 하지 않았다.
  생성 파일은 `artifacts/`에만 허용하고 git에서 제외한다. 시작 시 incomplete marker로
  과거 성공 결과의 오인 재사용을 방지한다. README 등 소스 경로 덮어쓰기 거부도 확인했다.
- ADR-0017과 `docs/browser-support-matrix.md`에 방법·제한·관찰 버전을 기록했다.

### 최종 검증

| Gate | Result |
|---|---|
| `pnpm verify` | 통과 — unit 273/36 files, contracts 64/16 files, parity 69/10 files, lint·typecheck·Cargo check·production build |
| benchmark 판정 단위 | 16 tests 통과(전체 unit 포함); 누락/중복/backend mismatch/소프트웨어/비정상 수치/60 FPS 기준 |
| 기존 Node benchmark | 5 files / 8 tests 통과, 기준 완화 없음 |
| `pnpm bench -- --report=artifacts/benchmark-reference-v1.json --matrix=all` | 최종 18 passed; 3공정 전체 cross-backend/browser parity 통과 |
| Chrome·Edge 후보 GPU FPS | 최종 118.80–119.85 FPS; 12조합 모두 60 FPS 이상 |
| React·메인 스레드 | 최종 18조합 commit 증가 0, handler < 50 ms, long task 0 |
| localhost cold-context shell | 최종 약 515–2,268 ms; 공개 LCP 검증 아님 |
| release identity client/Pages | 둘 다 재통과, WASM 해시·크기 이전 단위와 동일 |
| dependency boundary | 147 modules / 338 dependencies, 위반 0 |
| `git diff --check` | 통과 |

- 초기 매개변수화 테스트 배열의 타입/인자 매핑 오류를 수정하고, 최종 전체 verify를 통과했다.
- 최초 조사(프레임당 고정각 orbit)는 16 passed / 2 failed: Chrome WebGPU drilling
  handler 66.9 ms, Chrome WebGL 2 milling long task 5회. `artifacts/benchmark-report.json`에
  보존했다. 카메라를 시간 기준으로 정규화한 최종 결과는 별도 `benchmark-reference-v1.json`이다.
- 초기 예산 초과는 최종 실행에서 재현되지 않았으나 원인을 해결했다고 선언하지 않는다.
  엔진·UI 성능 기준을 바꾸지 않았으며, 반복 cold/전원/GPU cache 조건 검증이 남는다.
- Chrome 152.0.7977.83은 NVIDIA, Edge 153.0.4234.32는 Intel GPU가 관찰됐다.
  같은 GPU 기준 브라우저 비교가 아니다. Chromium 140.0.7339.16/SwiftShader의 FPS는
  실장비 판정에서 제외했다. High·총 메모리·LCP·Firefox/Safari·기준 장비 승인도 미완료다.
- 브랜치는 `codex/m12-release-gates`이며 이전 릴리스 출처 변경을 보존했다.
  커밋·푸시·PR·병합·공개 배포는 수행하지 않았다. 기존 stash도 변경하지 않았다.

## M12 첫 단위 — 릴리스 출처·WASM 무결성 (2026-09-12, 로컬 gate 완료)

- `codex/m12-release-gates`를 아직 병합 전인 M11의 `2f48a6f`에서 분기했다.
  M11 PR·병합과 공개 배포는 이번 요청에서 수행하지 않는다. 장기 기준과 배포 대상은
  `main` 및 사용자 지정 GitHub Pages를 유지한다. ADR-0016에 임시 stacked 경계를 기록했다.
- Vinext client와 Pages 산출물에 `release.json`을 생성한다. 제품·엔진·프로젝트 스키마·
  Worker protocol 버전, 실제 HEAD 전체 SHA, 로컬 변경 여부, 대상, WASM 크기·SHA-256을
  기록한다. 기존 버전 0.9.0과 schema/protocol 1은 변경하지 않는다.
- 잘못된 `GITHUB_SHA`, 누락/추가/변조 metadata, 변경된 배포 WASM을 거부한다.
  GitHub Actions 및 `--require-clean` 검사는 미커밋/새 소스가 있으면 게시를 차단한다.
- JSON에 시간·사용자명·브랜치명·로컬 경로·프로젝트명·G-code 원문을 넣지 않는다.
  UI·Worker 실행 주기와 기존 성능·시각 임계값은 변경하지 않았다.
- Pages E2E는 `/CNC-Render/release.json`과 같은 배포의 WASM을 HTTP로 받아 대조한다.
  CI는 Pages smoke 다음, artifact 업로드 전에 `check:release --require-clean`을 실행한다.

### 검증

| Gate | Result |
|---|---|
| `pnpm test:unit --filter release-metadata` | 26 tests 통과 — SHA/dirty/변조/누락/결정론적 JSON |
| `pnpm verify` | 최종 통과 — unit 257/35 files, contracts 64/16 files, parity 69/10 files; lint·typecheck·Cargo check·production build |
| dependency boundary | 통과 — 142 modules, 327 dependencies, 위반 0 |
| `pnpm check:release --target=client` | 통과 — 실제 Vinext client metadata와 WASM SHA 일치 |
| `pnpm test:pages` | 2 passed — metadata HTTP 응답/WASM 해시, UI·Monaco·분석/비교 Worker·절삭·JSON 내보내기 회귀 |
| `pnpm check:release --target=pages` | 통과 — 실제 Pages metadata와 WASM SHA 일치 |
| `check-release.mjs --target=pages --require-clean` negative gate | 예상대로 실패 — 미커밋 worktree의 게시 차단, 오류 원인까지 확인 |
| `git diff --check` | 통과 |

- 초기 타입 검사에서 테스트 환경 객체의 필수 `NODE_ENV` 누락을 수정했고, 이후
  전체 표준 검증을 처음부터 재통과했다. 기존 500 kB lazy chunk 안내 경고는 남는다.
- client/Pages 모두 제품·엔진 0.9.0, schema/protocol 1, 기반 SHA `2f48a6f…`,
  `sourceDirty: true`를 기록한다. WASM은 857,623 B, SHA-256
  `9f588d8fb523d98cf79ec86b9b1f6f775dc30efc9c7d146cebb45bf4468ffccf`로 이전과 같다.
- 이번 결과는 Windows 로컬 Chromium/SwiftShader 검증이다. 원격 CI 실행·커밋·푸시·
  PR·병합·공개 Pages 재배포는 수행하지 않았다. 기존 M10 stash는 변경하지 않았다.

### 남은 M12 범위

- DoD 1–3: 기준 실장비/브라우저/해상도 명시, LCP·cold shell·Medium/High FPS·메모리.
- DoD 4–6: 1프레임 충돌 경고·WebGPU/WebGL 2 parity의 릴리스 matrix, Chrome/Edge
  필수 결과와 Safari/Firefox 통과 또는 제약 문서. 기존 SwiftShader 테스트를 실장비로 간주하지 않는다.
- DoD 7–9: 업로드 형식·크기·구조·과도한 메시·압축 폭탄 방어, SAB 사용 여부와 실배포
  COOP/COEP/외부 리소스 정책, 익명 telemetry의 수집 범위/개인정보 검증.
- DoD 10: 전체 CI matrix와 bench-smoke·Lighthouse·보안 검사·결과 artifact 보존.
- DoD 11: 산출물 식별·로컬 gate 구현은 완료했다. clean commit의 원격 CI 및 실제
  공개 배포 산출물 확인은 별도 승인 후 진행한다. 로컬 미커밋 SHA를 공개 릴리스로 간주하지 않는다.
- M12 전체 완료와 공개 릴리스는 위 gate 및 알려진 P0/P1/P2 검토 이전에 선언하지 않는다.

## M11 G-code Lab·진단·측정·결과 비교 (2026-09-08 검증 완료, 2026-09-12 기록 정리)

### 구현과 DoD 대응

- Monaco·분석 Worker/WASM을 Code 탭의 lazy 경계로 분리했다. Rust parser-only ABI와
  strict versioned 계약이 원본 SHA-256, end-exclusive source range, 지원 수준,
  결정론적 진단 ID를 반환한다. 편집은 150 ms debounce/세대 검사로 오래된 응답을 버린다.
- 편집한 실제 source를 전용 Coordinator→Rust/WASM 경로에서 실행한다. 현재 줄,
  원본 줄 단위 실행, 첫 motion 전 breakpoint, modal-only 0초 step, M0/M1 pause와
  M2/M30 종료를 지원한다. 같은 줄의 cycle 확장은 한 step으로 묶고 기존 motion ABI와
  Golden semantic/Stock hash는 유지한다. 현재 줄·오류·중단점은 문자·모양·레이블로 구분한다.
- 파서 오류는 editor↔목록, 실제 축 한계·충돌·비절삭 feed 경고는 editor↔목록↔3D
  객체·좌표를 같은 ID로 연결한다. 파서에 가짜 공간 위치를 부여하지 않는다. G41/G42는
  지원 수준과 자동 대체 불가, 직접 공구 중심 경로를 작성하는 도움말을 표시한다.
- UI는 실행 중 편집을 잠그고 정지 후 다시 편집할 수 있다. 다른 source의 이전 진단,
  현재 줄과 3D 마커는 새 draft에 연결하지 않는다. Lab만 최대 10 Hz 실행 요약을 구독하고
  source map·program-control 배열·Stock/편차 TypedArray는 React/Zustand에 넣지 않는다.
- 거리·직경·반경·각도·깊이·벽 두께를 좌표 입력과 실제 Stock 표면 sampling으로 측정한다.
  canonical mm/rad를 보존하고 inch/degree와 반올림은 표시 경계에서만 적용한다.
- 완료/진단 중단 Stock과 독립 작성한 목표를 comparison Worker에서 비교한다.
  Overlay/Split/Heatmap은 동일 Float64 편차 field와 max/mean/P95·과절삭·미절삭 통계를 쓴다.
  JSON/CSV/인쇄 HTML은 같은 metric 정의를 공유하고 HTML escaping·CSV formula 방어를 한다.
- 보고서에 run/fixture·state/Stock hash·target ID·추정 시간·완료/중단·진단 개수를 남긴다.
  새 run은 이전 보고서·내보내기를 무효화한다. M8 renderer-only 복원은 엔진 세션과
  혼합 비교하지 못하게 재실행을 요구하며 snapshot 전후 run ID와 terminal 상태를 검증한다.
- 결과 Loader만 `M11ResultBridge`의 안정된 scalar snapshot을 구독하며 같은 run summary는
  알림을 만들지 않는다. 실행 중 작업실 React commit 수는 증가하지 않는다.
- Code 탭 헤더 저장은 편집 Stock을 대표 공정 재실행으로 교체하지 않도록 명시적으로
  거부한다. 편집 source·run ID·Stock hash를 보존하고 복사/리포트 저장을 안내한다.
  README·도움말도 현재 기능과 공개 데모 배포 시점을 구분하도록 갱신했다.
- 대량 진단은 목록 50개/페이지, 장면 256개 한도에서도 선택한 ID를 우선 보존한다.
  전송 10,000개 한도를 채운 경고가 있어도 마지막 축 한계·충돌 증거를 보존한다.
  비교 지도는 실제 표본 최대 4,096개만 렌더·정렬·pick하며 생략을 알리고 전체 통계는 유지한다.
- 데스크톱 shell을 화면 높이에 고정하고 패널 내부 스크롤로 3D 클릭이 화면 밖으로 나가는
  문제를 해결했다. 모바일 결과 화면을 노출하고, 헤더 primary 실행 버튼을 덮던 레거시
  CSS를 제한해 기본·hover 4.5:1 이상 대비를 검증한다.
- ADR-0015와 CI에 M11 분석·실행·측정·내보내기·visual·접근성·lazy bundle gate를 연결했다.
  Pages 산출물은 다른 검증용 build가 끝난 뒤 마지막에 생성한다.

### 검증

아래는 2026-09-08 실행에서 확인한 최종 결과다. 완료 기록과 커밋 직전 실행 승인 서비스의
사용량 제한으로 중단되었고, 2026-09-12에 동일 브랜치에서 기록·커밋·푸시를 재개했다.
2026-09-12 재실행한 `pnpm verify`도 unit 231, contracts 64, parity 69와 production
build까지 모두 통과했다. WASM 크기와 SHA-256도 아래 2026-09-08 결과와 동일하다.

| Gate | Result |
|---|---|
| `pnpm verify` | 통과 — unit 231/34 files, contracts 64/16 files, parity 69/10 files, lint·typecheck·Cargo check·production build |
| M11 공식 E2E (`gcode-lab`, `diagnostic-link`, `measurement`, `result-compare`) | 최종 통과 — WebGPU·WebGL 2 28 passed, visual 중복 14 skipped; 저장 보호 포함 |
| `pnpm test:contracts --filter report` | 통과 — 1 file, 5 tests |
| `pnpm test:visual` | 통과 — 5 passed; 공식 gcode-error·heatmap 포함 |
| `pnpm check:bundle` | 통과 — 초기 10개/lazy 6개 manifest 경계, CSS gzip 21,420 B / 81,920 B; 기준 완화 없음 |
| `pnpm test:e2e` 전체 회귀 | 통과 — 97 passed, 기존 visual 중복·opt-in soak 35 skipped; 이후 저장 보호는 최종 M11 공식 gate로 추가 검증 |
| `pnpm test:a11y` | 최종 통과 — WebGPU·WebGL 2 6 passed, visual 중복 3 skipped; Code 준비/오류·결과 3모드 포함 |
| `pnpm test:pages` | 통과 — 1 passed; `/CNC-Render/` 실제 Monaco/분석·비교 Worker, Stock 비교·JSON provenance·브라우저 오류 0 |
| Rust fmt·clippy·`pnpm cargo:test` | 통과 — 전체 workspace, WASM ABI 실행 테스트 12개 포함 |
| dependency boundary | 통과 — 139 modules, 318 dependencies, 위반 0 |
| `git diff --check` | 통과 |
| production WASM | 857,623 bytes, SHA-256 `9f588d8fb523d98cf79ec86b9b1f6f775dc30efc9c7d146cebb45bf4468ffccf` |
| visual assets | gcode-error 66,995 B; heatmap 98,348 B; 수정된 machine-scene 35,514 B |

- 초기 검증에서 화면 밖 진단 클릭, 대량 진단의 선택/terminal 상한, 오래된 결과 출처,
  빈 코드 alert 선택과 nullable 공간 타입, 작업실 React commit 증가를 확인해 수정했다.
  최종 M7 gate는 양쪽 backend에서 commit 불변, `maximumMainHandlerMs < 50`,
  `longTasksOver50Ms <= 1`을 그대로 통과했다. 테스트와 성능 임계값을 낮추지 않았다.
- 기존 machine-scene의 923×883 캔버스는 900 px 화면을 벗어나 있었다. 높이 교정 후
  923×625 화면을 직접 검토해 해당 baseline만 갱신했다. 새 오류·히트맵 baseline도
  직접 확인하고 snapshot 업데이트 없이 전체 visual gate를 재통과했다.
- Monaco lazy chunk의 500 kB 안내 경고는 남지만 초기 entry 유입은 없다.
  Windows 로컬 Chromium/SwiftShader 기능 검증이며 opt-in 장기 soak와 기준 실장비
  성능·메모리·다중 브라우저 릴리스 판정은 M12 범위다.

### 제한과 다음 경계

- M11은 S1 기능의 기초이며 정확도는 계속 E2 교육용 근사다. 밀링 balanced 8 mm dexel,
  회전 1 mm layer보다 작은 형상과 산업용 검증·표면조도·열변형을 보증하지 않는다.
- 목표는 대표 밀링·외경 선삭·센터 드릴링의 독립 작성 형상이다. 임의 CAD 목표 import,
  feature 자동 인식·최소 벽 두께 탐색은 없다. 직경/반경의 중심과 깊이/벽 두께의 기준면
  법선은 사용자가 지정한다. M1은 optional-stop 토글 없이 항상 멈춘다.
- 10,000개를 넘는 경고는 생략할 수 있으므로 보고서 개수는 보존된 실행 진단의 개수다.
  화면 LOD는 측정 가능한 표본을 줄일 뿐 전체 원본 field·통계의 정밀도를 낮추지 않는다.
- M8에서 불러온 Stock은 새 실행 후 비교한다. 임의 checkpoint에서 엔진을 재개하는 기능과
  프로젝트 공유·클라우드 동기화는 이번 단위의 범위가 아니다.
- 편집 G-code는 세션 한정이며 프로젝트 영속화는 제공하지 않는다. Code 탭 헤더 저장은
  거부하며 다른 영역의 대표 공정 저장과 결과 리포트 내보내기를 구분한다.
- 다음 계획은 M12 성능·폴백·보안·CI·릴리스 게이트다. 기준 장비 성능/메모리,
  브라우저 매트릭스, 업로드 보안, COOP/COEP, 개인정보, 릴리스 식별 검증은 별도 진행한다.
- 이번 요청은 feature 브랜치 커밋·푸시까지이며 PR 생성·병합·공개 배포는 수행하지 않는다.
  대상은 `origin/codex/m11-gcode-lab`이며 사용자 지정 저장소 `JTech-CO/CNC-Render`를
  유지한다. 기존 M10 stash는 수정하지 않았다.


## M10 성공·실패 visual baseline·샌드박스 Operation (2026-09-04, 완료)

### 구현

- 평면 밀링 Lesson의 성공과 작성된 잘못된 공구 실패를 전용 WebGL 2 visual
  baseline으로 고정했다. 성공 상태는 실제 Worker/WASM 제거·Stock 갱신·독립 측정·
  `100 / 100` 판정과 마지막 3D 결과를 유지하며 전체 화면 축하 효과를 만들지 않는다.
  실패 상태는 `setup.wrong-tool` 이유와 설정 단계 checkpoint 복구를 함께 검증한다.
- `Operation` strict schema를 사용하는 샌드박스 controller를 추가했다. 대표 E2
  평면 밀링을 생성·편집하고 commit/discard하며 최대 50개 revision을 durable
  undo/redo journal로 직렬화한다. operation identity, revision 순서, cursor와
  configuration이 일치하지 않는 journal은 복원을 거부한다.
- Training VMC, Aluminum 6061, Ø20 mm 평엔드밀, 표준/소형 직육면체 Stock과
  X/Y 왕복을 선택할 수 있다. 이송, 회전수, 절입 깊이와 Stock/방향은 기존
  G-code→전용 Worker→Rust/WASM→renderer 전체 경로에 실제 반영한다.
- balanced 8 mm 격자에서 0 체적 절삭이 되는 하위 해상도 입력을 숨기지 않도록
  이 E2 preset의 절입 깊이를 4–5 mm로 제한하고 UI에 표시한다. feed·rpm·절삭 폭도
  유한값과 기계/preset 상한을 controller에서 검증하며 단위를 입력 옆에 표시한다.
- 미적용 form draft가 stale committed Operation으로 실행·저장되지 않게 하고,
  active/paused 이전 run을 취소한 뒤 새 run ID의 완료 summary만 성공으로 인정한다.
  undo/redo/load도 미적용 draft가 있는 동안 비활성화하고 검증 원인을 alert로 노출한다.
- 저장은 활성 Operation과 journal cursor의 canonical 일치, 완료/non-stopped terminal,
  terminal/checkpoint provenance를 확인한 뒤 Project·G-code·진단·측정·Stock checkpoint·
  journal을 하나의 immutable generation에 기록한다. 불러오기는 entity link, component
  hash, G-code resource와 Stock payload/checkpoint 결속을 모두 재검증한 뒤 렌더한다.
- 실제 wall-clock `maximumMainHandlerMs < 50` 기준은 유지했다. unit 파일 병렬 실행이
  OS scheduling pause를 handler 비용으로 오인하던 문제만 `fileParallelism: false`로
  격리했으며 coordinator metric과 임계값은 변경하지 않았다.
- ADR 0013·0014에 visual 판정, 샌드박스 controller, 실제 엔진 전달과 저장 무결성
  결정을 후속 구현 기록으로 추가했다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| `pnpm test:unit --filter sandbox-operation-controller` | 통과 — 1 file, 15 tests |
| `pnpm test:unit --filter persistence` | 통과 — 3 files, 11 tests |
| `pnpm test:parity --filter scoring` | 통과 — 실제 Rust/WASM 4 tests |
| `pnpm test:e2e --grep "tutorial-face\|tutorial-turning\|tutorial-drilling\|sandbox"` | 통과 — WebGPU·WebGL 2 8 passed, visual 중복 4 skipped |
| `pnpm test:visual --grep "tutorial-success\|tutorial-failure"` | 통과 — WebGL 2 2 passed |
| `pnpm test:a11y` | 통과 — WebGPU·WebGL 2 2 passed, visual 중복 1 skipped |
| coordinator 성능 gate 단독 반복 | 통과 — 15/15, `< 50 ms` 기준 유지 |
| `pnpm verify` (Node 24.18.0, pnpm 11.5.3) | 통과 — unit 190, contracts 51, parity 67, Cargo check, production build |
| dependency boundary | 통과 — 111 modules, 248 dependencies, 위반 0 |
| production WASM | 793,536 bytes, SHA-256 `d788f5b38bc27cd0429f5500e63ad6523fc1b9dce07574c2983a78b444bd9fec` |
| visual assets | success 23,390 bytes `8f18ef8be574…`; failure 20,629 bytes `578ac84f9667…` |

### 남은 위험과 M11 경계

- 이번 샌드박스는 M10 E2 수직 절편이므로 기계·재료·공구는 각 1개다. 기술 백서의
  다축 기계, 원통/튜브/사용자 모델, 재료·공구·고정구 전체 라이브러리, 조그/MDI와
  자유 공구경로 생성기는 후속 샌드박스 확장 범위다.
- 절삭 폭은 Operation provenance에 저장되지만 Ø20 mm 공구의 lane 간격은 대표
  fixture에 고정되어 있다. width 기반 stepover와 임의 toolpath 편집은 후속 범위다.
- 저장은 브라우저 OPFS/IndexedDB의 로컬 generation이다. 복제·공유·클라우드 동기화는
  아직 제공하지 않는다.
- balanced 8 mm 밀링 격자와 1 mm 회전 layer보다 작은 형상, 공구 접촉·표면 조도·
  열 변형은 평가하지 않는다. 화면의 E2 표기를 산업용 검증으로 해석하면 안 된다.
- 목표/결과 heatmap, 측정 도구, 진단 양방향 이동과 JSON/CSV/인쇄 리포트는 M11에서
  구현한다.

## M10 외경 선삭·드릴링 측정/Controller (2026-08-14, 완료)

### 구현

- `packages/simulation`에 `turning-full` Stock 반경 field와 별도 작성한 외경·홀
  목표 cut field를 1 mm 축방향 layer에서 비교하는 순수 측정 어댑터를 추가했다.
  목표는 실제 배열이나 제거 체적에서 역산하지 않으며 외경/내경 반경, Stock 경계,
  cut 구간이 일치하지 않거나 비유한 값이 있으면 측정을 거부한다.
- 외경 선삭은 초기 Ø80 mm 원통의 Z 250–350 mm 구간을 Ø64 mm로 만드는 목표를
  사용한다. 실제/목표 외경, 최대·평균 반경 편차, 과절삭·미절삭, 환형 제거 체적을
  반환하며 대표 Worker/WASM 결과는 120 layer 중 목표 절삭 101 layer와 약
  `182,765.294 mm³` 제거에 일치한다.
- 센터 드릴링은 positive-Z 자유단에서 Ø16 × 80 mm 홀을 만드는 네 번의 점진
  진입(Z 340→320→300→280 mm)과 안전 복귀 fixture를 추가했다. 측정 summary는
  실제/목표 홀 지름과 연속 홀 깊이, 80개 목표 절삭 layer와 약
  `16,084.954 mm³` 제거 체적을 제공한다.
- 외경 선삭 대표 공정은 네 종방향 pass를 유지하면서 작성된 18초 만점 기준을
  임계값 완화 없이 충족하도록 종방향 feed를 `2,400 mm/min`으로 조정했다.
- 외경 선삭·드릴링 각각에 strict 한국어 E2 5단계 Lesson과 Web foundation
  controller를 추가했다. controller는 선택 ID, terminal fixture/process,
  제거 체적, target/process/feature가 일치할 때만 측정·평가를 허용한다.
- 학습 탭에 평면 밀링·외경 선삭·센터 드릴링 선택기를 연결했다. 실행 중 선택을
  잠그고 완료 checkpoint에서만 측정하며 React에는 배열 없이 scalar summary와
  점수만 저장한다. 외경/구멍 지름과 홀 깊이를 단위와 함께 표시한다.
- 드릴링을 M7 Worker/WASM·turning renderer presentation과 M8 프로젝트
  생성·저장·checkpoint 복원 경로에 연결했다. 저장 프로젝트는 drill 공구,
  drilling operation과 peck-drilling strategy를 별도로 보존한다.
- ADR 0013·0014에 공정별 controller, 반경 field 비교 방식, 목표 체적, 시간 기준과
  E2 한계를 후속 구현 기록으로 추가했다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| `pnpm typecheck` | 통과 |
| `pnpm test:unit --filter turning-target-measurement` | 통과 — 1 file, 7 tests |
| `pnpm test:unit --filter tutorial-rules` | 통과 — 1 file, 18 tests |
| `pnpm test:unit --filter coordinator-fixtures-configuration` | 통과 — 1 file, 4 tests |
| `pnpm test:parity --filter scoring` | 통과 — 실제 Rust/WASM 밀링·충돌·외경 선삭·드릴링 4 tests |
| `pnpm test:e2e --grep "radius field"` | 통과 — WebGPU·WebGL 2 외경/드릴 4 passed, visual 중복 2 skipped |
| 드릴링 M8 저장·복원 E2E | 통과 — WebGPU·WebGL 2 2 passed, visual 중복 1 skipped |
| `pnpm test:a11y` | 통과 — WebGPU·WebGL 2 2 passed, visual 중복 1 skipped |
| `pnpm verify` (Node 24.18.0, pnpm 11.5.3) | 통과 — unit 173, contracts 51, parity 67, Cargo check, production build |
| dependency boundary | 통과 — 108 modules, 243 dependencies, 위반 0 |
| production WASM | 793,536 bytes, SHA-256 `d788f5b38bc27cd0429f5500e63ad6523fc1b9dce07574c2983a78b444bd9fec` |

### 남은 위험과 다음 M10 단위

- 회전 Stock은 1 mm 축방향/radial layer를 쓰므로 외경은 2 mm 단위로 양자화된다.
  실제 공구 nose/드릴 point·버·표면 조도·열 변형은 평가하지 않으며 Lesson에서
  E2 교육용 한계로 노출한다.
- 목표 형상 heatmap, 측정 리포트 내보내기와 성공·실패 visual baseline은 남아 있다.
- 샌드박스 operation 생성·편집·저장과 durable undo/redo를 아직 제공하지 않으므로
  M10 전체 완료로 기록하지 않는다.
- 현재 엔진은 첫 충돌에서 정지하므로 충돌 횟수는 계속 `0` 또는 `1`인 E2 값이다.
## M10 실제 Stock 측정·평면 밀링 Lesson controller (2026-08-13, 완료)

### 구현

- `packages/simulation`에 실제 `milling-full` Stock surface와 별도 작성된 목표
  sweep을 비교하는 순수 측정 어댑터를 추가했다. 대표 fixture의 Stock 경계,
  20 mm 평엔드밀과 5패스 경로가 목표 형상을 정의하며 실제 surface 배열에서
  목표를 역산하지 않는다.
- 각 덱셀 셀 중심에서 목표 높이를 계산하고 실제 높이가 더 낮으면 과절삭, 더
  높으면 미절삭으로 판정한다. 가장자리 셀 면적을 반영해 실제·목표 제거 체적,
  과절삭·미절삭 체적을 `mm³`로 적분하고 최대·평균 절대 편차를 `mm`로 반환한다.
  비유한 값, 잘못된 grid 크기, 범위 밖 높이와 다른 Stock용 목표는 거부한다.
- 대표 표준/X방향 Worker/WASM 결과는 Stock `1,125`셀 중 목표 절삭 대상
  `699`셀, 실제·목표 제거 체적 각 `357,888 mm³`, 최대 편차·과절삭·미절삭
  모두 0으로 측정된다. standard/compact와 X/Y방향 조합도 결정론적으로
  동일 목표에 수렴한다.
- `packages/lesson-engine`의 일반 controller가 준비→설정→실행→측정→평가 전이,
  허용 행동, 순서 밖 행동 이유, 체크포인트 복구, 실패와 최종 점수를 관리한다.
  Web foundation의 평면 밀링 controller는 실제 Worker/WASM terminal summary와
  측정 summary만 결합하고 대형 `Float32Array`를 Lesson 또는 React에 저장하지 않는다.
- 학습 탭은 5단계 상태와 현재 지시, 오순서 복구, 측정값, 최종 `100 / 100` 판정을
  노출한다. 실행 단계는 기존 실시간 Worker/WASM 파이프라인을 사용하고 측정 단계는
  완료된 run의 full checkpoint를 읽는다. 단계 행동과 terminal 시점에만 React를
  갱신하며 렌더 프레임별 commit은 추가하지 않았다.
- 측정용 `simulation.snapshot` reply가 renderer 구독자에게 전체 Stock을 다시
  방송해 부분 buffer update 진단을 초기화하던 경로를 분리했다. checkpoint는
  호출자에게만 반환하고 명시적 복원 API를 호출할 때만 렌더한다.
- E2 제한에 `8 mm` 덱셀 셀 중심·양자화 높이 측정임을 추가했다. `8 mm` 미만의
  국부 형상은 평가하지 않으며 산업용 공차 판정으로 표현하지 않는다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| `pnpm test:unit --filter milling-target-measurement` | 통과 — 1 file, 6 tests |
| `pnpm test:unit --filter tutorial-rules` | 통과 — 1 file, 12 tests |
| `pnpm test:unit --filter simulation-coordinator` | 통과 — 1 file, 3 tests; snapshot 렌더 비방송 포함 |
| `pnpm test:parity --filter scoring` | 통과 — 실제 WASM Stock 측정·충돌 정지 2 tests |
| `pnpm test:e2e --grep tutorial-face` | 통과 — WebGPU·WebGL 2 2 passed, visual 중복 1 skipped |
| `pnpm test:a11y` | 통과 — WebGPU·WebGL 2 2 passed, visual 중복 1 skipped |
| `pnpm verify` | 통과 — unit 158, contracts 51, parity 65, Cargo check, production build |
| dependency boundary | 통과 — 104 modules, 234 dependencies, 위반 0 |
| production WASM | 793,536 bytes, SHA-256 `d788f5b38bc27cd0429f5500e63ad6523fc1b9dce07574c2983a78b444bd9fec` |

### 남은 위험과 다음 M10 단위

- 정식 UI Lesson은 아직 평면 밀링 1개다. 외경 선삭·드릴링은 공정별 목표 형상
  측정 어댑터와 5단계 controller 연결이 필요하다.
- 현재 측정 어댑터는 평엔드밀 sweep과 dexel 상면 비교 범위다. 회전 반경 field,
  드릴 구멍 형상, 측정 heatmap과 리포트 내보내기는 후속 단위다.
- 성공·실패 visual baseline과 샌드박스 operation 생성·저장은 남아 있으므로 M10
  전체 완료로 기록하지 않는다.
- 현재 엔진은 첫 충돌에서 정지하므로 충돌 횟수는 계속 `0` 또는 `1`인 E2 값이다.

## M10 Lesson 규칙·Worker/WASM 증거·점수 계약 (2026-08-13, 완료)

### 구현

- `content/lessons/ko/face-milling.lesson.json`에 E2 평면 밀링의 준비→설정→실행→
  측정→평가 5단계, 허용 행동, 순서 밖 행동의 이유·체크포인트 복구 경로와
  성공·실패 규칙을 선언했다. 잘못된 공구, `5 mm` 초과 절입과 충돌은 작성 순서에
  따라 서로 다른 실패 이유를 반환한다.
- `packages/lesson-engine`은 strict Zod schema와 순수 단계 판정 계층으로 두었다.
  알 수 없는 필드, 비유한 수치, 중복 ID·행동·점수 metric, 역행 단계와 100점이
  아닌 배점 합계를 거부한다.
- Worker/WASM Coordinator 완료 요약 또는 실제 충돌 정지만 Lesson evidence로
  변환한다. `logicalTimeS`, 제거 체적, 첫 충돌 유무를 엔진 소유 metric으로 쓰고
  run·fixture·공정 ID와 최종 semantic/Stock hash를 provenance로 보존한다.
  렌더 프레임과 실제 재생 경과는 판정·점수에 사용하지 않는다.
- 형상 편차 30점, 충돌 25점, 논리 시간 15점, 공구 수 10점, 과절삭·미절삭 각
  10점인 100점 정책을 fixture에 선언했다. 만점/0점 경계 사이를 선형 감점하고
  항목별·총점을 소수 둘째 자리로 반올림한다. 통과 기준은 `80 / 100`이며 필요한
  metric 누락은 `lesson.score.metric-missing`으로 거부한다.
- ADR 0013에 강의 규칙 경계를, ADR 0014에 실제 엔진 증거와 점수 공식·단위·
  평면 밀링 임계값을 기록했다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| 변경 소스·테스트 ESLint | 통과 |
| `pnpm test:unit --filter tutorial-rules` | 통과 — 1 file, 10 tests |
| `pnpm test:parity --filter scoring` | 통과 — 실제 WASM 독립 재실행·충돌 정지 2 tests |
| `pnpm typecheck` | 통과 |
| `pnpm check:boundaries` | 통과 — 98 modules, 215 dependencies, 위반 0 |
| `pnpm verify` | 통과 — unit 149, contracts 51, parity 65, Cargo check, production build |
| production WASM | 793,536 bytes, SHA-256 `d788f5b38bc27cd0429f5500e63ad6523fc1b9dce07574c2983a78b444bd9fec` |

### 남은 위험과 다음 M10 단위

- 현재 정식 Lesson 콘텐츠는 평면 밀링 1개다. 외경 선삭·드릴링 Lesson,
  샌드박스 operation 생성·저장, Tutorial UI와 M10 E2E·visual gate는 남아 있다.
- Worker/WASM가 직접 제공하는 점수 값은 논리 시간, 제거 체적과 첫 충돌 유무다.
  최대 형상 편차·과절삭·미절삭은 아직 명시적 측정 입력이며 실제 Stock과 목표
  형상을 비교하는 measurement adapter에 연결해야 한다.
- 현재 엔진은 첫 충돌에서 정지하므로 충돌 횟수는 `0` 또는 `1`인 E2 값이다.
  다중 충돌 누적은 Coordinator 계약 확장 전까지 지원하지 않는다.

## 작업실 탭·공정 재생·밀링 설정 안정화 (2026-08-13, 완료)

### 원인과 수정

- 장면 패널과 코드·학습·결과 Context 패널이 같은 grid cell에 동시에 렌더링되어
  겹쳤다. Activity에 따라 두 패널을 상호 배타적으로 렌더링하도록 수정했다.
- 공개 외경 선삭 fixture는 모션이 3개뿐이어서 약 `0.6 s` 만에 끝났고 VMC
  장면에 선삭 좌표를 적용해 공구가 소재를 관통하는 것처럼 보였다. 선삭 전용
  척·holder·insert·toolpath를 분리하고 controller X 지름을 장면 반경 `X / 2`로
  변환했다.
- 외경 선삭을 지름 `80 mm`, 길이 `120 mm` 소재의 4개 종방향 패스와 안전
  복귀를 포함한 18단계 fixture로 교체했다. 회전 Stock이 선삭 presentation을
  자동 선택하며 실행 시작 후 소재 범위에 camera focus를 맞춘다.
- 3축 밀링에 표준 블록 `360 × 200 × 88 mm`, 소형 블록
  `280 × 160 × 72 mm`와 X축·Y축 왕복 절삭 방향을 추가했다. 설정은 결정론적
  G-code, toolpath guide, Worker/WASM 실행, Stock 교체와 M8 저장 프로젝트에
  같은 값으로 전달된다. 선삭·충돌 정지에서는 밀링 전용 설정을 비활성화한다.
- 전체 E2E에서 M8 저장 후 이전 run ID를 기준으로 다음 실행을 기다리던 테스트
  경합을 발견했다. 저장 직후 활성 run ID를 기준으로 수정하고 WebGPU 3회 반복과
  전체 순서를 다시 통과했다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| `pnpm verify` | 통과 — unit 139, contract 51, parity 63, dependency 위반 0, Cargo check, production build |
| `pnpm test:a11y` | 통과 — WebGPU·WebGL 2 2 passed, visual 중복 1 skipped |
| 탭·선삭·소재/방향 핵심 E2E | 통과 — WebGPU·WebGL 2 6 passed, visual 중복 3 skipped |
| WebGPU 소재/방향/저장 반복 | 통과 — 3/3 passed |
| `pnpm test:e2e` | 통과 — WebGPU·WebGL 2 63 passed, 조건부 visual 18 skipped, 실패 0 |
| production WASM | 793,536 bytes, SHA-256 `d788f5b38bc27cd0429f5500e63ad6523fc1b9dce07574c2983a78b444bd9fec` |

### 남은 위험과 M10 경계

- 공개 선삭 선택기는 현재 외경 선삭 대표 공정 하나다. 단면·테이퍼 fixture와
  드릴링을 준비→설정→실행→측정→판정의 정식 lesson으로 노출하는 작업은 M10 범위다.
- 밀링 소재는 두 개의 검증된 박스 preset이다. 임의 치수·재료·공구·절삭 조건과
  저장 후 UI control 재구성은 M10 sandbox project model에서 완성한다.
- 선삭 장면과 segment 끝점 단위 재생은 E2 교육용 표현이다. 실제 선반 기구학,
  서보 보간, 공구 보정 또는 산업용 검증과 동일하지 않다.

## M9 공개 릴리스 안정화 (2026-08-09)

### 원인과 수정

- GitHub Pages용 `apps/pages-demo/main.tsx`는 Vinext의 `app/layout.tsx`를
  통과하지 않아 `tokens.css`와 `primitives.css`가 공개 번들에서 누락됐다.
- Pages HTML이 두 생성 CSS를 명시적으로 로드하고, 권위 원본과
  `public/styles/` 복사본의 byte drift를 `check:pages-styles`로 차단한다.
- Pages build가 CSS·앱 chunk·전용 Worker·WASM 산출물을 모두 검증하고,
  CI가 실제 `/CNC-Render/` base path의 Chromium E2E를 실행한다.
- E2E는 2048×1009에서 계산된 토큰·버튼 크기·가로 overflow를 확인하고
  도움말, 코드·학습·장면 클릭과 Worker/WASM 절삭 완료·Stock revision을 검증한다.
- 제품·엔진 버전을 `0.9.0`으로 통일했다. 8개 JavaScript manifest, 5개
  Rust crate, Cargo lock, UI, Worker handshake, WASM core와 저장 엔진이
  공용 버전을 사용하며 schema/protocol version `1`은 독립 계약으로 유지한다.
- README는 실행 링크, 현재 기능, 사용법과 실제 제한만 남긴 사용자 문서로
  교체했다. 공개 UI의 M9/M10/M11 계획 표기도 제품 상태 문구로 교체했다.
- `main`만 장기·배포 브랜치로 두고 `codex/<scope>`를 PR 병합 뒤 삭제하는
  규칙을 `CONTRIBUTING.md`와 ADR 0012에 기록했다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| `pnpm check:versions` | 통과 — 제품·엔진·8 JS manifests·5 Rust crates 0.9.0 일치 |
| `pnpm test:contracts --filter m0` | 통과 — 1 file, 6 tests; README 공개 문서 계약 포함 |
| `pnpm verify` | 통과 — unit 135, contract 50, parity 63, 92 modules/204 dependencies 위반 0, Cargo locked check, production build |
| `pnpm test:pages` | 통과 — 실제 Pages base path, Chromium 1 test, 5.6 s |
| 2048×1009 시각 확인 | 통과 — 패널·버튼·3D 작업실 정상 비율, 가로 overflow 없음 |

Pages build는 156 modules를 만들었고 production WASM은 793,536 bytes,
SHA-256은 `d788f5b38bc27cd0429f5500e63ad6523fc1b9dce07574c2983a78b444bd9fec`다.

### 남은 위험

- 로컬 검증 시점에는 안정화 변경이 아직 공개 배포되지 않았다. 공개 URL은
  해당 변경의 병합과 Pages 배포가 끝날 때까지 이전 bundle을 제공한다.
- 로컬 검증 시점에는 이미 병합된 원격 작업 브랜치 7개가 남아 있어
  승인된 릴리스 작업에서 `main`을 제외하고 정리해야 한다.
- Pages CSS는 정적 엔트리 때문에 생성 복사본을 사용한다. CI의
  `check:pages-styles`를 우회하면 다시 drift할 수 있으므로 필수 gate로 유지한다.

## 재생 경과·가공 추정 시간 표시 분리 (2026-08-11)

### 원인과 수정

- 화면의 `52.260 s`는 재생이 실제로 소비한 시간이 아니라 G-code 이송 거리와
  feed rate로 계산한 결정론적 논리 가공 시간이었다. ADR 0009에 따라 재생 속도는
  화면 지연만 바꾸며 이 논리 시간을 바꾸지 않지만, UI가 이를 단순히 `시간`으로
  표시해 약 3초의 재생 경과와 같은 값처럼 오해하게 했다.
- 브라우저 adapter가 실행 시작부터 완료·충돌 정지·사용자 정지까지의 벽시계
  경과를 `performance.now()`로 별도 계측한다. 이 값은 UI·browser harness 전용이며
  Worker 메시지, WASM 결과, 저장 schema와 semantic hash에는 포함하지 않는다.
- Inspector와 결과 영역을 `재생 경과`와 `가공 추정`으로 분리했다. 전자는 실제
  표시 재생 시간을, 후자는 기존 `logicalTimeS`를 초 단위로 보여 준다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| TypeScript·변경 파일 ESLint | 통과 |
| `pnpm test:unit` | 통과 — 18 files, 136 tests |
| `pnpm test:contracts` | 통과 — 13 files, 51 tests |
| `pnpm test:parity` | 통과 — 8 files, 63 tests |
| 시간 분리·점진 절삭 E2E | 통과 — WebGPU·WebGL 2, 4/4 passed; 재생 경과 1.5–10 s, 가공 추정 50 s 초과 |
| `pnpm verify` | 통과 — 정책·버전·의존성·Cargo check·250 tests·production build |
| `pnpm build:pages`·`pnpm test:pages` | 통과 — `/CNC-Render/` 정적 경로, Chromium 1/1 |
| 전체 `pnpm test:e2e` | 미통과 — 두 연속 실행 모두 56 passed, 15 skipped, WebGL 2 장기 작업 성능 gate 1건 실패; 동일 테스트 단독 재실행 1/1 통과 |

### 남은 위험

- `재생 경과`는 브라우저 부하와 일시정지 시간을 포함하는 표시 telemetry다. 저장,
  결과 비교, 채점에는 결정론적인 `가공 추정(logicalTimeS)`만 사용해야 한다.
- 전체 E2E 연속 실행에서는 WebGL 2 프로젝트의 기존 성능 gate가 각각
  `maximumMainHandlerMs = 213.3 ms`, `longTasksOver50Ms = 2`로 간헐 실패했다.
  단독 실행은 통과했지만 전체 gate가 안정적으로 통과하기 전에는 이 작업을
  완전 완료로 기록하지 않는다. 성능 기준은 변경하거나 완화하지 않았다.
- PR #12는 CI run `31475757460` 통과 후 `main`에 병합됐고, main run
  `31476057436`의 Pages smoke와 배포가 merge SHA `3bf41dd4b11ae032f9f834e55588afb8b999c9d9`로 완료됐다.

## WebGL 2 전체 E2E 성능 게이트 안정화 (2026-08-12, 완료)

### 원인과 수정

- `SimulationCoordinator.maximumMainHandlerMs`가 첫 대표 재생 전 Worker handshake와
  초기화 처리 시간까지 누적해 실제 재생 성능 gate를 오염시켰다. 첫 대표 재생에서
  handler 계측 창을 명시적으로 시작하되 50 ms 기준은 변경하지 않았다.
- Long Task observer가 첫 재생 이후 계속 열린 채 테스트 assertion과 재생 사이 유휴
  작업까지 누적했다. 각 재생의 시작·종료 시각을 별도 창으로 기록하고 entry 시작
  시각이 실제 재생 창 안에 있을 때만 집계하며, `takeRecords()`로 지연 전달도 비운다.
- E2E는 재생 창 밖에서 의도적으로 60 ms 작업 두 개를 만들고 누적치가 변하지 않는지
  검증한다. 이 검사는 기준 완화가 아니라 gate가 대표 재생 비용만 측정하는지 확인한다.
- 렌더 업데이트를 별도 프레임 큐로 옮기거나 Worker 처리를 microtask로 미루는 실험은
  현재 머신의 Long Task 수를 줄이지 못해 최종 변경에서 제외했다. 렌더·파서·UI 샘플링
  순서와 결정론 계약은 기존 경로를 유지한다.

### 검증

| Gate | Result |
|---|---|
| `git diff --check` | 통과 |
| TypeScript·변경 파일 ESLint | 통과 |
| `pnpm test:unit --filter simulation-coordinator` | 통과 — 1 file, 2 tests |
| 고정 Node 24.18.0 `pnpm verify` | 통과 — unit 136, contract 51, parity 63, dependency 위반 0, Cargo check, production build |
| WebGL 2 결정론 성능 시나리오 10회 | 통과 — 10/10, 1.0 min; 50 ms handler·Long Task 기준 유지 |
| WebGL 2 전체 프로젝트 | 통과 — 23 passed, 조건부 1 skipped, 43.5 s |
| 전체 `pnpm test:e2e` 순서 | 통과 — WebGPU·WebGL 2 57 passed, 조건부 visual 15 skipped, 1.9 min |
| 외부 Vite 우선순위 복원 | 통과 — 각 검증 종료 후 `Idle`에서 원래 `Normal`로 복원 |

### 남은 위험

- Playwright는 SwiftShader software renderer를 사용하므로 실제 GPU 기기별 frame-time은
  별도 benchmark 범위다. 이 gate는 Worker handler와 Long Task 회귀를 검출한다.
- 동일 머신의 별도 고CPU 작업과 동시에 실행하면 scheduler 경합이 실제 Long Task를
  만들 수 있다. 완료 검증은 승인된 외부 Vite 우선순위 조정 조건에서 수행했고, 테스트
  임계값·retry·fixture 복잡도는 변경하지 않았다.

## 3축 밀링 재생·절삭 표시 결함 수정 (2026-08-10)

### 원인과 수정

- 공개판 대표 밀링 fixture는 `40 × 30 × 10 mm`, 중심 `Z = 0 mm`와
  공구 경로 `Z = 8 → 4 mm`를 사용했지만, VMC 장면의 소재는
  `360 × 200 × 88 mm`, 중심 `Z = 298 mm`(상면 `Z = 342 mm`)였다.
  Worker 좌표가 renderer 장면에 직접 적용되어 공구가 소재를 가공하는 대신
  테이블 방향으로 관통해 보였다.
- 기존 5단계 재생은 공개판에서 약 `0.879 s` 만에 끝나고 절삭 frame이 사실상
  한 번만 관측됐다. 대표 공정을 안전 높이 `Z = 370 mm`, 절삭 높이
  `Z = 338 mm`, 40 mm 간격의 5개 왕복 패스로 교체하고 표시 속도를
  `0.1×`로 조정했다.
- 수정된 대표 공정은 12단계, Stock revision 10회, 약 `3.03 s` 동안 실행되며
  제거 체적과 dirty Stock patch가 단계별로 증가한다. 마지막 공구 위치는
  `X = 170 mm, Y = 80 mm, Z = 370 mm`로 안전 복귀한다.
- 동적 Stock이 시작되면 교육용 정적 소재와 outline을 함께 숨기도록 scene
  계층을 고쳤다. 부분 Stock patch 생성 비용은 축 정렬 면의 고정 normal을
  직접 기록해 불필요한 전체 normal·bounds 재계산을 제거했다.

### 검증

| Gate | Result |
|---|---|
| `pnpm test:unit` | 통과 — 18 files, 136 tests; Stock normal·정적 outline 전환 포함 |
| `pnpm test:contracts` | 통과 — 13 files, 51 tests; VMC fixture 좌표·공구·복귀 계약 포함 |
| `pnpm test:parity` | 통과 — 8 files, 63 tests; production WASM 793,536 bytes |
| 결정론 반복 E2E | 통과 — WebGPU·WebGL 2, 6/6 passed |
| 전체 `pnpm test:e2e` | 통과 — 57 passed, 조건부 visual 15 skipped, 실패 0 |
| TypeScript·ESLint·dependency-cruiser | 통과 — 92 modules, 204 dependencies, 위반 0 |
| 문서 용어·툴체인·금지 UI·Cargo check | 통과 |
| production build·Pages build | 통과 — `/CNC-Render/` Worker·WASM 경로 검증 |
| Pages base-path E2E | 통과 — GitHub Pages Chromium 1/1, styled UI·Worker·WASM 실행 |

### 남은 위험

- 현재 교육용 재생은 G-code 구간 끝점 단위로 공구 위치와 Stock patch를 표시한다.
  서보 주기 보간이나 실제 이송 시간 재현은 아니며 E2 등급 preview다.
- 수정은 PR #11로 `main`에 병합되었으며 GitHub Pages에 재배포됐다.

## M9 validation run

2026-08-09에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`, Playwright `1.55.0`과 `wasm32-unknown-unknown` target으로
실행했다. production WASM은 793,271 bytes이며 SHA-256은
`75aea4d133cceedd1514dd74c493989e991ce515556bcac658ba9e868fdb3be8`이다.

| Gate | Result |
|---|---|
| `pnpm check:tokens` | 통과 — 단일 JSON source와 생성 CSS/TypeScript 44 tokens 일치 |
| `pnpm storybook:build` | 통과 — Button·Dialog·Tabs·UnitInput·ParameterRow·DataTable catalog |
| `pnpm test:a11y` | 통과 — WebGPU·WebGL 2 axe Critical/Serious 0, 2 passed; visual 중복 1건 의도적 skip |
| `pnpm test:visual` | 통과 — WebGPU·WebGL 2·visual 3 projects, M9 기준 canvas 923×883 px |
| `pnpm test:e2e -- --grep="M9 workspace UI"` | 통과 — WebGPU·WebGL 2에서 8 passed, visual 중복 4건 의도적 skip |
| `pnpm bench --filter ui-budget` | 통과 — 10/20Hz 상한·대표 UI 처리 평균 4ms·DOM source 예산 3 tests |
| `pnpm check:bundle` | 통과 — CSS gzip 6,207/81,920 B, WOFF2 0/409,600 B, JS gzip report 436,361 B |
| `pnpm verify` | 통과 — unit 135, contract 49, parity 63, 89 modules/193 dependencies 경계 위반 0, Cargo check, forbidden UI, production build |
| `pnpm test:e2e` | 통과 — 전체 57 passed; 장시간 soak 3건과 M7·M8·M9 visual 중복 12건 의도적 skip |

## Delivered M9 design system, workspace, and accessibility

- 토큰·프리미티브
  - `design/tokens/cnc-render.tokens.json`에서 light-only 색상·간격·타이포그래피·반경을
    CSS custom properties와 TypeScript 상수로 생성하고 drift를 계약으로 차단
  - 공용 Button, native Dialog, Tabs, UnitInput, ParameterRow, DataTable과
    Storybook 상태 catalog 제공
  - 본문·핵심 수치 12px 이상, tabular figures·단위 표기, 시스템 dark 설정에서도
    `color-scheme: light`와 동일 팔레트 유지
- 실제 Workspace 상호작용
  - Global Command Bar의 실행·일시정지·계속·정지·저장과 native 도움말 modal 연결
  - 장면·코드·학습·결과 Activity 영역과 G-code·Diagnostics Bottom Dock을 클릭·키보드
    Arrow/Home/End로 탐색 가능
  - Worker/WASM full/patch를 Stock buffer에 직접 적용하고 최대 20Hz 축 요약으로
    holder/cutter를 이동해 소재 제거와 공구 움직임을 점진적으로 표시
  - 실행 상태를 별도 command UI subtree로 격리해 M7 실행 중 MachineWorkspace React
    commit 0회 불변식 유지
- 반응형·접근성·성능
  - 9개 목표 해상도, 1440×900 콘텐츠의 3D 영역 60% 이상, 720px 미만 패널 접기,
    가로 overflow 없음과 200% 확대 핵심 기능 보존을 Playwright로 검증
  - 도움말 focus return, native control 의미 구조, 텍스트·아이콘·진단·G-code 줄·3D marker를
    함께 쓰는 충돌 표현과 forced-colors 대응
  - 보이는 DOM 2,000개, HUD 10~20Hz, CSS·font 번들, 금지 효과를 자동 gate로 고정
  - M7 Long Task 관측은 첫 대표 공정 실행 직전 시작해 이후 실행에 누적하며 초기
    UI/WebGL 준비 비용과 실제 시뮬레이션 비용을 분리

## M9 limitations and remaining risks

- M9 학습 영역은 안내와 대표 절삭 실행 preview다. 준비→설정→실행→측정→판정,
  결정론적 scoring, 힌트와 밀링·선삭·드릴링 정식 lesson은 M10 범위다.
- 코드 영역은 현재 G-code 탐색용 read-only preview다. Monaco lazy load, 편집,
  줄 진단·현재 줄·breakpoint, 측정·목표 비교·heatmap·report export는 M11 범위다.
- 상단 수동 저장은 실제 M8 persistence에 연결됐다. M8 autosave controller는
  계약 검증됐지만 M9에는 durable project model을 바꾸는 editor가 없으므로 실제 edit
  event 연결은 M10 sandbox 또는 M11 G-code editor의 첫 durable mutation과 함께 한다.
- WebGL 2는 WebGPU와 같은 명령·Worker/WASM 결과 계약을 사용하지만 표면 preview는
  기존 CPU/WASM mesh와 1K surface 한계를 상태 문구로 계속 노출한다.
- Storybook의 axe·docs bundle은 개발 catalog 전용이며 production 초기 JS에 포함되지
  않는다. production은 system font stack을 사용해 초기 WOFF2 전송량이 0 B다.

## GitHub Pages 배포 복구 (2026-08-09)

- 상태: 공개 배포·검증 완료 — https://jtech-co.github.io/CNC-Render/
- 원인: 저장소 Pages가 build_type legacy, main:/ 소스로 설정되어 Jekyll이
  애플리케이션 대신 루트 README.md를 진입 문서로 렌더링했다.
- 구현:
  - 일반 Vinext/Sites 빌드와 분리된 apps/pages-demo 순수 Vite 정적 엔트리
  - /CNC-Render/ base URL을 갖는 앱 JS·CSS·Worker·WASM·OG 자산
  - 전체 CI 통과 후 actions/upload-pages-artifact와 actions/deploy-pages로만
    main을 배포하는 Pages job
  - Worker가 Vite BASE_URL을 사용해 프로젝트 하위 경로의 WASM을 로드하는 계약
- 검증:
  - Node 24 런타임에서 Pages build 통과 — 151 modules, 정적 index.html,
    simulation Worker, 793,271-byte WASM, SHA-256
    75aea4d133cceedd1514dd74c493989e991ce515556bcac658ba9e868fdb3be8
  - 기존 Vinext/Sites production build 통과
  - TypeScript, 변경 파일 ESLint, dependency-cruiser 통과 —
    80 modules/178 dependencies, 위반 0
  - simulation-coordinator unit 2 tests 통과
  - /CNC-Render/ 로컬 HTTP smoke 통과 — index, app JS, Worker, WASM,
    OG image 모두 200; WASM MIME application/wasm
- 공개 배포 검증:
  - PR #7 merge commit c6ec688, Pages build_type workflow 전환 완료
  - main CI run 31295252832에서 고정 Node 24.18.0 전체 verify, Pages build,
    artifact upload, deploy-pages 통과
  - 공개 HTTP smoke 통과 — index, app JS, simulation Worker, 793,527-byte WASM,
    OG image 모두 200; WASM MIME application/wasm
  - Chromium 첫 렌더 통과 — 앱 셸·command bar·canvas 1개 확인,
    page error와 console error 0
- 남은 위험:
  - GitHub Actions가 Node 20 기반 일부 공식 action을 Node 24로 강제 실행했다는
    deprecation 경고를 표시했다. 배포에는 영향이 없었으며 후속 major action
    릴리스가 나오면 갱신한다.

## M8 validation run

2026-08-09에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`, Playwright `1.55.0`과 `wasm32-unknown-unknown` target으로
실행했다. production WASM은 793,271 bytes이며 SHA-256은
`75aea4d133cceedd1514dd74c493989e991ce515556bcac658ba9e868fdb3be8`이다.

| Gate | Result |
|---|---|
| `pnpm test:unit --filter persistence` | 통과 — 3 files, 11 tests, 결정론적 ZIP·v0→v1 migration·원자적 generation·중단 복구/격리·30초 autosave |
| `pnpm test:contracts --filter project-container` | 통과 — 1 file, 4 tests, 100 MiB·strict manifest·2~5초 checkpoint·redacted telemetry/cloud stub |
| `pnpm test:parity --filter persisted-project` | 통과 — 1 file, 2 tests, 실제 WASM milling·turning 전체 Stock checkpoint와 동일 step full replay byte parity |
| `pnpm test:e2e --grep "save-load\|checkpoint\|migration\|corruption"` | 통과 — WebGPU·WebGL 2에서 8 passed, visual 중복 4건 의도적 skip |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 전체, `cnc-render-wasm` native 4 tests 포함 |
| `pnpm verify` | 통과 — unit 134, contract 49, parity 63, 71 modules/158 dependencies 경계 위반 0, Cargo check, forbidden UI, production build |
| `pnpm test:e2e` | 통과 — 전체 49 passed, 장시간 soak 3건·M7 visual 중복 4건·M8 visual 중복 4건 의도적 skip |
| `pnpm test:visual --grep "machine-scene"` | 통과 — WebGPU·WebGL 2·visual 3 projects |

## Delivered M8 persistence and checkpoints

- `.cncrender` 공개 컨테이너
  - 고정 timestamp·UTF-8 이름·STORE 방식의 결정론적 ZIP writer와 STORE/DEFLATE importer
  - `schemaVersion`, `engineVersion`, `unitSystem`, project semantic hash,
    authoritative project hash와 manifest checksum을 포함하는 strict manifest
  - ZIP magic·CRC-32·SHA-256·경로 순회·정규화 충돌·중복 entry·symlink·암호화·다중 disk,
    4,096 entries·JSON 깊이 64·압축률 100:1·기본 100 MiB 상한 방어
  - schema v0 원본 byte를 immutable하게 보존하면서 순수 registry로 v1을 생성하는 migration
- IndexedDB metadata와 OPFS generation
  - IndexedDB에 active generation pointer, component hash, checkpoint index와
    `staging|ready|quarantined` metadata 저장
  - OPFS에 generation별 immutable project·G-code·Stock/checkpoint chunk와 마지막
    `generation.json` commit marker 저장
  - 모든 길이·SHA-256과 IndexedDB/OPFS metadata 일치를 확인한 뒤 하나의 IndexedDB
    transaction으로 active pointer 전환
  - 중단된 partial save는 정상 load에서 제외하고, 완전한 staging은 승격하며 불완전·손상
    staging은 안정된 diagnostic code로 격리
- WASM checkpoint·autosave
  - Rust/WASM snapshot이 milling top-Z 전체 surface 또는 turning inner/outer radius 전체
    profile을 explicit binary layout으로 반환
  - little-endian float payload, strict metadata, payload SHA-256과 state·Stock hash를 가진
    checkpoint codec 및 3초 기본/2~5초 계약·operation/terminal boundary
  - 저장 checkpoint를 renderer에 직접 복원한 reverse scrub 결과를 동일 step 전체 WASM
    replay와 milling·turning 모두 byte 단위 비교
  - 일반 변경은 30초 window로 합치고 중요 변경은 즉시 flush하며 동시 save를 직렬화하는
    autosave controller
- browser·privacy·cloud 경계
  - 실제 Chromium restart에서 machine, tool, operation, G-code, Stock, diagnostics,
    measurements와 project의 8개 semantic hash가 동일함을 OPFS·IndexedDB로 검증
  - WebGPU와 WebGL 2 모두 동일 persistence·checkpoint 기능을 제공하고 React render loop를
    추가하지 않음
  - storage telemetry 계약은 source content를 구조적으로 허용하지 않으며 cloud port는
    사용자 동의 전 `enabled: false`, D1/R2 `null`, project byte 미포함으로 고정
  - OPFS/IndexedDB 미지원 환경은 memory fallback으로 위장하지 않고 persistence만
    `unavailable` diagnostic으로 노출

## M8 limitations and remaining risks

- M8 checkpoint는 결정론적 reverse scrub용 full renderer Stock과 상태 hash를 복원한다.
  WASM 내부 절삭 engine session 자체를 역직렬화해 checkpoint 이후부터 forward 실행을
  재개하는 기능은 아직 없다.
- deterministic export는 재현성을 위해 STORE를 사용하므로 대형 프로젝트의 압축 효율이
  낮다. DEFLATE import는 브라우저 `DecompressionStream("deflate-raw")` 지원이 필요하다.
- 기본 100 MiB·entry·깊이·압축률 상한과 손상 방어는 검증했지만 실제 quota 부족,
  100 MiB 근접 파일과 장시간 다중 checkpoint의 memory plateau는 별도 soak가 필요하다.
- migration registry는 현재 대표 v0→v1 fixture만 제공한다. 이후 schema version마다 원본
  보존 golden fixture와 순차 migration을 추가해야 한다.
- autosave controller의 실제 편집 event 연결은 read-only M9 preview가 아니라 durable
  project mutation을 도입하는 M10 sandbox 또는 M11 G-code editor에서 수행한다. M9의
  상단 수동 저장은 실제 persistence 경로에 연결됐다.
- cloud persistence는 사용자 동의·계정·권한·충돌 병합 정책이 정의될 때까지 의도적으로
  비활성이다. 현재 결과는 E2 교육용 근사 검증이며 산업용 CAM 검증과 동일하지 않다.

## M7 validation run

2026-08-09에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`, Playwright `1.55.0`과 `wasm32-unknown-unknown` target으로
실행했다. production WASM은 793,311 bytes이며 public·client bundle 사본의
SHA-256은 `a48ee9b2ecd85e0b8e803aeb4bcc9d823b103096b9a372d9269ca9f11dac1d13`으로
동일하다.

| Gate | Result |
|---|---|
| `pnpm test:contracts --filter worker-protocol` | 통과 — 1 file, 3 tests, strict run·배속·Transferable 소유권·상호 배타 terminal 상태 |
| `pnpm test:parity --filter replay` | 통과 — 1 file, 4 tests, 실제 WASM 밀링·선반 realtime/fast-forward hash parity·pause freeze·collision-stop |
| `pnpm test:unit --filter simulation-coordinator` | 통과 — 1 file, 2 tests, Worker generation·runId·sequence stale 차단과 10/20 Hz UI sampling |
| `pnpm test:e2e --grep "playback\|pause\|cancel\|collision-stop"` | 통과 — 11 passed, M7 WebGPU·WebGL 2 lifecycle 8건과 M4 회귀 3건; visual 중복 4건 의도적 skip |
| `pnpm bench --filter coordinator` | 통과 — 2,000 validated Worker updates, 개별 main-thread handler 50 ms 미만·전체 3초 예산 |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 전체, `cnc-render-wasm` native 3 tests 포함 |
| `pnpm lint` / `pnpm typecheck` | 통과 — 59 modules/119 dependencies, 경계 위반 0, 문서·도구 체인 일치 |
| `pnpm verify` | 통과 — unit 123, contract 45, parity 61, Cargo check, forbidden UI, WASM production build |
| `pnpm test:e2e` | 통과 — 전체 41 passed, 장시간 soak 3건과 M7 visual 중복 4건 의도적 skip |
| `pnpm test:visual --grep "machine-scene"` | 통과 — WebGPU·WebGL 2·visual 3 projects |

## Delivered M7 Worker/WASM pipeline

- Rust/WASM 실행 core
  - `cnc-render-wasm` crate가 M2 Rust parser·Toolpath IR과 M4~M6 운동학,
    충돌, 밀링·선반 재료 제거를 한 session으로 실행
  - versioned bare C ABI로 input resize, initialize, step, snapshot, cancel과
    JSON·binary output pointer/length 제공
  - 밀링 top-Z와 선반 내·외경 dirty cell만 별도 binary layout으로 인코딩하며
    16 MiB 입력·128 MiB binary 출력 상한 적용
  - collision-stop과 정상 completed를 상호 배타 상태로 반환하고 두 terminal 모두
    최종 semantic hash 보존
- 전용 Worker와 coordinator lifecycle
  - strict Zod command/event envelope, 별도 `ArrayBuffer`와 receiver-owned
    Transferable slice descriptor
  - Worker generation, `runId`, 단조 event sequence의 세 stale-event 방벽
  - `0.1x..100x`는 표시 지연만 변경하고 논리 step·Stock·최종 hash에는 영향 없음
  - pause snapshot은 시간·Stock·축·진단을 고정하며 cancel·dispose·restart가
    timer와 이전 run을 무효화
  - renderer update는 즉시 전달하고 일반 수치 UI는 최대 10 Hz, 축 UI는 최대
    20 Hz로 독립 sampling
- renderer·browser·build 연결
  - React/Zustand를 거치지 않는 adapter가 밀링·선반 full/dirty patch와 충돌 marker를
    `WorkcellRenderer`에 직접 반영
  - WebGPU와 WebGL 2가 같은 WASM surface 계약과 완료 frame을 소비하고 실행 중
    React commit을 만들지 않음
  - production build가 고정 Rust target으로 WASM을 생성해
    `dist/client/wasm/cnc_render_wasm.wasm`에 게시하며 E2E gateway도 같은 경로를 제공
  - browser harness가 replay parity, pause freeze, cancel/restart, collision-stop,
    render frame과 Long Task telemetry를 검증

## M7 limitations and remaining risks

- 현재 Worker는 한 번에 하나의 WASM session만 소유한다. 동시 비교 실행,
  multi-worker scheduling과 session pool은 지원하지 않는다.
- M7 browser fixture는 단일 공구의 작은 대표 직선 밀링·선반 공정이다. 임의 공구
  교환, macro/subprogram, controller look-ahead, servo 오차, 다중 spindle·turret과
  대형 장시간 프로그램은 후속 범위다.
- WASM 메모리에서 Worker로 dirty binary를 한 번 복사한 뒤 Transferable로 넘긴다.
  `SharedArrayBuffer`·cross-origin isolation 기반 zero-copy ring buffer는 사용하지 않는다.
- 50 ms Long Task와 coordinator 처리 예산은 대표 fixture와 2,000-event 합성 부하로
  검증했다. 대형 CAD·Stock 및 수 시간 경로의 메모리 plateau·복구는 M8 이후 별도
  soak와 checkpoint 검증이 필요하다.
- Vinext `0.0.50`의 Windows 정적 자산 경로 제약 때문에 build wrapper와 E2E gateway가
  `/wasm/*`를 명시적으로 게시한다. upstream 동작이 바뀌면 workaround 제거 여부를
  재검증해야 한다.
- 결과는 E2 교육용 근사 검증이며 산업용 CAM verification, 공작기계 안전 인증,
  실제 controller 결과와 동일하지 않다.

## M6 validation run

2026-08-01에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`, Playwright `1.55.0`으로 실행했다. Golden gate는 facing, OD,
taper, groove, parting, drilling, boring을 세 preset에서 검증했다.

| Gate | Result |
|---|---|
| `pnpm test:unit --filter turning` | 통과 — 3 files, 14 tests, 7개 대표 공정·반경 오차·단조 제거·충돌·저장/복원·renderer dirty range |
| `pnpm test:unit --filter spindle-mode` | 통과 — 1 file, 3 tests, G96·G97와 machine/tool 최대 RPM clamp |
| `pnpm test:parity --filter lathe-profile` | 통과 — 1 file, 2 tests, 7 fixtures × 3 presets TypeScript↔Rust profile·hash·측정 parity와 Rust 100회 |
| `pnpm test:e2e --grep "facing\|od-turning\|taper"` | 통과 — WebGPU·WebGL 2·visual 3 projects × 3 fixtures, 9 tests |
| `pnpm test:e2e` | 통과 — 전체 33 tests, 장시간 soak 3 tests opt-in skip |
| `pnpm test:visual --grep "machine-scene"` | 통과 — WebGPU·WebGL 2·visual 3 projects |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 전체, simulation-core M6 포함 6 tests |
| `pnpm lint` | 통과 — ESLint, 53 modules/105 dependencies, 경계 위반 0, 문서·도구 체인 일치 |
| `pnpm verify` | 통과 — unit 121, contract 42, parity 57, Cargo check, forbidden UI, production build |

## Delivered M6 lathe material removal

- 반경 필드·절삭 core
  - canonical Z축 동축 원통과 축방향 셀별 `outerRadiusLayers`·`innerRadiusLayers`
    정수 반경 필드
  - Preview 2×·Balanced 1×·Precision 0.5× 해상도와 셀 크기 이하 OD 반경 오차
  - 외경은 감소하고 내경은 증가하는 단조 제거와
    `0 <= inner <= outer <= initial` 불변식
  - facing, OD, taper, groove, parting, drilling, boring 대표 프로파일
  - 같은 또는 덜 공격적인 재절삭에서 Stock 성장·부호 반전·불필요 revision 없음
- 주축·충돌·결정론
  - G96 `1000 × Vc / (π × D)`와 G97 지령 RPM, machine/tool 최대 RPM 중
    작은 값으로 clamp하고 요청값·유효값을 함께 반환
  - 공구 끝의 회전축 반대편 통과와 설정된 척 파지 영역 진입을 fail-closed 감지
  - version·seed·preset·해상도·축 경계·정수 layer 배열의 canonical SHA-256 hash
  - snapshot에 revision과 내·외경 layer를 저장하며 복원 후 hash·측정 동일
  - TypeScript reference와 Rust core의 7 fixtures × 3 presets parity
- dirty surface·browser integration
  - 축방향 셀 × 고정 radial segment의 BufferGeometry를 한 번 할당하고 변경 셀만 재작성
  - WebGPU와 WebGL 2가 같은 CPU profile patch를 소비하며 backend별 update range 기록
  - 대형 반경 배열은 React/Zustand가 아닌 simulation core와 renderer 메모리에 유지
  - facing·OD turning·taper fixture에서 renderer frame 완료와 React commit 분리

## M6 limitations and remaining risks

- M6는 Z축 동축 원통과 회전 대칭 형상, 이상화된 인서트·드릴만 지원한다.
  나사산, 편심 가공, 임의 spline 프로파일, 공구 코너의 실제 swept volume,
  척 jaw 형상과 절단 후 분리된 강체 동역학은 후속 범위다.
- 브라우저는 M7 Worker/WASM coordinator 전까지 TypeScript reference core를
  사용한다. Rust parity CLI는 최종 profile·hash·측정을 검증하지만 현재
  renderer의 실시간 실행 주체는 아니다.
- 회전체 surface는 셀별 독립 geometry와 고정 radial segment를 사용한다.
  dirty cell은 부분 갱신하지만 인접 셀을 잇는 매끄러운 법선·공유 topology와
  compute 기반 표면 재구성은 아직 제공하지 않는다.
- browser fixture는 결정론적 교육용 facing·OD·taper 경로다. 임의 사용자
  G-code playback, 공구 교환, 절단 부품 분리 lifecycle 연결은 M7 이후 범위다.
- 결과는 E2 교육용 근사 검증이며 산업용 CAM verification, 공작기계 안전 인증,
  실제 controller 결과와 동일하지 않다.

## M5 validation run

2026-08-01에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`, Playwright `1.55.0`으로 실행했다. Golden gate는 face, slot,
pocket, outer contour의 해석 부피를 세 preset에서 각각 검증했다.

| Gate | Result |
|---|---|
| `pnpm test:unit --filter material-removal-milling` | 통과 — 2 files, 24 tests, Golden 부피·비접촉 0·100회 hash·측정·dirty range |
| `pnpm test:parity --filter stock-hash` | 통과 — 1 file, 2 tests, 4 fixtures × 3 presets TypeScript↔Rust hash·부피·브릭 parity와 Rust 100회 |
| `pnpm bench --filter milling-golden` | 통과 — 1 file, 2 tests, 12 Golden 실행과 18,000-step 논리적 5분/60 Hz 절삭의 메모리 plateau·5초 CPU 예산 |
| `pnpm test:e2e --grep "face-milling\|slot\|pocket"` | 통과 — WebGPU·WebGL 2·visual 3 projects × 3 fixtures, 9 tests |
| `pnpm test:e2e` | 통과 — 기존 viewport·collision 포함 24 tests, 장시간 soak 3 tests opt-in skip |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 전체, simulation-core M5 포함 4 tests |
| `pnpm lint` | 통과 — ESLint, 49 modules/93 dependencies, 경계 위반 0, 문서·도구 체인 일치 |
| `pnpm verify` | 통과 — unit 107, contract 42, parity 55, Cargo check, forbidden UI, production build |

## Delivered M5 milling material removal

- Stock·swept-volume core
  - M1 `Stock`·`ToolAssembly` API를 소비하는 axis-aligned box와 flat-end mill
  - canonical mm와 Preview 2×·Balanced 1×·Precision 0.5× 해상도
  - 16×16 희소 브릭, 미할당 브릭은 손상되지 않은 원재료, 덱셀별 정수 깊이 layer
  - XY capsule의 유효 매개변수 구간에서 최저 cutter-tip Z를 구하는 선형 swept volume
  - cutter만 재료를 제거하고 cutting length·메모리 cap·Uint32 grid 상한을 fail-closed 검증
  - 성공한 동일 sweep을 최대 1,024개까지 bounded cache하여 단조 제거의 반복 무변경 경로를 O(1) 처리
- 정확도·결정론·측정
  - face, slot, stadium pocket, closed rectangular outer contour 해석 부피 fixture
  - 상대 부피 오차 상한 Preview 5%, Balanced 2%, Precision 1%
  - 비접촉 이동의 정확한 0 부피·0 브릭·0 patch
  - seed·preset·해상도·경계·grid·정렬된 브릭 깊이로 canonical SHA-256 Stock hash
  - TypeScript와 Rust의 4 fixtures × 3 presets hash·부피·할당 상태 일치
  - 거리·깊이·벽 두께 결과와 representation resolution 동시 반환
- dirty surface·browser integration
  - 초기 surface snapshot 1회 뒤 변경 덱셀만 `Uint32Array` index와
    `Float32Array` 높이 patch로 추출
  - renderer가 하나의 사전 할당 BufferGeometry를 유지하고 연속 vertex range만 갱신
  - 같은 frame 전 들어온 update range를 누적하고 render 완료 뒤 해제
  - WebGPU는 GPU 부분 buffer update, WebGL 2는 CPU/WASM 부분 메시 update로 차이 공개
  - engine과 대형 배열은 React state/Zustand가 아닌 simulation ref와 renderer 메모리에 유지
  - face-milling·slot·pocket browser fixture의 Stock patch가 그려진 frame과 React commit 분리

## M5 limitations and remaining risks

- 표현은 axis-aligned box Stock, flat-end mill, 수직 3축, 언더컷 없는 단일
  Z solid interval만 지원한다. cylinder Stock, ball/bull tool, 다중 interval,
  X/Y dexel과 local SDF는 후속 범위다.
- 브라우저는 M7 Worker/WASM coordinator 전까지 TypeScript reference core를
  사용한다. Rust parity CLI는 같은 최종 Stock 상태를 검증하지만 현재 renderer의
  실시간 실행 주체는 아니다.
- M5 surface는 변경 덱셀별 독립 column geometry다. 전체 remesh는 하지 않지만
  marching-cubes/dual-contouring 기반의 매끄러운 국부 표면 추출은 후속 범위다.
- 5분 gate는 18,000 simulation step을 실행하는 논리적 soak다. 실제 wall-clock
  5분 browser/GPU 장시간 절삭과 다양한 고유 toolpath의 cache 압력은 M7 통합 뒤
  별도 장시간 gate로 다시 검증해야 한다.
- browser fixture는 결정론적 교육용 face·slot·pocket 경로다. 임의 사용자
  G-code playback과 공구 교환 lifecycle 연결은 M7 이후 범위다.
- 결과는 E2 교육용 근사 검증이며 산업용 CAM verification, 공작기계 안전 인증,
  실제 controller 결과와 동일하지 않다.

## M4 validation run

2026-08-01에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`로 실행했다. browser gate는 Playwright `1.55.0`의 WebGPU,
WebGL 2와 visual 세 프로젝트에서 같은 CPU collision event를 검증했다.

| Gate | Result |
|---|---|
| `pnpm test:unit --filter kinematics-3axis` | 통과 — 1 file, 10 tests |
| `pnpm test:unit --filter collision` | 통과 — 2 files, 14 tests |
| `pnpm test:parity --filter poses` | 통과 — 1 file, 2 tests, TypeScript↔Rust 100회·별도 프로세스 parity |
| `pnpm test:e2e --grep "collision-stop"` | 통과 — WebGPU·WebGL 2·visual 3 projects, next-frame stop·3D 위치·G-code 3행 연결 |
| `pnpm bench --filter collision-fixtures` | 통과 — 121 proxies × 2,000 frames, total 1,500 ms·평균 0.75 ms/frame budget |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 125 tests, M4 simulation core 2 tests |
| `pnpm lint` | 통과 — ESLint, 45 modules/81 dependencies, violation 0, 문서·도구체인 일치 |
| `pnpm verify` | 통과 — unit 83, contract 42, parity 53, Cargo check, forbidden UI, production build |

## Delivered M4 kinematics and collision verification

- 3축 VMC 운동학
  - 하나의 분기 없는 linear-axis kinematic tree와 직교 unit direction 검증
  - `TCP = tcpAtHome + Σ direction × (position - home)`의 canonical mm FK
  - home/min/max inclusive travel, rapid/feed velocity와 midpoint acceleration guard
  - 최대 axis step 기반 결정론적 보간과 1,000,000 step 자원 상한
  - TypeScript browser reference와 `cnc-render-simulation-core` Rust `f64` parity
- 충돌 core
  - renderer visual object와 독립된 UUID collision proxy·group·양방향 mask
  - Sweep and Prune/AABB broad phase
  - sphere-sphere, sphere-box, box-box analytic narrow phase
  - endpoint 사이 rapid 충돌을 찾는 bounded translation interpolation
  - malformed proxy·frame·run ID·event에서 빈 결과 대신 `CollisionInputError`
- event와 정지 연결
  - M1 `simulation.collision`의 time, object pair, world mm position,
    severity, penetration과 source line 보존
  - object ID 기준 안정 정렬, contact-enter 발행과 동시 contact 후 frame stop
  - 3D collision marker를 scene에 적용한 renderer frame 완료 후에만 UI `stopped`
  - viewport 정지 문구, semantic object, mm 위치, diagnostics count와 G-code 3행 연결
  - DOM ref 기반 telemetry로 collision frame과 React commit 분리
- 검증 자산
  - VMC home/min/max/representative-cut Golden Pose
  - safe 0-event fixture와 cutter·holder·chuck·vise impact fixture
  - rapid tunneling, group mask, 세 analytic pair, fail-closed, 100회 결정론 테스트
  - browser collision-stop fixture와 121-proxy CPU benchmark

## M4 limitations and remaining risks

- 운동학은 정확히 세 개의 직교 linear axis를 가진 VMC만 지원한다. rotary axis,
  branch, 3+2축과 동시 5축은 근사하지 않고 거부하며 M13 범위로 남긴다.
- collision proxy는 sphere와 axis-aligned box다. triangle mesh, convex hull,
  capsule/cylinder와 임의 방향 box narrow phase는 아직 지원하지 않는다.
- rapid 검사는 bounded discrete interpolation이다. 분석적 continuous time of
  impact나 controller look-ahead·jerk·servo following error·실제 정지 거리를
  보증하지 않는다.
- browser는 TypeScript reference core를 사용한다. Rust core의 Worker/WASM
  coordinator 연결과 실제 Toolpath playback lifecycle은 M7 범위다.
- 현재 작업실 버튼은 source-mapped M4 교육 fixture를 실행한다. 임의 사용자
  G-code를 실제 machine state와 연결하는 UI 실행 경로는 M7 이후 범위다.
- 결과는 E2 교육용 단순 형상 검증이며 산업용 CAM verification, 기계 안전
  인증 또는 실제 controller 결과와 동일하지 않다.

## M3 validation run

2026-07-29에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`으로 실행했다.
WebGPU와 WebGL 2 E2E는 Chromium `140.0.7339.16`, Playwright `1.55.0`을
사용했다.

| Gate | Result |
|---|---|
| `pnpm lint` | 통과 — ESLint, 41 modules/74 dependencies, violation 0, 문서·도구체인 일치 |
| `pnpm typecheck` | 통과 |
| `pnpm test:unit --filter renderer` | 통과 — 1 file, 7 tests |
| `pnpm test:unit` | 통과 — 5 files, 59 tests |
| `pnpm test:contracts` | 통과 — 11 files, 42 tests |
| `pnpm test:parity` | 통과 — 3 files, 51 tests |
| `pnpm test:e2e --project=chromium-webgpu --grep "viewport"` | 통과 — 4 passed, full soak 1 skipped |
| `pnpm test:e2e --project=chromium-webgl2 --grep "viewport"` | 통과 — 4 passed, full soak 1 skipped |
| `pnpm test:visual --grep "machine-scene"` | 통과 — WebGPU·WebGL 2·visual 3 projects |
| Linux Playwright `visual` project | 통과 — official `v1.55.0-noble`, 1 visual regression |
| `pnpm bench --filter renderer-smoke` | 통과 — 20,000 bounds projections, 750 ms budget |
| `pnpm check:forbidden-ui` | 통과 |
| `pnpm build` | 통과 — Vinext 5단계 production build |
| `CNC_RENDER_SOAK_PHASE_MS=600000` backend별 soak | 통과 — WebGPU·WebGL 2 각 20.3분, 2 passed/21.9분 |

visual baseline은 `875 × 609 px`이고 `#E9EDF1` 배경 432,281 px,
백색 소재 14,576 px와 고대비 소재 윤곽 892 px를 포함한다. 같은 baseline은
공식 Playwright Ubuntu Noble 이미지에서 고정 Node `24.18.0`, pnpm `11.5.3`,
Playwright `1.55.0`으로 재검증했다. 브라우저 제어 플러그인은 로컬 Windows
ACL 적용 오류로 시작하지 못했으므로 자동 Playwright screenshot·픽셀
통계로 대체했다.

## Delivered M3 renderer shell

- renderer contract
  - WebGPU 우선, WebGL 2 안전 폴백과 backend별 limit 공개
  - `1 scene unit = 1 mm`, CNC Z-up에서 Three.js Y-up으로 단일 변환
  - 기계·소재·절삭 공구·공구 홀더·고정구·공구 경로 독립 layer와 collision ID
  - backend projection Golden 허용 오차 `0.75 px`
- renderer-owned scene
  - 기계, fixture, 백색 소재와 윤곽, tool assembly, toolpath guide
  - 오른쪽 Orbit, 가운데 Pan, wheel Zoom, 왼쪽 semantic selection
  - 정면·평면·우측·등각·Fit·layer focus, `180..5000 mm` focus range
  - on-demand frame invalidation, resource telemetry와 명시적 dispose
- React 작업실 셸
  - light-only command bar, scene graph, viewport, inspector와 program dock
  - backend·기능 한계·단위·E2 정확도와 교육용 비검증 고지
  - React commit과 renderer frame을 분리한 browser harness
- 검증 자산
  - WebGPU/WebGL 2 E2E, machine-scene visual baseline, renderer smoke benchmark
  - 10+10분 soak 전용 opt-in gate
  - production E2E 서버에서 app 요청은 Vinext로 전달하고 `/assets/*`는
    `dist/client`에서 경로 이탈 방지 후 직접 제공하는 Windows test gateway
  - 긴 비 ASCII Windows 경로에서만 임시 `subst`를 쓰는 Vinext build wrapper

## M3 limitations and remaining risks

- Vinext `0.0.50` production static cache는 Windows의 `path.relative()` 결과를
  URL 구분자로 정규화하지 않아 `/assets/*`를 404로 반환한다. E2E 전용
  gateway가 해당 자산만 직접 제공하며, upstream 수정 버전으로 갱신할 때
  workaround 제거 여부를 재검증해야 한다.
- WebGPU material update는 capability budget과 준비 상태만 표시한다. 실제
  재료 제거, collision, machine kinematics와 Toolpath 실행 연결은 후속 범위다.
- 현재 scene은 결정론적 교육 fixture이며 실제 장비 형상이나 산업용 검증
  결과와 동일하지 않다.

## M2 validation run

2026-07-28에 고정 도구 체인 Node `24.18.0`, pnpm `11.5.3`, Rust
`1.97.1`로 실행했다.

| Gate | Result |
|---|---|
| `pnpm test:unit --filter gcode` | 통과 — 1 file, 44 tests, Golden 44쌍 |
| `pnpm test:contracts --filter toolpath-ir` | 통과 — 1 file, 3 tests |
| `pnpm test:parity --filter gcode` | 통과 — 1 file, 45 tests |
| `pnpm cargo:check` | 통과 — workspace all targets, locked |
| `pnpm fuzz:gcode -- --time=60` | 통과 — 8,120 cases: raw 3,294 / structured 3,208 / mutated 1,618 |
| `cargo fmt --all -- --check` | 통과 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 통과 |
| `pnpm cargo:test` | 통과 — Rust workspace 123 tests, 그중 M2 G-code core 89 tests |
| `pnpm check:boundaries` | 통과 — 17 modules, 33 dependencies, violation 0 |
| `pnpm verify` | 통과 — lint, typecheck, Cargo check, unit 52, contract 42, parity 51, forbidden UI, production build |

## Delivered M2 core

- `cnc-render-gcode-core`
  - UTF-8 lexer, block parser, modal state machine, semantic validator
  - canonical mm motion, program control event, M1 `ToolpathIR`, source line map
  - G0~G3, G17~G21, G43/G49, G54~G59, G80~G83, G90/G91,
    G94~G99와 지원 M-code lowering
  - G17/G18/G19 원호, R minor·major arc, unit-aware IJK radius tolerance
  - G81/G82/G83 sticky cycle, G98/G99 return, absolute·incremental coordinate rebinding
  - G94/G95와 G96/G97 feed·spindle mode 경계
  - M0/M1/M2/M30 event와 M2/M30 이후 비실행 block 정적 지원 검증
- 결정론과 실패 원자성
  - 전체 입력·옵션을 scope로 하는 RFC 9562 version 8 Toolpath·segment ID
  - fatal 진단에서 motion·event·길이·상태를 노출하지 않는 fail-closed 결과
  - terminal `request.resource_limit`를 마지막에 두고 일반 진단 prefix를
    source 위치와 emission order로 안정 정렬
  - block transaction rollback과 같은 입력 100회 byte parity
- 자원 경계
  - CLI envelope 20 MiB, decoded source 16 MiB, line 1 MiB
  - 250,000 lines, 1,000,000 words, 400,000 canonical motions
  - 10,000 diagnostics, G83 parse-wide 100,000 pecks, parity repetitions 1..=100
  - 모든 한도는 inclusive이며 다음 항목에서 명시적 fatal 또는 요청 오류
- 검증 자산
  - `valid`, `invalid`, `modal`, `dialect` 범주의 44쌍 `.nc`·manifest
  - machine-readable support matrix와 코드·문서·공개 진단 일치 계약
  - raw·structured·mutated corpus, panic·hang·silent acceptance·결정론·수치
    불변식을 검사하는 고정-seed fuzz

## M2 limitations and remaining risks

- 실행 방언은 `common-v1` 하나다. Fanuc-like, Haas-like, LinuxCNC-like
  전체 호환을 보증하지 않는다.
- G41/G42, G84~G89, macro·variable, 식, 서브프로그램, G90.1/G91.1,
  다회전 arc와 5축 lowering은 명시적으로 거부한다.
- G95+G96은 segment 끝점 X를 지름으로 사용해 scalar `mm/min` feed를
  계산하는 E1/E2 근사다. 구간 내 연속 RPM, 기계별 clamp, 가감속은 M4 이후
  운동학 범위다.
- 60초 fuzz는 grammar-aware deterministic mutation smoke다. 장시간
  coverage-guided fuzz와 다양한 corpus 확장은 후속 hardening 범위다.
- Rust 코어는 아직 Worker/WASM, renderer, 충돌과 재료 제거에 연결하지
  않았다. UI에서 G-code를 실행하거나 3D 가공 결과를 보여 주지 않는다.

## Environment notes

- 로컬 Windows Rust 실행 검증은 Visual Studio Build Tools 2022의 MSVC x64
  toolchain을 사용했다.
- `scripts/run-cargo.mjs`는 Windows에서 `VsDevCmd.bat`를 탐지해 PATH, LIB,
  INCLUDE 환경을 자식 Cargo 프로세스에만 적용한다. Linux CI 동작은 그대로다.
- 프로젝트가 고정한 Node `24.18.0`은 격리된 `C:\tmp` 도구 경로에서 실행해
  시스템 Node와 섞이지 않도록 했다.
- M2는 UI 변경이 아니므로 브라우저·visual regression 검증은 수행하지 않았다.
  production build와 기존 rendered HTML 계약은 유지했다.
- M2 구현과 검증은 로컬에서 완료했으며, 게시 이력은 GitHub PR과 Sites
  배포 기록을 단일 출처로 사용한다.

## Previous milestone

M1은 TypeScript·JSON Schema·Rust의 strict UUID·UTC·nullable·단위 규칙,
RFC 8785 semantic hash, Project·Worker 계약과 공용 fixture를 완료했다.
M2는 이 계약과 기존 34개 Rust 테스트를 유지한 채 추가되었다.

## Decision log

| Date | Decision | Reason | Affected files |
|---|---|---|---|
| 2026-07-26 | 루트 `vinext` 스캐폴드는 배포 adapter로 유지하고 `apps/web`을 애플리케이션 composition root로 사용한다. | 초기 Cloudflare adapter 계약을 보존하면서 UI, simulation, renderer, storage의 조립 책임을 한곳에 둔다. | `app/`, `worker/`, `apps/web/`, `docs/architecture-decisions/0001-repository-boundaries.md` |
| 2026-07-26 | Node `24.18.0`, pnpm `11.5.3`, Rust `1.97.1`을 로컬 도구 파일과 CI에 정확히 고정한다. | 개발 환경과 CI의 재현성을 유지한다. | `.tool-versions`, `rust-toolchain.toml`, `.github/workflows/ci.yml` |
| 2026-07-26 | 프로젝트 형식은 `.cncrender` ZIP 컨테이너, MIME `application/vnd.cnc-render.project+zip`, schema ID `urn:cnc-render:schema:project:1`, `schemaVersion` 정수 `1`을 사용한다. | 제품명과 저장 형식을 통일하고 명확한 버전·전송 경계를 제공한다. | `docs/architecture-decisions/0002-project-container-format.md`, `.gitattributes` |
| 2026-07-27 | TypeScript와 Rust 계약은 strict UUID·UTC·nullable·단위 규칙과 RFC 8785 semantic hash를 공유한다. | 파서·Worker·저장 구현 전에 wire 의미와 실패 규칙을 고정한다. | `packages/contracts/`, `crates/cnc-render-contracts/`, `docs/architecture-decisions/0003-domain-contracts.md` |
| 2026-07-27 | Worker command는 명시적 null `replyTo`, ready와 project result는 검증 가능한 reply UUID를 사용하고 `run.dispose`는 one-way stale barrier로 둔다. | 메시지 상관관계와 이전 run 이벤트 유입을 M1 계약 수준에서 차단한다. | `packages/contracts/src/worker.ts`, `crates/cnc-render-contracts/src/worker.rs` |
| 2026-07-28 | M2 실행 방언을 versioned `common-v1` 부분집합으로 고정하고 지원 매트릭스 밖 기능은 조용히 무시하지 않는다. | 제조사 전체 호환을 과장하지 않으면서 결정론적 교육용 E1/E2 경로를 제공한다. | `crates/gcode-core/`, `docs/architecture-decisions/0004-gcode-parser.md`, `docs/gcode-support-matrix.md` |
| 2026-07-28 | fatal parse는 전체 결과를 fail-closed하고, 자원 상한·진단 순서·결정론적 ID를 공개 계약으로 둔다. | 부분 경로 소비, 자원 고갈, 실행 간 결과 drift를 M2 경계에서 차단한다. | `crates/gcode-core/`, `tests/fixtures/gcode/`, `tests/parity/gcode-determinism.test.ts` |
| 2026-07-29 | renderer가 scene·camera·GPU loop를 소유하고 WebGPU 우선·WebGL 2 공개 폴백을 제공한다. | React frame 결합과 backend 기능 과장을 막고 같은 mm fixture의 결정론적 교육용 E2 장면을 제공한다. | `packages/renderer/`, `app/components/`, `docs/architecture-decisions/0005-renderer-workcell-shell.md` |
| 2026-08-01 | 3축 FK·축 guard와 sphere/AABB collision proxy를 simulation core에 두고 stop UI는 marker가 그려진 renderer frame 뒤에 전환한다. | 수치·충돌 결정론, visual/collision 분리와 React frame 독립성을 M4 계약으로 고정한다. | `packages/simulation/`, `crates/simulation-core/`, `packages/renderer/`, `docs/architecture-decisions/0006-three-axis-kinematics-collision.md` |
| 2026-08-01 | 3축 재료 제거는 16×16 희소 Z-dexel 브릭과 정수 깊이 layer를 simulation core가 소유하고 renderer에는 dirty cell patch만 전달한다. | 비접촉 0, 부피 정확도, Stock hash 결정론과 전체 remesh 없는 부분 GPU 갱신을 같은 계약으로 고정한다. | `packages/simulation/`, `crates/simulation-core/`, `packages/renderer/`, `docs/architecture-decisions/0007-sparse-dexel-milling.md` |
| 2026-08-01 | 선반 Stock은 Z축 정수 내·외경 필드로 표현하고 renderer에는 dirty axial cell patch만 전달한다. | 대표 회전 대칭 공정의 단조 제거·셀 크기 이하 반경 오차·저장 해시 결정론과 부분 GPU 갱신을 같은 계약으로 고정한다. | `packages/simulation/`, `crates/simulation-core/`, `packages/renderer/`, `docs/architecture-decisions/0008-lathe-radius-field.md` |
| 2026-08-09 | 전용 Worker가 bare C ABI Rust/WASM session을 소유하고 renderer에는 receiver-owned Transferable dirty buffer만 전달한다. | G-code부터 Stock·충돌·renderer까지 실제 Rust 실행 경로, 재생 결정론, pause/cancel lifecycle과 stale-event 차단을 하나의 공개 계약으로 고정한다. | `crates/cnc-render-wasm/`, `packages/contracts/src/coordinator.ts`, `packages/simulation/src/coordinator.ts`, `docs/architecture-decisions/0009-worker-wasm-simulation-coordinator.md` |
