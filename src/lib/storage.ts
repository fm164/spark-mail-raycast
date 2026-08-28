import { LocalStorage } from "@raycast/api";

const SEEN_IDS_KEY = "seenUnreadIds";
const MAX_SEEN_IDS = 300;

/** IDs of unread emails the menu bar has already shown, so newly-arrived ones can be highlighted. */
export async function getSeenIds(): Promise<Set<string>> {
  const raw = await LocalStorage.getItem<string>(SEEN_IDS_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export async function markIdsSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const seen = await getSeenIds();
  ids.forEach((id) => seen.add(id));
  const trimmed = Array.from(seen).slice(-MAX_SEEN_IDS);
  await LocalStorage.setItem(SEEN_IDS_KEY, JSON.stringify(trimmed));
}
