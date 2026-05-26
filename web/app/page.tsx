import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import GalleryFeed, { type Frame } from "./gallery-feed";

type MetadataItem = {
  filename?: string;
  file?: string;
  name?: string;
  path?: string;
  title?: string;
  caption?: string;
  scene?: string;
  score?: number;
  rank_score?: number;
  visual_score?: number;
  energy_score?: number;
  aesthetic_score?: number;
  tags?: unknown;
  tag?: unknown;
  keywords?: unknown;
  categories?: unknown;
  category?: unknown;
  collections?: unknown;
  collection?: unknown;
  video?: string;
  filmTitle?: string;
  productionHouse?: string;
  year?: string;
  director?: string;
  cinematographer?: string;
  sourceType?: string;
  genres?: unknown;
  originalSourceTitle?: string;
  originalSource?: string;
  metadataConfidence?: string;
  metadataVerified?: boolean;
  mainFeed?: boolean;
  lens?: string;
  mood?: string;
  lighting?: Frame["lighting"];
  palette?: unknown;
  quality?: Partial<Frame["quality"]>;
  cinematicScore?: number;
  metrics?: {
    brightness?: number;
    colorRichness?: number;
    contrast?: number;
    diversity?: number;
    edgeEnergy?: number;
    saturation?: number;
  };
  width?: number;
  height?: number;
  aspectRatio?: number;
  source?: {
    title?: string;
    url?: string;
    query?: string;
    video?: string;
  };
  frames?: unknown[];
};

type MetadataMap = Record<string, MetadataItem>;
type VideoInfo = {
  title?: string;
  uploader?: string;
  channel?: string;
};

const framesDir = path.join(process.cwd(), "public", "bestframes");
const publicPath = "/bestframes";

function isMetadataItem(value: unknown): value is MetadataItem {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMetadataList(items: unknown[]): MetadataMap {
  return Object.fromEntries(
    items
      .filter(isMetadataItem)
      .map((item) => {
        const key =
          item.filename ||
          item.file ||
          item.name ||
          (item.path ? path.basename(item.path) : null);

        return key ? [key, item] : null;
      })
      .filter((entry): entry is [string, MetadataItem] => entry !== null),
  );
}

function readMetadata(): MetadataMap {
  const metadataPath = path.join(framesDir, "metadata.json");

  try {
    if (!fs.existsSync(metadataPath)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as unknown;

    if (Array.isArray(parsed)) {
      return normalizeMetadataList(parsed);
    }

    if (isRecord(parsed) && Array.isArray(parsed.frames)) {
      return normalizeMetadataList(parsed.frames);
    }

    if (isRecord(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, MetadataItem] =>
          isMetadataItem(entry[1]),
        ),
      );
    }

    return {};
  } catch {
    return {};
  }
}

function readFrameFiles(): string[] {
  try {
    if (!fs.existsSync(framesDir)) {
      return [];
    }

    const stats = fs.statSync(framesDir);

    if (!stats.isDirectory()) {
      return [];
    }

    return fs
      .readdirSync(framesDir)
      .filter((file) => /\.(jpe?g)$/i.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function scoreFor(filename: string, item: MetadataItem, index: number) {
  const rawScore =
    item.cinematicScore ??
    item.quality?.overall ??
    item.score ??
    item.rank_score ??
    item.visual_score ??
    item.energy_score ??
    item.aesthetic_score;

  if (typeof rawScore === "number") {
    return rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore);
  }

  const seed = filename
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), index * 7);

  return 82 + (seed % 18);
}

function titleFor(filename: string, item: MetadataItem) {
  return (
    item.title ||
    item.caption ||
    item.scene ||
    item.video?.replace(/\.[a-z0-9]+$/i, "") ||
    filename.replace(/\.(jpe?g)$/i, "").replace(/[-_]+/g, " ")
  );
}

function readVideoInfo(item: MetadataItem): VideoInfo | null {
  const videoPath = item.source?.video || item.video;

  if (!videoPath) {
    return null;
  }

  const infoPath = path.join(
    process.cwd(),
    videoPath.replace(/\.[a-z0-9]+$/i, ".info.json"),
  );

  try {
    if (!fs.existsSync(infoPath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(infoPath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cleanFilmTitle(rawTitle?: string) {
  if (!rawTitle) {
    return null;
  }

  const firstSegment = rawTitle.split("|")[0] || rawTitle;
  const cleaned = firstSegment
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\([12][0-9]{3}\)/g, "")
    .replace(/\b(official|trailer|promo|teaser|clip|hd|uhd|4k|a24)\b/gi, "")
    .replace(/[-_:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function productionHouseFor(item: MetadataItem, videoInfo: VideoInfo | null) {
  return (
    item.productionHouse ||
    videoInfo?.channel ||
    videoInfo?.uploader ||
    (item.source?.query?.toLowerCase().includes("a24") ? "A24" : null) ||
    "Archive"
  );
}

function cleanMetadataValue(value?: string) {
  if (
    !value ||
    /^(unknown|not tagged|archive)$/i.test(value) ||
    /\b(archive still|archive frame|color study|light study|shadow study|dream frame|high contrast frame|neon night frame)\b/i.test(
      value,
    )
  ) {
    return undefined;
  }

  return value;
}

function normalizeTags(...sources: unknown[]) {
  return Array.from(
    new Set(
      sources
        .flatMap((source) => {
          if (Array.isArray(source)) {
            return source;
          }

          if (typeof source === "string") {
            return source.split(",");
          }

          return [];
        })
        .map((tag) => String(tag).trim())
        .filter(Boolean),
    ),
  );
}

async function imageDimensions(filename: string, item: MetadataItem) {
  const width = item.width;
  const height = item.height;
  const aspectRatio = item.aspectRatio;

  if (width && height && aspectRatio) {
    return { width, height, aspectRatio };
  }

  try {
    const metadata = await sharp(path.join(framesDir, filename)).metadata();
    const imageWidth = metadata.width || 0;
    const imageHeight = metadata.height || 0;

    return {
      width: imageWidth,
      height: imageHeight,
      aspectRatio: imageHeight ? imageWidth / imageHeight : 0,
    };
  } catch {
    return { width: 0, height: 0, aspectRatio: 0 };
  }
}

function toHex(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

async function colorPalette(filename: string, item: MetadataItem) {
  if (Array.isArray(item.palette) && item.palette.length) {
    return item.palette.map(String).slice(0, 5);
  }

  try {
    const { data, info } = await sharp(path.join(framesDir, filename))
      .resize(36, 24, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

    for (let index = 0; index < info.width * info.height; index += 1) {
      const offset = index * 3;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const brightness = (red + green + blue) / 3;

      if (brightness < 8 || brightness > 247) {
        continue;
      }

      const key = [red, green, blue].map((channel) => Math.round(channel / 42)).join("-");
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += red;
      bucket.g += green;
      bucket.b += blue;
      buckets.set(key, bucket);
    }

    return Array.from(buckets.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(
        (bucket) =>
          `#${toHex(bucket.r / bucket.count)}${toHex(bucket.g / bucket.count)}${toHex(
            bucket.b / bucket.count,
          )}`,
      );
  } catch {
    return ["#111111", "#2a2a2a", "#8a7b62"];
  }
}

function moodFor(tags: string[], palette: string[], metrics: MetadataItem["metrics"]) {
  const joined = `${tags.join(" ")} ${palette.join(" ")}`.toLowerCase();
  const brightness = metrics?.brightness || 0;
  const contrast = metrics?.contrast || 0;
  const saturation = metrics?.saturation || 0;

  if (tags.includes("cold") && saturation > 36 && contrast > 42) return "cyberpunk";
  if (tags.includes("warm") && tags.includes("cold")) return "teal-orange";
  if (tags.includes("warm") || /#(8|9|a|b|c|d|e|f)[0-9a-f]{5}/.test(joined)) return "amber";
  if (saturation < 16 || tags.includes("muted")) return "monochrome";
  if (brightness > 145 && saturation > 28) return "dreamcore";
  if (brightness < 90 || tags.includes("dark") || contrast > 56) return "noir";
  return "teal-orange";
}

function qualityFor(item: MetadataItem, tags: string[], mood: string) {
  const metrics = item.metrics || {};
  const composition = Math.min(100, Math.round((metrics.diversity || 0.5) * 80 + (metrics.edgeEnergy || 8)));
  const lightingContrast = Math.min(100, Math.round((metrics.contrast || 34) * 1.45));
  const colorHarmony = Math.min(
    100,
    Math.round((metrics.colorRichness || 28) * 1.15 + (metrics.saturation || 24) * 0.55),
  );
  const cinematicDepth = Math.min(
    100,
    Math.round((metrics.edgeEnergy || 8) * 2.6 + (tags.includes("scope") ? 18 : 8)),
  );
  const subjectIsolation = Math.min(
    100,
    Math.round(lightingContrast * 0.52 + cinematicDepth * 0.32 + (tags.includes("shadow-heavy") ? 14 : 0)),
  );
  const moodScore = Math.min(
    100,
    Math.round((["noir", "cyberpunk", "amber"].includes(mood) ? 76 : 64) + (metrics.contrast || 0) * 0.24),
  );
  const inferred = {
    composition,
    lightingContrast,
    colorHarmony,
    cinematicDepth,
    subjectIsolation,
    mood: moodScore,
    overall: Math.round(
      composition * 0.18 +
        lightingContrast * 0.2 +
        colorHarmony * 0.17 +
        cinematicDepth * 0.17 +
        subjectIsolation * 0.14 +
        moodScore * 0.14,
    ),
  };

  return { ...inferred, ...item.quality };
}

function isCinematicFrame(frame: Frame) {
  return (
    frame.aspectRatio >= 1.55 &&
    frame.aspectRatio <= 2.9 &&
    !isReferenceFrame(frame)
  );
}

function isReferenceFrame(frame: Partial<Frame> & { filename: string; title: string }) {
  const searchable = [
    frame.filename,
    frame.title,
    ...(frame.tags || []),
    ...(frame.collections || []),
    frame.source?.title || "",
    frame.source?.query || "",
  ]
    .join(" ")
    .toLowerCase();
  const metrics = frame.metrics || {};
  const isLikelyGraphic =
    (metrics.brightness || 0) > 175 &&
    (metrics.saturation || 0) > 42 &&
    (metrics.contrast || 0) < 46;

  return (
    isLikelyGraphic ||
    /tutorial|lens|telephoto|shot\s*\d|rule\s*of\s*thirds|diagram|breakdown|camera|bts|behind|framing|composition|technique|setup|lesson|course|masterclass/.test(
      searchable,
    )
  );
}

async function getFrames(): Promise<Frame[]> {
  const files = readFrameFiles();
  const metadata = files.length ? readMetadata() : {};
  const hasReadableMetadata = Object.keys(metadata).length > 0;
  const frames = await Promise.all(
    files.map(async (filename, index) => {
    const item =
      metadata[filename] ||
      metadata[path.join(publicPath, filename)] ||
      metadata[filename.replace(/\.(jpe?g)$/i, "")] ||
      {};
    const videoInfo = readVideoInfo(item);
    const productionHouse = cleanMetadataValue(item.productionHouse) || productionHouseFor(item, videoInfo);
    const filmTitle =
      cleanMetadataValue(item.filmTitle) ||
      cleanMetadataValue(item.title) ||
      cleanFilmTitle(item.originalSourceTitle || item.originalSource || videoInfo?.title || item.source?.title) ||
      titleFor(filename, item);
    const dimensions = await imageDimensions(filename, item);
    const sourceTags = normalizeTags(
      item.tags,
      item.tag,
      item.keywords,
      item.categories,
      item.category,
    );
    const baseFrame = {
      filename,
      src: `${publicPath}/${filename}`,
      score: scoreFor(filename, item, index),
      title: filmTitle,
      filmTitle,
      productionHouse,
      year: item.year,
      cinematographer: item.cinematographer,
      sourceType: item.sourceType,
      genres: normalizeTags(item.genres),
      originalSourceTitle: item.originalSourceTitle || item.originalSource || item.source?.title || videoInfo?.title,
      originalSource: item.originalSourceTitle || item.originalSource || item.source?.title || videoInfo?.title,
      metadataConfidence: item.metadataConfidence,
      metadataVerified: item.metadataVerified,
      mainFeed:
        item.mainFeed ??
        (!hasReadableMetadata ||
          Boolean(item.metadataVerified && (item.quality?.overall || item.cinematicScore || item.score || 0) >= 58)),
      metrics: item.metrics || null,
      source: item.source
        ? {
            ...item.source,
            title: productionHouse,
          }
        : item.video
          ? { title: productionHouse }
          : { title: productionHouse },
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio: dimensions.aspectRatio,
    };
    const frameDraft = {
      ...baseFrame,
      tags: sourceTags,
      collections: normalizeTags(item.collections, item.collection, item.video),
    };
    const referenceFrame = isReferenceFrame(frameDraft);
    const palette = await colorPalette(filename, item);
    const inferredMood = item.mood || moodFor(sourceTags, palette, item.metrics);
    const tags = normalizeTags(
      sourceTags,
      inferredMood,
      dimensions.aspectRatio >= 2.2 ? "scope" : "widescreen",
      "cinematic",
      referenceFrame ? "reference-board" : null,
    );
    const collections = normalizeTags(
      item.collections,
      item.collection,
      item.video,
      baseFrame.mainFeed ? "main feed" : null,
      baseFrame.metadataVerified ? null : "unverified",
      referenceFrame ? "reference boards" : null,
      inferredMood,
      tags.includes("scope") ? "scope format" : "widescreen",
      tags.includes("high-contrast") ? "high contrast" : null,
      tags.includes("bright") ? "bright frames" : null,
      tags.includes("warm") ? "warm palette" : null,
      tags.includes("cold") ? "cold palette" : null,
    );

    const quality = qualityFor(item, tags, inferredMood);

    return {
      ...baseFrame,
      director: cleanMetadataValue(item.director),
      cinematographer: cleanMetadataValue(item.cinematographer),
      lens: item.lens,
      mood: inferredMood,
      lighting: item.lighting,
      palette,
      quality,
      score: Math.max(baseFrame.score, quality.overall),
      tags,
      collections,
    };
  }));

  return frames
    .filter(isCinematicFrame)
    .sort((a, b) => b.quality.overall - a.quality.overall);
}

export default async function Home() {
  const frames = await getFrames();
  const heroFrame = frames[0];

  return (
    <main className="feed-shell">
      {heroFrame ? (
        <div
          className="hero-backdrop"
          style={{ backgroundImage: `url(${heroFrame.src})` }}
          aria-hidden="true"
        />
      ) : null}

      <section className="hero">
        <div>
          <p className="eyebrow">ShotDeck x Pinterest x Netflix</p>
          <h1>CINEMATIC FEED</h1>
          <p className="subtitle">
            AI-curated frames ranked by contrast, color richness, and visual
            energy
          </p>
        </div>
        <div className="hero-stat">
          <span>{frames.length}</span>
          <p>frames</p>
        </div>
      </section>

      <GalleryFeed frames={frames} />
    </main>
  );
}
