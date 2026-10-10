import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface ManifestNode {
  $: Record<string, string>;
  'intent-filter'?: {
    action?: { $: Record<string, string> }[];
    category?: { $: Record<string, string> }[];
  }[];
}

interface Manifest {
  manifest: {
    $: Record<string, string>;
    application: (ManifestNode & {
      activity?: ManifestNode[];
      'activity-alias'?: ManifestNode[];
    })[];
  };
}

// The plugin is CommonJS, because Expo loads config plugins with plain `require`. Loaded
// here the same way, so the test exercises the file exactly as prebuild will.
const plugin = createRequire(import.meta.url)('./withHealthConnectRationale.js') as {
  applyRationale: (manifest: Manifest) => Manifest;
  applyKeepLatestIntent: (source: string) => string;
  rationaleActivitySource: (packageName: string, deepLink: string) => string;
};

/** The MainActivity Expo generates, cut down to its shape. */
const MAIN_ACTIVITY = `package com.synitheia.app

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              super.invokeDefaultOnBackPressed()
          }
          return
      }
      super.invokeDefaultOnBackPressed()
  }
}
`;

function manifest(): Manifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            {
              $: { 'android:name': '.MainActivity', 'android:exported': 'true' },
              'intent-filter': [
                { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }] },
              ],
            },
          ],
        },
      ],
    },
  };
}

const app = (m: Manifest) => m.manifest.application[0]!;
const named = (nodes: ManifestNode[] | undefined, name: string) =>
  (nodes ?? []).filter((n) => n.$['android:name'] === name);
const actions = (node: ManifestNode) =>
  (node['intent-filter'] ?? []).flatMap((f) => (f.action ?? []).map((a) => a.$['android:name']));
const categories = (node: ManifestNode) =>
  (node['intent-filter'] ?? []).flatMap((f) => (f.category ?? []).map((c) => c.$['android:name']));

describe('applyRationale', () => {
  it('declares the trampoline activity for the Android 13-and-earlier intent', () => {
    const result = plugin.applyRationale(manifest());
    const [activity] = named(app(result).activity, '.HealthRationaleActivity');

    expect(activity).toBeDefined();
    // Health Connect is another app: it can only start an exported activity.
    expect(activity!.$['android:exported']).toBe('true');
    expect(actions(activity!)).toEqual(['androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE']);
  });

  it('declares the Android 14+ alias, pointing at the trampoline and guarded by the system permission', () => {
    const result = plugin.applyRationale(manifest());
    const [alias] = named(app(result)['activity-alias'], 'ViewPermissionUsageActivity');

    expect(alias).toBeDefined();
    expect(alias!.$['android:exported']).toBe('true');
    expect(alias!.$['android:targetActivity']).toBe('.HealthRationaleActivity');
    expect(alias!.$['android:permission']).toBe('android.permission.START_VIEW_PERMISSION_USAGE');
    expect(actions(alias!)).toEqual(['android.intent.action.VIEW_PERMISSION_USAGE']);
    expect(categories(alias!)).toEqual(['android.intent.category.HEALTH_PERMISSIONS']);
  });

  it("leaves the main activity's own intent filters alone", () => {
    const result = plugin.applyRationale(manifest());
    const [main] = named(app(result).activity, '.MainActivity');

    // If the rationale intent landed on MainActivity the link would open the app on Today.
    expect(actions(main!)).toEqual(['android.intent.action.MAIN']);
  });

  it('is idempotent — prebuild runs more than once', () => {
    const result = plugin.applyRationale(plugin.applyRationale(manifest()));

    expect(named(app(result).activity, '.HealthRationaleActivity')).toHaveLength(1);
    expect(named(app(result)['activity-alias'], 'ViewPermissionUsageActivity')).toHaveLength(1);
    expect(app(result).activity).toHaveLength(2);
  });

  it('declares the alias after the activity it targets', () => {
    // Android requires an activity-alias to follow its target in the manifest. The XML is
    // written in key order, so `activity` has to come before `activity-alias`.
    const keys = Object.keys(app(plugin.applyRationale(manifest())));
    expect(keys.indexOf('activity')).toBeLessThan(keys.indexOf('activity-alias'));
  });
});

describe('rationaleActivitySource', () => {
  const source = plugin.rationaleActivitySource('com.synitheia.app', 'synitheia://privacy');

  it('is a Kotlin activity in the app package', () => {
    expect(source).toContain('package com.synitheia.app');
    expect(source).toContain('class HealthRationaleActivity : Activity()');
  });

  it('re-launches the app at the deep link, inside this app only, and gets out of the way', () => {
    expect(source).toContain('Uri.parse("synitheia://privacy")');
    expect(source).toContain('setPackage(packageName)');
    expect(source).toContain('finish()');
  });
});

describe('applyKeepLatestIntent', () => {
  it('makes MainActivity keep the newest intent it is handed', () => {
    // A link that reaches the activity while the app is still starting is dropped by both
    // Expo and React Native. Kept as the activity's intent, the router finds it once
    // JavaScript is running — otherwise Health Connect's policy link opens Today.
    const result = plugin.applyKeepLatestIntent(MAIN_ACTIVITY);

    expect(result).toContain('override fun onNewIntent(intent: Intent) {');
    expect(result).toContain('super.onNewIntent(intent)');
    expect(result).toContain('setIntent(intent)');
  });

  it('imports Intent, once', () => {
    const result = plugin.applyKeepLatestIntent(MAIN_ACTIVITY);
    expect(result.match(/^import android\.content\.Intent$/gm)).toHaveLength(1);

    const already = MAIN_ACTIVITY.replace(
      'import android.os.Build',
      'import android.content.Intent\nimport android.os.Build',
    );
    expect(
      plugin.applyKeepLatestIntent(already).match(/^import android\.content\.Intent$/gm),
    ).toHaveLength(1);
  });

  it('puts the override inside the class and leaves the rest alone', () => {
    const result = plugin.applyKeepLatestIntent(MAIN_ACTIVITY);

    // Everything that was there still is, in order.
    expect(result).toContain('override fun getMainComponentName(): String = "main"');
    expect(result.indexOf('override fun invokeDefaultOnBackPressed()')).toBeLessThan(
      result.indexOf('override fun onNewIntent'),
    );
    // The class still closes after the new method, and braces still balance.
    expect(result.trimEnd().endsWith('}')).toBe(true);
    expect(result.split('{').length).toBe(result.split('}').length);
    expect(result.startsWith('package com.synitheia.app\n')).toBe(true);
  });

  it('is safe to apply twice', () => {
    const once = plugin.applyKeepLatestIntent(MAIN_ACTIVITY);
    expect(plugin.applyKeepLatestIntent(once)).toBe(once);
  });

  it('refuses to guess when MainActivity already handles new intents', () => {
    // Two overrides of one method do not compile; merging them is a human's call.
    const custom = MAIN_ACTIVITY.replace(
      '  override fun getMainComponentName(): String = "main"',
      '  override fun onNewIntent(intent: Intent) {\n    super.onNewIntent(intent)\n  }',
    );
    expect(() => plugin.applyKeepLatestIntent(custom)).toThrow(/onNewIntent/);
  });
});
