import React, { useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUserStore } from '@/stores/useUserStore';
import { usePlaidStore } from '@/stores/usePlaidStore';
import type { Transaction, TransactionCategory } from '@/types/database';

const CATEGORY_EMOJI: Record<TransactionCategory, string> = {
  food: '🍽️',
  transport: '🚗',
  housing: '🏠',
  clothing: '🛍️',
  electronics: '🔌',
  services: '🧾',
  entertainment: '🎬',
  utilities: '💡',
  other: '•',
};

/** Renders e.g. "May 14" for a transaction_date (YYYY-MM-DD). */
function shortDate(iso: string): string {
  // Parse as local date — transaction_date is just a calendar day, no tz.
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "$12.34", with parentheses for refunds. NUMERIC columns arrive as
 *  strings from supabase-js, so the caller coerces upstream of this. */
function formatAmount(amount: number, currency: string): string {
  const abs = Math.abs(amount).toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `(${abs})` : abs;
}

const TransactionRow: React.FC<{ tx: Transaction }> = ({ tx }) => {
  // supabase-js returns NUMERIC columns as strings to preserve precision —
  // coerce on read so .toFixed() / arithmetic don't blow up.
  const amount = Number(tx.amount);
  const carbonKg = Number(tx.carbon_kg);

  return (
    <View className="flex-row items-center py-3 border-t border-carbon-100">
      <Text className="text-lg mr-3">{CATEGORY_EMOJI[tx.category] ?? '•'}</Text>
      <View className="flex-1 mr-3">
        <Text className="text-carbon-900 text-sm font-medium" numberOfLines={1}>
          {tx.merchant_name ?? 'Unknown merchant'}
        </Text>
        <Text className="text-carbon-500 text-xs">
          {shortDate(tx.transaction_date)} · {tx.category}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-carbon-900 text-sm font-semibold">
          {formatAmount(amount, tx.currency)}
        </Text>
        <Text className="text-eco-700 text-xs">
          {carbonKg.toFixed(2)} kg CO₂
        </Text>
      </View>
    </View>
  );
};

export const ProfileScreen: React.FC = () => {
  const { signOut, busy: authBusy, session } = useAuthStore();
  const user = useUserStore((s) => s.user);
  const {
    connectBank,
    busy: plaidBusy,
    error: plaidError,
    clearError,
    syncTransactions,
    fetchRecentTransactions,
    syncing,
    syncError,
    clearSyncError,
    lastSync,
    transactions,
  } = usePlaidStore();

  const isBankConnected = Boolean(user?.plaid_item_id);

  // Once the bank is linked, pre-populate the recent-transactions list from
  // the DB on mount so the screen isn't empty before the user taps Sync.
  useEffect(() => {
    if (isBankConnected) {
      fetchRecentTransactions();
    }
  }, [isBankConnected, fetchRecentTransactions]);

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
                  Sync your transactions to estimate the carbon impact of
                  your spending over the last 30 days.
                </Text>

                <Pressable
                  onPress={() => {
                    clearSyncError();
                    syncTransactions();
                  }}
                  disabled={syncing}
                  className={`rounded-xl py-3 items-center mb-2 ${
                    syncing ? 'bg-carbon-300' : 'bg-eco-600'
                  }`}
                >
                  {syncing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-white text-sm font-semibold">
                      Sync transactions
                    </Text>
                  )}
                </Pressable>

                {lastSync ? (
                  <Text className="text-carbon-500 text-xs">
                    Last sync: {lastSync.upserted} updated of {lastSync.fetched} fetched ·{' '}
                    {lastSync.total_carbon_kg.toFixed(2)} kg CO₂
                  </Text>
                ) : null}
                {syncError ? (
                  <Text className="text-red-600 text-xs mt-2">{syncError}</Text>
                ) : null}

                <Text className="text-carbon-400 text-[10px] mt-3" numberOfLines={1}>
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

          {/* ─── Recent spending (only shown after bank is connected) ─── */}
          {isBankConnected ? (
            <View className="bg-white rounded-2xl p-5 mb-5 border border-carbon-100">
              <Text className="text-carbon-900 text-base font-bold mb-1">
                Recent spending
              </Text>
              <Text className="text-carbon-500 text-xs mb-3">
                Carbon estimated from category averages (Phase 3 will replace
                these with live Climatiq lookups).
              </Text>

              {transactions.length === 0 ? (
                <Text className="text-carbon-500 text-sm py-4 text-center">
                  No transactions yet. Tap "Sync transactions" to pull the last
                  30 days from your bank.
                </Text>
              ) : (
                transactions.map((tx) => <TransactionRow key={tx.id} tx={tx} />)
              )}
            </View>
          ) : null}

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
