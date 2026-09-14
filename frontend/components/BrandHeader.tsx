import Link from "next/link";

export function BrandHeader() {
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link href="/" className="brand" aria-label="RepoLens home">
          <span className="brand-mark" aria-hidden="true" />
          <span>RepoLens</span>
          <span className="brand-subtle mono">repository intelligence</span>
        </Link>
      </div>
    </header>
  );
}
