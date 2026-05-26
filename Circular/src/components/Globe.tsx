import React, { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import {
  Canvas,
  Circle,
  Fill,
  Shader,
  Skia,
  RadialGradient,
  BlurMask,
  vec,
  useClock,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

const SAVED_HIGH = 200;

/** Same log curve as HomeScreen — keeps globe and score ring visually in sync. */
function progressFor(savedKg: number): number {
  if (savedKg <= 0) return 0;
  if (savedKg >= SAVED_HIGH) return 1;
  return Math.log10(savedKg + 1) / Math.log10(SAVED_HIGH + 1);
}

// ─── SkSL runtime shader ──────────────────────────────────────────────────
//
// Renders a 3D sphere by projecting fragment coordinates onto a unit sphere,
// computing the surface normal, and shading via Phong-style lighting + an
// FBM noise pattern for continent/vegetation density. Continents fade in as
// `progress` grows, so a 0-saved user sees a dull featureless ocean and a
// 200+ kg saver sees lush green land.

const SPHERE_SHADER_SOURCE = `
uniform float  time;        // seconds since start
uniform float  progress;    // 0..1 lifetime savings normalized
uniform float  radius;
uniform float2 center;

// ── 2D hash + value noise + 4-octave FBM ──────────────────────────────
float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i),                  hash(i + float2(1.0, 0.0)), u.x),
             mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x),
             u.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

half4 main(float2 fragCoord) {
  float2 d = fragCoord - center;
  float  dist = length(d);

  // Outside sphere → transparent (Skia handles the Circle clip too, but this
  // lets us anti-alias the rim ourselves for a softer edge).
  if (dist > radius + 1.5) {
    return half4(0.0);
  }

  // ── Project to unit-sphere normal ──
  float2 nxy = d / radius;
  float  d2 = dot(nxy, nxy);
  float  nz = sqrt(max(0.0, 1.0 - d2));
  float3 n = float3(nxy.x, nxy.y, nz);

  // ── Spherical UV with slow rotation around the Y axis ──
  // u wraps 0..1 longitude, v 0..1 latitude.
  float u = atan(n.x, n.z) / 6.28318530718 + 0.5 + time * 0.035;
  float v = acos(clamp(-n.y, -1.0, 1.0)) / 3.14159265359;

  // ── Continent / vegetation noise ──
  // Sample FBM at moderate frequency for continent-scale blobs.
  float landDensity = fbm(float2(u * 5.5, v * 5.5));
  // A second higher-frequency layer adds vegetation detail on top of land.
  float vegDetail   = fbm(float2(u * 14.0 + 5.0, v * 14.0 + 5.0));

  // ── Lighting ──
  float3 lightDir = normalize(float3(-0.45, -0.55, 0.8));
  float  diffuse  = max(0.0, dot(n, lightDir));
  float  ambient  = 0.32;
  float  lighting = ambient + (1.0 - ambient) * diffuse;

  // Subtle specular for sheen on top-left
  float3 viewDir = float3(0.0, 0.0, 1.0);
  float3 halfwayDir = normalize(lightDir + viewDir);
  float  spec = pow(max(0.0, dot(n, halfwayDir)), 32.0) * 0.35;

  // ── Surface colors, all driven by progress ──
  // Ocean transitions from cool gray (progress=0) to deep eco-800 (progress=1).
  half3 oceanLow  = half3(0.25, 0.25, 0.25);
  half3 oceanHigh = half3(0.024, 0.373, 0.275);
  half3 ocean = mix(oceanLow, oceanHigh, progress);

  // Land transitions from olive-gray (progress=0) to vibrant eco-500.
  half3 landLow  = half3(0.40, 0.40, 0.34);
  half3 landHigh = half3(0.063, 0.725, 0.506);
  half3 land = mix(landLow, landHigh, progress);

  // Vegetation patches inside land — darker, denser green at high progress.
  half3 vegHigh  = half3(0.024, 0.541, 0.353); // eco-700
  half3 landFinal = mix(land, vegHigh, smoothstep(0.45, 0.75, vegDetail) * progress);

  // Smooth transition between ocean and land based on noise threshold,
  // narrower band at higher progress (sharper coastlines).
  float coastWidth = mix(0.18, 0.08, progress);
  float landMask = smoothstep(0.5 - coastWidth, 0.5 + coastWidth, landDensity);

  half3 surface = mix(ocean, landFinal, landMask);

  // Apply lighting + specular
  half3 lit = surface * half(lighting) + half3(spec);

  // ── Soft edge ──
  // Linear alpha fade in the last 1.5 px around the rim for anti-aliasing.
  float edgeAlpha = 1.0 - smoothstep(radius - 1.0, radius + 1.0, dist);
  return half4(lit, half(edgeAlpha));
}
`;

const SPHERE_EFFECT = Skia.RuntimeEffect.Make(SPHERE_SHADER_SOURCE);
if (!SPHERE_EFFECT) {
  // Surface the SkSL compile error early instead of silently failing.
  // (Skia logs the actual diagnostic to the native console.)
  console.warn('[Globe] SkSL shader failed to compile — check Globe.tsx');
}

// ─── Component ────────────────────────────────────────────────────────────

interface GlobeProps {
  savedKg: number;
}

/**
 * Stylized "carbon globe" rendered with a Skia SkSL runtime shader. Sphere
 * shading is real (sphere-projected normal + diffuse/specular lighting), but
 * the surface is procedural noise rather than a literal Earth texture. As
 * `savedKg` grows the ocean deepens, continents emerge with sharper coasts,
 * and vegetation patches intensify — visually echoing the home score ring
 * which also greens up with the same log curve.
 *
 * Time animation uses Skia's own clock (NOT a Reanimated DerivedValue passed
 * directly into a Skia prop — that crashes the CTM recorder, see git history).
 */
export const Globe: React.FC<GlobeProps> = ({ savedKg }) => {
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const onLayout = (e: LayoutChangeEvent) => {
    setSize(e.nativeEvent.layout);
  };

  const clock = useClock(); // Skia-native clock; SharedValue<number> in ms

  // Cache layout-derived geometry so it doesn't recompute every frame.
  const geom = useMemo(() => {
    if (size.width === 0 || size.height === 0) return null;
    const cx = size.width / 2;
    const cy = size.height / 2;
    const r = Math.min(size.width, size.height) * 0.38;
    return { cx, cy, r };
  }, [size.width, size.height]);

  const progress = progressFor(savedKg);

  // Shader uniforms as a Reanimated derived value — Skia subscribes per frame.
  const uniforms = useDerivedValue(() => {
    if (!geom) return { time: 0, progress, radius: 1, center: [0, 0] };
    return {
      time: clock.value / 1000,
      progress,
      radius: geom.r,
      center: [geom.cx, geom.cy] as [number, number],
    };
  }, [clock, progress, geom?.cx, geom?.cy, geom?.r]);

  // Atmosphere color follows progress on the same gray→eco-500 axis.
  const atmosphere = useMemo(() => {
    const r = Math.round(82 + (16 - 82) * progress);
    const g = Math.round(82 + (185 - 82) * progress);
    const b = Math.round(82 + (129 - 82) * progress);
    const color = `rgb(${r}, ${g}, ${b})`;
    return {
      color,
      opacity: 0.18 + progress * 0.5,
    };
  }, [progress]);

  if (!geom || !SPHERE_EFFECT) {
    return <View style={{ flex: 1 }} onLayout={onLayout} />;
  }

  const { cx, cy, r } = geom;

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <Canvas style={{ flex: 1 }}>
        {/* Outer atmosphere glow — blurred ring outside the sphere */}
        <Circle cx={cx} cy={cy} r={r * 1.32} opacity={atmosphere.opacity}>
          <BlurMask blur={28} style="normal" />
          <RadialGradient
            c={vec(cx, cy)}
            r={r * 1.35}
            colors={[atmosphere.color, `${atmosphere.color}00`]}
          />
        </Circle>

        {/* The sphere itself — SkSL shader handles lighting + continents */}
        <Fill>
          <Shader source={SPHERE_EFFECT} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
};
