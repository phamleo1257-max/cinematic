#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const cwd = process.cwd();
const bestframesDir = path.join(cwd, "public", "bestframes");
const rejectedDir = path.join(bestframesDir, "rejected");
const metadataPath = path.join(bestframesDir, "metadata.json");
const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";

function readMetadata() {
  const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  return {
    root: parsed,
    frames: Array.isArray(parsed.frames) ? parsed.frames : Array.isArray(parsed) ? parsed : [],
  };
}

function backupMetadata() {
  const backupDir = path.join(bestframesDir, ".metadata-backups");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `metadata.json.${timestamp}.bak`);

  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(metadataPath, backupPath);
  return backupPath;
}

function statusFor(frame) {
  if (frame.curationStatus) {
    return frame.curationStatus;
  }

  if (frame.mainFeed && (frame.metadataVerified || frame.verifiedMetadata)) {
    return "curated";
  }

  return "raw";
}

function frameFilename(frame) {
  return String(frame.filename || "").replace(/^\/?bestframes\//, "");
}

function writeMetadata(root, frames) {
  const nextRoot = Array.isArray(root)
    ? frames
    : {
        ...root,
        generatedAt: new Date().toISOString(),
        frames,
      };

  fs.writeFileSync(metadataPath, `${JSON.stringify(nextRoot, null, 2)}\n`);
}

const { root, frames } = readMetadata();
const rejected = frames.filter((frame) => statusFor(frame) === "rejected");

if (!rejected.length) {
  console.log("No rejected frames to quarantine.");
  process.exit(0);
}

console.log(`${dryRun ? "Would quarantine" : "Quarantining"} ${rejected.length} rejected frames.`);

if (!dryRun) {
  fs.mkdirSync(rejectedDir, { recursive: true });
  const backupPath = backupMetadata();
  console.log(`Backed up metadata: ${path.relative(cwd, backupPath)}`);
}

const nextFrames = frames.map((frame) => {
  if (statusFor(frame) !== "rejected") {
    return frame;
  }

  const filename = frameFilename(frame);
  const sourcePath = path.join(bestframesDir, filename);
  const targetName = path.basename(filename);
  const targetPath = path.join(rejectedDir, targetName);

  if (!dryRun && fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
    fs.renameSync(sourcePath, targetPath);
  }

  return {
    ...frame,
    filename: `rejected/${targetName}`,
    src: `/bestframes/rejected/${targetName}`,
    curationStatus: "rejected",
    mainFeed: false,
    quarantinedAt: frame.quarantinedAt || new Date().toISOString(),
    collections: Array.from(
      new Set([...(Array.isArray(frame.collections) ? frame.collections : []), "rejected"]),
    ),
  };
});

if (!dryRun) {
  writeMetadata(root, nextFrames);
}

console.log(`${dryRun ? "Dry run complete" : "Quarantine complete"}.`);
