import type { QueryClient } from '@tanstack/react-query';
import type { TodayResponse } from '@synitheia/shared';

/**
 * Water as the screens hold it: the water list, and Today's total.
 *
 * A glass logged or removed shows in both at once, so the Trackers tile and the water
 * screen agree, with or without a connection. Until it reaches the server, the change is
 * only on screen and in the outbox; once it does, both are refetched.
 */

export const WATER_KEY = ['water'] as const;
const TODAY_KEY = ['today'] as const;

export interface WireWaterEntry {
  _id: string;
  amountMl: number;
  loggedAt: string;
}

export interface WaterResponse {
  items: WireWaterEntry[];
  totalMl: number;
  targetMl: number;
}

function addToToday(client: QueryClient, ml: number): void {
  client.setQueryData<TodayResponse>(TODAY_KEY, (current) =>
    current
      ? {
          ...current,
          water: { ...current.water, totalMl: Math.max(0, current.water.totalMl + ml) },
        }
      : current,
  );
}

/** Show a glass in the water list, newest first, and in Today's total. Once per glass. */
export function showGlass(client: QueryClient, entry: WireWaterEntry): void {
  const list = client.getQueryData<WaterResponse>(WATER_KEY);
  if (list?.items.some((item) => item._id === entry._id)) return;

  if (list) {
    client.setQueryData<WaterResponse>(WATER_KEY, {
      ...list,
      items: [entry, ...list.items],
      totalMl: list.totalMl + entry.amountMl,
    });
  }
  addToToday(client, entry.amountMl);
}

/**
 * Take a glass out of both. Returns where it was in the list, to put it back there.
 *
 * With the list not loaded (a glass logged from the Trackers tile), only Today's total
 * held it. With the list loaded, a glass it does not have was never counted.
 */
export function hideGlass(client: QueryClient, entry: WireWaterEntry): number {
  const list = client.getQueryData<WaterResponse>(WATER_KEY);
  if (!list) {
    addToToday(client, -entry.amountMl);
    return 0;
  }
  const index = list.items.findIndex((item) => item._id === entry._id);
  if (index === -1) return 0;

  client.setQueryData<WaterResponse>(WATER_KEY, {
    ...list,
    items: list.items.filter((item) => item._id !== entry._id),
    totalMl: Math.max(0, list.totalMl - entry.amountMl),
  });
  addToToday(client, -entry.amountMl);
  return index;
}

/** Put a glass back where it was, as when a removal is undone or refused. */
export function putGlassBack(client: QueryClient, entry: WireWaterEntry, index: number): void {
  const list = client.getQueryData<WaterResponse>(WATER_KEY);
  if (!list || list.items.some((item) => item._id === entry._id)) return;

  const items = [...list.items];
  items.splice(Math.min(index, items.length), 0, entry);
  client.setQueryData<WaterResponse>(WATER_KEY, {
    ...list,
    items,
    totalMl: list.totalMl + entry.amountMl,
  });
  addToToday(client, entry.amountMl);
}

/** After a change reached the server: fetch what it now holds. */
export function refetchWater(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: WATER_KEY });
  void client.invalidateQueries({ queryKey: TODAY_KEY });
}
