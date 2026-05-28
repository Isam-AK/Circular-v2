import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { CameraView } from '@/components/CameraView';
import { useUserStore } from '@/stores/useUserStore';

interface AvatarCaptureScreenProps {
  /** Wired in App.tsx to navigation.goBack(). */
  onClose: () => void;
}

/**
 * Camera-first avatar update flow. Wraps CameraView, then takes the
 * captured photo URI straight to useUserStore.updateProfile() — no
 * preview / Retake step in v1 (the user can re-tap the avatar circle
 * to redo it). Dismisses on success; surfaces any upload error.
 */
export const AvatarCaptureScreen: React.FC<AvatarCaptureScreenProps> = ({ onClose }) => {
  const { updateProfile, saving, error } = useUserStore();
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Bubble store errors into the local overlay too — useUserStore.error
  // can also surface from elsewhere, but in practice the only thing
  // touching `saving` here is our updateProfile call.
  useEffect(() => {
    if (error) setUploadError(error);
  }, [error]);

  const handleCapture = async (photoUri: string) => {
    setUploadError(null);
    const updated = await updateProfile({ avatarPhotoUri: photoUri });
    if (updated) onClose();
    // On failure: stay on the camera so the user can retry without
    // re-navigating. updateProfile already set `error` in the store
    // which our useEffect mirrors into uploadError.
  };

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        onClose={onClose}
        onCapture={handleCapture}
        caption="Frame your face inside the circle, then tap the shutter."
      />

      {/* Uploading overlay — sits above the viewfinder while
          updateProfile is in flight so the user can't double-capture. */}
      {saving ? (
        <View style={styles.overlay}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.overlayText}>Uploading avatar…</Text>
        </View>
      ) : null}

      {/* Error toast — only shown if upload failed and we're not currently
          retrying. Tapping it dismisses so the camera UI is unblocked. */}
      {uploadError && !saving ? (
        <Pressable
          style={styles.errorToast}
          onPress={() => setUploadError(null)}
        >
          <Text style={styles.errorToastText}>{uploadError}</Text>
          <Text style={styles.errorToastDismiss}>Tap to dismiss</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
  },
  errorToast: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: '#7f1d1d',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorToastText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  errorToastDismiss: {
    color: '#fecaca',
    fontSize: 11,
    marginTop: 2,
  },
});
