interface SliderProps {
  label: string;
  color: string;
  value: number;
  onChange: (v: number) => void;
}

export function Slider({ label, color, value, onChange }: SliderProps) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="h-4 w-4 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="w-4 shrink-0 text-sm font-medium">{label}</span>
      <input
        type="range"
        min={0}
        max={10}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
        style={{ "--slider-color": color } as React.CSSProperties}
      />
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-neutral-400">
        {value.toFixed(1)}
      </span>
    </div>
  );
}
