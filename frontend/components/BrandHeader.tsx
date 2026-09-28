import Link from "next/link";

/**
 * Shared internal header, visually aligned with the landing page brand:
 * same lens mark (two rotated strokes + three node dots), wordmark weight/size,
 * 12px gap, 64px bar, and the landing's tripartite composition
 * (brand · RL / STATIC ANALYSIS · PUBLIC REPOSITORIES · NO EXECUTION).
 * Landing styles live in page.module.css; these mirrors live in globals.css.
 */
export function BrandHeader() {
  return (
    <header className="topbar brand-topbar">
      <div className="container topbar-inner brand-topbar-inner">
        <Link href="/" className="brand" aria-label="RepoLens home">
          <span className="brand-mark-lens" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-word">RepoLens</span>
        </Link>
        <span className="brand-center mono">RL / STATIC ANALYSIS</span>
        <span className="brand-right mono">PUBLIC REPOSITORIES <b>·</b> NO EXECUTION</span>
      </div>
    </header>
  );
}
