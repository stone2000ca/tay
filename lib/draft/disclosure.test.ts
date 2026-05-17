// Tests for lib/draft/disclosure.ts.

import { afterEach, beforeEach, describe, expect, test } from "vitest";

const TEST_SECRET = "a".repeat(64);

let originalSecret: string | undefined;
let originalSiteUrl: string | undefined;

beforeEach(() => {
  originalSecret = process.env.TAY_OAUTH_SECRET;
  originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.TAY_OAUTH_SECRET;
  else process.env.TAY_OAUTH_SECRET = originalSecret;
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

describe("withDisclosure", () => {
  test("appends the constant footer when no recipientEmail is provided", async () => {
    const { withDisclosure } = await import("./disclosure");
    const out = withDisclosure("Hi Jordan,\n\nQuick thought.\n\nJames");
    expect(out).toContain("Written with AI assistance");
    expect(out).toContain("Reply STOP");
    expect(out).not.toContain("/u/");
  });

  test("idempotent — body that already has the disclosure marker is unchanged", async () => {
    const { withDisclosure } = await import("./disclosure");
    const body =
      "Hi.\n\n— Written with AI assistance. Reply STOP to opt out.";
    expect(withDisclosure(body)).toBe(body);
  });

  test("falls back to constant footer when recipientEmail is provided but secret missing", async () => {
    delete process.env.TAY_OAUTH_SECRET;
    process.env.NEXT_PUBLIC_SITE_URL = "https://tay.example.com";
    const { withDisclosure } = await import("./disclosure");
    const out = withDisclosure("Hi.", { recipientEmail: "alice@example.com" });
    expect(out).toContain("Reply STOP");
    expect(out).not.toContain("/u/");
  });

  test("falls back to constant footer when NEXT_PUBLIC_SITE_URL missing", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { withDisclosure } = await import("./disclosure");
    const out = withDisclosure("Hi.", { recipientEmail: "alice@example.com" });
    expect(out).toContain("Reply STOP");
    expect(out).not.toContain("/u/");
  });

  test("emits unsubscribe link when both secret + site URL are set", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    process.env.NEXT_PUBLIC_SITE_URL = "https://tay.example.com";
    const { withDisclosure } = await import("./disclosure");
    const out = withDisclosure("Hi.", { recipientEmail: "alice@example.com" });
    expect(out).toContain("Written with AI assistance");
    expect(out).toContain("https://tay.example.com/u/");
    // The token contains a dot.
    expect(out).toMatch(/https:\/\/tay\.example\.com\/u\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  });

  test("strips trailing slash from NEXT_PUBLIC_SITE_URL before building the link", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    process.env.NEXT_PUBLIC_SITE_URL = "https://tay.example.com/";
    const { withDisclosure } = await import("./disclosure");
    const out = withDisclosure("Hi.", { recipientEmail: "alice@example.com" });
    expect(out).toContain("https://tay.example.com/u/");
    expect(out).not.toContain("https://tay.example.com//u/");
  });

  test("backward compatible — opts is optional, behavior identical to v0.4", async () => {
    const { withDisclosure } = await import("./disclosure");
    const a = withDisclosure("Hi.");
    const b = withDisclosure("Hi.", undefined);
    expect(a).toBe(b);
    expect(a).toContain("Reply STOP");
  });

  test("trims trailing whitespace before appending footer", async () => {
    const { withDisclosure } = await import("./disclosure");
    const out = withDisclosure("Hi.\n\n   \n");
    // Footer starts with two newlines; there should be exactly one block
    // of whitespace between the body content and the footer.
    expect(out).toMatch(/Hi\.\n\n— Written with AI assistance/);
  });
});
