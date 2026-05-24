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
import { useUserStore } from '@/stores/useUserStore';

// ── Constants ──────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');

/**
 * Carbon score thresholds (kg CO₂e).
 * Below LOW  → vibrant green (excellent).
 * Above HIGH → dull gray (needs improvement).
 * Between    → interpolated gradient.
 */
const SCORE_LOW = 50;
const SCORE_HIGH = 500;

const COLOR_GREEN = '#059669'; // eco-600
const COLOR_MID = '#facc15';   // amber-400
const COLOR_GRAY = '#525252';  // carbon-600

const BG_GREEN = '#ecfdf5';    // eco-50
const BG_MID = '#fefce8';      // amber-50
const BG_GRAY = '#fafafa';     // carbon-50

// ── Helpers ────────────────────────────────────────────────

/** Normalize a carbon score to 0–1 for animation interpolation. */
function normalizeScore(score: number): number {
  'worklet';
  if (score <= SCORE_LOW) return 0;
  if (score >= SCORE_HIGH) return 1;
  return (score - SCORE_LOW) / (SCORE_HIGH - SCORE_LOW);
}

function getScoreLabel(score: number): string {
  if (score <= SCORE_LOW) return 'Excellent';
  if (score <= 200) return 'Good';
  if (score <= 350) return 'Moderate';
  return 'Needs Work';
}

// ── Component ──────────────────────────────────────────────

export const HomeScreen: React.FC = () => {
  const { user, loading, error, fetchUser } = useUserStore();

  // Shared value that drives all color animations
  const progress = useSharedValue(0);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Animate progress whenever carbon_score changes
  useEffect(() => {
    if (user) {
      progress.value = withTiming(normalizeScore(user.carbon_score), {
        duration: 1200,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [user?.carbon_score, progress, user]);

  // ── Animated Styles ──

  const animatedBackground = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 0.5, 1],
      [BG_GREEN, BG_MID, BG_GRAY],
    ),
  }));

  const animatedAccent = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 0.5, 1],
      [COLOR_GREEN, COLOR_MID, COLOR_GRAY],
    ),
  }));

  const animatedTextColor = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 0.5, 1],
      [COLOR_GREEN, COLOR_MID, COLOR_GRAY],
    ),
  }));

  const animatedRingScale = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (1 - progress.value) * 0.15 }],
    opacity: 1 - progress.value * 0.3,
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

  const score = user?.carbon_score ?? 0;

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

      {/* ── Carbon Score Ring ── */}
      <Animated.View style={[styles.scoreRingOuter, animatedRingScale]}>
        <Animated.View style={[styles.scoreRingInner, animatedAccent]}>
          <Text style={styles.scoreValue}>{score.toFixed(1)}</Text>
          <Text style={styles.scoreUnit}>kg CO₂e</Text>
        </Animated.View>
      </Animated.View>

      <Animated.Text style={[styles.scoreLabel, animatedTextColor]}>
        {getScoreLabel(score)}
      </Animated.Text>

      {/* ── Stats Row ── */}
      <View style={styles.statsRow}>
        <StatCard
          label="Saved"
          value={`${(user?.carbon_saved ?? 0).toFixed(1)} kg`}
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

      {/* ── 3D Element Placeholder ── */}
      <View style={styles.webglPlaceholder}>
        <Text style={styles.placeholderText}>
          [ 3D WebGL Earth — @react-three/fiber ]
        </Text>
        <Text style={styles.placeholderSubtext}>
          Renders a rotating globe whose vegetation density reflects your score
        </Text>
      </View>

      {/* ── Quick Actions ── */}
      <View style={styles.actionsRow}>
        <ActionButton label="Log Trip" icon="🚲" onPress={() => {}} />
        <ActionButton label="Scan Item" icon="📷" onPress={() => {}} />
        <ActionButton label="Share" icon="🤝" onPress={() => {}} />
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

  // 3D placeholder
  webglPlaceholder: {
    height: 140,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(0,0,0,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  placeholderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a3a3a3',
  },
  placeholderSubtext: {
    fontSize: 11,
    color: '#d4d4d4',
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  // Quick actions
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  actionButton: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 16,
    minWidth: 90,
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
