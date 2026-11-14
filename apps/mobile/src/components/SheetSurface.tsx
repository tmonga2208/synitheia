import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, type ViewProps } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sheetBottomPadding } from './sheetPadding.js';

/**
 * The panel of a bottom sheet. It rises into place while the dimmed backdrop behind it
 * fades in.
 *
 * Every sheet used `<Modal animationType="slide">`, which slides the whole modal, backdrop
 * included: the dim arrived as a hard-edged grey block travelling up the screen with the
 * panel riding on top of it. The Modal now fades (`animationType="fade"`) and only this
 * panel moves.
 *
 * It stands in for the `SafeAreaView edges={['bottom']}` the sheets used — same style, same
 * home-indicator inset added to its bottom padding. The inset comes from the hook rather
 * than a nested SafeAreaView because the transform has to sit on the view that holds the
 * children: a wrapper would take the sheet's own padding and `gap` away from them.
 *
 * RN's Modal renders nothing while hidden, so this mounts — and rises — on every open.
 */
export function SheetSurface({ style, children, ...rest }: ViewProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // With Reduce Motion on it is simply there, and the Modal's fade is the whole entrance.
  const offset = useSharedValue(reduceMotion ? 0 : height * RISE_FRACTION);

  useEffect(() => {
    offset.value = withTiming(0, { duration: RISE_MS, easing: Easing.out(Easing.cubic) });
  }, [offset]);

  const rise = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  return (
    <Animated.View
      style={[
        style,
        { paddingBottom: sheetBottomPadding(StyleSheet.flatten(style), insets.bottom) },
        rise,
      ]}
      {...rest}
    >
      {children}
    </Animated.View>
  );
}

/** How far below its resting place the panel starts, as a share of the screen's height. */
const RISE_FRACTION = 0.4;
/** About the length of the Modal's own fade, so the dim and the panel settle together. */
const RISE_MS = 320;
