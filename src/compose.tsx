import { useState } from "react";
import { Action, ActionPanel, Form, Icon, closeMainWindow, open, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { extractField, runSpark } from "./lib/spark";

interface ComposeFormValues {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0);
}

export default function Compose() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: ComposeFormValues) {
    const to = splitAddresses(values.to);
    if (to.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "Add at least one recipient" });
      return;
    }
    if (!values.body.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Write a message body" });
      return;
    }

    setIsLoading(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Creating draft…" });
    try {
      const args = ["draft"];
      for (const addr of to) args.push("--to", addr);
      for (const addr of splitAddresses(values.cc)) args.push("--cc", addr);
      for (const addr of splitAddresses(values.bcc)) args.push("--bcc", addr);
      if (values.subject.trim()) args.push("--subject", values.subject.trim());
      args.push("--body", values.body);

      const output = await runSpark(args);
      const link = extractField(output, "Link");

      toast.style = Toast.Style.Success;
      toast.title = "Draft created";

      if (link) {
        await open(link);
        await closeMainWindow();
      }
    } catch (err) {
      toast.hide();
      await showFailureToast(err, { title: "Couldn't create draft" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Draft in Spark" icon={Icon.Envelope} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="to" title="To" placeholder="alice@example.com, bob@example.com" autoFocus />
      <Form.TextField id="cc" title="Cc" placeholder="carol@example.com" />
      <Form.TextField id="bcc" title="Bcc" placeholder="" />
      <Form.TextField id="subject" title="Subject" placeholder="Subject" />
      <Form.TextArea id="body" title="Body" placeholder="Write your message… (markdown supported)" enableMarkdown />
    </Form>
  );
}
