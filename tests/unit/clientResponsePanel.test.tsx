// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ClientResponsePanel from "@/app/(dashboard)/dashboard/usage/components/ClientResponsePanel";

afterEach(cleanup);

describe("ClientResponsePanel", () => {
  it("names the tools an answer called instead of calling it empty", () => {
    render(<ClientResponsePanel content="" toolCalls={["write_file", "bash"]} />);
    expect(screen.getByText(/The model answered by calling tools/)).toBeTruthy();
    expect(screen.getByText("write_file")).toBeTruthy();
    expect(screen.getByText("bash")).toBeTruthy();
    expect(screen.queryByText(/Empty streaming response/)).toBeNull();
  });

  it("still says so when the answer really has nothing", () => {
    render(<ClientResponsePanel content="" />);
    expect(screen.getByText("[No content]")).toBeTruthy();
  });
});
