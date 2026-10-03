import { describe, expect, it } from "vitest";
import { maskFinancialIdentifiers } from "../src/modules/security/masking.js";

describe("financial identifier masking", () => {
  it("masks account and card-like digit runs while preserving the final four digits", () => {
    const result = maskFinancialIdentifiers("Account 0123456789 and card 4111 1111 1111 1111");
    expect(result.text).not.toContain("0123456789");
    expect(result.text).not.toContain("4111 1111 1111 1111");
    expect(result.text).toContain("6789");
    expect(result.text).toContain("1111");
    expect(result.count).toBe(2);
  });

  it("does not alter short references", () => {
    expect(maskFinancialIdentifiers("Ticket 12345678")).toEqual({ text: "Ticket 12345678", masked: false, count: 0 });
  });
});
