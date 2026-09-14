import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StageList } from "../components/StageList";

describe("analysis stages", () => {
  it("renders the real backend stages without invented progress", () => {
    render(<StageList stage="building_graph" />);
    expect(screen.getByText("QUEUED")).toBeInTheDocument();
    expect(screen.getByText("INGESTING")).toBeInTheDocument();
    expect(screen.getByText("PARSING")).toBeInTheDocument();
    expect(screen.getByText("BUILDING GRAPH")).toBeInTheDocument();
    expect(screen.getByText("DETECTING ARCHITECTURE")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
