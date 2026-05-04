export function openCodePlugin() {
  return `import type { Plugin } from "@opencode-ai/plugin"

const OPENPETS_URL = process.env.OPENPETS_URL ?? "http://127.0.0.1:4738"

async function send(event) {
  let timeout
  try {
    const controller = new AbortController()
    timeout = setTimeout(() => controller.abort(), 400)
    await fetch(OPENPETS_URL + "/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: controller.signal,
    })
  } catch {
    // OpenPets is optional. Never break OpenCode.
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function event(state, type, extra = {}) {
  return { type, state, source: "opencode", timestamp: Date.now(), ...extra }
}

function isTestCommand(command) {
  return /\\b(test|vitest|jest|pytest|bun test|npm test)\\b/i.test(command ?? "")
}

function isBashTool(tool) {
  return String(tool ?? "").toLowerCase() === "bash"
}

function isEditTool(tool) {
  return /^(edit|write|multiedit|patch|apply_patch)$/i.test(String(tool ?? ""))
}

export const OpenPetsPlugin: Plugin = async () => ({
  event: async ({ event: input }) => {
    if (input.type === "session.status") {
      const status = input.properties?.status?.type
      if (status === "busy") await send(event("thinking", "opencode.session.busy"))
      if (status === "idle") await send(event("idle", "opencode.session.idle"))
    }
    if (input.type === "permission.asked") {
      await send(event("waving", "opencode.permission.asked"))
    }
    if (input.type === "session.error") {
      await send(event("error", "opencode.session.error"))
    }
  },
  "tool.execute.before": async (input) => {
    const tool = input.tool
    const command = input.args?.command ?? input.input?.command
    const state = isBashTool(tool) && isTestCommand(command) ? "testing" : isBashTool(tool) ? "running" : isEditTool(tool) ? "editing" : "working"
    await send(event(state, "opencode.tool.before", { tool }))
  },
  "tool.execute.after": async (input, output) => {
    const failed = output?.state?.status === "error"
    await send(event(failed ? "error" : "success", failed ? "opencode.tool.error" : "opencode.tool.success", { tool: input.tool }))
  },
})
`;
}
