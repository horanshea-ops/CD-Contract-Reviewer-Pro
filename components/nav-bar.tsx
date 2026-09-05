"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import SignOutButton from "./sign-out-button";
import { StatusPill } from "@/components/ui/status-pill";

export interface NavAssociate {
  name: string;
  email: string;
  is_admin: boolean;
}

function navLinks(associate: NavAssociate | null) {
  return [
    { href: "/", label: "Dashboard" },
    { href: "/upload", label: "New review" },
    ...(associate?.is_admin ? [{ href: "/admin/standards", label: "Standards library" }] : []),
  ];
}

export default function NavBar({ associate }: { associate: NavAssociate | null }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = navLinks(associate);

  function linkClassName(href: string) {
    return pathname === href
      ? "text-[var(--cd-navy)] font-medium"
      : "text-[var(--text-secondary)] hover:text-[var(--cd-navy)]";
  }

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-white">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-[var(--cd-navy)] text-white text-xs font-bold">
            CD
          </span>
          <span className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
            Contract Reviewer
          </span>
        </Link>

        <nav className="hidden sm:flex items-center gap-6 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              className={linkClassName(link.href)}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {associate && (
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="text-[var(--text-primary)] font-medium">{associate.name}</span>
              {associate.is_admin && (
                <StatusPill label="admin" className="bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" />
              )}
            </div>
          )}
          <div className="hidden sm:block">
            <SignOutButton />
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-panel"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            className="sm:hidden flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
          >
            {mobileOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav id="mobile-nav-panel" className="sm:hidden border-t border-[var(--border)] px-6 py-3">
          <div className="flex flex-col gap-3 text-sm">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
                className={linkClassName(link.href)}
              >
                {link.label}
              </Link>
            ))}
          </div>
          {associate && (
            <div className="flex items-center gap-2 text-sm pt-3 mt-3 border-t border-[var(--border)]">
              <span className="text-[var(--text-primary)] font-medium">{associate.name}</span>
              {associate.is_admin && (
                <StatusPill label="admin" className="bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" />
              )}
            </div>
          )}
          <div className="pt-3">
            <SignOutButton />
          </div>
        </nav>
      )}
    </header>
  );
}
