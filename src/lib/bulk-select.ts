/** Feeds a "Select all in group" dropdown from either the live invitees table (InviteeRow[],
 * grouped by group_id) or an upload preview's rows (MappedInviteeRow[], grouped by the raw
 * groupName string since no group exists yet at preview time) — the caller supplies which. */
export function groupCounts<T>(rows: T[], groupNameOf: (row: T) => string | null | undefined): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = groupNameOf(row);
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}
