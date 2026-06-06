"use client";

import { useMemo, useState } from "react";

type CurationStatus = "curated" | "raw" | "rejected";
type ReviewTab = "queue" | CurationStatus;

export type ReviewShot = {
  filename: string;
  src: string;
  filmTitle: string;
  year: string;
  director: string;
  cinematographer: string;
  sourceUrl: string;
  sourceTitle: string;
  metadataConfidence: string;
  sourceConfidence: number;
  curationStatus: string;
  verified: boolean;
  score: number;
};

type CurationReviewProps = {
  initialShots: ReviewShot[];
};

const statusTabs: CurationStatus[] = ["curated", "raw", "rejected"];
const tabs: ReviewTab[] = ["queue", ...statusTabs];

function confidenceLabel(shot: ReviewShot) {
  if (shot.sourceConfidence) {
    return `${Math.round(shot.sourceConfidence * 100)}%`;
  }

  return shot.metadataConfidence || "low";
}

function confidenceScore(shot: ReviewShot) {
  if (shot.sourceConfidence) {
    return shot.sourceConfidence;
  }

  const normalized = shot.metadataConfidence.toLowerCase();

  if (normalized === "high") return 0.9;
  if (normalized === "medium") return 0.62;
  if (normalized === "low") return 0.28;
  return 0;
}

function missingMetadataCount(shot: ReviewShot) {
  return [shot.director, shot.cinematographer].filter((value) => !value).length;
}

function reviewPriority(shot: ReviewShot) {
  const missingPenalty = missingMetadataCount(shot) * 100;
  const confidenceBoost = confidenceScore(shot) * 80;
  const scoreBoost = shot.score;

  return Math.round(missingPenalty + confidenceBoost + scoreBoost);
}

export default function CurationReview({ initialShots }: CurationReviewProps) {
  const [shots, setShots] = useState(initialShots);
  const [activeTab, setActiveTab] = useState<ReviewTab>("queue");
  const [dryRun, setDryRun] = useState(true);
  const [message, setMessage] = useState("");
  const counts = useMemo(
    () =>
      ({
        queue: shots.filter((shot) => shot.curationStatus === "raw").length,
        curated: shots.filter((shot) => shot.curationStatus === "curated").length,
        raw: shots.filter((shot) => shot.curationStatus === "raw").length,
        rejected: shots.filter((shot) => shot.curationStatus === "rejected").length,
      }),
    [shots],
  );
  const visibleShots = useMemo(() => {
    if (activeTab === "queue") {
      return shots
        .filter((shot) => shot.curationStatus === "raw")
        .sort((a, b) => {
          const missingDelta = missingMetadataCount(b) - missingMetadataCount(a);

          if (missingDelta) return missingDelta;

          const confidenceDelta = confidenceScore(b) - confidenceScore(a);

          if (confidenceDelta) return confidenceDelta;

          return b.score - a.score;
        });
    }

    return shots.filter((shot) => shot.curationStatus === activeTab);
  }, [activeTab, shots]);

  async function updateStatus(filename: string, status: CurationStatus) {
    setMessage(dryRun ? "Dry-run: checking metadata update..." : "Updating metadata...");

    const response = await fetch("/api/curation", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ filename, status, dryRun }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setMessage(payload.error || "Could not update curation status.");
      return;
    }

    if (dryRun) {
      setMessage(`Dry-run OK: ${filename} would move to ${status}.`);
      return;
    }

    setShots((current) =>
      current.map((shot) =>
        shot.filename === filename
          ? {
              ...shot,
              curationStatus: status,
            }
          : shot,
      ),
    );
    setMessage(`Updated ${filename}: ${payload.previous} -> ${payload.next}. Backup: ${payload.backup}`);
  }

  return (
    <section className="curation-review">
      <div className="curation-toolbar">
        <div className="curation-tabs" role="tablist" aria-label="Curation status">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab}
              className={activeTab === tab ? "active" : ""}
              key={tab}
              role="tab"
              type="button"
              onClick={() => setActiveTab(tab)}
            >
              {tab}
              <span>{counts[tab]}</span>
            </button>
          ))}
        </div>
        <label className="curation-dry-run">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
          />
          Dry-run mode
        </label>
      </div>

      {message ? <p className="curation-message">{message}</p> : null}

      <div className="curation-grid">
        {visibleShots.map((shot) => (
          <article className="curation-card" key={shot.filename}>
            <img src={shot.src} alt={shot.filmTitle} loading="lazy" />
            <div className="curation-card-body">
              <div className="curation-card-heading">
                <span className={`status-badge status-${shot.curationStatus}`}>
                  {activeTab === "queue" ? `queue ${reviewPriority(shot)}` : shot.curationStatus}
                </span>
                <strong>{shot.score}</strong>
              </div>
              <h2>{shot.filmTitle}</h2>
              <dl>
                <div>
                  <dt>Year</dt>
                  <dd>{shot.year || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Director</dt>
                  <dd>{shot.director || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Cinematographer</dt>
                  <dd>{shot.cinematographer || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{confidenceLabel(shot)}</dd>
                </div>
                <div>
                  <dt>Missing</dt>
                  <dd>
                    {[
                      !shot.director ? "director" : null,
                      !shot.cinematographer ? "DOP" : null,
                    ].filter(Boolean).join(", ") || "None"}
                  </dd>
                </div>
                <div>
                  <dt>Verified</dt>
                  <dd>{shot.verified ? "Yes" : "No"}</dd>
                </div>
              </dl>
              {shot.sourceUrl ? (
                <a href={shot.sourceUrl} target="_blank" rel="noreferrer">
                  {shot.sourceTitle || shot.sourceUrl}
                </a>
              ) : (
                <p className="curation-source-empty">No source URL</p>
              )}
              <div className="curation-actions">
                {statusTabs.map((status) => (
                  <button
                    disabled={shot.curationStatus === status}
                    key={status}
                    type="button"
                    onClick={() => updateStatus(shot.filename, status)}
                  >
                    Mark as {status}
                  </button>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
