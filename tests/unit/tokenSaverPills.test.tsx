// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TokenSaverPills from "@/app/(dashboard)/dashboard/basic-chat/sections/TokenSaverPills";

describe("TokenSaverPills", () => {
  it("mostra uma pill por economizador que atuou, com a explicação acessível", () => {
    render(<TokenSaverPills savers={["synapse", "rtk"]} />);
    const list = screen.getByRole("list", { name: /token savers/i });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("Synapse")).toBeTruthy();
    expect(screen.getByText("RTK")).toBeTruthy();
    expect(screen.getByText("Synapse").closest("li")?.getAttribute("title")).toMatch(/without calling the model/i);
  });

  it("não renderiza nada quando nenhum atuou", () => {
    const { container } = render(<TokenSaverPills savers={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
