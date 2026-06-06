import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import GalleryFeed, { type Frame } from "../../gallery-feed";

type MetadataItem = Partial<Frame> & {
  filename?: string;
  file?: string;
  name?: string;
  path?: string;
  cinematicScore?: number;
  verifiedMetadata?: boolean;
};

type FilmPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const framesDir = path.join(process.cwd(), "public", "bestframes");

function slugify(value?: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function metadataValue(value?: string | number) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === "" ||
    /^(unknown|not tagged|archive|unverified metadata)$/i.test(String(value))
  ) {
    return "Metadata unavailable";
  }

  return String(value);
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function qualityFor(item: MetadataItem): Frame["quality"] {
  const score = Math.round(item.quality?.overall || item.cinematicScore || item.score || 72);

  return {
    composition: Math.round(item.quality?.composition || score),
    lightingContrast: Math.round(item.quality?.lightingContrast || score),
    colorHarmony: Math.round(item.quality?.colorHarmony || score),
    cinematicDepth: Math.round(item.quality?.cinematicDepth || score),
    subjectIsolation: Math.round(item.quality?.subjectIsolation || score),
    mood: Math.round(item.quality?.mood || score),
    overall: score,
  };
}

function readMetadataFrames(): MetadataItem[] {
  const metadataPath = path.join(framesDir, "metadata.json");

  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is MetadataItem => Boolean(item && typeof item === "object"));
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "frames" in parsed &&
      Array.isArray((parsed as { frames?: unknown }).frames)
    ) {
      return (parsed as { frames: unknown[] }).frames.filter(
        (item): item is MetadataItem => Boolean(item && typeof item === "object"),
      );
    }
  } catch {
    return [];
  }

  return [];
}

function frameFilename(item: MetadataItem) {
  return item.filename || item.file || item.name || (item.path ? path.basename(item.path) : "");
}

function frameFromMetadata(item: MetadataItem): Frame | null {
  const filename = frameFilename(item);

  if (!filename || !/\.(jpe?g)$/i.test(filename)) {
    return null;
  }

  const width = Number(item.width || 1920);
  const height = Number(item.height || 1080);
  const filmTitle = item.filmTitle || item.title || "Metadata unavailable";
  const score = Math.round(item.cinematicScore || item.score || item.quality?.overall || 72);

  return {
    filename,
    src: `/bestframes/${filename}`,
    score,
    title: String(filmTitle),
    filmTitle: String(filmTitle),
    productionHouse: item.productionHouse,
    year: item.year,
    director: item.director,
    cinematographer: item.cinematographer,
    productionDesigner: item.productionDesigner,
    originalTitle: item.originalTitle,
    overview: item.overview,
    poster: item.poster,
    backdrop: item.backdrop,
    runtime: item.runtime,
    voteAverage: item.voteAverage,
    productionCountries: normalizeTags(item.productionCountries),
    tmdbId: item.tmdbId,
    sourceConfidence: item.sourceConfidence,
    verifiedMetadata: item.verifiedMetadata,
    sourceType: item.sourceType,
    genres: normalizeTags(item.genres),
    originalSourceTitle: item.originalSourceTitle,
    originalSource: item.originalSource,
    metadataConfidence: item.metadataConfidence,
    metadataVerified: item.metadataVerified,
    curationStatus: item.curationStatus,
    mainFeed: true,
    lens: item.lens,
    mood: item.mood || "cinematic",
    lighting: item.lighting,
    palette: Array.isArray(item.palette) ? item.palette.map(String).slice(0, 5) : ["#111111", "#2a2a2a", "#8a7b62"],
    quality: qualityFor(item),
    tags: normalizeTags(item.tags),
    collections: normalizeTags(item.collections),
    metrics: item.metrics || null,
    source: item.source || null,
    width,
    height,
    aspectRatio: Number(item.aspectRatio || width / Math.max(height, 1)),
  };
}

export function generateStaticParams() {
  const slugs = new Set(
    readMetadataFrames()
      .map((item) => slugify(String(item.filmTitle || item.title || "")))
      .filter(Boolean),
  );

  return Array.from(slugs).map((slug) => ({ slug }));
}

export default async function FilmPage({ params }: FilmPageProps) {
  const { slug } = await params;
  const frames = readMetadataFrames()
    .filter((item) => slugify(String(item.filmTitle || item.title || "")) === slug)
    .map(frameFromMetadata)
    .filter((frame): frame is Frame => frame !== null)
    .sort((a, b) => b.quality.overall - a.quality.overall);

  if (!frames.length) {
    notFound();
  }

  const film = frames[0];

  return (
    <main className="feed-shell film-page-shell">
      {film.backdrop || film.src ? (
        <div
          className="hero-backdrop"
          style={{ backgroundImage: `url(${film.backdrop || film.src})` }}
          aria-hidden="true"
        />
      ) : null}

      <section className="film-hero">
        <Link className="film-back-link" href="/">
          Back to archive
        </Link>
        <div className="film-hero-grid">
          {film.poster ? (
            <img className="film-poster" src={film.poster} alt={`${metadataValue(film.filmTitle)} poster`} />
          ) : null}
          <div className="film-hero-copy">
            <p className="eyebrow">{metadataValue(film.sourceType)} / {frames.length} shots</p>
            <h1>{metadataValue(film.filmTitle || film.title)}</h1>
            <p className="film-overview">{metadataValue(film.overview)}</p>
            <dl className="film-meta-grid">
              <div>
                <dt>Year</dt>
                <dd>{metadataValue(film.year)}</dd>
              </div>
              <div>
                <dt>Director</dt>
                <dd>{metadataValue(film.director)}</dd>
              </div>
              <div>
                <dt>Cinematographer</dt>
                <dd>{metadataValue(film.cinematographer)}</dd>
              </div>
              <div>
                <dt>Genres</dt>
                <dd>{film.genres?.length ? film.genres.join(", ") : metadataValue()}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <GalleryFeed frames={frames} showAllStatuses />
    </main>
  );
}
