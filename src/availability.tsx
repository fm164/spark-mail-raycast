import { useState } from "react";
import { Action, ActionPanel, Detail, Form, Icon, useNavigation } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { runSpark } from "./lib/spark";

type Range = "today" | "tomorrow" | "week";

interface AvailabilityFormValues {
  attendees: string;
  range: Range;
}

function ResultsView({ output }: { output: string }) {
  return <Detail markdown={"```\n" + output + "\n```"} />;
}

export default function Availability() {
  const { push } = useNavigation();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: AvailabilityFormValues) {
    setIsLoading(true);
    try {
      const args = ["availability", `--${values.range}`];
      const attendees = values.attendees
        .split(/[,;\n]/)
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      if (attendees.length > 0) args.push("--attendees", attendees.join(","));

      const output = await runSpark(args);
      push(<ResultsView output={output} />);
    } catch (err) {
      await showFailureToast(err, { title: "Couldn't find availability" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Find Availability" icon={Icon.Clock} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="attendees"
        title="Attendees"
        placeholder="alice@example.com, bob@example.com — leave empty for your own free slots"
      />
      <Form.Dropdown id="range" title="Range" defaultValue="today">
        <Form.Dropdown.Item title="Today" value="today" />
        <Form.Dropdown.Item title="Tomorrow" value="tomorrow" />
        <Form.Dropdown.Item title="This Week" value="week" />
      </Form.Dropdown>
    </Form>
  );
}
