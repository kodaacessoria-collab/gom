// Fetch every page before returning so callers never use a partial inventory.
export async function readAllRows<T>(
  fetchPage: (first: number, last: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (let first = 0; ; first += pageSize) {
    const { data, error } = await fetchPage(first, first + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
