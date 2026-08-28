import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPreferenceValues } from "@raycast/api";

const execFileAsync = promisify(execFile);

interface Preferences {
  sparkPath: string;
}

const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export class SparkCliError extends Error {
  kind: "not-installed" | "cli-error";

  constructor(message: string, kind: "not-installed" | "cli-error" = "cli-error") {
    super(message);
    this.name = "SparkCliError";
    this.kind = kind;
  }
}

function getSparkPath(): string {
  const { sparkPath } = getPreferenceValues<Preferences>();
  return sparkPath && sparkPath.trim().length > 0 ? sparkPath.trim() : "/usr/local/bin/spark";
}

export async function runSpark(args: string[]): Promise<string> {
  const sparkPath = getSparkPath();
  try {
    const { stdout, stderr } = await execFileAsync(sparkPath, args, {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    if (stderr?.trim()) {
      console.error(`[spark] stderr: ${stderr.trim()}`);
    }
    return stdout.trim();
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message: string };
    if (e.code === "ENOENT") {
      throw new SparkCliError(
        `Spark CLI not found at "${sparkPath}". Install/enable it from Spark Desktop → Settings → AI Agents → Spark CLI Setup, or fix the path in this extension's preferences.`,
        "not-installed",
      );
    }
    throw new SparkCliError(e.stderr?.trim() || e.message);
  }
}

export interface EmailListItem {
  id: string;
  account: string;
  from: string;
  date: string;
  subject: string;
  flags: string;
}

export interface EmailListResult {
  emails: EmailListItem[];
  summary: string;
  empty: boolean;
}

/**
 * The `spark emails` / `spark search` (list mode) commands print a fixed-width
 * text table. Column order (ID, Account, From, Date, Subject, Flags) is
 * documented and stable, but column widths vary, so offsets are derived from
 * the header row on every call instead of being hardcoded.
 */
export function parseEmailsTable(output: string): EmailListResult {
  const lines = output.split("\n");
  const headerIndex = lines.findIndex((line) => /^\s*ID\s+Account\s+From\s+Date\s+Subject\s+Flags\s*$/.test(line));

  const summaryLine = lines.find((line) => /^Page \d+ of \d+/.test(line.trim())) ?? "";

  if (headerIndex === -1) {
    return { emails: [], summary: summaryLine, empty: true };
  }

  const header = lines[headerIndex];
  const cols = ["ID", "Account", "From", "Date", "Subject", "Flags"] as const;
  const starts = cols.map((col) => header.indexOf(col));

  const emails: EmailListItem[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || /^Page \d+ of \d+/.test(line.trim())) break;

    const slice = (from: number, to: number | undefined) => line.slice(from, to).trim();
    emails.push({
      id: slice(starts[0], starts[1]),
      account: slice(starts[1], starts[2]),
      from: slice(starts[2], starts[3]),
      date: slice(starts[3], starts[4]),
      subject: slice(starts[4], starts[5]),
      flags: slice(starts[5], undefined),
    });
  }

  return { emails, summary: summaryLine, empty: emails.length === 0 };
}

/** Pulls the human-readable display name out of a (possibly truncated) `"Name" <addr>` From field. */
export function displayNameFromAddress(from: string): string {
  const match = from.match(/^"?([^"<]+?)"?\s*<[^>]*>?…?$/);
  return match ? match[1].trim() : from;
}

/** Extracts a `Key: value` style line from spark CLI output (used for Link:, ID: on thread/draft). */
export function extractField(output: string, key: string): string | undefined {
  const match = output.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : undefined;
}

export async function getSparkDeepLink(messageId: string): Promise<string> {
  const output = await runSpark(["thread", messageId]);
  const link = extractField(output, "Link");
  if (!link) {
    throw new SparkCliError(`Could not find a Spark deep link for message ${messageId}.`);
  }
  return link;
}

/** Moves a message to Trash (Spark's `action moveToTrash`) — reversible from the Trash folder. */
export async function moveEmailToTrash(messageId: string): Promise<void> {
  await runSpark(["action", "moveToTrash", messageId]);
}
