import { useEffect, useRef, useState } from "react";

/**
 * Full-viewport immersive hair scene: procedurally rendered back-of-head
 * straight hair (Blender Cycles, scripts/render-hair.py), platinum base.
 * The dye color from the spectral engine is applied with mix-blend-mode:
 * multiply, clipped to the hair by the alpha mask — strand texture shows
 * through, and the blend behaves like dye depositing on bleached hair.
 *
 * View modes:
 *   fit  — object-contain: the whole head is always fully visible.
 *   full — cover: the scene fills the viewport (edges overflow); the user
 *          can pan by touch/wheel/mouse-drag, scrollbars hidden.
 */

export type ViewMode = "fit" | "full";

interface HairSceneProps {
  /** sRGB hex from the spectral engine, or null for undyed hair. */
  colorHex: string | null;
  viewMode: ViewMode;
}

/** Rendered asset aspect (scene-straight.webp is 2880×3840). */
const ASPECT = 2880 / 3840;

const BG =
  "radial-gradient(ellipse 80% 65% at 50% 32%, #f5f0e8 0%, #e9e2d5 55%, #d9cfc0 100%)";
// BASE_URL-aware so the same code works at / (dev) and /<repo>/ (Pages)
const SCENE_URL = `${import.meta.env.BASE_URL}hair/scene-straight.webp`;
const MASK_URL = `url(${import.meta.env.BASE_URL}hair/mask-straight.png)`;

export function HairScene({ colorHex, viewMode }: HairSceneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  // Full mode: size the content box to cover the viewport, then center it.
  useEffect(() => {
    if (viewMode !== "full") return;
    const el = scrollRef.current;
    if (!el) return;
    const compute = () => {
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      let w: number, h: number;
      if (vw / vh < ASPECT) {
        h = vh;
        w = vh * ASPECT;
      } else {
        w = vw;
        h = vw / ASPECT;
      }
      setBox({ w, h });
      el.scrollLeft = (w - vw) / 2;
      el.scrollTop = (h - vh) / 2;
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode]);

  const dyeOverlay = colorHex ? (
    <div
      className="absolute inset-0 transition-colors duration-300"
      style={{
        backgroundColor: colorHex,
        mixBlendMode: "multiply",
        maskMode: "luminance",
        WebkitMaskImage: MASK_URL,
        maskImage: MASK_URL,
        // cover sizing in full mode; contain in fit mode — both match the
        // sibling img's geometry exactly.
        WebkitMaskSize: viewMode === "full" ? "100% 100%" : "contain",
        maskSize: viewMode === "full" ? "100% 100%" : "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
      }}
    />
  ) : null;

  if (viewMode === "fit") {
    return (
      <div className="absolute inset-0" style={{ background: BG }}>
        <img
          src={SCENE_URL}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-contain"
        />
        {dyeOverlay}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="no-scrollbar absolute inset-0 cursor-grab overflow-auto active:cursor-grabbing"
      style={{ background: BG }}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") return; // touch uses native scrolling
        const el = scrollRef.current!;
        dragRef.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
        el.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        const el = scrollRef.current!;
        el.scrollLeft = d.l - (e.clientX - d.x);
        el.scrollTop = d.t - (e.clientY - d.y);
      }}
      onPointerUp={() => (dragRef.current = null)}
      onPointerCancel={() => (dragRef.current = null)}
    >
      {/* content box sized to cover the viewport (≈ object-cover geometry),
          so img and mask share the exact same box */}
      {box && (
        <div className="relative" style={{ width: box.w, height: box.h }}>
          <img
            src={SCENE_URL}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none"
          />
          {dyeOverlay}
        </div>
      )}
    </div>
  );
}
