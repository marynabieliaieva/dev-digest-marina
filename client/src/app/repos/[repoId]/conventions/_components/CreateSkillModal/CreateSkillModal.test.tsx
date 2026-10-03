import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import conventionsMessages from "../../../../../../../messages/en/conventions.json";
import skillsMessages from "../../../../../../../messages/en/skills.json";
import { CreateSkillModal } from "./CreateSkillModal";

afterEach(cleanup);
afterEach(() => vi.clearAllMocks());

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const success = vi.fn();
vi.mock("@/lib/toast", () => ({ useToast: () => ({ success, error: vi.fn(), info: vi.fn() }) }));

const previewMutate = vi.fn();
const createMutateAsync = vi.fn();
let previewPending = false;
let createPending = false;

vi.mock("@/lib/hooks/conventions", () => ({
  useConventionSkillPreview: () => ({
    mutate: previewMutate,
    isPending: previewPending,
  }),
  useCreateSkillFromConventions: () => ({
    mutateAsync: createMutateAsync,
    isPending: createPending,
  }),
}));

const DRAFT = {
  name: "widgets-conventions",
  description: "1 house convention extracted from acme/widgets",
  type: "convention" as const,
  body: "Flag changes that violate any rule below.\n\n## Naming: Service classes are suffixed with Service.",
  token_count: 42,
};

function renderModal(props: Partial<React.ComponentProps<typeof CreateSkillModal>> = {}) {
  // The preview mutation fires on mount; resolve it immediately with DRAFT
  // unless a test overrides previewMutate's implementation beforehand.
  previewMutate.mockImplementation((_ids: string[], opts?: { onSuccess?: (d: typeof DRAFT) => void }) => {
    opts?.onSuccess?.(DRAFT);
  });
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: conventionsMessages, skills: skillsMessages }}>
      <CreateSkillModal repoId="repo1" candidateIds={["c1", "c2"]} onClose={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("CreateSkillModal", () => {
  it("loads the merged draft into editable fields", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue(DRAFT.name)).toBeInTheDocument());
    expect(screen.getByDisplayValue(DRAFT.description)).toBeInTheDocument();
    expect(screen.getByText(/Merged from 2 accepted conventions/)).toBeInTheDocument();
  });

  it("disables Create skill when the body is emptied", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue(DRAFT.name)).toBeInTheDocument());
    // name (input) → description (input) → body (textarea), in field order.
    const textboxes = screen.getAllByRole("textbox");
    const body = textboxes[textboxes.length - 1]!;
    fireEvent.change(body, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Create skill" })).toBeDisabled();
  });

  it("saves the edited draft, toasts, and routes to the new skill", async () => {
    createMutateAsync.mockResolvedValue({ id: "sk-99", name: DRAFT.name });
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue(DRAFT.name)).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue(DRAFT.name), { target: { value: "custom-conventions" } });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled());
    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: "custom-conventions", candidateIds: ["c1", "c2"] }),
    );
    expect(success).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/sk-99");
  });

  it("surfaces a save failure inline instead of routing away", async () => {
    createMutateAsync.mockRejectedValue(new Error("boom"));
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue(DRAFT.name)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });
});
