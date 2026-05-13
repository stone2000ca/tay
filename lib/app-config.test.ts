// Unit tests for lib/app-config.ts.
//
// We mock `next/headers` with a Map-backed cookie store so we can exercise
// getAppConfig / setAppConfig / clearAppConfig without booting Next.js.
//
// Run with:  npm test  (=> vitest run)

import { afterEach, describe, expect, test, vi } from "vitest";

type CookieEntry = { name: string; value: string };

const cookieStore = new Map<string, CookieEntry>();

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get(name: string) {
        const entry = cookieStore.get(name);
        return entry ? { name: entry.name, value: entry.value } : undefined;
      },
      set(opts: { name: string; value: string }) {
        cookieStore.set(opts.name, { name: opts.name, value: opts.value });
      },
      delete(name: string) {
        cookieStore.delete(name);
      },
    }),
}));

afterEach(() => {
  cookieStore.clear();
});

describe("app-config", () => {
  test("setAppConfig + getAppConfig round-trips", async () => {
    const { setAppConfig, getAppConfig } = await import("./app-config");

    const validatedAt = "2025-01-01T00:00:00.000Z";
    await setAppConfig({ name: "My Tay", validatedAt });
    const got = await getAppConfig();

    expect(got).toEqual({ name: "My Tay", validatedAt });
  });

  test("getAppConfig returns null when cookie absent", async () => {
    const { getAppConfig } = await import("./app-config");
    expect(await getAppConfig()).toBeNull();
  });

  test("getAppConfig returns null when cookie malformed", async () => {
    const { getAppConfig } = await import("./app-config");

    cookieStore.set("tay-setup", { name: "tay-setup", value: "{not json" });
    expect(await getAppConfig()).toBeNull();

    cookieStore.set("tay-setup", {
      name: "tay-setup",
      value: JSON.stringify({ foo: "bar" }),
    });
    expect(await getAppConfig()).toBeNull();

    cookieStore.set("tay-setup", {
      name: "tay-setup",
      value: JSON.stringify({ name: 5, validatedAt: "x" }),
    });
    expect(await getAppConfig()).toBeNull();

    cookieStore.set("tay-setup", {
      name: "tay-setup",
      value: JSON.stringify({ name: "", validatedAt: "x" }),
    });
    expect(await getAppConfig()).toBeNull();
  });

  test("clearAppConfig removes the cookie", async () => {
    const { setAppConfig, clearAppConfig, getAppConfig } = await import("./app-config");

    await setAppConfig({ name: "Tay", validatedAt: "2025-01-01T00:00:00.000Z" });
    expect(await getAppConfig()).not.toBeNull();

    await clearAppConfig();
    expect(await getAppConfig()).toBeNull();
  });
});
