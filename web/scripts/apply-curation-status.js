#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const cwd = process.cwd();
const bestframesDir = path.join(cwd, "public", "bestframes");
const metadataPath = path.join(bestframesDir, "metadata.json");
const minMainFeedScore = Number(process.env.MIN_MAIN_FEED_SCORE || 58);
const blockedFramePattern =
  /tutorial|how\s+to|techniques?|tips|lens|telephoto|shot\s*\d|rule\s*of\s*thirds|diagram|breakdown|camera|bts|behind|framing|composition|setup|review|commercial\s+filmmaking|filmmaking|best\s+scenes|compilation|upcoming|trailers\s+2026|only\s+the\s+best|fight\s+scene|final\s+battle|lesson|course|masterclass/i;

function readMetadata() {
  const root = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const frames = Array.isArray(root.frames) ? root.frames : Array.isArray(root) ? root : [];
  return { root, frames };
}

function backupMetadata() {
  const backupDir = path.join(bestframesDir, ".metadata-backups");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `metadata.json.${timestamp}.bak`);

  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(metadataPath, backupPath);
  console.log(`Backed up metadata: ${path.relative(cwd, backupPath)}`);
}

function curationStatusForFrame(frame) {
  const metrics = frame.metrics || {};
  const qualityScore = frame.quality?.overall || frame.cinematicScore || frame.score || 0;
  const verified = Boolean(frame.metadataVerified || frame.verifiedMetadata);
  const searchable = [
    frame.filename,
    frame.title,
    frame.filmTitle,
    frame.originalSourceTitle,
    frame.originalSource,
    frame.source?.title,
    frame.source?.query,
    ...(Array.isArray(frame.tags) ? frame.tags : []),
    ...(Array.isArray(frame.collections) ? frame.collections : []),
  ]
    .filter(Boolean)
    .join(" ");
  const rejected = Boolean(
    metrics.textOverlayRisk ||
      metrics.diagramRisk ||
      metrics.splitScreenRisk ||
      metrics.thumbnailStyleRisk ||
      metrics.uiGraphicRisk ||
      metrics.blurRisk ||
      metrics.compressionRisk ||
      blockedFramePattern.test(searchable),
  );

  if (rejected) {
    return "rejected";
  }

  if (verified && qualityScore >= minMainFeedScore) {
    return "curated";
  }

  return "raw";
}

function collectionsFor(frame, status) {
  const existing = Array.isArray(frame.collections) ? frame.collections : [];
  return Array.from(
    new Set(
      [
        ...existing.filter((collection) => !/^curated$|^raw$|^rejected$|^main feed$/i.test(String(collection))),
        status,
        status === "curated" ? "main feed" : null,
        status === "rejected" ? "rejected" : null,
        frame.metadataVerified || frame.verifiedMetadata ? null : "unverified",
      ]
        .filter(Boolean)
        .map((collection) => String(collection).toLowerCase()),
    ),
  );
}

const { root, frames } = readMetadata();
const nextFrames = frames.map((frame) => {
  const curationStatus = curationStatusForFrame(frame);

  return {
    ...frame,
    curationStatus,
    mainFeed: curationStatus === "curated",
    collections: collectionsFor(frame, curationStatus),
  };
});

backupMetadata();
const nextRoot = Array.isArray(root)
  ? nextFrames
  : {
      ...root,
      generatedAt: new Date().toISOString(),
      frames: nextFrames,
    };

fs.writeFileSync(metadataPath, `${JSON.stringify(nextRoot, null, 2)}\n`);
console.log(
  `Applied curation status. Curated=${nextFrames.filter((frame) => frame.curationStatus === "curated").length}, raw=${nextFrames.filter((frame) => frame.curationStatus === "raw").length}, rejected=${nextFrames.filter((frame) => frame.curationStatus === "rejected").length}.`,
);
