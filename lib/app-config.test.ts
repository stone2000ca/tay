// Unit tests for lib/app-config.ts.
//
// We mock `next/headers` with a Map-backed cookie store so we can exercise
// the cookie-backend paths without booting Next.js. The Supabase backend
// is exercised separately by mocking the server-client factory.
//
// Run with:  npm test  (=> vitest run)

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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

// Supabase mock — a tiny in-memory row store with the chainable surface the
// real client gives us for the methods app-config touches.
type Row = { id: string; name: string; validated_at: string };
const supaRows: Row[] = [];
let hasSupa = false;

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseEnv: () => hasSupa,
  getSupabaseServerClient: () => makeFakeClient(),
}));

function makeFakeClient() {
  return {
    from(table: string) {
      if (table !== "app_config") throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          return {
            limit() {
              return {
                async maybeSingle() {
                  const row = supaRows[0];
                  return row
                    ? { data: { name: row.name, validated_at: row.validated_at }, error: null }
                    : { data: null, error: null };
                },
              };
            },
          };
        },
        insert(payload: { name: string; validated_at: string }) {
          supaRows.push({ id: `id-${supaRows.length + 1}`, ...payload });
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            not() {
              supaRows.length = 0;
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

afterEach(() => {
  cookieStore.clear();
  supaRows.length = 0;
  hasSupa = false;
});

describe("app-config (cookie backend)", () => {
  beforeEach(() => {
    hasSupa = false;
  });

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

describe("app-config (supabase backend)", () => {
  beforeEach(() => {
    hasSupa = true;
  });

  test("setAppConfig + getAppConfig round-trips via supabase", async () => {
    const { setAppConfig, getAppConfig } = await import("./app-config");

    await setAppConfig({ name: "Tay Supa", validatedAt: "2026-01-01T00:00:00.000Z" });
    expect(supaRows).toHaveLength(1);

    const got = await getAppConfig();
    expect(got).toEqual({ name: "Tay Supa", validatedAt: "2026-01-01T00:00:00.000Z" });
  });

  test("setAppConfig replaces existing row (single-row invariant)", async () => {
    const { setAppConfig, getAppConfig } = await import("./app-config");

    await setAppConfig({ name: "First", validatedAt: "2026-01-01T00:00:00.000Z" });
    await setAppConfig({ name: "Second", validatedAt: "2026-02-01T00:00:00.000Z" });

    expect(supaRows).toHaveLength(1);
    const got = await getAppConfig();
    expect(got?.name).toBe("Second");
  });

  test("getAppConfig returns null when no row exists", async () => {
    const { getAppConfig } = await import("./app-config");
    expect(await getAppConfig()).toBeNull();
  });

  test("clearAppConfig deletes the row", async () => {
    const { setAppConfig, clearAppConfig, getAppConfig } = await import("./app-config");

    await setAppConfig({ name: "Bye", validatedAt: "2026-01-01T00:00:00.000Z" });
    expect(supaRows).toHaveLength(1);

    await clearAppConfig();
    expect(supaRows).toHaveLength(0);
    expect(await getAppConfig()).toBeNull();
  });
});
