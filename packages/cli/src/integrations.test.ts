import { describe, it, expect } from "bun:test";
import { claudeCodeSnippet } from "./integrations/claude-code";
import { openCodePlugin } from "./integrations/opencode";

describe("CLI integrations", () => {
  describe("claudeCodeSnippet", () => {
    it("parses as valid JSON", () => {
      const snippet = claudeCodeSnippet();
      expect(() => JSON.parse(snippet)).not.toThrow();
    });

    it("includes hooks with command containing 'openpets hook claude-code'", () => {
      const snippet = claudeCodeSnippet();
      const parsed = JSON.parse(snippet);
      
      // Check that hooks object exists
      expect(parsed.hooks).toBeDefined();
      
      // Check all hook types contain the expected command
      const hookTypes = ["UserPromptSubmit", "PreToolUse", "PermissionRequest", "Notification", "Stop", "StopFailure"];
      
      for (const hookType of hookTypes) {
        expect(parsed.hooks[hookType]).toBeDefined();
        expect(Array.isArray(parsed.hooks[hookType])).toBe(true);
        
        // Check that at least one hook in each type has the command
        const hasCommand = parsed.hooks[hookType].some((hook: any) => {
          if (hook.hooks && Array.isArray(hook.hooks)) {
            return hook.hooks.some((h: any) => 
              h.type === "command" && h.command === "openpets hook claude-code"
            );
          }
          return false;
        });
        
        expect(hasCommand).toBe(true);
      }
    });

    it("has valid hook structure with matchers for PreToolUse", () => {
      const snippet = claudeCodeSnippet();
      const parsed = JSON.parse(snippet);
      
      // PreToolUse should have matcher for tool filtering
      const preToolUse = parsed.hooks.PreToolUse;
      expect(preToolUse).toBeDefined();
      expect(Array.isArray(preToolUse)).toBe(true);
      
      // Should have entry with matcher for Edit/Write/MultiEdit
      const hasMatcher = preToolUse.some((hook: any) => 
        hook.matcher && hook.matcher.includes("Edit")
      );
      expect(hasMatcher).toBe(true);
    });
  });

  describe("openCodePlugin", () => {
    it("returns a string containing defensive try/catch send behavior", () => {
      const plugin = openCodePlugin();
      
      // Check for try/catch block in send function
      expect(plugin).toContain("try {");
      expect(plugin).toContain("} catch {");
      expect(plugin).toContain("// OpenPets is optional. Never break OpenCode.");
    });

    it("maps edit/write/multiedit/patch/apply_patch to editing", () => {
      const plugin = openCodePlugin();
      
      // Check for isEditTool function with the expected regex
      expect(plugin).toContain("isEditTool");
      expect(plugin).toMatch(/edit\|write\|multiedit\|patch\|apply_patch/i);
      
      // Check that editing state is used
      expect(plugin).toContain('"editing"');
    });

    it("maps bash test commands to testing", () => {
      const plugin = openCodePlugin();
      
      // Check for isTestCommand function
      expect(plugin).toContain("isTestCommand");
      
      // Check for test command patterns
      expect(plugin).toMatch(/test\|vitest\|jest\|pytest/i);
      expect(plugin).toContain('"testing"');
    });

    it("has permission.asked -> waving mapping", () => {
      const plugin = openCodePlugin();
      
      // Check for permission.asked event handling
      expect(plugin).toContain('"permission.asked"');
      expect(plugin).toContain('"waving"');
    });

    it("posts to 127.0.0.1:4738", () => {
      const plugin = openCodePlugin();
      
      // Check for the default URL
      expect(plugin).toContain("127.0.0.1:4738");
      expect(plugin).toContain('OPENPETS_URL');
    });

    it("includes session.error signal handling", () => {
      const plugin = openCodePlugin();
      
      // Check for session.error event handling
      expect(plugin).toContain('"session.error"');
      expect(plugin).toContain('"error"');
    });

    it("includes session.status busy/idle state handling", () => {
      const plugin = openCodePlugin();
      
      // Check for session status handling
      expect(plugin).toContain('"session.status"');
      expect(plugin).toContain('"busy"');
      expect(plugin).toContain('"idle"');
      expect(plugin).toContain('"thinking"');
    });

    it("includes tool execute before/after hooks", () => {
      const plugin = openCodePlugin();
      
      // Check for tool execution hooks
      expect(plugin).toContain('"tool.execute.before"');
      expect(plugin).toContain('"tool.execute.after"');
    });

    it("has proper event structure with type, state, source, and timestamp", () => {
      const plugin = openCodePlugin();
      
      // Check for event function structure
      expect(plugin).toContain("type,");
      expect(plugin).toContain("state,");
      expect(plugin).toContain('source: "opencode"');
      expect(plugin).toContain("timestamp: Date.now()");
    });
  });
});
