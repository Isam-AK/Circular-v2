import React, { useEffect } from 'react';
import { View, Text, FlatList, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMobilityStore } from '@/stores/useMobilityStore';
import { MODE_META, savingsForTrip } from '@/lib/emissions';
import type { MobilityLog } from '@/types/database';

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isToday) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const TripRow: React.FC<{ trip: MobilityLog }> = ({ trip }) => {
  const meta = MODE_META[trip.mode];
  // Compute savings from stored values to stay consistent with current emission factors.
  const saved = savingsForTrip(trip.mode, Number(trip.distance_km));
  const emitted = Number(trip.carbon_kg);

  return (
    <View className="bg-white rounded-2xl p-4 mb-3 border border-carbon-100 flex-row items-center">
      <Text className="text-3xl mr-4">{meta.icon}</Text>
      <View className="flex-1">
        <Text className="text-carbon-900 text-base font-semibold">
          {meta.label}
        </Text>
        <Text className="text-carbon-500 text-xs mt-0.5">
          {formatDate(trip.started_at)} · {Number(trip.distance_km).toFixed(1)} km
        </Text>
      </View>
      <View className="items-end">
        {saved > 0 ? (
          <>
            <Text className="text-eco-700 text-base font-semibold">
              +{saved.toFixed(2)} kg
            </Text>
            <Text className="text-carbon-400 text-[10px] mt-0.5">saved</Text>
          </>
        ) : (
          <>
            <Text className="text-carbon-700 text-base font-semibold">
              {emitted.toFixed(2)} kg
            </Text>
            <Text className="text-carbon-400 text-[10px] mt-0.5">emitted</Text>
          </>
        )}
      </View>
    </View>
  );
};

export const TripsScreen: React.FC = () => {
  const { trips, busy, error, fetchTrips } = useMobilityStore();

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  return (
    <SafeAreaView className="flex-1 bg-eco-50">
      <View className="px-5 pt-4 pb-2">
        <Text className="text-carbon-900 text-3xl font-bold">Trips</Text>
        <Text className="text-carbon-600 text-sm mt-1">
          Every trip you log shapes your carbon footprint.
        </Text>
      </View>

      {busy && trips.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#059669" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-red-600 text-sm mb-3 text-center">{error}</Text>
          <Pressable
            onPress={fetchTrips}
            className="bg-eco-600 rounded-xl px-5 py-2"
          >
            <Text className="text-white font-semibold">Retry</Text>
          </Pressable>
        </View>
      ) : trips.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-5xl mb-3">🚲</Text>
          <Text className="text-carbon-700 text-base font-semibold mb-1">
            No trips yet
          </Text>
          <Text className="text-carbon-500 text-sm text-center">
            Tap "Log Trip" on the Home screen to record your first journey.
          </Text>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TripRow trip={item} />}
          contentContainerStyle={{ padding: 20, paddingTop: 12 }}
          refreshing={busy}
          onRefresh={fetchTrips}
        />
      )}
    </SafeAreaView>
  );
};
