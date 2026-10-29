import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// CommonJS, as Expo loads config plugins; required the same way so prebuild's file is tested.
const plugin = createRequire(import.meta.url)('./withSceneLifecycle.js') as {
  applySceneManifest: (plist: Record<string, unknown>) => Record<string, unknown>;
  applySceneDelegate: (source: string) => string;
};

/** The AppDelegate.swift Expo 54's prebuild generates, unchanged. */
const template = readFileSync(new URL('./fixtures/AppDelegate.expo54.swift', import.meta.url), 'utf8');

describe('withSceneLifecycle', () => {
  it('names our scene delegate in a single-scene manifest and keeps other keys', () => {
    const plist = plugin.applySceneManifest({ CFBundleName: 'Syntheia' });

    expect(plist.CFBundleName).toBe('Syntheia');
    expect(plist.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    });
    expect(plugin.applySceneManifest(plist)).toEqual(plist);
  });

  it('moves the window and React Native start out of the AppDelegate into a SceneDelegate', () => {
    const swift = plugin.applySceneDelegate(template);
    const [appDelegate, sceneDelegate] = swift.split('class SceneDelegate');

    expect(appDelegate).not.toContain('UIWindow(frame:');
    expect(appDelegate).not.toContain('startReactNative');
    expect(appDelegate).toContain('bindReactNativeFactory(factory)');
    expect(appDelegate).toContain('return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
    expect(sceneDelegate).toContain('UIWindow(windowScene: windowScene)');
    expect(sceneDelegate).toContain('factory.startReactNative(withModuleName: "main", in: window');
  });

  it('hands links and foreground changes back to the AppDelegate', () => {
    const swift = plugin.applySceneDelegate(template);

    expect(swift).toContain('launchOptions[.url] = url');
    expect(swift).toContain('openURLContexts');
    expect(swift).toContain('continue userActivity');
    expect(swift).toContain('applicationDidBecomeActive');
    expect(swift).toContain('applicationDidEnterBackground');
  });

  it('can run twice without changing anything the second time', () => {
    const once = plugin.applySceneDelegate(template);
    expect(plugin.applySceneDelegate(once)).toBe(once);
  });

  it('fails the prebuild on an AppDelegate it does not recognise', () => {
    expect(() => plugin.applySceneDelegate('class AppDelegate: RCTAppDelegate {}')).toThrow(
      /unexpected shape/,
    );
  });
});
