import { describe, it, expect } from "vitest";
import { normalizePhone, displayPhone, localPhone, phoneVariants, asciiDigits, isValidPhone } from "@/lib/phone";

describe("phone", () => {
  it("normalizes every common spelling to 9665XXXXXXXX", () => {
    for (const raw of ["0512345678", "512345678", "+966512345678", "00966512345678", "966512345678", "051 234 5678", "(051) 234-5678", "٠٥١٢٣٤٥٦٧٨"]) {
      expect(normalizePhone(raw)).toBe("966512345678");
    }
  });
  it("rejects non-Saudi or malformed numbers", () => {
    for (const raw of ["", "0112345678", "12345", "+14155551234", "05123456789", "abc", null, undefined]) {
      expect(normalizePhone(raw)).toBeNull();
      expect(isValidPhone(raw)).toBe(false);
    }
  });
  it("renders local display and input forms", () => {
    expect(displayPhone("966512345678")).toBe("051 234 5678");
    expect(localPhone("+966512345678")).toBe("0512345678");
    expect(displayPhone("garbage")).toBe("garbage");
  });
  it("lists legacy variants for free-text lookups", () => {
    expect(phoneVariants("0512345678")).toEqual(["966512345678", "+966512345678", "00966512345678", "0512345678", "512345678"]);
    expect(phoneVariants("x")).toEqual([]);
  });
  it("converts Arabic-Indic digits", () => {
    expect(asciiDigits("٠٥١")).toBe("051");
  });
});
