# packages/cli/src/

Source code for the CLI package.

## Responsibility

Implements all CLI commands with argument parsing, error handling, and integration with the client library.

## Design

- **Single File**: All commands in `index.ts` for simplicity
- **Argument Parsing**: Simple `--key value` and `--flag` parser (`parseOptions()`)
- **Error Handling**: Console error output with appropriate exit codes
- **Async/Await**: All commands async with proper error catching

## Flow

**Start**:
```
parse args → check health → launch if needed → wait for ready → exit 0
```

**Event**:
```
validate state → sendEvent() → handle error → exit code
```

**Install**:
```
stage source → extract if zip → find pet dirs → loadCodexPetDirectory() 
  → hash naming → copy to final dir → selectPet() or update config
```

**Window Action**:
```
check health → if show and not running: launch → sendWindowAction() → exit
```

## Integration

- **Client Package**: All communication via `@open-pets/client` functions
- **Core Config**: Uses `getOpenPetsConfigPath()`, `getOpenPetsPetsDir()`
- **Pet Format**: Uses `loadCodexPetDirectory()` for validation
- **Desktop**: Spawns electron process in dev mode
