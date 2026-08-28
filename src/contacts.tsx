import { useEffect, useState } from "react";
import { Action, ActionPanel, Icon, List, open } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { parseContacts, runSpark, SparkCliError } from "./lib/spark";

const SPARK_APP_PATH = "/Applications/Spark Desktop.app";

export default function Contacts() {
  const [text, setText] = useState("");
  const [debouncedText, setDebouncedText] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedText(text), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const { data, isLoading, error, revalidate } = usePromise(
    async (query: string) => {
      if (!query.trim()) return null;
      const output = await runSpark(["contacts", query.trim()]);
      return parseContacts(output);
    },
    [debouncedText],
  );

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
                <Action.CopyToClipboard title="Copy Email" content={contact.email} />
                {contact.name && <Action.CopyToClipboard title="Copy Name" content={contact.name} />}
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
