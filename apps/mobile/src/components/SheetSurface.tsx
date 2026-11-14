import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, type ViewProps } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
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
  // Otherwise it starts below the screen: the Modal fades everything in it, this panel
  // included, and a panel already in view would show the page through it as it arrived.
  const offset = useSharedValue(reduceMotion ? 0 : height);

  useEffect(() => {
    offset.value = withDelay(
      RISE_DELAY_MS,
      withTiming(0, { duration: RISE_MS, easing: Easing.out(Easing.cubic) }),
    );
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

/**
 * The panel waits this long for the Modal's fade to get going, so it comes into view on a
 * dim that is most of the way there. Short enough that the tap still feels answered: the
 * dim itself starts at once.
 */
const RISE_DELAY_MS = 120;
/** Ending a little after the fade does, so the panel is the last thing to settle. */
const RISE_MS = 340;
