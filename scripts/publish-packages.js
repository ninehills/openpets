#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const publish = args.has("--publish");
const dryRunPack = args.has("--pack-dry-run");
const otpArg = process.argv.find((arg) => arg.startsWith("--otp="));
const otp = otpArg?.slice("--otp=".length) || process.env.NPM_CONFIG_OTP || process.env.NPM_OTP;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function discoverPackages() {
  const packagesDir = join(rootDir, "packages");
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(packagesDir, entry.name);
      const pkg = readJson(join(dir, "package.json"));
      return { dir, relDir: relative(rootDir, dir), pkg };
    })
    .filter(({ pkg }) => !pkg.private && pkg.name && pkg.version);
}

function localPackageNames(packages) {
  return new Set(packages.map(({ pkg }) => pkg.name));
}

function localDeps(pkg, names) {
  return Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies })
    .filter(([name]) => names.has(name))
    .map(([name]) => name);
}

function sortByLocalDependencies(packages) {
  const names = localPackageNames(packages);
  const byName = new Map(packages.map((item) => [item.pkg.name, item]));
  const result = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(item) {
    const name = item.pkg.name;
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Circular local package dependency involving ${name}`);
    visiting.add(name);
    for (const depName of localDeps(item.pkg, names)) visit(byName.get(depName));
    visiting.delete(name);
    visited.add(name);
    result.push(item);
  }

  for (const item of packages) visit(item);
  return result;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
    env: { ...process.env, ...(otp ? { NPM_CONFIG_OTP: otp } : {}) },
  });
  return result;
}

function npmVersionExists(name, version) {
  const result = run("npm", ["view", `${name}@${version}`, "version", "--json"]);
  if (result.status === 0) return true;
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (output.includes("E404") || output.includes("404 Not Found")) return false;
  throw new Error(`Could not check ${name}@${version}:\n${output}`);
}

function publishArgsFor(pkg) {
  const args = ["publish"];
  if (pkg.publishConfig?.access === "public" || pkg.name.startsWith("@")) {
    args.push("--access", "public");
  }
  if (otp) args.push("--otp", otp);
  return args;
}

const packages = sortByLocalDependencies(discoverPackages());
const plan = packages.map((item) => ({
  ...item,
  published: npmVersionExists(item.pkg.name, item.pkg.version),
}));
const toPublish = plan.filter((item) => !item.published);

console.log("Package publish status:\n");
for (const item of plan) {
  console.log(`${item.published ? "✓" : "•"} ${item.pkg.name}@${item.pkg.version} ${item.published ? "already published" : "needs publish"} (${item.relDir})`);
}

if (toPublish.length === 0) {
  console.log("\nNothing to publish.");
  process.exit(0);
}

console.log("\nPublish order:");
for (const item of toPublish) console.log(`- ${item.pkg.name}@${item.pkg.version}`);

if (!publish && !dryRunPack) {
  console.log("\nDry run only. To publish missing packages:");
  console.log("  bun run publish:packages -- --publish");
  console.log("\nIf npm asks for OTP, either let npm prompt or pass:");
  console.log("  bun run publish:packages -- --publish --otp=123456");
  console.log("\nTo only dry-run npm tarballs for missing packages:");
  console.log("  bun run publish:packages -- --pack-dry-run");
  process.exit(0);
}

for (const item of toPublish) {
  console.log(`\n${dryRunPack ? "Packing" : "Publishing"} ${item.pkg.name}@${item.pkg.version}...`);
  const commandArgs = dryRunPack ? ["pack", "--dry-run"] : publishArgsFor(item.pkg);
  const result = run("npm", commandArgs, { cwd: item.dir, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nDone.");
