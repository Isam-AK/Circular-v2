import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import { launchImageLibrary } from 'react-native-image-picker';

// Bundled fallback photo used by the dev-only "Use sample photo" button on
// devices/simulators without a camera. Lives in src/assets.
const SAMPLE_ITEM_IMAGE = require('../assets/sample-item.jpg');

interface CameraViewProps {
  /** Fires with a `file://` URI after a successful capture. */
  onCapture: (photoUri: string) => void;
  /** Top-left close button. If omitted, no close button is shown. */
  onClose?: () => void;
  /** Caption rendered under the viewfinder. */
  caption?: string;
}

/**
 * Self-contained camera surface built on react-native-vision-camera.
 *
 * Three stages:
 *   1. Permission gate (requests on first render if not yet granted).
 *   2. Live viewfinder + capture button once the back camera is ready.
 *   3. Brief "Capturing…" indicator while takePhoto() resolves.
 *
 * Caller is responsible for what happens to the resulting photo —
 * this component just hands back the local file URI.
 */
export const CameraView: React.FC<CameraViewProps> = ({
  onCapture,
  onClose,
  caption,
}) => {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const camera = useRef<Camera>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-request permission the first time the screen mounts.
  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const handleCapture = async () => {
    if (!camera.current || capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const photo = await camera.current.takePhoto({
        // Defaults are fine for object photos; flash off is the polite default.
        flash: 'off',
      });
      // VisionCamera returns a bare path on iOS; the rest of the app expects
      // a `file://` URI for fetch() and <Image source>.
      const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      onCapture(uri);
    } catch (e) {
      setError((e as Error).message || 'Could not capture photo');
    } finally {
      setCapturing(false);
    }
  };

  // Fallback for devices/simulators with no camera: pick an existing photo.
  const handlePickFromLibrary = async () => {
    setError(null);
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        quality: 0.9,
      });
      if (result.didCancel) return;
      if (result.errorCode) {
        setError(result.errorMessage ?? 'Could not open photo library');
        return;
      }
      const uri = result.assets?.[0]?.uri;
      if (uri) onCapture(uri);
    } catch (e) {
      setError((e as Error).message || 'Could not pick a photo');
    }
  };

  // Dev-only: feed a bundled sample photo through the same onCapture path so
  // the rest of the Scan→Share pipeline can be tested without a camera.
  const handleUseSample = () => {
    setError(null);
    const resolved = Image.resolveAssetSource(SAMPLE_ITEM_IMAGE);
    if (resolved?.uri) onCapture(resolved.uri);
    else setError('Sample image unavailable');
  };

  // ── Permission denied ──
  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.gate}>
        <Text style={styles.gateTitle}>Camera access needed</Text>
        <Text style={styles.gateBody}>
          Circular needs the camera to scan items you'd like to share.
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

  // ── No camera device (e.g. iOS Simulator) ──
  // Fall back to picking an existing photo so the Scan→Share flow is still
  // usable; in dev we also offer a bundled sample image.
  if (!device) {
    return (
      <SafeAreaView style={styles.gate}>
        <Text style={styles.gateTitle}>No camera available</Text>
        <Text style={styles.gateBody}>
          This device has no back camera{__DEV__ ? ' (the simulator never does)' : ''}.
          {' '}Pick a photo from your library instead
          {__DEV__ ? ', or use a sample image for testing.' : '.'}
        </Text>
        <Pressable style={styles.primaryButton} onPress={handlePickFromLibrary}>
          <Text style={styles.primaryButtonText}>Pick from library</Text>
        </Pressable>
        {__DEV__ ? (
          <Pressable style={styles.secondaryButton} onPress={handleUseSample}>
            <Text style={styles.secondaryButtonText}>Use sample photo (dev)</Text>
          </Pressable>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {onClose ? (
          <Pressable style={styles.ghostButton} onPress={onClose}>
            <Text style={styles.ghostButtonText}>Close</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    );
  }

  // ── Viewfinder ──
  return (
    <View style={styles.root}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        photo
      />

      {/* Top bar (close button only) */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        {onClose ? (
          <Pressable hitSlop={16} onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        ) : (
          <View />
        )}
      </SafeAreaView>

      {/* Bottom controls */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable
          onPress={handleCapture}
          disabled={capturing}
          style={({ pressed }) => [
            styles.shutterOuter,
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={[styles.shutterInner, capturing && styles.shutterCapturing]}>
            {capturing ? <ActivityIndicator color="#059669" /> : null}
          </View>
        </Pressable>
      </SafeAreaView>
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
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 24,
    alignItems: 'center',
  },
  caption: {
    color: '#fff',
    fontSize: 13,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
    marginBottom: 16,
    paddingHorizontal: 32,
    textAlign: 'center',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 12,
    marginBottom: 12,
  },
  shutterOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterCapturing: {
    backgroundColor: '#ecfdf5',
  },

  // Permission / no-device gate
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
  primaryButton: {
    backgroundColor: '#059669',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
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
