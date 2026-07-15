/// <reference types="expo/types" />

// Kept OUT of expo-env.d.ts on purpose: `expo prebuild --clean` regenerates (and briefly
// deletes) that file, taking any hand-added declarations with it. Static image imports —
// used for the Android tab icons — need this module shape to typecheck, so it lives here
// where prebuild will not touch it.
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const content: ImageSourcePropType;
  export default content;
}
