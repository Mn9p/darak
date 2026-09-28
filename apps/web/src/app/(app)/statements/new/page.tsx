import { redirect } from "next/navigation";

export default async function NewStatementRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  Object.entries(sp).forEach(([k, v]) => v && qs.set(k, v));
  qs.set("new", "1");
  redirect(`/statements?${qs}`);
}
