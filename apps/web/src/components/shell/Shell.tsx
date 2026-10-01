import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AppNav, type QuickItem, type RoleChip } from "./Nav";
import { NavCrumbs, SearchTrigger } from "./HeaderClient";
import { QuickAdd, UserMenu } from "../HeaderMenus";
import { LogoMark } from "../Logo";
import { Icon } from "../icons";
import { ConfirmForms } from "../ConfirmForms";
import { Toast } from "../ui/Toast";
import { logoutAction } from "@/app/login/actions";
import { endSupportSession } from "@/app/admin/actions";
import { ActionButton } from "../ui/form";
import { ROLES } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";
import type { NavItem, NavSection } from "@/lib/nav";

/** How the user's role reads in the chrome: owners (and platform admins) in sand, everyone else in green. */
function roleChipFor(user: SessionUser, jobTitle?: string | null): RoleChip {
  if (user.role === "ACCOUNT_OWNER" || user.role === "SUPER_ADMIN") return { label: ROLES[user.role].label, tone: "owner" };
  if (user.role === "EMPLOYEE") return { label: jobTitle ? `موظف · ${jobTitle}` : "موظف", tone: "employee" };
  return { label: ROLES[user.role]?.label ?? user.role, tone: "employee" };
}

/**
 * One shell for every portal: sidebar (desktop) / bottom bar + menu sheet + quick add (phones), an app bar with
 * breadcrumbs, search, help, bell and user menu, plus toasts and confirm interception. Layouts pass nav (already
 * filtered by permission), counts and quick actions.
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
  jobTitle,
  children,
}: {
  user: SessionUser;
  sections: NavSection[] | NavItem[];
  counts?: Record<string, number>;
  orgName?: string | null;
  portalLabel?: string;
  unread: number;
  branches?: { id: string; name: string }[];
  quick?: QuickItem[];
  notificationsHref?: string;
  searchEnabled?: boolean;
  home: { href: string; label: string };
  /** Office setup progress shown until complete (staff layout only). */
  setup?: { done: number; total: number };
  /** Help centre link (staff layout only). */
  helpHref?: string;
  /** Shown next to "موظف" in the role chip. */
  jobTitle?: string | null;
  children: ReactNode;
}) {
  const flat: NavItem[] = Array.isArray(sections) && sections.length && "items" in (sections[0] as NavSection) ? (sections as NavSection[]).flatMap((s) => s.items) : (sections as NavItem[]);
  const profileHref = user.role === "OWNER" || user.role === "TENANT" || user.role === "SUPER_ADMIN" ? undefined : "/settings/profile";
  // Time-boxed platform support session (staff office only): persistent warning bar above the header.
  const support = Boolean(user.supportAccess && user.organizationId);
  const supportMinutesLeft = support && user.sessionExpiresAt ? Math.max(0, Math.ceil((user.sessionExpiresAt.getTime() - Date.now()) / 60_000)) : null;
  const chip = roleChipFor(user, jobTitle);

  return (
    <div className="flex min-h-screen">
      <AppNav
        sections={sections}
        counts={counts}
        home={home.href}
        setup={setup}
        quick={quick}
        user={{ name: user.name }}
        portalLabel={portalLabel}
        orgName={orgName}
        roleChip={chip}
        profileHref={profileHref}
        helpHref={helpHref}
        logout={logoutAction}
      />
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
          <header className="hdr flex items-center gap-2 px-3 sm:px-4 lg:px-6">
            <Link href={home.href} className="flex min-w-0 items-center gap-2.5 lg:hidden">
              <LogoMark size={30} className="shrink-0" />
              <span className="min-w-0 leading-tight">
                <b className="block text-[18px] text-ink">دارك</b>
                <span className="block max-w-[44vw] truncate text-[11.5px] text-muted sm:max-w-[300px]">{orgName ?? portalLabel ?? ""}</span>
              </span>
            </Link>
            <NavCrumbs sections={sections} home={home} />
            <div className="mr-auto flex min-w-0 flex-1 items-center justify-end gap-1.5 lg:gap-2">
              <div className="flex min-w-0 justify-end lg:flex-1">
                <SearchTrigger items={flat} searchEnabled={searchEnabled} />
              </div>
              {branches && branches.length > 0 && (
                <div className="hidden items-center gap-1.5 rounded-[10px] border border-line bg-white px-2.5 py-1.5 text-[12.5px] xl:flex">
                  <span className="text-muted">الفرع:</span>
                  <span className="font-bold text-text">{branches.length > 1 ? "كل الفروع" : branches[0].name}</span>
                </div>
              )}
              {quick.length > 0 && (
                <div className="hidden lg:block">
                  <QuickAdd items={quick} />
                </div>
              )}
              {helpHref && (
                <Link href={helpHref} className="icon-btn hidden lg:grid" aria-label="مركز المساعدة" title="مركز المساعدة">
                  <Icon name="help" size={18} />
                </Link>
              )}
              <Link href={notificationsHref} className="icon-btn" aria-label="الإشعارات" title="الإشعارات">
                <Icon name="bell" size={18} />
                {unread > 0 && <span className="nav-badge !-top-1.5 !end-[-6px]">{unread > 99 ? "99+" : unread}</span>}
              </Link>
              <UserMenu name={user.name} roleLabel={chip.label} logout={logoutAction} profileHref={profileHref} />
            </div>
          </header>
        </div>
        <main className="app-main mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 pt-4 sm:px-5 md:pt-6 lg:px-6 lg:pb-10">{children}</main>
      </div>
      <ConfirmForms />
      <Suspense fallback={null}>
        <Toast />
      </Suspense>
    </div>
  );
}
