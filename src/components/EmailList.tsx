import { homedir } from "node:os";
import { join } from "node:path";
import { useState } from "react";
import {
  Action,
  ActionPanel,
  Alert,
  Icon,
  List,
  open,
  closeMainWindow,
  confirmAlert,
  showToast,
  Toast,
  Keyboard,
} from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import {
  displayNameFromAddress,
  getSparkDeepLink,
  getThread,
  moveEmailToTrash,
  parseEmailsTable,
  runSpark,
  saveAttachment,
  getAttachmentMetadata,
  snoozeEmail,
  SparkCliError,
  ThreadResult,
} from "../lib/spark";

const SPARK_APP_PATH = "/Applications/Spark Desktop.app";

interface EmailListProps {
  folder: string;
  navigationTitle?: string;
  searchBarPlaceholder?: string;
}

type ThreadCacheEntry =
  { status: "loading" } | { status: "error"; error: unknown } | { status: "done"; thread: ThreadResult };

export function EmailList({ folder, navigationTitle, searchBarPlaceholder }: EmailListProps) {
  const { data, isLoading, error, revalidate } = useCachedPromise(
    async (f: string) => {
      const output = await runSpark(["emails", f, "--page-size", "50"]);
      return parseEmailsTable(output);
    },
    [folder],
    { keepPreviousData: true },
  );

  const [isShowingDetail, setIsShowingDetail] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threadCache, setThreadCache] = useState<Record<string, ThreadCacheEntry>>({});

  function onSelectionChange(id: string | null) {
    setSelectedId(id);
    if (!id || threadCache[id] || !isShowingDetail) return;
    setThreadCache((c) => ({ ...c, [id]: { status: "loading" } }));
    getThread(id).then(
      (thread) => setThreadCache((c) => ({ ...c, [id]: { status: "done", thread } })),
      (err) => setThreadCache((c) => ({ ...c, [id]: { status: "error", error: err } })),
    );
  }

  function toggleDetail() {
    const next = !isShowingDetail;
    setIsShowingDetail(next);
    if (next && selectedId) onSelectionChange(selectedId);
  }

  async function openInSpark(id: string, subject: string) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Opening in Spark…" });
    try {
      const link = await getSparkDeepLink(id);
      await open(link);
      await closeMainWindow();
      toast.hide();
    } catch (err) {
      toast.hide();
      await showFailureToast(err, { title: `Couldn't open "${subject}" in Spark` });
    }
  }

  async function deleteEmail(id: string, subject: string) {
    const confirmed = await confirmAlert({
      icon: Icon.Trash,
      title: "Move Email to Trash?",
      message: `"${subject || "(no subject)"}" will be moved to Trash in Spark.`,
      primaryAction: { title: "Move to Trash", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const toast = await showToast({ style: Toast.Style.Animated, title: "Moving to Trash…" });
    try {
      await moveEmailToTrash(id);
      toast.style = Toast.Style.Success;
      toast.title = "Moved to Trash";
      revalidate();
    } catch (err) {
      toast.hide();
      await showFailureToast(err, { title: `Couldn't delete "${subject}"` });
    }
  }

  async function snoozeUntil(id: string, subject: string, date: Date) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Snoozing…" });
    try {
      await snoozeEmail(id, date);
      toast.style = Toast.Style.Success;
      toast.title = "Snoozed";
      revalidate();
    } catch (err) {
      toast.hide();
      await showFailureToast(err, { title: `Couldn't snooze "${subject}"` });
    }
  }

  async function downloadAttachment(attachmentId: string) {
    try {
      const meta = await getAttachmentMetadata(attachmentId);
      const confirmed = await confirmAlert({
        icon: Icon.Download,
        title: "Download Attachment?",
        message: `"${meta.name}" (${meta.size || "unknown size"}) will be saved to your Downloads folder.`,
        primaryAction: { title: "Download" },
      });
      if (!confirmed) return;

      const toast = await showToast({ style: Toast.Style.Animated, title: `Downloading ${meta.name}…` });
      const destPath = join(homedir(), "Downloads", meta.name);
      await saveAttachment(attachmentId, destPath);
      toast.style = Toast.Style.Success;
      toast.title = "Downloaded";
      toast.message = destPath;
    } catch (err) {
      await showFailureToast(err, { title: "Couldn't download attachment" });
    }
  }

  if (error) {
    const isNotInstalled = error instanceof SparkCliError && error.kind === "not-installed";
    return (
      <List navigationTitle={navigationTitle}>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title={isNotInstalled ? "Spark CLI Not Found" : "Couldn't Load Emails"}
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={revalidate} />
              <Action title="Launch Spark Desktop" icon={Icon.AppWindow} onAction={() => open(SPARK_APP_PATH)} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoading}
      navigationTitle={navigationTitle}
      searchBarPlaceholder={searchBarPlaceholder ?? "Filter by subject or sender…"}
      isShowingDetail={isShowingDetail}
      onSelectionChange={onSelectionChange}
    >
      {data?.empty ? (
        <List.EmptyView icon={Icon.Envelope} title="No Emails" description="No emails found in this folder." />
      ) : (
        data?.emails.map((email) => {
          const cached = threadCache[email.id];
          const message = cached?.status === "done" ? cached.thread.messages.find((m) => m.id === email.id) : undefined;

          return (
            <List.Item
              key={email.id}
              id={email.id}
              icon={Icon.Envelope}
              title={email.subject || "(no subject)"}
              subtitle={isShowingDetail ? undefined : displayNameFromAddress(email.from)}
              accessories={
                isShowingDetail ? undefined : [...(email.flags ? [{ tag: email.flags }] : []), { text: email.date }]
              }
              detail={
                <List.Item.Detail
                  isLoading={cached?.status === "loading"}
                  markdown={
                    cached?.status === "error"
                      ? `**Couldn't load this email.**\n\n${(cached.error as Error).message ?? ""}`
                      : message
                        ? `# ${message.subject || "(no subject)"}\n\n${message.body || "*(no body)*"}`
                        : undefined
                  }
                  metadata={
                    message ? (
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label title="From" text={message.from} />
                        {message.to && <List.Item.Detail.Metadata.Label title="To" text={message.to} />}
                        <List.Item.Detail.Metadata.Label title="Date" text={message.date} />
                        {message.attachments.length > 0 && (
                          <>
                            <List.Item.Detail.Metadata.Separator />
                            {message.attachments.map((a) => (
                              <List.Item.Detail.Metadata.Label key={a.id} title={a.name} text={a.size} />
                            ))}
                          </>
                        )}
                      </List.Item.Detail.Metadata>
                    ) : undefined
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action
                    title="Open in Spark"
                    icon={Icon.Envelope}
                    onAction={() => openInSpark(email.id, email.subject)}
                  />
                  <Action
                    title={isShowingDetail ? "Hide Reading Pane" : "Show Reading Pane"}
                    icon={Icon.Sidebar}
                    shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
                    onAction={toggleDetail}
                  />
                  {message?.attachments.map((a) => (
                    <Action
                      key={a.id}
                      title={`Download "${a.name}"`}
                      icon={Icon.Download}
                      onAction={() => downloadAttachment(a.id)}
                    />
                  ))}
                  <Action.CopyToClipboard title="Copy Subject" content={email.subject} />
                  <Action.CopyToClipboard
                    title="Copy Sender Email"
                    content={email.from}
                    shortcut={Keyboard.Shortcut.Common.Copy}
                  />
                  <Action.PickDate
                    title="Snooze Until…"
                    icon={Icon.Clock}
                    min={new Date()}
                    onChange={(date) => date && snoozeUntil(email.id, email.subject, date)}
                  />
                  <Action
                    title="Reload"
                    icon={Icon.ArrowClockwise}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                    onAction={revalidate}
                  />
                  <Action
                    title="Move to Trash"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={Keyboard.Shortcut.Common.Remove}
                    onAction={() => deleteEmail(email.id, email.subject)}
                  />
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}
