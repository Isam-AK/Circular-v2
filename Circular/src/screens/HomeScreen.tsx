import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useUserStore } from '@/stores/useUserStore';
import { savingsTierLabel } from '@/lib/emissions';
import type { AppStackParamList } from './navigation';

// ── Constants ──────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');

/**
 * Savings thresholds (kg CO₂e saved vs. petrol-car baseline).
 *   0       → neutral gray / "just starting"
 *   200+    → fully saturated green / "climate champion"
 * Curve is logarithmic so the first kg saved produces a visible color
 * shift, then progress slows. Linear made early trips look identical to
 * having zero savings.
 */
const SAVED_HIGH = 200;

const COLOR_GREEN = '#059669'; // eco-600
const COLOR_MID = '#facc15';   // amber-400
const COLOR_GRAY = '#525252';  // carbon-600

const BG_GREEN = '#ecfdf5';    // eco-50
const BG_MID = '#fefce8';      // amber-50
const BG_GRAY = '#fafafa';     // carbon-50

// ── Helpers ────────────────────────────────────────────────

/**
 * Normalize savings to 0–1 for animation interpolation, on a log curve.
 *   0 kg     → 0
 *   1 kg     → ~0.13   (visible amber tint)
 *   10 kg    → ~0.45   (clearly mid)
 *   50 kg    → ~0.74
 *   200+ kg  → 1       (fully green)
 */
function normalizeSavings(saved: number): number {
  'worklet';
  if (saved <= 0) return 0;
  if (saved >= SAVED_HIGH) return 1;
  return Math.log10(saved + 1) / Math.log10(SAVED_HIGH + 1);
}

// ── Component ──────────────────────────────────────────────

export const HomeScreen: React.FC = () => {
  const { user, loading, error, fetchUser } = useUserStore();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();

  // Shared value that drives all color animations
  const progress = useSharedValue(0);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Animate progress whenever carbon_saved changes. Higher savings = fuller animation.
  useEffect(() => {
    if (user) {
      progress.value = withTiming(normalizeSavings(user.carbon_saved), {
        duration: 1200,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [user?.carbon_saved, progress, user]);

  // ── Animated Styles ──
  // Gradient is inverted vs. the old footprint design: progress 0 = gray ("just starting"),
  // progress 1 = vibrant green ("climate champion"). Mid-progress flows through amber.

  const animatedBackground = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 0.5, 1],
      [BG_GRAY, BG_MID, BG_GREEN],
    ),
  }));

  const animatedAccent = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 0.5, 1],
      [COLOR_GRAY, COLOR_MID, COLOR_GREEN],
    ),
  }));

  const animatedTextColor = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 0.5, 1],
      [COLOR_GRAY, COLOR_MID, COLOR_GREEN],
    ),
  }));

  const animatedRingScale = useAnimatedStyle(() => ({
    transform: [{ scale: 0.85 + progress.value * 0.15 }],
    opacity: 0.7 + progress.value * 0.3,
  }));

  // ── Pull to refresh ──

  const handleRefresh = useCallback(() => {
    fetchUser();
  }, [fetchUser]);

  // ── Render ──

  if (loading && !user) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLOR_GREEN} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={handleRefresh} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const saved = user?.carbon_saved ?? 0;
  const footprint = user?.carbon_score ?? 0;

  return (
    <Animated.View style={[styles.container, animatedBackground]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          Hey, {user?.display_name ?? 'there'}
        </Text>
        <Animated.Text style={[styles.levelBadge, animatedAccent]}>
          Lv.{user?.level ?? 1}
        </Animated.Text>
      </View>

      {/* ── Carbon Savings Ring (hero metric) ── */}
      <Animated.View style={[styles.scoreRingOuter, animatedRingScale]}>
        <Animated.View style={[styles.scoreRingInner, animatedAccent]}>
          <Text style={styles.scoreValue}>{saved.toFixed(1)}</Text>
          <Text style={styles.scoreUnit}>kg CO₂e saved</Text>
        </Animated.View>
      </Animated.View>

      <Animated.Text style={[styles.scoreLabel, animatedTextColor]}>
        {savingsTierLabel(saved)}
      </Animated.Text>

      {/* ── Stats Row ── */}
      <View style={styles.statsRow}>
        <StatCard
          label="Footprint"
          value={`${footprint.toFixed(1)} kg`}
        />
        <StatCard
          label="Streak"
          value={`${user?.streak_days ?? 0} days`}
        />
        <StatCard
          label="XP"
          value={`${user?.xp ?? 0}`}
        />
      </View>

      {/* ── "View your globe" CTA — opens GlobeScreen modal ── */}
      <Pressable
        onPress={() => navigation.navigate('Globe')}
        style={styles.globeCta}
      >
        <Text style={styles.globeCtaIcon}>🌍</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.globeCtaTitle}>View your impact globe</Text>
          <Text style={styles.globeCtaSubtitle}>
            See your sustainability planet
          </Text>
        </View>
        <Text style={styles.globeCtaArrow}>›</Text>
      </Pressable>

      {/* ── Quick Actions ── */}
      <View style={styles.actionsRow}>
        <ActionButton
          label="Log Trip"
          icon="🚲"
          onPress={() => navigation.navigate('LogTrip')}
        />
        <ActionButton
          label="Scan Item"
          icon="📷"
          onPress={() => navigation.navigate('ScanItem')}
        />
        <ActionButton
          label="Recycle"
          icon="♻️"
          onPress={() => navigation.navigate('Recycle')}
        />
        <ActionButton
          label="Share"
          icon="🤝"
          // Hop into the Share tab inside the parent Tabs navigator.
          // The tab itself owns its own data fetch on focus.
          onPress={() => navigation.getParent()?.navigate('Tabs', { screen: 'Share' })}
        />
      </View>
    </Animated.View>
  );
};

// ── Sub-components ─────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value }) => (
  <View style={styles.statCard}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

interface ActionButtonProps {
  label: string;
  icon: string;
  onPress: () => void;
}

const ActionButton: React.FC<ActionButtonProps> = ({ label, icon, onPress }) => (
  <Pressable onPress={onPress} style={styles.actionButton}>
    <Text style={styles.actionIcon}>{icon}</Text>
    <Text style={styles.actionLabel}>{label}</Text>
  </Pressable>
);

// ── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BG_GREEN,
  },
  errorText: {
    fontSize: 16,
    color: '#dc2626',
    marginBottom: 12,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: COLOR_GREEN,
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: '#171717',
  },
  levelBadge: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },

  // Score ring
  scoreRingOuter: {
    alignSelf: 'center',
    width: SCREEN_W * 0.52,
    height: SCREEN_W * 0.52,
    borderRadius: SCREEN_W * 0.26,
    borderWidth: 3,
    borderColor: 'rgba(0,0,0,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  scoreRingInner: {
    width: SCREEN_W * 0.42,
    height: SCREEN_W * 0.42,
    borderRadius: SCREEN_W * 0.21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreValue: {
    fontSize: 42,
    fontWeight: '800',
    color: '#fff',
  },
  scoreUnit: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  scoreLabel: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 28,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.7)',
    marginHorizontal: 4,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#171717',
  },
  statLabel: {
    fontSize: 12,
    color: '#737373',
    marginTop: 2,
  },

  // "View your globe" CTA card — opens the GlobeScreen modal
  globeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 24,
  },
  globeCtaIcon: {
    fontSize: 32,
    marginRight: 14,
  },
  globeCtaTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#171717',
  },
  globeCtaSubtitle: {
    fontSize: 12,
    color: '#737373',
    marginTop: 2,
  },
  globeCtaArrow: {
    fontSize: 24,
    color: '#a3a3a3',
    fontWeight: '300',
    marginLeft: 8,
  },

  // Quick actions — 2×2 grid so a 4th button doesn't overflow one row
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  actionButton: {
    alignItems: 'center',
    paddingVertical: 14,
    width: '47%',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 16,
  },
  actionIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#404040',
  },
});

export default HomeScreen;
