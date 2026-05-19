"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type Frame = {
  filename: string;
  src: string;
  score: number;
  title: string;
  tags: string[];
  collections: string[];
  metrics: {
    brightness?: number;
    colorRichness?: number;
    contrast?: number;
    diversity?: number;
  } | null;
  source: {
    title?: string;
    url?: string;
    query?: string;
    video?: string;
  } | null;
};

type GalleryFeedProps = {
  frames: Frame[];
};

const INITIAL_RENDER_COUNT = 72;
const RENDER_BATCH_SIZE = 48;

export default function GalleryFeed({ frames }: GalleryFeedProps) {
  const [activeTag, setActiveTag] = useState("All");
  const [activeCollection, setActiveCollection] = useState("All");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState("score");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);
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
      const matchesCollection =
        activeCollection === "All" ||
        frame.collections.includes(activeCollection);
      const searchable = [
        frame.filename,
        frame.title,
        ...frame.tags,
        ...frame.collections,
      ]
        .join(" ")
        .toLowerCase();
      const matchesSearch =
        !normalizedSearch || searchable.includes(normalizedSearch);

      return matchesTag && matchesCollection && matchesSearch;
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

        return b.score - a.score;
      });
  }, [activeCollection, activeTag, frames, search, sortMode]);

  const visibleFrames = useMemo(
    () => filteredFrames.slice(0, visibleCount),
    [filteredFrames, visibleCount],
  );
  const hasMoreFrames = visibleCount < filteredFrames.length;
  const activeFrame =
    activeIndex === null ? null : filteredFrames[activeIndex] || null;

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

  useEffect(() => {
    setVisibleCount(INITIAL_RENDER_COUNT);
    setActiveIndex(null);
  }, [activeCollection, activeTag, search, sortMode]);

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
          Math.min(currentCount + RENDER_BATCH_SIZE, filteredFrames.length),
        );
      },
      {
        rootMargin: "1200px 0px",
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
            placeholder="Title, tag, collection"
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
                  return (
                    <article
                      className="frame-card"
                      key={frame.filename}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveIndex(index)}
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
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="frame-score">{frame.score}</span>
                      <span className="frame-more" aria-hidden="true">
                        ...
                      </span>
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
                {activeFrame.source?.title ? (
                  <p>{activeFrame.source.title}</p>
                ) : null}
              </div>
              <div className="modal-sidecar">
                {activeFrame.metrics ? (
                  <div className="modal-metrics">
                    <span>Contrast {Math.round(activeFrame.metrics.contrast || 0)}</span>
                    <span>Color {Math.round(activeFrame.metrics.colorRichness || 0)}</span>
                    <span>Bright {Math.round(activeFrame.metrics.brightness || 0)}</span>
                  </div>
                ) : null}
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
              </div>
            </figcaption>
          </figure>
        </div>
      ) : null}
    </>
  );
}
