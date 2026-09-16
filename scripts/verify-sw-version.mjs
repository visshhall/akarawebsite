#!/usr/bin/env node
// ============================================================================
// REAL, AUTOMATED GUARD against the exact incident that broke every real
// image/video/font load on this site for a while: a browser's already-
// installed service worker kept enforcing an old, stale copy of the site's
// rules, completely independent of what the live server actually sent —
// because nothing forced its own file content to visibly change, so
// browsers had no real signal that a new version existed at all.
//
// This script runs as part of `npm run build` (see package.json) and does
// ONE real, concrete thing: compares public/sw.js's actual current content
// against the last version this repo shipped (tracked in
// .sw-version-lock, a small, real, checked-in marker file — not a guess,
// not a comment someone has to remember to update by hand). If sw.js's
// real content changed but its own SW_VERSION string inside it did NOT
// change to match, the build FAILS outright, with a clear, real message —
// not a warning that's easy to scroll past.
//
// This deliberately only checks sw.js, not every static asset — Vite's
// own real, content-hashed filenames (e.g. index-Dfvf9msq.js) already
// make ordinary JS/CSS staleness structurally impossible on their own
// (a genuine code change always produces a genuinely new filename,
// confirmed directly against this project's own real build output); a
// service worker is the one real exception, since browsers are
// specifically designed to keep an old one installed and running until
// they're given a real reason to think otherwise.
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SW_PATH = join(__dirname, "..", "public", "sw.js");
const LOCK_PATH = join(__dirname, "..", ".sw-version-lock");

function realHash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function extractVersion(content) {
  const match = content.match(/SW_VERSION\s*=\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

const swContent = readFileSync(SW_PATH, "utf-8");
const currentHash = realHash(swContent);
const currentVersion = extractVersion(swContent);

if (!currentVersion) {
  console.error("\n❌ BUILD FAILED — public/sw.js has no real SW_VERSION constant.");
  console.error("   Every service worker change needs a bumped SW_VERSION string,");
  console.error("   or browsers with an already-installed copy may never notice a");
  console.error("   real update happened. Add: const SW_VERSION = \"YYYY-MM-DD-NN\";\n");
  process.exit(1);
}

if (!existsSync(LOCK_PATH)) {
  // First real run in this repo — record the current real state as the
  // baseline and pass. Nothing to compare against yet.
  writeFileSync(LOCK_PATH, JSON.stringify({ hash: currentHash, version: currentVersion }, null, 2) + "\n");
  console.log(`✓ Service worker version lock created: ${currentVersion}`);
  process.exit(0);
}

const lock = JSON.parse(readFileSync(LOCK_PATH, "utf-8"));

if (lock.hash === currentHash) {
  // Genuinely unchanged since the last real build — nothing to verify.
  console.log(`✓ Service worker unchanged (${currentVersion}) — no version bump needed.`);
  process.exit(0);
}

if (lock.version === currentVersion) {
  // The REAL bug this script exists to catch: sw.js's actual behavior
  // changed, but the version string a browser could use to notice that
  // did NOT — exactly the real, live incident this project already had.
  console.error("\n❌ BUILD FAILED — public/sw.js changed, but SW_VERSION did not.");
  console.error(`   Previous version: ${lock.version}`);
  console.error(`   Current version:  ${currentVersion} (UNCHANGED — this is the bug)`);
  console.error("");
  console.error("   A browser with an already-installed service worker decides");
  console.error("   whether to install a new one by comparing this file's actual");
  console.error("   bytes — not by trusting that something changed. Without a real");
  console.error("   version bump, real customers/admins on browsers that visited");
  console.error("   before this change may keep running the OLD worker indefinitely,");
  console.error("   the exact real incident that once broke every image/video/font");
  console.error("   load on this site silently, for anyone who'd visited before a fix.");
  console.error("");
  console.error("   Fix: bump SW_VERSION in public/sw.js to a new, real value before building.\n");
  process.exit(1);
}

// Changed AND versioned correctly — record the new real state and pass.
writeFileSync(LOCK_PATH, JSON.stringify({ hash: currentHash, version: currentVersion }, null, 2) + "\n");
console.log(`✓ Service worker version correctly bumped: ${lock.version} → ${currentVersion}`);
process.exit(0);
