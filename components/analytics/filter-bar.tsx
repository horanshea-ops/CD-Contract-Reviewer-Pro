"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Field, FieldInput, FieldSelect } from "@/components/ui/field";
import { withFilter, type FilterOptions, type Option } from "@/lib/analytics/filters";
import type { AnalyticsFilters } from "@/lib/analytics/types";

const STATUS_OPTIONS: Option[] = [
  { value: "signed", label: "Signed" },
  { value: "negotiating", label: "Negotiating" },
  { value: "lost", label: "Lost" },
];

/** Every filter lives in the URL, so a filtered view can be bookmarked or shared. */
export function FilterBar({ filters, options }: { filters: AnalyticsFilters; options: FilterOptions }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const set = (key: keyof AnalyticsFilters, value: string) =>
    startTransition(() => router.push(withFilter("/analytics", filters, key, value || undefined), { scroll: false }));

  const select = (key: keyof AnalyticsFilters, label: string, list: Option[]) => (
    <Field label={label}>
      <FieldSelect value={filters[key] ?? ""} onChange={(e) => set(key, e.target.value)}>
        <option value="">All</option>
        {list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </FieldSelect>
    </Field>
  );

  const active = Object.values(filters).some(Boolean);

  return (
    <div aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : undefined}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {select("brand", "Brand", options.brands)}
        {select("parentCompany", "Parent company", options.parentCompanies)}
        {select("propertyId", "Hotel", options.properties)}
        {select("state", "State or province", options.states)}
        {select("city", "City", options.cities)}
        {select("tier", "Market tier", options.tiers)}
        {select("clientId", "Client", options.clients)}
        {options.associates.length > 0 && select("associateId", "Associate", options.associates)}
        {select("status", "Status", STATUS_OPTIONS)}
        <Field label="Event from">
          <FieldInput type="date" value={filters.from ?? ""} onChange={(e) => set("from", e.target.value)} />
        </Field>
        <Field label="Event to">
          <FieldInput type="date" value={filters.to ?? ""} onChange={(e) => set("to", e.target.value)} />
        </Field>
      </div>
      {active && (
        <Link href="/analytics" scroll={false} className="mt-2 inline-block text-sm text-[var(--cd-navy)] underline underline-offset-2">
          Clear filters
        </Link>
      )}
    </div>
  );
}
