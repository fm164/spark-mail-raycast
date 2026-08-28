import { EmailList } from "./components/EmailList";

export default function ListInbox() {
  return <EmailList folder="Inbox" searchBarPlaceholder="Filter inbox by subject or sender…" />;
}
