// Unit tests for lib/llm.ts.
//
// We mock the `openai` SDK so we can exercise the error-mapping branches
// without touching a real network. The test surface is small on purpose:
// one happy path + one per error class. The point is to lock the
// discriminated-union contract so downstream UI code can rely on stable
// `error` keys.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the openai module BEFORE importing lib/llm. The factory exposes:
//   - a default-export class with .chat.completions.create()
//   - the three error classes we map
//
// `create` is a vi.fn assigned by each test so we can choose its
// behavior (resolve vs throw a specific error class) per case.
const createMock = vi.fn();

class FakeAuthError extends Error {
  constructor(message = "auth") {
    super(message);
    this.name = "AuthenticationError";
  }
}
class FakeRateError extends Error {
  constructor(message = "rate") {
    super(message);
    this.name = "RateLimitError";
  }
}
class FakeConnError extends Error {
  constructor(message = "conn") {
    super(message);
    this.name = "APIConnectionError";
  }
}

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = { completions: { create: createMock } };
    constructor(_opts: unknown) {
      /* noop */
    }
  }
  return {
    default: FakeOpenAI,
    AuthenticationError: FakeAuthError,
    RateLimitError: FakeRateError,
    APIConnectionError: FakeConnError,
  };
});

beforeEach(() => {
  createMock.mockReset();
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe("validateLlmKey", () => {
  test("returns ok:true on successful round-trip", async () => {
    const { validateLlmKey } = await import("./llm");
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });

    const result = await validateLlmKey("sk-or-test");
    expect(result).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledOnce();
  });

  test("maps AuthenticationError to invalid-key", async () => {
    const { validateLlmKey } = await import("./llm");
    createMock.mockRejectedValueOnce(new FakeAuthError("401"));

    const result = await validateLlmKey("sk-or-bad");
    expect(result).toEqual({
      ok: false,
      error: "invalid-key",
      message: expect.stringContaining("Invalid API key"),
    });
  });

  test("maps RateLimitError to rate-limited", async () => {
    const { validateLlmKey } = await import("./llm");
    createMock.mockRejectedValueOnce(new FakeRateError("429"));

    const result = await validateLlmKey("sk-or-test");
    expect(result).toEqual({
      ok: false,
      error: "rate-limited",
      message: expect.stringContaining("Rate limited"),
    });
  });

  test("maps APIConnectionError to network-error", async () => {
    const { validateLlmKey } = await import("./llm");
    createMock.mockRejectedValueOnce(new FakeConnError("ECONNRESET"));

    const result = await validateLlmKey("sk-or-test");
    expect(result).toEqual({
      ok: false,
      error: "network-error",
      message: expect.stringContaining("Network error"),
    });
  });

  test("maps unknown errors to unknown without leaking message", async () => {
    const { validateLlmKey } = await import("./llm");
    createMock.mockRejectedValueOnce(new Error("internal sentry trace acct_12345"));

    const result = await validateLlmKey("sk-or-test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unknown");
      expect(result.message).not.toContain("acct_12345");
    }
  });
});

describe("getLlmClient", () => {
  test("throws clear error when no key supplied or in env", async () => {
    const { getLlmClient } = await import("./llm");
    expect(() => getLlmClient()).toThrow(/OPENROUTER_API_KEY/);
  });

  test("uses env key when no argument provided", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-env";
    const { getLlmClient } = await import("./llm");
    expect(() => getLlmClient()).not.toThrow();
  });
});
