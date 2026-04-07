#!/usr/bin/env node
/* eslint-disable */
/**
 * Postinstall hotfix for embedded-postgres on Apple Silicon.
 *
 * The @embedded-postgres/darwin-arm64 platform package (as of
 * 18.3.0-beta.16) ships Mach-O universal binaries that contain both
 * x86_64 and arm64 slices. On some Apple Silicon Macs the universal
 * binary fails to start or hangs under load, which manifests as test
 * suites hanging indefinitely during `pg.start()`.
 *
 * This script thins every Mach-O file in the platform package down to
 * the arm64 slice only using `lipo -thin arm64`. It is a no-op on
 * anything that is not darwin-arm64, on files that are already thin,
 * and on systems without `lipo` (so it never breaks an install).
 *
 * Tracking upstream: https://github.com/leinelissen/embedded-postgres
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

// Bail silently on anything that is not darwin-arm64. The fix only
// applies to Apple Silicon.
if (process.platform !== "darwin" || process.arch !== "arm64") {
  process.exit(0);
}

// Users can opt out via env var (useful for debugging or if upstream
// ever ships fixed binaries and the thinning becomes counterproductive).
if (process.env.POSTGRES_MEMORY_SERVER_SKIP_THIN === "1") {
  process.exit(0);
}

function log(message) {
  // Keep output quiet unless something is actually happening. npm shows
  // postinstall stdout by default; we don't want to spam.
  if (process.env.POSTGRES_MEMORY_SERVER_THIN_VERBOSE === "1") {
    process.stdout.write(`[postgres-memory-server] ${message}\n`);
  }
}

function lipoAvailable() {
  const result = spawnSync("lipo", ["-info", "/dev/null"], {
    stdio: "ignore",
  });
  return result.error === undefined;
}

function findNativeDir() {
  // Resolve the platform package's main entry and walk up to find the
  // `native/` directory. We avoid requiring the package's package.json
  // directly because the package's `exports` field does not expose it.
  let mainEntry;
  try {
    mainEntry = require.resolve("@embedded-postgres/darwin-arm64");
  } catch {
    return null;
  }

  let dir = path.dirname(mainEntry);
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "native");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function isMachO(filePath) {
  // Mach-O magic numbers:
  //   0xfeedface / 0xfeedfacf — single-arch 32/64 bit
  //   0xcafebabe / 0xcafebabf — fat (universal) 32/64 bit
  //   each has a byte-swapped variant as well.
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.readUInt32BE(0);
    return (
      magic === 0xfeedface ||
      magic === 0xfeedfacf ||
      magic === 0xcefaedfe ||
      magic === 0xcffaedfe ||
      magic === 0xcafebabe ||
      magic === 0xcafebabf ||
      magic === 0xbebafeca ||
      magic === 0xbfbafeca
    );
  } catch {
    return false;
  }
}

function isFatBinary(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.readUInt32BE(0);
    return (
      magic === 0xcafebabe ||
      magic === 0xcafebabf ||
      magic === 0xbebafeca ||
      magic === 0xbfbafeca
    );
  } catch {
    return false;
  }
}

function hasArm64Slice(filePath) {
  try {
    const out = execFileSync("lipo", ["-archs", filePath], {
      encoding: "utf8",
    });
    return out.split(/\s+/).includes("arm64");
  } catch {
    return false;
  }
}

function thinToArm64(filePath) {
  const tmpPath = `${filePath}.arm64.tmp`;
  try {
    execFileSync("lipo", ["-thin", "arm64", filePath, "-output", tmpPath], {
      stdio: "ignore",
    });
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }

  // Preserve original permissions (particularly the executable bit).
  const origStat = fs.statSync(filePath);
  fs.chmodSync(tmpPath, origStat.mode);

  fs.renameSync(tmpPath, filePath);
}

function walk(dir, visit) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      // Skip symlinks — they'll be visited via their target directory.
      continue;
    }
    if (entry.isDirectory()) {
      walk(full, visit);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

function main() {
  if (!lipoAvailable()) {
    log("lipo not found in PATH; skipping universal binary thinning");
    return;
  }

  const nativeDir = findNativeDir();
  if (!nativeDir) {
    log("@embedded-postgres/darwin-arm64 not installed; nothing to thin");
    return;
  }

  let scanned = 0;
  let thinned = 0;
  let skipped = 0;
  let failed = 0;

  walk(nativeDir, (filePath) => {
    scanned += 1;
    if (!isMachO(filePath)) {
      return;
    }
    if (!isFatBinary(filePath)) {
      skipped += 1; // already thin
      return;
    }
    if (!hasArm64Slice(filePath)) {
      // Weird — a universal binary without arm64. Leave it alone.
      skipped += 1;
      return;
    }
    try {
      thinToArm64(filePath);
      thinned += 1;
    } catch (err) {
      failed += 1;
      log(`failed to thin ${filePath}: ${err && err.message}`);
    }
  });

  if (thinned > 0 || failed > 0) {
    // Only emit a visible line when we actually did work, to keep
    // normal installs quiet.
    process.stdout.write(
      `[postgres-memory-server] thinned ${thinned} universal binar${
        thinned === 1 ? "y" : "ies"
      } to arm64` +
        (failed > 0 ? ` (${failed} failed)` : "") +
        `\n`,
    );
  } else {
    log(
      `nothing to do (${scanned} files scanned, ${skipped} already thin)`,
    );
  }
}

try {
  main();
} catch (err) {
  // Never break an install. Print a warning and move on.
  process.stderr.write(
    `[postgres-memory-server] postinstall warning: ${
      (err && err.message) || err
    }\n`,
  );
}
