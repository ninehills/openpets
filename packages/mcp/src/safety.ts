export const MAX_SPEECH_MESSAGE_CHARS = 100;

export type SpeechSafetyResult =
  | { ok: true; message: string }
  | { ok: false; reason: string };

const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/u;
const controlPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const urlPattern = /\b(?:https?:\/\/|www\.)\S+/iu;
const unixPathPattern = /(?:^|\s)(?:\.{1,2}\/|~\/|\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+|[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+\.[A-Za-z0-9_-]+)/u;
const windowsPathPattern = /\b[A-Za-z]:\\[^\s]+|\\\\[^\s]+\\[^\s]+/u;
const commandPattern = /\b(?:npm|bun|pnpm|yarn|node|python|python3|git|curl|ssh|cat|grep|rg|sed|awk|rm|sudo|docker|make|pytest|cargo|deno)\s+\S+/iu;
const secretPattern = /\b(?:token|secret|password|apikey|api_key|authorization|bearer)\b|(?:[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})/iu;
const longEncodedPattern = /\b(?:[a-f0-9]{32,}|[A-Za-z0-9+/]{40,}={0,2})\b/u;
const logPattern = /\b(?:error|typeerror|referenceerror|syntaxerror|exception|traceback|stack trace|at\s+\S+\s+\(|cannot read properties|undefined is not|diff --git)\b/iu;

export function validateSpeechMessage(input: unknown): SpeechSafetyResult {
  if (typeof input !== "string") return { ok: false, reason: "Message must be a string." };
  const message = input.normalize("NFKC").trim();
  if (!message) return { ok: false, reason: "Message is required." };
  if (message.length > MAX_SPEECH_MESSAGE_CHARS) return { ok: false, reason: "Message is too long." };
  if (/\r|\n/u.test(message)) return { ok: false, reason: "Message must be one line." };
  if (controlPattern.test(message) || ansiPattern.test(message)) return { ok: false, reason: "Message contains unsafe control characters." };
  if (/```|`{2,}|^\s{0,3}#{1,6}\s|^\s*[-*+]\s/u.test(message)) return { ok: false, reason: "Message must not contain markdown." };
  if (urlPattern.test(message)) return { ok: false, reason: "Message must not contain URLs." };
  if (unixPathPattern.test(message) || windowsPathPattern.test(message)) return { ok: false, reason: "Message must not contain file paths." };
  if (commandPattern.test(message)) return { ok: false, reason: "Message must not contain commands." };
  if (secretPattern.test(message) || longEncodedPattern.test(message)) return { ok: false, reason: "Message looks sensitive." };
  if (logPattern.test(message)) return { ok: false, reason: "Message looks like an exact error or log." };
  return { ok: true, message };
}

export type SpeechLimiter = {
  allow(message: string, now?: number): boolean;
};

export function createSpeechLimiter(options: { minIntervalMs?: number; duplicateWindowMs?: number } = {}): SpeechLimiter {
  const minIntervalMs = options.minIntervalMs ?? 3000;
  const duplicateWindowMs = options.duplicateWindowMs ?? 30000;
  let lastSentAt = 0;
  const recent = new Map<string, number>();

  return {
    allow(message, now = Date.now()) {
      for (const [key, at] of recent) {
        if (now - at > duplicateWindowMs) recent.delete(key);
      }
      const normalized = message.toLowerCase();
      if (now - lastSentAt < minIntervalMs) return false;
      if (recent.has(normalized)) return false;
      lastSentAt = now;
      recent.set(normalized, now);
      return true;
    },
  };
}
