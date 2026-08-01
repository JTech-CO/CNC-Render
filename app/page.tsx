import Link from "next/link";
import { MachineWorkspaceLoader } from "./components/machine-workspace-loader";

function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 6h22v20H5z" />
      <path d="M10 11h12v10H10zM16 11v10" />
      <path d="M2 10h3M27 10h3M2 22h3M27 22h3" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="application-shell">
      <header className="command-bar">
        <Link className="product-brand" href="/" aria-label="CNC Render 작업실">
          <span className="product-mark">
            <BrandMark />
          </span>
          <span className="product-name">
            <strong>CNC Render</strong>
            <small>Learning simulator</small>
          </span>
        </Link>

        <nav className="project-breadcrumb" aria-label="현재 프로젝트">
          <span>Projects</span>
          <span aria-hidden="true">/</span>
          <strong>VMC setup study</strong>
          <span className="saved-state">로컬 Fixture</span>
        </nav>

        <div className="command-actions">
          <span className="milestone-label">M3 · RENDERER SHELL</span>
          <button type="button">도움말</button>
        </div>
      </header>

      <MachineWorkspaceLoader />
    </main>
  );
}
