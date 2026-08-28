import { Action, ActionPanel, Detail, Icon, open } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { runSpark, SparkCliError } from "../lib/spark";

const SPARK_APP_PATH = "/Applications/Spark Desktop.app";

interface RawCommandViewProps {
  args: string[];
  navigationTitle: string;
}

/** Renders a spark CLI subcommand's plain-text output as-is — used for commands with no stable, testable table shape yet. */
export function RawCommandView({ args, navigationTitle }: RawCommandViewProps) {
  const { data, isLoading, error, revalidate } = usePromise(async () => runSpark(args), []);

  const isNotInstalled = error instanceof SparkCliError && error.kind === "not-installed";
  const markdown = error
    ? `**${isNotInstalled ? "Spark CLI Not Found" : "Couldn't Load"}**\n\n${error.message}`
    : "```\n" + (data || "No results.") + "\n```";

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={navigationTitle}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action title="Reload" icon={Icon.ArrowClockwise} onAction={revalidate} />
          {isNotInstalled && (
            <Action title="Launch Spark Desktop" icon={Icon.AppWindow} onAction={() => open(SPARK_APP_PATH)} />
          )}
        </ActionPanel>
      }
    />
  );
}
