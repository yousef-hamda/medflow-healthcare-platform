"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton, useToast } from "@medflow/ui";
import { PageHeader } from "@/components/PageHeader";
import { Field } from "@/components/Field";
import { useMessages, useSendMessage } from "@/lib/api/hooks";
import type { MessageThread } from "@/lib/api/types";
import { formatDateTime } from "@/lib/dates";

export default function MessagesPage() {
  const t = useTranslations("messages");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();
  const messages = useMessages();
  const send = useSendMessage();

  const [activeThreadId, setActiveThreadId] = useState<string | undefined>(undefined);
  const [body, setBody] = useState("");

  const threads: MessageThread[] = messages.data ?? [];
  const activeThread = threads.find((th) => th.id === activeThreadId) ?? threads[0];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    send.mutate(
      { threadId: activeThread?.id, subject: activeThread?.subject ?? t("newThread"), body },
      {
        onSuccess: (thread) => {
          toast({ title: t("sent"), variant: "success" });
          setBody("");
          setActiveThreadId(thread.id);
        },
        onError: () => toast({ title: tCommon("error"), variant: "destructive" }),
      },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {messages.isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : (
        <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t("title")}</CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              {threads.length === 0 ? (
                <p className="px-2 py-4 text-sm text-muted-foreground">{t("empty")}</p>
              ) : (
                <ul className="space-y-1">
                  {threads.map((th) => {
                    const active = th.id === activeThread?.id;
                    return (
                      <li key={th.id}>
                        <button
                          type="button"
                          onClick={() => setActiveThreadId(th.id)}
                          aria-current={active ? "true" : undefined}
                          className={
                            "w-full rounded-md px-3 py-2 text-start text-sm transition-colors " +
                            (active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")
                          }
                        >
                          <span className="block font-medium">{th.subject}</span>
                          <span className="block text-xs text-muted-foreground">{formatDateTime(th.updatedAt, locale)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-h-[24rem] flex-col">
            <CardHeader>
              <CardTitle className="text-base">{activeThread?.subject ?? t("newThread")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="flex-1 space-y-3 overflow-y-auto" aria-live="polite">
                {activeThread && activeThread.messages.length > 0 ? (
                  activeThread.messages.map((m) => (
                    <div key={m.id} className={m.author === "patient" ? "flex justify-end" : "flex justify-start"}>
                      <div
                        className={
                          "max-w-[80%] rounded-2xl px-4 py-2 text-sm " +
                          (m.author === "patient" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")
                        }
                      >
                        <p className="mb-0.5 text-xs font-medium opacity-80">{m.author === "patient" ? t("you") : m.authorName ?? t("from")}</p>
                        <p>{m.body}</p>
                        <p className="mt-1 text-[10px] opacity-70">{formatDateTime(m.sentAt, locale)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState title={t("empty")} />
                )}
              </div>

              <form onSubmit={submit} className="border-t border-border pt-4">
                <Field label={t("compose")}>
                  {({ id }) => (
                    <textarea
                      id={id}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder={t("placeholder")}
                      rows={3}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  )}
                </Field>
                <div className="mt-3 flex justify-end">
                  <Button type="submit" loading={send.isPending} disabled={!body.trim()}>
                    {t("send")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
