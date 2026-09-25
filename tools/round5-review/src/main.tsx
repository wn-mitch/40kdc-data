import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import WorkbenchApp from "./WorkbenchApp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Round 5 review root element is missing.");

createRoot(root).render(
  <StrictMode>
    <WorkbenchApp />
  </StrictMode>,
);
