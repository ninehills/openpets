import { useEffect, useState } from "react";
import type { OnboardingConnectionTestResult, OnboardingSnapshot, StarterPetAdoptionResult, StarterPetSummary } from "../../onboarding/types";
import type { AssistantDetection, AssistantId, SetupPreview, SetupResult } from "../../assistant-setup/types";

type Step = "welcome" | "pick-tool" | "configure-mcp" | "test-connection" | "adopt-pet";

export function OnboardingApp() {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [detections, setDetections] = useState<AssistantDetection[]>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState<AssistantId | null>(null);
  const [preview, setPreview] = useState<SetupPreview | null>(null);
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null);
  const [connectionResult, setConnectionResult] = useState<OnboardingConnectionTestResult | null>(null);
  const [starterPets, setStarterPets] = useState<StarterPetSummary[]>([]);
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [adoptionResult, setAdoptionResult] = useState<StarterPetAdoptionResult | null>(null);
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isApplyingSetup, setIsApplyingSetup] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isLoadingPets, setIsLoadingPets] = useState(false);
  const [isAdoptingPet, setIsAdoptingPet] = useState(false);

  useEffect(() => {
    void window.openPetsOnboarding
      .getState()
      .then(setSnapshot)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load onboarding."));
  }, []);

  useEffect(() => {
    if (currentStep !== "adopt-pet" || starterPets.length > 0 || isLoadingPets) return;
    void loadStarterPets();
  }, [currentStep, isLoadingPets, starterPets.length]);

  async function loadTools() {
    setError(null);
    setIsLoadingTools(true);
    try {
      const results = await window.openPetsOnboarding.detectAssistants();
      setDetections(results);
      setCurrentStep("pick-tool");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not detect tools.");
    } finally {
      setIsLoadingTools(false);
    }
  }

  async function skip() {
    setError(null);
    try {
      const nextSnapshot = await window.openPetsOnboarding.skip();
      setSnapshot(nextSnapshot);
      await window.openPetsOnboarding.close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not skip onboarding.");
    }
  }

  async function previewSelectedAssistant() {
    if (!selectedAssistantId) return;
    setError(null);
    setSetupResult(null);
    setIsLoadingPreview(true);
    try {
      setPreview(await window.openPetsOnboarding.previewAssistant(selectedAssistantId));
      setCurrentStep("configure-mcp");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not preview assistant setup.");
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function applySetup() {
    if (!preview?.willWrite) return;
    const confirmed = window.confirm(`Apply OpenPets MCP setup for ${preview.assistantName}?`);
    if (!confirmed) return;
    setError(null);
    setIsApplyingSetup(true);
    try {
      const result = await window.openPetsOnboarding.applyAssistantSetup(preview.token);
      setSetupResult(result);
      setPreview(null);
      setDetections(await window.openPetsOnboarding.detectAssistants());
      if (result.ok) setCurrentStep("test-connection");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply assistant setup.");
    } finally {
      setIsApplyingSetup(false);
    }
  }

  async function testConnection() {
    setError(null);
    setIsTestingConnection(true);
    try {
      setConnectionResult(await window.openPetsOnboarding.testConnection());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not test OpenPets connection.");
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function loadStarterPets() {
    setError(null);
    setIsLoadingPets(true);
    try {
      const pets = await window.openPetsOnboarding.listStarterPets();
      setStarterPets(pets);
      setSelectedPetId(pets[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load starter pets.");
    } finally {
      setIsLoadingPets(false);
    }
  }

  async function adoptSelectedPet() {
    if (!selectedPetId) return;
    setError(null);
    setIsAdoptingPet(true);
    try {
      const result = await window.openPetsOnboarding.adoptStarterPet(selectedPetId);
      setAdoptionResult(result);
      setSnapshot(result.onboarding);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not adopt starter pet.");
    } finally {
      setIsAdoptingPet(false);
    }
  }

  return (
    <main className="onboarding-shell">
      <div className="onboarding-sidebar">
        <div className="onboarding-logo">OpenPets</div>
        <ul className="onboarding-steps">
          <li className={currentStep === "welcome" ? "active" : "completed"}>1. Welcome</li>
          <li className={currentStep === "pick-tool" ? "active" : currentStep === "welcome" ? "pending" : "completed"}>2. Pick AI Tool</li>
          <li className={currentStep === "configure-mcp" ? "active" : currentStep === "test-connection" || currentStep === "adopt-pet" ? "completed" : "pending"}>3. Configure MCP</li>
          <li className={currentStep === "test-connection" ? "active" : currentStep === "adopt-pet" ? "completed" : "pending"}>4. Test Connection</li>
          <li className={currentStep === "adopt-pet" ? "active" : "pending"}>5. Adopt a Pet</li>
        </ul>
      </div>

      <section className="onboarding-content">
        {error ? <div className="error-banner">{error}</div> : null}

        {currentStep === "welcome" && (
          <div className="step-welcome fade-in">
            <h1>Welcome to OpenPets</h1>
            <p className="lede">
              Enhance your coding experience with AI pets that live on your screen. 
              We'll guide you through setting up your assistant, connecting the MCP server, and picking your first pet.
            </p>
            <div className="setup-summary">
              <p>Status: {snapshot?.onboarding?.status ?? "not-started"}</p>
              <p>Version: {snapshot?.version ?? "…"}</p>
            </div>
            <div className="onboarding-actions">
              <button type="button" className="primary-btn" onClick={loadTools} disabled={isLoadingTools}>
                {isLoadingTools ? "Detecting tools..." : "Get Started"}
              </button>
              <button type="button" className="secondary-btn" onClick={skip}>Skip setup</button>
            </div>
          </div>
        )}

        {currentStep === "pick-tool" && (
          <div className="step-pick-tool fade-in">
            <h1>Pick your AI Tool</h1>
            <p className="lede">
              We checked these supported AI assistants on your system.
              Select one to configure with the OpenPets MCP server in the next step.
            </p>
            
            <div className="tool-grid">
              {detections.map((detection) => (
                <button
                  type="button"
                  key={detection.id}
                  className={`tool-card ${selectedAssistantId === detection.id ? "selected" : ""}`}
                  onClick={() => setSelectedAssistantId(detection.id)}
                  aria-pressed={selectedAssistantId === detection.id}
                >
                  <h3>{detection.name}</h3>
                  <div className="tool-status">
                    <span className={`status-badge ${installStatusClassName(detection)}`}>
                      {installStatusLabel(detection)}
                    </span>
                    {detection.configStatus === "configured" && (
                      <span className="status-badge configured">Configured</span>
                    )}
                  </div>
                  <p className="tool-path">{detection.configPath || "No configuration file found"}</p>
                </button>
              ))}
              {detections.length === 0 && (
                <div className="empty-state">No supported AI tools detected.</div>
              )}
            </div>

            <div className="onboarding-actions">
              <button type="button" className="secondary-btn" onClick={() => setCurrentStep("welcome")}>Back</button>
              <button type="button" className="primary-btn" disabled={!selectedAssistantId || isLoadingPreview} onClick={() => void previewSelectedAssistant()}>
                {isLoadingPreview ? "Preparing preview..." : "Continue to Configure"}
              </button>
              <div className="spacer" />
              <button type="button" className="ghost-btn" onClick={skip}>Skip remaining setup</button>
            </div>
          </div>
        )}

        {currentStep === "configure-mcp" && (
          <div className="step-configure fade-in">
            <h1>Configure MCP</h1>
            <p className="lede">Review exactly what OpenPets will change before writing anything to your assistant config.</p>

            {preview ? (
              <section className="onboarding-panel">
                <p className="panel-kicker">Preview</p>
                <h2>{preview.assistantName}</h2>
                <p>{preview.summary}</p>
                <dl className="preview-details">
                  <div><dt>Target</dt><dd>{preview.configPath ?? "No writable target selected"}</dd></div>
                  <div><dt>Action</dt><dd>{preview.plannedAction}</dd></div>
                  <div><dt>Automatic write</dt><dd>{preview.willWrite ? "Available" : "Disabled"}</dd></div>
                </dl>
                {preview.willWrite && preview.targetVersion?.exists ? <p className="safe-note">A backup copy will be created before writing.</p> : null}
                {preview.willWrite ? <p className="safe-note">Unrelated config keys will be preserved.</p> : null}
                {preview.writeBlockedReason ? <p className="warning-note">{preview.writeBlockedReason}</p> : null}
                {preview.warnings.map((warning) => <p className="warning-note" key={`${warning.code}:${warning.message}`}>{warning.message}</p>)}
              </section>
            ) : null}

            {setupResult ? <div className={setupResult.ok ? "success-banner" : "error-banner"}>{setupResult.message}</div> : null}

            <div className="onboarding-actions">
              <button type="button" className="secondary-btn" onClick={() => setCurrentStep("pick-tool")}>Back</button>
              <button type="button" className="primary-btn" disabled={!preview?.willWrite || isApplyingSetup} onClick={() => void applySetup()}>
                {isApplyingSetup ? "Applying..." : preview?.willWrite ? "Apply MCP Setup" : "Automatic setup unavailable"}
              </button>
              <button type="button" className="secondary-btn" onClick={() => setCurrentStep("test-connection")}>Skip to Test</button>
              <div className="spacer" />
              <button type="button" className="ghost-btn" onClick={skip}>Skip remaining setup</button>
            </div>
          </div>
        )}

        {currentStep === "test-connection" && (
          <div className="step-test fade-in">
            <h1>Test connection</h1>
            <p className="lede">Confirm the local OpenPets desktop server is reachable before moving on. Your assistant will use this same local connection after MCP setup.</p>

            <section className="onboarding-panel">
              <p className="panel-kicker">Connection status</p>
              <h2>{connectionResult ? (connectionResult.ok ? "Ready" : "Not ready yet") : "Ready to test"}</h2>
              <p>{connectionResult?.message ?? "Run a quick local health check."}</p>
              {connectionResult ? (
                <ul className="connection-checklist">
                  {connectionResult.checklist.map((item) => (
                    <li key={item.label} className={item.ok ? "ok" : "pending"}>
                      <span>{item.ok ? "✓" : "•"}</span>
                      <div><strong>{item.label}</strong><p>{item.detail}</p></div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <div className="onboarding-actions">
              <button type="button" className="secondary-btn" onClick={() => setCurrentStep("configure-mcp")}>Back</button>
              <button type="button" className="primary-btn" onClick={() => void testConnection()} disabled={isTestingConnection}>
                {isTestingConnection ? "Testing..." : "Test Connection"}
              </button>
              <button type="button" className="primary-btn" onClick={() => setCurrentStep("adopt-pet")}>Continue to Adopt Pet</button>
              <div className="spacer" />
              <button type="button" className="ghost-btn" onClick={skip}>Skip remaining setup</button>
            </div>
          </div>
        )}

        {currentStep === "adopt-pet" && (
          <div className="step-adopt fade-in">
            <h1>Adopt your first pet</h1>
            <p className="lede">Choose a bundled starter pet. OpenPets maps this choice server-side, so the onboarding UI never sends a filesystem path.</p>

            {adoptionResult ? <div className="success-banner">{adoptionResult.message}</div> : null}

            <div className="tool-grid">
              {starterPets.map((pet) => (
                <button
                  type="button"
                  key={pet.id}
                  className={`tool-card pet-card ${selectedPetId === pet.id ? "selected" : ""}`}
                  onClick={() => setSelectedPetId(pet.id)}
                  aria-pressed={selectedPetId === pet.id}
                >
                  <span className="pet-avatar" aria-hidden="true">🐾</span>
                  <h3>{pet.name}</h3>
                  <div className="tool-status">
                    <span className="status-badge configured">Bundled</span>
                  </div>
                  <p className="tool-path">{pet.description}</p>
                </button>
              ))}
              {isLoadingPets ? <div className="empty-state">Loading starter pets…</div> : null}
              {!isLoadingPets && starterPets.length === 0 ? <div className="empty-state">No starter pets are available.</div> : null}
            </div>

            <div className="onboarding-actions">
              <button type="button" className="secondary-btn" onClick={() => setCurrentStep("test-connection")}>Back</button>
              <button type="button" className="primary-btn" disabled={!selectedPetId || isAdoptingPet} onClick={() => void adoptSelectedPet()}>
                {isAdoptingPet ? "Adopting..." : "Adopt Pet"}
              </button>
              <button type="button" className="primary-btn" disabled={!adoptionResult} onClick={() => void window.openPetsOnboarding.close()}>Finish</button>
              <div className="spacer" />
              {!adoptionResult ? <button type="button" className="ghost-btn" onClick={skip}>Skip</button> : null}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function installStatusLabel(detection: AssistantDetection) {
  switch (detection.installStatus) {
    case "installed":
      return "Installed";
    case "not-found":
      return "Not Found";
    case "unknown":
      return "Unknown";
  }
}

function installStatusClassName(detection: AssistantDetection) {
  return detection.installStatus === "installed" ? "installed" : detection.installStatus === "not-found" ? "missing" : "unknown";
}
