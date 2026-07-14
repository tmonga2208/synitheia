module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated's plugin must be listed last — it rewrites worklets and will silently
    // no-op if another plugin transforms the code after it.
    plugins: ['react-native-reanimated/plugin'],
  };
};
