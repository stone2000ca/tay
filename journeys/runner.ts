// JOURNEYS runner — walks the scenario list, runs each, returns a summary.
//
// Used by both:
//   - npm run test:journeys (vitest harness in journeys/index.test.ts)
//   - the CLI banner script (if exposed in the future)
//
// Pure-ish: takes the scenario list and a controller as inputs; returns
// the summary. Side effects (console output) live in the caller.

import type { Journey, JourneySummary, TayGate } from "./types";
import { mockController, type MockController } from "./mocks/controller";
import { scenarios } from "./scenarios";

const GATES: ReadonlyArray<TayGate> = ["B", "C", "D", "E", "F", "H", "I"];

function emptySummary(): JourneySummary {
  const perGate = {} as JourneySummary["perGate"];
  for (const g of GATES) perGate[g] = { passed: 0, failed: 0 };
  return {
    total: 0,
    passed: 0,
    failed: 0,
    perGate,
    failures: [],
  };
}

/**
 * Run a single journey and return pass/fail + error message.
 */
export async function runJourney(
  journey: Journey,
  mc: MockController = mockController,
): Promise<{ ok: true } | { ok: false; error: string }> {
  mc.reset();
  try {
    await journey.setup(mc);
    const result = await journey.run();
    journey.assertions(result, mc);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    mc.reset();
  }
}

/**
 * Run all scenarios and aggregate. Doesn't throw — returns the summary.
 */
export async function runAllJourneys(): Promise<JourneySummary> {
  const summary = emptySummary();
  for (const journey of scenarios) {
    const r = await runJourney(journey);
    summary.total++;
    if (r.ok) {
      summary.passed++;
      summary.perGate[journey.gate].passed++;
    } else {
      summary.failed++;
      summary.perGate[journey.gate].failed++;
      summary.failures.push({
        name: journey.name,
        gate: journey.gate,
        error: r.error,
      });
    }
  }
  return summary;
}

/**
 * Format the summary as a colored banner. Used by the CLI script and the
 * vitest reporter (when failures need verbose output).
 */
export function formatSummary(summary: JourneySummary): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=== JOURNEYS — Tay v1.0 regression suite ===");
  lines.push("");
  lines.push(`Total:  ${summary.total}`);
  lines.push(`Passed: ${summary.passed}`);
  lines.push(`Failed: ${summary.failed}`);
  lines.push("");
  lines.push("Per gate:");
  for (const g of GATES) {
    const row = summary.perGate[g];
    lines.push(
      `  ${g}: passed=${row.passed} failed=${row.failed}`,
    );
  }
  if (summary.failures.length > 0) {
    lines.push("");
    lines.push("Failures:");
    for (const f of summary.failures) {
      lines.push(`  [${f.gate}] ${f.name}: ${f.error}`);
    }
  }
  lines.push("");
  lines.push(
    summary.failed === 0 ? "*** JOURNEYS GREEN ***" : "!!! JOURNEYS FAILED !!!",
  );
  lines.push("");
  return lines.join("\n");
}
