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
const providers = (process.env.DISCOVERY_PROVIDERS || "archive,youtube")
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
  "fashion film",
  "luxury commercial",
  "car commercial",
  "short film",
  "music video",
  "a24",
  "noir",
  "sci-fi",
  "sci fi",
  "director cut",
  "director's cut",
];
const blockedTitlePattern = `(?i)(${blockedSourceTerms
  .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
  .join("|")})`;
const matchFilter = [
  "duration < 1800",
  `title !~= '${blockedTitlePattern}'`,
].join(" & ");

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

  if (process.env.DRY_RUN === "1") {
    console.log(
      `Discovery ready: ${providers.join(", ")} providers, ${queries.length} queries, output ${videosDir}`,
    );
    return;
  }

  if (providers.includes("archive")) {
    for (const query of queries) {
      await downloadArchiveQuery(query, downloaded);
    }
  }

  if (providers.includes("youtube")) {
    for (const query of queries) {
      try {
        await downloadQuery(query);
      } catch (error) {
        console.warn(`YouTube query skipped: ${error.message}`);
      }
    }
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
