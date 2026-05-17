// JOURNEYS — vitest harness.
//
// vi.mock calls hoist to the top of this file. They take effect for
// every import below — including the journey scenarios, which import
// the real Tay code. The factories close over `mockController`, so
// scenarios program state via mc.pushXxx(...) and assert via mc.xxx().
//
// Why this file is the seam (not each scenario): vi.mock is per-file,
// and we want all scenarios to share the same mocked openai/supabase
// modules so the controller is the single source of programmed truth.

import { afterAll, beforeAll, beforeEach, describe, test, vi } from "vitest";

import {
  makeAppConfigMock,
  makeAuditMock,
  makeGmailSendMock,
  makeJudgePersistMock,
  makeMailboxPersistMock,
  makeOAuthPersistMock,
  makeOpenAiMock,
  makeSmtpSendMock,
  makeSupabaseMock,
  makeSuppressionCheckMock,
  makeTrustRecordMock,
  makeVoiceCalibrateModuleMock,
} from "./mocks/factories";
import { mockController } from "./mocks/controller";

vi.mock("openai", () => makeOpenAiMock());
// v1.1.1: stored-LLM-key path. The cold-start guard in drafter / judge /
// reply now calls getLlmKey() — mock it to always return a fake stored
// key so journeys exercise the LLM-call code paths, not the
// "configure your key first" branch.
vi.mock("@/lib/secrets/llm-key", () => ({
  getLlmKey: async () => ({ provider: "openrouter", plaintext: "sk-or-journeys-test" }),
  getLlmKeyMetadata: async () => ({
    provider: "openrouter",
    fingerprint: "deadbeef",
    setAt: new Date().toISOString(),
  }),
  setLlmKey: async () => {},
  computeFingerprint: () => "deadbeef",
}));
vi.mock("../lib/secrets/llm-key", () => ({
  getLlmKey: async () => ({ provider: "openrouter", plaintext: "sk-or-journeys-test" }),
  getLlmKeyMetadata: async () => ({
    provider: "openrouter",
    fingerprint: "deadbeef",
    setAt: new Date().toISOString(),
  }),
  setLlmKey: async () => {},
  computeFingerprint: () => "deadbeef",
}));
vi.mock("@/lib/supabase/server", () => makeSupabaseMock());
vi.mock("../lib/supabase/server", () => makeSupabaseMock());
vi.mock("@/lib/audit/append", () => makeAuditMock());
vi.mock("../lib/audit/append", () => makeAuditMock());
vi.mock("@/lib/trust/record", async () => {
  const actual = await vi.importActual<typeof import("../lib/trust/record")>(
    "../lib/trust/record",
  );
  return { ...actual, ...makeTrustRecordMock() };
});
vi.mock("../lib/trust/record", async () => {
  const actual = await vi.importActual<typeof import("../lib/trust/record")>(
    "../lib/trust/record",
  );
  return { ...actual, ...makeTrustRecordMock() };
});
vi.mock("@/lib/suppression/check", () => makeSuppressionCheckMock());
vi.mock("../lib/suppression/check", () => makeSuppressionCheckMock());

// Send-orchestrator collaborators — only the send-to-suppressed-prospect
// journey programs these; other journeys ignore them. Mocks default to
// "happy path" values so any journey importing sendDraft won't crash on
// a missing precondition; suppression-specific control is exerted in
// that journey's setup().
vi.mock("@/lib/app-config", () => makeAppConfigMock());
vi.mock("../lib/app-config", () => makeAppConfigMock());
vi.mock("@/lib/voice/calibrate", () => makeVoiceCalibrateModuleMock());
vi.mock("../lib/voice/calibrate", () => makeVoiceCalibrateModuleMock());
vi.mock("@/lib/judge/persist", () => makeJudgePersistMock());
vi.mock("../lib/judge/persist", () => makeJudgePersistMock());
vi.mock("@/lib/oauth/persist", () => makeOAuthPersistMock());
vi.mock("../lib/oauth/persist", () => makeOAuthPersistMock());
vi.mock("@/lib/send/gmail", () => makeGmailSendMock());
vi.mock("../lib/send/gmail", () => makeGmailSendMock());
vi.mock("@/lib/send/smtp", () => makeSmtpSendMock());
vi.mock("../lib/send/smtp", () => makeSmtpSendMock());
vi.mock("@/lib/mailbox/persist", () => makeMailboxPersistMock());
vi.mock("../lib/mailbox/persist", () => makeMailboxPersistMock());

import { scenarios } from "./scenarios";
import { runJourney, runAllJourneys, formatSummary } from "./runner";

const SAVED_ENV_KEYS = ["OPENROUTER_API_KEY", "TAY_OAUTH_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of SAVED_ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  // OpenRouter SDK requires a key to construct the client. Any non-empty
  // string is fine — the mocked openai never calls a real endpoint.
  process.env.OPENROUTER_API_KEY = "sk-or-journeys-test";
});

afterAll(() => {
  for (const key of SAVED_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

beforeEach(() => {
  mockController.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("JOURNEYS — Tay v1.0 regression suite", () => {
  for (const journey of scenarios) {
    test(`[${journey.gate}] ${journey.name}`, async () => {
      const result = await runJourney(journey);
      if (!result.ok) {
        throw new Error(
          `JOURNEY FAILED: ${journey.name} (gate ${journey.gate}) — ${result.error}`,
        );
      }
    });
  }

  // Banner test: also run the full suite via runAllJourneys so the
  // formatted summary lands in test output. This duplicates work but
  // it's cheap (mocked LLM + DB) and the banner is what humans look at
  // when scanning CI output.
  test("JOURNEYS suite summary", async () => {
    const summary = await runAllJourneys();
    // Print the banner regardless of pass/fail so CI logs show it.
    // eslint-disable-next-line no-console
    process.stdout.write(formatSummary(summary));
    if (summary.failed > 0) {
      throw new Error(
        `JOURNEYS FAILED — ${summary.failed} of ${summary.total} scenarios failed.`,
      );
    }
  });
});
