import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MobileNav, NavCrumbs, SearchTrigger } from "./HeaderClient";
import { QuickAdd, UserMenu } from "../HeaderMenus";
import { LogoMark } from "../Logo";
import { Icon } from "../icons";
import { ConfirmForms } from "../ConfirmForms";
import { Toast } from "../ui/Toast";
import { IconButton } from "../ui/form";
import { logoutAction } from "@/app/login/actions";
import { endSupportSession } from "@/app/admin/actions";
import { ActionButton } from "../ui/form";
import { ROLES } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";
import type { NavItem, NavSection } from "@/lib/nav";

/**
 * One shell for every portal: dark collapsible sidebar, header with breadcrumbs + palette + bell + user menu,
 * toasts and confirm interception. Layouts pass their own nav and counts.
 */
export function Shell({
  user,
  sections,
  counts,
  orgName,
  portalLabel,
  unread,
  branches,
  quick = [],
  notificationsHref = "/notifications",
  searchEnabled = false,
  home,
  setup,
  helpHref,
  children,
}: {
  user: SessionUser;
  sections: NavSection[] | NavItem[];
  counts?: Record<string, number>;
  orgName?: string | null;
  portalLabel?: string;
  unread: number;
  branches?: { id: string; name: string }[];
  quick?: { href: string; label: string }[];
  notificationsHref?: string;
  searchEnabled?: boolean;
  home: { href: string; label: string };
  /** Office setup progress shown above the sidebar footer until complete (staff layout only). */
  setup?: { done: number; total: number };
  /** Help centre link rendered as a "?" button in the header (staff layout only). */
  helpHref?: string;
  children: ReactNode;
}) {
  const flat: NavItem[] = Array.isArray(sections) && sections.length && "items" in (sections[0] as NavSection) ? (sections as NavSection[]).flatMap((s) => s.items) : (sections as NavItem[]);
  const profileHref = user.role === "OWNER" || user.role === "TENANT" || user.role === "SUPER_ADMIN" ? undefined : "/settings/profile";
  // Time-boxed platform support session (staff office only): persistent warning bar above the header.
  const support = Boolean(user.supportAccess && user.organizationId);
  const supportMinutesLeft = support && user.sessionExpiresAt ? Math.max(0, Math.ceil((user.sessionExpiresAt.getTime() - Date.now()) / 60_000)) : null;

  return (
    <div className="flex min-h-screen">
      <Sidebar sections={sections} orgName={orgName} portalLabel={portalLabel} counts={counts} setup={setup} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30">
        {support && (
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning-bg px-4 py-2 text-[12.5px] text-text md:px-6">
            <Icon name="alert" size={16} className="shrink-0 text-warning" />
            <span>
              <b>جلسة دعم فني باسم {user.name}</b>
              {supportMinutesLeft !== null && (
                <>
                  {" · "}تنتهي خلال <span className="num font-bold">{supportMinutesLeft}</span> دقيقة
                </>
              )}
              {" · "}كل إجراء يُسجَّل باسم فريق دارك{user.supportAdminName ? ` (${user.supportAdminName})` : ""}
            </span>
            <span className="mr-auto">
              <ActionButton action={endSupportSession} className="btn btn-outline btn-xs">إنهاء جلسة الدعم</ActionButton>
            </span>
          </div>
        )}
        <header className="hdr flex items-center gap-3 px-4 md:px-6">
          <MobileNav sections={sections} orgName={orgName} portalLabel={portalLabel} />
          <Link href={home.href} className="flex items-center gap-2 lg:hidden">
            <LogoMark size={28} />
            <b className="text-lg text-ink">دارك</b>
          </Link>
          <NavCrumbs sections={sections} home={home} />
          <div className="mr-auto flex min-w-0 flex-1 items-center justify-end gap-2">
            <div className="flex min-w-0 flex-1 justify-end">
              <SearchTrigger items={flat} searchEnabled={searchEnabled} />
            </div>
            {branches && branches.length > 0 && (
              <div className="hidden items-center gap-1.5 rounded-[10px] border border-line bg-white px-2.5 py-1.5 text-[12.5px] xl:flex">
                <span className="text-muted">الفرع:</span>
                <span className="font-bold text-text">{branches.length > 1 ? "كل الفروع" : branches[0].name}</span>
              </div>
            )}
            {quick.length > 0 && <QuickAdd items={quick} />}
            {helpHref && (
              <IconButton href={helpHref} title="مركز المساعدة">
                <Icon name="help" size={18} />
              </IconButton>
            )}
            <Link href={notificationsHref} className="icon-btn relative" aria-label="الإشعارات">
              <Icon name="bell" size={18} />
              {unread > 0 && <span className="num absolute -left-1 -top-1 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-[18px] text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <UserMenu name={user.name} roleLabel={ROLES[user.role]?.label ?? user.role} logout={logoutAction} profileHref={profileHref} />
          </div>
        </header>
        </div>
        <main className="mx-auto w-full max-w-[var(--content-max)] flex-1 p-4 md:p-6">{children}</main>
      </div>
      <ConfirmForms />
      <Suspense fallback={null}>
        <Toast />
      </Suspense>
    </div>
  );
}
