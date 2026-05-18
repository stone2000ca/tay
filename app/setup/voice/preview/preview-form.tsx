"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { VoiceRubric } from "@/lib/voice/rubric-schema";
import { recalibrateAction, updateRubricAction } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string };

export function PreviewForm({ rubric }: { rubric: VoiceRubric }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const [recalPending, startRecalTransition] = useTransition();

  // Local controlled state so phrase pills can be removed/added.
  const [common, setCommon] = useState<string[]>(rubric.common_phrases);
  const [avoid, setAvoid] = useState<string[]>(rubric.avoid_phrases);

  function onSubmit(formData: FormData) {
    const inputs = {
      opener_style: String(formData.get("opener_style") ?? ""),
      avg_sentence_length_words: Number(formData.get("avg_sentence_length_words") ?? rubric.avg_sentence_length_words),
      formality: String(formData.get("formality") ?? rubric.formality),
      signature_pattern: String(formData.get("signature_pattern") ?? ""),
      tone_notes: String(formData.get("tone_notes") ?? ""),
      common_phrases: common,
      avoid_phrases: avoid,
    };
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await updateRubricAction(inputs);
      if (result.ok) {
        router.push("/setup/voice/sample");
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  function onRecalibrate() {
    setStatus({ kind: "idle" });
    startRecalTransition(async () => {
      const result = await recalibrateAction();
      if (result.ok) {
        router.push("/setup/voice");
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <form
      action={onSubmit}
      className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5"
    >
      <div>
        <label htmlFor="opener_style" className="block text-sm font-medium text-gray-900">
          Opener style
        </label>
        <input
          id="opener_style"
          name="opener_style"
          type="text"
          defaultValue={rubric.opener_style}
          maxLength={240}
          className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="formality" className="block text-sm font-medium text-gray-900">
            Formality
          </label>
          <select
            id="formality"
            name="formality"
            defaultValue={rubric.formality}
            className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          >
            <option value="casual">Casual</option>
            <option value="neutral">Neutral</option>
            <option value="formal">Formal</option>
          </select>
        </div>
        <div>
          <label htmlFor="avg_sentence_length_words" className="block text-sm font-medium text-gray-900">
            Avg sentence length (words)
          </label>
          <input
            id="avg_sentence_length_words"
            name="avg_sentence_length_words"
            type="number"
            min={4}
            max={60}
            defaultValue={rubric.avg_sentence_length_words}
            className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>
      </div>

      <div>
        <label htmlFor="signature_pattern" className="block text-sm font-medium text-gray-900">
          Signature pattern
        </label>
        <input
          id="signature_pattern"
          name="signature_pattern"
          type="text"
          defaultValue={rubric.signature_pattern}
          maxLength={120}
          className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
      </div>

      <PhraseEditor label="Common phrases" items={common} onChange={setCommon} />
      <PhraseEditor label="Avoid phrases" items={avoid} onChange={setAvoid} />

      <div>
        <label htmlFor="tone_notes" className="block text-sm font-medium text-gray-900">
          Tone notes
        </label>
        <textarea
          id="tone_notes"
          name="tone_notes"
          rows={3}
          defaultValue={rubric.tone_notes}
          maxLength={600}
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

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onRecalibrate}
          disabled={recalPending || pending}
          className="text-sm text-gray-600 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {recalPending ? "Resetting..." : "Recalibrate from scratch"}
        </button>
        <button
          type="submit"
          disabled={pending || recalPending}
          className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving..." : "Looks right — save and continue"}
        </button>
      </div>
    </form>
  );
}

function PhraseEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (items.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
      setDraft("");
      return;
    }
    if (items.length >= 10) return;
    onChange([...items, trimmed]);
    setDraft("");
  }

  return (
    <div>
      <div className="text-sm font-medium text-gray-900">{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.length === 0 ? (
          <span className="text-xs text-gray-400">(none)</span>
        ) : (
          items.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
            >
              {p}
              <button
                type="button"
                onClick={() => onChange(items.filter((x) => x !== p))}
                className="text-gray-500 hover:text-gray-900"
                aria-label={`Remove ${p}`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={items.length >= 10 ? "Max 10 phrases" : "Add a phrase, then Enter"}
          maxLength={80}
          disabled={items.length >= 10}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button
          type="button"
          onClick={add}
          disabled={items.length >= 10}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
