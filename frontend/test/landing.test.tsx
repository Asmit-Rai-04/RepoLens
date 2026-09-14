import { describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HomePage from "../app/page";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));


describe("landing page", () => {
  it("validates input and submits on Enter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ analysis_id: "abc", status: "queued" }), { status: 202 })));
    render(<HomePage />);
    const input = screen.getByLabelText(/GitHub repository URL/i);
    fireEvent.change(input, { target: { value: "not-a-repo" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("valid public GitHub repository URL");

    fireEvent.change(input, { target: { value: "https://github.com/user/repository" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/analyze/abc"));
  });
});
