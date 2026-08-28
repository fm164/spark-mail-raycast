# Spark Mail for Raycast

A [Raycast](https://raycast.com) extension for [Spark Mail](https://sparkmailapp.com) — browse your inbox, search, triage, and compose without leaving Raycast.

It works by shelling out to Spark's own official local CLI (`spark`, installed via Spark Desktop) — the same automation surface Spark's Claude Desktop integration uses. There's no scraping of Spark's internal storage and no separate API/auth to configure.

## Commands

| Command | What it does |
|---|---|
| **List Inbox** | Browse the unified inbox, with a toggleable reading pane and full triage actions |
| **Compose New Email** | Draft a new email, reply, or forward, and open it in Spark |
| **Browse Folders** | Every account's folders/labels with message counts, drilling into any folder |
| **Search Mail** | Keyword + semantic topic search with full bodies, or browse recent mail across all folders |
| **Search Contacts** | Look up contacts by name or email, with block/accept/priority actions |
| **Calendar Events** | Today/Tomorrow/Week view, create events, RSVP |
| **Find Availability** | Free-slot finder, your own or mutual with attendees |
| **Browse Templates** | List saved Spark message templates |
| **Team Info** | Team metadata, members, shared inboxes |
| **Meeting Notes** | List Spark meeting transcripts |
| **Spark Menu Bar** | Persistent unread-count badge with a dropdown of recent unread emails |
| **Refresh Unread Count** | Background command keeping a live unread count in Raycast's root list |

List Inbox and Folders also support Reply, Forward, Archive, Mark Read/Unread, Snooze, Move to Folder, Change Category, Unsubscribe, Mark as Spam, Move to Trash, Post Team Comment, and attachment downloads.

## Requirements

- macOS with [Spark Desktop](https://sparkmailapp.com) installed and running
- The Spark CLI enabled: **Spark Desktop → Settings → AI Agents → Spark CLI Setup**
- [Raycast](https://raycast.com)

Some actions — composing drafts, replying, archiving, snoozing, moving mail, contact management, and calendar mutations — require **triage** or **send** access, which Spark grants per-account under **Settings → AI Agents**. On the free tier, accounts default to read-only; those actions will surface a clear "Requires Spark Pro" message until the account is upgraded. Everything else (browsing, search, contacts lookup, events, availability, templates, team, meetings) works read-only.

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts Raycast's dev server and imports the extension locally so you can try it immediately.

```bash
npm run build   # type-checks and bundles all commands
npm run lint     # ESLint + Prettier via ray lint
npm run fix-lint # auto-fix lint/format issues
```

## Preferences

- **Spark CLI Path** — path to the `spark` binary. Defaults to `/usr/local/bin/spark`, where Spark CLI Setup installs it.

## How it talks to Spark

`src/lib/spark.ts` wraps the `spark` CLI via `execFile`, parsing its plain-text table/block output into typed data (folder listings, email tables, thread bodies, calendar events, etc. — column offsets are derived from each command's header row rather than hardcoded, since widths vary between CLI versions). Mutating actions run through `spark action <name>`, `spark contact-action`, `spark comment`, `spark draft`, and `spark event`, with access-tier errors ("does not have triage/send access") classified and surfaced as a consistent message across every command.
