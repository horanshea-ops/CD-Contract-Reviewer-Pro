"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { StatusPill } from "@/components/ui/status-pill";
import SignOutButton from "@/components/sign-out-button";

export interface NavAssociate {
  name: string;
  email: string;
  is_admin: boolean;
}

const ICONS: Record<string, React.ReactNode> = {
  "/": (
    <path
      d="M3 9.5l7-6 7 6M5 8.5v7.5a1 1 0 001 1h2.5v-5h3v5H14a1 1 0 001-1V8.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  "/upload": (
    <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  ),
  "/admin/standards": (
    <>
      <path
        d="M4 4.5A1.5 1.5 0 015.5 3H10v14H5.5A1.5 1.5 0 014 15.5v-11z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M16 4.5A1.5 1.5 0 0014.5 3H10v14h4.5a1.5 1.5 0 001.5-1.5v-11z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
    </>
  ),
};

export function navLinks(associate: NavAssociate | null) {
  return [
    { href: "/", label: "Dashboard" },
    { href: "/upload", label: "New review" },
    ...(associate?.is_admin ? [{ href: "/admin/standards", label: "Standards library" }] : []),
  ];
}

/**
 * Shared vertical nav list used by both the desktop sidebar and the mobile
 * drawer — one visual recipe (icon + label, pill-highlighted active state)
 * instead of maintaining the same list twice.
 */
export function NavLinkList({ associate, onNavigate }: { associate: NavAssociate | null; onNavigate?: () => void }) {
  const pathname = usePathname();
  const links = navLinks(associate);

  return (
    <nav className="flex flex-col gap-1 px-3">
      {links.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)] font-medium"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--cd-navy)]"
            )}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
              {ICONS[link.href]}
            </svg>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Associate name/admin badge + sign out, pinned to the bottom of either nav surface. */
export function NavFooter({ associate }: { associate: NavAssociate | null }) {
  return (
    <div className="px-3">
      {associate && (
        <div className="flex items-center gap-2 text-sm px-3 py-2">
          <span className="text-[var(--text-primary)] font-medium truncate">{associate.name}</span>
          {associate.is_admin && (
            <StatusPill label="admin" className="bg-[var(--cd-blue-pale)] text-[var(--cd-navy)] shrink-0" />
          )}
        </div>
      )}
      <div className="px-3 pb-1">
        <SignOutButton />
      </div>
    </div>
  );
}

export function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2 px-5 h-16 border-b border-[var(--border)] shrink-0">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-xs font-bold"
        style={{ background: "linear-gradient(135deg, var(--cd-navy), var(--cd-navy-darker))" }}
      >
        CD
      </span>
      <span className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">Contract Reviewer</span>
    </Link>
  );
}
