import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppConfig } from "@/lib/app-config";
import { ensureSchema } from "@/lib/supabase/migrate";
import { getRubric } from "@/lib/voice/calibrate";
import { getDraftCount } from "@/lib/draft/persist";
import { getLlmKeyMetadata } from "@/lib/secrets/llm-key";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

export default async function HomePage() {
  // Fire schema bootstrap on first server-rendered request. Idempotent and
  // never-throws — if Supabase isn't linked yet it silently skips, and any
  // DB failure logs to console.warn rather than failing the page render.
  const migrate = await ensureSchema();
  if (migrate.error) {
    console.warn("[home] ensureSchema reported error:", migrate.error);
  }

  const cfg = await getAppConfig();
  if (!cfg) {
    redirect("/setup");
  }

  // v1.1.1: LLM key is wizard step 2. If app_config exists but no LLM
  // key is stored, push to /setup/llm-key before voice calibration.
  // getLlmKeyMetadata is a cheap soft-fail READ.
  const llmKey = await getLlmKeyMetadata();
  if (!llmKey) {
    redirect("/setup/llm-key");
  }

  // Voice calibration is wizard step 3. If LLM key exists but no rubric,
  // push to /setup/voice. getRubric is a soft-fail READ — null could
  // mean "not calibrated" or "Supabase unavailable"; either way we'd
  // rather show the calibration page than a half-configured dashboard.
  const rubric = await getRubric();
  if (!rubric) {
    redirect("/setup/voice");
  }

  // Draft count — cheap select. Soft-fails to null if Supabase isn't
  // available; we render "—" in that case so the page still works.
  const draftCount = await getDraftCount();

  return (
    <main className="min-h-dvh px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <header>
          <h1 className="text-4xl font-semibold tracking-tight">{cfg.name}</h1>
          <p className="mt-2 text-sm text-gray-500">
            Setup complete · validated {relativeTime(cfg.validatedAt)}
          </p>
        </header>

        <section className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link
            href="/draft"
            className="group rounded-2xl border border-gray-200 bg-white p-6 shadow-sm hover:border-gray-900 transition-colors"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Drafter
            </div>
            <div className="mt-1 text-lg font-medium text-gray-900 group-hover:underline">
              Draft an email →
            </div>
            <p className="mt-2 text-sm text-gray-600">
              Type a prospect&rsquo;s name + company. Tay drafts in your voice.
            </p>
          </Link>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Drafts saved
            </div>
            <div className="mt-1 text-3xl font-semibold text-gray-900">
              {draftCount ?? "—"}
            </div>
            <p className="mt-2 text-sm text-gray-600">
              Across all prospects, all time.
            </p>
          </div>
        </section>

        <p className="mt-10 text-center text-xs text-gray-400">
          v0.4 — drafter v1 (OpenRouter + voice rubric)
        </p>
      </div>
    </main>
  );
}
