"use client";

import { useState } from "react";
import Link from "next/link";
import { NavFooter, NavLinkList, type NavAssociate } from "@/components/nav-links";

/** Slim top bar + off-canvas drawer, shown only below the lg breakpoint where SidebarNav is hidden. */
export default function MobileTopBar({ associate }: { associate: NavAssociate | null }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden sticky top-0 z-20 border-b border-[var(--border)] bg-white">
      <div className="h-14 px-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white text-xs font-bold"
            style={{ background: "linear-gradient(135deg, var(--cd-navy), var(--cd-navy-darker))" }}
          >
            CD
          </span>
          <span className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">Contract Reviewer</span>
        </Link>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav-drawer"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
        >
          {open ? (
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

      {open && (
        <div id="mobile-nav-drawer" className="border-t border-[var(--border)] py-3">
          <NavLinkList associate={associate} onNavigate={() => setOpen(false)} />
          <div className="border-t border-[var(--border)] mt-3 pt-3">
            <NavFooter associate={associate} />
          </div>
        </div>
      )}
    </div>
  );
}
