# Example pets

OpenPets includes real Petdex-compatible pet packs for demos and alpha testing.

Each pet directory contains:

- `pet.json`
- `spritesheet.webp` or `spritesheet.png` at `1536x1872`
- 8 columns × 9 rows of `192x208` frames

## Included pets

| Pet | Path | Description |
|---|---|---|
| Slayer | `examples/pets/slayer` | A compact armored slayer digital pet with a green sci-fi helmet, bulky olive armor, and a round spiked shield. |

## Usage

```bash
openpets start --pet ./examples/pets/slayer
```

Or, from source:

```bash
bun packages/cli/src/index.ts start --pet ./examples/pets/slayer
```

The legacy generated minimal sample remains available at `examples/sample-pet` for loader testing.
