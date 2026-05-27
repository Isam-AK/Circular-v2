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
  // Lower frequency (4.0 down from 5.5) → fewer but larger, more recognizable
  // continent shapes. Then a contrast push (smoothstep) so the noise sits
  // closer to 0/1 than 0.5, making landmasses clearly defined instead of
  // blending mushy edges.
  float landDensityRaw = fbm(float2(u * 4.0, v * 4.0));
  float landDensity = smoothstep(0.25, 0.75, landDensityRaw);

  // Higher-frequency layer for "terrain relief" within continents — mountain
  // ranges, river valleys, anything that catches light differently.
  float vegDetail = fbm(float2(u * 12.0 + 5.0, v * 12.0 + 5.0));

  // Even higher frequency for micro-texture (small surface speckle).
  float microDetail = fbm(float2(u * 28.0 - 3.0, v * 28.0 - 3.0));

  // ── Lighting ──
  // Higher ambient + softer falloff. The sphere now reads as a daytime
  // planet rather than one half-lost in night shadow.
  float3 lightDir = normalize(float3(-0.45, -0.55, 0.8));
  float  diffuse  = max(0.0, dot(n, lightDir));
  float  ambient  = 0.65;
  float  lighting = ambient + (1.0 - ambient) * diffuse;

  // Slightly brighter specular for a fresh, dewy sheen on top-left.
  float3 viewDir = float3(0.0, 0.0, 1.0);
  float3 halfwayDir = normalize(lightDir + viewDir);
  float  spec = pow(max(0.0, dot(n, halfwayDir)), 28.0) * 0.45;

  // ── Surface colors via 3-stop interpolation ──
  // All stops lifted toward "luminous pastel" — no more deep gray/black at
  // low progress, no more muddy olive in the middle. The planet always
  // reads as alive; growth is more saturated greens rather than emerging
  // from a dead grayscale.
  //
  // Ocean: cool soft mineral → warm honey-bronze → vibrant teal.
  half3 oceanGray  = half3(0.480, 0.530, 0.560);  // cool gray-blue mineral
  half3 oceanAmber = half3(0.620, 0.500, 0.220);  // warm honey-bronze
  half3 oceanGreen = half3(0.090, 0.580, 0.450);  // bright teal-green

  half3 ocean;
  if (progress < 0.5) {
    ocean = mix(oceanGray, oceanAmber, progress * 2.0);
  } else {
    ocean = mix(oceanAmber, oceanGreen, (progress - 0.5) * 2.0);
  }

  // Land: warm sand → sunny amber → bright lime. Higher saturation
  // throughout, no olive-gray dead zone.
  half3 landGray  = half3(0.780, 0.720, 0.580);   // soft sand / beige
  half3 landAmber = half3(0.960, 0.780, 0.300);   // bright sunny amber
  half3 landGreen = half3(0.220, 0.830, 0.560);   // vibrant lime-green

  half3 land;
  if (progress < 0.5) {
    land = mix(landGray, landAmber, progress * 2.0);
  } else {
    land = mix(landAmber, landGreen, (progress - 0.5) * 2.0);
  }

  // Vegetation / mountain patches — slightly warmer/darker than base land
  // for depth, but never muddy.
  half3 vegHigh  = half3(0.060, 0.650, 0.420); // bright forest green
  half3 vegLow   = half3(0.780, 0.580, 0.220); // warm tan/wheat
  half3 vegColor;
  if (progress < 0.5) {
    vegColor = mix(landGray * half(0.85), vegLow, progress * 2.0);
  } else {
    vegColor = mix(vegLow, vegHigh, (progress - 0.5) * 2.0);
  }

  // Gentler terrain relief — was ±20%, now ±8%. Still readable as
  // hills/valleys but no more harsh dark scars across the continents.
  float relief = 0.92 + 0.16 * vegDetail;
  half3 landRelief = land * half(relief);

  // Vegetation patch overlay. Same intensity curve as before but on a
  // brighter base, so patches feel like rich greenery instead of stains.
  half3 landFinal = mix(landRelief, vegColor, smoothstep(0.5, 0.85, vegDetail) * progress);

  // Even subtler micro-speckle — ±3% instead of ±5%.
  landFinal *= half(0.97 + 0.06 * microDetail);

  // Sharper coastlines than the original — narrow transition band.
  float coastWidth = mix(0.08, 0.03, progress);
  float landMask = smoothstep(0.5 - coastWidth, 0.5 + coastWidth, landDensity);

  // Ocean depth variation — gentler now, ±9% rather than ±18%.
  float depthNoise = fbm(float2(u * 2.5 + 7.0, v * 2.5 + 7.0));
  half3 oceanShaded = ocean * half(0.94 + 0.12 * depthNoise);

  half3 surface = mix(oceanShaded, landFinal, landMask);

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

  // Atmosphere color: 3-stop palette (carbon-400 → amber-300 → eco-300)
  // — lighter than the sphere surface so the halo reads as warm glow rather
  // than dark shadow. Matches the score ring's color story but at higher
  // value (more white in each stop).
  const atmosphere = useMemo(() => {
    // Lighter stops than the surface uses.
    const lo: [number, number, number] = [163, 163, 163];  // carbon-400
    const mid: [number, number, number] = [252, 211, 77];  // amber-300
    const hi: [number, number, number] = [110, 231, 183];  // eco-300

    let r: number, g: number, b: number;
    if (progress < 0.5) {
      const t = progress * 2;
      r = Math.round(lo[0] + (mid[0] - lo[0]) * t);
      g = Math.round(lo[1] + (mid[1] - lo[1]) * t);
      b = Math.round(lo[2] + (mid[2] - lo[2]) * t);
    } else {
      const t = (progress - 0.5) * 2;
      r = Math.round(mid[0] + (hi[0] - mid[0]) * t);
      g = Math.round(mid[1] + (hi[1] - mid[1]) * t);
      b = Math.round(mid[2] + (hi[2] - mid[2]) * t);
    }

    return {
      color: `rgb(${r}, ${g}, ${b})`,
      // Lower base opacity too: was 0.18 + 0.5p, now 0.12 + 0.3p — the halo
      // now hints at the globe color instead of bleeding into a heavy ring.
      opacity: 0.12 + progress * 0.3,
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
