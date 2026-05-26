import React, { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import {
  Canvas,
  Circle,
  RadialGradient,
  BlurMask,
  vec,
} from '@shopify/react-native-skia';

const SAVED_HIGH = 200;

/** Same log curve as HomeScreen — keeps globe and score ring visually in sync. */
function progressFor(savedKg: number): number {
  if (savedKg <= 0) return 0;
  if (savedKg >= SAVED_HIGH) return 1;
  return Math.log10(savedKg + 1) / Math.log10(SAVED_HIGH + 1);
}

function lerpInt(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

interface GlobeProps {
  savedKg: number;
}

/**
 * Stylized "carbon globe" rendered with Skia. Not a true 3D sphere — uses a
 * radial gradient to fake depth/lighting, plus a blurred atmosphere ring.
 * Color interpolates from carbon-600 (gray, "just starting") to eco-500
 * (vibrant green, "climate champion") on the same log curve as HomeScreen.
 *
 * Lives in HomeScreen's mid-section. Self-contained — takes the current
 * savings number as a prop, nothing else.
 */
export const Globe: React.FC<GlobeProps> = ({ savedKg }) => {
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const onLayout = (e: LayoutChangeEvent) => {
    setSize(e.nativeEvent.layout);
  };

  // Map savings → 0–1 progress, interpolate base color.
  // carbon-600 #525252 → eco-500 #10b981
  const palette = useMemo(() => {
    const t = progressFor(savedKg);
    const r = lerpInt(82, 16, t);
    const g = lerpInt(82, 185, t);
    const b = lerpInt(82, 129, t);
    const base = `rgb(${r}, ${g}, ${b})`;
    const light = `rgb(${clamp(r + 90, 0, 255)}, ${clamp(g + 90, 0, 255)}, ${clamp(b + 90, 0, 255)})`;
    const shadow = `rgb(${clamp(r - 50, 0, 255)}, ${clamp(g - 50, 0, 255)}, ${clamp(b - 50, 0, 255)})`;
    return { base, light, shadow, progress: t };
  }, [savedKg]);

  if (size.width === 0 || size.height === 0) {
    return <View style={{ flex: 1 }} onLayout={onLayout} />;
  }

  const cx = size.width / 2;
  const cy = size.height / 2;
  const baseRadius = Math.min(size.width, size.height) * 0.38;

  // Light source comes from top-left for the "3D sphere" illusion.
  const lightOffsetX = -baseRadius * 0.35;
  const lightOffsetY = -baseRadius * 0.35;

  // Atmosphere intensity scales with progress — barely visible at 0,
  // glowing at high savings.
  const atmosphereOpacity = 0.18 + palette.progress * 0.55;

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <Canvas style={{ flex: 1 }}>
        {/* Outer atmosphere glow — large soft blurred ring */}
        <Circle cx={cx} cy={cy} r={baseRadius * 1.35} opacity={atmosphereOpacity}>
          <BlurMask blur={28} style="normal" />
          <RadialGradient
            c={vec(cx, cy)}
            r={baseRadius * 1.4}
            colors={[palette.base, `${palette.base}00`]}
          />
        </Circle>

        {/* Main globe body — radial gradient fakes lighting from top-left */}
        <Circle cx={cx} cy={cy} r={baseRadius}>
          <RadialGradient
            c={vec(cx + lightOffsetX, cy + lightOffsetY)}
            r={baseRadius * 1.8}
            colors={[palette.light, palette.base, palette.shadow]}
            positions={[0, 0.55, 1]}
          />
        </Circle>

        {/* Specular highlight — small bright spot near the light source */}
        <Circle
          cx={cx + lightOffsetX * 0.7}
          cy={cy + lightOffsetY * 0.7}
          r={baseRadius * 0.18}
          opacity={0.4 + palette.progress * 0.2}
        >
          <BlurMask blur={12} style="normal" />
          <RadialGradient
            c={vec(cx + lightOffsetX * 0.7, cy + lightOffsetY * 0.7)}
            r={baseRadius * 0.2}
            colors={['rgba(255,255,255,0.7)', 'rgba(255,255,255,0)']}
          />
        </Circle>
      </Canvas>
    </View>
  );
};
