import { useEffect, useState } from "react";
import { Action, ActionPanel, Alert, Icon, List, confirmAlert, open, showToast, Toast } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import {
  ContactActionName,
  describeSparkError,
  parseContacts,
  runContactAction,
  runSpark,
  SparkCliError,
} from "./lib/spark";

const SPARK_APP_PATH = "/Applications/Spark Desktop.app";

export default function Contacts() {
  const [text, setText] = useState("");
  const [debouncedText, setDebouncedText] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedText(text), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const { data, isLoading, error, revalidate } = useCachedPromise(
    async (query: string) => {
      if (!query.trim()) return null;
      const output = await runSpark(["contacts", query.trim()]);
      return parseContacts(output);
    },
    [debouncedText],
    { keepPreviousData: true },
  );

  async function performContactAction(
    action: ContactActionName,
    email: string,
    titles: { progress: string; success: string; failureFallback: string },
  ) {
    const toast = await showToast({ style: Toast.Style.Animated, title: titles.progress });
    try {
      await runContactAction(action, email);
      toast.style = Toast.Style.Success;
      toast.title = titles.success;
    } catch (err) {
      toast.hide();
      await showFailureToast(err, { title: describeSparkError(err, titles.failureFallback) });
    }
  }

  async function blockContact(email: string) {
    const confirmed = await confirmAlert({
      icon: Icon.XMarkCircle,
      title: "Block Contact?",
      message: `Emails from "${email}" will be blocked in Spark.`,
      primaryAction: { title: "Block", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    await performContactAction("blockContact", email, {
      progress: "Blocking…",
      success: "Blocked",
      failureFallback: `Couldn't block "${email}"`,
    });
  }

  if (error) {
    const isNotInstalled = error instanceof SparkCliError && error.kind === "not-installed";
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title={isNotInstalled ? "Spark CLI Not Found" : "Search Failed"}
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
    <List isLoading={isLoading} onSearchTextChange={setText} searchBarPlaceholder="Search contacts by name or email…">
      {!debouncedText.trim() ? (
        <List.EmptyView icon={Icon.Person} title="Search Contacts" description="Type a name or email to search." />
      ) : data?.empty ? (
        <List.EmptyView icon={Icon.Person} title="No Contacts Found" description={data.summary} />
      ) : (
        data?.contacts.map((contact) => (
          <List.Item
            key={contact.email}
            icon={Icon.Person}
            title={contact.name || contact.email}
            subtitle={contact.name ? contact.email : undefined}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  <Action.CopyToClipboard title="Copy Email" content={contact.email} />
                  {contact.name && <Action.CopyToClipboard title="Copy Name" content={contact.name} />}
                </ActionPanel.Section>
                <ActionPanel.Section title="Manage">
                  <Action
                    title="Mark as Important"
                    icon={Icon.Star}
                    onAction={() =>
                      performContactAction("markContactAsImportant", contact.email, {
                        progress: "Updating…",
                        success: "Marked as important",
                        failureFallback: `Couldn't update "${contact.email}"`,
                      })
                    }
                  />
                  <Action
                    title="Mark as Primary"
                    icon={Icon.PersonCircle}
                    onAction={() =>
                      performContactAction("markContactAsPrimary", contact.email, {
                        progress: "Updating…",
                        success: "Marked as primary",
                        failureFallback: `Couldn't update "${contact.email}"`,
                      })
                    }
                  />
                  <Action
                    title="Accept / Unblock"
                    icon={Icon.CheckCircle}
                    onAction={() =>
                      performContactAction("acceptContact", contact.email, {
                        progress: "Updating…",
                        success: "Accepted",
                        failureFallback: `Couldn't accept "${contact.email}"`,
                      })
                    }
                  />
                  <Action
                    title="Block Contact"
                    icon={Icon.XMarkCircle}
                    style={Action.Style.Destructive}
                    onAction={() => blockContact(contact.email)}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
