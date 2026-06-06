#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const cwd = process.cwd();
const bestframesDir = path.join(cwd, "public", "bestframes");
const metadataPath = path.join(bestframesDir, "metadata.json");
const reportPath = path.join(cwd, "curation-report.json");

function readMetadata() {
  const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  return Array.isArray(parsed.frames) ? parsed.frames : Array.isArray(parsed) ? parsed : [];
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

function rejectionReasons(frame) {
  const metrics = frame.metrics || {};
  const reasons = [];

  if (metrics.textOverlayRisk) reasons.push("text overlay");
  if (metrics.diagramRisk) reasons.push("diagram");
  if (metrics.splitScreenRisk) reasons.push("split screen");
  if (metrics.thumbnailStyleRisk) reasons.push("thumbnail style");
  if (metrics.uiGraphicRisk) reasons.push("ui graphic");
  if (metrics.blurRisk || metrics.sharpness < 22) reasons.push("blur");
  if (metrics.compressionRisk || metrics.blockiness > 8) reasons.push("compression");
  if (!frame.metadataVerified && !frame.verifiedMetadata) reasons.push("unverified metadata");
  if ((frame.quality?.overall || frame.cinematicScore || frame.score || 0) < 58) reasons.push("low score");

  return reasons.length ? reasons : ["manual rejected"];
}

function topCounts(values, limit = 12) {
  const counts = new Map();

  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

const frames = readMetadata();
const enriched = frames.map((frame) => ({ ...frame, curationStatus: statusFor(frame) }));
const byStatus = {
  curated: enriched.filter((frame) => frame.curationStatus === "curated").length,
  raw: enriched.filter((frame) => frame.curationStatus === "raw").length,
  rejected: enriched.filter((frame) => frame.curationStatus === "rejected").length,
};
const rejected = enriched.filter((frame) => frame.curationStatus === "rejected");
const report = {
  generatedAt: new Date().toISOString(),
  totalFrames: enriched.length,
  byStatus,
  verified: enriched.filter((frame) => frame.metadataVerified || frame.verifiedMetadata).length,
  withDirector: enriched.filter((frame) => frame.director).length,
  withCinematographer: enriched.filter((frame) => frame.cinematographer).length,
  topFilms: topCounts(enriched.map((frame) => frame.filmTitle || frame.title)),
  topCinematographers: topCounts(enriched.map((frame) => frame.cinematographer)),
  topMoods: topCounts(enriched.map((frame) => frame.mood)),
  rejectionReasons: topCounts(rejected.flatMap(rejectionReasons)),
  rejectedFrames: rejected.map((frame) => ({
    filename: frame.filename,
    title: frame.filmTitle || frame.title,
    score: frame.quality?.overall || frame.cinematicScore || frame.score || 0,
    reasons: rejectionReasons(frame),
  })),
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Curation report written: ${path.relative(cwd, reportPath)}`);
console.log(
  `Frames: ${report.totalFrames}. Curated: ${byStatus.curated}. Raw: ${byStatus.raw}. Rejected: ${byStatus.rejected}.`,
);
