import { redirect } from "next/navigation";
import { getAppConfig } from "@/lib/app-config";

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
  const cfg = await getAppConfig();
  if (!cfg) {
    redirect("/setup");
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-5xl font-semibold tracking-tight">{cfg.name}</h1>
        <p className="mt-4 text-lg text-gray-600">Setup complete.</p>
        <p className="mt-2 text-sm text-gray-500">
          Validated {relativeTime(cfg.validatedAt)}.
        </p>
        <p className="mt-10 text-sm text-gray-400">v0.1 — setup wizard step 1</p>
      </div>
    </main>
  );
}
