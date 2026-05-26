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
};
