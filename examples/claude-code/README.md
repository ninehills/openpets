# Claude Code example

Claude Code integration now lives in the dedicated `claude-pets` package.

Print the project-local settings snippet:

```bash
bunx claude-pets print
```

Install the project-local settings snippet:

```bash
bunx claude-pets install
```

It installs to `.claude/settings.local.json` and backs up an existing file before merging hooks.
