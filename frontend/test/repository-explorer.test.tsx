import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepositoryExplorer } from "../components/RepositoryExplorer";

const files = [
  { path: "src/service/user.py", language: "python" as const, parse_status: "success" as const, layer: "service", size_bytes: 120, symbol_count: 4, import_count: 2 },
  { path: "src/repository/user.py", language: "python" as const, parse_status: "success" as const, layer: "repository", size_bytes: 90, symbol_count: 2, import_count: 1 },
];

describe("repository explorer", () => {
  it("groups real file summaries by layer and links into file inspection", () => {
    render(<RepositoryExplorer files={files} analysisId="abc" />);
    expect(screen.getByText("service")).toBeInTheDocument();
    expect(screen.getByText("repository")).toBeInTheDocument();
    expect(screen.getByText("src/service/user.py")).toBeInTheDocument();
    // Path separators stay literal so the catch-all file route resolves the segment array.
    expect(screen.getByRole("link", { name: /src\/service\/user\.py/i })).toHaveAttribute("href", "/analyze/abc/files/src/service/user.py");
  });
});
