import { redirect } from "next/navigation";
import { getAppConfig } from "@/lib/app-config";
import { ensureSchema } from "@/lib/supabase/migrate";
import { getRubric } from "@/lib/voice/calibrate";

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

  // Voice calibration is wizard step 2. If the user has an app_config row
  // but no voice_calibration row, push them to /setup/voice. getRubric is
  // a soft-fail READ — null could mean "not calibrated" or "Supabase
  // unavailable"; either way we'd rather show the calibration page than
  // a half-configured dashboard. The page itself surfaces any real DB
  // errors when the user submits.
  const rubric = await getRubric();
  if (!rubric) {
    redirect("/setup/voice");
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-5xl font-semibold tracking-tight">{cfg.name}</h1>
        <p className="mt-4 text-lg text-gray-600">Setup complete.</p>
        <p className="mt-2 text-sm text-gray-500">
          Validated {relativeTime(cfg.validatedAt)}.
        </p>
        <p className="mt-10 text-sm text-gray-400">
          v0.3 — OpenRouter LLM + voice calibration
        </p>
      </div>
    </main>
  );
}
