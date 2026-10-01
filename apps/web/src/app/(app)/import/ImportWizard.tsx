"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Card, Alert, Field, Select, Textarea, Table, Tag, StatGrid, StatCard } from "@/components/ui";
import { IMPORT_ENTITIES, IMPORT_FIELDS, autoMap, type ImportEntity, type RowResult, type ImportReport } from "./spec";
import { validateImport, runImport } from "./actions";

const STEPS = ["الملف", "الأعمدة", "التحقق", "المعاينة", "التنفيذ", "النتيجة"];

/** RFC-4180-ish CSV parser: quotes, escaped quotes, CRLF, BOM, auto delimiter (, ; tab). */
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": (firstLine.match(/,/g) ?? []).length, ";": (firstLine.match(/;/g) ?? []).length, "\t": (firstLine.match(/\t/g) ?? []).length };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",") as string;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

export function ImportWizard({ entity, onReset }: { entity: ImportEntity; onReset?: () => void }) {
  const fields = IMPORT_FIELDS[entity];
  const meta = IMPORT_ENTITIES[entity];
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const mappedRows = useMemo(() => {
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
    return rows.map((r) => {
      const o: Record<string, string> = {};
      for (const f of fields) {
        const src = mapping[f.key];
        if (src && idx[src] !== undefined) o[f.key] = r[idx[src]] ?? "";
      }
      return o;
    });
  }, [rows, headers, mapping, fields]);

  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const badCount = results ? results.length - okCount : 0;
  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);

  /** Shared entry point for CSV text and Excel sheets: first row = headers, the rest = data rows. */
  function loadTable(h: string[], r: string[][], name: string) {
    if (!h.length || !r.length) {
      setError("تعذر قراءة الملف. تأكد أن الصف الأول يحتوي على أسماء الأعمدة وأن هناك صفًا واحدًا على الأقل.");
      return;
    }
    setError(null);
    setFileName(name);
    setHeaders(h);
    setRows(r);
    setMapping(autoMap(entity, h));
    setResults(null);
    setStep(1);
  }

  function load(raw: string, name: string) {
    const { headers: h, rows: r } = parseCSV(raw);
    loadTable(h, r, name);
  }

  /** Reads the first sheet of an .xlsx/.xls file into the same headers/rows shape as CSV (dates → yyyy-mm-dd). */
  async function loadExcel(buf: ArrayBuffer, name: string) {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) {
        setError("ملف Excel لا يحتوي على أي ورقة عمل.");
        return;
      }
      const pad = (n: number) => String(n).padStart(2, "0");
      const text = (v: unknown) => {
        if (v === null || v === undefined) return "";
        if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
        return String(v).trim();
      };
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: false });
      const cells = aoa.map((r) => (Array.isArray(r) ? r.map(text) : [])).filter((r) => r.some((c) => c !== ""));
      const width = cells.reduce((m, r) => Math.max(m, r.length), 0);
      const h = (cells.shift() ?? []).map((c) => c.trim());
      const r = cells.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""));
      loadTable(h, r, name);
    } catch {
      setError("تعذر قراءة ملف Excel. تأكد أنه بصيغة .xlsx أو .xls وأن الورقة الأولى تحتوي على صف العناوين.");
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    if (/\.(xlsx|xlsm|xls)$/i.test(f.name)) {
      reader.onload = () => void loadExcel(reader.result as ArrayBuffer, f.name);
      reader.readAsArrayBuffer(f);
      return;
    }
    reader.onload = () => load(String(reader.result ?? ""), f.name);
    reader.readAsText(f, "UTF-8");
  }

  function validate() {
    setError(null);
    start(async () => {
      const res = await validateImport(entity, mappedRows);
      if (res.error) setError(res.error);
      setResults(res.results);
      setStep(2);
    });
  }

  function doImport() {
    setError(null);
    start(async () => {
      const res = await runImport(entity, fileName || "paste.csv", mappedRows);
      if (res.error || !res.report) {
        setError(res.error ?? "تعذر تنفيذ الاستيراد حاليًا. لم يتم حفظ أي سجل.");
        return;
      }
      setReport(res.report);
      setStep(5);
    });
  }

  return (
    <Card
      title={`استيراد ${meta.label}`}
      actions={
        onReset && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
            تغيير النوع
          </button>
        )
      }
    >
      {/* Stepper */}
      <ol className="mb-5 flex flex-wrap gap-2 text-[12.5px]">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${i === step ? "bg-brand text-white" : i < step ? "bg-success-bg text-success" : "bg-mist text-muted"}`}>
            <span className="num font-bold">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {/* Step 1: upload / paste */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="ملف Excel أو CSV" name="file" help="الصف الأول هو أسماء الأعمدة، وتُقرأ الورقة الأولى فقط.">
              <input id="file" type="file" accept=".xlsx,.xls,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={onFile} className="input" />
            </Field>
            <div className="text-[13px] text-muted">
              <div className="mb-1 font-bold text-text">الأعمدة المتوقعة</div>
              <div className="flex flex-wrap gap-1">
                {fields.map((f) => (
                  <Tag key={f.key} tone={f.required ? "brand" : "neutral"} plain>
                    {f.label}
                    {f.required ? " *" : ""}
                  </Tag>
                ))}
              </div>
              {/* A file download, not a page: a plain link (next/link would prefetch it as a route and never settle). */}
              <a className="link mt-2 inline-block" href={`/import/template?type=${entity}`} download>
                تنزيل القالب
              </a>
            </div>
          </div>
          <details className="rounded-xl border border-line px-4 py-3" open={Boolean(text.trim())}>
            <summary className="cursor-pointer text-[13px] font-bold text-brand">أو الصق الجدول مباشرة</summary>
            <div className="mt-3 space-y-3">
              <Field label="البيانات" name="paste" help="انسخ الجدول من Excel مع صف العناوين.">
                <Textarea name="paste" rows={6} value={text} onChange={(e) => setText(e.target.value)} className="ltr" dir="auto" placeholder={`${fields.slice(0, 3).map((f) => f.label).join(",")}…`} />
              </Field>
              <div className="flex justify-end">
                <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={() => load(text, "paste.csv")}>
                  متابعة
                </button>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* Step 2: mapping */}
      {step === 1 && (
        <div className="space-y-4">
          <Alert tone="info">
            <b className="num">{rows.length}</b> صف و <b className="num">{headers.length}</b> عمود من «{fileName}». اربط كل حقل بالعمود المناسب.
          </Alert>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fields.map((f) => (
              <Field key={f.key} label={f.label} name={`map_${f.key}`} required={f.required} help={f.help}>
                <Select
                  name={`map_${f.key}`}
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                  placeholder="غير مرتبط"
                  options={headers.map((h) => ({ value: h, label: h }))}
                />
              </Field>
            ))}
          </div>
          {missingRequired.length > 0 && <Alert tone="warning">حقول مطلوبة غير مرتبطة: {missingRequired.map((f) => f.label).join("، ")}</Alert>}
          <div className="flex justify-between">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>
              رجوع
            </button>
            <button type="button" className="btn btn-primary" disabled={pending || missingRequired.length > 0} onClick={validate}>
              {pending ? "جارٍ التحقق…" : "تحقق من البيانات"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: validation summary */}
      {step === 2 && results && (
        <div className="space-y-4">
          <StatGrid cols={3}>
            <StatCard label="إجمالي الصفوف" value={<span className="num">{results.length}</span>} />
            <StatCard label="صفوف صالحة" value={<span className="num">{okCount}</span>} tone="success" />
            <StatCard label="صفوف بها أخطاء" value={<span className="num">{badCount}</span>} tone={badCount ? "danger" : undefined} />
          </StatGrid>
          {badCount > 0 ? (
            <div>
              <div className="mb-2 text-[13px] font-bold text-text">صفوف لن تُحفظ</div>
              <ul className="max-h-72 space-y-1 overflow-auto rounded-xl bg-danger-bg p-3 text-[13px] text-danger">
                {results
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <li key={r.row}>
                      <b className="num">الصف {r.row}:</b> {r.errors.join(" · ")}
                    </li>
                  ))}
              </ul>
            </div>
          ) : (
            <Alert tone="success">جميع الصفوف صالحة وجاهزة للاستيراد.</Alert>
          )}
          <div className="flex justify-between">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
              تعديل الربط
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(3)}>
              معاينة الصفوف
            </button>
          </div>
        </div>
      )}

      {/* Step 4: preview table */}
      {step === 3 && results && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Tag tone="success">صالح: {okCount}</Tag>
            <Tag tone="danger">خطأ: {badCount}</Tag>
            <span className="text-muted">تُعرض أول 200 صف</span>
          </div>
          <Table>
            <thead>
              <tr>
                <th>#</th>
                <th>الحالة</th>
                {Object.keys(results[0]?.preview ?? {}).map((k) => (
                  <th key={k}>{k}</th>
                ))}
                <th>الملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {results.slice(0, 200).map((r) => (
                <tr key={r.row} className={r.ok ? "" : "bg-danger-bg/40"}>
                  <td className="num">{r.row}</td>
                  <td>{r.ok ? <Tag tone="success">صالح</Tag> : <Tag tone="danger">خطأ</Tag>}</td>
                  {Object.values(r.preview).map((v, i) => (
                    <td key={i} className="max-w-[180px] truncate" dir="auto">
                      {v || <span className="text-faint">—</span>}
                    </td>
                  ))}
                  <td className="max-w-[320px] text-[12px] text-danger">{r.errors.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex justify-between">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>
              رجوع
            </button>
            <button type="button" className="btn btn-primary" disabled={okCount === 0} onClick={() => setStep(4)}>
              متابعة
            </button>
          </div>
        </div>
      )}

      {/* Step 5: confirm & run */}
      {step === 4 && results && (
        <div className="space-y-4">
          <Alert tone="warning" title="تأكيد الاستيراد">
            سيُنشأ <b className="num">{okCount}</b> سجل من «{meta.label}». الصفوف التي بها أخطاء (<b className="num">{badCount}</b>) لن تُحفظ وستظهر في النتيجة.
            {entity === "CONTRACTS" && " تُنشأ الأقساط تلقائيًا لكل عقد."}
            {entity === "PAYMENTS" && " تُخصص كل دفعة للقسط المحدد أو لأقدم قسط مفتوح."}
          </Alert>
          <div className="flex justify-between">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(3)} disabled={pending}>
              رجوع
            </button>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={doImport}>
              {pending ? "جارٍ الاستيراد…" : `استيراد ${okCount} سجل`}
            </button>
          </div>
        </div>
      )}

      {/* Step 6: report */}
      {step === 5 && report && (
        <div className="space-y-4">
          <StatGrid cols={3}>
            <StatCard label="إجمالي الصفوف" value={<span className="num">{report.total}</span>} />
            <StatCard label="تم الاستيراد" value={<span className="num">{report.success}</span>} tone="success" />
            <StatCard label="لم يتم الاستيراد" value={<span className="num">{report.failed}</span>} tone={report.failed ? "danger" : undefined} />
          </StatGrid>
          {report.failed > 0 && (
            <div>
              <div className="mb-2 text-[13px] font-bold text-text">الصفوف التي لم تُحفظ</div>
              <ul className="max-h-60 space-y-1 overflow-auto rounded-xl bg-danger-bg p-3 text-[13px] text-danger">
                {report.errors.map((e) => (
                  <li key={e.row}>
                    <b className="num">الصف {e.row}:</b> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.created.length > 0 && (
            <details className="rounded-xl bg-mist p-3 text-[13px]">
              <summary className="font-bold text-brand">السجلات المنشأة ({report.created.length})</summary>
              <ul className="mt-2 max-h-60 list-inside list-disc overflow-auto text-text-2">
                {report.created.map((c, i) => (
                  <li key={i} dir="auto">
                    {c}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Link className="btn btn-ghost" href="/import">
              سجل الاستيراد
            </Link>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setStep(0);
                setText("");
                setRows([]);
                setHeaders([]);
                setResults(null);
                setReport(null);
              }}
            >
              استيراد ملف آخر
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Entity type picker + wizard host (client-side state). */
export function ImportCenter({ initial }: { initial?: string }) {
  const [entity, setEntity] = useState<ImportEntity | null>(initial && initial in IMPORT_ENTITIES ? (initial as ImportEntity) : null);
  if (entity) return <ImportWizard entity={entity} onReset={() => setEntity(null)} />;
  return (
    <Card title="استيراد جديد" subtitle="اختر نوع البيانات ثم ارفع الملف.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(IMPORT_ENTITIES) as ImportEntity[]).map((k) => {
          const m = IMPORT_ENTITIES[k];
          return (
            <div key={k} className="flex flex-col rounded-xl border border-line bg-white p-4">
              <div className="font-bold text-text">{m.label}</div>
              <div className="mb-3 flex-1 text-[12.5px] text-muted">{m.description}</div>
              <div className="flex items-center justify-between gap-2">
                <a className="btn btn-link btn-xs" href={`/import/template?type=${k}`} download>
                  تنزيل القالب
                </a>
                <button type="button" className="btn btn-primary btn-xs" onClick={() => setEntity(k)}>
                  استيراد
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
