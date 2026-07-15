module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 54) automatically appends react-native-worklets/plugin — the
    // successor to react-native-reanimated/plugin, which moved into its own package in
    // Reanimated 4 — whenever react-native-worklets is installed. Listing it by hand as
    // well double-registers the worklet transform, so the preset is left to own it.
    presets: ['babel-preset-expo'],
  };
};
