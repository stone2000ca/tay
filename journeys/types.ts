// JOURNEYS — adversarial-scenario regression corpus types.
//
// Each scenario is a `Journey` object that:
//   - declares which Tay gate it tests (B/C/D/E/F/H/I)
//   - programs the shared mock controller in setup()
//   - exercises the real Tay pipeline in run()
//   - throws-on-failure in assertions(result, mc)
//
// The runner walks scenarios, runs each, collects pass/fail, and emits a
// per-gate breakdown.

import type { MockController } from "./mocks/controller";

export type TayGate = "B" | "C" | "D" | "E" | "F" | "H" | "I";

export type JourneyResult =
  | { kind: "ok"; data?: Record<string, unknown> }
  | { kind: "error"; message: string; data?: Record<string, unknown> };

export type Journey = {
  name: string;
  gate: TayGate;
  description: string;
  setup: (mc: MockController) => Promise<void>;
  run: () => Promise<JourneyResult>;
  assertions: (result: JourneyResult, mc: MockController) => void;
};

export type JourneySummary = {
  total: number;
  passed: number;
  failed: number;
  perGate: Record<TayGate, { passed: number; failed: number }>;
  failures: Array<{ name: string; gate: TayGate; error: string }>;
};
