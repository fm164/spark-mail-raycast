import { LaunchType, environment, launchCommand, updateCommandMetadata } from "@raycast/api";
import { getUnreadSummary } from "./lib/spark";

export default async function RefreshUnreadCount() {
  try {
    const { count } = await getUnreadSummary(1);
    await updateCommandMetadata({ subtitle: count > 0 ? `${count} unread` : null });
  } catch {
    await updateCommandMetadata({ subtitle: null });
  }

  if (environment.launchType === LaunchType.UserInitiated) {
    await launchCommand({ name: "list-inbox", type: LaunchType.UserInitiated });
  }
}
