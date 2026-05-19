#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const sharp = require("sharp");

const cwd = process.cwd();
const videosDir = path.join(cwd, "videos");
const candidatesDir = path.join(cwd, "frames");
const bestframesDir = path.join(cwd, "public", "bestframes");
const metadataPath = path.join(bestframesDir, "metadata.json");
const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm"]);
const maxFramesPerVideo = Number(process.env.MAX_FRAMES_PER_VIDEO || 12);
const extractFps = process.env.EXTRACT_FPS || "1/4";
const minScore = Number(process.env.MIN_FRAME_SCORE || 34);
const minContrast = Number(process.env.MIN_FRAME_CONTRAST || 20);
const minColorRichness = Number(process.env.MIN_FRAME_COLOR || 10);
const minBrightness = Number(process.env.MIN_FRAME_BRIGHTNESS || 24);
const maxBrightness = Number(process.env.MAX_FRAME_BRIGHTNESS || 232);
const nearbyDuplicateDistance = Number(process.env.NEARBY_DUPLICATE_DISTANCE || 0.2);
const globalDuplicateDistance = Number(process.env.GLOBAL_DUPLICATE_DISTANCE || 0.13);
const minAspectRatio = Number(process.env.MIN_FRAME_ASPECT_RATIO || 1.55);
const maxAspectRatio = Number(process.env.MAX_FRAME_ASPECT_RATIO || 2.9);

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
    `fps=${extractFps},scale=960:-1:flags=lanczos`,
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

    if (y < 32) {
      darkPixels += 1;
    }

    if (y > 224) {
      brightPixels += 1;
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
  const saturation = (saturationSum / pixels) * 100;
  const score = Math.round(
    contrast * 0.36 +
      colorRichness * 0.3 +
      Math.max(0, 100 - Math.abs(128 - brightness)) * 0.18 +
      diversity * 100 * 0.1 +
      edgeEnergy * 0.06,
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
    saturation,
    warmth: redAvg - blueAvg,
    width: originalWidth,
    height: originalHeight,
    aspectRatio,
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

function passesQuality(metrics) {
  return (
    metrics.score >= minScore &&
    metrics.contrast >= minContrast &&
    metrics.colorRichness >= minColorRichness &&
    metrics.aspectRatio >= minAspectRatio &&
    metrics.aspectRatio <= maxAspectRatio &&
    metrics.brightness >= minBrightness &&
    metrics.brightness <= maxBrightness &&
    metrics.darkRatio < 0.82 &&
    metrics.brightRatio < 0.82
  );
}

function tagsFor(metrics) {
  return [
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
    "cinematic",
  ].filter(Boolean);
}

function collectionsFor(frame) {
  return Array.from(
    new Set(
      [
        "all frames",
        frame.tags.includes("high-contrast") ? "high contrast" : null,
        frame.tags.includes("dark") ? "noir energy" : null,
        frame.tags.includes("warm") ? "warm palette" : null,
        frame.tags.includes("cold") ? "cold palette" : null,
        frame.tags.includes("scope") ? "scope format" : null,
        frame.tags.includes("widescreen") ? "widescreen" : null,
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
  };
}

async function ingestVideo(videoPath, existingSignatures) {
  const info = videoInfo(videoPath);
  const videoId = slugify(info.id);
  const candidateDir = path.join(candidatesDir, videoId);
  const candidates = await extractCandidates(videoPath, candidateDir);
  const analyzed = [];
  const recentSignatures = [];

  for (const candidate of candidates) {
    const metrics = await imageMetrics(candidate);
    const signature = {
      signature: metrics.signature,
      colorSignature: metrics.colorSignature,
    };

    if (!passesQuality(metrics)) {
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

  return analyzed
    .sort((a, b) => b.metrics.score - a.metrics.score)
    .slice(0, maxFramesPerVideo)
    .map(({ candidate, metrics }, index) => {
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
      fs.copyFileSync(candidate, destination);

      const frame = {
        filename,
        title: info.title,
        score: metrics.score,
        tags: tagsFor(metrics),
        metrics: {
          brightness: Number(metrics.brightness.toFixed(2)),
          colorRichness: Number(metrics.colorRichness.toFixed(2)),
          contrast: Number(metrics.contrast.toFixed(2)),
          diversity: Number(metrics.diversity.toFixed(3)),
          edgeEnergy: Number(metrics.edgeEnergy.toFixed(2)),
          saturation: Number(metrics.saturation.toFixed(2)),
        },
        signature: metrics.signature,
        colorSignature: metrics.colorSignature,
        width: metrics.width,
        height: metrics.height,
        aspectRatio: Number(metrics.aspectRatio.toFixed(4)),
        source: {
          video: path.relative(cwd, videoPath),
          title: info.title,
          url: info.url,
          query: info.query,
        },
      };

      frame.collections = collectionsFor(frame);
      return frame;
    })
    .filter(Boolean);
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

  for (const videoPath of listVideos()) {
    const frames = await ingestVideo(videoPath, signatures);

    for (const frame of frames) {
      byFilename.set(frame.filename, frame);
      newFrames.push(frame);
    }
  }

  const frames = Array.from(byFilename.values()).sort(
    (a, b) => (b.score || 0) - (a.score || 0),
  );

  writeJson(metadataPath, {
    generatedAt: new Date().toISOString(),
    frames,
    collections: buildCollections(frames),
  });

  console.log(
    `Ingest complete: ${newFrames.length} new frames, ${frames.length} total frames.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
