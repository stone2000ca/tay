const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Tay";

export default function HomePage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-5xl font-semibold tracking-tight">{appName}</h1>
        <p className="mt-4 text-lg text-gray-600">
          Your own AI BDR agent. Setup wizard coming next.
        </p>
        <p className="mt-10 text-sm text-gray-400">v0.0.1 — scaffold</p>
      </div>
    </main>
  );
}
