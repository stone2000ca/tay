// Placeholder Settings page — v0.2 just makes the nav route resolve.
// Real configuration surfaces land as Tay grows (voice rubric, ICP,
// suppression list, trust tiers, etc.).

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-3 text-sm text-gray-600">
          Configuration options will land here as Tay grows. v0.2 just makes
          the nav route resolve.
        </p>
      </div>
    </main>
  );
}
