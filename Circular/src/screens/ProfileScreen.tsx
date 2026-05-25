import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUserStore } from '@/stores/useUserStore';

export const ProfileScreen: React.FC = () => {
  const { signOut, busy, session } = useAuthStore();
  const user = useUserStore((s) => s.user);

  return (
    <SafeAreaView className="flex-1 bg-eco-50">
      <View className="flex-1 px-8 pt-8">
        <Text className="text-carbon-900 text-3xl font-bold mb-1">Profile</Text>
        <Text className="text-carbon-600 text-sm mb-10">
          {session?.user.email ?? 'Signed in'}
        </Text>

        {user ? (
          <View className="bg-white rounded-2xl p-5 mb-6 border border-carbon-100">
            <Text className="text-carbon-500 text-xs font-semibold uppercase mb-2">
              Display name
            </Text>
            <Text className="text-carbon-900 text-lg font-medium mb-4">
              {user.display_name}
            </Text>

            <View className="flex-row justify-between">
              <View>
                <Text className="text-carbon-500 text-xs font-semibold uppercase mb-1">
                  Level
                </Text>
                <Text className="text-eco-700 text-2xl font-bold">{user.level}</Text>
              </View>
              <View>
                <Text className="text-carbon-500 text-xs font-semibold uppercase mb-1">
                  XP
                </Text>
                <Text className="text-eco-700 text-2xl font-bold">{user.xp}</Text>
              </View>
              <View>
                <Text className="text-carbon-500 text-xs font-semibold uppercase mb-1">
                  Streak
                </Text>
                <Text className="text-eco-700 text-2xl font-bold">
                  {user.streak_days}d
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={signOut}
          disabled={busy}
          className="bg-white border border-red-200 rounded-xl py-4 items-center mt-auto mb-4"
        >
          {busy ? (
            <ActivityIndicator color="#dc2626" />
          ) : (
            <Text className="text-red-600 text-base font-semibold">Sign out</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
};
