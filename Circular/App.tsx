import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { HomeScreen } from './src/screens/HomeScreen';

// ── Tab Navigator ──────────────────────────────────────────

export type RootTabParamList = {
  Home: undefined;
  Trips: undefined;
  Share: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

// Placeholder screens for tabs not yet built
const PlaceholderScreen: React.FC<{ name: string }> = ({ name }) => {
  const { View, Text } = require('react-native');
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ecfdf5' }}>
      <Text style={{ fontSize: 18, color: '#059669', fontWeight: '600' }}>{name} — Coming Soon</Text>
    </View>
  );
};

// ── Root App ───────────────────────────────────────────────

export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor="#ecfdf5" />
        <NavigationContainer>
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
              options={{ tabBarLabel: 'Trips', tabBarIcon: () => null }}
            >
              {() => <PlaceholderScreen name="Trips" />}
            </Tab.Screen>
            <Tab.Screen
              name="Share"
              options={{ tabBarLabel: 'Share', tabBarIcon: () => null }}
            >
              {() => <PlaceholderScreen name="Share" />}
            </Tab.Screen>
            <Tab.Screen
              name="Profile"
              options={{ tabBarLabel: 'Profile', tabBarIcon: () => null }}
            >
              {() => <PlaceholderScreen name="Profile" />}
            </Tab.Screen>
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
