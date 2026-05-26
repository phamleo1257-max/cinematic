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
const seedFilmsPath = process.env.SEED_FILMS_PATH || path.join(cwd, "data", "seed-films.json");
const cleanSourceQueries = [
  "official trailer",
  "official clip",
  "scene no commentary",
  "film trailer",
  "movie clip",
  "blu-ray clip",
];
const musicVideoQueries = ["official music video"];
const commercialQueries = ["official commercial", "director's cut", "campaign film"];
const resultsPerQuery = Number(process.env.RESULTS_PER_QUERY || 2);
const targetAcceptedFrames = Number(process.env.TARGET_ACCEPTED_FRAMES || 800);
const providers = (process.env.DISCOVERY_PROVIDERS || "youtube")
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);
const maxArchiveFileMb = Number(process.env.MAX_ARCHIVE_FILE_MB || 350);
const phimfoeDiscoveryEnabled = process.env.PHIMFOE_DISCOVERY === "1";
const phimfoeUrls = (
  process.env.PHIMFOE_URLS ||
  [
    "https://phimfoe.com/",
    "https://phimfoe.com/phim-hot",
    "https://phimfoe.com/phim-moi",
  ].join("|")
)
  .split("|")
  .map((url) => url.trim())
  .filter(Boolean);
const maxPhimfoeTitles = Number(process.env.MAX_PHIMFOE_TITLES || 40);
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
  "gameplay",
  "meme",
  "recap",
  "fan cam",
  "fancam",
  "short edit",
  "edit",
  "tiktok",
  "subtitles compilation",
  "language learning",
];
const preferredSourceTerms = [
  "official trailer",
  "official clip",
  "scene no commentary",
  "film trailer",
  "movie clip",
  "blu-ray clip",
  "official music video",
  "official commercial",
  "director's cut",
  "campaign film",
];
const blockedTitlePattern = `(?i)(${blockedSourceTerms
  .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
  .join("|")})`;
const matchFilter = [
  "duration < 1800",
  `title !~= '${blockedTitlePattern}'`,
  `title ~= '(?i)(official\\s+trailer|official\\s+clip|scene\\s+no\\s+commentary|film\\s+trailer|movie\\s+clip|blu-?ray\\s+clip|official\\s+music\\s+video|official\\s+commercial|directors?\\s+cut|campaign\\s+film)'`,
].join(" & ");

function readSeedFilms() {
  if (process.env.CURATED_FILMS) {
    return process.env.CURATED_FILMS.split("|")
      .map((title) => ({ title: title.trim(), type: "film" }))
      .filter((seed) => seed.title);
  }

  try {
    const seeds = JSON.parse(fs.readFileSync(seedFilmsPath, "utf8"));

    if (!Array.isArray(seeds)) {
      return [];
    }

    return seeds
      .map((seed) => ({
        title: String(seed?.title || "").trim(),
        type: String(seed?.type || "film").trim().toLowerCase(),
      }))
      .filter((seed) => seed.title && !hasBlockedSourceText(seed.title));
  } catch (error) {
    console.warn(`Seed film list unavailable: ${error.message}`);
    return [];
  }
}

function sourceQueriesForSeed(seed) {
  if (seed.type === "music video") {
    return musicVideoQueries;
  }

  if (seed.type === "commercial") {
    return commercialQueries;
  }

  return cleanSourceQueries;
}

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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function cleanDiscoveredFilmTitle(value) {
  return stripTags(value)
    .replace(/\b(vietsub|thuyết minh|lồng tiếng|full hd|hd|4k|bluray|phim mới|xem phim)\b/gi, " ")
    .replace(/\(\s*\d{4}\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulDiscoveredFilmTitle(title) {
  const normalized = title.toLowerCase();

  return (
    title.length >= 3 &&
    title.length <= 90 &&
    !hasBlockedSourceText(title) &&
    !/^(phimfoe|tìm kiếm|phim hot|phim lẻ|phim bộ|phim mới|faq|đăng nhập|xem tất cả)$/i.test(title) &&
    !/(^loại phim|^thể loại|^quốc gia|^năm|^thời lượng|^sắp xếp)/i.test(title) &&
    !normalized.includes("xemphim")
  );
}

function extractPhimfoeTitles(html) {
  const titles = new Set();
  const patterns = [
    /<h[2-4][^>]*>\s*<a[^>]*>(.*?)<\/a>\s*<\/h[2-4]>/gis,
    /<a[^>]+title=["']([^"']+)["'][^>]*>/gis,
    /<img[^>]+alt=["']([^"']+)["'][^>]*>/gis,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const title = cleanDiscoveredFilmTitle(match[1]);

      if (isUsefulDiscoveredFilmTitle(title)) {
        titles.add(title);
      }
    }
  }

  return Array.from(titles);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "cinematic-feed/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${url}`);
  }

  return response.text();
}

async function discoverPhimfoeFilmTitles() {
  if (!phimfoeDiscoveryEnabled) {
    return [];
  }

  const titles = new Set();

  for (const url of phimfoeUrls) {
    try {
      console.log(`Reading PhimFoe titles: ${url}`);
      const html = await fetchText(url);

      for (const title of extractPhimfoeTitles(html)) {
        titles.add(title);

        if (titles.size >= maxPhimfoeTitles) {
          break;
        }
      }
    } catch (error) {
      console.warn(`PhimFoe discovery skipped: ${error.message}`);
    }

    if (titles.size >= maxPhimfoeTitles) {
      break;
    }
  }

  return Array.from(titles);
}

async function resolveQueries() {
  if (process.env.CINEMATIC_QUERIES) {
    return process.env.CINEMATIC_QUERIES.split("|")
      .map((query) => query.trim())
      .filter(Boolean);
  }

  const seedFilms = readSeedFilms();
  const phimfoeFilms = (await discoverPhimfoeFilmTitles()).map((title) => ({
    title,
    type: "film",
  }));
  const uniqueSeeds = new Map();

  for (const seed of [...seedFilms, ...phimfoeFilms]) {
    const key = seed.title.toLowerCase();

    if (!uniqueSeeds.has(key)) {
      uniqueSeeds.set(key, seed);
    }
  }

  if (phimfoeFilms.length > 0) {
    console.log(`PhimFoe discovery added ${phimfoeFilms.length} film titles.`);
  }

  return Array.from(uniqueSeeds.values()).flatMap((seed) =>
    sourceQueriesForSeed(seed).map((suffix) => `${seed.title} ${suffix}`),
  );
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
  const queries = await resolveQueries();
  const maxDiscoveryAttempts = Number(process.env.MAX_DISCOVERY_ATTEMPTS || queries.length);

  if (process.env.DRY_RUN === "1") {
    console.log(
      `Discovery ready: ${providers.join(", ")} providers, ${queries.length} curated/PhimFoe queries, target ${targetAcceptedFrames}, current ${initialAcceptedFrames}, output ${videosDir}`,
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
