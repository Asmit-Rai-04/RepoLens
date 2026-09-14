import type { ParseStatus, SupportedLanguage } from "./types";

export interface FileSummary {
  path: string;
  language: SupportedLanguage | null;
  parse_status: ParseStatus;
  layer: string | null;
  size_bytes: number;
  symbol_count: number;
  import_count: number;
}

export interface FileImportEvidence {
  module?: string;
  kind?: string;
  imported_names?: string[];
  alias?: string | null;
  line_start?: number;
  line_end?: number;
  target?: string;
  target_file?: string | null;
  resolved?: boolean;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  line_start: number;
  line_end: number;
  column_start: number;
  column_end: number;
  parent: string | null;
}

export interface ImportInfo {
  module: string;
  kind: "import" | "from_import" | "require";
  imported_names: string[];
  alias: string | null;
  line_start: number;
  line_end: number;
}

export interface InheritanceInfo {
  child: string;
  parent: string;
  relation: "extends" | "implements" | "inherits";
  line_start: number;
  line_end: number;
}

/** Mirrors the backend `SourceFile` model exactly. */
export interface SourceFileInfo {
  path: string;
  kind: "source";
  language: SupportedLanguage | null;
  parse_status: ParseStatus;
  parse_error: string | null;
  size_bytes: number;
  package_name: string | null;
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  inheritance: InheritanceInfo[];
}

export interface FileDetailResponse {
  source_file: SourceFileInfo;
  layer: string | null;
  resolved_imports: FileImportEvidence[];
  unresolved_imports: FileImportEvidence[];
  external_imports: FileImportEvidence[];
}

export interface SourceResponse {
  path: string;
  content: string;
  language: SupportedLanguage | null;
}
