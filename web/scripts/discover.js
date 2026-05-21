#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const cwd = process.cwd();
const videosDir = path.join(cwd, "videos");
const archivePath =
  process.env.DOWNLOAD_ARCHIVE ||
  path.join(cwd, "public", "bestframes", "downloaded.txt");
const curatedFilms = (
  process.env.CURATED_FILMS ||
  [
    "Blade Runner 2049",
    "Dune",
    "Dune Part Two",
    "The Batman",
    "Skyfall",
    "Oppenheimer",
    "Arrival",
    "Sicario",
    "Drive",
    "Her",
    "La La Land",
    "The Revenant",
    "No Country for Old Men",
    "Joker",
    "1917",
    "Interstellar",
    "Mission Impossible Fallout",
    "Mad Max Fury Road",
    "The Creator",
    "John Wick 4",
  ].join("|")
)
  .split("|")
  .map((film) => film.trim())
  .filter(Boolean);
const cleanSourceQueries = [
  "official trailer",
  "official clip",
  "scene no commentary",
  "film trailer",
];
const queries = (
  process.env.CINEMATIC_QUERIES ||
  curatedFilms
    .flatMap((film) => cleanSourceQueries.map((suffix) => `${film} ${suffix}`))
    .join("|")
)
  .split("|")
  .map((query) => query.trim())
  .filter(Boolean);
const resultsPerQuery = Number(process.env.RESULTS_PER_QUERY || 2);
const targetAcceptedFrames = Number(process.env.TARGET_ACCEPTED_FRAMES || 800);
const maxDiscoveryAttempts = Number(process.env.MAX_DISCOVERY_ATTEMPTS || queries.length);
const providers = (process.env.DISCOVERY_PROVIDERS || "youtube")
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);
const maxArchiveFileMb = Number(process.env.MAX_ARCHIVE_FILE_MB || 350);
const blockedSourceTerms = [
  "tutorial",
  "how to",
  "technique",
  "techniques",
  "tips",
  "framing",
  "setup",
  "review",
  "camera",
  "reaction",
  "filmmaking",
  "commercial filmmaking",
  "best scenes",
  "compilation",
  "upcoming",
  "trailers 2026",
  "only the best",
  "fight scene",
  "final battle",
  "composition tips",
  "cinematography tips",
  "youtube advice",
  "filmmaking advice",
  "breakdown",
  "explained",
  "text overlay",
  "bts",
  "behind the scenes",
  "lesson",
  "course",
  "masterclass",
  "gear review",
  "camera settings",
  "lighting setup",
];
const preferredSourceTerms = [
  "official trailer",
  "official clip",
  "scene no commentary",
  "film trailer",
];
const blockedTitlePattern = `(?i)(${blockedSourceTerms
  .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
  .join("|")})`;
const matchFilter = [
  "duration < 1800",
  `title !~= '${blockedTitlePattern}'`,
  `title ~= '(?i)(official\\s+trailer|official\\s+clip|scene\\s+no\\s+commentary|film\\s+trailer)'`,
].join(" & ");

function currentAcceptedFrameCount() {
  const metadataPath = path.join(cwd, "public", "bestframes", "metadata.json");

  try {
    if (!fs.existsSync(metadataPath)) {
      return 0;
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const frames = Array.isArray(metadata.frames) ? metadata.frames : Array.isArray(metadata) ? metadata : [];
    return frames.filter((frame) => frame.mainFeed !== false && frame.metadataVerified).length;
  } catch {
    return 0;
  }
}

function hasBlockedSourceText(value) {
  const normalized = String(value || "").toLowerCase();
  return blockedSourceTerms.some((term) => normalized.includes(term));
}

function hasPreferredSourceText(value) {
  const normalized = String(value || "").toLowerCase();
  return preferredSourceTerms.some((term) => normalized.includes(term));
}

function readArchive() {
  try {
    if (!fs.existsSync(archivePath)) {
      return new Set();
    }

    return new Set(
      fs
        .readFileSync(archivePath, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function rememberDownload(key) {
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.appendFileSync(archivePath, `${key}\n`);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

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

  console.log(`Downloaded/search completed: ${query}`);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "cinematic-feed/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${url}`);
  }

  return response.json();
}

function archiveSearchUrl(query) {
  const params = new URLSearchParams({
    q: `mediatype:(movies) AND (${query})`,
    fl: "identifier,title,description,downloads,year",
    rows: String(resultsPerQuery),
    page: "1",
    output: "json",
    sort: "downloads desc",
  });

  return `https://archive.org/advancedsearch.php?${params.toString()}`;
}

function isUsableArchiveMovie(file) {
  const name = String(file.name || "");
  const format = String(file.format || "").toLowerCase();
  const sizeMb = Number(file.size || 0) / 1024 / 1024;

  return (
    /\.(mp4|mov|m4v)$/i.test(name) &&
    !/sample|thumb|trailer/i.test(name) &&
    (format.includes("mpeg4") || format.includes("h.264") || format.includes("quicktime")) &&
    sizeMb > 2 &&
    sizeMb <= maxArchiveFileMb
  );
}

async function downloadArchiveItem(item, query, downloaded) {
  const identifier = item.identifier;
  const sourceText = `${item.title || ""} ${item.description || ""} ${query}`;

  if (hasBlockedSourceText(sourceText)) {
    console.log(`Skipping blocked Internet Archive source: ${item.title || identifier}`);
    return false;
  }

  if (!hasPreferredSourceText(sourceText)) {
    console.log(`Skipping low-priority Internet Archive source: ${item.title || identifier}`);
    return false;
  }

  const metadata = await fetchJson(`https://archive.org/metadata/${identifier}`);
  const file = (metadata.files || []).find(isUsableArchiveMovie);

  if (!file) {
    console.log(`No usable Internet Archive video file: ${identifier}`);
    return false;
  }

  const key = `archive ${identifier}/${file.name}`;

  if (downloaded.has(key)) {
    console.log(`Already downloaded: ${key}`);
    return false;
  }

  const filename = `${slugify(identifier)}_${slugify(file.name) || "video"}.mp4`;
  const destination = path.join(videosDir, filename);

  if (fs.existsSync(destination)) {
    rememberDownload(key);
    downloaded.add(key);
    return false;
  }

  const sourceUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${file.name
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  console.log(`Downloading Internet Archive: ${item.title || identifier}`);

  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent": "cinematic-feed/1.0",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status}: ${sourceUrl}`);
  }

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
  fs.writeFileSync(
    destination.replace(/\.[^.]+$/, ".info.json"),
    `${JSON.stringify(
      {
        id: identifier,
        title: item.title || identifier,
        webpage_url: `https://archive.org/details/${identifier}`,
        original_url: sourceUrl,
        search_query: query,
        source: "internet-archive",
      },
      null,
      2,
    )}\n`,
  );

  rememberDownload(key);
  downloaded.add(key);
  return true;
}

async function downloadArchiveQuery(query, downloaded) {
  console.log(`Searching Internet Archive: ${query}`);
  const results = await fetchJson(archiveSearchUrl(query));
  const docs = results?.response?.docs || [];

  for (const item of docs) {
    try {
      await downloadArchiveItem(item, query, downloaded);
    } catch (error) {
      console.warn(`Internet Archive item skipped: ${error.message}`);
    }
  }
}

async function main() {
  fs.mkdirSync(videosDir, { recursive: true });
  const downloaded = readArchive();
  const initialAcceptedFrames = currentAcceptedFrameCount();

  if (process.env.DRY_RUN === "1") {
    console.log(
      `Discovery ready: ${providers.join(", ")} providers, ${queries.length} curated queries, target ${targetAcceptedFrames}, current ${initialAcceptedFrames}, output ${videosDir}`,
    );
    return;
  }

  if (providers.includes("archive")) {
    for (const query of queries) {
      await downloadArchiveQuery(query, downloaded);
    }
  }

  if (providers.includes("youtube")) {
    let attempts = 0;

    for (const query of queries) {
      if (attempts >= maxDiscoveryAttempts || currentAcceptedFrameCount() >= targetAcceptedFrames) {
        break;
      }

      attempts += 1;

      try {
        await downloadQuery(query);
      } catch (error) {
        console.warn(`YouTube query skipped: ${error.message}`);
      }
    }

    console.log(
      `Discovery attempts: ${attempts}/${maxDiscoveryAttempts}. Accepted frames before ingest: ${currentAcceptedFrameCount()}/${targetAcceptedFrames}.`,
    );
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
