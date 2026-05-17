// Tests for app/setup/mailbox/actions.ts.
//
// Focus: the v1.1.2 fix-pass change — disconnectMailboxAction must honor
// an optional `redirectTo` FormData field so Settings keeps the user on
// Settings while the wizard still defaults to /setup/mailbox. We mock
// Next's redirect() the same way other action tests do (throw with a
// NEXT_REDIRECT digest) so we can assert on the URL the action chose.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const clearMailboxCredentialsMock = vi.fn();
const appendAuditMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`);
  (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
  throw err;
});

vi.mock("@/lib/mailbox/persist", () => ({
  clearMailboxCredentials: () => clearMailboxCredentialsMock(),
  saveMailboxCredentials: vi.fn(),
}));
vi.mock("@/lib/audit/append", () => ({
  appendAudit: (input: unknown) => appendAuditMock(input),
}));
vi.mock("@/lib/supabase/migrate", () => ({
  ensureSchema: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/send/smtp-verify", () => ({
  verifySmtpCredentials: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

beforeEach(() => {
  clearMailboxCredentialsMock.mockReset();
  appendAuditMock.mockReset();
  redirectMock.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("disconnectMailboxAction redirect target", () => {
  test("defaults to /setup/mailbox?disconnected=1 when no FormData provided", async () => {
    clearMailboxCredentialsMock.mockResolvedValue(undefined);
    appendAuditMock.mockResolvedValue(undefined);

    const { disconnectMailboxAction } = await import("./actions");

    await expect(disconnectMailboxAction()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith("/setup/mailbox?disconnected=1");
  });

  test("defaults to /setup/mailbox?disconnected=1 when FormData has no redirectTo", async () => {
    clearMailboxCredentialsMock.mockResolvedValue(undefined);
    appendAuditMock.mockResolvedValue(undefined);

    const { disconnectMailboxAction } = await import("./actions");
    const form = new FormData();

    await expect(disconnectMailboxAction(form)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(redirectMock).toHaveBeenCalledWith("/setup/mailbox?disconnected=1");
  });

  test("honors redirectTo from FormData (Settings disconnect button)", async () => {
    clearMailboxCredentialsMock.mockResolvedValue(undefined);
    appendAuditMock.mockResolvedValue(undefined);

    const { disconnectMailboxAction } = await import("./actions");
    const form = new FormData();
    form.set("redirectTo", "/settings?disconnected=1");

    await expect(disconnectMailboxAction(form)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(redirectMock).toHaveBeenCalledWith("/settings?disconnected=1");
  });

  test("rejects non-relative redirectTo (external URL) and falls back to wizard default", async () => {
    clearMailboxCredentialsMock.mockResolvedValue(undefined);
    appendAuditMock.mockResolvedValue(undefined);

    const { disconnectMailboxAction } = await import("./actions");
    const form = new FormData();
    form.set("redirectTo", "https://evil.example.com/steal");

    await expect(disconnectMailboxAction(form)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(redirectMock).toHaveBeenCalledWith("/setup/mailbox?disconnected=1");
  });

  test("on disconnect failure, redirects to error path that respects redirectTo base", async () => {
    clearMailboxCredentialsMock.mockRejectedValue(new Error("db down"));

    const { disconnectMailboxAction } = await import("./actions");
    const form = new FormData();
    form.set("redirectTo", "/settings?disconnected=1");

    await expect(disconnectMailboxAction(form)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/settings?error=disconnect_failed",
    );
  });
});
