// /setup/voice — v1.1.3 path picker.
//
// Replaces the legacy 5-textarea page. Now this is a 4-card menu; each
// card navigates to a sub-page that runs one of the four calibration
// paths. Every path ends at /setup/voice/preview where the user
// inspects and tweaks the extracted rubric before continuing.
//
// Server component (no client interactivity needed for picker cards).

import Link from "next/link";
import { SupabaseWarning } from "@/components/supabase-warning";

type Card = {
  href: string;
  label: string;
  badge?: string;
  description: string;
};

const CARDS: Card[] = [
  {
    href: "/setup/voice/emails",
    label: "Paste 1+ of your sample emails",
    badge: "Most accurate",
    description:
      "If you have real cold emails you've sent, paste them here. Even one works — more is better.",
  },
  {
    href: "/setup/voice/describe",
    label: "Paste 1 email + answer 3 questions",
    description:
      "One real email anchor plus a few quick answers about your style. Good if you only have one example handy.",
  },
  {
    href: "/setup/voice/url",
    label: "Paste 1 email + your company URL",
    description:
      "Tay will read your public site for brand voice and fuse it with the one email you paste.",
  },
  {
    href: "/setup/voice/zero",
    label: "I've never sent a cold email — help me write one",
    description:
      "Tay will prompt you to write a short sample on the spot. That becomes your anchor.",
  },
];

export default function VoiceCalibrationPicker() {
  return (
    <>
      <SupabaseWarning />
      <main className="min-h-dvh flex items-center justify-center px-6 py-12">
        <div className="max-w-2xl w-full">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              Calibrate your voice
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Step 4 of 4 — pick how you&rsquo;d like to teach Tay your style
            </p>
            <p className="mt-4 text-sm text-gray-600">
              Tay extracts a stylistic rubric — sentence length, formality,
              opener style, signature, common phrases — and uses it as a
              binding contract every time it drafts an email. Pick whichever
              path you have inputs for; you&rsquo;ll review and tweak the
              rubric before continuing.
            </p>
          </div>

          <ul className="mt-8 space-y-3">
            {CARDS.map((card) => (
              <li key={card.href}>
                <Link
                  href={card.href}
                  className="block rounded-2xl border border-gray-200 bg-white p-6 shadow-sm hover:border-gray-900 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-lg font-medium text-gray-900">
                      {card.label}
                    </div>
                    {card.badge ? (
                      <span className="rounded-full bg-gray-900 px-2.5 py-0.5 text-xs font-medium text-white">
                        {card.badge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-gray-600">{card.description}</p>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-center text-xs text-gray-500">
            Stylistic features only — Tay never extracts or stores personal
            attributes from your samples.
          </p>
        </div>
      </main>
    </>
  );
}
