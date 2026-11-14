import Svg, { Circle } from 'react-native-svg';
import { SPLASH_ARCS, arcDash } from './splashLogo.js';

/** The arcs are drawn on the launch image's 1024 canvas, around its centre. */
const CENTRE = 512;
/** How far the outer arc reaches from the centre, rounded ends included, with a hair to spare. */
const EXTENT = 260;

/**
 * Synítheia's mark: the three arcs of the app icon and the launch screen.
 *
 * The same geometry the animated splash draws (splashLogo.ts), cropped to the arcs, so the
 * mark a person meets on the welcome screen is the one they tapped on their home screen.
 * The welcome screen used to show a stock leaf icon in its place.
 */
export function BrandMark({ size }: { size: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`${CENTRE - EXTENT} ${CENTRE - EXTENT} ${EXTENT * 2} ${EXTENT * 2}`}
      accessibilityRole="image"
      accessibilityLabel="Synítheia"
    >
      {SPLASH_ARCS.map((arc) => (
        <Circle
          key={arc.radius}
          cx={CENTRE}
          cy={CENTRE}
          r={arc.radius}
          stroke={arc.color}
          strokeWidth={arc.width}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={arcDash(arc.radius, arc.sweepDeg)}
          rotation={arc.startDeg}
          origin={`${CENTRE}, ${CENTRE}`}
        />
      ))}
    </Svg>
  );
}
