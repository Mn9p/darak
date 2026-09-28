import type { ReactNode } from "react";
import { Card, Tag, Skeleton } from "@/components/ui";

/**
 * Card for assistant output. `generated` marks text written by the model; otherwise it is built from the same facts
 * by the app itself, so the card always renders. Colour never carries the meaning: the tag says which one it is.
 */
export function AssistantCard({ title = "ملخص المساعد", text, generated, actions, tone = "warm", className = "" }: { title?: string; text: string; generated: boolean; actions?: ReactNode; tone?: "light" | "dark" | "warm"; className?: string }) {
  return (
    <Card
      title={title}
      tone={tone}
      className={className}
      actions={
        <div className="flex items-center gap-2">
          <Tag tone={generated ? "brand" : "neutral"} plain>
            {generated ? "مُعدّ آليًا" : "ملخص تلقائي"}
          </Tag>
          {actions}
        </div>
      }
    >
      <div className="space-y-1.5 text-[14px] leading-7 text-text">
        {text.split("\n").filter(Boolean).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </Card>
  );
}

export function AssistantCardSkeleton({ title = "ملخص المساعد", tone = "warm" }: { title?: string; tone?: "light" | "dark" | "warm" }) {
  return (
    <Card title={title} tone={tone}>
      <Skeleton lines={3} />
    </Card>
  );
}
