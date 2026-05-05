# apps/desktop/src/renderer/src/

React application for rendering the animated desktop pet.

## Responsibility

Renders the visual pet using CSS sprite animation, displays speech bubbles, and handles user interactions (dragging, clicking).

## Design

- **App Component (`App.tsx`)**: 
  - Manages pet state subscription from main process
  - Handles speech bubble visibility with auto-dismiss timers
  - Renders `PetSprite` component
- **PetSprite Component**: 
  - CSS-based spritesheet animation using CSS custom properties
  - Pointer event handling for drag detection and visual feedback
  - Direction-aware animation (running-left, running-right, waving)
  - Velocity smoothing for natural direction changes
- **Animation System**: 
  - CSS keyframes for sprite sheet row animation
  - Dynamic `--sprite-row`, `--sprite-frames`, `--sprite-duration` CSS variables
  - 192x208px frames, 8 columns, scaled by `BASE_PIXEL_SCALE` (0.5)

## Flow

1. **Mount**: Subscribe to `pet-state` IPC channel → Send `renderer-ready` signal
2. **State Update**: New state received → Update `PetSprite` props → CSS animation updates
3. **Speech Bubble**: Event with message received → Show bubble → Auto-hide after 4-5s
4. **Interaction**: 
   - Pointer down → Start drag tracking
   - Pointer move → Calculate velocity → Update visual direction → Queue drag-move IPC
   - Pointer up → Send drag-end IPC → Show wave animation briefly

## Integration

- **Main Process**: Receives state via `window.openPets.onPetState()`, sends interactions via `window.openPets.petInteraction()`
- **Core**: Uses `getCodexStateForOpenPetsState()` to map logical states to animation rows
- **Pet Format**: Displays spritesheet from `activePet.spritesheetUrl`
