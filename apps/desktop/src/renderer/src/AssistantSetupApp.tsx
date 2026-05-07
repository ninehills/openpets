import { useEffect, useState } from "react";
import type { AssistantDetection, AssistantId, SetupPreview } from "../../assistant-setup/types";

type LoadingState = "idle" | "loading" | "error";

export function AssistantSetupApp() {
  const [detections, setDetections] = useState<AssistantDetection[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SetupPreview | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoadingState("loading");
    setError(null);
    setPreview(null);
    setResultMessage(null);
    try {
      setDetections(await window.openPetsAssistantSetup.detect());
      setLoadingState("idle");
    } catch {
      setError("Assistant setup detection failed.");
      setLoadingState("error");
    }
  }

  async function previewAssistant(assistantId: AssistantId) {
    setError(null);
    setResultMessage(null);
    try {
      setPreview(await window.openPetsAssistantSetup.preview(assistantId));
    } catch {
      setError("Setup preview failed.");
    }
  }

  async function applyPreview() {
    if (!preview?.willWrite) return;
    const confirmed = window.confirm(`Apply OpenPets MCP setup for ${preview.assistantName}?`);
    if (!confirmed) return;
    try {
      const result = await window.openPetsAssistantSetup.apply(preview.token);
      setPreview(null);
      await refresh();
      setResultMessage(result.message);
    } catch {
      setError("Setup apply failed.");
    }
  }

  async function openDocs(assistantId: AssistantId) {
    try {
      await window.openPetsAssistantSetup.openDocs(assistantId);
    } catch {
      setError("Could not open integration docs.");
    }
  }

  return (
    <main className="assistant-setup-shell">
      <header className="assistant-setup-header">
        <div>
          <p className="assistant-setup-kicker">OpenPets</p>
          <h1>Setup AI Assistants</h1>
          <p>Detect assistant configs and safely add OpenPets MCP setup for supported JSON configs after preview and confirmation.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loadingState === "loading"}>
          {loadingState === "loading" ? "Checking…" : "Refresh"}
        </button>
      </header>

      {error ? <div className="assistant-setup-error">{error}</div> : null}
      {resultMessage ? <div className="assistant-setup-result">{resultMessage}</div> : null}

      <section className="assistant-setup-list" aria-label="Assistant setup status">
        {detections.map((detection) => (
          <article className="assistant-row" key={detection.id}>
            <div>
              <h2>{detection.name}</h2>
              <p>{detection.configPath ?? "No confirmed config path"}</p>
              {detection.warnings.map((warning) => <p className="assistant-warning" key={`${detection.id}:${warning.code}:${warning.message}`}>{warning.message}</p>)}
              {detection.similarServers.map((server) => <p className="assistant-warning" key={`${detection.id}:${server.name}`}>Similar server: {server.name}</p>)}
            </div>
            <div className="assistant-statuses">
              <StatusPill label={installLabel(detection)} />
              <StatusPill label={configLabel(detection)} />
              <StatusPill label={`bunx: ${detection.bunxStatus}`} />
            </div>
            <div className="assistant-actions">
              <button type="button" onClick={() => void previewAssistant(detection.id)}>
                Review
              </button>
              <button type="button" onClick={() => void openDocs(detection.id)}>
                Open docs
              </button>
            </div>
          </article>
        ))}
      </section>

      {preview ? (
        <section className="assistant-preview" aria-label="Setup preview">
          <div>
            <p className="assistant-setup-kicker">Preview</p>
            <h2>{preview.assistantName}</h2>
            <p>{preview.summary}</p>
            <p>{preview.configPath ? `Target: ${preview.configPath}` : "No writable target selected."}</p>
            <p>Planned action: {preview.plannedAction}</p>
            {preview.willWrite && preview.targetVersion?.exists ? <p>Backup: an `.openpets-backup-*` copy will be created before writing.</p> : null}
            {preview.willWrite ? <p>Unrelated config keys will be preserved.</p> : null}
            {preview.writeBlockedReason ? <p className="assistant-warning">{preview.writeBlockedReason}</p> : null}
            {preview.targetVersion?.isSymlink || preview.targetVersion?.parentSymlink ? <p className="assistant-warning">Target path uses a symlink; automatic writes are disabled.</p> : null}
            {preview.warnings.map((warning) => <p className="assistant-warning" key={`${warning.code}:${warning.message}`}>{warning.message}</p>)}
            {preview.similarServers.map((server) => <p className="assistant-warning" key={server.name}>Similar server: {server.name}</p>)}
          </div>
          <button type="button" disabled={!preview.willWrite} title={preview.willWrite ? "Apply this setup" : "Automatic writes are disabled for this preview"} onClick={() => void applyPreview()}>
            {preview.willWrite ? "Apply" : "Apply disabled"}
          </button>
        </section>
      ) : null}
    </main>
  );
}

function StatusPill({ label }: { label: string }) {
  return <span className="assistant-status-pill">{label}</span>;
}

function installLabel(detection: AssistantDetection) {
  return detection.installStatus === "installed" && detection.configPath ? "Config exists" : detection.installStatus;
}

function configLabel(detection: AssistantDetection) {
  return detection.configStatus.replace(/-/g, " ");
}
