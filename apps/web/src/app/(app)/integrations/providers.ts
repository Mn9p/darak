/** Config fields per provider (demo). Pure module shared by the page, form and actions. */
export const PROVIDER_CONFIG_FIELDS: Record<string, { key: string; label: string; placeholder?: string; options?: Record<string, string> }[]> = {
  WHATSAPP: [{ key: "sender", label: "رقم المرسل", placeholder: "+966 5x xxx xxxx" }],
  SMS: [{ key: "senderName", label: "اسم المرسل", placeholder: "DARAK" }],
  EMAIL: [{ key: "from", label: "بريد المرسل", placeholder: "noreply@office.sa" }],
  BANK: [
    { key: "bank", label: "البنك", placeholder: "الراجحي" },
    { key: "account", label: "رقم الحساب / الآيبان", placeholder: "SA00 0000 0000 0000 0000 0000" },
  ],
};
