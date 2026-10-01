import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { guideDismissed } from "@/lib/guides";
import { Card, ActionButton } from "@/components/ui";
import { dismissGuide } from "@/app/(app)/guides/actions";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { hrefPermission } from "@/lib/nav";

/**
 * First-run guide for a module: what the screen is for, the 2–3 steps that make it useful,
 * and where the data comes from. Rendered only while `show` is true (the page decides: empty list,
 * no filters) and the user has not dismissed it. Server component — reads the dismissal itself.
 */
export async function GuideCard({
  id,
  title,
  steps,
  note,
  cta,
  secondary,
  show = true,
}: {
  id: string;
  title: string;
  steps: string[];
  /** Where the data comes from / what happens automatically. One short sentence. */
  note?: string;
  cta?: { href: string; label: string };
  secondary?: { href: string; label: string };
  show?: boolean;
}) {
  if (!show) return null;
  const user = await getCurrentUser();
  if (!user || (await guideDismissed(user.id, id))) return null;
  // Buttons only for what this user may open; a property always needs an owner first (setup order: owner → property → units → contract).
  const allowed = (href: string) => {
    const p = hrefPermission(href);
    return !p || can(user, p);
  };
  if (cta?.href === "/properties/new" && user.organizationId && (await db.owner.count({ where: { organizationId: user.organizationId, status: { not: "ARCHIVED" } } })) === 0) {
    cta = { href: "/owners/new", label: "ابدأ بإضافة مالك" };
  }
  if (cta && !allowed(cta.href)) cta = undefined;
  if (secondary && !allowed(secondary.href)) secondary = undefined;

  return (
    <Card
      tone="warm"
      className="mb-4"
      title={title}
      actions={
        <ActionButton action={dismissGuide} hidden={{ id }} className="btn btn-ghost btn-xs text-muted">
          فهمت، إخفاء
        </ActionButton>
      }
    >
      <ol className="grid gap-2 md:grid-cols-3">
        {steps.slice(0, 3).map((s, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="num grid h-6 w-6 flex-none place-items-center rounded-full bg-sand text-[12px] font-bold text-ink" aria-hidden>
              {i + 1}
            </span>
            <span className="text-[13.5px] leading-relaxed text-text">{s}</span>
          </li>
        ))}
      </ol>
      {(note || cta || secondary) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#F0E2BF] pt-3">
          {cta && (
            <Link href={cta.href} className="btn btn-primary btn-sm">
              {cta.label}
            </Link>
          )}
          {secondary && (
            <Link href={secondary.href} className="btn btn-link btn-sm">
              {secondary.label}
            </Link>
          )}
          {note && <p className="text-[12.5px] text-muted md:mr-auto">{note}</p>}
        </div>
      )}
    </Card>
  );
}
