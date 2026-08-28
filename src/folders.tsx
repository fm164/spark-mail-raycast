import { Action, ActionPanel, Icon, Keyboard, List, open } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { EmailList } from "./components/EmailList";
import { parseFolders, runSpark, SparkCliError } from "./lib/spark";

const SPARK_APP_PATH = "/Applications/Spark Desktop.app";

export default function Folders() {
  const { data, isLoading, error, revalidate } = useCachedPromise(async () => {
    const output = await runSpark(["folders"]);
    return parseFolders(output);
  }, []);

  if (error) {
    const isNotInstalled = error instanceof SparkCliError && error.kind === "not-installed";
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title={isNotInstalled ? "Spark CLI Not Found" : "Couldn't Load Folders"}
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
    <List isLoading={isLoading} searchBarPlaceholder="Filter folders…">
      {data?.map((group) => (
        <List.Section key={group.label} title={group.label}>
          {group.folders.map((folder) => (
            <List.Item
              key={folder.id}
              icon={Icon.Folder}
              title={folder.name}
              accessories={[{ text: `${folder.count} messages` }]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Browse Emails"
                    icon={Icon.Envelope}
                    target={<EmailList folder={folder.id} navigationTitle={`${group.label} — ${folder.name}`} />}
                  />
                  <Action.CopyToClipboard title="Copy Folder Identifier" content={folder.id} />
                  <Action
                    title="Reload"
                    icon={Icon.ArrowClockwise}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                    onAction={revalidate}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
