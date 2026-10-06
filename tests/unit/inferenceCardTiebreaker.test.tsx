// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SMART_ROUTING_CONFIG } from "@/shared/llm-catalog";
import { InferenceCard } from "@/app/(dashboard)/dashboard/combos/[id]/InferenceCard";

// The real picker needs a provider catalogue; all that matters here is that a
// pick reaches the card's callback.
const pickerProps = vi.fn();
vi.mock("@/shared/components/ModelSelectModal", () => ({
  default: (props: { isOpen: boolean; onSelect: (m: { value: string }) => void }) => {
    pickerProps(props);
    return props.isOpen ? <button onClick={() => props.onSelect({ value: "oc/big-pickle" })}>pick-model</button> : null;
  },
}));

const base = DEFAULT_SMART_ROUTING_CONFIG.classifier;

function renderCard(classifier = base, handlers: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const props = {
    complexityEnabled: true,
    onComplexityEnabledChange: vi.fn(),
    taskEnabled: true,
    onTaskEnabledChange: vi.fn(),
    classifier,
    onClassifierEnabledChange: vi.fn(),
    onClassifierModelChange: vi.fn(),
    activeProviders: [],
    modelAliases: {},
    tunedNote: null,
    ...handlers,
  };
  render(<InferenceCard {...props} />);
  return props;
}

describe("InferenceCard — modelo do desempate", () => {
  afterEach(cleanup);

  it("mostra o seletor com 'Auto' quando o desempate está ligado e nenhum modelo foi escolhido", () => {
    renderCard({ ...base, enabled: true, model: "auto" });
    const picker = screen.getByRole("button", { name: /tiebreaker model/i });
    expect(within(picker).getByText("Auto")).toBeTruthy();
  });

  it("não mostra o seletor com o desempate desligado", () => {
    renderCard({ ...base, enabled: false });
    expect(screen.queryByRole("button", { name: /tiebreaker model/i })).toBeNull();
  });

  it("escolher um modelo avisa o card", () => {
    const props = renderCard({ ...base, enabled: true, model: "auto" });
    fireEvent.click(screen.getByRole("button", { name: /tiebreaker model/i }));
    fireEvent.click(screen.getByText("pick-model"));
    expect(props.onClassifierModelChange).toHaveBeenCalledWith("oc/big-pickle");
  });

  it("o seletor oferece os modelos System One (ex.: Jev) como desempate", () => {
    renderCard({ ...base, enabled: true, model: "auto" });
    fireEvent.click(screen.getByRole("button", { name: /tiebreaker model/i }));
    expect(pickerProps).toHaveBeenLastCalledWith(expect.objectContaining({ includeSystemOne: true }));
  });

  it("com um modelo escolhido, mostra o id e permite voltar para Auto", () => {
    const props = renderCard({ ...base, enabled: true, model: "oc/big-pickle" });
    expect(screen.getByText("oc/big-pickle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /reset.*auto/i }));
    expect(props.onClassifierModelChange).toHaveBeenCalledWith("auto");
  });
});

describe("InferenceCard — descrições em modal de informação", () => {
  afterEach(cleanup);

  it("não deixa a descrição longa na tela; abre num modal pelo 'i'", () => {
    renderCard();
    expect(screen.queryByText(/asks a model to break the tie/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /about ai tiebreaker/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/asks a model to break the tie/i)).toBeTruthy();
  });
});
