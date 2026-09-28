import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { STAFF_ROLES } from "@/lib/constants";
import { PageHeader } from "@/components/ui";
import { TaskForm } from "../../TaskForm";
import { updateTask } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  assertCan(user, "tasks.manage");
  const { id } = await params;
  const org = user.organizationId;
  const task = await db.task.findFirst({ where: { id, organizationId: org } });
  if (!task) notFound();
  const assignees = await db.user.findMany({ where: { organizationId: org, role: { in: STAFF_ROLES }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const plain = JSON.parse(JSON.stringify(task));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="تعديل المهمة" breadcrumbs={[{ label: "المهام", href: "/tasks" }, { label: task.title, href: `/tasks/${id}` }, { label: "تعديل" }]} />
      <TaskForm action={updateTask} task={plain} assignees={assignees} />
    </div>
  );
}
