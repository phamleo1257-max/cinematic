import fs from "node:fs";
import path from "node:path";
import CurationReview, { type ReviewShot } from "./review";

const metadataPath = path.join(process.cwd(), "public", "bestframes", "metadata.json");

export const dynamic = "force-dynamic";

type MetadataFrame = {
  filename?: string;
  filmTitle?: string;
  title?: string;
  year?: string;
  director?: string;
  cinematographer?: string;
  source?: {
    url?: string;
    title?: string;
  };
  originalSourceTitle?: string;
  metadataConfidence?: string;
  sourceConfidence?: number;
  curationStatus?: string;
  metadataVerified?: boolean;
  verifiedMetadata?: boolean;
  quality?: {
    overall?: number;
  };
  cinematicScore?: number;
  score?: number;
};

function readShots(): ReviewShot[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
      frames?: MetadataFrame[];
    };
    const frames = Array.isArray(parsed.frames) ? parsed.frames : [];

    return frames
      .filter((frame) => frame.filename)
      .map((frame) => ({
        filename: String(frame.filename),
        src: `/bestframes/${frame.filename}`,
        filmTitle: frame.filmTitle || frame.title || "Metadata unavailable",
        year: frame.year || "",
        director: frame.director || "",
        cinematographer: frame.cinematographer || "",
        sourceUrl: frame.source?.url || "",
        sourceTitle: frame.originalSourceTitle || frame.source?.title || "",
        metadataConfidence: frame.metadataConfidence || "",
        sourceConfidence: frame.sourceConfidence || 0,
        curationStatus: frame.curationStatus || (frame.metadataVerified || frame.verifiedMetadata ? "curated" : "raw"),
        verified: Boolean(frame.metadataVerified || frame.verifiedMetadata),
        score: Math.round(frame.quality?.overall || frame.cinematicScore || frame.score || 0),
      }));
  } catch {
    return [];
  }
}

export default function AdminCurationPage() {
  const shots = readShots();

  return (
    <main className="admin-curation-shell">
      <section className="admin-curation-hero">
        <p className="eyebrow">Internal archive review</p>
        <h1>Curation Desk</h1>
        <p>
          Review frame status before it enters the public cinematic feed. Main feed only accepts curated and verified
          shots.
        </p>
      </section>
      <CurationReview initialShots={shots} />
    </main>
  );
}
