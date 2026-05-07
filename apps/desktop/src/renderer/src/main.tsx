import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AssistantSetupApp } from "./AssistantSetupApp";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

const Component = new URLSearchParams(window.location.search).get("view") === "assistant-setup" ? AssistantSetupApp : App;

createRoot(root).render(
  <StrictMode>
    <Component />
  </StrictMode>,
);
