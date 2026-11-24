import { afterEach, describe, expect, it } from "vitest";
import { isAllowed } from "./allowlist";

const original = process.env.ALLOWED_EMAILS;

afterEach(() => {
  if (original === undefined) delete process.env.ALLOWED_EMAILS;
  else process.env.ALLOWED_EMAILS = original;
});

describe("isAllowed", () => {
  it("accepts only the emails listed in ALLOWED_EMAILS", () => {
    process.env.ALLOWED_EMAILS = "A@Example.com, other@example.com";
    expect(isAllowed("a@example.com")).toBe(true);
    expect(isAllowed(" other@example.com ")).toBe(true);
    expect(isAllowed("nope@example.com")).toBe(false);
    expect(isAllowed(null)).toBe(false);
  });

  it("accepts nobody when the list is empty", () => {
    process.env.ALLOWED_EMAILS = "";
    expect(isAllowed("a@example.com")).toBe(false);
  });
});
