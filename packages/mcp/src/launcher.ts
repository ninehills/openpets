import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DesktopLauncher = () => Promise<void>;

export async function launchOpenPetsDesktop() {
  const mainPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop/dist/main.js");
  if (!existsSync(mainPath)) {
    throw new Error("OpenPets desktop build is missing");
  }

  const child = spawn("bunx", ["electron", mainPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function sleep(ms: number) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
