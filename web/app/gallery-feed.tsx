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
                      <span className="frame-score">{frame.score}</span>
                      <div className="frame-hover-meta" aria-hidden="true">
                  <span>{frame.collections[0] || "cinematic"}</span>
                  <strong>{frame.title}</strong>
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
            x
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
            <img src={activeFrame.src} alt={activeFrame.title} />
            <figcaption>
              <div className="modal-title-group">
                <div>
                  <span className="score-badge">{activeFrame.score}</span>
                  <h2>{activeFrame.title}</h2>
                </div>
                <p>{activeFrame.director ? `Director ${activeFrame.director}` : activeFrame.source?.title || activeFrame.mood}</p>
              </div>
              <div className="modal-sidecar">
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
                    <span>Bright {Math.round(activeFrame.metrics.brightness || 0)}</span>
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
              </div>
            </figcaption>
          </figure>
        </div>
      ) : null}
    </>
  );
}
