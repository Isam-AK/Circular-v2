import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Geolocation from '@react-native-community/geolocation';
import { useItemStore } from '@/stores/useItemStore';
import type { ItemCondition } from '@/types/database';

interface ShareItemScreenProps {
  /** Wired in App.tsx to navigation.goBack(). */
  onClose: () => void;
  /** Forwarded from the Scan flow when the user came in via ScanItem. */
  initialPhotoUri?: string;
}

const CONDITIONS: { value: ItemCondition; label: string }[] = [
  { value: 'new',          label: 'New' },
  { value: 'like_new',     label: 'Like new' },
  { value: 'good',         label: 'Good' },
  { value: 'fair',         label: 'Fair' },
  { value: 'needs_repair', label: 'Needs repair' },
];

/** Promise wrapper around Geolocation.getCurrentPosition. */
function getCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(new Error(err.message || 'Could not get current location')),
      // High accuracy adds GPS warm-up time; for "list an item near me"
      // a network-grade fix is plenty.
      { timeout: 15000, maximumAge: 60_000, enableHighAccuracy: false },
    );
  });
}

export const ShareItemScreen: React.FC<ShareItemScreenProps> = ({
  onClose,
  initialPhotoUri,
}) => {
  const { createItem, publishing, error, clearError } = useItemStore();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState<ItemCondition>('good');
  const [photoUris, setPhotoUris] = useState<string[]>(
    initialPhotoUri ? [initialPhotoUri] : [],
  );
  // Local error covers validation + geolocation; store.error covers
  // upload/insert. Both surface in the same banner.
  const [localError, setLocalError] = useState<string | null>(null);

  const canPublish =
    title.trim().length > 0 && photoUris.length > 0 && !publishing;

  const handlePublish = async () => {
    setLocalError(null);
    clearError();

    if (!title.trim()) {
      setLocalError('Give your item a short title.');
      return;
    }
    if (photoUris.length === 0) {
      setLocalError('Add at least one photo so neighbors can see it.');
      return;
    }

    let coords: { latitude: number; longitude: number };
    try {
      coords = await getCurrentLocation();
    } catch (e) {
      setLocalError(
        `${(e as Error).message}. Open Settings → Privacy → Location to grant access.`,
      );
      return;
    }

    const created = await createItem({
      title: title.trim(),
      description: description.trim() || null,
      condition,
      photoUris,
      latitude: coords.latitude,
      longitude: coords.longitude,
    });

    if (created) {
      onClose();
    }
    // If null, useItemStore set `error`; the banner picks it up.
  };

  const removePhoto = (uri: string) => {
    setPhotoUris((prev) => prev.filter((u) => u !== uri));
  };

  const banner = localError ?? error;

  return (
    <SafeAreaView className="flex-1 bg-eco-50">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <View className="px-8 pt-8">
            {/* Header */}
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-carbon-900 text-3xl font-bold">List an item</Text>
              <Pressable hitSlop={12} onPress={onClose}>
                <Text className="text-carbon-500 text-sm font-semibold">Cancel</Text>
              </Pressable>
            </View>
            <Text className="text-carbon-600 text-sm mb-6">
              Help someone nearby skip a new purchase.
            </Text>

            {/* Photos */}
            <Text className="text-carbon-500 text-xs font-semibold uppercase mb-2">
              Photos
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 8 }}
              className="mb-5"
            >
              {photoUris.map((uri) => (
                <View key={uri} className="mr-3">
                  <Image
                    source={{ uri }}
                    style={{ width: 96, height: 96, borderRadius: 12 }}
                  />
                  <Pressable
                    onPress={() => removePhoto(uri)}
                    hitSlop={8}
                    className="absolute top-1 right-1 bg-carbon-900/70 rounded-full w-6 h-6 items-center justify-center"
                  >
                    <Text className="text-white text-xs">✕</Text>
                  </Pressable>
                </View>
              ))}
              {photoUris.length === 0 ? (
                <View className="w-24 h-24 rounded-xl border-2 border-dashed border-carbon-300 items-center justify-center">
                  <Text className="text-carbon-400 text-3xl">📷</Text>
                </View>
              ) : null}
            </ScrollView>

            {/* Title */}
            <Text className="text-carbon-500 text-xs font-semibold uppercase mb-2">
              Title
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Coffee grinder, barely used"
              placeholderTextColor="#a3a3a3"
              maxLength={80}
              className="bg-white rounded-xl border border-carbon-100 px-4 py-3 text-carbon-900 text-base mb-5"
            />

            {/* Description */}
            <Text className="text-carbon-500 text-xs font-semibold uppercase mb-2">
              Description (optional)
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Anything a borrower should know"
              placeholderTextColor="#a3a3a3"
              multiline
              numberOfLines={3}
              maxLength={400}
              textAlignVertical="top"
              className="bg-white rounded-xl border border-carbon-100 px-4 py-3 text-carbon-900 text-base mb-5"
              style={{ minHeight: 80 }}
            />

            {/* Condition picker */}
            <Text className="text-carbon-500 text-xs font-semibold uppercase mb-2">
              Condition
            </Text>
            <View className="flex-row flex-wrap mb-6 -mr-2">
              {CONDITIONS.map((c) => {
                const selected = condition === c.value;
                return (
                  <Pressable
                    key={c.value}
                    onPress={() => setCondition(c.value)}
                    className={`mr-2 mb-2 rounded-full px-3.5 py-2 border ${
                      selected
                        ? 'bg-eco-600 border-eco-600'
                        : 'bg-white border-carbon-200'
                    }`}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        selected ? 'text-white' : 'text-carbon-700'
                      }`}
                    >
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Banner */}
            {banner ? (
              <View className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
                <Text className="text-red-700 text-xs leading-4">{banner}</Text>
              </View>
            ) : null}

            {/* Publish */}
            <Pressable
              onPress={handlePublish}
              disabled={!canPublish}
              className={`rounded-xl py-4 items-center ${
                canPublish ? 'bg-eco-600' : 'bg-carbon-300'
              }`}
            >
              {publishing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-base font-semibold">
                  Publish item
                </Text>
              )}
            </Pressable>
            <Text className="text-carbon-500 text-[11px] text-center mt-3">
              Your current location is used to match nearby neighbors.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
