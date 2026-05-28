import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Geolocation from '@react-native-community/geolocation';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useItemStore } from '@/stores/useItemStore';
import type { SharedItem } from '@/types/database';
import type { AppStackParamList } from './navigation';

/** Haversine distance in meters between two WGS84 points. */
function distanceMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6_371_000; // earth radius in m
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** "120 m" / "1.4 km" formatting. */
function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

const CONDITION_LABEL: Record<SharedItem['condition'], string> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
  needs_repair: 'Needs repair',
};

const ItemCard: React.FC<{
  item: SharedItem;
  myLat: number | null;
  myLng: number | null;
}> = ({ item, myLat, myLng }) => {
  const cover = item.image_urls?.[0];
  // PostGIS returns location as a GeoJSON point — coords are [lng, lat].
  const itemLng = item.location?.coordinates?.[0];
  const itemLat = item.location?.coordinates?.[1];
  const dist =
    myLat != null && myLng != null && itemLat != null && itemLng != null
      ? distanceMeters(myLat, myLng, itemLat, itemLng)
      : null;

  return (
    <View className="bg-white rounded-2xl mb-3 border border-carbon-100 overflow-hidden">
      {cover ? (
        <Image
          source={{ uri: cover }}
          style={{ width: '100%', height: 160 }}
          resizeMode="cover"
        />
      ) : (
        <View className="w-full h-40 bg-carbon-100 items-center justify-center">
          <Text className="text-carbon-400 text-4xl">📦</Text>
        </View>
      )}
      <View className="p-4">
        <Text className="text-carbon-900 text-base font-semibold mb-1" numberOfLines={1}>
          {item.title}
        </Text>
        <View className="flex-row items-center">
          <Text className="text-carbon-500 text-xs">
            {CONDITION_LABEL[item.condition]}
          </Text>
          {dist != null ? (
            <>
              <Text className="text-carbon-300 text-xs mx-1.5">·</Text>
              <Text className="text-eco-700 text-xs font-semibold">
                {formatDistance(dist)} away
              </Text>
            </>
          ) : null}
        </View>
        {item.description ? (
          <Text className="text-carbon-600 text-xs mt-2" numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

export const ShareScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { nearby, loading, error, fetchNearby, clearError } = useItemStore();
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Get a fix, then fetch nearby. We don't block the screen on the
  // fix — if location is denied, we still surface a friendly message
  // and let the user try the "List an item" FAB anyway.
  const refresh = useCallback(() => {
    clearError();
    setLocationError(null);
    Geolocation.getCurrentPosition(
      (pos) => {
        const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setCoords(c);
        fetchNearby(c);
      },
      (err) => {
        setLocationError(
          err.message || 'Could not get current location for nearby items.',
        );
      },
      { timeout: 15000, maximumAge: 60_000, enableHighAccuracy: false },
    );
  }, [clearError, fetchNearby]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SafeAreaView className="flex-1 bg-eco-50">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 96, paddingHorizontal: 24, paddingTop: 24 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#059669" />
        }
      >
        <Text className="text-carbon-900 text-3xl font-bold mb-1">Share</Text>
        <Text className="text-carbon-600 text-sm mb-6">
          Items neighbors have offered up nearby.
        </Text>

        {locationError ? (
          <View className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <Text className="text-amber-800 text-xs leading-4">{locationError}</Text>
          </View>
        ) : null}
        {error ? (
          <View className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            <Text className="text-red-700 text-xs leading-4">{error}</Text>
          </View>
        ) : null}

        {loading && nearby.length === 0 ? (
          <View className="py-16 items-center">
            <ActivityIndicator color="#059669" />
          </View>
        ) : nearby.length === 0 ? (
          <View className="bg-white rounded-2xl p-8 items-center border border-carbon-100">
            <Text className="text-4xl mb-3">🌱</Text>
            <Text className="text-carbon-900 text-base font-semibold mb-1">
              Nothing nearby yet
            </Text>
            <Text className="text-carbon-500 text-xs text-center">
              Be the first to list something.
            </Text>
          </View>
        ) : (
          nearby.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              myLat={coords?.latitude ?? null}
              myLng={coords?.longitude ?? null}
            />
          ))
        )}
      </ScrollView>

      {/* FAB */}
      <Pressable
        onPress={() => navigation.navigate('ShareItem')}
        className="absolute bottom-6 right-6 bg-eco-600 rounded-full px-5 h-14 flex-row items-center justify-center shadow-lg"
        style={{
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
        }}
      >
        <Text className="text-white text-2xl mr-2 -mt-0.5">＋</Text>
        <Text className="text-white text-sm font-semibold">List an item</Text>
      </Pressable>
    </SafeAreaView>
  );
};
