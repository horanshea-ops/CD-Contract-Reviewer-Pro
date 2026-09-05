"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { BrandMark, NavFooter, NavLinkList, type NavAssociate } from "@/components/nav-links";

const COLLAPSED_STORAGE_KEY = "cd-sidebar-collapsed";

/** Persistent left sidebar, desktop only (lg and up) — see MobileTopBar for the collapsed/drawer equivalent below that breakpoint. */
export default function SidebarNav({ associate }: { associate: NavAssociate | null }) {
  const [collapsed, setCollapsed] = useState(false);

  // Read the persisted preference after mount rather than in the initial
  // state so server and client agree on the first render (localStorage
  // isn't available during SSR) — avoids a hydration mismatch.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1");
    } catch {
      // Storage unavailable (private mode, etc.) — default to expanded.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore — persistence is a nicety, not a requirement.
      }
      return next;
    });
  }

  return (
    <div
      className={cn(
        "hidden lg:flex lg:flex-col lg:shrink-0 h-full border-r border-[var(--border)] bg-white relative transition-[width] duration-200 ease-in-out",
        collapsed ? "lg:w-16" : "lg:w-60"
      )}
    >
      <BrandMark collapsed={collapsed} />

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-14 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-strong)] bg-white text-[var(--text-secondary)] shadow-sm hover:text-[var(--cd-navy)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={cn("transition-transform", collapsed && "rotate-180")}
        >
          <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto py-3">
        <NavLinkList associate={associate} collapsed={collapsed} />
      </div>
      <NavFooter associate={associate} collapsed={collapsed} />
    </div>
  );
}
