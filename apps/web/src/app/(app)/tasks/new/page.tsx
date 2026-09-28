import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { STAFF_ROLES } from "@/lib/constants";
import { PageHeader } from "@/components/ui";
import { TaskForm } from "../TaskForm";
import { createTask } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  assertCan(user, "tasks.manage");
  const sp = await searchParams;
  const assignees = await db.user.findMany({ where: { organizationId: user.organizationId, role: { in: STAFF_ROLES }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="مهمة جديدة" breadcrumbs={[{ label: "المهام", href: "/tasks" }, { label: "مهمة جديدة" }]} />
      <TaskForm action={createTask} assignees={assignees} defaults={{ entityType: sp.entityType, entityId: sp.entityId, entityLabel: sp.entityLabel, assignedToId: sp.assignedToId ?? user.id }} />
    </div>
  );
}
