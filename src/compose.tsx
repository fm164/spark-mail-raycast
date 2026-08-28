import { useState } from "react";
import { Action, ActionPanel, Form, Icon, closeMainWindow, open, showToast, Toast } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { describeSparkError, extractField, getAccounts, runSpark } from "./lib/spark";

interface ComposeFormValues {
  account: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

interface ComposeProps {
  replyToId?: string;
  forwardId?: string;
}

function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0);
}

export default function Compose({ replyToId, forwardId }: ComposeProps = {}) {
  const [isLoading, setIsLoading] = useState(false);
  const { data: accounts } = useCachedPromise(getAccounts, []);

  const mode = replyToId ? "reply" : forwardId ? "forward" : "new";

  async function handleSubmit(values: ComposeFormValues) {
    const to = splitAddresses(values.to);
    // A reply doesn't need an explicit recipient — Spark addresses it from the original thread.
    if (to.length === 0 && mode !== "reply") {
      await showToast({ style: Toast.Style.Failure, title: "Add at least one recipient" });
      return;
    }
    if (!values.body.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Write a message body" });
      return;
    }

    setIsLoading(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: mode === "reply" ? "Creating reply…" : mode === "forward" ? "Creating forward…" : "Creating draft…",
    });
    try {
      const args = ["draft"];
      if (replyToId) args.push("--reply-to", replyToId);
      if (forwardId) args.push("--forward", forwardId);
      if (values.account) args.push("--account", values.account);
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
      await showFailureToast(err, { title: describeSparkError(err, "Couldn't create draft") });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={
              mode === "reply"
                ? "Send Reply to Spark"
                : mode === "forward"
                  ? "Forward in Spark"
                  : "Create Draft in Spark"
            }
            icon={Icon.Envelope}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      {mode !== "new" && (
        <Form.Description
          title={mode === "reply" ? "Replying" : "Forwarding"}
          text={
            mode === "reply"
              ? "Leave To empty to reply to everyone on the original thread, or add recipients to redirect it."
              : "Add who you're forwarding this to below."
          }
        />
      )}
      {accounts && accounts.length > 1 && (
        <Form.Dropdown id="account" title="From" defaultValue="">
          <Form.Dropdown.Item title="Default Account" value="" />
          {accounts.map((account) => (
            <Form.Dropdown.Item
              key={account.email}
              title={`${account.alias} (${account.email})`}
              value={account.email}
            />
          ))}
        </Form.Dropdown>
      )}
      <Form.TextField
        id="to"
        title="To"
        placeholder={
          mode === "reply" ? "Optional — defaults to the original thread" : "alice@example.com, bob@example.com"
        }
        autoFocus
      />
      <Form.TextField id="cc" title="Cc" placeholder="carol@example.com" />
      <Form.TextField id="bcc" title="Bcc" placeholder="" />
      <Form.TextField id="subject" title="Subject" placeholder="Subject" />
      <Form.TextArea id="body" title="Body" placeholder="Write your message… (markdown supported)" enableMarkdown />
    </Form>
  );
}
