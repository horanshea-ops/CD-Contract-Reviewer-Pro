"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Body, Title } from "@/components/ui/typography";

const TABS = [
  { href: "/admin/contracts", label: "Historical contracts" },
  { href: "/admin/users", label: "Users" },
];

/** The Admin tab's heading and its two sections. The standards library has its own nav link. */
export function AdminHeader() {
  const pathname = usePathname();
  return (
    <div className="mb-6">
      <Title className="text-[var(--text-primary)] tracking-tight mb-1">Admin</Title>
      <Body as="p" className="text-[var(--text-secondary)] mb-4">
        Manage who can use the app, and upload past contracts for the Analytics tab.
      </Body>
      <nav aria-label="Admin sections" className="flex gap-1 border-b border-[var(--border)]">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-[var(--cd-navy)] font-medium text-[var(--cd-navy)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--cd-navy)]"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
