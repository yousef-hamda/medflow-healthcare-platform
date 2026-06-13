"use client";

import { Button, EmptyState, Skeleton, useToast } from "@medflow/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { useMessages, useSendMessage } from "@/lib/api/hooks";

export function MessagesTab({ patientId }: { patientId: string }): JSX.Element {
  const t = useTranslations("patient.messages");
  const { toast } = useToast();
  const messages = useMessages(patientId);
  const send = useSendMessage();
  const [body, setBody] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    send.mutate(
      { patientId, body: trimmed },
      {
        onSuccess: () => {
          setBody("");
          toast({ title: t("sent"), variant: "success" });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-3">
        {messages.isLoading ? (
          <>
            <Skeleton className="h-16 w-2/3" />
            <Skeleton className="ms-auto h-16 w-2/3" />
          </>
        ) : messages.data && messages.data.length > 0 ? (
          <ul className="space-y-3">
            {messages.data.map((m) => (
              <li
                key={m.id}
                className={`max-w-[80%] rounded-lg border border-border p-3 ${
                  m.fromMe ? "ms-auto bg-primary/5" : "bg-card"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{m.authorName}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(m.ts).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-sm">{m.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t("empty")} description={t("emptyDesc")} />
        )}
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-border pt-4">
        <label className="flex-1">
          <span className="sr-only">{t("compose")}</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder={t("compose")}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </label>
        <Button type="submit" loading={send.isPending} disabled={!body.trim()}>
          {t("send")}
        </Button>
      </form>
    </div>
  );
}
