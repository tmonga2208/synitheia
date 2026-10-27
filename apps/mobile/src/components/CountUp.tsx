import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { Text } from './primitives.js';

const DURATION_MS = 1100;

type Props = Omit<ComponentProps<typeof Text>, 'children'> & {
  to: number;
  format: (n: number) => string;
  /** Count up from zero the first time this mounts. Later values arrive without a count. */
  animate: boolean;
};

/**
 * A number that settles into place instead of appearing all at once. It counts only on
 * mount: a total refreshed from the network, or changed by a new expense, simply updates.
 * Screen readers hear the final value, never the numbers on the way.
 */
export function CountUp({ to, format, animate, ...text }: Props) {
  const reduceMotion = useReducedMotion();
  const counting = useRef(animate && !reduceMotion);
  const [shown, setShown] = useState(counting.current ? 0 : to);

  useEffect(() => {
    if (!counting.current) {
      setShown(to);
      return;
    }
    counting.current = false;

    let frame = 0;
    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / DURATION_MS);
      setShown(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [to]);

  return (
    <Text {...text} accessibilityLabel={format(to)}>
      {format(Math.round(shown))}
    </Text>
  );
}
