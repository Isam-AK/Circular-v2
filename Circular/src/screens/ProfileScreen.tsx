import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUserStore } from '@/stores/useUserStore';
import { usePlaidStore } from '@/stores/usePlaidStore';
import type { Transaction, TransactionCategory } from '@/types/database';
import type { AppStackParamList } from './navigation';

/**
 * Pick the best emoji + human-readable label for a transaction. We prefer
 * the climatiq_activity_id (most specific — distinguishes air vs ground
 * transport, electronics vs clothing, restaurant vs groceries, etc.) and
 * fall back to the broader DB category when the activity id is missing
 * or unrecognised.
 *
 * Substring patterns target the CEDA activity_id taxonomy (see
 * supabase/functions/_shared/spend-carbon.ts). Order matters: most
 * specific match first, so e.g. `book_publishers` is checked before
 * the generic `paper_products` prefix.
 */
function displayMetaFor(tx: Transaction): { emoji: string; label: string } {
  const aid = tx.climatiq_activity_id ?? '';

  // Internal sentinels first.
  if (aid === 'circular:no-impact') return { emoji: '💸', label: 'Transfer' };
  if (aid === 'circular:micromobility') return { emoji: '🛴', label: 'Micromobility' };

  // CEDA — most specific → least specific.
  if (aid.includes('air_transportation')) return { emoji: '✈️', label: 'Flight' };
  if (aid.includes('transit_and_ground_passenger_transportation'))
    return { emoji: '🚆', label: 'Ground transit' };
  if (aid.includes('automotive_equipment_rental')) return { emoji: '🚗', label: 'Car rental' };
  if (aid.includes('gasoline_stations')) return { emoji: '⛽', label: 'Gas' };
  if (aid.includes('limited_service_restaurants')) return { emoji: '🥡', label: 'Quick service' };
  if (aid.includes('full_service_restaurants')) return { emoji: '🍽️', label: 'Restaurant' };
  if (aid.includes('food_and_beverage_stores')) return { emoji: '🛒', label: 'Groceries' };
  if (aid.includes('clothing_and_clothing_accessories_stores'))
    return { emoji: '👕', label: 'Clothing' };
  if (aid.includes('electronics-type_')) return { emoji: '🔌', label: 'Electronics' };
  if (aid.includes('book_publishers')) return { emoji: '📚', label: 'Books' };
  if (aid.includes('accommodation-type_accommodation')) return { emoji: '🏨', label: 'Lodging' };
  if (aid.includes('cable_and_other_subscription_programming'))
    return { emoji: '📺', label: 'Cable / TV' };
  if (aid.includes('internet_publishing_and_broadcasting'))
    return { emoji: '📡', label: 'Internet' };
  if (aid.includes('amusement_parks_arcades')) return { emoji: '🎢', label: 'Amusement' };
  if (aid.includes('other_amusement_and_recreation'))
    return { emoji: '🎬', label: 'Entertainment' };
  if (aid.includes('spectator_sports')) return { emoji: '🏟️', label: 'Spectator sports' };
  if (aid.includes('electricity-supply_electric_power'))
    return { emoji: '💡', label: 'Electricity' };
  if (aid.includes('natural_gas_distribution')) return { emoji: '🔥', label: 'Natural gas' };
  if (aid.includes('water_treatment-type_water_sewage')) return { emoji: '💧', label: 'Water' };
  if (aid.includes('hospitals')) return { emoji: '🏥', label: 'Hospital' };
  if (aid.includes('health_and_personal_care_stores'))
    return { emoji: '💊', label: 'Pharmacy' };
  if (aid.includes('personal_care_services')) return { emoji: '💇', label: 'Personal care' };
  if (aid.includes('general_merchandise_stores')) return { emoji: '🛍️', label: 'Merchandise' };

  // Fallback by DB category (for rows synced before Phase 2 polish, or
  // anything the activity-id matcher missed).
  const dbFallback: Record<TransactionCategory, { emoji: string; label: string }> = {
    food:          { emoji: '🍽️', label: 'Food' },
    transport:     { emoji: '🚗', label: 'Transport' },
    housing:       { emoji: '🏠', label: 'Housing' },
    clothing:      { emoji: '🛍️', label: 'Clothing' },
    electronics:   { emoji: '🔌', label: 'Electronics' },
    services:      { emoji: '🧾', label: 'Services' },
    entertainment: { emoji: '🎬', label: 'Entertainment' },
    utilities:     { emoji: '💡', label: 'Utilities' },
    other:         { emoji: '•',  label: 'Other' },
  };
  return dbFallback[tx.category] ?? { emoji: '•', label: 'Other' };
}

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
  const { emoji, label } = displayMetaFor(tx);

  return (
    <View className="flex-row items-center py-3 border-t border-carbon-100">
      <Text className="text-lg mr-3">{emoji}</Text>
      <View className="flex-1 mr-3">
        <Text className="text-carbon-900 text-sm font-medium" numberOfLines={1}>
          {tx.merchant_name ?? 'Unknown merchant'}
        </Text>
        <Text className="text-carbon-500 text-xs">
          {shortDate(tx.transaction_date)} · {label}
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

// ── Account sub-card: "Change password" expandable form ──
const ChangePasswordForm: React.FC = () => {
  const { changePassword, changingPassword, error, clearError } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [success, setSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirm('');
    setSuccess(null);
    setLocalError(null);
    clearError();
  };

  const handleSubmit = async () => {
    setLocalError(null);
    setSuccess(null);
    if (newPassword.length < 6) {
      setLocalError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setLocalError('New password and confirmation do not match.');
      return;
    }
    const ok = await changePassword(currentPassword, newPassword);
    if (ok) {
      setSuccess('Password updated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      // Collapse after a beat so the user sees the success message.
      setTimeout(() => setOpen(false), 1200);
    }
  };

  const banner = localError ?? error;

  if (!open) {
    return (
      <Pressable
        onPress={() => {
          reset();
          setOpen(true);
        }}
        className="flex-row items-center justify-between py-1"
      >
        <Text className="text-carbon-900 text-sm font-semibold">Change password</Text>
        <Text className="text-carbon-400 text-base">›</Text>
      </Pressable>
    );
  }

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-carbon-900 text-sm font-semibold">Change password</Text>
        <Pressable
          hitSlop={8}
          onPress={() => {
            reset();
            setOpen(false);
          }}
        >
          <Text className="text-carbon-500 text-xs font-semibold">Cancel</Text>
        </Pressable>
      </View>

      <TextInput
        value={currentPassword}
        onChangeText={setCurrentPassword}
        placeholder="Current password"
        placeholderTextColor="#a3a3a3"
        secureTextEntry
        autoCapitalize="none"
        textContentType="password"
        className="bg-eco-50 border border-carbon-200 rounded-xl px-4 py-3 mb-3 text-carbon-900 text-sm"
      />
      <TextInput
        value={newPassword}
        onChangeText={setNewPassword}
        placeholder="New password (min 6 chars)"
        placeholderTextColor="#a3a3a3"
        secureTextEntry
        autoCapitalize="none"
        textContentType="newPassword"
        className="bg-eco-50 border border-carbon-200 rounded-xl px-4 py-3 mb-3 text-carbon-900 text-sm"
      />
      <TextInput
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Confirm new password"
        placeholderTextColor="#a3a3a3"
        secureTextEntry
        autoCapitalize="none"
        className="bg-eco-50 border border-carbon-200 rounded-xl px-4 py-3 mb-3 text-carbon-900 text-sm"
      />

      {banner ? (
        <Text className="text-red-600 text-xs mb-3">{banner}</Text>
      ) : null}
      {success ? (
        <Text className="text-eco-700 text-xs font-semibold mb-3">{success}</Text>
      ) : null}

      <Pressable
        onPress={handleSubmit}
        disabled={changingPassword || !currentPassword || !newPassword || !confirm}
        className={`rounded-xl py-3 items-center ${
          changingPassword || !currentPassword || !newPassword || !confirm
            ? 'bg-carbon-300'
            : 'bg-eco-600'
        }`}
      >
        {changingPassword ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-sm font-semibold">Update password</Text>
        )}
      </Pressable>
    </View>
  );
};

// ── Avatar + Display name editable card ──
const ProfileHeaderCard: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const user = useUserStore((s) => s.user);
  const { updateProfile, saving } = useUserStore();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(user?.display_name ?? '');

  if (!user) return null;

  const startEditing = () => {
    setDraftName(user.display_name);
    setEditing(true);
  };
  const cancelEditing = () => {
    setEditing(false);
    setDraftName(user.display_name);
  };
  const save = async () => {
    const trimmed = draftName.trim();
    if (trimmed.length < 1) {
      setEditing(false);
      return;
    }
    await updateProfile({ display_name: trimmed });
    setEditing(false);
  };

  return (
    <View className="bg-white rounded-2xl p-5 mb-5 border border-carbon-100">
      <View className="flex-row items-center mb-4">
        {/* Avatar — tap to update via camera */}
        <Pressable
          onPress={() => navigation.navigate('AvatarCapture')}
          className="mr-4"
        >
          {user.avatar_url ? (
            <Image
              source={{ uri: user.avatar_url }}
              style={{ width: 72, height: 72, borderRadius: 36 }}
            />
          ) : (
            <View className="w-[72px] h-[72px] rounded-full bg-eco-100 items-center justify-center border border-eco-200">
              <Text className="text-eco-700 text-2xl font-bold">
                {user.display_name?.[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
          {/* Camera badge */}
          <View className="absolute bottom-0 right-0 bg-eco-600 rounded-full w-6 h-6 items-center justify-center border-2 border-white">
            <Text className="text-white text-[10px]">📷</Text>
          </View>
        </Pressable>

        {/* Name + edit */}
        <View className="flex-1">
          {editing ? (
            <>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                autoFocus
                maxLength={50}
                placeholder="Your display name"
                placeholderTextColor="#a3a3a3"
                className="bg-eco-50 border border-eco-200 rounded-lg px-3 py-2 text-carbon-900 text-base"
              />
              <View className="flex-row mt-2">
                <Pressable
                  onPress={save}
                  disabled={saving}
                  className={`mr-2 rounded-md px-3 py-1 ${
                    saving ? 'bg-carbon-300' : 'bg-eco-600'
                  }`}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text className="text-white text-xs font-semibold">Save</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={cancelEditing}
                  className="rounded-md px-3 py-1 border border-carbon-200"
                >
                  <Text className="text-carbon-700 text-xs font-semibold">Cancel</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable onPress={startEditing} className="flex-row items-center">
              <Text className="text-carbon-900 text-xl font-semibold mr-2" numberOfLines={1}>
                {user.display_name}
              </Text>
              <Text className="text-carbon-400 text-xs">✎</Text>
            </Pressable>
          )}
          <Text className="text-carbon-500 text-xs mt-0.5">Tap to edit</Text>
        </View>
      </View>

      <View className="flex-row justify-between border-t border-carbon-100 pt-4">
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

          {/* ─── Avatar + Display name + stats ─── */}
          <ProfileHeaderCard />

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
                  <>
                    <Text className="text-carbon-500 text-xs">
                      Last sync: {lastSync.upserted} updated of {lastSync.fetched} fetched ·{' '}
                      {lastSync.total_carbon_kg.toFixed(2)} kg CO₂
                    </Text>
                    {(lastSync.liveFactorCount + lastSync.fallbackFactorCount) > 0 ? (
                      <Text className="text-carbon-400 text-[10px] mt-0.5">
                        {lastSync.liveFactorCount} live Climatiq ·{' '}
                        {lastSync.fallbackFactorCount} fallback
                      </Text>
                    ) : null}
                  </>
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
                Carbon estimated per dollar via Climatiq's CEDA US dataset
                (with category-average fallback when an activity isn't
                mapped yet).
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

          {/* ─── Account (password change) ─── */}
          <View className="bg-white rounded-2xl p-5 mb-5 border border-carbon-100">
            <View className="flex-row items-center mb-3">
              <Text className="text-2xl mr-2">🔒</Text>
              <Text className="text-carbon-900 text-base font-bold">Account</Text>
            </View>
            <ChangePasswordForm />
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
