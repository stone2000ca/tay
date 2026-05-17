import { describe, expect, test } from "vitest";
import { isSuppressed } from "./check";

describe("isSuppressed (v0.7 stub)", () => {
  test("always returns false", async () => {
    expect(await isSuppressed("foo@bar.com")).toBe(false);
    expect(await isSuppressed("")).toBe(false);
    expect(await isSuppressed("a@b.co")).toBe(false);
  });
});
