import { useState } from "react";
import { Action, ActionPanel, Icon, Keyboard, List, open } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getEvents, SparkCliError } from "./lib/spark";

const SPARK_APP_PATH = "/Applications/Spark Desktop.app";

type Range = "today" | "tomorrow" | "week";

export default function Events() {
  const [range, setRange] = useState<Range>("today");
  const { data, isLoading, error, revalidate } = usePromise(async (r: Range) => getEvents(r), [range]);

  if (error) {
    const isNotInstalled = error instanceof SparkCliError && error.kind === "not-installed";
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title={isNotInstalled ? "Spark CLI Not Found" : "Couldn't Load Events"}
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
      searchBarAccessory={
        <List.Dropdown tooltip="Range" value={range} onChange={(value) => setRange(value as Range)}>
          <List.Dropdown.Item title="Today" value="today" />
          <List.Dropdown.Item title="Tomorrow" value="tomorrow" />
          <List.Dropdown.Item title="This Week" value="week" />
        </List.Dropdown>
      }
    >
      {data?.empty ? (
        <List.EmptyView icon={Icon.Calendar} title="No Events" description="No calendar events in this range." />
      ) : (
        data?.days.map((day) => (
          <List.Section key={day.heading} title={day.heading}>
            {day.events.map((event, index) => (
              <List.Item
                key={event.id || `${day.heading}-${index}`}
                icon={Icon.Calendar}
                title={event.title}
                subtitle={event.time}
                accessories={event.calendar ? [{ text: event.calendar }] : undefined}
                actions={
                  <ActionPanel>
                    <Action.CopyToClipboard title="Copy Title" content={event.title} />
                    {event.location && <Action.CopyToClipboard title="Copy Location" content={event.location} />}
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
        ))
      )}
    </List>
  );
}
