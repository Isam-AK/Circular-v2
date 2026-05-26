import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMobilityStore } from '@/stores/useMobilityStore';
import {
  ALL_MODES,
  MODE_META,
  carbonForTrip,
  savingsForTrip,
  isGreenMode,
} from '@/lib/emissions';
import type { TransportMode } from '@/types/database';

interface LogTripScreenProps {
  /** Called when the user submits successfully or hits cancel. App.tsx passes navigation.goBack. */
  onClose: () => void;
}

export const LogTripScreen: React.FC<LogTripScreenProps> = ({ onClose }) => {
  const [mode, setMode] = useState<TransportMode | null>(null);
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const { logTrip, busy, error, clearError } = useMobilityStore();

  const distanceKm = parseFloat(distance);
  const durationMin = duration ? parseFloat(duration) : undefined;
  const isDistanceValid = !isNaN(distanceKm) && distanceKm > 0;

  const projection = useMemo(() => {
    if (!mode || !isDistanceValid) return null;
    return {
      saved: savingsForTrip(mode, distanceKm),
      emitted: carbonForTrip(mode, distanceKm),
    };
  }, [mode, distanceKm, isDistanceValid]);

  const canSubmit = mode !== null && isDistanceValid && !busy;

  const onSubmit = async () => {
    if (!canSubmit || mode === null) return;
    clearError();
    const result = await logTrip({ mode, distanceKm, durationMin });
    if (result) onClose();
  };

  return (
    <SafeAreaView className="flex-1 bg-eco-50">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 py-3 border-b border-carbon-100">
          <Pressable onPress={onClose} hitSlop={12}>
            <Text className="text-carbon-600 text-base">Cancel</Text>
          </Pressable>
          <Text className="text-carbon-900 text-base font-semibold">Log Trip</Text>
          <View style={{ width: 56 }} />
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Mode picker */}
          <View className="px-5 pt-6">
            <Text className="text-carbon-700 text-sm font-semibold mb-3">
              How did you travel?
            </Text>
            <View className="flex-row flex-wrap -mx-1">
              {ALL_MODES.map((m) => {
                const selected = mode === m;
                const meta = MODE_META[m];
                const green = isGreenMode(m);
                return (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    className={`m-1 rounded-2xl px-4 py-3 items-center border ${
                      selected
                        ? 'bg-eco-600 border-eco-700'
                        : 'bg-white border-carbon-200'
                    }`}
                    style={{ width: '23%' }}
                  >
                    <Text className="text-2xl mb-1">{meta.icon}</Text>
                    <Text
                      className={`text-xs font-semibold ${
                        selected ? 'text-white' : 'text-carbon-700'
                      }`}
                    >
                      {meta.label}
                    </Text>
                    {green && !selected ? (
                      <Text className="text-[10px] text-eco-600 mt-0.5">
                        0 CO₂
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Distance */}
          <View className="px-5 pt-6">
            <Text className="text-carbon-700 text-sm font-semibold mb-1">
              Distance{' '}
              <Text className="text-carbon-400 font-normal">(km)</Text>
            </Text>
            <TextInput
              value={distance}
              onChangeText={setDistance}
              keyboardType="decimal-pad"
              placeholder="e.g. 5.4"
              placeholderTextColor="#a3a3a3"
              className="bg-white border border-carbon-200 rounded-xl px-4 py-3 text-carbon-900 text-base"
            />
          </View>

          {/* Duration (optional) */}
          <View className="px-5 pt-4">
            <Text className="text-carbon-700 text-sm font-semibold mb-1">
              Duration{' '}
              <Text className="text-carbon-400 font-normal">
                (min, optional)
              </Text>
            </Text>
            <TextInput
              value={duration}
              onChangeText={setDuration}
              keyboardType="number-pad"
              placeholder="e.g. 22"
              placeholderTextColor="#a3a3a3"
              className="bg-white border border-carbon-200 rounded-xl px-4 py-3 text-carbon-900 text-base"
            />
          </View>

          {/* Live savings preview */}
          {projection !== null && mode ? (
            <View className="mx-5 mt-6 rounded-2xl bg-white border border-carbon-100 p-4">
              <Text className="text-carbon-500 text-xs font-semibold uppercase mb-1">
                {projection.saved > 0
                  ? 'This trip will save'
                  : "This trip won't save anything"}
              </Text>
              <View className="flex-row items-baseline">
                <Text
                  className={`text-3xl font-bold ${
                    projection.saved > 0 ? 'text-eco-600' : 'text-carbon-700'
                  }`}
                >
                  {projection.saved.toFixed(2)}
                </Text>
                <Text className="text-carbon-600 text-base ml-2">
                  kg CO₂e
                </Text>
              </View>
              <Text className="text-carbon-500 text-xs mt-2">
                {projection.saved > 0
                  ? `vs. driving a petrol car. Adds ${projection.emitted.toFixed(2)} kg to your footprint.`
                  : `It adds ${projection.emitted.toFixed(2)} kg to your footprint instead.`}
              </Text>
            </View>
          ) : null}

          {/* Error */}
          {error ? (
            <Text className="text-red-600 text-sm mx-5 mt-4">{error}</Text>
          ) : null}
        </ScrollView>

        {/* Submit */}
        <View className="px-5 pb-4 pt-2 border-t border-carbon-100 bg-eco-50">
          <Pressable
            onPress={onSubmit}
            disabled={!canSubmit}
            className={`rounded-xl py-4 items-center ${
              canSubmit ? 'bg-eco-600' : 'bg-carbon-300'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-base font-semibold">
                Log trip
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
