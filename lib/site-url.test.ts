// Tests for lib/site-url.ts.

import { afterEach, beforeEach, describe, expect, test } from "vitest";

let originalExplicit: string | undefined;
let originalProd: string | undefined;
let originalPreview: string | undefined;

beforeEach(() => {
  originalExplicit = process.env.NEXT_PUBLIC_SITE_URL;
  originalProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  originalPreview = process.env.VERCEL_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
});

afterEach(() => {
  if (originalExplicit === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalExplicit;
  if (originalProd === undefined)
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  else process.env.VERCEL_PROJECT_PRODUCTION_URL = originalProd;
  if (originalPreview === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = originalPreview;
});

describe("getSiteUrl", () => {
  test("returns localhost fallback when nothing is set", async () => {
    const { getSiteUrl } = await import("./site-url");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  test("prefers NEXT_PUBLIC_SITE_URL when present", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://tay.example.com";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "tay.vercel.app";
    process.env.VERCEL_URL = "preview-x.vercel.app";
    const { getSiteUrl } = await import("./site-url");
    expect(getSiteUrl()).toBe("https://tay.example.com");
  });

  test("strips trailing slashes from explicit URL", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://tay.example.com/";
    const { getSiteUrl } = await import("./site-url");
    expect(getSiteUrl()).toBe("https://tay.example.com");
  });

  test("falls through to VERCEL_PROJECT_PRODUCTION_URL when explicit empty", async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "tay.vercel.app";
    process.env.VERCEL_URL = "preview-x.vercel.app";
    const { getSiteUrl } = await import("./site-url");
    expect(getSiteUrl()).toBe("https://tay.vercel.app");
  });

  test("falls through to VERCEL_URL when explicit + prod empty", async () => {
    process.env.VERCEL_URL = "preview-x.vercel.app";
    const { getSiteUrl } = await import("./site-url");
    expect(getSiteUrl()).toBe("https://preview-x.vercel.app");
  });

  test("treats empty-string env vars as not set", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "";
    process.env.VERCEL_URL = "";
    const { getSiteUrl } = await import("./site-url");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});
