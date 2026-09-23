# M13 FK Golden Pose v1

기대값은 FK 구현의 출력으로 생성하지 않은 정수 좌표·축 벡터다.
계약용 머신 builder는 `tests/fixtures/machine-plugins.ts`이며,
입력 변형은 `tests/helpers/five-axis-fixtures.ts`에 명시한다.

## 손계산 기준

- XYZ translation: (X,Y,Z). A는 (0,0,100) mm 피벗의 +X축 회전,
  C는 원점의 +Z축 회전이다. home은 기본 0이다.
- 공구 끝점은 (0,0,-120) mm, 홀더 방향은 +Z다.
  공작물 장착 원점은 leaf-local (0,0,100) mm이다.
- +90° X 회전: (x,y,z) → (x,-z,y).
  +90° Z 회전: (x,y,z) → (-y,x,z). 역변환에는 -90°를 적용한다.
- TT: tool = Txyz, work = A·C·Tz100.
  HT: tool = Txyz·A, work = C·Tz100.
  HH: tool = Txyz·A·C, work = Tz100.
  공구 좌표에는 inverse(work)·tool을 적용한다.

예를 들어 X=10/Y=20/Z=30 mm, A=C=+π/2 rad이면 다음과 같다.

| 구조 | 기대 공구 끝점 (mm) | 기대 홀더 방향 |
|---|---|---|
| TT | (-190,-10,-20) | (+1,0,0) |
| HT | (240,-10,30) | (-1,0,0) |
| HH | (10,240,30) | (0,-1,0) |

TT의 경우 base 공구 (10,20,-90)에 A 역변환을 적용하면 (10,-190,80),
C 역변환으로 (-190,-10,80), 장착 역이동으로 (-190,-10,-20)이 된다.
HH는 leaf 공구를 C, A 순서로 변환해 (0,220,100), XYZ를 더하고
공작물 장착 원점을 빼서 (10,240,30)이 된다.

## 19개 사례

세 구조 각각 home, 양·음의 A/C 결합, C 단독, 40 mm 공구 X offset을
검사한다(15개). 나머지는 다음의 독립 사례다.

- 장착 Euler 각 X=Y=Z=π/2: inverse(Rz·Ry·Rx)가 (0,0,-220)을
  (220,0,0)으로, +Z 방향을 -X로 보낸다.
- 비영점 home에서 입력이 home과 같으면 모든 축 상대 변위가 0이다.
- 대각 회전축 (1/√2,1/√2,0)의 π 회전은 (x,y,z)→(y,x,-z)다.
  A 피벗과 공구 X offset을 반영한 HH 기대값은 (0,40,220) mm / -Z다.
- XYZ도 테이블 chain에 배치하면 먼저 XYZ 역이동을 적용해야 한다.
  A=C=π/2일 때 기대값은 (-250,10,20) mm / +X다.

## 검증 경계

위치 오차는 Euclidean 거리 <=1e-9 mm, 자세 오차는
atan2(|actual×expected|, actual·expected) <=1e-9 rad,
출력 방향 길이 오차는 <=1e-12다. 작은 각에서 acos 반올림 오류를 피한다.
이 값은 해석적 FK fixture의 수치 기준이지 실제 기계/절삭 정확도 등급이 아니다.

추가 parity는 고정 seed `0x13002409`로 구조별 100개 임의 상태와 inclusive
min/max 2개, 총 306개를 사용한다. 모든 상태는 100회 반복하며 별도 Rust
프로세스 두 번의 JSON 바이트도 비교한다. 이 임의 상태의 기대값은 Golden으로
사용하지 않는다. TypeScript 점·벡터 Rodrigues 회전과 Rust rigid matrix 합성을
교차 검증한다. 공구축 방향만 비교하며 축 주위 roll은 계약에 포함하지 않는다.

IK, TCP 보정, 특이점·리와인드, 충돌, 재료 제거, Worker/WASM 실행 및 UI는
이 fixture의 검증 범위가 아니다.
