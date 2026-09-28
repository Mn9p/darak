// How prospects and users reach the DARAK team. Read from env so the landing page, login and help pages agree.
import { normalizePhone, displayPhone } from "./phone";

export interface SupportContact {
  phone: string | null; // normalized 9665…
  phoneDisplay: string | null;
  whatsapp: string | null; // https://wa.me/966…
  email: string | null;
}

export function supportContact(): SupportContact {
  const phone = normalizePhone(process.env.SUPPORT_PHONE);
  const email = (process.env.SUPPORT_EMAIL ?? "").trim() || null;
  return { phone, phoneDisplay: phone ? displayPhone(phone) : null, whatsapp: phone ? `https://wa.me/${phone}` : null, email };
}
