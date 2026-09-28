// Saudi mobile numbers are the login identity. Everything is stored normalized as 9665XXXXXXXX (12 digits).
// Accepts what people actually type: 05X…, 5X…, +9665…, 009665…, with spaces, dashes, brackets, or Arabic-Indic digits.

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Converts Arabic-Indic / Persian digits to ASCII. */
export function asciiDigits(s: string) {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const i = ARABIC_DIGITS.indexOf(ch);
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(ch));
  });
}

/** Normalizes to 9665XXXXXXXX. Returns null when the input is not a Saudi mobile number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = asciiDigits(String(raw)).replace(/[^\d+]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("966")) p = p.slice(3);
  if (p.startsWith("0")) p = p.slice(1);
  if (!/^5\d{8}$/.test(p)) return null;
  return "966" + p;
}

export function isValidPhone(raw: string | null | undefined) {
  return normalizePhone(raw) !== null;
}

/** Local display form: 05X XXX XXXX (LTR). */
export function displayPhone(raw: string | null | undefined) {
  const n = normalizePhone(raw);
  if (!n) return raw ?? "";
  const local = "0" + n.slice(3);
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

/** Local form without spaces: 05XXXXXXXX (for inputs). */
export function localPhone(raw: string | null | undefined) {
  const n = normalizePhone(raw);
  return n ? "0" + n.slice(3) : raw ?? "";
}

/** Every spelling a legacy free-text phone column may hold for the same number — for lookups against Owner/Tenant.phone. */
export function phoneVariants(raw: string | null | undefined): string[] {
  const n = normalizePhone(raw);
  if (!n) return [];
  const local9 = n.slice(3);
  return [n, `+${n}`, `00${n}`, `0${local9}`, local9];
}

/** tel: link that dials correctly from any phone (+9665…). Non-Saudi-mobile values are dialled as typed. */
export function telHref(raw: string | null | undefined) {
  const n = normalizePhone(raw);
  return n ? `tel:+${n}` : `tel:${String(raw ?? "").replace(/[^\d+]/g, "")}`;
}
