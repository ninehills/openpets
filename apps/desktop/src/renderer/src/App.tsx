import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { OpenPetsState } from "@openpets/core";
import { getCodexStateForOpenPetsState } from "@openpets/core";
import type { RendererPetState } from "../../preload";
import "./styles.css";

const initialState: RendererPetState = {
  state: "idle",
  activePet: null,
};

export function App() {
  const [petState, setPetState] = useState<RendererPetState>(initialState);

  useEffect(() => {
    window.openPets.ready();
    return window.openPets.onPetState((state) => setPetState(state));
  }, []);

  return (
    <main className="overlay-shell">
      <div className="drag-region" />
      <PetSprite
        state={petState.state}
        scale={petState.scale ?? 0.8}
        {...(petState.activePet?.spritesheetUrl
          ? { spritesheetUrl: petState.activePet.spritesheetUrl }
          : {})}
      />
      {petState.event?.message ? <div className="speech-bubble">{petState.event.message}</div> : null}
      <div className="controls">
        <button type="button" onClick={() => window.openPets.windowAction("hide")}>hide</button>
        <button type="button" onClick={() => window.openPets.windowAction("sleep")}>sleep</button>
        <button type="button" onClick={() => window.openPets.windowAction("quit")}>quit</button>
      </div>
    </main>
  );
}

function PetSprite({ state, scale, spritesheetUrl }: { state: OpenPetsState; scale: number; spritesheetUrl?: string }) {
  const codexState = useMemo(() => getCodexStateForOpenPetsState(state), [state]);

  return (
    <div className="pet-sprite-frame" aria-label={`OpenPets ${state}`} role="img">
      {spritesheetUrl ? (
        <div
          className="pet-sprite"
          style={
            {
              "--sprite-url": `url(${spritesheetUrl})`,
              "--pet-scale": scale,
              "--sprite-row": codexState.row,
              "--sprite-frames": codexState.frames,
              "--sprite-duration": `${codexState.durationMs}ms`,
            } as CSSProperties
          }
        />
      ) : (
        <div className="fallback-pet" style={{ "--pet-scale": scale } as CSSProperties}>🐾</div>
      )}
    </div>
  );
}

export default App;
