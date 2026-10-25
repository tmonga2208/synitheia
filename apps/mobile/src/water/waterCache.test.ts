import { QueryClient } from '@tanstack/react-query';
import type { TodayResponse } from '@synitheia/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  WATER_KEY,
  hideGlass,
  putGlassBack,
  showGlass,
  type WaterResponse,
  type WireWaterEntry,
} from './waterCache.js';

const TODAY_KEY = ['today'];

let client: QueryClient;

const glass = (id: string, amountMl = 250): WireWaterEntry => ({
  _id: id,
  amountMl,
  loggedAt: '2026-10-25T09:00:00.000Z',
});

beforeEach(() => {
  client = new QueryClient();
  client.setQueryData<WaterResponse>(WATER_KEY, {
    items: [glass('older', 500)],
    totalMl: 500,
    targetMl: 2000,
  });
  client.setQueryData(TODAY_KEY, { water: { totalMl: 500, targetMl: 2000 } } as TodayResponse);
});

const water = () => client.getQueryData<WaterResponse>(WATER_KEY)!;
const todayMl = () => client.getQueryData<TodayResponse>(TODAY_KEY)!.water.totalMl;

describe('showGlass', () => {
  it('shows a glass at once in the water list, newest first, and in Today’s total', () => {
    showGlass(client, glass('new'));

    expect(water().items.map((i) => i._id)).toEqual(['new', 'older']);
    expect(water().totalMl).toBe(750);
    expect(todayMl()).toBe(750);
  });

  it('counts a glass once, however often it is shown', () => {
    showGlass(client, glass('new'));
    showGlass(client, glass('new'));

    expect(water().items).toHaveLength(2);
    expect(water().totalMl).toBe(750);
    expect(todayMl()).toBe(750);
  });

  it('leaves alone a screen that has not loaded', () => {
    const empty = new QueryClient();

    showGlass(empty, glass('new'));

    expect(empty.getQueryData(WATER_KEY)).toBeUndefined();
    expect(empty.getQueryData(TODAY_KEY)).toBeUndefined();
  });
});

describe('hideGlass and putGlassBack', () => {
  it('takes a glass out of both, and puts it back where it was', () => {
    showGlass(client, glass('new'));

    const index = hideGlass(client, glass('older', 500));
    expect(water().items.map((i) => i._id)).toEqual(['new']);
    expect(water().totalMl).toBe(250);
    expect(todayMl()).toBe(250);

    putGlassBack(client, glass('older', 500), index);
    expect(water().items.map((i) => i._id)).toEqual(['new', 'older']);
    expect(water().totalMl).toBe(750);
    expect(todayMl()).toBe(750);
  });

  it('takes nothing from the totals for a glass the list no longer has', () => {
    hideGlass(client, glass('missing'));

    expect(water().totalMl).toBe(500);
    expect(todayMl()).toBe(500);
  });

  it('with the water list not loaded, takes the glass from Today’s total alone', () => {
    client.removeQueries({ queryKey: WATER_KEY });
    showGlass(client, glass('new'));

    hideGlass(client, glass('new'));

    expect(todayMl()).toBe(500);
  });

  it('never takes Today’s total below nothing', () => {
    client.setQueryData(TODAY_KEY, { water: { totalMl: 100, targetMl: 2000 } } as TodayResponse);

    hideGlass(client, glass('older', 500));

    expect(todayMl()).toBe(0);
  });
});
