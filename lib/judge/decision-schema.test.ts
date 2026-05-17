// Tests for lib/judge/decision-schema.ts.
//
// The judge schema is Tay gate H's load-bearing parser — every adversarial
// LLM output must short-circuit to null here, never to a typed decision.

import { describe, expect, test } from "vitest";
import { parseJudgeDecision } from "./decision-schema";

describe("parseJudgeDecision — happy paths", () => {
  test("parses allow", () => {
    const out = parseJudgeDecision({
      decision: "allow",
      reasons: ["disclosure present", "rubric honored"],
    });
    expect(out).toEqual({
      decision: "allow",
      reasons: ["disclosure present", "rubric honored"],
    });
  });

  test("parses block", () => {
    const out = parseJudgeDecision({
      decision: "block",
      reasons: ["draft references protected attribute"],
    });
    expect(out?.decision).toBe("block");
    expect(out?.reasons).toEqual(["draft references protected attribute"]);
  });

  test("parses escalate", () => {
    const out = parseJudgeDecision({
      decision: "escalate",
      reasons: ["unverifiable factual claim"],
    });
    expect(out?.decision).toBe("escalate");
  });

  test("parses revise with rewrite", () => {
    const out = parseJudgeDecision({
      decision: "revise",
      reasons: ["disclosure footer missing"],
      rewrite: {
        subject: "Quick thought",
        body: "Hi Jordan,\n\n...\n\n— Written with AI assistance. Reply STOP to opt out.",
      },
    });
    expect(out?.decision).toBe("revise");
    if (out?.decision === "revise") {
      expect(out.rewrite.subject).toBe("Quick thought");
      expect(out.rewrite.body).toContain("Written with AI assistance");
    }
  });
});

describe("parseJudgeDecision — rejection paths", () => {
  test("rejects null / undefined / non-object", () => {
    expect(parseJudgeDecision(null)).toBeNull();
    expect(parseJudgeDecision(undefined)).toBeNull();
    expect(parseJudgeDecision("allow")).toBeNull();
    expect(parseJudgeDecision(42)).toBeNull();
    expect(parseJudgeDecision([])).toBeNull();
  });

  test("rejects out-of-union decision values", () => {
    expect(
      parseJudgeDecision({ decision: "other", reasons: ["x"] }),
    ).toBeNull();
    expect(
      parseJudgeDecision({ decision: "approve", reasons: ["x"] }),
    ).toBeNull();
    expect(parseJudgeDecision({ decision: "", reasons: ["x"] })).toBeNull();
  });

  test("rejects empty reasons array", () => {
    expect(
      parseJudgeDecision({ decision: "allow", reasons: [] }),
    ).toBeNull();
  });

  test("rejects reasons missing entirely", () => {
    expect(parseJudgeDecision({ decision: "allow" })).toBeNull();
  });

  test("rejects revise missing rewrite", () => {
    expect(
      parseJudgeDecision({
        decision: "revise",
        reasons: ["disclosure missing"],
      }),
    ).toBeNull();
  });

  test("rejects revise with malformed rewrite (no body)", () => {
    expect(
      parseJudgeDecision({
        decision: "revise",
        reasons: ["disclosure missing"],
        rewrite: { subject: "Hi" },
      }),
    ).toBeNull();
  });

  test("rejects revise with empty subject", () => {
    expect(
      parseJudgeDecision({
        decision: "revise",
        reasons: ["x"],
        rewrite: { subject: "", body: "Hi." },
      }),
    ).toBeNull();
  });

  test("rejects revise with oversize subject/body", () => {
    expect(
      parseJudgeDecision({
        decision: "revise",
        reasons: ["x"],
        rewrite: { subject: "x".repeat(500), body: "Hi." },
      }),
    ).toBeNull();
    expect(
      parseJudgeDecision({
        decision: "revise",
        reasons: ["x"],
        rewrite: { subject: "Hi", body: "x".repeat(6000) },
      }),
    ).toBeNull();
  });
});

describe("parseJudgeDecision — sanitization", () => {
  test("strips extra fields silently", () => {
    const out = parseJudgeDecision({
      decision: "allow",
      reasons: ["ok"],
      stealth_payload: { sensitive: "data" },
      extra: 42,
    });
    expect(out).toEqual({ decision: "allow", reasons: ["ok"] });
    expect(out as unknown as Record<string, unknown>).not.toHaveProperty(
      "stealth_payload",
    );
  });

  test("caps reasons list at 10", () => {
    const reasons = Array.from({ length: 25 }, (_, i) => `r${i}`);
    const out = parseJudgeDecision({ decision: "allow", reasons });
    expect(out?.reasons.length).toBe(10);
  });

  test("caps individual reason length at 500", () => {
    const out = parseJudgeDecision({
      decision: "allow",
      reasons: ["x".repeat(2000)],
    });
    expect(out?.reasons[0].length).toBe(500);
  });

  test("drops non-string reasons", () => {
    const out = parseJudgeDecision({
      decision: "allow",
      reasons: ["valid", 42, null, { obj: true }, "also valid"],
    });
    expect(out?.reasons).toEqual(["valid", "also valid"]);
  });

  test("drops empty/whitespace-only reasons", () => {
    const out = parseJudgeDecision({
      decision: "allow",
      reasons: ["valid", "", "   ", "another"],
    });
    expect(out?.reasons).toEqual(["valid", "another"]);
  });
});
