import client from "./redis-cache.ts";

const OCCUPANCY_PREFIX = "Occupancy:";

/**
 * Clears every cached occupancy window for a property.
 *
 * Redis DEL matches keys literally — it does not accept glob patterns — so the
 * keys must be enumerated with SCAN first. Passing a pattern straight to DEL
 * silently deletes nothing.
 */
export async function deleteOccupancyCache(propertyId: string): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await client.scan(
      cursor,
      "MATCH",
      `${OCCUPANCY_PREFIX}${propertyId}:*`,
      "COUNT",
      100,
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } while (cursor !== "0");
}
