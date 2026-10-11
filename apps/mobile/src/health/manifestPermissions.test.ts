import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_PERMISSION,
  MANIFEST_PERMISSIONS,
  READ_RECORD_TYPES,
} from './healthConnectNormalize.js';

interface AppJson {
  expo: {
    android: { permissions: string[] };
    plugins: (string | [string, Record<string, unknown>])[];
  };
}

const { expo } = JSON.parse(
  readFileSync(new URL('../../app.json', import.meta.url), 'utf8'),
) as AppJson;

const health = expo.android.permissions.filter((p) => p.startsWith('android.permission.health.'));
const pluginNames = expo.plugins.map((p) => (typeof p === 'string' ? p : p[0]));

describe('app.json and Health Connect', () => {
  it('declares a manifest permission for every type the app asks for at runtime', () => {
    // Health Connect refuses a request for a permission the manifest does not declare,
    // and the failure only shows on a phone. This is the cheap place to catch it.
    for (const type of READ_RECORD_TYPES) {
      expect(health).toContain(MANIFEST_PERMISSIONS[type]);
    }
    expect(health).toContain(BACKGROUND_PERMISSION);
  });

  it('declares nothing else — no extra type, and nothing that writes', () => {
    expect(health).toHaveLength(READ_RECORD_TYPES.length + 1);
    expect(health.filter((p) => p.includes('.WRITE_'))).toEqual([]);
  });

  it('raises the minimum Android version to the one Health Connect needs', () => {
    const buildProperties = expo.plugins.find(
      (p): p is [string, Record<string, unknown>] =>
        Array.isArray(p) && p[0] === 'expo-build-properties',
    );
    expect(buildProperties?.[1]).toMatchObject({ android: { minSdkVersion: 26 } });
  });

  it("uses our rationale plugin and not the library's", () => {
    expect(pluginNames).toContain('./plugins/withHealthConnectRationale');
    // The library's own plugin points Health Connect's policy link at MainActivity.
    expect(pluginNames).not.toContain('react-native-health-connect');
  });
});
