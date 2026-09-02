/** Shared SWR fetcher: GET a URL, parse JSON, throw on a non-OK response so SWR's error state fires. */
export async function jsonFetcher<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}
