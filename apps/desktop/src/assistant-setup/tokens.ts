import type { AssistantId } from "./types.js";
import { isAssistantId } from "./types.js";

const previewTokenPrefix = "preview";

export function createPreviewToken(assistantId: AssistantId, nonce = "not-supported") {
  return `${previewTokenPrefix}:${assistantId}:${nonce}`;
}

export function parsePreviewToken(previewToken: unknown) {
  if (typeof previewToken !== "string" || previewToken.length > 200) return null;
  const parts = previewToken.split(":");
  if (parts.length !== 3) return null;
  const [prefix, assistantId, nonce] = parts;
  if (prefix !== previewTokenPrefix || !isAssistantId(assistantId) || !nonce) return null;
  return { assistantId, nonce, token: previewToken };
}
