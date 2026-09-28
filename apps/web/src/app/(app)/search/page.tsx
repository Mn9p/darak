import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyScope, propertyIdScope, contractScope, type Permission } from "@/lib/permissions";
import { CITIES, UNIT_STATUS, UNIT_TYPES, CONTRACT_STATUS, PAYMENT_STATUS, TASK_STATUS, COLLECTION_STATUS, RISK_LEVELS, PROPERTY_STATUS, PROPERTY_TYPES, INSTALLMENT_STATUS } from "@/lib/constants";
import { money, date, daysOverdue } from "@/lib/format";
import { PageHeader, Card, Input, StatusTag, EmptyState, Tag, Alert } from "@/components/ui";
import { textLike, phoneLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const LIMIT = 8;

/* ───────────── Rule-based Arabic NL → filters ───────────── */

interface Interpretation {
  entity: string;
  label: string;
  path: string;
  params: Record<string, string>;
  chips: { label: string; value: string }[];
}

const ENTITY_RULES: { re: RegExp; entity: string; label: string; path: string; permission: Permission }[] = [
  { re: /متأخر|المتأخرات|متعثر|مطالب/, entity: "collections", label: "المتأخرات والمطالبات", path: "/collections", permission: "collections.view" },
  { re: /قسط|أقساط|الأقساط|مستحق/, entity: "installments", label: "الدفعات", path: "/installments", permission: "installments.view" },
  { re: /عقود|عقد|العقود|إيجارات/, entity: "contracts", label: "العقود", path: "/contracts", permission: "contracts.view" },
  { re: /وحد|شق|شقق|مكاتب|مكتب|محلات|محل|فلل|استوديو|مستودع/, entity: "units", label: "الوحدات", path: "/units", permission: "units.view" },
  { re: /عقار|عمار|مبنى|مباني|برج/, entity: "properties", label: "العقارات", path: "/properties", permission: "properties.view" },
  { re: /مستأجر/, entity: "tenants", label: "المستأجرون", path: "/tenants", permission: "tenants.view" },
  { re: /مالك|ملاك|الملاك/, entity: "owners", label: "الملاك", path: "/owners", permission: "owners.view" },
  { re: /مصروف|مصاريف|فواتير/, entity: "expenses", label: "المصروفات", path: "/expenses", permission: "expenses.view" },
  { re: /دفعات|دفعة|مدفوعات|سداد/, entity: "payments", label: "سندات القبض", path: "/payments", permission: "payments.view" },
  { re: /مهام|مهمة/, entity: "tasks", label: "المهام", path: "/tasks", permission: "tasks.view" },
  { re: /عملاء محتمل|عميل محتمل|طلبات تأجير/, entity: "leasing", label: "التأجير", path: "/leasing", permission: "leasing.view" },
];

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const normalizeDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

function parseAmount(s: string): number | null {
  const m = normalizeDigits(s).replace(/[,،]/g, "").match(/(\d+(?:\.\d+)?)\s*(ألف|الف|آلاف|k|K|مليون|م)?/);
  if (!m) return null;
  let n = Number(m[1]);
  if (/ألف|الف|آلاف|k|K/.test(m[2] ?? "")) n *= 1000;
  if (/مليون/.test(m[2] ?? "")) n *= 1_000_000;
  return n;
}

function interpret(qRaw: string, user: Parameters<typeof can>[0]): Interpretation | null {
  const q = normalizeDigits(qRaw).replace(/\s+/g, " ").trim();
  const rule = ENTITY_RULES.find((r) => r.re.test(q));
  if (!rule) return null;
  if (!can(user, rule.permission)) return null;
  const params: Record<string, string> = {};
  const chips: { label: string; value: string }[] = [];

  // city
  const city = CITIES.find((c) => q.includes(c) || q.includes(c.replace("ال", "")));
  if (city && /في|بال|ب\s?ال|داخل|بمدينة/.test(q)) {
    params.city = city;
    chips.push({ label: "المدينة", value: city });
  }

  // status keywords
  const status: Record<string, [string, string][]> = {
    units: [
      ["شاغر|فاضي|فارغ|خالي", "VACANT"],
      ["مؤجر|مأجور|مشغول", "RENTED"],
      ["محجوز", "RESERVED"],
      ["تحت الصيانة", "UNDER_MAINTENANCE"],
      ["متاح", "AVAILABLE"],
    ],
    contracts: [
      ["منتهي|انتهت|منتهية", "EXPIRED"],
      ["نشط|ساري|سارية", "ACTIVE"],
      ["مسودة", "DRAFT"],
      ["ملغ", "CANCELLED"],
      ["تجديد", "RENEWAL_PENDING"],
    ],
    properties: [
      ["تحت الصيانة", "UNDER_MAINTENANCE"],
      ["مؤرشف", "ARCHIVED"],
      ["نشط", "ACTIVE"],
    ],
    tasks: [
      ["منجز|مكتمل", "COMPLETED"],
      ["قيد التنفيذ", "IN_PROGRESS"],
      ["جديد", "NEW"],
    ],
    payments: [
      ["معتمد", "APPROVED"],
      ["مسجل", "RECORDED"],
      ["معكوس", "REVERSED"],
    ],
    expenses: [
      ["بانتظار|معلق|غير معتمد", "PENDING"],
      ["معتمد", "APPROVED"],
      ["مرفوض", "REJECTED"],
    ],
    installments: [
      ["متأخر", "OVERDUE"],
      ["مدفوع جزئي", "PARTIALLY_PAID"],
      ["مدفوع", "PAID"],
      ["قادم", "UPCOMING"],
    ],
    collections: [
      ["وعد مكسور", "BROKEN_PROMISE"],
      ["وعد", "PROMISE_TO_PAY"],
      ["تصعيد|مصعد", "ESCALATED"],
    ],
  };
  const maps: Record<string, Record<string, { label: string }>> = { units: UNIT_STATUS, contracts: CONTRACT_STATUS, properties: PROPERTY_STATUS, tasks: TASK_STATUS, payments: PAYMENT_STATUS, installments: INSTALLMENT_STATUS, collections: COLLECTION_STATUS };
  const st = (status[rule.entity] ?? []).find(([re]) => new RegExp(re).test(q));
  if (st) {
    const key = rule.entity === "expenses" ? "approval" : "status";
    params[key] = st[1];
    chips.push({ label: "الحالة", value: maps[rule.entity]?.[st[1]]?.label ?? st[1] });
  }

  // unit / property type
  if (rule.entity === "units") {
    const types: [RegExp, string][] = [
      [/شق/, "APARTMENT"],
      [/استوديو/, "STUDIO"],
      [/فلل|فيلا/, "VILLA"],
      [/مكاتب|مكتب/, "OFFICE"],
      [/محلات|محل/, "SHOP"],
      [/مستودع/, "WAREHOUSE"],
      [/معرض/, "SHOWROOM"],
      [/غرف|غرفة/, "ROOM"],
    ];
    const t = types.find(([re]) => re.test(q));
    if (t) {
      params.type = t[1];
      chips.push({ label: "النوع", value: UNIT_TYPES[t[1]] });
    }
    if (/تجاري/.test(q)) {
      params.usage = "COMMERCIAL";
      chips.push({ label: "الاستخدام", value: "تجاري" });
    } else if (/سكني/.test(q)) {
      params.usage = "RESIDENTIAL";
      chips.push({ label: "الاستخدام", value: "سكني" });
    }
  }
  if (rule.entity === "properties") {
    const t = Object.entries(PROPERTY_TYPES).find(([, label]) => q.includes(label));
    if (t) {
      params.type = t[0];
      chips.push({ label: "النوع", value: t[1] });
    }
  }
  if (rule.entity === "tenants") {
    const r: [RegExp, string][] = [
      [/مرتفع|عالي|خطر/, "HIGH"],
      [/متوسط/, "MEDIUM"],
      [/منخفض/, "LOW"],
    ];
    const hit = r.find(([re]) => re.test(q));
    if (hit) {
      params.risk = hit[1];
      chips.push({ label: "المخاطر", value: RISK_LEVELS[hit[1]].label });
    }
  }

  // amounts: min / max
  const amountField = rule.entity === "units" ? "Rent" : rule.entity === "contracts" ? "Amount" : "Amount";
  const minM = q.match(/(?:فوق|أكثر من|اكثر من|أكبر من|اكبر من|يزيد عن|تتجاوز|يتجاوز|>=?)\s*([\d.,]+\s*(?:ألف|الف|آلاف|مليون|k|K)?)/);
  const maxM = q.match(/(?:أقل من|اقل من|تحت|دون|لا يتجاوز|<=?)\s*([\d.,]+\s*(?:ألف|الف|آلاف|مليون|k|K)?)/);
  if (minM) {
    const v = parseAmount(minM[1]);
    if (v !== null) {
      params[`min${amountField}`] = String(v);
      chips.push({ label: rule.entity === "units" ? "الإيجار من" : "المبلغ من", value: `${money(v)} ر.س` });
    }
  }
  if (maxM) {
    const v = parseAmount(maxM[1]);
    if (v !== null) {
      params[`max${amountField}`] = String(v);
      chips.push({ label: rule.entity === "units" ? "الإيجار حتى" : "المبلغ حتى", value: `${money(v)} ر.س` });
    }
  }

  // time windows: خلال N يوم / شهر / أسبوع
  const within = q.match(/(?:خلال|قبل|بعد|في غضون)\s*(\d+)\s*(يوم|أيام|شهر|أشهر|شهور|أسبوع|أسابيع)/);
  if (within) {
    const n = Number(within[1]);
    const unit = within[2];
    const days = /شهر|أشهر|شهور/.test(unit) ? n * 30 : /أسبوع/.test(unit) ? n * 7 : n;
    if (rule.entity === "contracts") {
      params.expiring = String(days);
      chips.push({ label: "تنتهي خلال", value: `${days} يوم` });
    } else if (rule.entity === "installments") {
      params.dueWithin = String(days);
      chips.push({ label: "تستحق خلال", value: `${days} يوم` });
    } else {
      params.days = String(days);
      chips.push({ label: "خلال", value: `${days} يوم` });
    }
  } else if (rule.entity === "contracts" && /تنتهي|قريب|ينتهي/.test(q) && !params.status) {
    params.expiring = "90";
    chips.push({ label: "تنتهي خلال", value: "90 يوم" });
  }

  // rooms
  const rooms = q.match(/(\d+)\s*غرف/);
  if (rooms && rule.entity === "units") {
    params.rooms = rooms[1];
    chips.push({ label: "الغرف", value: rooms[1] });
  }

  // bare numbers for collections ("المتأخرات أكثر من 10000" handled above). Fallback: any number after المتأخرات
  if (rule.entity === "collections" && !params.minAmount) {
    const n = q.match(/(\d[\d.,]*)\s*(ألف|الف|مليون)?/);
    if (n && /أكثر|فوق|أكبر/.test(q)) {
      const v = parseAmount(n[0]);
      if (v) {
        params.minAmount = String(v);
        chips.push({ label: "المبلغ من", value: `${money(v)} ر.س` });
      }
    }
  }

  return { entity: rule.entity, label: rule.label, path: rule.path, params, chips };
}

/* ───────────── Page ───────────── */

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const q = (sp.q ?? "").trim();
  const like = textLike(q);
  const pScope = propertyScope(user);
  const pidScope = propertyIdScope(user);
  const cScope = contractScope(user);

  const ai = q.length >= 3 ? interpret(q, user) : null;

  const [properties, units, owners, tenants, contracts, payments, cases, tasks] = q.length < 2
    ? [[], [], [], [], [], [], [], []]
    : await Promise.all([
        can(user, "properties.view") ? db.property.findMany({ where: { organizationId: org, ...pScope, OR: [{ name: like }, { code: like }, { deedNumber: like }, { district: like }] }, take: LIMIT, select: { id: true, name: true, code: true, city: true, district: true, status: true } }) : [],
        can(user, "units.view") ? db.unit.findMany({ where: { organizationId: org, ...pidScope, OR: [{ number: like }, { code: like }] }, take: LIMIT, include: { property: { select: { name: true } } } }) : [],
        can(user, "owners.view") ? db.owner.findMany({ where: { organizationId: org, OR: [{ name: like }, { phone: phoneLike(q) }, { nationalId: like }, { crNumber: like }, { code: like }] }, take: LIMIT, select: { id: true, name: true, code: true, phone: true, status: true } }) : [],
        can(user, "tenants.view") ? db.tenant.findMany({ where: { organizationId: org, ...(cScope.contract ? { contracts: { some: { propertyId: cScope.contract.propertyId } } } : {}), OR: [{ name: like }, { phone: phoneLike(q) }, { nationalId: like }, { crNumber: like }, { code: like }] }, take: LIMIT, select: { id: true, name: true, code: true, phone: true, riskLevel: true } }) : [],
        can(user, "contracts.view") ? db.contract.findMany({ where: { organizationId: org, ...pidScope, OR: [{ code: like }] }, take: LIMIT, include: { tenant: { select: { name: true } }, unit: { select: { number: true } } } }) : [],
        can(user, "payments.view") ? db.payment.findMany({ where: { organizationId: org, ...cScope, OR: [{ code: like }, { reference: like }] }, take: LIMIT, include: { tenant: { select: { name: true } } } }) : [],
        can(user, "collections.view") ? db.collectionCase.findMany({ where: { organizationId: org, installment: { tenant: { OR: [{ name: like }, { phone: phoneLike(q) }] }, ...(cScope.contract ? { contract: cScope.contract } : {}) } }, take: LIMIT, include: { installment: { include: { tenant: { select: { name: true } }, contract: { select: { code: true, unit: { select: { number: true } } } } } } } }) : [],
        can(user, "tasks.view") ? db.task.findMany({ where: { organizationId: org, OR: [{ title: like }, { entityLabel: like }] }, take: LIMIT, include: { assignedTo: { select: { name: true } } } }) : [],
      ]);

  const groups = [
    { key: "properties", label: "العقارات", count: properties.length, href: `/properties?q=${encodeURIComponent(q)}` },
    { key: "units", label: "الوحدات", count: units.length, href: `/units?q=${encodeURIComponent(q)}` },
    { key: "owners", label: "الملاك", count: owners.length, href: `/owners?q=${encodeURIComponent(q)}` },
    { key: "tenants", label: "المستأجرون", count: tenants.length, href: `/tenants?q=${encodeURIComponent(q)}` },
    { key: "contracts", label: "العقود", count: contracts.length, href: `/contracts?q=${encodeURIComponent(q)}` },
    { key: "payments", label: "سندات القبض", count: payments.length, href: `/payments?q=${encodeURIComponent(q)}` },
    { key: "collections", label: "المطالبات", count: cases.length, href: `/collections?q=${encodeURIComponent(q)}` },
    { key: "tasks", label: "المهام", count: tasks.length, href: `/tasks?q=${encodeURIComponent(q)}` },
  ];
  const total = groups.reduce((s, g) => s + g.count, 0);
  const aiHref = ai ? `${ai.path}${Object.keys(ai.params).length ? `?${new URLSearchParams(ai.params).toString()}` : ""}` : null;

  return (
    <>
      <PageHeader title="البحث" subtitle="ابحث بالاسم أو الرقم أو الجوال أو رقم الهوية أو المرجع، أو اكتب سؤالك بالعربية وسيحوّله النظام إلى فلاتر." />

      <Card className="mb-4">
        <form method="get" action="/search" className="flex flex-wrap items-center gap-2">
          <Input name="q" defaultValue={q} placeholder="مثال: الوحدات الشاغرة في الرياض اللي إيجارها فوق 60 ألف" className="!w-full flex-1 md:!w-auto" autoFocus />
          <button className="btn btn-primary" type="submit">
            بحث
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[12px] text-muted">
          <span>جرّب:</span>
          {["الوحدات الشاغرة في الرياض اللي إيجارها فوق 60 ألف", "المتأخرات أكثر من 10000", "العقود التي تنتهي خلال 30 يوم", "المستأجرون ذوو المخاطر المرتفعة"].map((ex) => (
            <Link key={ex} href={`/search?q=${encodeURIComponent(ex)}`} className="rounded-full border border-line px-2.5 py-0.5 hover:border-brand hover:text-brand">
              {ex}
            </Link>
          ))}
        </div>
      </Card>

      {ai && aiHref && (
        <Card className="mb-4" tone="warm" title="تفسير البحث" subtitle="فُسّر سؤالك إلى الفلاتر التالية (قواعد لغوية — بدون إرسال بياناتك لأي جهة خارجية)">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="brand">{ai.label}</Tag>
            {ai.chips.map((c, i) => (
              <span key={i} className="tag tag-neutral tag-plain">
                {c.label}: <b className="num mr-1">{c.value}</b>
              </span>
            ))}
            {ai.chips.length === 0 && <span className="text-[12.5px] text-muted">بدون فلاتر إضافية — سيتم فتح القائمة كاملة.</span>}
            <Link href={aiHref} className="btn btn-primary btn-sm mr-auto">
              فتح {ai.label} بهذه الفلاتر ←
            </Link>
          </div>
          <div className="mt-2 text-[11.5px] text-faint latin" dir="ltr">
            {aiHref}
          </div>
        </Card>
      )}

      {q.length < 2 ? (
        <Card>
          <EmptyState title="اكتب كلمة بحث" description="حرفان على الأقل. يبحث النظام في العقارات والوحدات والملاك والمستأجرين والعقود وسندات القبض والمطالبات والمهام ضمن نطاق صلاحياتك." />
        </Card>
      ) : total === 0 ? (
        <Card>
          <EmptyState title={`لا توجد نتائج لـ "${q}"`} description={ai ? "لكن يمكنك فتح القائمة بالفلاتر المفسّرة أعلاه." : "جرّب كلمة أقصر أو رقمًا مرجعيًا أو جوالًا."} action={aiHref ? <Link href={aiHref} className="btn btn-outline">فتح {ai!.label}</Link> : undefined} />
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {groups.filter((g) => g.count).map((g) => (
              <a key={g.key} href={`#${g.key}`} className="tag tag-neutral tag-plain">
                {g.label} <b className="num mr-1">{g.count}</b>
              </a>
            ))}
            {!ai && <span className="mr-auto text-[12px] text-muted">{total >= LIMIT ? `تُعرض أول ${LIMIT} نتائج لكل نوع` : `${total} نتيجة`}</span>}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {properties.length > 0 && (
              <Group id="properties" title="العقارات" count={properties.length} more={groups[0].href}>
                {properties.map((p) => (
                  <RowItem key={p.id} href={`/properties/${p.id}`} title={p.name} sub={`${p.code} · ${[p.city, p.district].filter(Boolean).join(" — ")}`} right={<StatusTag value={p.status} map={PROPERTY_STATUS} />} />
                ))}
              </Group>
            )}
            {units.length > 0 && (
              <Group id="units" title="الوحدات" count={units.length} more={groups[1].href}>
                {units.map((u) => (
                  <RowItem key={u.id} href={`/units/${u.id}`} title={`${u.number} — ${u.property.name}`} sub={`${u.code} · ${UNIT_TYPES[u.type] ?? u.type}${u.currentRent ? ` · ${money(u.currentRent)} ر.س` : ""}`} right={<StatusTag value={u.status} map={UNIT_STATUS} />} />
                ))}
              </Group>
            )}
            {owners.length > 0 && (
              <Group id="owners" title="الملاك" count={owners.length} more={groups[2].href}>
                {owners.map((o) => (
                  <RowItem key={o.id} href={`/owners/${o.id}`} title={o.name} sub={`${o.code}${o.phone ? ` · ${o.phone}` : ""}`} right={<StatusTag value={o.status} map={PROPERTY_STATUS} />} />
                ))}
              </Group>
            )}
            {tenants.length > 0 && (
              <Group id="tenants" title="المستأجرون" count={tenants.length} more={groups[3].href}>
                {tenants.map((t) => (
                  <RowItem key={t.id} href={`/tenants/${t.id}`} title={t.name} sub={`${t.code}${t.phone ? ` · ${t.phone}` : ""}`} right={<StatusTag value={t.riskLevel} map={RISK_LEVELS} />} />
                ))}
              </Group>
            )}
            {contracts.length > 0 && (
              <Group id="contracts" title="العقود" count={contracts.length} more={groups[4].href}>
                {contracts.map((c) => (
                  <RowItem key={c.id} href={`/contracts/${c.id}`} title={`${c.code} — ${c.tenant.name}`} sub={`الوحدة ${c.unit.number} · ${date(c.startDate)} → ${date(c.endDate)} · ${money(c.totalAmount)} ر.س`} right={<StatusTag value={c.status} map={CONTRACT_STATUS} />} />
                ))}
              </Group>
            )}
            {payments.length > 0 && (
              <Group id="payments" title="سندات القبض" count={payments.length} more={groups[5].href}>
                {payments.map((p) => (
                  <RowItem key={p.id} href={`/payments/${p.id}`} title={`${p.code} — ${p.tenant.name}`} sub={`${date(p.paidAt)} · ${money(p.amount)} ر.س${p.reference ? ` · مرجع ${p.reference}` : ""}`} right={<StatusTag value={p.status} map={PAYMENT_STATUS} />} />
                ))}
              </Group>
            )}
            {cases.length > 0 && (
              <Group id="collections" title="المطالبات" count={cases.length} more={groups[6].href}>
                {cases.map((k) => (
                  <RowItem key={k.id} href={`/collections/${k.id}`} title={`${k.installment.tenant.name} — الوحدة ${k.installment.contract.unit.number}`} sub={`${k.installment.contract.code} / ${k.installment.seq} · متبقٍ ${money(k.installment.amount - k.installment.paidAmount)} ر.س · تأخر ${daysOverdue(k.installment.dueDate)} يوم`} right={<StatusTag value={k.followUpStatus} map={COLLECTION_STATUS} />} />
                ))}
              </Group>
            )}
            {tasks.length > 0 && (
              <Group id="tasks" title="المهام" count={tasks.length} more={groups[7].href}>
                {tasks.map((t) => (
                  <RowItem key={t.id} href={`/tasks/${t.id}`} title={t.title} sub={`${t.assignedTo?.name ?? "غير مسندة"}${t.dueDate ? ` · ${date(t.dueDate)}` : ""}${t.entityLabel ? ` · ${t.entityLabel}` : ""}`} right={<StatusTag value={t.status} map={TASK_STATUS} />} />
                ))}
              </Group>
            )}
          </div>
          {!can(user, "owners.view") && (
            <div className="mt-4">
              <Alert tone="neutral">بعض الأنواع (مثل الملاك) غير معروضة لأن دورك لا يملك صلاحية عرضها.</Alert>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Group({ id, title, count, more, children }: { id: string; title: string; count: number; more: string; children: React.ReactNode }) {
  return (
    <div id={id}>
      <Card title={title} subtitle={`${count} نتيجة`} actions={count >= LIMIT ? <Link href={more} className="link text-xs">عرض الكل</Link> : undefined} padded={false}>
        <ul className="divide-y divide-[#EDF1EF]">{children}</ul>
      </Card>
    </div>
  );
}

function RowItem({ href, title, sub, right }: { href: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-mist">
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold text-text">{title}</span>
          {sub && <span className="block truncate text-[12px] text-muted">{sub}</span>}
        </span>
        {right}
      </Link>
    </li>
  );
}
