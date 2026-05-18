"use client";

import { useState, useTransition } from "react";
import { generateAndSaveDraft } from "./actions";
import type { JudgeDecision } from "@/lib/judge/decision-schema";

type Draft = { subject: string; body: string };

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "success";
      draft: Draft;
      decision?: JudgeDecision;
      judgeError?: string;
    };

type Prefill = {
  full_name?: string;
  company?: string;
  notes?: string;
  email?: string;
};

export function DraftForm({ prefill }: { prefill?: Prefill } = {}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const full_name = String(formData.get("full_name") ?? "").trim();
    const company = String(formData.get("company") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();

    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await generateAndSaveDraft({
        full_name,
        company,
        notes: notes.length > 0 ? notes : undefined,
      });
      if (result.ok) {
        setStatus({
          kind: "success",
          draft: result.draft,
          decision: result.decision,
          judgeError: result.judgeError,
        });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <main className="min-h-dvh px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Draft an email</h1>
          <p className="mt-2 text-sm text-gray-600">
            Tay drafts in your voice (calibrated at{" "}
            <code className="text-xs">/setup/voice</code>), then runs the
            judge to verify every safety gate before display.
          </p>
        </div>

        <form
          action={onSubmit}
          className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-5"
        >
          <div>
            <label
              htmlFor="full_name"
              className="block text-sm font-medium text-gray-900"
            >
              Prospect full name
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              maxLength={200}
              defaultValue={prefill?.full_name ?? ""}
              placeholder="Jordan Riley"
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          <div>
            <label
              htmlFor="company"
              className="block text-sm font-medium text-gray-900"
            >
              Company
            </label>
            <input
              id="company"
              name="company"
              type="text"
              required
              maxLength={200}
              defaultValue={prefill?.company ?? ""}
              placeholder="Acme Robotics"
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          <div>
            <label
              htmlFor="notes"
              className="block text-sm font-medium text-gray-900"
            >
              Notes <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={prefill?.notes ?? ""}
              placeholder="Anything specific you want Tay to mention?"
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          {status.kind === "error" && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {status.message}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? "Drafting + judging..."
              : status.kind === "success"
                ? "Generate again"
                : "Generate draft"}
          </button>
        </form>

        {status.kind === "success" && (
          <DecisionPanel
            draft={status.draft}
            decision={status.decision}
            judgeError={status.judgeError}
          />
        )}
      </div>
    </main>
  );
}

// ---------- decision rendering ----------

function DecisionPanel({
  draft,
  decision,
  judgeError,
}: {
  draft: Draft;
  decision?: JudgeDecision;
  judgeError?: string;
}) {
  // Judge LLM failed (degraded-mode). Render draft + a soft warning.
  if (!decision) {
    return (
      <>
        <DegradedJudgeBanner error={judgeError} />
        <DraftCard subject={draft.subject} body={draft.body} />
      </>
    );
  }

  if (decision.decision === "allow") {
    return (
      <>
        <DecisionBadge kind="allow" label="✓ allowed" />
        <DraftCard subject={draft.subject} body={draft.body} />
        <ReasonsList reasons={decision.reasons} />
      </>
    );
  }

  if (decision.decision === "block") {
    return (
      <>
        <DecisionBadge kind="block" label="blocked" />
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
          <strong className="font-medium">
            Draft blocked. The body is not shown — the judge flagged it as
            unfit to send.
          </strong>
        </div>
        <ReasonsList reasons={decision.reasons} />
      </>
    );
  }

  if (decision.decision === "revise") {
    return (
      <>
        <DecisionBadge kind="revise" label="needs revision" />
        <ReasonsList reasons={decision.reasons} />
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Original
            </h3>
            <DraftCard subject={draft.subject} body={draft.body} />
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-amber-700">
              Suggested rewrite
            </h3>
            <DraftCard
              subject={decision.rewrite.subject}
              body={decision.rewrite.body}
              tone="amber"
            />
          </div>
        </div>
      </>
    );
  }

  // escalate
  return (
    <>
      <DecisionBadge kind="escalate" label="needs human review" />
      <DraftCard subject={draft.subject} body={draft.body} />
      <ReasonsList reasons={decision.reasons} />
    </>
  );
}

function DegradedJudgeBanner({ error }: { error?: string }) {
  return (
    <div
      role="alert"
      className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <strong className="font-medium">Judge unavailable.</strong>{" "}
      The draft was generated and saved, but the judge could not run:{" "}
      {error ?? "unknown error"}. Treat the draft as unverified.
    </div>
  );
}

function DecisionBadge({
  kind,
  label,
}: {
  kind: "allow" | "block" | "revise" | "escalate";
  label: string;
}) {
  const palette =
    kind === "allow"
      ? "bg-green-100 text-green-800 border-green-200"
      : kind === "block"
        ? "bg-red-100 text-red-800 border-red-200"
        : kind === "revise"
          ? "bg-amber-100 text-amber-800 border-amber-200"
          : "bg-purple-100 text-purple-800 border-purple-200";
  return (
    <div className="mt-8">
      <span
        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${palette}`}
      >
        {label}
      </span>
    </div>
  );
}

function ReasonsList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Judge reasons
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-800">
        {reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function DraftCard({
  subject,
  body,
  tone = "default",
}: {
  subject: string;
  body: string;
  tone?: "default" | "amber";
}) {
  const border =
    tone === "amber" ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white";
  return (
    <div
      className={`mt-4 rounded-2xl border p-6 shadow-sm ${border}`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Subject
      </div>
      <div className="mt-1 text-base font-medium text-gray-900">{subject}</div>

      <div className="mt-6 text-xs font-medium uppercase tracking-wide text-gray-500">
        Body
      </div>
      <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-gray-900">
        {body}
      </pre>
    </div>
  );
}
