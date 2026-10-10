import { describe, expect, it, vi } from 'vitest';

// What importing the library does on a build its native module did not link into.
vi.mock('react-native-health-connect', () => {
  throw new Error("The package 'react-native-health-connect' doesn't seem to be linked.");
});

const { healthConnectReader } = await import('./healthConnect.js');

describe('when the Health Connect module is not in the build', () => {
  it('reads as unavailable instead of crashing the app or the background task', async () => {
    expect(await healthConnectReader.isAvailable()).toBe(false);
    expect(await healthConnectReader.connect()).toBe('unavailable');
    expect(await healthConnectReader.readHealth(7)).toBeNull();
  });
});
