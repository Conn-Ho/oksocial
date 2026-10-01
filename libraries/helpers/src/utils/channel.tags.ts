// 账号标签: the channel list's tag filter and the editor's 按标签选择 work on the channels of
// GET /integrations/list, each with its tags.

export type ChannelTagRef = { id: string; name: string; color?: string | null };
type Tagged = { tags?: ChannelTagRef[]; disabled?: boolean; inBetweenSteps?: boolean };

/** 'all', 'untagged' or a tag id. */
export type ChannelTagFilter = string;

export const TAG_NAME_MAX = 20;

/** How many channels there are, how many carry no tag and how many carry each tag. Pure. */
export const tagCounts = (channels: Tagged[]) => {
  const byTag: Record<string, number> = {};
  let untagged = 0;
  for (const channel of channels) {
    if (!channel.tags?.length) {
      untagged += 1;
    }
    for (const tag of channel.tags ?? []) {
      byTag[tag.id] = (byTag[tag.id] ?? 0) + 1;
    }
  }
  return { all: channels.length, untagged, byTag };
};

/** The channels the filter shows. Pure. */
export const filterByTag = <T extends Tagged>(channels: T[], filter: ChannelTagFilter): T[] =>
  filter === 'all'
    ? channels
    : filter === 'untagged'
      ? channels.filter((c) => !c.tags?.length)
      : channels.filter((c) => c.tags?.some((t) => t.id === filter));

/** The channels of a tag a post can go to (enabled, fully connected). Pure. */
export const channelsWithTag = <T extends Tagged>(channels: T[], tagId: string): T[] =>
  channels.filter((c) => !c.disabled && !c.inBetweenSteps && c.tags?.some((t) => t.id === tagId));

/** A tag name as stored: trimmed, inner spaces collapsed, at most TAG_NAME_MAX characters. Pure. */
export const normalizeTagName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, TAG_NAME_MAX);
