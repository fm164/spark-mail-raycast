import { useState } from "react";
import { Action, ActionPanel, Form, Icon, popToRoot, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { createEvent, describeSparkError } from "./lib/spark";

interface EventFormValues {
  title: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  location: string;
  description: string;
  attendees: string;
}

export default function EventForm() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: EventFormValues) {
    if (!values.title.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Add a title" });
      return;
    }
    if (!values.start) {
      await showToast({ style: Toast.Style.Failure, title: "Pick a start date" });
      return;
    }

    setIsLoading(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Creating event…" });
    try {
      await createEvent({
        title: values.title.trim(),
        start: values.start,
        end: values.end ?? undefined,
        allDay: values.allDay,
        location: values.location.trim() || undefined,
        description: values.description.trim() || undefined,
        attendees: values.attendees
          .split(/[,;\n]/)
          .map((a) => a.trim())
          .filter((a) => a.length > 0),
      });
      toast.style = Toast.Style.Success;
      toast.title = "Event created";
      await popToRoot();
    } catch (err) {
      toast.hide();
      await showFailureToast(err, { title: describeSparkError(err, "Couldn't create event") });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Event" icon={Icon.Calendar} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Title" placeholder="Team sync" autoFocus />
      <Form.DatePicker id="start" title="Start" type={Form.DatePicker.Type.DateTime} />
      <Form.DatePicker id="end" title="End" type={Form.DatePicker.Type.DateTime} />
      <Form.Checkbox id="allDay" label="All-day event" defaultValue={false} />
      <Form.TextField id="location" title="Location" placeholder="Room 7, or a video link" />
      <Form.TextArea id="description" title="Description" placeholder="Notes for this event" />
      <Form.TextField id="attendees" title="Attendees" placeholder="alice@example.com, bob@example.com" />
    </Form>
  );
}
