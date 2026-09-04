import Link from "next/link";
import SignOutButton from "./sign-out-button";

export interface NavAssociate {
  name: string;
  email: string;
  is_admin: boolean;
}

export default function NavBar({ associate }: { associate: NavAssociate | null }) {
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
          <Link href="/" className="text-[var(--text-secondary)] hover:text-[var(--cd-navy)]">
            Dashboard
          </Link>
          <Link href="/upload" className="text-[var(--text-secondary)] hover:text-[var(--cd-navy)]">
            New review
          </Link>
          {associate?.is_admin && (
            <Link href="/admin/standards" className="text-[var(--text-secondary)] hover:text-[var(--cd-navy)]">
              Standards library
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {associate && (
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="text-[var(--text-primary)] font-medium">{associate.name}</span>
              {associate.is_admin && (
                <span className="rounded-full bg-[var(--cd-blue-pale)] px-2 py-0.5 text-xs font-medium text-[var(--cd-navy)]">
                  admin
                </span>
              )}
            </div>
          )}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
