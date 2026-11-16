import React, { useState } from 'react';

export interface SeriesPoint {
  label: string;
  primary: number;
  secondary?: number;
}

export function DualTrendChart({
  data,
  primaryLabel,
  secondaryLabel,
  formatPrimary = (n) => n.toLocaleString(),
  formatSecondary = (n) => `$${n.toLocaleString()}`,
}: {
  data: SeriesPoint[];
  primaryLabel: string;
  secondaryLabel: string;
  formatPrimary?: (n: number) => string;
  formatSecondary?: (n: number) => string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 640;
  const height = 220;
  const padL = 44;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const maxPrimary = Math.max(1, ...data.map((d) => d.primary));
  const maxSecondary = Math.max(1, ...data.map((d) => d.secondary || 0));

  const getX = (i: number) =>
    data.length <= 1 ? padL + innerW / 2 : padL + (i / (data.length - 1)) * innerW;

  const getY1 = (val: number) => padT + innerH - (val / maxPrimary) * innerH;
  const getY2 = (val: number) => padT + innerH - (val / maxSecondary) * innerH;

  const primaryPoints = data.map((d, i) => `${getX(i)},${getY1(d.primary)}`).join(' ');
  const primaryArea = data.length
    ? `${padL},${padT + innerH} ${primaryPoints} ${getX(data.length - 1)},${padT + innerH}`
    : '';
  const secondaryPoints = data.map((d, i) => `${getX(i)},${getY2(d.secondary || 0)}`).join(' ');

  const hovered = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-indigo-600 dark:bg-indigo-400" />
            {primaryLabel}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-emerald-600 dark:bg-emerald-400" />
            {secondaryLabel}
          </span>
        </div>
        {hovered && (
          <div className="flex items-center gap-3 text-xs tabular-nums text-slate-700 dark:text-slate-300">
            <span className="font-medium">{hovered.label}</span>
            <span>{primaryLabel}: {formatPrimary(hovered.primary)}</span>
            <span>{secondaryLabel}: {formatSecondary(hovered.secondary || 0)}</span>
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full overflow-visible"
        role="img"
        aria-label={`${primaryLabel} and ${secondaryLabel} trend chart`}
      >
        <defs>
          <linearGradient id="rpAreaIndigo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + innerH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="currentColor"
                className="text-slate-200 dark:text-slate-800"
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-400 text-[10px] font-mono tabular-nums dark:fill-slate-500"
              >
                {Math.round(maxPrimary * t)}
              </text>
            </g>
          );
        })}

        {data.length > 0 && (
          <>
            <polygon points={primaryArea} fill="url(#rpAreaIndigo)" />
            <polyline
              fill="none"
              stroke="#4f46e5"
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={primaryPoints}
            />
            <polyline
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeDasharray="4 3"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={secondaryPoints}
            />
          </>
        )}

        {data.map((d, i) => {
          const x = getX(i);
          const y1 = getY1(d.primary);
          const y2 = getY2(d.secondary || 0);
          return (
            <g key={d.label + i}>
              <text
                x={x}
                y={height - 6}
                textAnchor="middle"
                className="fill-slate-500 text-[10px] font-mono dark:fill-slate-400"
              >
                {d.label}
              </text>
              {hoverIdx === i && (
                <line
                  x1={x}
                  y1={padT}
                  x2={x}
                  y2={padT + innerH}
                  stroke="currentColor"
                  className="text-slate-300 dark:text-slate-700"
                  strokeDasharray="2 2"
                />
              )}
              <circle
                cx={x}
                cy={y1}
                r={hoverIdx === i ? 4.5 : 3}
                className="fill-indigo-600 stroke-white dark:fill-indigo-400 dark:stroke-slate-900"
                strokeWidth="1.5"
              />
              <circle
                cx={x}
                cy={y2}
                r={hoverIdx === i ? 4.5 : 2.5}
                className="fill-emerald-600 stroke-white dark:fill-emerald-400 dark:stroke-slate-900"
                strokeWidth="1.5"
              />
              <rect
                x={x - innerW / Math.max(2, data.length * 2)}
                y={padT}
                width={innerW / Math.max(1, data.length)}
                height={innerH}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function HorizontalBarList({
  items,
  formatValue = (v) => v.toLocaleString(),
  barColorClass = 'bg-indigo-600 dark:bg-indigo-500',
}: {
  items: Array<{ label: string; value: number; sublabel?: string }>;
  formatValue?: (v: number) => string;
  barColorClass?: string;
}) {
  const maxVal = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) {
    return <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">No channel data recorded yet.</p>;
  }
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const pct = Math.max(3, Math.round((item.value / maxVal) * 100));
        return (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-200">
                {item.label}
                {item.sublabel && (
                  <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                    {item.sublabel}
                  </span>
                )}
              </div>
              <span className="shrink-0 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                {formatValue(item.value)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-300 ${barColorClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ScoreRing({ score, size = 84 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  const strokeColor =
    clamped >= 80
      ? 'stroke-emerald-600 dark:stroke-emerald-400'
      : clamped >= 55
      ? 'stroke-amber-500 dark:stroke-amber-400'
      : 'stroke-red-600 dark:stroke-red-400';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-slate-200 dark:stroke-slate-800"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`transition-all duration-500 ${strokeColor}`}
        />
      </svg>
      <span className="absolute font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {clamped}
      </span>
    </div>
  );
}
