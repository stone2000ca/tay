// Tests for app/queue/actions.ts.
//
// The action calls Next's redirect() to surface errors via ?error= so
// the queue page renders a banner. Next throws a special "redirect"
// error from the redirect() helper; we catch its tag to confirm the
// action took that path without actually traversing routes.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const sendDraftMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  // Next's real redirect() throws to break the await chain. Mimic.
  const err = new Error(`NEXT_REDIRECT:${url}`);
  (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
  throw err;
});
const revalidatePathMock = vi.fn();

vi.mock("@/lib/send/orchestrate", () => ({
  sendDraft: (id: string) => sendDraftMock(id),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

beforeEach(() => {
  sendDraftMock.mockReset();
  redirectMock.mockClear();
  revalidatePathMock.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendDraftAction", () => {
  test("redirects with ?error= on missing draftId", async () => {
    const { sendDraftAction } = await import("./actions");
    const fd = new FormData();
    await expect(sendDraftAction(fd)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/queue\?error=/),
    );
  });

  test("redirects with ?error= on orchestrator failure (encoded)", async () => {
    sendDraftMock.mockResolvedValue({
      ok: false,
      error: "Recipient is on the suppression list.",
    });
    const { sendDraftAction } = await import("./actions");
    const fd = new FormData();
    fd.set("draftId", "d1");
    await expect(sendDraftAction(fd)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(
      "/queue?error=" + encodeURIComponent("Recipient is on the suppression list."),
    );
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  test("revalidates /queue on success (no redirect)", async () => {
    sendDraftMock.mockResolvedValue({
      ok: true,
      gmailMessageId: "gm-1",
      gmailThreadId: "gt-1",
      recipient: "j@e.co",
    });
    const { sendDraftAction } = await import("./actions");
    const fd = new FormData();
    fd.set("draftId", "d1");
    await sendDraftAction(fd);
    expect(revalidatePathMock).toHaveBeenCalledWith("/queue");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
