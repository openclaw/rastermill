#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const target = process.argv[2];

if (!target) {
  console.error("usage: package-smoke.mjs <tarball-or-directory>");
  process.exit(1);
}

const tarball = await resolveTarball(target);
const workspace = await mkdtemp(path.join(os.tmpdir(), "rastermill-package-smoke-"));

try {
  await writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
    "utf8",
  );
  await execFileAsync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--package-lock=false", tarball],
    {
      cwd: workspace,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const smoke = `
    const rastermill = await import("rastermill");
    const expected = [
      "createRastermill",
      "encode",
      "probe",
      "readImageMetadataFromHeader",
      "readImageProbeFromHeader",
      "transparency",
    ];
    for (const name of expected) {
      if (typeof rastermill[name] !== "function") {
        throw new Error(\`missing export: \${name}\`);
      }
    }
    console.log("package smoke ok");
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", smoke], {
    cwd: workspace,
    maxBuffer: 10 * 1024 * 1024,
  });
  process.stdout.write(stdout);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function resolveTarball(input) {
  const absolute = path.resolve(input);
  const info = await stat(absolute);
  if (info.isFile()) {
    return absolute;
  }
  if (!info.isDirectory()) {
    throw new Error(`not a tarball or directory: ${input}`);
  }
  const names = (await readdir(absolute)).filter((name) =>
    /^rastermill-\d+\.\d+\.\d+.*\.tgz$/.test(name),
  );
  const candidates = await Promise.all(
    names.map(async (name) => {
      const file = path.join(absolute, name);
      return { file, mtimeMs: (await stat(file)).mtimeMs };
    }),
  );
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file));
  if (candidates.length === 0) {
    throw new Error(`no rastermill tarballs found in ${input}`);
  }
  return candidates[0].file;
}
