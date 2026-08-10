import { useState } from "react";
import { Expand, Heart, Pipette, Scan, SlidersHorizontal, X } from "lucide-react";
import { HairScene, type ViewMode } from "./components/HairScene";
import { Slider } from "./components/Slider";
import { useColorMix } from "./hooks/useColorMix";
import { useReverseSolve } from "./hooks/useReverseSolve";

type Mode = "forward" | "reverse";

const PIGMENTS = [
  { key: "red" as const, label: "红", color: "#d43a3a" },
  { key: "purple" as const, label: "紫", color: "#7a4fd0" },
  { key: "blue" as const, label: "蓝", color: "#3a5fd4" },
];

export default function App() {
  const [mode, setMode] = useState<Mode>("forward");
  const [viewMode, setViewMode] = useState<ViewMode>("fit");
  const [showInfo, setShowInfo] = useState(() =>
    new URLSearchParams(window.location.search).has("info")
  );
  const [amounts, setAmounts] = useState({ red: 5, purple: 1, blue: 0.2 });
  const [targetHex, setTargetHex] = useState("#c2185b");

  const forward = useColorMix(amounts.red, amounts.purple, amounts.blue);
  const reverse = useReverseSolve(targetHex);

  const hairHex =
    mode === "forward" ? (forward?.hex ?? null) : (reverse?.hex ?? null);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#e9e2d6]">
      {/* Immersive hair scene — fills entire viewport */}
      <HairScene colorHex={hairHex} viewMode={viewMode} />

      {/* Logo — floating pill, top left; opens info modal */}
      <button
        onClick={() => setShowInfo(true)}
        className="absolute left-3 top-3 rounded-full bg-white/70 px-4 py-2.5 shadow-lg shadow-black/5 backdrop-blur-xl"
      >
        <span className="inline-block translate-y-[0.08em] font-display text-2xl leading-none tracking-wide text-neutral-900">
          HAIR
        </span>
        <span className="inline-block translate-y-[0.08em] font-display text-2xl font-bold leading-none tracking-wide text-[#d6246e]">
          Formula
        </span>
      </button>

      {/* Info modal */}
      {showInfo && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/25 p-6 backdrop-blur-sm"
          onClick={() => setShowInfo(false)}
        >
          <div
            className="relative w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowInfo(false)}
              aria-label="关闭"
              className="absolute right-3 top-3 rounded-full p-1 text-neutral-400 hover:text-neutral-900"
            >
              <X size={16} />
            </button>
            <p className="flex items-center gap-1.5 font-display text-lg leading-none text-neutral-900">
              For M.H.Y.
              <Heart size={15} className="fill-[#d6246e] text-[#d6246e]" />
            </p>
            <a
              href="https://github.com/Minsecrus/HairFormula"
              target="_blank"
              rel="noreferrer"
              className="mt-3 block text-xs text-neutral-400 underline-offset-4 hover:text-neutral-600 hover:underline"
            >
              github.com/Minsecrus/HairFormula
            </a>
          </div>
        </div>
      )}

      {/* View-mode toggle — floating pill, top right */}
      <div className="absolute right-3 top-4">
        <div className="flex rounded-full bg-white/70 p-0.5 shadow-lg shadow-black/5 backdrop-blur-xl">
          {(["fit", "full"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              aria-label={v === "fit" ? "等比" : "整图"}
              className={`rounded-full p-2 transition-all ${
                viewMode === v
                  ? "bg-neutral-900 text-white shadow-sm"
                  : "text-neutral-500"
              }`}
            >
              {v === "fit" ? <Scan size={15} /> : <Expand size={15} />}
            </button>
          ))}
        </div>
      </div>
      {/* Floating control island */}
      <div className="absolute inset-x-3 bottom-3 md:inset-x-auto md:bottom-6 md:right-6 md:w-[320px]">
        <div className="rounded-2xl bg-white/75 p-4 shadow-xl shadow-black/5 backdrop-blur-xl">
          {/* Mode toggle */}
          <div className="mb-3 flex rounded-lg bg-neutral-900/5 p-0.5">
            {(["forward", "reverse"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-label={m === "forward" ? "配色" : "反推"}
                className={`flex flex-1 items-center justify-center rounded-md py-2 transition-all ${
                  mode === m
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500"
                }`}
              >
                {m === "forward" ? (
                  <SlidersHorizontal size={15} />
                ) : (
                  <Pipette size={15} />
                )}
              </button>
            ))}
          </div>

          {mode === "forward" ? (
            <>
              <div className="space-y-2.5">
                {PIGMENTS.map((p) => (
                  <Slider
                    key={p.key}
                    label={p.label}
                    color={p.color}
                    value={amounts[p.key]}
                    onChange={(v) =>
                      setAmounts((prev) => ({ ...prev, [p.key]: v }))
                    }
                  />
                ))}
              </div>
              <p className="mt-2.5 text-center text-sm tabular-nums text-neutral-600">
                {amounts.red.toFixed(1)} : {amounts.purple.toFixed(1)} :{" "}
                {amounts.blue.toFixed(1)}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={targetHex}
                  onChange={(e) => setTargetHex(e.target.value)}
                  className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                />
                <input
                  type="text"
                  value={targetHex}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTargetHex(v.startsWith("#") ? v : `#${v}`);
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-200/60 bg-white/80 px-3 py-1.5 text-center text-sm tabular-nums"
                  maxLength={7}
                  spellCheck={false}
                />
              </div>
              {reverse && (
                <div className="mt-2.5 text-center">
                  <p className="text-sm tabular-nums text-neutral-600">
                    红 {(reverse.ratios.red * 10).toFixed(1)} : 紫{" "}
                    {(reverse.ratios.purple * 10).toFixed(1)} : 蓝{" "}
                    {(reverse.ratios.blue * 10).toFixed(1)}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
