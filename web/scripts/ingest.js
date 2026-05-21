#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { URL } = require("node:url");
const sharp = require("sharp");

const cwd = process.cwd();
const videosDir = path.join(cwd, "videos");
const candidatesDir = path.join(cwd, "frames");
const bestframesDir = path.join(cwd, "public", "bestframes");
const metadataPath = path.join(bestframesDir, "metadata.json");
const metadataCachePath = path.join(cwd, "scripts", "metadata-cache.json");
const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm"]);
const maxFramesPerVideo = Number(process.env.MAX_FRAMES_PER_VIDEO || 12);
const extractFps = process.env.EXTRACT_FPS || "1/4";
const minScore = Number(process.env.MIN_FRAME_SCORE || 42);
const minContrast = Number(process.env.MIN_FRAME_CONTRAST || 24);
const minColorRichness = Number(process.env.MIN_FRAME_COLOR || 14);
const minBrightness = Number(process.env.MIN_FRAME_BRIGHTNESS || 24);
const maxBrightness = Number(process.env.MAX_FRAME_BRIGHTNESS || 232);
const minFrameWidth = Number(process.env.MIN_FRAME_WIDTH || 1920);
const minFrameHeight = Number(process.env.MIN_FRAME_HEIGHT || 1080);
const minSharpness = Number(process.env.MIN_FRAME_SHARPNESS || 22);
const minMainFeedScore = Number(process.env.MIN_MAIN_FEED_SCORE || 58);
const nearbyDuplicateDistance = Number(process.env.NEARBY_DUPLICATE_DISTANCE || 0.2);
const globalDuplicateDistance = Number(process.env.GLOBAL_DUPLICATE_DISTANCE || 0.13);
const minAspectRatio = Number(process.env.MIN_FRAME_ASPECT_RATIO || 1.55);
const maxAspectRatio = Number(process.env.MAX_FRAME_ASPECT_RATIO || 2.9);
const blockedFramePattern =
  /tutorial|how\s+to|techniques?|tips|lens|telephoto|shot\s*\d|rule\s*of\s*thirds|diagram|breakdown|camera|bts|behind|framing|composition|setup|review|commercial\s+filmmaking|filmmaking|best\s+scenes|compilation|upcoming|trailers\s+2026|only\s+the\s+best|fight\s+scene|final\s+battle|lesson|course|masterclass/i;

function loadEnvFile(file) {
  if (!fs.existsSync(file)) {
    return;
  }

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(cwd, ".env.local"));
loadEnvFile(path.join(cwd, ".env"));

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

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function compactValue(value) {
  if (!value) {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  return compactValue(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

const titleNoisePattern =
  /\b(official|final|new|full|extended|trailer|teaser|clip|promo|scene|movie|film|video|hd|uhd|4k|8k|hdr|imax|dolby|surround|flat|youtube|a24|director'?s?\s+cut|shot\s+on|cinematic|commercial|campaign|tvc)\b/gi;

function cleanTitleCandidate(value) {
  const cleaned = compactValue(value)
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\([^\)]*(official|trailer|teaser|clip|hd|4k|uhd)[^\)]*\)/gi, "")
    .replace(/\([12][0-9]{3}\)/g, "")
    .replace(/#\S+/g, " ")
    .replace(titleNoisePattern, " ")
    .replace(/[#:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return titleCase(cleaned);
}

function titleCandidatesForSource(rawTitle) {
  const source = compactValue(rawTitle);
  const parts = source
    .split(/\s+\|\s+|\s+-\s+|\s+–\s+|\s+—\s+|\/+/)
    .map(cleanTitleCandidate)
    .filter((part) => part.length >= 2 && !/^(trailer|teaser|clip|official)$/i.test(part));
  const full = cleanTitleCandidate(source);

  return Array.from(new Set([full, ...parts]))
    .filter(Boolean)
    .filter((candidate) => candidate.length >= 2)
    .slice(0, 6);
}

function normalizeSourceTitle(rawTitle) {
  return titleCandidatesForSource(rawTitle)[0] || titleCase(rawTitle);
}

function sourceTypeForText(value) {
  const text = compactValue(value).toLowerCase();

  if (/music\s+video/.test(text)) return "music video";
  if (/commercial|advert|ad\b|luxury|fashion\s+film|car\s+commercial/.test(text)) return "commercial";
  if (/series|episode|season|tv\b/.test(text)) return "series";
  if (/short\s+film/.test(text)) return "short film";
  return "film";
}

function productionHouseForInfo(info) {
  const text = `${info.title || ""} ${info.uploader || ""} ${info.channel || ""} ${info.query || ""}`.toLowerCase();

  if (text.includes("a24")) return "A24";
  if (info.channel || info.uploader) return compactValue(info.channel || info.uploader);
  if (text.includes("archive")) return "Internet Archive";
  return "";
}

function releaseYearForInfo(info) {
  const uploadDate = compactValue(info.uploadDate || "");
  const titleYear = compactValue(info.title || "").match(/\b(19|20)\d{2}\b/);

  if (titleYear) return titleYear[0];
  if (/^\d{8}$/.test(uploadDate)) return uploadDate.slice(0, 4);
  return "";
}

function isMissingMetadataValue(value) {
  return (
    !value ||
    /^(unknown|not tagged|archive|metadata unavailable)$/i.test(String(value)) ||
    /\b(archive still|archive frame|color study|light study|shadow study|dream frame|high contrast frame|neon night frame)\b/i.test(
      String(value),
    )
  );
}

function metadataCacheKey(title, sourceType) {
  return slugify(`${sourceType}-${title}`);
}

function mapLegacyMetadata(metadata, originalSource, sourceType) {
  const filmTitle = metadata.filmTitle || metadata.title || "";

  return {
    filmTitle,
    title: filmTitle,
    year: metadata.year || "",
    director: metadata.director || "",
    cinematographer: metadata.cinematographer || "",
    sourceType: metadata.sourceType || sourceType,
    genres: Array.isArray(metadata.genres) ? metadata.genres : [],
    originalSourceTitle: originalSource,
    originalSource,
    productionHouse: metadata.productionHouse || "",
    metadataProvider: metadata.metadataProvider || "local",
    metadataConfidence: metadata.metadataConfidence || (metadata.metadataProvider && metadata.metadataProvider !== "local" ? "high" : "low"),
    metadataVerified: Boolean(metadata.metadataVerified || (metadata.metadataProvider && metadata.metadataProvider !== "local")),
  };
}

function tmdbRequestUrl(pathname, params = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  const baseUrl = `https://api.themoviedb.org/3${pathname}`;
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  if (apiKey && !process.env.TMDB_BEARER_TOKEN) {
    url.searchParams.set("api_key", apiKey);
  }

  return url;
}

async function fetchJsonOrNull(url, headers = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "cinematic-feed/1.0",
        ...headers,
      },
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}

async function fetchTmdbMetadata(title, sourceType) {
  if (!process.env.TMDB_API_KEY && !process.env.TMDB_BEARER_TOKEN) {
    return null;
  }

  const headers = process.env.TMDB_BEARER_TOKEN
    ? { authorization: `Bearer ${process.env.TMDB_BEARER_TOKEN}` }
    : {};
  const searchType = sourceType === "series" ? "tv" : "movie";
  const search = await fetchJsonOrNull(
    tmdbRequestUrl(`/search/${searchType}`, {
      query: title,
      include_adult: "false",
      language: "en-US",
      page: "1",
    }),
    headers,
  );
  const match = search?.results?.[0];

  if (!match?.id) {
    return null;
  }

  const [credits, detail] = await Promise.all([
    fetchJsonOrNull(
      tmdbRequestUrl(`/${searchType}/${match.id}/credits`, { language: "en-US" }),
      headers,
    ),
    fetchJsonOrNull(
      tmdbRequestUrl(`/${searchType}/${match.id}`, { language: "en-US" }),
      headers,
    ),
  ]);
  const crew = Array.isArray(credits?.crew) ? credits.crew : [];
  const director = crew.find((person) => person.job === "Director")?.name || "";
  const cinematographer =
    crew.find((person) =>
      /director of photography|cinematographer|cinematography/i.test(person.job || ""),
    )?.name || "";
  const genres = Array.isArray(detail?.genres)
    ? detail.genres.map((genre) => genre.name).filter(Boolean).slice(0, 4)
    : [];
  const filmTitle = match.title || match.name || title;

  return {
    filmTitle,
    title: filmTitle,
    year: compactValue(match.release_date || match.first_air_date).slice(0, 4),
    director,
    cinematographer,
    sourceType: searchType === "tv" ? "series" : "film",
    genres,
    metadataProvider: "tmdb",
    metadataConfidence: match.vote_count > 3 ? "high" : "medium",
    metadataVerified: true,
  };
}

async function fetchOmdbMetadata(title, sourceType) {
  if (!process.env.OMDB_API_KEY) {
    return null;
  }

  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", process.env.OMDB_API_KEY);
  url.searchParams.set("t", title);
  url.searchParams.set("type", sourceType === "series" ? "series" : "movie");

  const match = await fetchJsonOrNull(url);

  if (!match || match.Response === "False") {
    return null;
  }

  return {
    filmTitle: match.Title || title,
    title: match.Title || title,
    year: match.Year ? String(match.Year).slice(0, 4) : "",
    director: match.Director && match.Director !== "N/A" ? match.Director : "",
    cinematographer: "",
    sourceType: match.Type === "series" ? "series" : sourceType,
    genres: match.Genre && match.Genre !== "N/A" ? match.Genre.split(",").map((genre) => genre.trim()).slice(0, 4) : [],
    metadataProvider: "omdb",
    metadataConfidence: "medium",
    metadataVerified: true,
  };
}

async function enrichSourceMetadata(info, cache) {
  const originalSource = compactValue(info.title);
  const candidates = titleCandidatesForSource(originalSource);
  const normalizedTitle = candidates[0] || normalizeSourceTitle(originalSource);
  const sourceType = sourceTypeForText(`${originalSource} ${info.query}`);
  const key = metadataCacheKey(normalizedTitle, sourceType);

  const hasMetadataApi = Boolean(process.env.TMDB_API_KEY || process.env.TMDB_BEARER_TOKEN || process.env.OMDB_API_KEY);

  if (cache[key] && (cache[key].metadataVerified || !hasMetadataApi)) {
    const mapped = mapLegacyMetadata(cache[key], originalSource, sourceType);
    cache[key] = mapped;
    return mapped;
  }

  let remoteMetadata = null;

  for (const candidate of candidates) {
    remoteMetadata =
      (await fetchTmdbMetadata(candidate, sourceType)) ||
      (await fetchOmdbMetadata(candidate, sourceType));

    if (remoteMetadata) {
      break;
    }
  }

  const fallback = {
    filmTitle: normalizedTitle || "Unverified metadata",
    title: normalizedTitle || "Unverified metadata",
    year: releaseYearForInfo(info),
    director: "",
    cinematographer: "",
    sourceType,
    genres: [],
    metadataProvider: "local",
    metadataConfidence: "low",
    metadataVerified: false,
  };
  const metadata = {
    ...fallback,
    ...(remoteMetadata || {}),
    productionHouse: productionHouseForInfo(info),
    originalSourceTitle: originalSource,
    originalSource,
  };

  cache[key] = metadata;
  return metadata;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function toHex(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

function listVideos() {
  if (!fs.existsSync(videosDir)) {
    return [];
  }

  return fs
    .readdirSync(videosDir)
    .filter((file) => videoExtensions.has(path.extname(file).toLowerCase()))
    .map((file) => path.join(videosDir, file));
}

function normalizeMetadata(metadata) {
  if (Array.isArray(metadata)) {
    return { frames: metadata, collections: [] };
  }

  if (metadata && typeof metadata === "object") {
    return {
      frames: Array.isArray(metadata.frames) ? metadata.frames : [],
      collections: Array.isArray(metadata.collections) ? metadata.collections : [],
    };
  }

  return { frames: [], collections: [] };
}

async function extractCandidates(videoPath, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  // Low fps extraction keeps the pipeline cheap while still surfacing strong
  // scene candidates for ranking.
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=${extractFps},scale='if(gt(iw\\,1920)\\,1920\\,iw)':-2:flags=lanczos`,
    "-q:v",
    "3",
    path.join(outputDir, "candidate_%05d.jpg"),
  ]);

  return fs
    .readdirSync(outputDir)
    .filter((file) => file.endsWith(".jpg"))
    .map((file) => path.join(outputDir, file));
}

async function imageMetrics(imagePath) {
  const width = 64;
  const height = 36;
  const metadata = await sharp(imagePath).metadata();
  const originalWidth = metadata.width || 0;
  const originalHeight = metadata.height || 0;
  const aspectRatio = originalHeight ? originalWidth / originalHeight : 0;
  const { data } = await sharp(imagePath)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = width * height;
  const luminance = new Array(pixels);
  let luminanceSum = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let saturationSum = 0;
  let darkPixels = 0;
  let brightPixels = 0;
  let topBar = 0;
  let bottomBar = 0;
  const buckets = new Map();

  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 3;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const y = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);

    luminance[i] = y;
    luminanceSum += y;
    redSum += red;
    greenSum += green;
    blueSum += blue;
    saturationSum += maxChannel === 0 ? 0 : (maxChannel - minChannel) / maxChannel;
    const bucketKey = [red, green, blue].map((channel) => Math.round(channel / 42)).join("-");
    const bucket = buckets.get(bucketKey) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += red;
    bucket.g += green;
    bucket.b += blue;
    buckets.set(bucketKey, bucket);

    if (y < 32) {
      darkPixels += 1;
    }

    if (y > 224) {
      brightPixels += 1;
    }

    if (i < width * 3 && y < 18) {
      topBar += 1;
    }

    if (i >= pixels - width * 3 && y < 18) {
      bottomBar += 1;
    }
  }

  const brightness = luminanceSum / pixels;
  const redAvg = redSum / pixels;
  const greenAvg = greenSum / pixels;
  const blueAvg = blueSum / pixels;
  let luminanceVariance = 0;
  let colorVariance = 0;

  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 3;
    luminanceVariance += (luminance[i] - brightness) ** 2;
    colorVariance +=
      (data[offset] - redAvg) ** 2 +
      (data[offset + 1] - greenAvg) ** 2 +
      (data[offset + 2] - blueAvg) ** 2;
  }

  const contrast = Math.sqrt(luminanceVariance / pixels);
  const colorRichness = Math.sqrt(colorVariance / (pixels * 3));
  const signature = signatureFor(luminance, width, height);
  const colorSignature = colorSignatureFor(data, width, height);
  const diversity = signature.split("").filter((bit) => bit === "1").length / 64;
  const edgeEnergy = edgeEnergyFor(luminance, width, height);
  const sharpness = sharpnessFor(luminance, width, height);
  const blockiness = blockinessFor(luminance, width, height);
  const saturation = (saturationSum / pixels) * 100;
  const palette = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((bucket) => `#${toHex(bucket.r / bucket.count)}${toHex(bucket.g / bucket.count)}${toHex(bucket.b / bucket.count)}`);
  const blackBars = topBar / (width * 3) > 0.72 && bottomBar / (width * 3) > 0.72;
  const blownHighlightRisk = brightPixels / pixels > 0.24 || (brightness > 188 && contrast < 38);
  const textOverlayRisk =
    (sharpness > 44 && edgeEnergy > 24 && brightPixels / pixels > 0.1) ||
    (edgeEnergy > 30 && contrast > 62 && saturation < 22);
  const diagramRisk =
    (brightness > 170 && saturation > 36 && contrast < 48) ||
    (brightness > 155 && sharpness > 36 && colorRichness < 28);
  const compressionRisk = blockiness > 1.32 && sharpness < 24;
  const splitScreenRisk = splitScreenRiskFor(luminance, width, height, contrast);
  const thumbnailStyleRisk =
    (brightness > 166 && saturation > 48 && edgeEnergy > 20 && contrast > 48) ||
    (brightPixels / pixels > 0.18 && saturation > 50 && sharpness > 38);
  const uiGraphicRisk =
    (brightness > 150 && saturation < 18 && edgeEnergy > 28 && sharpness > 42) ||
    (brightness > 180 && contrast < 30 && colorRichness < 20);
  const spatial = spatialLightStats(luminance, width, height, brightness);
  const score = Math.round(
    contrast * 0.36 +
      colorRichness * 0.3 +
      Math.max(0, 100 - Math.abs(128 - brightness)) * 0.18 +
      diversity * 100 * 0.1 +
      edgeEnergy * 0.04 +
      sharpness * 0.02,
  );

  return {
    brightness,
    brightRatio: brightPixels / pixels,
    colorRichness,
    contrast,
    darkRatio: darkPixels / pixels,
    diversity,
    edgeEnergy,
    score,
    signature,
    colorSignature,
    blackBars,
    blockiness,
    blownHighlightRisk,
    compressionRisk,
    diagramRisk,
    splitScreenRisk,
    saturation,
    sharpness,
    palette,
    textOverlayRisk,
    thumbnailStyleRisk,
    uiGraphicRisk,
    warmth: redAvg - blueAvg,
    spatial,
    width: originalWidth,
    height: originalHeight,
    aspectRatio,
  };
}

function moodFor(metrics) {
  if (metrics.warmth < -8 && metrics.saturation > 36 && metrics.contrast > 42) return "cyberpunk";
  if (metrics.warmth > 12 && metrics.warmth < 42 && metrics.saturation > 28) return "teal-orange";
  if (metrics.warmth >= 20) return "amber";
  if (metrics.saturation < 16) return "monochrome";
  if (metrics.brightness > 145 && metrics.saturation > 28) return "dreamcore";
  if (metrics.brightness < 90 || metrics.contrast > 56) return "noir";
  return "teal-orange";
}

function qualityFor(metrics, mood) {
  const composition = Math.min(100, Math.round(metrics.diversity * 72 + metrics.edgeEnergy + metrics.sharpness * 0.24));
  const lightingContrast = Math.min(100, Math.round(metrics.contrast * 1.45));
  const colorHarmony = Math.min(100, Math.round(metrics.colorRichness * 1.15 + metrics.saturation * 0.55));
  const cinematicDepth = Math.min(100, Math.round(metrics.edgeEnergy * 2.2 + metrics.sharpness * 0.32 + (metrics.blackBars ? 20 : 8)));
  const subjectIsolation = Math.min(100, Math.round(lightingContrast * 0.52 + cinematicDepth * 0.32 + (metrics.darkRatio > 0.36 ? 14 : 0)));
  const moodScore = Math.min(100, Math.round((["noir", "cyberpunk", "amber"].includes(mood) ? 76 : 64) + metrics.contrast * 0.24));
  const overall = Math.round(
    composition * 0.18 +
      lightingContrast * 0.2 +
      colorHarmony * 0.17 +
      cinematicDepth * 0.17 +
      subjectIsolation * 0.14 +
      moodScore * 0.14,
  );

  return {
    composition,
    lightingContrast,
    colorHarmony,
    cinematicDepth,
    subjectIsolation,
    mood: moodScore,
    overall,
  };
}

function lightingAnalysisFor(metrics, mood) {
  const subjectX = Number(metrics.spatial.subjectX.toFixed(3));
  const subjectY = Number(metrics.spatial.subjectY.toFixed(3));
  const keySide = metrics.spatial.brightX < subjectX ? "left" : "right";
  const keyVertical = metrics.spatial.brightY < 0.46 ? "front" : "side";
  const keyDirection = `${keyVertical}-${keySide}`;
  const fillDirection = keySide === "left" ? "front-right" : "front-left";
  const backDirection = keySide === "left" ? "back-right" : "back-left";
  const contrastRatio = Number(Math.max(1.2, Math.min(8.5, metrics.contrast / 12)).toFixed(1));
  const keyStrength = Math.max(58, Math.min(96, Math.round(54 + metrics.contrast * 0.62)));
  const fillStrength = Math.max(8, Math.min(48, Math.round(keyStrength / contrastRatio)));
  const rimStrength = Math.max(14, Math.min(72, Math.round(metrics.edgeEnergy * 2.1 + (metrics.blackBars ? 12 : 4))));

  return {
    subject: {
      x: subjectX,
      y: subjectY,
    },
    keyLight: {
      direction: keyDirection,
      strength: keyStrength,
    },
    fillLight: {
      direction: fillDirection,
      strength: fillStrength,
    },
    rimLight: {
      direction: backDirection,
      strength: rimStrength,
    },
    contrastRatio,
    mood,
  };
}

function signatureFor(luminance, width, height) {
  const cells = 8;
  const values = [];

  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      let sum = 0;
      let count = 0;

      for (let py = Math.floor((y * height) / cells); py < Math.floor(((y + 1) * height) / cells); py += 1) {
        for (let px = Math.floor((x * width) / cells); px < Math.floor(((x + 1) * width) / cells); px += 1) {
          sum += luminance[py * width + px];
          count += 1;
        }
      }

      values.push(sum / Math.max(count, 1));
    }
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.map((value) => (value >= average ? "1" : "0")).join("");
}

function colorSignatureFor(data, width, height) {
  const cells = 4;
  const values = [];

  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;

      for (let py = Math.floor((y * height) / cells); py < Math.floor(((y + 1) * height) / cells); py += 1) {
        for (let px = Math.floor((x * width) / cells); px < Math.floor(((x + 1) * width) / cells); px += 1) {
          const offset = (py * width + px) * 3;
          red += data[offset];
          green += data[offset + 1];
          blue += data[offset + 2];
          count += 1;
        }
      }

      values.push(
        [red, green, blue]
          .map((channel) => Math.round(channel / Math.max(count, 1) / 32))
          .join(""),
      );
    }
  }

  return values.join("-");
}

function edgeEnergyFor(luminance, width, height) {
  let total = 0;
  let count = 0;

  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const value = luminance[y * width + x];
      total += Math.abs(value - luminance[y * width + x - 1]);
      total += Math.abs(value - luminance[(y - 1) * width + x]);
      count += 2;
    }
  }

  return total / Math.max(count, 1);
}

function sharpnessFor(luminance, width, height) {
  let sum = 0;
  let squareSum = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = luminance[y * width + x];
      const laplacian =
        center * 4 -
        luminance[y * width + x - 1] -
        luminance[y * width + x + 1] -
        luminance[(y - 1) * width + x] -
        luminance[(y + 1) * width + x];

      sum += laplacian;
      squareSum += laplacian ** 2;
      count += 1;
    }
  }

  const mean = sum / Math.max(count, 1);
  return Math.sqrt(squareSum / Math.max(count, 1) - mean ** 2);
}

function blockinessFor(luminance, width, height) {
  let boundaryDiff = 0;
  let boundaryCount = 0;
  let naturalDiff = 0;
  let naturalCount = 0;

  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const horizontalDiff = Math.abs(luminance[y * width + x] - luminance[y * width + x - 1]);
      const verticalDiff = Math.abs(luminance[y * width + x] - luminance[(y - 1) * width + x]);

      if (x % 8 === 0 || y % 8 === 0) {
        boundaryDiff += horizontalDiff + verticalDiff;
        boundaryCount += 2;
      } else {
        naturalDiff += horizontalDiff + verticalDiff;
        naturalCount += 2;
      }
    }
  }

  return (boundaryDiff / Math.max(boundaryCount, 1)) / (naturalDiff / Math.max(naturalCount, 1));
}

function splitScreenRiskFor(luminance, width, height, contrast) {
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  let vertical = 0;
  let horizontal = 0;

  for (let y = 2; y < height - 2; y += 1) {
    vertical += Math.abs(luminance[y * width + centerX - 1] - luminance[y * width + centerX + 1]);
  }

  for (let x = 2; x < width - 2; x += 1) {
    horizontal += Math.abs(luminance[(centerY - 1) * width + x] - luminance[(centerY + 1) * width + x]);
  }

  vertical /= Math.max(height - 4, 1);
  horizontal /= Math.max(width - 4, 1);

  return (vertical > contrast * 0.72 && vertical > 30) || (horizontal > contrast * 0.72 && horizontal > 30);
}

function spatialLightStats(luminance, width, height, brightness) {
  let subjectWeight = 0;
  let subjectX = 0;
  let subjectY = 0;
  let brightWeight = 0;
  let brightX = 0;
  let brightY = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value = luminance[index];
      const contrastWeight =
        Math.abs(value - brightness) +
        Math.abs(value - luminance[index - 1]) * 0.45 +
        Math.abs(value - luminance[index + 1]) * 0.45 +
        Math.abs(value - luminance[index - width]) * 0.45 +
        Math.abs(value - luminance[index + width]) * 0.45;

      subjectWeight += contrastWeight;
      subjectX += (x / (width - 1)) * contrastWeight;
      subjectY += (y / (height - 1)) * contrastWeight;

      if (value > brightness) {
        const highlightWeight = (value - brightness) ** 1.35;
        brightWeight += highlightWeight;
        brightX += (x / (width - 1)) * highlightWeight;
        brightY += (y / (height - 1)) * highlightWeight;
      }
    }
  }

  return {
    subjectX: subjectWeight ? subjectX / subjectWeight : 0.5,
    subjectY: subjectWeight ? subjectY / subjectWeight : 0.5,
    brightX: brightWeight ? brightX / brightWeight : 0.5,
    brightY: brightWeight ? brightY / brightWeight : 0.32,
  };
}

function signatureDistance(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 1;
  }

  let different = 0;

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      different += 1;
    }
  }

  return different / a.length;
}

function colorSignatureDistance(a, b) {
  if (!a || !b) {
    return 1;
  }

  const aParts = a.split("-");
  const bParts = b.split("-");

  if (aParts.length !== bParts.length) {
    return 1;
  }

  let difference = 0;
  let count = 0;

  for (let i = 0; i < aParts.length; i += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      difference += Math.abs(Number(aParts[i][channel]) - Number(bParts[i][channel]));
      count += 7;
    }
  }

  return difference / Math.max(count, 1);
}

function frameDistance(a, b) {
  if (typeof a === "string") {
    return signatureDistance(a, b.signature || b);
  }

  const luminanceDistance = signatureDistance(a.signature, b.signature);
  const colorDistance = colorSignatureDistance(a.colorSignature, b.colorSignature);

  return luminanceDistance * 0.68 + colorDistance * 0.32;
}

function rejectionReasonFor(metrics) {
  if (metrics.width < minFrameWidth || metrics.height < minFrameHeight) {
    return "lowResolution";
  }

  if (metrics.sharpness < minSharpness || metrics.compressionRisk) {
    return "blur";
  }

  if (
    metrics.blownHighlightRisk ||
    metrics.brightness > maxBrightness ||
    metrics.brightRatio > 0.42 ||
    (metrics.brightness > 174 && metrics.saturation < 18 && metrics.contrast < 34)
  ) {
    return "overexposure";
  }

  if (
    metrics.textOverlayRisk ||
    metrics.diagramRisk ||
    metrics.thumbnailStyleRisk ||
    metrics.uiGraphicRisk ||
    metrics.splitScreenRisk ||
    (metrics.brightness > 175 && metrics.saturation > 42 && metrics.contrast < 46)
  ) {
    return "textGraphicBoard";
  }

  if (
    metrics.score < minScore ||
    metrics.contrast < minContrast ||
    metrics.colorRichness < minColorRichness ||
    metrics.aspectRatio < minAspectRatio ||
    metrics.aspectRatio > maxAspectRatio ||
    metrics.brightness < minBrightness ||
    metrics.darkRatio > 0.82 ||
    (metrics.brightness < 42 && metrics.contrast < 26 && metrics.edgeEnergy < 8)
  ) {
    return "lowQuality";
  }

  return null;
}

function tagsFor(metrics) {
  const mood = moodFor(metrics);
  return [
    mood,
    metrics.warmth > 10 ? "warm" : null,
    metrics.warmth < -8 ? "cold" : null,
    metrics.brightness < 82 ? "dark" : null,
    metrics.brightness > 168 ? "bright" : null,
    metrics.contrast > 58 ? "high-contrast" : null,
    metrics.contrast < 34 ? "low-contrast" : null,
    metrics.saturation > 42 ? "saturated" : null,
    metrics.saturation < 18 ? "muted" : null,
    metrics.colorRichness > 52 ? "color-rich" : null,
    metrics.edgeEnergy > 18 ? "detailed" : null,
    metrics.edgeEnergy < 7 ? "minimal" : null,
    metrics.darkRatio > 0.36 ? "shadow-heavy" : null,
    metrics.brightRatio > 0.22 ? "highlight-heavy" : null,
    metrics.score > 68 ? "editorial-pick" : null,
    metrics.aspectRatio >= 2.2 ? "scope" : "widescreen",
    metrics.blackBars ? "black-bars" : null,
    "cinematic",
  ].filter(Boolean);
}

function collectionsFor(frame) {
  return Array.from(
    new Set(
      [
        "all frames",
        frame.mainFeed ? "main feed" : null,
        frame.metadataVerified ? null : "unverified",
        frame.tags.includes("high-contrast") ? "high contrast" : null,
        frame.tags.includes("dark") ? "noir energy" : null,
        frame.tags.includes("warm") ? "warm palette" : null,
        frame.tags.includes("cold") ? "cold palette" : null,
        frame.tags.includes("scope") ? "scope format" : null,
        frame.tags.includes("widescreen") ? "widescreen" : null,
        frame.mood || null,
        frame.source.query || null,
      ]
        .filter(Boolean)
        .map((item) => item.toLowerCase()),
    ),
  );
}

function videoInfo(videoPath) {
  const info = readJson(videoPath.replace(/\.[^.]+$/, ".info.json"), {});
  const fallbackTitle = path.basename(videoPath, path.extname(videoPath));

  return {
    id: info.id || slugify(fallbackTitle),
    title: info.title || fallbackTitle,
    url: info.webpage_url || info.original_url || "",
    query: info.playlist || info.search_query || "",
    channel: info.channel || "",
    uploader: info.uploader || "",
    uploadDate: info.upload_date || "",
  };
}

function sourceInfoForFrame(frame) {
  const relativeVideo = frame.source?.video || frame.video || "";
  const videoPath = relativeVideo ? path.join(cwd, relativeVideo) : "";

  if (videoPath && fs.existsSync(videoPath)) {
    return videoInfo(videoPath);
  }

  const title =
    frame.originalSourceTitle ||
    frame.originalSource ||
    frame.source?.title ||
    frame.video ||
    frame.title ||
    "";

  return {
    id: slugify(title || frame.filename || "frame"),
    title,
    url: frame.source?.url || "",
    query: frame.source?.query || "",
    channel: "",
    uploader: frame.productionHouse || "",
    uploadDate: "",
  };
}

function archiveTitleFor(frame) {
  const tags = new Set(frame.tags || []);
  const mood = frame.mood || "cinematic";
  const format = frame.aspectRatio >= 2.2 ? "Scope" : "Widescreen";

  if (mood === "cyberpunk") return "Neon Night Frame";
  if (mood === "noir") return tags.has("scope") ? "Noir Scope Study" : "Noir Shadow Study";
  if (mood === "amber") return tags.has("warm") ? "Amber Light Study" : "Amber Archive Frame";
  if (mood === "monochrome") return "Monochrome Archive Still";
  if (mood === "dreamcore") return "Soft Dream Frame";
  if (mood === "teal-orange") return `${format} Color Study`;
  return "Cinematic Archive Still";
}

function createRejectStats() {
  return {
    blur: 0,
    overexposure: 0,
    lowResolution: 0,
    textGraphicBoard: 0,
    lowQuality: 0,
  };
}

function addRejectStats(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] || 0) + value;
  }
}

function logRejectStats(label, stats) {
  console.log(
    `${label} rejects: blur=${stats.blur}, overexposure=${stats.overexposure}, low resolution=${stats.lowResolution}, text/graphic board=${stats.textGraphicBoard}, low quality=${stats.lowQuality}`,
  );
}

async function ingestVideo(videoPath, existingSignatures, totalRejectStats, metadataCache) {
  const info = videoInfo(videoPath);

  if (blockedFramePattern.test(`${info.title} ${info.query}`)) {
    console.log(`Skipping reference/tutorial source: ${info.title}`);
    return [];
  }

  const sourceMetadata = await enrichSourceMetadata(info, metadataCache);

  const videoId = slugify(info.id);
  const candidateDir = path.join(candidatesDir, videoId);
  const candidates = await extractCandidates(videoPath, candidateDir);
  const analyzed = [];
  const recentSignatures = [];
  const rejectStats = createRejectStats();

  for (const candidate of candidates) {
    const metrics = await imageMetrics(candidate);
    const signature = {
      signature: metrics.signature,
      colorSignature: metrics.colorSignature,
    };
    const rejectionReason = rejectionReasonFor(metrics);

    if (rejectionReason) {
      rejectStats[rejectionReason] += 1;
      continue;
    }

    if (
      recentSignatures.some(
        (recentSignature) => frameDistance(recentSignature, signature) < nearbyDuplicateDistance,
      )
    ) {
      continue;
    }

    recentSignatures.push(signature);

    if (recentSignatures.length > 5) {
      recentSignatures.shift();
    }

    analyzed.push({ candidate, metrics });
  }

  addRejectStats(totalRejectStats, rejectStats);
  logRejectStats(info.title, rejectStats);

  const selectedFrames = await Promise.all(analyzed
    .sort((a, b) => b.metrics.score - a.metrics.score)
    .slice(0, maxFramesPerVideo)
    .map(async ({ candidate, metrics }, index) => {
      const mood = moodFor(metrics);
      const quality = qualityFor(metrics, mood);
      const lighting = lightingAnalysisFor(metrics, mood);
      const duplicate = existingSignatures.some(
        (signature) => frameDistance(signature, metrics) < globalDuplicateDistance,
      );

      if (duplicate) {
        return null;
      }

      existingSignatures.push({
        signature: metrics.signature,
        colorSignature: metrics.colorSignature,
      });

      const filename = `${videoId}_${String(index + 1).padStart(2, "0")}.jpg`;
      const destination = path.join(bestframesDir, filename);

      if (!fs.existsSync(destination)) {
        await sharp(candidate)
          .jpeg({ quality: 84, mozjpeg: true })
          .toFile(destination);
      }

      const frame = {
        filename,
        filmTitle: sourceMetadata.filmTitle || sourceMetadata.title || "Unverified metadata",
        title: sourceMetadata.filmTitle || sourceMetadata.title || archiveTitleFor({ mood, tags: tagsFor(metrics), aspectRatio: metrics.aspectRatio }),
        year: sourceMetadata.year || "",
        director: sourceMetadata.director || "",
        cinematographer: sourceMetadata.cinematographer || "",
        sourceType: sourceMetadata.sourceType || sourceTypeForText(`${info.title} ${info.query}`),
        genres: sourceMetadata.genres || [],
        originalSourceTitle: sourceMetadata.originalSourceTitle || sourceMetadata.originalSource || info.title,
        originalSource: sourceMetadata.originalSourceTitle || sourceMetadata.originalSource || info.title,
        productionHouse: sourceMetadata.productionHouse || "",
        metadataProvider: sourceMetadata.metadataProvider || "local",
        metadataConfidence: sourceMetadata.metadataConfidence || "low",
        metadataVerified: Boolean(sourceMetadata.metadataVerified),
        score: Math.max(metrics.score, quality.overall),
        cinematicScore: quality.overall,
        mood,
        lighting,
        palette: metrics.palette,
        quality,
        tags: tagsFor(metrics),
        metrics: {
          brightness: Number(metrics.brightness.toFixed(2)),
          blockiness: Number(metrics.blockiness.toFixed(3)),
          colorRichness: Number(metrics.colorRichness.toFixed(2)),
          contrast: Number(metrics.contrast.toFixed(2)),
          diversity: Number(metrics.diversity.toFixed(3)),
          edgeEnergy: Number(metrics.edgeEnergy.toFixed(2)),
          saturation: Number(metrics.saturation.toFixed(2)),
          sharpness: Number(metrics.sharpness.toFixed(2)),
          blackBars: metrics.blackBars,
          splitScreenRisk: metrics.splitScreenRisk,
          thumbnailStyleRisk: metrics.thumbnailStyleRisk,
          uiGraphicRisk: metrics.uiGraphicRisk,
        },
        signature: metrics.signature,
        colorSignature: metrics.colorSignature,
        width: metrics.width,
        height: metrics.height,
        aspectRatio: Number(metrics.aspectRatio.toFixed(4)),
        source: {
          video: path.relative(cwd, videoPath),
          title: sourceMetadata.originalSourceTitle || sourceMetadata.originalSource || info.title,
          url: info.url,
          query: info.query,
        },
      };

      frame.mainFeed = Boolean(
        frame.metadataVerified &&
          quality.overall >= minMainFeedScore &&
          metrics.score >= minScore &&
          !metrics.textOverlayRisk &&
          !metrics.diagramRisk &&
          !metrics.thumbnailStyleRisk &&
          !metrics.uiGraphicRisk &&
          !metrics.splitScreenRisk,
      );
      frame.collections = collectionsFor(frame);
      return frame;
    }));

  const acceptedFrames = selectedFrames.filter(Boolean);
  console.log(
    `${info.title} accepted: ${acceptedFrames.length}, main feed: ${acceptedFrames.filter((frame) => frame.mainFeed).length}`,
  );
  return acceptedFrames;
}

function buildCollections(frames) {
  const groups = new Map();

  for (const frame of frames) {
    for (const collection of frame.collections || []) {
      const group = groups.get(collection) || {
        name: collection,
        count: 0,
        frames: [],
      };

      group.count += 1;
      group.frames.push(frame.filename);
      groups.set(collection, group);
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

async function main() {
  fs.mkdirSync(videosDir, { recursive: true });
  fs.mkdirSync(candidatesDir, { recursive: true });
  fs.mkdirSync(bestframesDir, { recursive: true });

  const metadata = normalizeMetadata(readJson(metadataPath, {}));
  const byFilename = new Map(metadata.frames.map((frame) => [frame.filename, frame]));
  const signatures = metadata.frames
    .map((frame) => ({
      signature: frame.signature,
      colorSignature: frame.colorSignature,
    }))
    .filter((signature) => signature.signature);
  const newFrames = [];
  const totalRejectStats = createRejectStats();
  const metadataCache = readJson(metadataCachePath, {});

  for (const videoPath of listVideos()) {
    const frames = await ingestVideo(videoPath, signatures, totalRejectStats, metadataCache);

    for (const frame of frames) {
      byFilename.set(frame.filename, frame);
      newFrames.push(frame);
    }
  }

  const frames = (await Promise.all(Array.from(byFilename.values())
    .map(async (frame) => {
      const existingVerified = Boolean(
        frame.metadataVerified ||
          (frame.metadataProvider && frame.metadataProvider !== "local"),
      );
      const shouldEnrich =
        !existingVerified ||
        isMissingMetadataValue(frame.filmTitle || frame.title) ||
        isMissingMetadataValue(frame.director) ||
        isMissingMetadataValue(frame.cinematographer);
      const enriched = shouldEnrich
        ? await enrichSourceMetadata(sourceInfoForFrame(frame), metadataCache)
        : null;
      const originalSource =
        enriched?.originalSourceTitle ||
        frame.originalSourceTitle ||
        frame.originalSource ||
        frame.source?.title ||
        frame.video ||
        frame.title ||
        "";
      const normalizedTitle = normalizeSourceTitle(
        originalSource || enriched?.filmTitle || frame.filmTitle || frame.title || "Unverified metadata",
      );
      const filmTitle = enriched?.filmTitle ||
        (isMissingMetadataValue(frame.filmTitle || frame.title)
        ? isMissingMetadataValue(normalizedTitle)
          ? "Unverified metadata"
          : normalizedTitle
        : frame.filmTitle || frame.title);
      const sourceType = enriched?.sourceType || frame.sourceType || sourceTypeForText(`${originalSource} ${frame.source?.query || ""}`);
      const metadataVerified = Boolean(
        enriched?.metadataVerified ||
          frame.metadataVerified ||
          (frame.metadataProvider && frame.metadataProvider !== "local"),
      );
      const mainFeed = Boolean(
        metadataVerified &&
          (frame.quality?.overall || frame.cinematicScore || frame.score || 0) >= minMainFeedScore &&
          !frame.metrics?.splitScreenRisk &&
          !frame.metrics?.thumbnailStyleRisk &&
          !frame.metrics?.uiGraphicRisk,
      );
      const baseCollections = Array.isArray(frame.collections) ? frame.collections : [];
      const collections = Array.from(
        new Set([
          ...baseCollections,
          mainFeed ? "main feed" : null,
          metadataVerified ? null : "unverified",
        ].filter(Boolean).map((collection) => String(collection).toLowerCase())),
      );

      return {
        ...frame,
        mainFeed,
        filmTitle,
        title: filmTitle,
        year: enriched?.year || frame.year || "",
        director: enriched?.director || (isMissingMetadataValue(frame.director) ? "" : frame.director),
        cinematographer: enriched?.cinematographer || (isMissingMetadataValue(frame.cinematographer) ? "" : frame.cinematographer),
        sourceType,
        genres: enriched?.genres || (Array.isArray(frame.genres) ? frame.genres : []),
        originalSourceTitle: isMissingMetadataValue(originalSource) ? "" : originalSource,
        originalSource: isMissingMetadataValue(originalSource) ? "" : originalSource,
        metadataProvider: enriched?.metadataProvider || frame.metadataProvider || "local",
        metadataConfidence: enriched?.metadataConfidence || frame.metadataConfidence || (metadataVerified ? "medium" : "low"),
        metadataVerified,
        collections,
        productionHouse: isMissingMetadataValue(frame.productionHouse)
          ? productionHouseForInfo({
              title: originalSource,
              query: frame.source?.query || "",
            })
          : frame.productionHouse,
      };
    })))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  writeJson(metadataPath, {
    generatedAt: new Date().toISOString(),
    frames,
    collections: buildCollections(frames),
  });
  writeJson(metadataCachePath, metadataCache);

  console.log(
    `Ingest complete: ${newFrames.length} new frames, ${frames.length} total frames.`,
  );
  console.log(
    `Accepted frames: ${frames.length}. Main feed count: ${frames.filter((frame) => frame.mainFeed).length}. Unverified collection: ${frames.filter((frame) => !frame.metadataVerified).length}.`,
  );
  logRejectStats("Total frame quality", totalRejectStats);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
