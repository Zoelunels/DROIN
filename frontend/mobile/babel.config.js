module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // babel-preset-expo automatically adds the react-native-worklets plugin
    // (used by react-native-reanimated 4) when the package is installed,
    // so we must not add it again here.
  };
};
