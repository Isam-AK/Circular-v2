import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';

interface BarcodeScannerProps {
  /** Fires once with the scanned/entered barcode value. */
  onScan: (barcode: string) => void;
  /** Top bar close button. If omitted, no close button is shown. */
  onClose?: () => void;
  /** Caption rendered under the reticle. */
  caption?: string;
}

// A real EAN-13 that Open Food Facts knows (Coca-Cola Classic), used by the
// dev-only "sample barcode" button so the barcode→product lookup can be
// exercised in the simulator where there's no camera.
const SAMPLE_BARCODE = '5449000000996';

/**
 * Barcode scanner built on react-native-vision-camera's built-in code
 * scanner. Mirrors CameraView's structure (permission gate → no-device
 * fallback → live scanner). On simulators (no camera) it offers manual
 * entry + a sample barcode so the lookup flow stays testable.
 */
export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  onClose,
  caption,
}) => {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [manual, setManual] = useState('');

  // Guard so a single barcode in view doesn't fire onScan dozens of times.
  const firedRef = useRef(false);
  const fire = (value: string) => {
    if (firedRef.current) return;
    firedRef.current = true;
    onScan(value);
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['ean-13', 'ean-8', 'upc-a', 'upc-e', 'code-128', 'qr'],
    onCodeScanned: (codes) => {
      const value = codes[0]?.value;
      if (value) fire(value);
    },
  });

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // ── Permission gate ──
  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.gate}>
        <Text style={styles.gateTitle}>Camera access needed</Text>
        <Text style={styles.gateBody}>
          Circular needs the camera to scan an item's barcode.
        </Text>
        <Pressable style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Allow camera</Text>
        </Pressable>
        {onClose ? (
          <Pressable style={styles.ghostButton} onPress={onClose}>
            <Text style={styles.ghostButtonText}>Cancel</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    );
  }

  // ── No camera device (e.g. iOS Simulator): manual entry fallback ──
  if (!device) {
    const trimmed = manual.trim();
    return (
      <SafeAreaView style={styles.gate}>
        <Text style={styles.gateTitle}>No camera available</Text>
        <Text style={styles.gateBody}>
          This device has no camera{__DEV__ ? ' (the simulator never does)' : ''}.
          {' '}Enter a barcode manually
          {__DEV__ ? ', or use a sample one for testing.' : '.'}
        </Text>
        <TextInput
          value={manual}
          onChangeText={setManual}
          keyboardType="number-pad"
          placeholder="e.g. 5449000000996"
          placeholderTextColor="#737373"
          style={styles.input}
        />
        <Pressable
          style={[styles.primaryButton, !trimmed && styles.primaryButtonDisabled]}
          disabled={!trimmed}
          onPress={() => fire(trimmed)}
        >
          <Text style={styles.primaryButtonText}>Look up barcode</Text>
        </Pressable>
        {__DEV__ ? (
          <Pressable style={styles.secondaryButton} onPress={() => fire(SAMPLE_BARCODE)}>
            <Text style={styles.secondaryButtonText}>Use sample barcode (dev)</Text>
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable style={styles.ghostButton} onPress={onClose}>
            <Text style={styles.ghostButtonText}>Close</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    );
  }

  // ── Live scanner ──
  return (
    <View style={styles.root}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        codeScanner={codeScanner}
      />

      {/* Top bar */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        {onClose ? (
          <Pressable hitSlop={16} onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        ) : (
          <View />
        )}
      </SafeAreaView>

      {/* Reticle */}
      <View style={styles.reticleWrap} pointerEvents="none">
        <View style={styles.reticle} />
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  closeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
  },
  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticle: {
    width: 260,
    height: 160,
    borderWidth: 3,
    borderColor: '#34d399',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  caption: {
    color: '#fff',
    fontSize: 14,
    marginTop: 20,
    paddingHorizontal: 32,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },

  // Gate / fallback
  gate: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 32,
    paddingTop: 80,
    alignItems: 'center',
  },
  gateTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  gateBody: {
    color: '#d4d4d4',
    fontSize: 14,
    lineHeight: 20,
    marginVertical: 16,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    backgroundColor: '#1c1c1c',
    borderColor: '#404040',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: '#059669',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
    width: '100%',
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: '#374151',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    borderColor: '#059669',
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 12,
    width: '100%',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#34d399',
    fontSize: 15,
    fontWeight: '600',
  },
  ghostButton: {
    marginTop: 14,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  ghostButtonText: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '500',
  },
});
