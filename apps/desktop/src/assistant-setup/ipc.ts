import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import { assistantSetupIpcChannels } from "./channels.js";
import {
  createDetectionContext,
  detectAssistantSetups,
  getAllowedAssistantDocsUrls,
  getAssistantDocsUrl,
  getAssistantSetupAdapter,
} from "./registry.js";
import { parsePreviewToken } from "./tokens.js";
import { isAssistantId } from "./types.js";

let registered = false;
const allowedSetupWebContentsIds = new Set<number>();

export function allowAssistantSetupWebContents(webContents: WebContents) {
  allowedSetupWebContentsIds.add(webContents.id);
  webContents.once("destroyed", () => allowedSetupWebContentsIds.delete(webContents.id));
}

export function registerAssistantSetupIpc() {
  if (registered) return;
  registered = true;

  ipcMain.handle(assistantSetupIpcChannels.detect, async (event) => {
    assertAllowedSetupSender(event);
    return detectAssistantSetups(createDetectionContext());
  });

  ipcMain.handle(assistantSetupIpcChannels.preview, async (event, assistantId: unknown) => {
    assertAllowedSetupSender(event);
    if (!isAssistantId(assistantId)) throw new Error("Invalid assistant id.");
    return getAssistantSetupAdapter(assistantId).preview(createDetectionContext());
  });

  ipcMain.handle(assistantSetupIpcChannels.apply, async (event, previewToken: unknown) => {
    assertAllowedSetupSender(event);
    const parsed = parsePreviewToken(previewToken);
    if (!parsed) throw new Error("Invalid preview token.");
    return getAssistantSetupAdapter(parsed.assistantId).apply(createDetectionContext(), { previewToken: parsed.token });
  });

  ipcMain.handle(assistantSetupIpcChannels.openDocs, async (event, assistantId: unknown) => {
    assertAllowedSetupSender(event);
    if (!isAssistantId(assistantId)) throw new Error("Invalid assistant id.");
    const docsUrl = getAssistantDocsUrl(assistantId);
    if (!getAllowedAssistantDocsUrls().has(docsUrl)) throw new Error("Assistant docs URL is not allowed.");
    await shell.openExternal(docsUrl);
    return { ok: true };
  });
}

function assertAllowedSetupSender(event: IpcMainInvokeEvent) {
  if (!allowedSetupWebContentsIds.has(event.sender.id)) {
    throw new Error("Assistant setup is not available from this window.");
  }
}
