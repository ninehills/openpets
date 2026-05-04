# Example pets

OpenPets includes a small starter set of generated Codex/Petdex-compatible pets for demos and alpha testing.

Each pet directory contains:

- `pet.json`
- `spritesheet.png` at `1536x1872`
- 8 columns × 9 rows of `192x208` frames

## Included pets

| Pet | Path | Description |
|---|---|---|
| Byte Cat | `examples/pets/byte-cat` | A pixel cat that naps between tool calls. |
| Rubber Duck | `examples/pets/rubber-duck` | A tiny debugging duck for explaining problems out loud. |
| Logic Bot | `examples/pets/logic-bot` | A small robot that lights up when your agent is working. |
| Terminal Ghost | `examples/pets/terminal-ghost` | A friendly terminal ghost for late-night coding sessions. |

## Usage

```bash
openpets start --pet ./examples/pets/byte-cat
openpets start --pet ./examples/pets/rubber-duck
openpets start --pet ./examples/pets/logic-bot
openpets start --pet ./examples/pets/terminal-ghost
```

Or, from source:

```bash
bun packages/cli/src/index.ts start --pet ./examples/pets/byte-cat
```

The legacy minimal sample remains available at `examples/sample-pet`.
