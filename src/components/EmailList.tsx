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
  useNavigation,
} from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import {
  describeSparkError,
  displayNameFromAddress,
  getSparkDeepLink,
  getThread,
  parseEmailsTable,
  parseFolders,
  runSpark,
  runSparkAction,
  saveAttachment,
  getAttachmentMetadata,
  SparkActionName,
  SparkCliError,
  ThreadResult,
} from "../lib/spark";
import Compose from "../compose";
import { CommentForm } from "./CommentForm";

const SPARK_APP_PATH = "/Applications/Spark Desktop.app";

interface EmailListProps {
  folder: string;
  navigationTitle?: string;
  searchBarPlaceholder?: string;
}

type ThreadCacheEntry =
  { status: "loading" } | { status: "error"; error: unknown } | { status: "done"; thread: ThreadResult };

export function EmailList({ folder, navigationTitle, searchBarPlaceholder }: EmailListProps) {
  const { push } = useNavigation();

  const { data, isLoading, error, revalidate } = useCachedPromise(
    async (f: string) => {
      const output = await runSpark(["emails", f, "--page-size", "50"]);
      return parseEmailsTable(output);
    },
    [folder],
    { keepPreviousData: true },
  );

  const { data: folderGroups } = useCachedPromise(async () => parseFolders(await runSpark(["folders"])), []);

  const [isShowingDetail, setIsShowingDetail] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threadCache, setThreadCache] = useState<Record<string, ThreadCacheEntry>>({});

  function fetchThread(id: string) {
    if (threadCache[id]) return;
    setThreadCache((c) => ({ ...c, [id]: { status: "loading" } }));
    getThread(id).then(
      (thread) => setThreadCache((c) => ({ ...c, [id]: { status: "done", thread } })),
      (err) => setThreadCache((c) => ({ ...c, [id]: { status: "error", error: err } })),
    );
  }

  function onSelectionChange(id: string | null) {
    setSelectedId(id);
    if (!id || !isShowingDetail) return;
    fetchThread(id);
  }

  function toggleDetail() {
    const next = !isShowingDetail;
    setIsShowingDetail(next);
    if (next && selectedId) fetchThread(selectedId);
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
      await showFailureToast(err, { title: describeSparkError(err, `Couldn't open "${subject}" in Spark`) });
    }
  }

  /** Shared runner for every `spark action` triage command — one toast lifecycle, one error-classification path. */
  async function performAction(
    action: SparkActionName,
    id: string,
    titles: { progress: string; success: string; failureFallback: string },
    options?: { date?: Date; folder?: string },
  ) {
    const toast = await showToast({ style: Toast.Style.Animated, title: titles.progress });
    try {
      await runSparkAction(action, id, options);
      toast.style = Toast.Style.Success;
      toast.title = titles.success;
      revalidate();
    } catch (err) {
      toast.hide();
      await showFailureToast(err, { title: describeSparkError(err, titles.failureFallback) });
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
    await performAction("moveToTrash", id, {
      progress: "Moving to Trash…",
      success: "Moved to Trash",
      failureFallback: `Couldn't delete "${subject}"`,
    });
  }

  async function snoozeUntil(id: string, subject: string, date: Date) {
    await performAction(
      "snooze",
      id,
      { progress: "Snoozing…", success: "Snoozed", failureFallback: `Couldn't snooze "${subject}"` },
      { date },
    );
  }

  async function startReply(email: { id: string; subject: string }) {
    const cached = threadCache[email.id];
    const toast =
      cached?.status === "done"
        ? undefined
        : await showToast({ style: Toast.Style.Animated, title: "Loading thread…" });
    try {
      const thread = cached?.status === "done" ? cached.thread : await getThread(email.id);
      const lastMessage = thread.messages[thread.messages.length - 1];
      toast?.hide();
      push(<Compose replyToId={lastMessage?.id ?? email.id} />);
    } catch (err) {
      toast?.hide();
      await showFailureToast(err, { title: describeSparkError(err, `Couldn't load "${email.subject}"`) });
    }
  }

  function startForward(email: { id: string }) {
    push(<Compose forwardId={email.id} />);
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
      await showFailureToast(err, { title: describeSparkError(err, "Couldn't download attachment") });
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
          const isUnread = email.flags.toLowerCase().includes("unread");

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
                  <ActionPanel.Section>
                    <Action
                      title="Open in Spark"
                      icon={Icon.Envelope}
                      onAction={() => openInSpark(email.id, email.subject)}
                    />
                    <Action
                      title="Reply"
                      icon={Icon.Reply}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                      onAction={() => startReply(email)}
                    />
                    <Action
                      title="Forward"
                      icon={Icon.ArrowRight}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                      onAction={() => startForward(email)}
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
                    <Action.Push
                      title="Post Team Comment…"
                      icon={Icon.SpeechBubble}
                      target={<CommentForm messageId={email.id} subject={email.subject} />}
                    />
                  </ActionPanel.Section>

                  <ActionPanel.Section title="Organize">
                    <Action
                      title="Archive"
                      icon={Icon.Tray}
                      shortcut={Keyboard.Shortcut.Common.Edit}
                      onAction={() =>
                        performAction("archive", email.id, {
                          progress: "Archiving…",
                          success: "Archived",
                          failureFallback: `Couldn't archive "${email.subject}"`,
                        })
                      }
                    />
                    <Action
                      title={isUnread ? "Mark as Read" : "Mark as Unread"}
                      icon={isUnread ? Icon.Envelope : Icon.Circle}
                      onAction={() =>
                        performAction(isUnread ? "markAsSeen" : "markAsUnseen", email.id, {
                          progress: isUnread ? "Marking as Read…" : "Marking as Unread…",
                          success: isUnread ? "Marked as Read" : "Marked as Unread",
                          failureFallback: `Couldn't update "${email.subject}"`,
                        })
                      }
                    />
                    <Action.PickDate
                      title="Snooze Until…"
                      icon={Icon.Clock}
                      min={new Date()}
                      onChange={(date) => date && snoozeUntil(email.id, email.subject, date)}
                    />
                    <ActionPanel.Submenu title="Move to Folder" icon={Icon.Folder}>
                      {folderGroups
                        ?.flatMap((group) => group.folders)
                        .map((f) => (
                          <Action
                            key={f.id}
                            title={f.name}
                            onAction={() =>
                              performAction(
                                "moveToFolder",
                                email.id,
                                {
                                  progress: `Moving to ${f.name}…`,
                                  success: `Moved to ${f.name}`,
                                  failureFallback: `Couldn't move "${email.subject}"`,
                                },
                                { folder: f.id },
                              )
                            }
                          />
                        ))}
                    </ActionPanel.Submenu>
                    <ActionPanel.Submenu title="Change Category" icon={Icon.Tag}>
                      <Action
                        title="Personal"
                        onAction={() =>
                          performAction("changeCategoryPersonal", email.id, {
                            progress: "Updating category…",
                            success: "Category changed",
                            failureFallback: `Couldn't update "${email.subject}"`,
                          })
                        }
                      />
                      <Action
                        title="Notification"
                        onAction={() =>
                          performAction("changeCategoryNotification", email.id, {
                            progress: "Updating category…",
                            success: "Category changed",
                            failureFallback: `Couldn't update "${email.subject}"`,
                          })
                        }
                      />
                      <Action
                        title="Newsletter"
                        onAction={() =>
                          performAction("changeCategoryNewsletters", email.id, {
                            progress: "Updating category…",
                            success: "Category changed",
                            failureFallback: `Couldn't update "${email.subject}"`,
                          })
                        }
                      />
                    </ActionPanel.Submenu>
                    <Action
                      title="Mark as Spam"
                      icon={Icon.XMarkCircle}
                      onAction={() =>
                        performAction("markAsSpam", email.id, {
                          progress: "Marking as spam…",
                          success: "Marked as spam",
                          failureFallback: `Couldn't mark "${email.subject}" as spam`,
                        })
                      }
                    />
                    <Action
                      title="Unsubscribe"
                      icon={Icon.CircleDisabled}
                      onAction={() =>
                        performAction("unsubscribe", email.id, {
                          progress: "Unsubscribing…",
                          success: "Unsubscribed",
                          failureFallback: `Couldn't unsubscribe from "${email.subject}"`,
                        })
                      }
                    />
                    <Action
                      title="Move to Trash"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      shortcut={Keyboard.Shortcut.Common.Remove}
                      onAction={() => deleteEmail(email.id, email.subject)}
                    />
                  </ActionPanel.Section>

                  <ActionPanel.Section>
                    <Action.CopyToClipboard title="Copy Subject" content={email.subject} />
                    <Action.CopyToClipboard
                      title="Copy Sender Email"
                      content={email.from}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                    <Action
                      title="Reload"
                      icon={Icon.ArrowClockwise}
                      shortcut={Keyboard.Shortcut.Common.Refresh}
                      onAction={revalidate}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}
