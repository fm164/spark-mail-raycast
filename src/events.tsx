import { useState } from "react";
import { Action, ActionPanel, Alert, Icon, Keyboard, List, confirmAlert, open, showToast, Toast } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { deleteEvent, describeSparkError, getEvents, rsvpEvent, SparkCliError } from "./lib/spark";
import EventForm from "./event-form";

const SPARK_APP_PATH = "/Applications/Spark Desktop.app";

type Range = "today" | "tomorrow" | "week";

export default function Events() {
  const [range, setRange] = useState<Range>("today");
  const { data, isLoading, error, revalidate } = useCachedPromise(async (r: Range) => getEvents(r), [range]);

  async function rsvp(eventId: string, title: string, status: "accept" | "decline" | "maybe") {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Updating RSVP…" });
    try {
      await rsvpEvent(eventId, status);
      toast.style = Toast.Style.Success;
      toast.title = `RSVP'd ${status}`;
      revalidate();
    } catch (err) {
      toast.hide();
      await showFailureToast(err, { title: describeSparkError(err, `Couldn't RSVP to "${title}"`) });
    }
  }

  async function removeEvent(eventId: string, title: string) {
    const confirmed = await confirmAlert({
      icon: Icon.Trash,
      title: "Delete Event?",
      message: `"${title}" will be removed from your calendar.`,
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const toast = await showToast({ style: Toast.Style.Animated, title: "Deleting…" });
    try {
      await deleteEvent(eventId);
      toast.style = Toast.Style.Success;
      toast.title = "Deleted";
      revalidate();
    } catch (err) {
      toast.hide();
      await showFailureToast(err, { title: describeSparkError(err, `Couldn't delete "${title}"`) });
    }
  }

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
        <List.EmptyView
          icon={Icon.Calendar}
          title="No Events"
          description="No calendar events in this range."
          actions={
            <ActionPanel>
              <Action.Push title="Create Event…" icon={Icon.Plus} target={<EventForm />} />
            </ActionPanel>
          }
        />
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
                    <ActionPanel.Section>
                      <Action.Push title="Create Event…" icon={Icon.Plus} target={<EventForm />} />
                      {event.id && (
                        <ActionPanel.Submenu title="RSVP" icon={Icon.Checkmark}>
                          <Action title="Accept" onAction={() => rsvp(event.id, event.title, "accept")} />
                          <Action title="Maybe" onAction={() => rsvp(event.id, event.title, "maybe")} />
                          <Action title="Decline" onAction={() => rsvp(event.id, event.title, "decline")} />
                        </ActionPanel.Submenu>
                      )}
                    </ActionPanel.Section>
                    <ActionPanel.Section>
                      <Action.CopyToClipboard title="Copy Title" content={event.title} />
                      {event.location && <Action.CopyToClipboard title="Copy Location" content={event.location} />}
                      <Action
                        title="Reload"
                        icon={Icon.ArrowClockwise}
                        shortcut={Keyboard.Shortcut.Common.Refresh}
                        onAction={revalidate}
                      />
                    </ActionPanel.Section>
                    {event.id && (
                      <ActionPanel.Section>
                        <Action
                          title="Delete Event"
                          icon={Icon.Trash}
                          style={Action.Style.Destructive}
                          shortcut={Keyboard.Shortcut.Common.Remove}
                          onAction={() => removeEvent(event.id, event.title)}
                        />
                      </ActionPanel.Section>
                    )}
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
