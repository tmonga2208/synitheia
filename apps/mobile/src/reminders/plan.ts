import {
  formatHabitProgress,
  formatHabitTarget,
  formatMoney,
  formatVolume,
  measureOf,
  type Minor,
  type ReminderKind,
  type TodayResponse,
} from '@synitheia/shared';
import type { WireReminder } from '../api/types.js';

/**
 * Every reminder the app shows, planned in one place.
 *
 * Reminders used to be repeating notifications with fixed words ("A gentle nudge from
 * Synítheia"), set once when created. A repeating notification cannot know how the day is
 * going, so it said nothing useful and still fired after the water target was met. Instead,
 * each occurrence over the next two weeks is planned as its own dated notification, worded
 * from what is known about that day, and the plan is redone whenever something is logged.
 *
 * Pure: the scheduler (schedule.ts) fetches, plans with this, and hands the result to the OS.
 */

export type ReminderRoute = '/' | '/water' | '/nutrition' | '/expenses/new';

/** Carried by every notification planned here, so it can be found, replaced and routed. */
export interface ReminderNotificationData extends Record<string, unknown> {
  source: 'synitheia-reminder';
  kind: ReminderKind;
  /** The server's reminder, or null for a habit's own reminder time. */
  reminderId: string | null;
  habitId: string | null;
  /** Where a tap goes: the screen where the thing it is about gets done. */
  route: ReminderRoute;
}

export interface PlannedNotification {
  identifier: string;
  /** When it fires, in the phone's own time, which is the time the user picked. */
  date: Date;
  title: string;
  /** Empty for a custom reminder, whose label says everything. */
  body: string;
  data: ReminderNotificationData;
}

export interface PlanInput {
  now: Date;
  reminders: WireReminder[];
  /** Today's numbers and habits. Habits carry their own reminder times. */
  today: TodayResponse | null;
  currency: string;
  horizonDays?: number;
  maxNotifications?: number;
}

const HORIZON_DAYS = 14;

/** iOS keeps only the soonest 64 local notifications. Four are left for suggestions. */
const MAX_NOTIFICATIONS = 60;

const ROUTES: Record<ReminderKind, ReminderRoute> = {
  water: '/water',
  food: '/nutrition',
  expense: '/expenses/new',
  habit: '/',
  custom: '/',
};

type TodayHabit = TodayResponse['habits'][number];

interface Source {
  key: string;
  kind: ReminderKind;
  title: string;
  time: string;
  /** 0 = Monday … 6 = Sunday. Empty means every day. */
  weekdays: readonly number[];
  reminderId: string | null;
  habitId: string | null;
}

/** What is known about a day when its reminder fires. */
interface DayState {
  habits: TodayHabit[];
  waterMl: number;
  waterTargetMl: number | null;
  kcal: number;
  kcalTarget: number | null;
  spentMinor: number;
  spentCount: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDateOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sourcesOf(reminders: WireReminder[], today: TodayResponse | null): Source[] {
  const fromReminders = reminders
    .filter((r) => r.enabled)
    .map<Source>((r) => ({
      key: r._id,
      kind: r.kind,
      title: r.label,
      time: r.time,
      weekdays: r.weekdays,
      reminderId: r._id,
      habitId: r.kind === 'habit' ? (r.refId ?? null) : null,
    }));

  // A habit's reminder time is kept on the habit, on the server. Planning from it here is
  // what brings those reminders back on a new phone; archived habits are not in Today.
  const fromHabits = (today?.habits ?? [])
    .filter((h) => h.reminderTime)
    .map<Source>((h) => ({
      key: `habit-${h.id}`,
      kind: 'habit',
      title: h.name,
      time: h.reminderTime!,
      weekdays: [],
      reminderId: null,
      habitId: h.id,
    }));

  return [...fromReminders, ...fromHabits];
}

/**
 * Today's numbers for the day the account calls today; an empty day for every other.
 *
 * Every log re-plans, so a later day's words stay true for everything logged on this phone.
 * The account's day, not the phone's, decides which day is "today": while travelling they
 * can differ, and a full glass of water on the 25th says nothing about the 26th.
 */
function stateFor(day: string, today: TodayResponse | null): DayState {
  if (today && day === today.localDate) {
    return {
      habits: today.habits,
      waterMl: today.water.totalMl,
      waterTargetMl: today.water.targetMl,
      kcal: today.nutrition.totals.calories,
      kcalTarget: today.nutrition.calorieTarget,
      spentMinor: today.expenses.totalMinor,
      spentCount: today.expenses.count,
    };
  }

  return {
    habits: (today?.habits ?? []).map((h) => ({ ...h, todayCount: 0, todayComplete: false })),
    waterMl: 0,
    waterTargetMl: today?.water.targetMl ?? null,
    kcal: 0,
    kcalTarget: today?.nutrition.calorieTarget ?? null,
    spentMinor: 0,
    spentCount: 0,
  };
}

function whole(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** "Walk", "Walk and Stretch", "Walk, Stretch and 2 more". */
function stillToDo(names: string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function habitBody(source: Source, state: DayState): string | null {
  if (source.habitId) {
    const habit = state.habits.find((h) => h.id === source.habitId);
    // Gone (archived) or already done: nothing to remind about.
    if (!habit || habit.todayComplete) return null;

    if (measureOf(habit) === 'check') return 'Not done yet today. Tap to tick it off.';
    if (habit.todayCount === 0) return `Not started yet today. ${formatHabitTarget(habit)} to go.`;
    return `${formatHabitProgress(habit, habit.todayCount)} so far. Tap to log more.`;
  }

  const total = state.habits.length;
  const left = state.habits.filter((h) => !h.todayComplete);
  if (total === 0 || left.length === 0) return null;

  const done = total - left.length;
  if (done === 0) return `${total} ${total === 1 ? 'habit' : 'habits'} to do today.`;
  return `${done} of ${total} habits done today. Still to do: ${stillToDo(left.map((h) => h.name))}.`;
}

/** The words for one occurrence, or null when there is nothing worth saying. */
function bodyFor(source: Source, state: DayState, currency: string): string | null {
  switch (source.kind) {
    case 'water': {
      if (state.waterTargetMl === null) return 'Tap to log some water.';
      if (state.waterMl >= state.waterTargetMl) return null;

      const left = formatVolume(state.waterTargetMl - state.waterMl);
      return state.waterMl === 0
        ? `Nothing logged yet today. ${left} to go.`
        : `${formatVolume(state.waterMl)} of ${formatVolume(state.waterTargetMl)} so far. ${left} to go.`;
    }

    case 'habit':
      return habitBody(source, state);

    case 'food':
      if (state.kcal === 0) return 'Nothing logged yet today. Tap to add what you ate.';
      return state.kcalTarget === null
        ? `${whole(state.kcal)} kcal logged today. Tap to add a meal.`
        : `${whole(state.kcal)} of ${whole(state.kcalTarget)} kcal logged today. Tap to add a meal.`;

    case 'expense':
      if (state.spentCount === 0) return 'Nothing logged yet today. Tap to add what you spent.';
      return `${formatMoney(state.spentMinor as Minor, currency)} logged today. Tap to add another.`;

    case 'custom':
      return '';
  }
}

export function planNotifications(input: PlanInput): PlannedNotification[] {
  const horizon = input.horizonDays ?? HORIZON_DAYS;
  const max = input.maxNotifications ?? MAX_NOTIFICATIONS;
  const sources = sourcesOf(input.reminders, input.today);
  const planned: PlannedNotification[] = [];

  for (let offset = 0; offset < horizon; offset += 1) {
    const midnight = new Date(
      input.now.getFullYear(),
      input.now.getMonth(),
      input.now.getDate() + offset,
    );
    const day = localDateOf(midnight);
    const state = stateFor(day, input.today);

    for (const source of sources) {
      const [hour, minute] = source.time.split(':').map(Number) as [number, number];
      const date = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), hour, minute);
      if (date.getTime() <= input.now.getTime()) continue;

      const weekday = (date.getDay() + 6) % 7;
      if (source.weekdays.length > 0 && !source.weekdays.includes(weekday)) continue;

      const body = bodyFor(source, state, input.currency);
      if (body === null) continue;

      planned.push({
        identifier: `${source.key}@${day}T${source.time}`,
        date,
        title: source.title,
        body,
        data: {
          source: 'synitheia-reminder',
          kind: source.kind,
          reminderId: source.reminderId,
          habitId: source.habitId,
          route: ROUTES[source.kind],
        },
      });
    }
  }

  return planned.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, max);
}
