import type { QueryClient, QueryKey } from '@tanstack/react-query';
import {
  ZERO_MACROS,
  greetingFor,
  localMinutesOfDay,
  toLocalDate,
  type LocalDate,
  type Macros,
  type TodayResponse,
} from '@synitheia/shared';
import type { WaterResponse } from '../water/waterCache.js';

/**
 * A new day, with yesterday's numbers still on screen.
 *
 * The cache kept on the phone (src/api/queryClient.ts) holds what the screens last showed.
 * Opened offline the next morning, or left open past midnight with no connection, Today
 * would show yesterday's ticks and totals as today's, and a habit ticked yesterday would
 * look done today, so a tap on it would take a tick away. This starts the day's numbers
 * afresh in the cache; the screens refetch the real ones as soon as they can.
 */

interface FoodList {
  items: unknown[];
  daily: { totals: Macros; entryCount: number };
}

function freshDay(day: TodayResponse, localDate: LocalDate, greeting: string): TodayResponse {
  return {
    ...day,
    localDate,
    greeting,
    dailyFlow: {
      percent: 0,
      components: day.dailyFlow.components.map((c) => ({ ...c, percent: 0 })),
    },
    habits: day.habits.map((h) => ({ ...h, todayCount: 0, todayComplete: false })),
    expenses: { ...day.expenses, totalMinor: 0, count: 0 },
    nutrition: { ...day.nutrition, totals: ZERO_MACROS },
    water: { ...day.water, totalMl: 0 },
    timeline: [],
    suggestions: [],
    weeklyFlow: rollWeek(day.weeklyFlow, localDate),
  };
}

/**
 * The chart is the seven days ending today, so a new day joins at the end and the oldest
 * leaves. A cached week that already holds the day only moves its "today" mark.
 */
function rollWeek(days: TodayResponse['weeklyFlow'], localDate: LocalDate): TodayResponse['weeklyFlow'] {
  if (days.some((d) => d.localDate === localDate)) {
    return days.map((d) => ({ ...d, isToday: d.localDate === localDate }));
  }
  return [
    ...days.slice(-6).map((d) => ({ ...d, isToday: false })),
    { localDate, percent: 0, isToday: true },
  ];
}

/** Empty a list of today's entries that was fetched on an earlier day. */
function emptyIfOlder<T>(
  client: QueryClient,
  queryKey: QueryKey,
  today: LocalDate,
  zone: string,
  empty: (list: T) => T,
): boolean {
  const query = client.getQueryCache().find<T>({ queryKey, exact: true });
  const list = query?.state.data;
  if (!query || list === undefined) return false;
  if (toLocalDate(new Date(query.state.dataUpdatedAt), zone) >= today) return false;

  client.setQueryData<T>(queryKey, empty(list));
  return true;
}

/**
 * Bring the cache to today. Returns the queries started afresh, for the caller to refetch.
 * Today's greeting is kept current too, without counting as a refresh.
 */
export function startNewDay(client: QueryClient, zone: string, now: Date = new Date()): QueryKey[] {
  const today = toLocalDate(now, zone);
  const greeting = greetingFor(localMinutesOfDay(now, zone));
  const rolled: QueryKey[] = [];

  const shown = client.getQueryData<TodayResponse>(['today']);
  if (shown && shown.localDate !== today) {
    client.setQueryData<TodayResponse>(['today'], freshDay(shown, today, greeting));
    rolled.push(['today']);
  } else if (shown && shown.greeting !== greeting) {
    client.setQueryData<TodayResponse>(['today'], { ...shown, greeting });
  }

  if (
    emptyIfOlder<WaterResponse>(client, ['water'], today, zone, (w) => ({
      ...w,
      items: [],
      totalMl: 0,
    }))
  ) {
    rolled.push(['water']);
  }
  if (
    emptyIfOlder<FoodList>(client, ['food'], today, zone, (f) => ({
      ...f,
      items: [],
      daily: { totals: ZERO_MACROS, entryCount: 0 },
    }))
  ) {
    rolled.push(['food']);
  }

  return rolled;
}
