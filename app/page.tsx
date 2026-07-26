import { CNC_RENDER_FOUNDATION_PACKAGES } from "@cnc-render/web/foundation";

type FoundationPackage = (typeof CNC_RENDER_FOUNDATION_PACKAGES)[number];

const FOUNDATION_DETAILS: Record<
  FoundationPackage,
  {
    label: string;
    scope: string;
    milestone: string;
  }
> = {
  "@cnc-render/ui": {
    label: "UI 셸",
    scope:
      "React는 화면 구조와 접근 가능한 입력만 담당합니다. 대형 계산 상태는 UI에 저장하지 않습니다.",
    milestone: "M9에서 작업실 UI 확장",
  },
  "@cnc-render/simulation": {
    label: "Simulation",
    scope:
      "Worker와 Rust/WASM 계산 코어의 경계입니다. 현재는 실행 기능이 아닌 패키지 계약만 정의합니다.",
    milestone: "M1부터 계약과 수치 코어 구축",
  },
  "@cnc-render/renderer": {
    label: "Renderer",
    scope:
      "시뮬레이션 결과를 읽기 전용으로 표현할 렌더링 경계입니다. 계산 결과의 원본을 소유하지 않습니다.",
    milestone: "M3에서 3D 작업실 연결",
  },
  "@cnc-render/storage": {
    label: "Storage",
    scope:
      "버전이 있는 프로젝트 DTO와 체크포인트를 다룰 저장 경계입니다. 실행 객체를 직접 직렬화하지 않습니다.",
    milestone: "M8에서 영속 저장 확장",
  },
};

const NEXT_CONTRACTS = [
  {
    name: "ProjectSchema",
    description: "프로젝트 식별자, 스키마 버전과 표시 단위 계약",
  },
  {
    name: "MachineDefinition",
    description: "축, 주축, 운동학 트리와 작업 영역의 명시적 정의",
  },
  {
    name: "Worker messages",
    description: "UI와 계산 코어 사이의 버전 있는 명령·이벤트 계약",
  },
] as const;

export default function Home() {
  return (
    <main className="foundation-page">
      <header className="site-header" aria-label="CNC Render M0 헤더">
        <a className="brand" href="#top" aria-label="CNC Render 처음으로">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>CNC Render</strong>
            <small>Learning simulator foundation</small>
          </span>
        </a>
        <p className="foundation-status">
          <span aria-hidden="true" />
          M0 · 저장소 기반
        </p>
      </header>

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">CNC 교육 시뮬레이터 · FOUNDATION</p>
          <h1 id="hero-title">
            가공 원리를 배우기 위한
            <span>정확한 기반부터 세웁니다.</span>
          </h1>
          <p className="hero-lead">
            CNC Render는 웹에서 공작기계, G-code와 재료 제거 과정을 단계적으로
            학습하기 위한 프로젝트입니다. M0에서는 기능을 서두르지 않고 UI,
            계산, 렌더링, 저장의 책임을 먼저 분리합니다.
          </p>

          <aside className="education-notice" aria-label="교육용 근사 고지">
            <span className="notice-label">교육용 근사</span>
            <p>
              CNC Render는 산업용 검증 도구나 실제 장비 제어기가 아닙니다.
              현재 M0 화면은 시뮬레이션 결과를 제공하지 않으며, 이후 결과에도
              정확도 등급과 근사 한계를 함께 표시합니다.
            </p>
          </aside>

          <nav className="hero-actions" aria-label="페이지 바로가기">
            <a className="primary-action" href="#foundation">
              M0 경계 살펴보기
            </a>
            <a className="secondary-action" href="#next-milestone">
              다음 마일스톤 보기
            </a>
          </nav>
        </div>

        <div className="machine-card">
          <div className="machine-card-header">
            <div>
              <p>Machine concept</p>
              <strong>3축 VMC 기본 구조</strong>
            </div>
            <span>개념 표현</span>
          </div>

          <div
            className="vmc-stage"
            role="img"
            aria-label="주축, 공구, 소재와 테이블로 구성된 수직형 머시닝 센터 개념도"
          >
            <div className="vmc-shell" aria-hidden="true" />
            <div className="vmc-column" aria-hidden="true" />
            <div className="vmc-bridge" aria-hidden="true" />
            <div className="vmc-head" aria-hidden="true">
              <span>주축</span>
            </div>
            <div className="vmc-spindle" aria-hidden="true" />
            <div className="vmc-tool" aria-hidden="true" />
            <div className="vmc-stock" aria-hidden="true">
              소재
            </div>
            <div className="vmc-table" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="vmc-base" aria-hidden="true" />
            <div className="axis axis-x" aria-hidden="true">
              X
            </div>
            <div className="axis axis-y" aria-hidden="true">
              Y
            </div>
            <div className="axis axis-z" aria-hidden="true">
              Z
            </div>
          </div>

          <dl className="machine-facts">
            <div>
              <dt>기계</dt>
              <dd>수직형 머시닝 센터</dd>
            </div>
            <div>
              <dt>축 구성</dt>
              <dd>X · Y · Z</dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>정적 개념도</dd>
            </div>
          </dl>
        </div>
      </section>

      <section
        className="foundation-section"
        id="foundation"
        aria-labelledby="foundation-title"
      >
        <div className="section-heading">
          <p className="eyebrow">M0 · REPOSITORY BOUNDARIES</p>
          <h2 id="foundation-title">서로 침범하지 않는 네 개의 경계</h2>
          <p>
            지금 준비된 것은 기능 완성이 아니라 책임과 의존 방향입니다. 각
            패키지는 공개 계약을 통해서만 연결됩니다.
          </p>
        </div>

        <div className="boundary-grid">
          {CNC_RENDER_FOUNDATION_PACKAGES.map((packageName, index) => {
            const detail = FOUNDATION_DETAILS[packageName];

            return (
              <article className="boundary-card" key={packageName}>
                <div className="boundary-card-topline">
                  <span className="boundary-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="boundary-state">경계 정의됨</span>
                </div>
                <h3>{detail.label}</h3>
                <code>{packageName}</code>
                <p>{detail.scope}</p>
                <footer>{detail.milestone}</footer>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="next-section"
        id="next-milestone"
        aria-labelledby="next-title"
      >
        <div className="next-copy">
          <p className="eyebrow">NEXT · M1</p>
          <h2 id="next-title">도메인 스키마 · 단위 · 계약</h2>
          <p>
            다음 단계에서는 화면 기능보다 먼저 저장과 계산이 공유할 언어를
            고정합니다. 구현 전 계약 테스트로 TypeScript와 Rust의 의미가 같은지
            확인합니다.
          </p>
          <p className="next-caution">
            M1 범위는 데이터 계약입니다. G-code 재생, 3D 절삭과 완성된 작업실은
            이후 마일스톤에서 검증하며 구축합니다.
          </p>
        </div>

        <ol className="contract-list">
          {NEXT_CONTRACTS.map((contract, index) => (
            <li key={contract.name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <code>{contract.name}</code>
                <p>{contract.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="site-footer">
        <p>CNC Render · M0 foundation snapshot</p>
        <p>라이트모드 전용 · 시뮬레이션 실행 기능 없음</p>
      </footer>
    </main>
  );
}
