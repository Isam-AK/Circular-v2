import React, { useEffect } from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import './global.css';

import { HomeScreen } from './src/screens/HomeScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { SignUpScreen } from './src/screens/SignUpScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { TripsScreen } from './src/screens/TripsScreen';
import { LogTripScreen } from './src/screens/LogTripScreen';
import { GlobeScreen } from './src/screens/GlobeScreen';
import type {
  AppStackParamList,
  AuthStackParamList,
  RootTabParamList,
} from './src/screens/navigation';
import { useAuthStore } from './src/stores/useAuthStore';
import { useUserStore } from './src/stores/useUserStore';

const Tab = createBottomTabNavigator<RootTabParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

// Placeholder screens for tabs not yet built
const PlaceholderScreen: React.FC<{ name: string }> = ({ name }) => {
  const { View, Text } = require('react-native');
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ecfdf5' }}>
      <Text style={{ fontSize: 18, color: '#059669', fontWeight: '600' }}>{name} — Coming Soon</Text>
    </View>
  );
};

const TabsNavigator: React.FC = () => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: '#fff',
        borderTopColor: '#e5e5e5',
        paddingBottom: 4,
      },
      tabBarActiveTintColor: '#059669',
      tabBarInactiveTintColor: '#a3a3a3',
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: '600',
      },
    }}
  >
    <Tab.Screen
      name="Home"
      component={HomeScreen}
      options={{ tabBarLabel: 'Home', tabBarIcon: () => null }}
    />
    <Tab.Screen
      name="Trips"
      component={TripsScreen}
      options={{ tabBarLabel: 'Trips', tabBarIcon: () => null }}
    />
    <Tab.Screen
      name="Share"
      options={{ tabBarLabel: 'Share', tabBarIcon: () => null }}
    >
      {() => <PlaceholderScreen name="Share" />}
    </Tab.Screen>
    <Tab.Screen
      name="Profile"
      component={ProfileScreen}
      options={{ tabBarLabel: 'Profile', tabBarIcon: () => null }}
    />
  </Tab.Navigator>
);

const AppNavigator: React.FC = () => (
  <AppStack.Navigator screenOptions={{ headerShown: false }}>
    <AppStack.Screen name="Tabs" component={TabsNavigator} />
    <AppStack.Screen
      name="LogTrip"
      options={{ presentation: 'modal', gestureEnabled: true }}
    >
      {({ navigation }) => (
        <LogTripScreen onClose={() => navigation.goBack()} />
      )}
    </AppStack.Screen>
    <AppStack.Screen
      name="Globe"
      options={{ presentation: 'modal', gestureEnabled: true }}
    >
      {({ navigation }) => (
        <GlobeScreen onClose={() => navigation.goBack()} />
      )}
    </AppStack.Screen>
  </AppStack.Navigator>
);

const AuthNavigator: React.FC = () => (
  <AuthStack.Navigator screenOptions={{ headerShown: false }}>
    <AuthStack.Screen name="SignIn" component={SignInScreen} />
    <AuthStack.Screen name="SignUp" component={SignUpScreen} />
  </AuthStack.Navigator>
);

const Splash: React.FC = () => (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ecfdf5' }}>
    <ActivityIndicator size="large" color="#059669" />
  </View>
);

// ── Root App ───────────────────────────────────────────────

export default function App(): React.JSX.Element {
  const session = useAuthStore((s) => s.session);
  const initialized = useAuthStore((s) => s.initialized);
  const initialize = useAuthStore((s) => s.initialize);

  // One-shot session restore + onAuthStateChange subscription
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Whenever the session changes (sign in/out/refresh), sync the user profile store.
  useEffect(() => {
    if (session) {
      useUserStore.getState().fetchUser();
    } else {
      useUserStore.getState().setUser(null);
    }
  }, [session]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor="#ecfdf5" />
        <NavigationContainer>
          {!initialized ? <Splash /> : session ? <AppNavigator /> : <AuthNavigator />}
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
