"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type Frame = {
  filename: string;
  src: string;
  score: number;
  title: string;
  director?: string;
  lens?: string;
  mood: string;
  lighting?: LightingAnalysis;
  palette: string[];
  quality: {
    composition: number;
    lightingContrast: number;
    colorHarmony: number;
    cinematicDepth: number;
    subjectIsolation: number;
    mood: number;
    overall: number;
  };
  tags: string[];
  collections: string[];
  metrics: {
    brightness?: number;
    colorRichness?: number;
    contrast?: number;
    diversity?: number;
    edgeEnergy?: number;
    saturation?: number;
  } | null;
  source: {
    title?: string;
    url?: string;
    query?: string;
    video?: string;
  } | null;
  width: number;
  height: number;
  aspectRatio: number;
};

export type LightingAnalysis = {
  subject: {
    x: number;
    y: number;
  };
  keyLight: {
    direction: string;
    strength: number;
  };
  fillLight: {
    direction: string;
    strength: number;
  };
  rimLight: {
    direction: string;
    strength: number;
  };
  contrastRatio: number;
  mood: string;
};

type GalleryFeedProps = {
  frames: Frame[];
};

const INITIAL_RENDER_COUNT = 72;
const RENDER_BATCH_SIZE = 48;
const MOODS = ["All", "noir", "amber", "cyberpunk", "teal-orange", "monochrome", "dreamcore"];

function fuzzyIncludes(source: string, query: string) {
  if (!query) return true;
  if (source.includes(query)) return true;

  const aliases: Record<string, string[]> = {
    lonely: ["noir", "dark", "shadow-heavy", "wide"],
    neon: ["cyberpunk", "cold", "saturated", "color-rich"],
    rain: ["cyberpunk", "noir", "cold", "dark"],
    desert: ["amber", "warm", "widescreen"],
    silhouette: ["noir", "shadow-heavy", "high-contrast"],
    tungsten: ["amber", "warm"],
    soft: ["dreamcore", "muted"],
    wide: ["widescreen", "scope"],
    closeup: ["subject", "isolation", "portrait"],
    "close-up": ["subject", "isolation", "portrait"],
  };
  const words = query.split(/\s+/).filter(Boolean);
  return words.every((word) => {
    if (source.includes(word)) return true;
    if ((aliases[word] || []).some((alias) => source.includes(alias))) return true;

    let cursor = 0;
    for (const character of source) {
      if (character === word[cursor]) cursor += 1;
      if (cursor === word.length) return true;
    }

    return false;
  });
}

function fallbackLighting(frame: Frame): LightingAnalysis {
  const contrastRatio = Number(
    Math.max(1.2, Math.min(8.5, (frame.metrics?.contrast || 42) / 12)).toFixed(1),
  );
  const keyDirection = frame.tags.includes("cold") ? "front-left" : "front-right";
  const keyStrength = Math.max(58, Math.min(94, Math.round(58 + (frame.metrics?.contrast || 42) * 0.58)));

  return {
    subject: {
      x: 0.5,
      y: 0.52,
    },
    keyLight: {
      direction: keyDirection,
      strength: keyStrength,
    },
    fillLight: {
      direction: keyDirection.endsWith("left") ? "front-right" : "front-left",
      strength: Math.max(12, Math.min(46, Math.round(keyStrength / contrastRatio))),
    },
    rimLight: {
      direction: keyDirection.endsWith("left") ? "back-right" : "back-left",
      strength: Math.max(18, Math.min(70, Math.round((frame.metrics?.edgeEnergy || 14) * 2.2))),
    },
    contrastRatio,
    mood: frame.mood,
  };
}

function pointForDirection(direction: string) {
  const points: Record<string, { x: number; y: number }> = {
    "front-left": { x: 54, y: 66 },
    "front-right": { x: 286, y: 66 },
    "front-side": { x: 286, y: 92 },
    "side-left": { x: 46, y: 140 },
    "side-right": { x: 294, y: 140 },
    "back-left": { x: 74, y: 238 },
    "back-right": { x: 266, y: 238 },
  };

  return points[direction] || points["front-left"];
}

function LightingDiagram({ analysis }: { analysis: LightingAnalysis }) {
  const subject = {
    x: 130 + analysis.subject.x * 80,
    y: 120 + analysis.subject.y * 54,
  };
  const key = pointForDirection(analysis.keyLight.direction);
  const fill = pointForDirection(analysis.fillLight.direction);
  const rim = pointForDirection(analysis.rimLight.direction);

  return (
    <svg className="lighting-svg" viewBox="0 0 340 300" role="img" aria-label="Top-down lighting diagram">
      <defs>
        <marker id="light-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      <rect x="1" y="1" width="338" height="298" rx="16" />
      <line className="diagram-axis" x1="170" y1="38" x2="170" y2="262" />
      <line className="diagram-axis" x1="48" y1="150" x2="292" y2="150" />
      <circle className="diagram-subject-zone" cx={subject.x} cy={subject.y} r="42" />
      <circle className="diagram-subject" cx={subject.x} cy={subject.y} r="16" />
      <path className="diagram-camera" d="M148 267h44l-7 16h-30z" />
      <text x="170" y="258" textAnchor="middle">Camera</text>
      <g className="diagram-light diagram-key">
        <circle cx={key.x} cy={key.y} r="16" />
        <line x1={key.x} y1={key.y} x2={subject.x} y2={subject.y} markerEnd="url(#light-arrow)" />
        <text x={key.x} y={key.y - 23} textAnchor="middle">Key {analysis.keyLight.strength}%</text>
      </g>
      <g className="diagram-light diagram-fill">
        <circle cx={fill.x} cy={fill.y} r="12" />
        <line x1={fill.x} y1={fill.y} x2={subject.x} y2={subject.y} markerEnd="url(#light-arrow)" />
        <text x={fill.x} y={fill.y - 20} textAnchor="middle">Fill {analysis.fillLight.strength}%</text>
      </g>
      <g className="diagram-light diagram-rim">
        <circle cx={rim.x} cy={rim.y} r="13" />
        <line x1={rim.x} y1={rim.y} x2={subject.x} y2={subject.y} markerEnd="url(#light-arrow)" />
        <text x={rim.x} y={rim.y + 30} textAnchor="middle">Rim {analysis.rimLight.strength}%</text>
      </g>
    </svg>
  );
}

export default function GalleryFeed({ frames }: GalleryFeedProps) {
  const [activeTag, setActiveTag] = useState("All");
  const [activeMood, setActiveMood] = useState("All");
  const [activeCollection, setActiveCollection] = useState("All");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState("score");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(() => new Set());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const tags = useMemo(
    () =>
      Array.from(new Set(frames.flatMap((frame) => frame.tags))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [frames],
  );

  const collections = useMemo(
    () =>
      Array.from(new Set(frames.flatMap((frame) => frame.collections))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [frames],
  );

  const filteredFrames = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return frames
      .filter((frame) => {
        const matchesTag = activeTag === "All" || frame.tags.includes(activeTag);
        const matchesMood = activeMood === "All" || frame.mood === activeMood;
        const matchesCollection =
          activeCollection === "All" ||
          frame.collections.includes(activeCollection);
        const searchable = [
          frame.filename,
          frame.title,
          frame.mood,
          frame.director || "",
          frame.lens || "",
          frame.palette.join(" "),
          ...frame.tags,
          ...frame.collections,
        ]
          .join(" ")
          .toLowerCase();
        const matchesSearch = fuzzyIncludes(searchable, normalizedSearch);

        return matchesTag && matchesMood && matchesCollection && matchesSearch;
      })
      .sort((a, b) => {
        if (sortMode === "title") {
          return a.title.localeCompare(b.title);
        }

        if (sortMode === "contrast") {
          return (b.metrics?.contrast || 0) - (a.metrics?.contrast || 0);
        }

        if (sortMode === "color") {
          return (b.metrics?.colorRichness || 0) - (a.metrics?.colorRichness || 0);
        }

        return b.quality.overall - a.quality.overall;
      });
  }, [activeCollection, activeMood, activeTag, frames, search, sortMode]);

  const visibleFrames = useMemo(
    () => filteredFrames.slice(0, visibleCount),
    [filteredFrames, visibleCount],
  );
  const hasMoreFrames = visibleCount < filteredFrames.length;
  const activeFrame =
    activeIndex === null ? null : filteredFrames[activeIndex] || null;
  const activeLighting = activeFrame
    ? activeFrame.lighting || fallbackLighting(activeFrame)
    : null;
  const similarFrames = useMemo(() => {
    if (!activeFrame) {
      return [];
    }

    return filteredFrames
      .filter((frame) => frame.filename !== activeFrame.filename)
      .map((frame) => {
        const sharedTags = frame.tags.filter((tag) => activeFrame.tags.includes(tag)).length;
        const sharedPalette = frame.palette.filter((color) => activeFrame.palette.includes(color)).length;
        const moodMatch = frame.mood === activeFrame.mood ? 5 : 0;
        return { frame, weight: sharedTags * 2 + sharedPalette + moodMatch };
      })
      .sort((a, b) => b.weight - a.weight || b.frame.quality.overall - a.frame.quality.overall)
      .slice(0, 4)
      .map((item) => item.frame);
  }, [activeFrame, filteredFrames]);

  function closeModal() {
    setActiveIndex(null);
  }

  function showPreviousFrame() {
    setActiveIndex((currentIndex) => {
      if (currentIndex === null || !filteredFrames.length) {
        return currentIndex;
      }

      return (currentIndex - 1 + filteredFrames.length) % filteredFrames.length;
    });
  }

  function showNextFrame() {
    setActiveIndex((currentIndex) => {
      if (currentIndex === null || !filteredFrames.length) {
        return currentIndex;
      }

      return (currentIndex + 1) % filteredFrames.length;
    });
  }

  function markImageLoaded(filename: string) {
    setLoadedImages((currentImages) => {
      if (currentImages.has(filename)) {
        return currentImages;
      }

      const nextImages = new Set(currentImages);
      nextImages.add(filename);
      return nextImages;
    });
  }

  function handleCardPointerMove(
    event: React.PointerEvent<HTMLElement>,
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;

    event.currentTarget.style.setProperty("--tilt-x", `${(-y * 3).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--tilt-y", `${(x * 3).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--pan-x", `${(x * 10).toFixed(2)}px`);
    event.currentTarget.style.setProperty("--pan-y", `${(y * 10).toFixed(2)}px`);
  }

  function resetCardMotion(event: React.PointerEvent<HTMLElement>) {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
    event.currentTarget.style.setProperty("--pan-x", "0px");
    event.currentTarget.style.setProperty("--pan-y", "0px");
  }

  useEffect(() => {
    setVisibleCount(INITIAL_RENDER_COUNT);
    setActiveIndex(null);
  }, [activeCollection, activeMood, activeTag, search, sortMode]);

  useEffect(() => {
    if (!hasMoreFrames) {
      return;
    }

    const target = loadMoreRef.current;

    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        setVisibleCount((currentCount) =>
          Math.min(
            currentCount +
              (window.matchMedia("(max-width: 640px)").matches
                ? Math.round(RENDER_BATCH_SIZE / 2)
                : RENDER_BATCH_SIZE),
            filteredFrames.length,
          ),
        );
      },
      {
        rootMargin: "1400px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [filteredFrames.length, hasMoreFrames]);

  useEffect(() => {
    if (!activeFrame) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [activeFrame]);

  useEffect(() => {
    if (activeIndex !== null && activeIndex >= filteredFrames.length) {
      setActiveIndex(filteredFrames.length ? 0 : null);
    }
  }, [activeIndex, filteredFrames.length]);

  useEffect(() => {
    if (activeIndex === null) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeModal();
      }

      if (event.key === "ArrowLeft") {
        showPreviousFrame();
      }

      if (event.key === "ArrowRight") {
        showNextFrame();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, filteredFrames.length]);

  if (!frames.length) {
    return (
      <section className="empty-state">
        <p>Add JPG images to public/bestframes or run npm run discover.</p>
      </section>
    );
  }

  const averageScore = Math.round(
    frames.reduce((total, frame) => total + frame.score, 0) / frames.length,
  );
  const activeFilters = [
    activeTag !== "All" ? activeTag : null,
    activeMood !== "All" ? activeMood : null,
    activeCollection !== "All" ? activeCollection : null,
    search.trim() ? `"${search.trim()}"` : null,
  ].filter(Boolean);

  return (
    <>
      <section className="studio-bar" aria-label="Gallery controls">
        <div className="studio-brand">
          <span>CF</span>
          <div>
            <strong>Cinematic Index</strong>
            <p>
              {visibleFrames.length} of {filteredFrames.length} shots loaded
            </p>
          </div>
        </div>

        <label className="search-wrap">
          <span>Search</span>
          <input
            aria-label="Search frames"
            className="gallery-search"
            placeholder="Mood, lighting, lens, framing, color"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label className="sort-wrap">
          <span>Sort</span>
          <select
            aria-label="Sort frames"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value)}
          >
            <option value="score">Best score</option>
            <option value="contrast">Contrast</option>
            <option value="color">Color richness</option>
            <option value="title">Title</option>
          </select>
        </label>
      </section>

      <section className="mood-tabs" aria-label="Mood filters">
        {MOODS.map((mood) => (
          <button
            className={activeMood === mood ? "active" : ""}
            key={mood}
            type="button"
            onClick={() => setActiveMood(mood)}
          >
            {mood}
          </button>
        ))}
      </section>

      <section className="insight-strip" aria-label="Gallery summary">
        <div>
          <span>{frames.length}</span>
          <p>Total Frames</p>
        </div>
        <div>
          <span>{averageScore}</span>
          <p>Avg Score</p>
        </div>
        <div>
          <span>{tags.length}</span>
          <p>Tags</p>
        </div>
        <div>
          <span>{collections.length}</span>
          <p>Collections</p>
        </div>
      </section>

      <section className="gallery-workspace">
        <aside className="filter-rail" aria-label="Shot filters">
          <div className="rail-section">
            <div className="rail-heading">
              <span>Tags</span>
              <button type="button" onClick={() => setActiveTag("All")}>
                Reset
              </button>
            </div>
            <button
              className={activeTag === "All" ? "active" : ""}
              type="button"
              onClick={() => setActiveTag("All")}
            >
              All Shots
            </button>
            {tags.map((tag) => (
              <button
                className={activeTag === tag ? "active" : ""}
                key={tag}
                type="button"
                onClick={() => setActiveTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>

          {collections.length ? (
            <div className="rail-section">
              <div className="rail-heading">
                <span>Collections</span>
                <button type="button" onClick={() => setActiveCollection("All")}>
                  Reset
                </button>
              </div>
              <button
                className={activeCollection === "All" ? "active" : ""}
                type="button"
                onClick={() => setActiveCollection("All")}
              >
                All Collections
              </button>
              {collections.map((collection) => (
                <button
                  className={activeCollection === collection ? "active" : ""}
                  key={collection}
                  type="button"
                  onClick={() => setActiveCollection(collection)}
                >
                  {collection}
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        <div className="gallery-stage">
          {activeFilters.length ? (
            <div className="active-filter-row">
              <span>Active</span>
              {activeFilters.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => {
                    if (filter === activeTag) {
                      setActiveTag("All");
                    }

                    if (filter === activeMood) {
                      setActiveMood("All");
                    }

                    if (filter === activeCollection) {
                      setActiveCollection("All");
                    }

                    if (filter === `"${search.trim()}"`) {
                      setSearch("");
                    }
                  }}
                >
                  {filter}
                </button>
              ))}
            </div>
          ) : null}

          <section className="tag-filter-bar" aria-label="Frame tag filters">
            <button
              className={activeTag === "All" ? "active" : ""}
              type="button"
              onClick={() => setActiveTag("All")}
            >
              All
            </button>
            {tags.map((tag) => (
              <button
                className={activeTag === tag ? "active" : ""}
                key={tag}
                type="button"
                onClick={() => setActiveTag(tag)}
              >
                {tag}
              </button>
            ))}
          </section>

          {collections.length ? (
            <section className="collection-filter-bar" aria-label="Collections">
              <button
                className={activeCollection === "All" ? "active" : ""}
                type="button"
                onClick={() => setActiveCollection("All")}
              >
                All Collections
              </button>
              {collections.map((collection) => (
                <button
                  className={activeCollection === collection ? "active" : ""}
                  key={collection}
                  type="button"
                  onClick={() => setActiveCollection(collection)}
                >
                  {collection}
                </button>
              ))}
            </section>
          ) : null}

          {filteredFrames.length ? (
            <>
              <section className="masonry" aria-label="Cinematic frame gallery">
                {visibleFrames.map((frame, index) => {
                  const isLoaded = loadedImages.has(frame.filename);

                  return (
                    <article
                      className={`frame-card ${isLoaded ? "is-loaded" : ""}`}
                      key={frame.filename}
                      role="button"
                      tabIndex={0}
                      style={
                        {
                          "--frame-aspect": frame.aspectRatio.toFixed(4),
                        } as CSSProperties
                      }
                      onClick={() => setActiveIndex(index)}
                      onPointerMove={handleCardPointerMove}
                      onPointerLeave={resetCardMotion}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActiveIndex(index);
                        }
                      }}
                    >
                      <div className="frame-image-wrap">
                        <img
                          src={frame.src}
                          alt={frame.title}
                          width={frame.width || undefined}
                          height={frame.height || undefined}
                          loading="lazy"
                          decoding="async"
                          className="frame-image"
                          onLoad={() => markImageLoaded(frame.filename)}
                        />
                      </div>
                      <div className="frame-card-meta">
                        <div className="frame-title-row">
                          <strong>{frame.title}</strong>
                          <span>{frame.quality.overall}</span>
                        </div>
                        <div className="frame-card-tags" aria-label="Frame tags">
                          {[frame.mood, ...frame.tags]
                            .filter((tag, tagIndex, allTags) => allTags.indexOf(tag) === tagIndex)
                            .slice(0, 4)
                            .map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
              <div
                className="infinite-loader"
                ref={loadMoreRef}
                aria-live="polite"
              >
                {hasMoreFrames
                  ? `Loading more frames... ${visibleFrames.length}/${filteredFrames.length}`
                  : `Showing ${filteredFrames.length} frames`}
              </div>
            </>
          ) : (
            <section className="empty-state">
              <p>No frames match the current search or filters.</p>
            </section>
          )}
        </div>
      </section>

      {activeFrame ? (
        <div
          className="frame-modal"
          role="dialog"
          aria-modal="true"
          aria-label={activeFrame.title}
          onClick={closeModal}
        >
          <div
            className="modal-backdrop-image"
            style={{ backgroundImage: `url(${activeFrame.src})` }}
            aria-hidden="true"
          />
          <button
            className="modal-close"
            type="button"
            aria-label="Close fullscreen frame"
            onClick={closeModal}
          >
            Close
          </button>
          {filteredFrames.length > 1 ? (
            <>
              <button
                className="modal-nav previous"
                type="button"
                aria-label="Previous frame"
                onClick={(event) => {
                  event.stopPropagation();
                  showPreviousFrame();
                }}
              >
                ‹
              </button>
              <button
                className="modal-nav next"
                type="button"
                aria-label="Next frame"
                onClick={(event) => {
                  event.stopPropagation();
                  showNextFrame();
                }}
              >
                ›
              </button>
            </>
          ) : null}
          <figure
            className="modal-frame"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-image-stage">
              <img
                src={activeFrame.src}
                alt={activeFrame.title}
                style={
                  {
                    "--modal-natural-width": activeFrame.width
                      ? `${activeFrame.width}px`
                      : "100%",
                  } as CSSProperties
                }
              />
            </div>
            <figcaption className="modal-details">
              <section className="modal-primary-card">
                <div className="modal-kicker">
                  <span>{activeFrame.mood}</span>
                  <span>{activeFrame.aspectRatio.toFixed(2)}:1</span>
                </div>
                <h2>{activeFrame.title}</h2>
                <p>
                  {activeFrame.source?.title || "Cinematic archive frame"}
                </p>
              </section>

              <section className="modal-info-grid" aria-label="Shot metadata">
                <div className="metadata-card">
                  <span>Score</span>
                  <strong>{activeFrame.quality.overall}</strong>
                </div>
                <div className="metadata-card">
                  <span>Source</span>
                  <strong>{activeFrame.source?.query || activeFrame.collections[0] || "archive"}</strong>
                </div>
                <div className="metadata-card">
                  <span>Director</span>
                  <strong>{activeFrame.director || "unknown"}</strong>
                </div>
                <div className="metadata-card">
                  <span>Lens</span>
                  <strong>{activeFrame.lens || "not tagged"}</strong>
                </div>
              </section>

              <section className="modal-sidecar">
                {activeLighting ? (
                  <div className="lighting-panel">
                    <div className="modal-section-heading">
                      <span>Lighting analysis</span>
                      <button className="lighting-diagram-button" type="button">
                        Lighting Diagram
                      </button>
                    </div>
                    <LightingDiagram analysis={activeLighting} />
                    <div className="lighting-stats">
                      <span>Subject {Math.round(activeLighting.subject.x * 100)} / {Math.round(activeLighting.subject.y * 100)}</span>
                      <span>Key {activeLighting.keyLight.direction}</span>
                      <span>Fill {activeLighting.fillLight.direction}</span>
                      <span>Rim {activeLighting.rimLight.direction}</span>
                      <span>Ratio {activeLighting.contrastRatio}:1</span>
                      <span>Mood {activeLighting.mood}</span>
                    </div>
                  </div>
                ) : null}
                <div className="modal-palette" aria-label="Extracted color palette">
                  {activeFrame.palette.map((color) => (
                    <span key={color} style={{ background: color }} />
                  ))}
                </div>
                {activeFrame.metrics ? (
                  <div className="modal-metrics">
                    <span>Mood {activeFrame.mood}</span>
                    <span>Quality {activeFrame.quality.overall}</span>
                    <span>Contrast {Math.round(activeFrame.metrics.contrast || 0)}</span>
                    <span>Color {Math.round(activeFrame.metrics.colorRichness || 0)}</span>
                    <span>Light {Math.round(activeFrame.metrics.brightness || 0)}</span>
                    <span>Aspect {activeFrame.aspectRatio.toFixed(2)}</span>
                    <span>{activeFrame.width} x {activeFrame.height}</span>
                    {activeFrame.lens ? <span>Lens {activeFrame.lens}</span> : null}
                  </div>
                ) : null}
                <div className="modal-quality">
                  <span>Composition {activeFrame.quality.composition}</span>
                  <span>Depth {activeFrame.quality.cinematicDepth}</span>
                  <span>Isolation {activeFrame.quality.subjectIsolation}</span>
                  <span>Atmosphere {activeFrame.quality.mood}</span>
                </div>
                {activeFrame.tags.length ? (
                  <div className="modal-tags">
                    {activeFrame.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          setActiveTag(tag);
                          setActiveCollection("All");
                          closeModal();
                        }}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="modal-related-card">
                <div className="modal-section-heading">
                  <span>Collections</span>
                  <strong>{activeFrame.collections.length}</strong>
                </div>
                {activeFrame.collections.length ? (
                  <div className="modal-collections">
                    {activeFrame.collections.slice(0, 3).map((collection) => (
                      <button
                        key={collection}
                        type="button"
                        onClick={() => {
                          setActiveCollection(collection);
                          closeModal();
                        }}
                      >
                        {collection}
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="modal-related-card">
                <div className="modal-section-heading">
                  <span>Similar shots</span>
                  <strong>{similarFrames.length}</strong>
                </div>
                {similarFrames.length ? (
                  <div className="similar-shots">
                    {similarFrames.map((frame) => (
                      <button
                        key={frame.filename}
                        type="button"
                        onClick={() => {
                          const nextIndex = filteredFrames.findIndex(
                            (candidate) => candidate.filename === frame.filename,
                          );
                          setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
                        }}
                      >
                        <img src={frame.src} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            </figcaption>
          </figure>
        </div>
      ) : null}
    </>
  );
}
