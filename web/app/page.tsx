import fs from "node:fs";
import path from "node:path";
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
  };
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

function getFrames(): Frame[] {
  const files = readFrameFiles();
  const metadata = files.length ? readMetadata() : {};

  return files
    .map((filename, index) => {
      const item =
        metadata[filename] ||
        metadata[path.join(publicPath, filename)] ||
        metadata[filename.replace(/\.(jpe?g)$/i, "")] ||
        {};
      const tags = normalizeTags(
        item.tags,
        item.tag,
        item.keywords,
        item.categories,
        item.category,
      );
      const collections = normalizeTags(
        item.collections,
        item.collection,
        item.video,
        tags.includes("high-contrast") ? "high contrast" : null,
        tags.includes("bright") ? "bright frames" : null,
        tags.includes("warm") ? "warm palette" : null,
        tags.includes("cold") ? "cold palette" : null,
      );

      return {
        filename,
        src: `${publicPath}/${filename}`,
        score: scoreFor(filename, item, index),
        title: titleFor(filename, item),
        tags,
        collections,
        metrics: item.metrics || null,
        source: item.source || (item.video ? { title: item.video } : null),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export default function Home() {
  const frames = getFrames();
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
