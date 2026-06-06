import GalleryFeed from "../gallery-feed";
import { archiveQualityComparison, getFrames, isPremiumFrame } from "../page";

export default async function PremiumFeedPage() {
  const frames = await getFrames();
  const premiumFrames = frames.filter(isPremiumFrame);
  const heroFrame = premiumFrames[0] || frames[0];
  const comparison = archiveQualityComparison(frames);

  return (
    <main className="feed-shell premium-feed-shell">
      {heroFrame ? (
        <div
          className="hero-backdrop"
          style={{ backgroundImage: `url(${heroFrame.src})` }}
          aria-hidden="true"
        />
      ) : null}

      <section className="hero premium-hero">
        <div>
          <p className="eyebrow">Verified · Curated · Premium Sources</p>
          <h1>PREMIUM FEED</h1>
          <p className="subtitle">
            A stricter cinematic feed: verified metadata, curated status, premium source quality,
            clean frames, and quality score above 80.
          </p>
        </div>
        <div className="hero-stat">
          <span>{premiumFrames.length}</span>
          <p>premium shots</p>
        </div>
      </section>

      <GalleryFeed frames={premiumFrames} feedMode="premium" comparison={comparison} />
    </main>
  );
}
