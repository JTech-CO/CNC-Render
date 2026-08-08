# ADR-0010: 프로젝트 저장은 IndexedDB metadata와 OPFS generation으로 원자화한다

- 상태: Accepted
- 날짜: 2026-08-09
- 마일스톤: M8 — 저장·체크포인트·프로젝트 마이그레이션

## 맥락

프로젝트의 검색 가능한 metadata와 대형 G-code·모델·Stock·checkpoint byte를 같은
저장소에 넣으면 IndexedDB transaction 크기와 메인 스레드 복사 비용이 커진다. 반대로
OPFS 파일만 기록하면 완료되지 않은 저장을 정상 프로젝트와 구분하거나 프로젝트 목록을
빠르게 조회하기 어렵다. 가져오는 `.cncrender`는 ZIP 경로 순회, 압축 폭탄, CRC·해시
불일치와 이전 schema도 안전하게 처리해야 한다.

## 결정

1. IndexedDB에는 프로젝트 ID, 활성 generation ID, manifest·component hash,
   checkpoint index와 `staging|ready|quarantined` 상태만 저장한다.
2. OPFS에는 immutable generation별 `project.json`, resource와 checkpoint chunk를
   저장한다. 모든 chunk의 길이·SHA-256을 검증한 뒤 하나의 IndexedDB transaction이
   active generation pointer를 `ready`로 전환한다.
3. 중단된 staging generation은 프로젝트 목록에 노출하지 않는다. 다음 시작의 recovery가
   모든 chunk를 검증해 완전하면 승격하고, 누락·손상이 있으면 격리한다.
4. `.cncrender` writer는 UTF-8 이름, 고정 timestamp와 STORE 압축을 사용하는
   결정론적 단일 디스크 ZIP을 만든다. importer는 STORE와 DEFLATE만 허용한다.
5. `manifest.json`은 ZIP 전송 envelope이며 `project.json`과 모든 resource entry의
   길이·SHA-256, engineVersion, unitSystem, project hash와 manifest checksum을 가진다.
   자기 자신은 entry 목록에서 제외해 checksum 순환을 막는다.
6. 기본 import 상한은 100 MiB, entry 수 4,096, JSON 깊이 64, 압축률 100:1이다.
   암호화·ZIP64·다중 디스크·비정규 파일·경로 충돌·선언되지 않은 entry를 거부한다.
7. checkpoint 기본 간격은 3초이며 2~5초 설정 또는 operation/terminal 경계에서 만든다.
   payload에는 engine·project·run 식별 해시, 논리 시간, 축·진단·Stock hash와 renderer가
   복원할 full Stock binary를 저장한다.
8. migration은 version별 순수 함수의 순차 registry로 실행한다. 가져온 원본
   `project.json` byte는 별도 immutable original chunk로 보존하고 현재 프로젝트를
   덮어쓰지 않는다.
9. 저장 telemetry는 operation, 크기, 시간, 결과 code와 해시된 project ID만 포함한다.
   사용자 동의와 무관하게 M8 telemetry에는 G-code·모델·프로젝트 원문을 포함하지 않는다.
10. M8은 QA가 요구한 device-local OPFS·IndexedDB 경로를 구현한다. cloud persistence는
    사용자 동의 전까지 비활성 port이며 Sites의 D1·R2 binding은 `null`로 유지한다.

## 결과와 제한

- 브라우저 재시작 뒤에도 active generation을 검증해 동일 의미 상태를 복원할 수 있다.
- 파일 쓰기와 metadata commit 사이의 중단은 정상 프로젝트를 오염시키지 않는다.
- STORE writer는 압축 효율보다 결정론·감사 용이성을 우선한다. DEFLATE import는
  브라우저 `DecompressionStream` 지원이 필요하다.
- OPFS를 지원하지 않는 브라우저에서는 영속 저장을 지원하지 않는다고 명시적으로
  진단하며 메모리 저장으로 자동 강등하지 않는다.
- cloud 동기화, 계정·권한·충돌 병합과 서버 객체 저장은 사용자 동의와 별도 마일스톤이
  필요하다.
