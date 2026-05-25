import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthStackParamList } from './authNav';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export const SignInScreen: React.FC<Props> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, busy, error, clearError } = useAuthStore();

  const canSubmit = email.length > 3 && password.length >= 6 && !busy;

  const onSubmit = () => {
    if (!canSubmit) return;
    clearError();
    signIn(email, password);
  };

  return (
    <SafeAreaView className="flex-1 bg-eco-50">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-8">
          <Text className="text-eco-700 text-4xl font-bold mb-2">Circular</Text>
          <Text className="text-carbon-600 text-base mb-10">
            Sign in to keep tracking your impact.
          </Text>

          <Text className="text-carbon-700 text-sm font-semibold mb-1">Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
            placeholderTextColor="#a3a3a3"
            className="bg-white border border-carbon-200 rounded-xl px-4 py-3 mb-4 text-carbon-900"
          />

          <Text className="text-carbon-700 text-sm font-semibold mb-1">Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            placeholder="••••••••"
            placeholderTextColor="#a3a3a3"
            className="bg-white border border-carbon-200 rounded-xl px-4 py-3 mb-6 text-carbon-900"
          />

          {error ? (
            <Text className="text-red-600 text-sm mb-4">{error}</Text>
          ) : null}

          <Pressable
            disabled={!canSubmit}
            onPress={onSubmit}
            className={`rounded-xl py-4 items-center ${
              canSubmit ? 'bg-eco-600' : 'bg-carbon-300'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-base font-semibold">Sign In</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              clearError();
              navigation.navigate('SignUp');
            }}
            className="py-4 items-center"
          >
            <Text className="text-eco-700 text-sm font-medium">
              Don't have an account? Sign up
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
