#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const cwd = process.cwd();
const videosDir = path.join(cwd, "videos");
const archivePath =
  process.env.DOWNLOAD_ARCHIVE ||
  path.join(cwd, "public", "bestframes", "downloaded.txt");
const queries = (
  process.env.CINEMATIC_QUERIES ||
  [
    "A24 official trailer 4k",
    "cinematic movie scene 4k",
    "film trailer 4k official",
    "music video cinematic 4k official",
    "commercial film 4k director cut",
    "luxury commercial cinematic 4k",
    "car commercial cinematic 4k",
    "fashion film cinematic 4k",
    "sci fi movie scene 4k",
    "neo noir movie scene 4k",
    "award winning short film 4k",
    "movie clip official 4k",
  ].join("|")
)
  .split("|")
  .map((query) => query.trim())
  .filter(Boolean);
const resultsPerQuery = Number(process.env.RESULTS_PER_QUERY || 3);
const blockedTitlePattern =
  "(?i)(tutorial|how\\s+to|techniques?|framing|composition\\s+tips|cinematography\\s+tips|youtube\\s+advice|filmmaking\\s+advice|breakdown|explained|\\bbts\\b|behind\\s+the\\s+scenes|lesson|course|masterclass|gear\\s+review|camera\\s+settings|lighting\\s+setup)";
const matchFilter = [
  "duration < 1800",
  `title !~= '${blockedTitlePattern}'`,
].join(" & ");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function downloadQuery(query) {
  console.log(`Searching YouTube: ${query}`);

  await run("yt-dlp", [
    `ytsearch${resultsPerQuery}:${query}`,
    "--download-archive",
    archivePath,
    "--write-info-json",
    "--no-overwrites",
    "--ignore-errors",
    "--match-filter",
    matchFilter,
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format",
    "mp4",
    "-o",
    path.join(videosDir, "%(id)s.%(ext)s"),
  ]);
}

async function main() {
  fs.mkdirSync(videosDir, { recursive: true });

  if (process.env.DRY_RUN === "1") {
    console.log(`Discovery ready: ${queries.length} queries, output ${videosDir}`);
    return;
  }

  for (const query of queries) {
    await downloadQuery(query);
  }

  if (!process.argv.includes("--no-ingest")) {
    // Newly downloaded videos are ingested immediately so the gallery updates
    // on the next page refresh without a second manual command.
    await run("node", [path.join(cwd, "scripts", "ingest.js")]);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
