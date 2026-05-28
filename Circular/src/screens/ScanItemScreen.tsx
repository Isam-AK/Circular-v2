import React from 'react';
import { CameraView } from '@/components/CameraView';

interface ScanItemScreenProps {
  /** Wired in App.tsx to navigation.goBack(). */
  onClose: () => void;
  /**
   * Wired in App.tsx to replace this modal with ShareItem and forward
   * the photo URI. Replacing (vs. pushing) means hitting "Cancel" on
   * the share form returns the user to the previous stack, not back
   * to the camera.
   */
  onPhotoCaptured: (photoUri: string) => void;
}

/**
 * Camera-first scan flow. Wraps CameraView; on capture, hands the
 * file:// URI up to the navigator which auto-jumps the user into
 * ShareItemScreen with the photo pre-filled (per the post-capture UX
 * decision in the Scan + Share session).
 */
export const ScanItemScreen: React.FC<ScanItemScreenProps> = ({
  onClose,
  onPhotoCaptured,
}) => (
  <CameraView
    onClose={onClose}
    onCapture={onPhotoCaptured}
    caption="Center the item you want to share, then tap the shutter."
  />
);
