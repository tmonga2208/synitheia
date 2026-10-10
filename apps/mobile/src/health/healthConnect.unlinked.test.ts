import { describe, expect, it, vi } from 'vitest';

const libraryImports = vi.hoisted(() => ({ count: 0 }));

// A build the library's native module did not link into: the registry has no such module.
vi.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  TurboModuleRegistry: { get: () => null },
}));

// What evaluating the library does on such a build. Under Metro this throw is NOT a
// rejected import: Metro's module guard catches it, reports a FATAL error — a crash in a
// release build — and resolves the import with nothing. So the only safe outcome is that
// the library is never evaluated at all, which is what the counter pins.
vi.mock('react-native-health-connect', () => {
  libraryImports.count += 1;
  throw new Error("The package 'react-native-health-connect' doesn't seem to be linked.");
});

const { healthConnectReader } = await import('./healthConnect.js');

describe('when the Health Connect module is not in the build', () => {
  it('reads as unavailable without ever evaluating the library', async () => {
    expect(await healthConnectReader.isAvailable()).toBe(false);
    expect(await healthConnectReader.connect()).toBe('unavailable');
    expect(await healthConnectReader.readHealth(7)).toBeNull();

    expect(libraryImports.count).toBe(0);
  });
});
