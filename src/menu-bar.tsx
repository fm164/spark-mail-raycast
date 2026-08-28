import { useEffect } from "react";
import { Icon, LaunchType, MenuBarExtra, launchCommand, open } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { displayNameFromAddress, getSparkDeepLink, getUnreadSummary } from "./lib/spark";
import { getSeenIds, markIdsSeen } from "./lib/storage";

export default function MenuBar() {
  const { data, isLoading, revalidate } = useCachedPromise(async () => {
    const summary = await getUnreadSummary(10);
    const seen = await getSeenIds();
    const newIds = summary.emails.filter((email) => !seen.has(email.id)).map((email) => email.id);
    return { summary, newIds };
  }, []);

  const newIdsKey = data?.newIds.join(",") ?? "";
  useEffect(() => {
    if (newIdsKey) markIdsSeen(newIdsKey.split(","));
  }, [newIdsKey]);

  async function openEmail(id: string) {
    try {
      const link = await getSparkDeepLink(id);
      await open(link);
    } catch (err) {
      await showFailureToast(err, { title: "Couldn't open email" });
    }
  }

  const count = data?.summary.count ?? 0;

  return (
    <MenuBarExtra
      icon={Icon.Envelope}
      title={count > 0 ? String(count) : undefined}
      isLoading={isLoading}
      tooltip={count > 0 ? `${count} unread in Spark Inbox` : "No unread mail"}
    >
      <MenuBarExtra.Section title={count > 0 ? `${count} Unread` : "No Unread Mail"}>
        {data?.summary.emails.map((email) => (
          <MenuBarExtra.Item
            key={email.id}
            icon={data.newIds.includes(email.id) ? Icon.CircleFilled : Icon.Envelope}
            title={email.subject || "(no subject)"}
            subtitle={displayNameFromAddress(email.from)}
            onAction={() => openEmail(email.id)}
          />
        ))}
      </MenuBarExtra.Section>
      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Open List Inbox"
          icon={Icon.List}
          onAction={() => launchCommand({ name: "list-inbox", type: LaunchType.UserInitiated })}
        />
        <MenuBarExtra.Item title="Refresh" icon={Icon.ArrowClockwise} onAction={revalidate} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
