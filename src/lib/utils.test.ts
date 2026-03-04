import { describe, expect, it } from "vitest";
import { lexicalPromptScore, sanitizeConstraints } from "./utils";

describe("sanitizeConstraints", () => {
  it("normalizes invalid ranges and defaults", () => {
    const output = sanitizeConstraints({ minLength: 0, maxLength: 1, count: 99, tlds: ["com", ".ai"] });

    expect(output.minLength).toBe(2);
    expect(output.maxLength).toBe(2);
    expect(output.count).toBe(24);
    expect(output.tlds).toEqual([".ai"]);
  });
});

describe("lexicalPromptScore", () => {
  it("scores better when prompt tokens appear in domain root", () => {
    const high = lexicalPromptScore("ai fitness coach", "fitcoachai.com");
    const low = lexicalPromptScore("ai fitness coach", "randombrandx.com");

    expect(high).toBeGreaterThan(low);
  });
});
