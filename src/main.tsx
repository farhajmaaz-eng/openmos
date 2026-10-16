import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles.css";
import App, { useDocumentTitle } from "./App";

function Root() {
  useDocumentTitle();
  return <App />;
}

const container = document.getElementById("root");
if (!container) throw new Error("openmos: #root is missing from the page");

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);