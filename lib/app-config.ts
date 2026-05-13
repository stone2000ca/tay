// App-config storage for the Tay setup wizard.
//
// v0.1: cookie-backed (httpOnly). Lives only on the user's browser; survives
// a server restart, but won't survive across multiple devices. That's fine
// for v0.1 — the wizard is a one-time-per-install thing and the user is
// always on the device they just deployed from.
//
// v0.2 will swap this out for a Supabase row keyed on the install. The
// public function shape (getAppConfig / setAppConfig / clearAppConfig) is
// the contract the rest of the app depends on; the cookie implementation
// is an internal detail.

import { cookies } from "next/headers";

export type AppConfig = {
  name: string;
  validatedAt: string;
};

const COOKIE_NAME = "tay-setup";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function getAppConfig(): Promise<AppConfig | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as { name?: unknown }).name !== "string" ||
      typeof (parsed as { validatedAt?: unknown }).validatedAt !== "string"
    ) {
      return null;
    }
    const cfg = parsed as AppConfig;
    if (cfg.name.length === 0) return null;
    return { name: cfg.name, validatedAt: cfg.validatedAt };
  } catch {
    return null;
  }
}

export async function setAppConfig(cfg: AppConfig): Promise<void> {
  const store = await cookies();
  store.set({
    name: COOKIE_NAME,
    value: JSON.stringify(cfg),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}

export async function clearAppConfig(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
