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

function isCinematicFrame(frame: Frame) {
  return (
    frame.aspectRatio >= 1.55 &&
    frame.aspectRatio <= 2.9 &&
    !isReferenceFrame(frame)
  );
}

function isReferenceFrame(frame: Frame) {
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

function isFrameDraft(frame: Partial<Frame>): frame is Frame {
  return (
    typeof frame.filename === "string" &&
    typeof frame.src === "string" &&
    typeof frame.score === "number" &&
    typeof frame.title === "string" &&
    Array.isArray(frame.tags) &&
    Array.isArray(frame.collections) &&
    typeof frame.width === "number" &&
    typeof frame.height === "number" &&
    typeof frame.aspectRatio === "number"
  );
}

async function getFrames(): Promise<Frame[]> {
  const files = readFrameFiles();
  const metadata = files.length ? readMetadata() : {};
  const frames = await Promise.all(
    files.map(async (filename, index) => {
    const item =
      metadata[filename] ||
      metadata[path.join(publicPath, filename)] ||
      metadata[filename.replace(/\.(jpe?g)$/i, "")] ||
      {};
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
      title: titleFor(filename, item),
      metrics: item.metrics || null,
      source: item.source || (item.video ? { title: item.video } : null),
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio: dimensions.aspectRatio,
    };
    const frameDraft = {
      ...baseFrame,
      tags: sourceTags,
      collections: normalizeTags(item.collections, item.collection, item.video),
    };
    const referenceFrame = isFrameDraft(frameDraft) && isReferenceFrame(frameDraft);
    const tags = normalizeTags(
      sourceTags,
      dimensions.aspectRatio >= 2.2 ? "scope" : "widescreen",
      "cinematic",
      referenceFrame ? "reference-board" : null,
    );
    const collections = normalizeTags(
      item.collections,
      item.collection,
      item.video,
      referenceFrame ? "reference boards" : null,
      tags.includes("scope") ? "scope format" : "widescreen",
      tags.includes("high-contrast") ? "high contrast" : null,
      tags.includes("bright") ? "bright frames" : null,
      tags.includes("warm") ? "warm palette" : null,
      tags.includes("cold") ? "cold palette" : null,
    );

    return {
      ...baseFrame,
      tags,
      collections,
    };
  }));

  return frames
    .filter(isCinematicFrame)
    .sort((a, b) => b.score - a.score);
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
