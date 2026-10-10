import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' as string }));

const ios = {
  isAvailable: vi.fn<() => Promise<boolean>>(),
  connect: vi.fn<() => Promise<string>>(),
  readHealth: vi.fn<(days: number) => Promise<unknown>>(),
};
const android = {
  isAvailable: vi.fn<() => Promise<boolean>>(),
  connect: vi.fn<() => Promise<string>>(),
  readHealth: vi.fn<(days: number) => Promise<unknown>>(),
};

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('./healthkit.js', () => ({ healthkitReader: ios }));
vi.mock('./healthConnect.js', () => ({ healthConnectReader: android }));

const store = await import('./healthStore.js');

beforeEach(() => {
  for (const reader of [ios, android]) {
    reader.isAvailable.mockReset().mockResolvedValue(true);
    reader.connect.mockReset().mockResolvedValue('connected');
    reader.readHealth.mockReset().mockResolvedValue({ days: [] });
  }
});

describe('on iPhone', () => {
  beforeEach(() => {
    platform.OS = 'ios';
  });

  it('uses the HealthKit reader and never touches the Android one', async () => {
    expect(store.isSupported()).toBe(true);
    await store.isAvailable();
    await store.connectHealth();
    await store.readHealth(7);

    expect(ios.isAvailable).toHaveBeenCalledTimes(1);
    expect(ios.connect).toHaveBeenCalledTimes(1);
    expect(ios.readHealth).toHaveBeenCalledWith(7);
    expect(android.isAvailable).not.toHaveBeenCalled();
    expect(android.connect).not.toHaveBeenCalled();
    expect(android.readHealth).not.toHaveBeenCalled();
  });

  it('calls the store Apple Health', () => {
    expect(store.healthSourceName()).toBe('Apple Health');
  });

  it('can hold the user\'s sex and date of birth', () => {
    expect(store.storeHoldsIdentity()).toBe(true);
  });
});

describe('on Android', () => {
  beforeEach(() => {
    platform.OS = 'android';
  });

  it('uses the Health Connect reader and never touches the iPhone one', async () => {
    expect(store.isSupported()).toBe(true);
    await store.isAvailable();
    await store.connectHealth();
    await store.readHealth(7);

    expect(android.isAvailable).toHaveBeenCalledTimes(1);
    expect(android.connect).toHaveBeenCalledTimes(1);
    expect(android.readHealth).toHaveBeenCalledWith(7);
    expect(ios.connect).not.toHaveBeenCalled();
    expect(ios.readHealth).not.toHaveBeenCalled();
  });

  it('calls the store Health Connect', () => {
    expect(store.healthSourceName()).toBe('Health Connect');
  });

  it('has nowhere to keep sex or date of birth — Health Connect has no such record', () => {
    expect(store.storeHoldsIdentity()).toBe(false);
  });

  it('passes the reader\'s outcome through, including "update required"', async () => {
    android.connect.mockResolvedValue('update_required');
    expect(await store.connectHealth()).toBe('update_required');
  });

  it('reads seven days unless told otherwise', async () => {
    await store.readHealth();
    expect(android.readHealth).toHaveBeenCalledWith(7);
  });
});

describe('anywhere else', () => {
  beforeEach(() => {
    platform.OS = 'web';
  });

  it('has no health store, and says so without calling a reader', async () => {
    expect(store.isSupported()).toBe(false);
    expect(await store.isAvailable()).toBe(false);
    expect(await store.connectHealth()).toBe('unavailable');
    expect(await store.readHealth(7)).toBeNull();
    expect(store.healthSourceName()).toBe('your health app');

    expect(ios.readHealth).not.toHaveBeenCalled();
    expect(android.readHealth).not.toHaveBeenCalled();
  });
});
