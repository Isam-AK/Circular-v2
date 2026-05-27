import React from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUserStore } from '@/stores/useUserStore';
import { usePlaidStore } from '@/stores/usePlaidStore';

export const ProfileScreen: React.FC = () => {
  const { signOut, busy: authBusy, session } = useAuthStore();
  const user = useUserStore((s) => s.user);
  const { connectBank, busy: plaidBusy, error: plaidError, clearError } =
    usePlaidStore();

  const isBankConnected = Boolean(user?.plaid_item_id);

  return (
    <SafeAreaView className="flex-1 bg-eco-50">
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="flex-1 px-8 pt-8">
          <Text className="text-carbon-900 text-3xl font-bold mb-1">Profile</Text>
          <Text className="text-carbon-600 text-sm mb-8">
            {session?.user.email ?? 'Signed in'}
          </Text>

          {/* ─── Profile stats ─── */}
          {user ? (
            <View className="bg-white rounded-2xl p-5 mb-5 border border-carbon-100">
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

          {/* ─── Banking card ─── */}
          <View className="bg-white rounded-2xl p-5 mb-5 border border-carbon-100">
            <View className="flex-row items-center mb-3">
              <Text className="text-2xl mr-2">🏦</Text>
              <Text className="text-carbon-900 text-base font-bold">Banking</Text>
            </View>

            {isBankConnected ? (
              <>
                <View className="flex-row items-center mb-1">
                  <View className="w-2 h-2 rounded-full bg-eco-500 mr-2" />
                  <Text className="text-carbon-700 text-sm font-semibold">
                    Bank connected
                  </Text>
                </View>
                <Text className="text-carbon-500 text-xs mb-3">
                  Transactions will sync in the background to estimate your
                  spending-based carbon footprint.
                </Text>
                <Text className="text-carbon-400 text-[10px]" numberOfLines={1}>
                  Item ID: {user?.plaid_item_id}
                </Text>
              </>
            ) : (
              <>
                <Text className="text-carbon-500 text-sm mb-4 leading-5">
                  Link a bank account to passively track the carbon impact of
                  your spending. We never see your password — Plaid handles
                  the connection securely.
                </Text>
                <Pressable
                  onPress={() => {
                    clearError();
                    connectBank();
                  }}
                  disabled={plaidBusy}
                  className={`rounded-xl py-3 items-center ${
                    plaidBusy ? 'bg-carbon-300' : 'bg-eco-600'
                  }`}
                >
                  {plaidBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-white text-sm font-semibold">
                      Connect a bank account
                    </Text>
                  )}
                </Pressable>
                {plaidError ? (
                  <Text className="text-red-600 text-xs mt-3">{plaidError}</Text>
                ) : null}
              </>
            )}
          </View>

          {/* ─── Sign out ─── */}
          <Pressable
            onPress={signOut}
            disabled={authBusy}
            className="bg-white border border-red-200 rounded-xl py-4 items-center mt-4"
          >
            {authBusy ? (
              <ActivityIndicator color="#dc2626" />
            ) : (
              <Text className="text-red-600 text-base font-semibold">Sign out</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
