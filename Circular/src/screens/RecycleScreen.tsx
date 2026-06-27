import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRecyclingStore } from '@/stores/useRecyclingStore';
import {
  RECYCLABLES,
  findMaterial,
  co2SavedFor,
  moneySavedFor,
  lookupBarcode,
} from '@/lib/recycling';
import type { RecyclingSource } from '@/types/database';
import { CameraView } from '@/components/CameraView';
import { BarcodeScanner } from '@/components/BarcodeScanner';

interface RecycleScreenProps {
  onClose: () => void;
}

type Mode = 'form' | 'scan' | 'photo';

const COLOR_GREEN = '#059669';

export const RecycleScreen: React.FC<RecycleScreenProps> = ({ onClose }) => {
  const {
    logs,
    totals,
    publishing,
    error,
    fetchLogs,
    fetchTotals,
    logRecycling,
    clearError,
  } = useRecyclingStore();

  const [mode, setMode] = useState<Mode>('form');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [qtyText, setQtyText] = useState('1');
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [barcode, setBarcode] = useState<string | undefined>();
  const [productName, setProductName] = useState<string | undefined>();
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    fetchLogs();
    fetchTotals();
  }, [fetchLogs, fetchTotals]);

  const quantity = Math.max(0, parseInt(qtyText, 10) || 0);
  const selected = selectedKey ? findMaterial(selectedKey) : undefined;
  const source: RecyclingSource = barcode ? 'barcode' : photoUri ? 'photo' : 'preset';
  const canLog = !!selected && quantity >= 1 && !publishing;

  const previewCo2 = selected ? co2SavedFor(selected, quantity) : 0;
  const previewEur = selected ? moneySavedFor(selected, quantity) : 0;

  const resetEntry = () => {
    setSelectedKey(null);
    setQtyText('1');
    setPhotoUri(undefined);
    setBarcode(undefined);
    setProductName(undefined);
  };

  const handleScan = async (value: string) => {
    setMode('form');
    setBarcode(value);
    setLookingUp(true);
    const res = await lookupBarcode(value);
    setLookingUp(false);
    if (res.productName) setProductName(res.productName);
    if (res.materialKey && !selectedKey) setSelectedKey(res.materialKey);
  };

  const handlePhoto = (uri: string) => {
    setMode('form');
    setPhotoUri(uri);
  };

  const handleLog = async () => {
    if (!selected) return;
    clearError();
    const row = await logRecycling({
      materialKey: selected.key,
      quantity,
      source,
      photoUri,
      barcode,
    });
    if (row) resetEntry();
  };

  const adjustQty = (delta: number) => {
    setQtyText(String(Math.max(1, quantity + delta)));
  };

  // ── Full-screen sub-flows ──
  if (mode === 'scan') {
    return (
      <BarcodeScanner
        onScan={handleScan}
        onClose={() => setMode('form')}
        caption="Point at the item's barcode"
      />
    );
  }
  if (mode === 'photo') {
    return (
      <CameraView
        onCapture={handlePhoto}
        onClose={() => setMode('form')}
        caption="Photograph the item you recycled"
      />
    );
  }

  // ── Main form ──
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Recycle</Text>
        <Pressable hitSlop={12} onPress={onClose}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Totals */}
        <View style={styles.totalsCard}>
          <Text style={styles.totalsHeading}>Your recycling impact</Text>
          <View style={styles.totalsRow}>
            <Totals label="Saved" value={`€${totals.money_saved_eur.toFixed(2)}`} />
            <Totals label="CO₂e avoided" value={`${totals.co2_saved_kg.toFixed(1)} kg`} />
            <Totals label="Items" value={`${totals.item_count}`} />
          </View>
        </View>

        {/* Entry methods */}
        <Text style={styles.sectionLabel}>How do you want to add it?</Text>
        <View style={styles.methodRow}>
          <MethodButton icon="📋" label="From list" onPress={() => { /* default */ }} active={source === 'preset'} />
          <MethodButton icon="📷" label="Photo" onPress={() => setMode('photo')} active={source === 'photo'} />
          <MethodButton icon="🔢" label="Barcode" onPress={() => setMode('scan')} active={source === 'barcode'} />
        </View>

        {/* Photo preview */}
        {photoUri ? (
          <View style={styles.attachRow}>
            <Image source={{ uri: photoUri }} style={styles.thumb} />
            <Text style={styles.attachText}>Photo attached</Text>
            <Pressable hitSlop={8} onPress={() => setPhotoUri(undefined)}>
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Barcode preview */}
        {barcode ? (
          <View style={styles.attachRow}>
            <Text style={styles.barcodeIcon}>🔖</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.attachText} numberOfLines={1}>
                {lookingUp ? 'Looking up…' : productName ?? 'Scanned barcode'}
              </Text>
              <Text style={styles.barcodeNum}>{barcode}</Text>
            </View>
            <Pressable
              hitSlop={8}
              onPress={() => {
                setBarcode(undefined);
                setProductName(undefined);
              }}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Material grid */}
        <Text style={styles.sectionLabel}>What did you recycle?</Text>
        <View style={styles.grid}>
          {RECYCLABLES.map((m) => {
            const isSel = m.key === selectedKey;
            return (
              <Pressable
                key={m.key}
                onPress={() => setSelectedKey(m.key)}
                style={[styles.chip, isSel && styles.chipActive]}
              >
                <Text style={styles.chipIcon}>{m.icon}</Text>
                <Text style={[styles.chipLabel, isSel && styles.chipLabelActive]}>
                  {m.label}
                </Text>
                <Text style={[styles.chipMeta, isSel && styles.chipMetaActive]}>
                  €{m.depositEur.toFixed(2)} · {m.co2SavedKgPerItem.toFixed(2)} kg
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Quantity */}
        <Text style={styles.sectionLabel}>How many?</Text>
        <View style={styles.qtyRow}>
          <Pressable style={styles.qtyButton} onPress={() => adjustQty(-1)}>
            <Text style={styles.qtyButtonText}>−</Text>
          </Pressable>
          <TextInput
            value={qtyText}
            onChangeText={setQtyText}
            keyboardType="number-pad"
            style={styles.qtyInput}
            selectTextOnFocus
          />
          <Pressable style={styles.qtyButton} onPress={() => adjustQty(1)}>
            <Text style={styles.qtyButtonText}>+</Text>
          </Pressable>
        </View>

        {/* Savings preview */}
        <View style={styles.previewCard}>
          {selected ? (
            <>
              <Text style={styles.previewHeading}>You'll save</Text>
              <Text style={styles.previewBig}>€{previewEur.toFixed(2)}</Text>
              <Text style={styles.previewSub}>
                and avoid {previewCo2.toFixed(2)} kg CO₂e
              </Text>
            </>
          ) : (
            <Text style={styles.previewEmpty}>Pick a material to see your savings.</Text>
          )}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          disabled={!canLog}
          onPress={handleLog}
          style={[styles.logButton, !canLog && styles.logButtonDisabled]}
        >
          {publishing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.logButtonText}>Log recycling</Text>
          )}
        </Pressable>

        {/* Recent logs */}
        {logs.length > 0 ? (
          <View style={styles.recentSection}>
            <Text style={styles.sectionLabel}>Recent</Text>
            {logs.slice(0, 20).map((log) => (
              <View key={log.id} style={styles.logRow}>
                <Text style={styles.logIcon}>
                  {findMaterial(log.material_key)?.icon ?? '♻️'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.logTitle}>
                    {log.label} × {log.quantity}
                  </Text>
                  <Text style={styles.logDate}>
                    {new Date(log.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.logEur}>€{log.money_saved_eur.toFixed(2)}</Text>
                  <Text style={styles.logCo2}>{log.co2_saved_kg.toFixed(2)} kg</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Sub-components ──

const Totals: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.totalsCell}>
    <Text style={styles.totalsValue}>{value}</Text>
    <Text style={styles.totalsLabel}>{label}</Text>
  </View>
);

const MethodButton: React.FC<{
  icon: string;
  label: string;
  onPress: () => void;
  active?: boolean;
}> = ({ icon, label, onPress, active }) => (
  <Pressable onPress={onPress} style={[styles.methodButton, active && styles.methodButtonActive]}>
    <Text style={styles.methodIcon}>{icon}</Text>
    <Text style={[styles.methodLabel, active && styles.methodLabelActive]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ecfdf5' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: { fontSize: 24, fontWeight: '800', color: '#171717' },
  closeText: { fontSize: 16, fontWeight: '600', color: COLOR_GREEN },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },

  // Totals
  totalsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 22,
  },
  totalsHeading: { fontSize: 13, color: '#737373', marginBottom: 12, fontWeight: '600' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalsCell: { alignItems: 'center', flex: 1 },
  totalsValue: { fontSize: 20, fontWeight: '800', color: COLOR_GREEN },
  totalsLabel: { fontSize: 11, color: '#737373', marginTop: 2 },

  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#404040',
    marginBottom: 10,
    marginTop: 4,
  },

  // Entry methods
  methodRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  methodButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  methodButtonActive: { borderColor: COLOR_GREEN, backgroundColor: '#f0fdf4' },
  methodIcon: { fontSize: 24, marginBottom: 4 },
  methodLabel: { fontSize: 12, fontWeight: '600', color: '#525252' },
  methodLabelActive: { color: COLOR_GREEN },

  // Attachments
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  thumb: { width: 44, height: 44, borderRadius: 8, marginRight: 12, backgroundColor: '#e5e5e5' },
  barcodeIcon: { fontSize: 28, marginRight: 12 },
  attachText: { fontSize: 14, fontWeight: '600', color: '#171717' },
  barcodeNum: { fontSize: 12, color: '#737373', marginTop: 2 },
  removeText: { fontSize: 13, fontWeight: '600', color: '#dc2626' },

  // Material grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 8 },
  chip: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipActive: { borderColor: COLOR_GREEN, backgroundColor: '#f0fdf4' },
  chipIcon: { fontSize: 26, marginBottom: 6 },
  chipLabel: { fontSize: 14, fontWeight: '700', color: '#171717' },
  chipLabelActive: { color: COLOR_GREEN },
  chipMeta: { fontSize: 11, color: '#737373', marginTop: 4 },
  chipMetaActive: { color: '#059669' },

  // Quantity
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  qtyButton: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyButtonText: { fontSize: 26, fontWeight: '700', color: COLOR_GREEN },
  qtyInput: {
    flex: 1,
    marginHorizontal: 12,
    height: 52,
    backgroundColor: '#fff',
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#171717',
  },

  // Preview
  previewCard: {
    backgroundColor: '#064e3b',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 18,
  },
  previewHeading: { fontSize: 13, color: '#a7f3d0', fontWeight: '600' },
  previewBig: { fontSize: 36, fontWeight: '900', color: '#fff', marginTop: 4 },
  previewSub: { fontSize: 14, color: '#d1fae5', marginTop: 2 },
  previewEmpty: { fontSize: 14, color: '#a7f3d0', textAlign: 'center' },

  errorText: { color: '#dc2626', fontSize: 13, marginBottom: 12, textAlign: 'center' },

  logButton: {
    backgroundColor: COLOR_GREEN,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logButtonDisabled: { backgroundColor: '#a7d3c5' },
  logButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Recent
  recentSection: { marginTop: 28 },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  logIcon: { fontSize: 24, marginRight: 12 },
  logTitle: { fontSize: 14, fontWeight: '600', color: '#171717' },
  logDate: { fontSize: 12, color: '#a3a3a3', marginTop: 2 },
  logEur: { fontSize: 14, fontWeight: '700', color: COLOR_GREEN },
  logCo2: { fontSize: 11, color: '#737373', marginTop: 2 },
});

export default RecycleScreen;
