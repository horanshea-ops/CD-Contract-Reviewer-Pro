import { BrandMark, NavFooter, NavLinkList, type NavAssociate } from "@/components/nav-links";

/** Persistent left sidebar, desktop only (lg and up) — see MobileTopBar for the collapsed/drawer equivalent below that breakpoint. */
export default function SidebarNav({ associate }: { associate: NavAssociate | null }) {
  return (
    <div className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 h-full border-r border-[var(--border)] bg-white">
      <BrandMark />
      <div className="flex-1 min-h-0 overflow-y-auto py-3">
        <NavLinkList associate={associate} />
      </div>
      <NavFooter associate={associate} />
    </div>
  );
}
