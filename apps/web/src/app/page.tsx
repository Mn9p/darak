import { redirect } from "next/navigation";
import { getCurrentUser, homeForRole } from "@/lib/auth";
import { Landing } from "@/components/landing/Landing";

export const dynamic = "force-dynamic";
export const metadata = { title: "دارك — إدارة أملاكك. بصورة أوضح." };

/** Public landing page; signed-in visitors go straight to their home. */
export default async function Root() {
  const user = await getCurrentUser();
  if (user) redirect(homeForRole(user.role, Boolean(user.organizationId)));
  return <Landing />;
}
