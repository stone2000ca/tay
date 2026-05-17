// Unit tests for lib/llm.ts (v1.1.1).
//
// Two SDKs are now in scope (OpenAI + Anthropic); we mock both. The tests
// exercise the discriminated-union return shape, provider detection from
// key prefix, and the SDK-error mapping.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const openaiCreate = vi.fn();
const anthropicCreate = vi.fn();

class FakeOpenAiAuthError extends Error {
  constructor(message = "auth") {
    super(message);
    this.name = "AuthenticationError";
  }
}
class FakeOpenAiRateError extends Error {
  constructor(message = "rate") {
    super(message);
    this.name = "RateLimitError";
  }
}
class FakeOpenAiConnError extends Error {
  constructor(message = "conn") {
    super(message);
    this.name = "APIConnectionError";
  }
}

class FakeAnthropicAuthError extends Error {}
class FakeAnthropicRateError extends Error {}
class FakeAnthropicConnError extends Error {}

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = { completions: { create: openaiCreate } };
    constructor(_opts: unknown) {
      /* noop */
    }
  }
  return {
    default: FakeOpenAI,
    AuthenticationError: FakeOpenAiAuthError,
    RateLimitError: FakeOpenAiRateError,
    APIConnectionError: FakeOpenAiConnError,
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create: anthropicCreate };
    constructor(_opts: unknown) {
      /* noop */
    }
  }
  return {
    default: FakeAnthropic,
    AuthenticationError: FakeAnthropicAuthError,
    RateLimitError: FakeAnthropicRateError,
    APIConnectionError: FakeAnthropicConnError,
  };
});

// We mock getLlmKey so getLlmClient (no-override) returns a stored key.
const getLlmKeyMock = vi.fn();
vi.mock("./secrets/llm-key", () => ({
  getLlmKey: () => getLlmKeyMock(),
}));

beforeEach(() => {
  openaiCreate.mockReset();
  anthropicCreate.mockReset();
  getLlmKeyMock.mockReset();
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe("detectProvider", () => {
  test("sk-ant- → anthropic", async () => {
    const { detectProvider } = await import("./llm");
    expect(detectProvider("sk-ant-abc")).toBe("anthropic");
  });
  test("sk-or- → openrouter", async () => {
    const { detectProvider } = await import("./llm");
    expect(detectProvider("sk-or-abc")).toBe("openrouter");
  });
  test("sk- (no -or-) → openai", async () => {
    const { detectProvider } = await import("./llm");
    expect(detectProvider("sk-abc")).toBe("openai");
  });
  test("garbage → unknown", async () => {
    const { detectProvider } = await import("./llm");
    expect(detectProvider("not-a-key")).toBe("unknown");
    expect(detectProvider("")).toBe("unknown");
  });
});

describe("getModel", () => {
  test("anthropic defaults", async () => {
    const { getModel } = await import("./llm");
    expect(getModel("cheap", "anthropic")).toMatch(/haiku/);
    expect(getModel("quality", "anthropic")).toMatch(/sonnet/);
  });
  test("openai defaults", async () => {
    const { getModel } = await import("./llm");
    expect(getModel("cheap", "openai")).toBe("gpt-4o-mini");
    expect(getModel("quality", "openai")).toBe("gpt-4o");
  });
  test("openrouter respects env-var overrides", async () => {
    process.env.OPENROUTER_MODEL_CHEAP = "x/cheap";
    process.env.OPENROUTER_MODEL_QUALITY = "x/quality";
    const { getModel } = await import("./llm");
    expect(getModel("cheap", "openrouter")).toBe("x/cheap");
    expect(getModel("quality", "openrouter")).toBe("x/quality");
    delete process.env.OPENROUTER_MODEL_CHEAP;
    delete process.env.OPENROUTER_MODEL_QUALITY;
  });
});

describe("validateLlmKey", () => {
  test("openrouter happy path → ok:true", async () => {
    const { validateLlmKey } = await import("./llm");
    openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });
    const result = await validateLlmKey("sk-or-test");
    expect(result).toEqual({ ok: true, provider: "openrouter" });
    expect(openaiCreate).toHaveBeenCalledOnce();
  });

  test("anthropic happy path → ok:true via Anthropic SDK", async () => {
    const { validateLlmKey } = await import("./llm");
    anthropicCreate.mockResolvedValueOnce({ content: [{ type: "text", text: "ok" }] });
    const result = await validateLlmKey("sk-ant-test");
    expect(result).toEqual({ ok: true, provider: "anthropic" });
    expect(anthropicCreate).toHaveBeenCalledOnce();
  });

  test("openai happy path → ok:true via OpenAI SDK", async () => {
    const { validateLlmKey } = await import("./llm");
    openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });
    const result = await validateLlmKey("sk-something");
    expect(result).toEqual({ ok: true, provider: "openai" });
  });

  test("unknown-provider when prefix isn't recognized", async () => {
    const { validateLlmKey } = await import("./llm");
    const result = await validateLlmKey("not-a-key");
    expect(result).toMatchObject({ ok: false, error: "unknown-provider" });
  });

  test("maps OpenAI AuthenticationError to invalid-key", async () => {
    const { validateLlmKey } = await import("./llm");
    openaiCreate.mockRejectedValueOnce(new FakeOpenAiAuthError("401"));
    const result = await validateLlmKey("sk-or-bad");
    expect(result).toMatchObject({ ok: false, error: "invalid-key" });
  });

  test("maps OpenAI RateLimitError to rate-limited", async () => {
    const { validateLlmKey } = await import("./llm");
    openaiCreate.mockRejectedValueOnce(new FakeOpenAiRateError("429"));
    const result = await validateLlmKey("sk-or-test");
    expect(result).toMatchObject({ ok: false, error: "rate-limited" });
  });

  test("maps OpenAI APIConnectionError to network-error", async () => {
    const { validateLlmKey } = await import("./llm");
    openaiCreate.mockRejectedValueOnce(new FakeOpenAiConnError("ECONNRESET"));
    const result = await validateLlmKey("sk-or-test");
    expect(result).toMatchObject({ ok: false, error: "network-error" });
  });

  test("maps unknown errors without leaking message", async () => {
    const { validateLlmKey } = await import("./llm");
    openaiCreate.mockRejectedValueOnce(new Error("internal sentry acct_12345"));
    const result = await validateLlmKey("sk-or-test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unknown");
      expect(result.message).not.toContain("acct_12345");
    }
  });
});

describe("getLlmClient", () => {
  test("returns not_configured when no stored key + no override", async () => {
    getLlmKeyMock.mockResolvedValueOnce(null);
    const { getLlmClient } = await import("./llm");
    const out = await getLlmClient();
    expect(out).toEqual({ ok: false, reason: "llm_not_configured" });
  });

  test("uses stored key when no override", async () => {
    getLlmKeyMock.mockResolvedValueOnce({
      provider: "anthropic",
      plaintext: "sk-ant-stored",
    });
    const { getLlmClient } = await import("./llm");
    const out = await getLlmClient();
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.provider).toBe("anthropic");
  });

  test("override wins; provider auto-detected from prefix", async () => {
    const { getLlmClient } = await import("./llm");
    const out = await getLlmClient("sk-ant-override");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.provider).toBe("anthropic");
  });

  test("override with unknown prefix → not_configured", async () => {
    const { getLlmClient } = await import("./llm");
    const out = await getLlmClient("garbage");
    expect(out).toEqual({ ok: false, reason: "llm_not_configured" });
  });
});

describe("chatComplete", () => {
  test("openrouter path dispatches to OpenAI SDK and returns content", async () => {
    getLlmKeyMock.mockResolvedValueOnce({
      provider: "openrouter",
      plaintext: "sk-or-x",
    });
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "hello" } }],
    });
    const { chatComplete } = await import("./llm");
    const out = await chatComplete({
      model: "any/model",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out).toMatchObject({ ok: true, content: "hello", provider: "openrouter" });
  });

  test("anthropic path dispatches to Anthropic SDK; flattens text blocks", async () => {
    getLlmKeyMock.mockResolvedValueOnce({
      provider: "anthropic",
      plaintext: "sk-ant-x",
    });
    anthropicCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
    });
    const { chatComplete } = await import("./llm");
    const out = await chatComplete({
      model: "claude-x",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
    });
    expect(out).toMatchObject({ ok: true, content: "hello world", provider: "anthropic" });
  });

  test("returns ok:false when LLM not configured", async () => {
    getLlmKeyMock.mockResolvedValueOnce(null);
    const { chatComplete } = await import("./llm");
    const out = await chatComplete({
      model: "x",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/LLM not configured/);
  });
});
