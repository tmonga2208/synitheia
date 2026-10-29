const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

/**
 * The UIScene life cycle, so the app opens on iOS 27.
 *
 * An app built with the iOS 27 SDK that still starts the old way (AppDelegate creates the
 * window) is stopped by UIKit at launch: EXC_BREAKPOINT in
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. Expo 54's template starts
 * the old way and, unlike Expo 57, ships no scene delegate to switch to. So this plugin
 * writes a small one into AppDelegate.swift (no Xcode project edits needed) and names it in
 * Info.plist. The AppDelegate still builds the React Native factory; the scene delegate
 * creates the window and starts React Native in it.
 *
 * With scenes, iOS stops sending URLs and foreground/background changes to the app
 * delegate, which is where Expo's modules and React Native's Linking listen. The scene
 * delegate hands each of them back to it, including a link the app was launched from.
 *
 * Both edits are idempotent, and an AppDelegate this does not recognise fails the prebuild
 * rather than producing an app that crashes at launch. Drop this when moving to an Expo
 * SDK whose template adopts scenes itself.
 */

const CONFIGURATION_NAME = 'Default Configuration';
const SCENE_DELEGATE_CLASS = '$(PRODUCT_MODULE_NAME).SceneDelegate';
const MARKER = '// withSceneLifecycle: SceneDelegate';

/** Info.plist with a single-scene manifest that uses our SceneDelegate. */
function applySceneManifest(infoPlist) {
  const manifest = infoPlist.UIApplicationSceneManifest ?? {};
  const configurations = manifest.UISceneConfigurations ?? {};
  const others = (configurations.UIWindowSceneSessionRoleApplication ?? []).filter(
    (c) => c.UISceneConfigurationName !== CONFIGURATION_NAME,
  );
  return {
    ...infoPlist,
    UIApplicationSceneManifest: {
      ...manifest,
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        ...configurations,
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: CONFIGURATION_NAME,
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
          ...others,
        ],
      },
    },
  };
}

// The template's window + startReactNative block, with or without its #if.
const START_IN_APP_DELEGATE =
  /^[ \t]*(?:#if os\(iOS\) \|\| os\(tvOS\)\n[ \t]*)?window = UIWindow\(frame: UIScreen\.main\.bounds\)\n[ \t]*factory\.startReactNative\([\s\S]*?\)\n(?:[ \t]*#endif\n)?/m;

const SCENE_DELEGATE = `
${MARKER} (plugins/withSceneLifecycle.js). iOS 27 stops apps without one.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var app: UIApplication { UIApplication.shared }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = app.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // A cold launch from a link arrives here, not in launchOptions; React Native reads
    // Linking.getInitialURL from the options it is started with.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)

    if let activity = connectionOptions.userActivities.first {
      _ = appDelegate.application(app, continue: activity, restorationHandler: { _ in })
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let context = URLContexts.first, let appDelegate = app.delegate as? AppDelegate else { return }
    var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    if let source = context.options.sourceApplication { options[.sourceApplication] = source }
    _ = appDelegate.application(app, open: context.url, options: options)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = app.delegate as? AppDelegate else { return }
    _ = appDelegate.application(app, continue: userActivity, restorationHandler: { _ in })
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    app.delegate?.applicationDidBecomeActive?(app)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    app.delegate?.applicationWillResignActive?(app)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    app.delegate?.applicationWillEnterForeground?(app)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    app.delegate?.applicationDidEnterBackground?(app)
  }
}
`;

/** AppDelegate.swift that leaves the window to the scene, with the SceneDelegate appended. */
function applySceneDelegate(source) {
  if (source.includes(MARKER)) return source;

  const withoutWindow = source.replace(
    START_IN_APP_DELEGATE,
    '    // The window and React Native start in SceneDelegate, below (plugins/withSceneLifecycle.js).\n',
  );
  if (withoutWindow === source || withoutWindow.includes('startReactNative(')) {
    throw new Error(
      'withSceneLifecycle: AppDelegate.swift has an unexpected shape; update apps/mobile/plugins/withSceneLifecycle.js.',
    );
  }
  return `${withoutWindow.trimEnd()}\n${SCENE_DELEGATE}`;
}

const withSceneLifecycle = (config) => {
  config = withInfoPlist(config, (c) => {
    c.modResults = applySceneManifest(c.modResults);
    return c;
  });
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') {
      throw new Error(`withSceneLifecycle: expected a Swift AppDelegate, got ${c.modResults.language}.`);
    }
    c.modResults.contents = applySceneDelegate(c.modResults.contents);
    return c;
  });
};

module.exports = withSceneLifecycle;
module.exports.applySceneManifest = applySceneManifest;
module.exports.applySceneDelegate = applySceneDelegate;
