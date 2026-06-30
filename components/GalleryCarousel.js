"use client";

import { useRef, useEffect, useState } from "react";

const PHOTOS = [
  ["/assets/photos/we-scoop-banner.jpg", "Ohio Pet Waste Pros 'We Scoop Dog Poop' branded service vehicle"],
  ["/assets/photos/cody-scooping-vest.jpg", "Ohio Pet Waste Pros technician in a safety vest scooping a yard"],
  ["/assets/photos/dixie-red-scoop.jpg", "Ohio Pet Waste Pros scoop and bag beside rescue dog Dixie"],
  ["/assets/photos/craig-deodorizing.jpg", "Owner applying eco-friendly yard deodorizing treatment"],
  ["/assets/photos/craig-sanitizing-spray.jpg", "Owner applying pet-safe sanitizing spray to a backyard"],
  ["/assets/photos/dixie-craig-posed-1.jpg", "Ohio Pet Waste Pros owner with rescue dog Dixie in a clean yard"],
  ["/assets/photos/scooping-bell.jpg", "Technician scooping and double-bagging dog waste in a Toledo-area yard"],
  ["/assets/photos/wysiwash-application.jpg", "Applying Wysiwash pet-safe sanitizing system to a yard"],
  ["/assets/photos/dixie-frisbee.jpg", "Happy dog playing frisbee in a clean, waste-free backyard"],
  ["/assets/photos/team-craig.jpg", "Craig Bridgman, co-owner of Ohio Pet Waste Pros"],
  ["/assets/photos/team-tony.jpg", "Tony, an Ohio Pet Waste Pros service technician"],
  ["/assets/photos/dixie-photo.jpg", "Dixie, the rescue dog who inspired Ohio Pet Waste Pros"],
];

export default function GalleryCarousel() {
  const trackRef = useRef(null);
  const [active, setActive] = useState(0);

  const scrollToIndex = (i) => {
    const track = trackRef.current;
    if (!track) return;
    const idx = Math.max(0, Math.min(PHOTOS.length - 1, i));
    const child = track.children[idx];
    if (child) track.scrollTo({ left: child.offsetLeft - track.offsetLeft, behavior: "smooth" });
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < track.children.length; i++) {
      const d = Math.abs(track.children[i].offsetLeft - track.offsetLeft - track.scrollLeft);
      if (d < best) { best = d; nearest = i; }
    }
    setActive(nearest);
  };

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section style={{ background: "#F6F5EF", padding: "76px 0" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
        <h2 style={{ fontFamily: "var(--font-bricolage)", fontWeight: 800, fontSize: "clamp(26px,3.6vw,38px)", letterSpacing: "-0.02em", textAlign: "center", margin: "0 0 8px", color: "#1C2A33" }}>
          Check out our photo gallery
        </h2>
        <p style={{ textAlign: "center", color: "#5b6770", margin: "0 0 36px", fontSize: 17 }}>
          Real cleanups, real yards, real happy dogs across Northwest Ohio &amp; SE Michigan.
        </p>

        <div style={{ position: "relative" }}>
          <button
            aria-label="Previous photos"
            onClick={() => scrollToIndex(active - 1)}
            style={arrowStyle("left")}
          >‹</button>

          <div
            ref={trackRef}
            className="opwp-gallery-track"
            style={{
              display: "flex",
              gap: 18,
              overflowX: "auto",
              scrollSnapType: "x mandatory",
              scrollbarWidth: "none",
              padding: "4px",
            }}
          >
            {PHOTOS.map(([src, alt], i) => (
              <div
                key={src}
                className="opwp-gallery-item"
                style={{ flex: "0 0 auto", scrollSnapAlign: "center" }}
              >
                <img
                  src={src}
                  alt={alt}
                  loading="lazy"
                  style={{ width: "100%", height: 360, objectFit: "cover", borderRadius: 18, boxShadow: "0 16px 36px -20px rgba(0,0,0,.5)", display: "block" }}
                />
              </div>
            ))}
          </div>

          <button
            aria-label="Next photos"
            onClick={() => scrollToIndex(active + 1)}
            style={arrowStyle("right")}
          >›</button>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 22, flexWrap: "wrap" }}>
          {PHOTOS.map((_, i) => (
            <button
              key={i}
              aria-label={`Go to photo ${i + 1}`}
              onClick={() => scrollToIndex(i)}
              style={{
                width: 9, height: 9, borderRadius: "50%", border: "none", cursor: "pointer",
                background: i === active ? "#4F9E3A" : "#c9cfc6", padding: 0,
              }}
            />
          ))}
        </div>
      </div>

      <style>{`
        .opwp-gallery-track::-webkit-scrollbar { display: none; }
        .opwp-gallery-item { width: 380px; }
        @media (max-width: 900px) { .opwp-gallery-item { width: 300px; } .opwp-gallery-item img { height: 300px !important; } }
        @media (max-width: 560px) { .opwp-gallery-item { width: 82vw; } .opwp-gallery-item img { height: 260px !important; } }
      `}</style>
    </section>
  );
}

function arrowStyle(side) {
  return {
    position: "absolute",
    top: "50%",
    [side]: -6,
    transform: "translateY(-50%)",
    zIndex: 5,
    width: 46,
    height: 46,
    borderRadius: "50%",
    border: "none",
    background: "#23527A",
    color: "#fff",
    fontSize: 26,
    lineHeight: "44px",
    cursor: "pointer",
    boxShadow: "0 8px 20px -8px rgba(0,0,0,.5)",
  };
}
