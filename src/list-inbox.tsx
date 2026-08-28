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
import { showFailureToast, usePromise } from "@raycast/utils";
import {
  displayNameFromAddress,
  getSparkDeepLink,
  moveEmailToTrash,
  parseEmailsTable,
  runSpark,
  SparkCliError,
} from "./lib/spark";

const SPARK_APP_PATH = "/Applications/Spark Desktop.app";

export default function ListInbox() {
  const { data, isLoading, error, revalidate } = usePromise(async () => {
    const output = await runSpark(["emails", "Inbox", "--page-size", "50"]);
    return parseEmailsTable(output);
  }, []);

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

  if (error) {
    const isNotInstalled = error instanceof SparkCliError && error.kind === "not-installed";
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title={isNotInstalled ? "Spark CLI Not Found" : "Couldn't Load Inbox"}
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
    <List isLoading={isLoading} searchBarPlaceholder="Filter inbox by subject or sender…">
      {data?.empty ? (
        <List.EmptyView icon={Icon.Envelope} title="Inbox Is Empty" description="No emails found in your inbox." />
      ) : (
        data?.emails.map((email) => (
          <List.Item
            key={email.id}
            icon={Icon.Envelope}
            title={email.subject || "(no subject)"}
            subtitle={displayNameFromAddress(email.from)}
            accessories={[...(email.flags ? [{ tag: email.flags }] : []), { text: email.date }]}
            actions={
              <ActionPanel>
                <Action
                  title="Open in Spark"
                  icon={Icon.Envelope}
                  onAction={() => openInSpark(email.id, email.subject)}
                />
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
        ))
      )}
    </List>
  );
}
