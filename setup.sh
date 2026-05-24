#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Circular — React Native Bare CLI Project Setup
# Run from the PARENT directory of where you want the project.
# ============================================================

PROJECT_NAME="Circular"

echo "▸ Initializing React Native bare project..."
npx @react-native-community/cli init "$PROJECT_NAME" --skip-git-init

cd "$PROJECT_NAME"

# ────────────────────────────────────────────────────────────
# 1. Core State & Backend
# ────────────────────────────────────────────────────────────
echo "▸ Installing core dependencies..."
npm install \
  zustand \
  @supabase/supabase-js \
  react-native-url-polyfill

# ────────────────────────────────────────────────────────────
# 2. UI: NativeWind (TailwindCSS for RN)
# ────────────────────────────────────────────────────────────
echo "▸ Installing NativeWind + Tailwind..."
npm install nativewind
npm install --save-dev tailwindcss@3.3.2

npx tailwindcss init
# Tailwind config is generated — we'll overwrite it below.

# ────────────────────────────────────────────────────────────
# 3. Animations: React Native Reanimated
# ────────────────────────────────────────────────────────────
echo "▸ Installing Reanimated..."
npm install react-native-reanimated

# ────────────────────────────────────────────────────────────
# 4. Camera: VisionCamera
# ────────────────────────────────────────────────────────────
echo "▸ Installing VisionCamera..."
npm install react-native-vision-camera

# ────────────────────────────────────────────────────────────
# 5. Location & Maps
# ────────────────────────────────────────────────────────────
echo "▸ Installing location & maps..."
npm install \
  @react-native-community/geolocation \
  react-native-maps

# ────────────────────────────────────────────────────────────
# 6. Navigation
# ────────────────────────────────────────────────────────────
echo "▸ Installing React Navigation..."
npm install \
  @react-navigation/native \
  @react-navigation/bottom-tabs \
  @react-navigation/native-stack \
  react-native-screens \
  react-native-safe-area-context \
  react-native-gesture-handler

# ────────────────────────────────────────────────────────────
# 7. Plaid Link (bank connection)
# ────────────────────────────────────────────────────────────
echo "▸ Installing Plaid Link..."
npm install react-native-plaid-link-sdk

# ────────────────────────────────────────────────────────────
# 8. WebGL placeholder (for future 3D elements)
# ────────────────────────────────────────────────────────────
echo "▸ Installing WebGL libs..."
npm install \
  expo-gl \
  three \
  @react-three/fiber

# ────────────────────────────────────────────────────────────
# 9. Dev tooling
# ────────────────────────────────────────────────────────────
echo "▸ Installing dev dependencies..."
npm install --save-dev \
  @types/react \
  @types/react-native \
  eslint \
  prettier \
  @typescript-eslint/eslint-plugin \
  @typescript-eslint/parser

# ────────────────────────────────────────────────────────────
# 10. iOS pods (macOS only)
# ────────────────────────────────────────────────────────────
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "▸ Installing CocoaPods..."
  cd ios && pod install && cd ..
fi

echo ""
echo "✅ Circular project initialized successfully."
echo "   cd $PROJECT_NAME && npx react-native run-android"
echo "   cd $PROJECT_NAME && npx react-native run-ios"
