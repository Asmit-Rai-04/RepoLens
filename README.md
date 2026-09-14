<p align="center">
  <img src="docs/images/repolens-banner.png" alt="RepoLens — Codebases made clear" width="100%">
</p>

<h1 align="center">RepoLens</h1>

<p align="center">
  <strong>Understand unfamiliar codebases without reading every file.</strong>
</p>

<p align="center">
  Intelligent static analysis for GitHub repositories — from source code to architecture, dependencies, health, and actionable insights.
</p>

<p align="center">
  <a href="https://github.com/Asmit-Rai-04/RepoLens">GitHub</a>
</p>

---

## What is RepoLens?

RepoLens is an interactive repository intelligence platform that helps developers understand how a codebase is actually structured.

Give it a **public GitHub repository URL** and RepoLens:

- securely downloads the repository
- discovers and classifies source files
- parses supported languages with Tree-sitter
- resolves internal and external dependencies
- builds a dependency graph
- detects architectural patterns
- identifies cycles and coupling hotspots
- calculates deterministic codebase health
- generates actionable engineering insights
- lets you drill from architecture → modules → files → symbols → source

Most importantly, **RepoLens never executes the code it analyzes.**

---

## Why RepoLens?

Understanding an unfamiliar repository usually means jumping between directories, imports, configuration files, and dozens of source files.

RepoLens turns that exploration into a structured view:

```text
GitHub Repository
       │
       ▼
   Secure Ingest
       │
       ▼
  Source Discovery
       │
       ▼
   AST Parsing
       │
       ▼
 Dependency Graph
       │
       ├──────────────┐
       ▼              ▼
 Architecture      Graph Analysis
       │              │
       └──────┬───────┘
              ▼
       Health + Insights
              │
              ▼
      Interactive Explorer