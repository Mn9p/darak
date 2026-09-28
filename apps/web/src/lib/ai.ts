// Assistant layer: short Arabic briefs and message drafts built from facts the app already computed.
// - Uses Gemini (free tier via GEMINI_API_KEY) when configured; otherwise a deterministic Arabic text from the same facts.
// - Never mutates data, never throws to the page, never receives raw rows — only numbers and short labels.
// - Results are cached in-process for one hour per fact set so page loads stay cheap.
import { createHash } from "node:crypto";
import { logger } from "./logger";
import { money } from "./format";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { text: string; at: number }>();

export function assistantEnabled() {
  return Boolean(process.env.GEMINI_API_KEY);
}

const SYSTEM = `أنت مساعد مكتب إدارة أملاك في السعودية يعمل داخل نظام "دارك".
تكتب بالعربية الفصحى المبسطة بنبرة مهنية هادئة، بلا مبالغة ولا تعبيرات تسويقية ولا رموز تعبيرية ولا تنسيق Markdown.
تعتمد فقط على الأرقام والحقائق المعطاة ولا تخترع أي بيانات. المبالغ بالريال السعودي.
المصطلحات: المؤجر، المستأجر، عقد الإيجار، سند قبض، الدفعة المستحقة، مهلة السداد، طلب تنفيذ عبر ناجز، كشف حساب المالك.`;

async function ask(key: string, prompt: string, maxTokens: number, fallback: () => string): Promise<{ text: string; generated: boolean }> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { text: hit.text, generated: true };
  if (!assistantEnabled()) return { text: fallback(), generated: false };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
      }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      logger.warn("assistant.failed", { key: key.slice(0, 40), status: res.status, body: (await res.text()).slice(0, 200) });
      return { text: fallback(), generated: false };
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
    if (json.promptFeedback?.blockReason) return { text: fallback(), generated: false };
    const cand = json.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("\n").trim();
    if (!text || cand?.finishReason === "SAFETY") return { text: fallback(), generated: false };
    cache.set(key, { text, at: Date.now() });
    return { text, generated: true };
  } catch (e) {
    logger.warn("assistant.failed", { key: key.slice(0, 40), error: String(e) });
    return { text: fallback(), generated: false };
  }
}

const hash = (o: unknown) => createHash("sha1").update(JSON.stringify(o)).digest("hex");

/* ───────────── Property brief ───────────── */

export interface PropertyFacts {
  name: string;
  type: string;
  units: { total: number; rented: number; vacant: number };
  occupancy: number;
  annualRent: number;
  month: { due: number; paid: number };
  overdue: { amount: number; count: number; oldestDays: number; enforceable: number };
  expiring60: number;
  pendingExpenses: number;
  ytd: { income: number; expenses: number; fees: number };
  topDebtor?: { name: string; amount: number; days: number } | null;
}

export async function propertyBrief(f: PropertyFacts) {
  const rate = f.month.due ? Math.round((f.month.paid / f.month.due) * 100) : null;
  const fallback = () => {
    const parts: string[] = [];
    parts.push(`${f.name}: ${f.units.rented} من ${f.units.total} وحدة مؤجرة (إشغال ${Math.round(f.occupancy)}%).`);
    if (f.overdue.amount > 0) parts.push(`المتأخر ${money(f.overdue.amount)} ريال على ${f.overdue.count} دفعة، أقدمها ${f.overdue.oldestDays} يوم${f.overdue.enforceable ? `، و${f.overdue.enforceable} منها تجاوزت مهلة السداد ويمكن طلب التنفيذ` : ""}.`);
    else parts.push("لا توجد دفعات متأخرة.");
    if (rate !== null) parts.push(`تحصيل هذا الشهر ${rate}% (${money(f.month.paid)} من ${money(f.month.due)} ريال).`);
    if (f.expiring60 > 0) parts.push(`${f.expiring60} عقد ينتهي خلال 60 يومًا يحتاج قرار تجديد.`);
    if (f.units.vacant > 0) parts.push(`${f.units.vacant} وحدة شاغرة جاهزة للتسويق.`);
    const first = f.topDebtor ? `ابدأ بمتابعة ${f.topDebtor.name} (${money(f.topDebtor.amount)} ريال، ${f.topDebtor.days} يوم).` : f.expiring60 > 0 ? "ابدأ بقرارات التجديد." : f.units.vacant > 0 ? "ابدأ بتسويق الوحدات الشاغرة." : "لا يوجد ما يحتاج تدخلًا عاجلًا.";
    parts.push(first);
    return parts.join(" ");
  };
  const prompt = `اكتب ملخصًا من ثلاث إلى خمس جمل لمدير مكتب عن وضع هذا العقار: الحالة العامة، أكبر خطر، وما الذي يجب البدء به اليوم. لا تكرر الأرقام كلها، اختر ما يهم.\n\nالحقائق (JSON):\n${JSON.stringify(f)}`;
  return ask(`prop:${hash(f)}`, prompt, 600, fallback);
}

/* ───────────── Reminder draft ───────────── */

export interface ReminderFacts {
  tenantName: string;
  unitNumber: string;
  propertyName: string;
  amount: number;
  dueDate: string;
  daysLate: number;
  graceDays: number;
  pastGrace: boolean;
  officeName: string;
  channel: "SMS" | "WHATSAPP" | "EMAIL";
  tone: "soft" | "firm";
}

export async function reminderDraft(f: ReminderFacts) {
  const fallback = () => {
    const greet = `السلام عليكم ${f.tenantName}،`;
    const body =
      f.daysLate <= 0
        ? `نذكّركم باستحقاق دفعة إيجار الوحدة ${f.unitNumber} في ${f.propertyName} بقيمة ${money(f.amount)} ريال بتاريخ ${f.dueDate}.`
        : `دفعة إيجار الوحدة ${f.unitNumber} في ${f.propertyName} بقيمة ${money(f.amount)} ريال كانت مستحقة بتاريخ ${f.dueDate} ولم تُسدد بعد.`;
    const tail = f.pastGrace && f.tone === "firm" ? " نود التنبيه إلى انتهاء مهلة السداد النظامية، ونأمل السداد خلال يومين لتفادي الإجراءات النظامية." : f.daysLate > 0 ? " نأمل السداد أو التواصل معنا لترتيب ذلك." : " شاكرين لكم حسن التعاون.";
    return `${greet} ${body}${tail} — ${f.officeName}`;
  };
  const prompt = `اكتب رسالة ${f.channel === "EMAIL" ? "بريد إلكتروني قصيرة" : f.channel === "WHATSAPP" ? "واتساب" : "SMS"} واحدة للمستأجر بنبرة ${f.tone === "firm" ? "حازمة ومهذبة" : "لطيفة"} لا تتجاوز 400 حرف. اذكر الوحدة والمبلغ وتاريخ الاستحقاق. ${f.pastGrace ? "اذكر انتهاء مهلة السداد النظامية وأن المكتب قد يلجأ للإجراءات النظامية، دون تهديد." : "لا تذكر إجراءات نظامية."} اختم باسم المكتب. لا تضف عنوانًا ولا شرحًا، الرسالة فقط.\n\nالحقائق (JSON):\n${JSON.stringify(f)}`;
  return ask(`rem:${hash(f)}`, prompt, 400, fallback);
}

/* ───────────── Daily brief ───────────── */

export interface DailyFacts {
  managerName: string;
  date: string;
  overdue: { amount: number; count: number; enforceable: number };
  promisesToday: number;
  brokenPromises: number;
  expiring30: number;
  vacant: number;
  pendingExpenses: number;
  collectionRate: number;
  monthCollected: number;
  topProperty?: { name: string; overdue: number } | null;
}

export async function dailyBrief(f: DailyFacts) {
  const fallback = () => {
    const lines: string[] = [];
    lines.push(f.overdue.amount > 0 ? `المتأخر ${money(f.overdue.amount)} ريال على ${f.overdue.count} دفعة${f.overdue.enforceable ? `، ${f.overdue.enforceable} منها تجاوزت مهلة السداد` : ""}${f.topProperty ? `، أغلبها في ${f.topProperty.name}` : ""}.` : "لا توجد متأخرات مفتوحة اليوم.");
    const follow: string[] = [];
    if (f.promisesToday) follow.push(`${f.promisesToday} وعد سداد يستحق اليوم`);
    if (f.brokenPromises) follow.push(`${f.brokenPromises} وعد مكسور`);
    if (f.expiring30) follow.push(`${f.expiring30} عقد ينتهي خلال 30 يومًا`);
    if (f.pendingExpenses) follow.push(`${f.pendingExpenses} مصروف بانتظار الاعتماد`);
    lines.push(follow.length ? `يحتاج قرارك: ${follow.join("، ")}.` : "لا قرارات عالقة.");
    lines.push(`نسبة التحصيل هذا الشهر ${Math.round(f.collectionRate)}% (${money(f.monthCollected)} ريال)${f.vacant ? `، و${f.vacant} وحدة شاغرة` : ""}.`);
    return lines.join("\n");
  };
  const prompt = `اكتب ثلاث جمل قصيرة (كل جملة في سطر) تلخص يوم مدير المكتب: أهم رقم، ما يحتاج قراره، وملاحظة ختامية عملية. بلا ترحيب.\n\nالحقائق (JSON):\n${JSON.stringify(f)}`;
  return ask(`day:${hash(f)}`, prompt, 400, fallback);
}
