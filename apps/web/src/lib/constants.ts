// Central dictionary of enum values, Arabic labels, and semantic tones.
// Tone maps to status color classes defined in globals.css (.tag-*).

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

export interface StatusMeta {
  label: string;
  tone: Tone;
}

export const ROLES = {
  SUPER_ADMIN: { label: "مدير المنصة", tone: "brand" },
  OFFICE_MANAGER: { label: "مدير المكتب", tone: "brand" },
  PROPERTY_MANAGER: { label: "مدير عقار", tone: "info" },
  LEASING: { label: "موظف تأجير", tone: "info" },
  COLLECTOR: { label: "محصل", tone: "warning" },
  ACCOUNTANT: { label: "محاسب", tone: "info" },
  OWNER: { label: "مالك", tone: "success" },
  TENANT: { label: "مستأجر", tone: "neutral" },
  AUDITOR: { label: "مدقق (قراءة فقط)", tone: "neutral" },
} as const satisfies Record<string, StatusMeta>;

export type Role = keyof typeof ROLES;

export const STAFF_ROLES: Role[] = [
  "OFFICE_MANAGER",
  "PROPERTY_MANAGER",
  "LEASING",
  "COLLECTOR",
  "ACCOUNTANT",
  "AUDITOR",
];

export const PROPERTY_TYPES: Record<string, string> = {
  RESIDENTIAL_BUILDING: "عمارة سكنية",
  VILLA: "فيلا",
  COMPOUND: "مجمع سكني",
  COMMERCIAL_BUILDING: "مبنى تجاري",
  OFFICES: "مكاتب",
  SHOWROOM: "معرض",
  WAREHOUSE: "مستودع",
  LAND: "أرض",
  MIXED_USE: "متعدد الاستخدامات",
  OTHER: "أخرى",
};

export const PROPERTY_STATUS: Record<string, StatusMeta> = {
  ACTIVE: { label: "نشط", tone: "success" },
  UNDER_MAINTENANCE: { label: "تحت الصيانة", tone: "warning" },
  INACTIVE: { label: "غير نشط", tone: "neutral" },
  ARCHIVED: { label: "مؤرشف", tone: "neutral" },
};

export const UNIT_TYPES: Record<string, string> = {
  APARTMENT: "شقة",
  STUDIO: "استوديو",
  VILLA: "فيلا",
  OFFICE: "مكتب",
  SHOP: "محل",
  WAREHOUSE: "مستودع",
  SHOWROOM: "معرض",
  ROOM: "غرفة",
  OTHER: "أخرى",
};

export const UNIT_USAGE: Record<string, string> = {
  RESIDENTIAL: "سكني",
  COMMERCIAL: "تجاري",
};

export const UNIT_STATUS: Record<string, StatusMeta> = {
  VACANT: { label: "شاغرة", tone: "warning" },
  AVAILABLE: { label: "متاحة للتأجير", tone: "info" },
  RESERVED: { label: "محجوزة", tone: "info" },
  RENTED: { label: "مؤجرة", tone: "success" },
  UNDER_MAINTENANCE: { label: "تحت الصيانة", tone: "warning" },
  UNAVAILABLE: { label: "غير متاحة", tone: "neutral" },
  ARCHIVED: { label: "مؤرشفة", tone: "neutral" },
};

export const PARTY_TYPES: Record<string, string> = {
  INDIVIDUAL: "فرد",
  COMPANY: "شركة",
};

export const OWNER_STATUS: Record<string, StatusMeta> = {
  ACTIVE: { label: "نشط", tone: "success" },
  INACTIVE: { label: "غير نشط", tone: "neutral" },
  ARCHIVED: { label: "مؤرشف", tone: "neutral" },
};

export const RISK_LEVELS: Record<string, StatusMeta> = {
  LOW: { label: "منخفض", tone: "success" },
  MEDIUM: { label: "متوسط", tone: "warning" },
  HIGH: { label: "مرتفع", tone: "danger" },
};

export const LEAD_SOURCES: Record<string, string> = {
  WALK_IN: "زيارة مباشرة",
  PHONE: "اتصال هاتفي",
  WEBSITE: "الموقع الإلكتروني",
  REFERRAL: "توصية",
  AQAR: "عقار",
  HARAJ: "حراج",
  OTHER: "أخرى",
};

export const LEAD_STAGES: Record<string, StatusMeta> = {
  LEAD: { label: "عميل محتمل", tone: "neutral" },
  VIEWING: { label: "معاينة", tone: "info" },
  NEGOTIATION: { label: "تفاوض", tone: "info" },
  APPLICATION: { label: "طلب تأجير", tone: "warning" },
  APPROVED: { label: "معتمد", tone: "success" },
  CONTRACTING: { label: "إعداد العقد", tone: "brand" },
  RENTED: { label: "تم التأجير", tone: "success" },
  LOST: { label: "منسحب", tone: "danger" },
};

export const LEAD_STAGE_ORDER = [
  "LEAD",
  "VIEWING",
  "NEGOTIATION",
  "APPLICATION",
  "APPROVED",
  "CONTRACTING",
  "RENTED",
];

export const CONTRACT_STATUS: Record<string, StatusMeta> = {
  DRAFT: { label: "مسودة", tone: "neutral" },
  PENDING_APPROVAL: { label: "بانتظار الاعتماد", tone: "warning" },
  ACTIVE: { label: "نشط", tone: "success" },
  EXPIRING_SOON: { label: "ينتهي قريبًا", tone: "warning" },
  RENEWAL_PENDING: { label: "تجديد معلق", tone: "info" },
  RENEWED: { label: "تم التجديد", tone: "success" },
  EXPIRED: { label: "منتهي", tone: "neutral" },
  TERMINATED: { label: "مفسوخ", tone: "danger" },
  CANCELLED: { label: "ملغى", tone: "danger" },
};

export const RENEWAL_STATUS: Record<string, StatusMeta> = {
  WANTS_RENEWAL: { label: "يرغب بالتجديد", tone: "success" },
  NO_RENEWAL: { label: "لا يرغب بالتجديد", tone: "danger" },
  NO_RESPONSE: { label: "لم يتم الرد", tone: "neutral" },
  NEGOTIATING: { label: "تفاوض", tone: "info" },
  APPROVED: { label: "تمت الموافقة", tone: "success" },
};

export const PAYMENT_FREQUENCY: Record<string, string> = {
  MONTHLY: "شهري",
  QUARTERLY: "ربع سنوي",
  SEMI_ANNUAL: "نصف سنوي",
  ANNUAL: "سنوي",
  CUSTOM: "مخصص",
};

export const FREQUENCY_MONTHS: Record<string, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

export const INSTALLMENT_STATUS: Record<string, StatusMeta> = {
  UPCOMING: { label: "قادمة", tone: "neutral" },
  DUE: { label: "مستحقة", tone: "warning" },
  OVERDUE: { label: "متأخرة", tone: "danger" },
  PARTIALLY_PAID: { label: "مدفوعة جزئيًا", tone: "info" },
  PAID: { label: "مدفوعة", tone: "success" },
  WAIVED: { label: "معفاة", tone: "neutral" },
};

export const COLLECTION_STATUS: Record<string, StatusMeta> = {
  OPEN: { label: "مفتوحة", tone: "info" },
  PROMISE_TO_PAY: { label: "وعد بالسداد", tone: "info" },
  BROKEN_PROMISE: { label: "وعد مكسور", tone: "danger" },
  DISPUTED: { label: "اعتراض", tone: "warning" },
  ESCALATED: { label: "مصعّدة", tone: "danger" },
  PAID: { label: "تم السداد", tone: "success" },
  CLOSED: { label: "مغلقة", tone: "neutral" },
};

export const COLLECTION_ACTION_TYPES: Record<string, string> = {
  SMS: "رسالة SMS",
  CALL: "اتصال",
  WHATSAPP: "واتساب",
  EMAIL: "بريد إلكتروني",
  VISIT: "زيارة",
  NOTE: "ملاحظة",
  PROMISE: "وعد بالسداد",
  ESCALATION: "تصعيد",
  PAYMENT: "دفعة",
  SYSTEM: "النظام",
};

export const COLLECTION_OUTCOMES: Record<string, string> = {
  NO_ANSWER: "لا يوجد رد",
  ANSWERED: "تم الرد",
  PROMISED: "وعد بالسداد",
  REFUSED: "رفض",
  DISPUTED: "اعتراض",
  PAID: "تم السداد",
};

export const PAYMENT_METHODS: Record<string, string> = {
  BANK_TRANSFER: "تحويل بنكي",
  CARD: "شبكة / بطاقة",
  CASH: "نقد",
  CHEQUE: "شيك",
  OTHER: "أخرى",
};

export const PAYMENT_STATUS: Record<string, StatusMeta> = {
  RECORDED: { label: "مسجلة", tone: "info" },
  APPROVED: { label: "معتمدة", tone: "success" },
  REVERSED: { label: "معكوسة", tone: "danger" },
  RETURNED: { label: "مرتجعة", tone: "danger" },
};

export const RECONCILIATION_STATUS: Record<string, StatusMeta> = {
  MATCHED: { label: "مطابقة", tone: "success" },
  SUGGESTED: { label: "مطابقة مقترحة", tone: "info" },
  UNMATCHED: { label: "غير مطابقة", tone: "warning" },
  DUPLICATE: { label: "مكررة", tone: "danger" },
  NEEDS_REVIEW: { label: "تحتاج مراجعة", tone: "warning" },
};

export const EXPENSE_CATEGORIES: Record<string, string> = {
  MAINTENANCE: "صيانة وإصلاحات",
  ELECTRICITY: "كهرباء",
  WATER: "مياه",
  CLEANING: "نظافة",
  SECURITY: "أمن",
  FEES: "رسوم",
  COMMISSIONS: "عمولات",
  SERVICES: "خدمات",
  MANAGEMENT: "إدارة",
  OTHER: "أخرى",
};

export const APPROVAL_STATUS: Record<string, StatusMeta> = {
  PENDING: { label: "بانتظار الاعتماد", tone: "warning" },
  APPROVED: { label: "معتمد", tone: "success" },
  REJECTED: { label: "مرفوض", tone: "danger" },
};

export const STATEMENT_STATUS: Record<string, StatusMeta> = {
  DRAFT: { label: "مسودة", tone: "neutral" },
  UNDER_REVIEW: { label: "قيد المراجعة", tone: "info" },
  APPROVED: { label: "معتمد", tone: "success" },
  PAID: { label: "تم التحويل", tone: "success" },
  CLOSED: { label: "مغلق", tone: "neutral" },
};

export const TASK_PRIORITY: Record<string, StatusMeta> = {
  LOW: { label: "منخفضة", tone: "neutral" },
  MEDIUM: { label: "متوسطة", tone: "info" },
  HIGH: { label: "مرتفعة", tone: "warning" },
  URGENT: { label: "عاجلة", tone: "danger" },
};

export const TASK_STATUS: Record<string, StatusMeta> = {
  NEW: { label: "جديدة", tone: "info" },
  ASSIGNED: { label: "مسندة", tone: "info" },
  IN_PROGRESS: { label: "قيد التنفيذ", tone: "warning" },
  WAITING: { label: "بانتظار", tone: "warning" },
  COMPLETED: { label: "منجزة", tone: "success" },
  CANCELLED: { label: "ملغاة", tone: "neutral" },
  OVERDUE: { label: "متأخرة", tone: "danger" },
};

export const ENTITY_TYPES: Record<string, string> = {
  ORGANIZATION: "المكتب",
  BRANCH: "الفرع",
  USER: "مستخدم",
  OWNER: "مالك",
  PROPERTY: "عقار",
  UNIT: "وحدة",
  TENANT: "مستأجر",
  LEAD: "عميل محتمل",
  CONTRACT: "عقد",
  INSTALLMENT: "دفعة",
  COLLECTION: "مطالبة",
  PAYMENT: "سند قبض",
  EXPENSE: "مصروف",
  STATEMENT: "كشف حساب مالك",
  TASK: "مهمة",
  DOCUMENT: "مستند",
  INTEGRATION: "تكامل",
  SETTINGS: "الإعدادات",
  SESSION: "جلسة",
  ACCESS_REQUEST: "طلب حساب",
  BANK_TRANSACTION: "حركة بنكية",
  IMPORT: "استيراد",
  REPORT: "تقرير",
  SAVED_VIEW: "عرض محفوظ",
  SUPPORT_TICKET: "تذكرة دعم",
  NOTIFICATION_RULE: "قاعدة تنبيه",
  NOTIFICATION_TEMPLATE: "قالب رسالة",
  PDPL_REQUEST: "طلب بيانات شخصية",
  SUBSCRIPTION: "اشتراك",
  OTP: "رمز الدخول",
};

export const ENTITY_ROUTES: Record<string, string> = {
  OWNER: "/owners",
  PROPERTY: "/properties",
  UNIT: "/units",
  TENANT: "/tenants",
  LEAD: "/leasing",
  CONTRACT: "/contracts",
  INSTALLMENT: "/installments",
  COLLECTION: "/collections",
  PAYMENT: "/payments",
  EXPENSE: "/expenses",
  STATEMENT: "/statements",
  TASK: "/tasks",
  DOCUMENT: "/documents",
  USER: "/employees",
};

export const DOCUMENT_TYPES: Record<string, string> = {
  CONTRACT: "عقد",
  ID: "هوية",
  CR: "سجل تجاري",
  DEED: "صك",
  INVOICE: "فاتورة",
  RECEIPT: "إيصال",
  PHOTO: "صورة",
  QUOTE: "عرض سعر",
  OTHER: "أخرى",
};

export const DOCUMENT_VISIBILITY: Record<string, string> = {
  INTERNAL: "داخلي",
  OWNER: "المالك",
  TENANT: "المستأجر",
};

export const NOTIFICATION_CHANNELS: Record<string, string> = {
  IN_APP: "داخل النظام",
  EMAIL: "بريد إلكتروني",
  SMS: "SMS",
  WHATSAPP: "واتساب",
  PUSH: "إشعار فوري",
};

export const NOTIFICATION_EVENTS: Record<string, string> = {
  CONTRACT_EXPIRING: "اقتراب انتهاء عقد",
  INSTALLMENT_DUE: "اقتراب استحقاق دفعة",
  INSTALLMENT_OVERDUE: "تأخر دفعة",
  BROKEN_PROMISE: "كسر وعد سداد",
  UNIT_VACANT: "وحدة شاغرة",
  DOCUMENT_EXPIRING: "اقتراب انتهاء مستند",
  SYNC_FAILED: "فشل مزامنة",
  EXPENSE_APPROVAL: "طلب اعتماد مصروف",
  PAYMENT_RECEIVED: "استلام دفعة",
};

export const AUDIT_ACTIONS: Record<string, StatusMeta> = {
  LOGIN: { label: "تسجيل دخول", tone: "neutral" },
  LOGOUT: { label: "تسجيل خروج", tone: "neutral" },
  CREATE: { label: "إنشاء", tone: "success" },
  UPDATE: { label: "تعديل", tone: "info" },
  DELETE: { label: "حذف", tone: "danger" },
  ARCHIVE: { label: "أرشفة", tone: "neutral" },
  APPROVE: { label: "اعتماد", tone: "success" },
  REJECT: { label: "رفض", tone: "danger" },
  EXPORT: { label: "تصدير", tone: "info" },
  PERMISSION_CHANGE: { label: "تعديل صلاحيات", tone: "warning" },
  SUPPORT_ACCESS: { label: "دخول دعم فني", tone: "warning" },
  PAYMENT: { label: "دفعة", tone: "success" },
  STATUS_CHANGE: { label: "تغيير حالة", tone: "info" },
  SYNC: { label: "مزامنة", tone: "info" },
};

export const INTEGRATION_PROVIDERS: Record<string, { label: string; description: string }> = {
  WHATSAPP: { label: "WhatsApp Business", description: "إرسال التذكيرات والإشعارات للمستأجرين" },
  SMS: { label: "SMS Gateway", description: "رسائل نصية للتذكير بالاستحقاق" },
  EMAIL: { label: "البريد الإلكتروني", description: "إرسال التقارير والإشعارات" },
  BANK: { label: "الربط البنكي", description: "استيراد كشوف الحساب للمطابقة" },
};

export const INTEGRATION_STATUS: Record<string, StatusMeta> = {
  CONNECTED: { label: "متصل", tone: "success" },
  DISCONNECTED: { label: "غير متصل", tone: "neutral" },
  ERROR: { label: "خطأ", tone: "danger" },
  SYNCING: { label: "جارٍ المزامنة", tone: "info" },
};

export const PLANS: Record<string, { label: string; units: number; users: number; price: number }> = {
  STARTER: { label: "الأساسية", units: 100, users: 5, price: 499 },
  PROFESSIONAL: { label: "الاحترافية", units: 500, users: 25, price: 1499 },
  ENTERPRISE: { label: "المؤسسات", units: 100000, users: 500, price: 0 },
};

export const ORG_STATUS: Record<string, StatusMeta> = {
  ACTIVE: { label: "نشط", tone: "success" },
  TRIAL: { label: "تجريبي", tone: "info" },
  SUSPENDED: { label: "موقوف", tone: "danger" },
};

export const ACCESS_REQUEST_STATUS: Record<string, StatusMeta> = {
  NEW: { label: "جديد", tone: "info" },
  CONTACTED: { label: "تم التواصل", tone: "warning" },
  CONVERTED: { label: "تم إنشاء المكتب", tone: "success" },
  CLOSED: { label: "مغلق", tone: "neutral" },
};

export const TICKET_STATUS: Record<string, StatusMeta> = {
  OPEN: { label: "مفتوحة", tone: "info" },
  IN_PROGRESS: { label: "قيد المعالجة", tone: "warning" },
  RESOLVED: { label: "تم الحل", tone: "success" },
  CLOSED: { label: "مغلقة", tone: "neutral" },
};

export const TICKET_PRIORITY: Record<string, StatusMeta> = {
  LOW: { label: "منخفضة", tone: "neutral" },
  MEDIUM: { label: "متوسطة", tone: "info" },
  HIGH: { label: "عالية", tone: "warning" },
  URGENT: { label: "عاجلة", tone: "danger" },
};

export const USER_STATUS: Record<string, StatusMeta> = {
  ACTIVE: { label: "نشط", tone: "success" },
  INACTIVE: { label: "غير نشط", tone: "neutral" },
  INVITED: { label: "مدعو", tone: "info" },
};

export const AGING_BUCKETS = [
  { key: "b1", label: "1–30 يوم", min: 1, max: 30 },
  { key: "b2", label: "31–60 يوم", min: 31, max: 60 },
  { key: "b3", label: "61–90 يوم", min: 61, max: 90 },
  { key: "b4", label: "أكثر من 90 يوم", min: 91, max: 100000 },
];

export const CITIES = ["الرياض", "جدة", "الدمام", "الخبر", "مكة المكرمة", "المدينة المنورة", "الطائف", "أبها", "تبوك", "بريدة"];

export const DEFAULT_ORG_SETTINGS = {
  graceDays: 3,
  /** Statutory grace before a rent payment counts as late: 15 days (monthly/quarterly) or 30 days (semi-annual/annual). */
  statutoryGrace: true,
  dueSoonDays: 7,
  autoApproveLimit: 500,
  managerApprovalLimit: 5000,
  contractExpiryAlerts: [90, 60, 30],
  documentExpiryAlerts: [90, 60, 30, 7],
  vatRate: 15,
  currency: "SAR",
};

export type OrgSettings = typeof DEFAULT_ORG_SETTINGS;
