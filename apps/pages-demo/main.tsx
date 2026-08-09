import { createRoot } from "react-dom/client";
import Home from "../../app/page";
import "../../app/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("CNC Render root element is missing.");
}

createRoot(rootElement).render(<Home />);
