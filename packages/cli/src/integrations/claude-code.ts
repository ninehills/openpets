export function claudeCodeSnippet() {
  return JSON.stringify(
    {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "openpets hook claude-code" }] }],
        PreToolUse: [
          {
            matcher: "Bash|Edit|Write|MultiEdit",
            hooks: [{ type: "command", command: "openpets hook claude-code" }],
          },
        ],
        PermissionRequest: [{ hooks: [{ type: "command", command: "openpets hook claude-code" }] }],
        Notification: [{ hooks: [{ type: "command", command: "openpets hook claude-code" }] }],
        Stop: [{ hooks: [{ type: "command", command: "openpets hook claude-code" }] }],
        StopFailure: [{ hooks: [{ type: "command", command: "openpets hook claude-code" }] }],
      },
    },
    null,
    2,
  );
}
