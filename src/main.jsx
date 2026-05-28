import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AgentPipeline from "./AgentPipeline";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AgentPipeline />
  </StrictMode>
);
