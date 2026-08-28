import { useState } from "react";
import { Action, ActionPanel, Form, Icon, popToRoot, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { describeSparkError, postComment } from "../lib/spark";

interface CommentFormProps {
  messageId: string;
  subject: string;
}

export function CommentForm({ messageId, subject }: CommentFormProps) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: { body: string }) {
    if (!values.body.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Write a comment" });
      return;
    }

    setIsLoading(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Posting comment…" });
    try {
      await postComment(messageId, values.body.trim());
      toast.style = Toast.Style.Success;
      toast.title = "Comment posted";
      await popToRoot();
    } catch (err) {
      toast.hide();
      await showFailureToast(err, { title: describeSparkError(err, "Couldn't post comment") });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Post Comment" icon={Icon.SpeechBubble} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description
        title={subject || "(no subject)"}
        text="Posts a team chat comment on this thread. If the thread isn't already shared with a team, Spark shares it automatically."
      />
      <Form.TextArea id="body" title="Comment" placeholder="Looks good, let's proceed." autoFocus />
    </Form>
  );
}
