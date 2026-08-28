import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { promisify } from "node:util";
import { getPreferenceValues } from "@raycast/api";

const execFileAsync = promisify(execFile);

interface Preferences {
  sparkPath: string;
}

const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export class SparkCliError extends Error {
  kind: "not-installed" | "access-denied" | "cli-error";
  requiredAccess?: "triage" | "send";

  constructor(message: string, kind: SparkCliError["kind"] = "cli-error", requiredAccess?: "triage" | "send") {
    super(message);
    this.name = "SparkCliError";
    this.kind = kind;
    this.requiredAccess = requiredAccess;
  }
}

/**
 * A short, consistent title for mutating-action error toasts. Spark's CLI already
 * reports exactly which access tier is missing (e.g. "account does not have triage
 * access") — surfacing that as the toast title itself, instead of a generic
 * "Couldn't archive/delete/..." per action, tells the user in one glance that this
 * is a plan limitation rather than a bug.
 */
export function describeSparkError(err: unknown, fallbackTitle: string): string {
  if (err instanceof SparkCliError && err.kind === "access-denied") {
    return `Requires Spark Pro (${err.requiredAccess} access) — enable it in Spark Desktop → Settings → AI Agents`;
  }
  return fallbackTitle;
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
    const message = e.stderr?.trim() || e.message;
    const accessMatch = message.match(/(?:does not have|no accounts? have) (triage|send) access/i);
    if (accessMatch) {
      throw new SparkCliError(message, "access-denied", accessMatch[1].toLowerCase() as "triage" | "send");
    }
    throw new SparkCliError(message);
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

export type SparkActionName =
  | "pin"
  | "unpin"
  | "mute"
  | "unmute"
  | "snooze"
  | "unsnooze"
  | "archive"
  | "moveToInbox"
  | "moveToTrash"
  | "moveToFolder"
  | "attachLabel"
  | "detachLabel"
  | "markAsDone"
  | "markAsUndone"
  | "markAsSeen"
  | "markAsUnseen"
  | "markAsSpam"
  | "unsubscribe"
  | "changeCategoryPersonal"
  | "changeCategoryNotification"
  | "changeCategoryNewsletters"
  | "send"
  | "unschedule";

interface SparkActionOptions {
  date?: Date;
  folder?: string;
}

/** Runs `spark action <name> <id...>` — the shared entry point for every message triage action. */
export async function runSparkAction(
  action: SparkActionName,
  messageIds: string | string[],
  options?: SparkActionOptions,
): Promise<void> {
  const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
  const args = ["action", action, ...ids];
  if (options?.date) args.push("--date", options.date.toISOString().slice(0, 16));
  if (options?.folder) args.push("--folder", options.folder);
  await runSpark(args);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface AccountInfo {
  email: string;
  alias: string;
  access: string;
}

/** Parses the `Email Account: <email> "<alias>" (Access: <level>)` header lines from `spark accounts`. */
export function parseAccounts(output: string): AccountInfo[] {
  const accounts: AccountInfo[] = [];
  const re = /^Email Account:\s*(\S+)\s+"([^"]*)"\s+\(Access:\s*([^)]+)\)/gm;
  for (const match of output.matchAll(re)) {
    accounts.push({ email: match[1], alias: match[2], access: match[3].trim() });
  }
  return accounts;
}

export async function getAccounts(): Promise<AccountInfo[]> {
  return parseAccounts(await runSpark(["accounts"]));
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export interface FolderEntry {
  name: string;
  count: number;
  id: string;
}

export interface FolderGroup {
  label: string;
  folders: FolderEntry[];
}

/**
 * `spark folders` prints one blank-line-separated group per account (plus a
 * leading "Unified" group), each line formatted as
 * `  <name>  <count> messages  (<qualified id>)`.
 */
export function parseFolders(output: string): FolderGroup[] {
  const rowRe = /^\s*(.+?)\s{2,}(\d+)\s+messages\s+\(([^)]+)\)\s*$/;
  const groups: FolderGroup[] = [];

  for (const block of output.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;

    const label = lines[0].trim();
    const folders: FolderEntry[] = [];
    for (const line of lines.slice(1)) {
      const match = line.match(rowRe);
      if (match) {
        folders.push({ name: match[1].trim(), count: Number(match[2]), id: match[3].trim() });
      }
    }
    if (folders.length > 0) groups.push({ label, folders });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface ContactEntry {
  name: string;
  email: string;
}

export interface ContactsResult {
  contacts: ContactEntry[];
  summary: string;
  empty: boolean;
}

export function parseContacts(output: string): ContactsResult {
  const lines = output.split("\n");
  const headerIndex = lines.findIndex((line) => /^\s*Name\s+Email\s*$/.test(line));
  const summary = lines.find((line) => /contacts? found/.test(line))?.trim() ?? "";

  if (headerIndex === -1) {
    return { contacts: [], summary, empty: true };
  }

  const header = lines[headerIndex];
  const emailStart = header.indexOf("Email");

  const contacts: ContactEntry[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") break;
    contacts.push({
      name: line.slice(0, emailStart).trim(),
      email: line.slice(emailStart).trim(),
    });
  }

  return { contacts, summary, empty: contacts.length === 0 };
}

// ---------------------------------------------------------------------------
// Threads & search (share the same per-message block format)
// ---------------------------------------------------------------------------

export interface MessageAttachment {
  id: string;
  name: string;
  size: string;
  mimeType: string;
  path: string;
}

export interface MessageBlock {
  id: string;
  subject: string;
  from: string;
  to?: string;
  cc?: string;
  bcc?: string;
  date: string;
  flags?: string;
  body: string;
  attachments: MessageAttachment[];
}

/**
 * Both `spark thread <id>` and `spark search "<topic>"` print one or more
 * messages in the same shape: a contiguous `Key: value` header block (ID,
 * Subject, From, To, CC, BCC, Date, Type, Flags), a blank line, the
 * plain-text body, and an optional `Attachments:` table. Message boundaries
 * are found via the `ID:` line rather than the surrounding dashed rules,
 * since dash-rule presence/placement isn't documented as stable.
 */
function parseMessageBlocks(output: string): MessageBlock[] {
  const lines = output.split("\n");
  const idLineIndices: number[] = [];
  lines.forEach((line, i) => {
    if (/^\s*ID:\s*\S+\s*$/.test(line)) idLineIndices.push(i);
  });

  const messages: MessageBlock[] = [];
  for (let m = 0; m < idLineIndices.length; m++) {
    const start = idLineIndices[m];
    const end = m + 1 < idLineIndices.length ? idLineIndices[m + 1] : lines.length;
    const segLines = lines.slice(start, end);

    let blankIndex = segLines.findIndex((l) => l.trim() === "");
    if (blankIndex === -1) blankIndex = segLines.length;
    const header = segLines.slice(0, blankIndex).join("\n");

    const attachHeaderIndex = segLines.findIndex((l) => /^\s*Attachments:\s*$/.test(l));
    const bodyEnd = attachHeaderIndex === -1 ? segLines.length : attachHeaderIndex;
    const body = segLines
      .slice(blankIndex + 1, bodyEnd)
      .join("\n")
      .trim();

    const attachments: MessageAttachment[] = [];
    if (attachHeaderIndex !== -1) {
      const attachHeader = segLines[attachHeaderIndex + 1] ?? "";
      const cols = ["ID", "Name", "Size", "MIME Type", "Path"];
      const starts = cols.map((c) => attachHeader.indexOf(c));
      if (starts.every((s) => s !== -1)) {
        for (let r = attachHeaderIndex + 2; r < segLines.length; r++) {
          const row = segLines[r];
          if (row.trim() === "") continue;
          const slice = (from: number, to: number | undefined) => row.slice(from, to).trim();
          attachments.push({
            id: slice(starts[0], starts[1]),
            name: slice(starts[1], starts[2]),
            size: slice(starts[2], starts[3]),
            mimeType: slice(starts[3], starts[4]),
            path: slice(starts[4], undefined),
          });
        }
      }
    }

    messages.push({
      id: extractField(header, "ID") ?? "",
      subject: extractField(header, "Subject") ?? "",
      from: extractField(header, "From") ?? "",
      to: extractField(header, "To"),
      cc: extractField(header, "CC"),
      bcc: extractField(header, "BCC"),
      date: extractField(header, "Date") ?? "",
      flags: extractField(header, "Flags"),
      body,
      attachments,
    });
  }

  return messages;
}

export interface ThreadResult {
  subject: string;
  link: string;
  messages: MessageBlock[];
}

export function parseThread(output: string): ThreadResult {
  return {
    subject: extractField(output, "Thread") ?? "",
    link: extractField(output, "Link") ?? "",
    messages: parseMessageBlocks(output),
  };
}

export async function getThread(messageId: string): Promise<ThreadResult> {
  const output = await runSpark(["thread", messageId]);
  return parseThread(output);
}

export async function getSparkDeepLink(messageId: string): Promise<string> {
  const thread = await getThread(messageId);
  if (!thread.link) {
    throw new SparkCliError(`Could not find a Spark deep link for message ${messageId}.`);
  }
  return thread.link;
}

export interface SearchTopicResult {
  summary: string;
  results: MessageBlock[];
  empty: boolean;
}

export async function searchTopic(topic: string, scope?: string): Promise<SearchTopicResult> {
  const args = ["search", topic];
  if (scope) args.push("--in", scope);
  const output = await runSpark(args);
  const summary = output.match(/^\d+ result\(s\).*$/m)?.[0].trim() ?? "";
  const results = parseMessageBlocks(output);
  return { summary, results, empty: results.length === 0 };
}

export async function searchList(filter?: string, scope?: string): Promise<EmailListResult> {
  const args = ["search"];
  if (filter) args.push("--filter", filter);
  if (scope) args.push("--in", scope);
  const output = await runSpark(args);
  return parseEmailsTable(output);
}

// ---------------------------------------------------------------------------
// Calendar events
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  title: string;
  id: string;
  time: string;
  calendar?: string;
  location?: string;
}

export interface EventDay {
  heading: string;
  events: CalendarEvent[];
}

export interface EventsResult {
  header: string;
  days: EventDay[];
  empty: boolean;
}

function parseEventBlock(block: string): CalendarEvent {
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const title = lines[0] ?? "";
  const idIndex = lines.findIndex((l) => /^ID:/.test(l));
  const id = idIndex !== -1 ? lines[idIndex].replace(/^ID:\s*/, "") : "";
  const nextLine = idIndex !== -1 ? lines[idIndex + 1] : undefined;
  const time = nextLine && !/^(Calendar|Location|Attendees):/.test(nextLine) ? nextLine : "";

  return {
    title,
    id,
    time,
    calendar: extractField(block, "Calendar"),
    location: extractField(block, "Location"),
  };
}

export function parseEvents(output: string): EventsResult {
  const header = output.split("\n")[0]?.trim() ?? "";
  const dayHeadingRe = /^──+\s*(.+?)\s*──+\s*$/;

  const lines = output.split("\n");
  const dayStarts: { index: number; heading: string }[] = [];
  lines.forEach((line, i) => {
    const match = line.match(dayHeadingRe);
    if (match) dayStarts.push({ index: i, heading: match[1].trim() });
  });

  const days: EventDay[] = dayStarts.map((day, i) => {
    const end = i + 1 < dayStarts.length ? dayStarts[i + 1].index : lines.length;
    const section = lines.slice(day.index + 1, end).join("\n");
    const events = section
      .split(/\n\s*\n/)
      .filter((block) => !/^\d+\s+event\(s\)\s*$/.test(block.trim()))
      .filter((block) => block.trim().length > 0)
      .map(parseEventBlock);
    return { heading: day.heading, events };
  });

  return { header, days, empty: days.every((d) => d.events.length === 0) };
}

export async function getEvents(range: "today" | "tomorrow" | "week", scope?: string): Promise<EventsResult> {
  const args = ["events", `--${range}`];
  if (scope) args.push("--in", scope);
  const output = await runSpark(args);
  return parseEvents(output);
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface AttachmentMetadata {
  id: string;
  name: string;
  size: string;
  mimeType: string;
}

export async function getAttachmentMetadata(attachmentId: string): Promise<AttachmentMetadata> {
  const output = await runSpark(["attachment", attachmentId]);
  return {
    id: extractField(output, "ID") ?? attachmentId,
    name: extractField(output, "Name") ?? `attachment-${attachmentId}`,
    size: extractField(output, "Size") ?? "",
    mimeType: extractField(output, "MIME Type") ?? "",
  };
}

/** Streams the raw attachment bytes straight to disk (bypasses execFile's buffered stdout/maxBuffer cap). */
export async function saveAttachment(attachmentId: string, destPath: string): Promise<void> {
  const sparkPath = getSparkPath();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(sparkPath, ["attachment", attachmentId, "--stream"]);
    const out = createWriteStream(destPath);
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => reject(new SparkCliError(err.message)));
    child.stdout.pipe(out);
    out.on("error", (err) => reject(new SparkCliError(err.message)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new SparkCliError(stderr.trim() || `spark attachment exited with code ${code}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Unread summary (menu bar + background refresh)
// ---------------------------------------------------------------------------

export interface UnreadSummary {
  count: number;
  emails: EmailListItem[];
}

/** Total is parsed from the `Page X of Y (Z total emails)` footer, not `emails.length`, since the list is capped by `limit`. */
export async function getUnreadSummary(limit = 10): Promise<UnreadSummary> {
  const output = await runSpark(["emails", "Inbox", "--filter", "is:unread", "--page-size", String(limit)]);
  const { emails, summary } = parseEmailsTable(output);
  const total = summary.match(/\((\d+) total emails?\)/)?.[1];
  return { count: total ? Number(total) : emails.length, emails };
}

// ---------------------------------------------------------------------------
// Contact actions
// ---------------------------------------------------------------------------

export type ContactActionName =
  | "acceptContact"
  | "blockContact"
  | "acceptDomain"
  | "blockDomain"
  | "markContactAsImportant"
  | "unmarkContactAsImportant"
  | "markContactAsPrimary"
  | "unmarkContactAsPrimary"
  | "changeCategoryPersonal"
  | "changeCategoryNotification"
  | "changeCategoryNewsletters";

/** Runs `spark contact-action <name> <email...>` — requires triage access. */
export async function runContactAction(action: ContactActionName, emails: string | string[]): Promise<void> {
  const list = Array.isArray(emails) ? emails : [emails];
  await runSpark(["contact-action", action, ...list]);
}

// ---------------------------------------------------------------------------
// Team comments
// ---------------------------------------------------------------------------

/** Posts a team chat comment on a thread — auto-shares the thread with the team if it isn't already shared. Requires triage access. */
export async function postComment(messageId: string, body: string, team?: string): Promise<void> {
  const args = ["comment", messageId, "--body", body];
  if (team) args.push("--team", team);
  await runSpark(args);
}

// ---------------------------------------------------------------------------
// Calendar event mutation
// ---------------------------------------------------------------------------

export interface EventFormFields {
  title: string;
  start: Date;
  end?: Date;
  allDay?: boolean;
  location?: string;
  description?: string;
  calendar?: string;
  attendees?: string[];
}

function isoOrDate(date: Date, allDay?: boolean): string {
  return allDay ? date.toISOString().slice(0, 10) : date.toISOString().slice(0, 16);
}

/** Creates a calendar event — requires send access (inviting attendees emits iTIP mail). */
export async function createEvent(fields: EventFormFields): Promise<string> {
  const args = ["event", "create", "--title", fields.title, "--start", isoOrDate(fields.start, fields.allDay)];
  if (fields.end) args.push("--end", isoOrDate(fields.end, fields.allDay));
  if (fields.allDay) args.push("--all-day");
  if (fields.location) args.push("--location", fields.location);
  if (fields.description) args.push("--description", fields.description);
  if (fields.calendar) args.push("--calendar", fields.calendar);
  if (fields.attendees?.length) args.push("--add", fields.attendees.join(","));
  return runSpark(args);
}

/** RSVPs to a calendar event or invitation email — requires send access. */
export async function rsvpEvent(eventId: string, status: "accept" | "decline" | "maybe"): Promise<void> {
  await runSpark(["event", "rsvp", eventId, status]);
}

/** Deletes a calendar event — requires send access. */
export async function deleteEvent(eventId: string): Promise<void> {
  await runSpark(["event", "delete", eventId]);
}
