"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";

const SECTIONS = [
  { slug: "/overview", label: "OVERVIEW" },
  { slug: "/architecture", label: "ARCHITECTURE" },
  { slug: "/graph", label: "GRAPH" },
  { slug: "/files", label: "FILES" },
  { slug: "/insights", label: "INSIGHTS" },
] as const;

/**
 * Compact technical section rail shared by every analysis page.
 * Reads the analysis id from the route params, so no page needs to pass props.
 */
export function AnalysisNav() {
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id) return null;

  return (
    <nav className="analysis-nav" aria-label="Analysis sections">
      {SECTIONS.map((section) => {
        const href = `/analyze/${encodeURIComponent(id)}${section.slug}`;
        const active = pathname?.startsWith(`/analyze/${id}${section.slug}`) ?? false;
        return (
          <Link
            key={section.slug}
            href={href}
            className={`analysis-nav-item mono${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {section.label}
          </Link>
        );
      })}
      <Link href="/" className="analysis-nav-item mono">ANALYZE ANOTHER</Link>
    </nav>
  );
}
