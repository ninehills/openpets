import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AssistantSetupApp } from "./AssistantSetupApp";
import { OnboardingApp } from "./OnboardingApp";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

const view = new URLSearchParams(window.location.search).get("view");
const Component = view === "assistant-setup" ? AssistantSetupApp : view === "onboarding" ? OnboardingApp : App;

createRoot(root).render(
  <StrictMode>
    <Component />
  </StrictMode>,
);
