import { useEffect, useState } from "react";
import { Action, ActionPanel, Icon, LaunchProps, List, open, closeMainWindow, showToast, Toast } from "@raycast/api";
import { createDeeplink, DeeplinkType, showFailureToast, useCachedPromise } from "@raycast/utils";
import { displayNameFromAddress, getSparkDeepLink, searchList, searchTopic, SparkCliError } from "./lib/spark";

export default function Search(props: LaunchProps<{ arguments: Arguments.Search }>) {
  const [text, setText] = useState(props.arguments.query ?? "");
  const [debouncedText, setDebouncedText] = useState(text);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedText(text), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const { data, isLoading, error, revalidate } = useCachedPromise(
    async (query: string) => {
      if (query.trim()) {
        return { mode: "topic" as const, result: await searchTopic(query.trim()) };
      }
      return { mode: "list" as const, result: await searchList() };
    },
    [debouncedText],
    { keepPreviousData: true },
  );

  const quicklink = {
    name: text.trim() ? `Spark Search: ${text.trim()}` : "Spark: Browse Recent Mail",
    link: createDeeplink({ type: DeeplinkType.Extension, command: "search", arguments: { query: text.trim() } }),
  };

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
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchText={text}
      onSearchTextChange={setText}
      searchBarPlaceholder="Search mail by topic, or leave empty to browse recent across all folders…"
      isShowingDetail={data?.mode === "topic"}
    >
      {data?.mode === "list" &&
        (data.result.empty ? (
          <List.EmptyView icon={Icon.Envelope} title="No Emails" description="No recent emails found." />
        ) : (
          data.result.emails.map((email) => (
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
                  <Action.CreateQuicklink quicklink={quicklink} />
                </ActionPanel>
              }
            />
          ))
        ))}
      {data?.mode === "topic" &&
        (data.result.empty ? (
          <List.EmptyView icon={Icon.MagnifyingGlass} title="No Results" description={`No emails matched "${text}".`} />
        ) : (
          <>
            {data.result.results.map((message) => (
              <List.Item
                key={message.id}
                icon={Icon.Envelope}
                title={message.subject || "(no subject)"}
                subtitle={displayNameFromAddress(message.from)}
                detail={
                  <List.Item.Detail
                    markdown={`# ${message.subject || "(no subject)"}\n\n${message.body || "*(no body)*"}`}
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label title="From" text={message.from} />
                        {message.to && <List.Item.Detail.Metadata.Label title="To" text={message.to} />}
                        <List.Item.Detail.Metadata.Label title="Date" text={message.date} />
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={
                  <ActionPanel>
                    <Action
                      title="Open in Spark"
                      icon={Icon.Envelope}
                      onAction={() => openInSpark(message.id, message.subject)}
                    />
                    <Action.CopyToClipboard title="Copy Subject" content={message.subject} />
                    <Action.CreateQuicklink quicklink={quicklink} />
                  </ActionPanel>
                }
              />
            ))}
          </>
        ))}
    </List>
  );
}
