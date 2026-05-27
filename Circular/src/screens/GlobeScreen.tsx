import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Globe } from '@/components/Globe';
import { useUserStore } from '@/stores/useUserStore';
import { savingsTierLabel } from '@/lib/emissions';

interface GlobeScreenProps {
  /** Provided by App.tsx via navigation.goBack(). */
  onClose: () => void;
}

/**
 * Full-screen modal showing the user's "impact globe" — the procedural
 * SkSL sphere whose colors reflect lifetime carbon savings. Designed as a
 * "moment" the user opens deliberately from the Home screen, rather than
 * permanent dashboard furniture.
 */
export const GlobeScreen: React.FC<GlobeScreenProps> = ({ onClose }) => {
  const user = useUserStore((s) => s.user);
  const saved = user?.carbon_saved ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-eco-50">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-3 border-b border-carbon-100">
        <Pressable onPress={onClose} hitSlop={12}>
          <Text className="text-carbon-600 text-base">Close</Text>
        </Pressable>
        <Text className="text-carbon-900 text-base font-semibold">Your impact globe</Text>
        <View style={{ width: 56 }} />
      </View>

      {/* Globe — gets the full middle of the screen */}
      <View style={{ flex: 1 }}>
        <Globe savedKg={saved} />
      </View>

      {/* Bottom: prominent stat + tier */}
      <View className="px-8 pb-10 items-center">
        <Text className="text-carbon-500 text-xs uppercase font-semibold tracking-widest mb-2">
          Lifetime savings
        </Text>
        <View className="flex-row items-baseline mb-3">
          <Text className="text-eco-700 text-6xl font-extrabold">
            {saved.toFixed(1)}
          </Text>
          <Text className="text-carbon-700 text-2xl font-semibold ml-2">
            kg CO₂e
          </Text>
        </View>
        <Text className="text-carbon-600 text-base font-medium">
          {savingsTierLabel(saved)}
        </Text>
      </View>
    </SafeAreaView>
  );
};
