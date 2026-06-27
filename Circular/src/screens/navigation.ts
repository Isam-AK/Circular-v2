/**
 * Centralized React Navigation param-list types.
 * Imported by App.tsx (where the navigators are declared) and by screens
 * that need typed `navigation.navigate(...)` calls.
 */

export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
};

export type RootTabParamList = {
  Home: undefined;
  Trips: undefined;
  Share: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: undefined;
  LogTrip: undefined;
  Globe: undefined;
  /** Camera-first scan flow. Captures a photo, then auto-jumps to
   *  ShareItem with the photo pre-attached. */
  ScanItem: undefined;
  /** "List an item to share" form. May arrive empty (FAB on Share tab)
   *  or pre-filled with a photo from the Scan flow. */
  ShareItem: { initialPhotoUri?: string } | undefined;
  /** Camera-first avatar update. On capture uploads + dismisses. */
  AvatarCapture: undefined;
  /** Recycling log flow: preset/photo/barcode entry → CO₂ + Pfand savings. */
  Recycle: undefined;
};
