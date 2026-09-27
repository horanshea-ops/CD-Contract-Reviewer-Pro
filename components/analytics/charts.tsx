"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Bin, BrandCommission, TermConcession, TrendPoint, VolumePoint } from "@/lib/analytics/stats";

const AXIS = { fontSize: 11, fill: "var(--text-muted)" };
const GRID = "var(--border)";
const TOOLTIP = {
  contentStyle: { fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" },
  labelStyle: { color: "var(--text-primary)", fontWeight: 600 },
};

function Empty({ text }: { text: string }) {
  return <p className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">{text}</p>;
}

/** Median signed group rate by event quarter. Quarters under the sample minimum leave a gap. */
export function RateTrendChart({ points }: { points: TrendPoint[] }) {
  if (!points.some((p) => p.value !== null)) return <Empty text="Not enough signed contracts yet." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="period" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${v}`} domain={["auto", "auto"]} />
        <Tooltip
          {...TOOLTIP}
          formatter={(v, _name, item) => [`$${v} median (${(item.payload as TrendPoint).n} contracts)`, "Group rate"]}
        />
        <Line type="linear" dataKey="value" stroke="var(--cd-navy)" strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** For each term CD asked about, how often the hotel gave it in full, in part, or not at all. */
export function ConcessionChart({ rows }: { rows: TermConcession[] }) {
  const data = rows
    .filter((r) => r.full.value !== null)
    .map((r) => ({ label: r.label, full: r.full.value, partial: r.partial.value, held: r.held.value, n: r.asked }));
  if (!data.length) return <Empty text="Not enough signed contracts yet." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap={4}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="label" tick={AXIS} tickLine={false} axisLine={false} width={150} />
        <Tooltip
          {...TOOLTIP}
          formatter={(v, name) => [`${Math.round(Number(v))}%`, name]}
          labelFormatter={(label, payload) => `${label} (${payload?.[0]?.payload?.n ?? 0} asks)`}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="full" name="Given in full" stackId="a" fill="var(--status-success)" />
        <Bar dataKey="partial" name="Met partway" stackId="a" fill="var(--cd-blue)" />
        <Bar dataKey="held" name="Refused" stackId="a" fill="var(--border-strong)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Signed contracts at each attrition threshold, with CD's standard marked. */
export function DistributionChart({ bins, standard, unit }: { bins: Bin[]; standard?: number; unit: string }) {
  if (!bins.length) return <Empty text="No signed contracts yet." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={bins} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="value" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(v) => `${v}${unit}`} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
        <Tooltip {...TOOLTIP} formatter={(v) => [`${v} contracts`, "Signed"]} labelFormatter={(v) => `${v}${unit}`} />
        <Bar dataKey="count" fill="var(--cd-navy)" radius={[3, 3, 0, 0]} />
        {standard != null && (
          <ReferenceLine
            x={standard}
            stroke="var(--status-success)"
            strokeDasharray="4 3"
            label={{ value: "CD standard", position: "top", fontSize: 11, fill: "var(--status-success)" }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Contracts opened each month, split by outcome. */
export function VolumeChart({ points }: { points: VolumePoint[] }) {
  if (!points.length) return <Empty text="No contracts yet." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <Tooltip {...TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="signed" name="Signed" stackId="a" fill="var(--cd-navy)" />
        <Bar dataKey="negotiating" name="Negotiating" stackId="a" fill="var(--cd-blue-light)" />
        <Bar dataKey="lost" name="Lost" stackId="a" fill="var(--border-strong)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Average signed commission per brand, with CD's 10% standard marked. Brands under the sample minimum are left off. */
export function CommissionChart({ rows, standard }: { rows: BrandCommission[]; standard: number }) {
  const data = rows.filter((r) => r.average !== null);
  if (!data.length) return <Empty text="Not enough signed contracts yet." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 16, right: 12, bottom: 0, left: 0 }} barCategoryGap={4}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" domain={[0, 12]} ticks={[0, 2, 4, 6, 8, 10, 12]} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="brand" tick={AXIS} tickLine={false} axisLine={false} width={130} />
        <Tooltip
          {...TOOLTIP}
          formatter={(v, _name, item) => [`${v}% average (${(item.payload as BrandCommission).n} contracts)`, "Commission"]}
        />
        <Bar dataKey="average" fill="var(--cd-navy)" radius={[0, 3, 3, 0]} />
        <ReferenceLine
          x={standard}
          stroke="var(--status-success)"
          strokeDasharray="4 3"
          label={{ value: "CD standard", position: "top", fontSize: 11, fill: "var(--status-success)" }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
