import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthStackParamList } from './navigation';
import { appleAuth, AppleButton } from '@invertase/react-native-apple-authentication';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

/** Modal asking for an email to send a password-reset link to. */
const ForgotPasswordModal: React.FC<{
  visible: boolean;
  prefillEmail: string;
  onClose: () => void;
}> = ({ visible, prefillEmail, onClose }) => {
  const { requestPasswordReset, requestingReset, error, clearError } = useAuthStore();
  const [email, setEmail] = useState(prefillEmail);
  const [sent, setSent] = useState(false);

  // Keep the modal's local state in sync if the sign-in form's email
  // changes between opens.
  React.useEffect(() => {
    if (visible) {
      setEmail(prefillEmail);
      setSent(false);
      clearError();
    }
  }, [visible, prefillEmail, clearError]);

  const submit = async () => {
    if (email.trim().length < 4) return;
    const ok = await requestPasswordReset(email);
    if (ok) setSent(true);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/50 items-center justify-center px-8">
        <View className="bg-white rounded-2xl p-6 w-full max-w-md">
          <Text className="text-carbon-900 text-xl font-bold mb-2">
            Reset password
          </Text>
          {sent ? (
            <>
              <Text className="text-carbon-700 text-sm leading-5 mb-5">
                If an account exists for{' '}
                <Text className="font-semibold">{email}</Text>, we sent a
                recovery email. Check your inbox (and spam) for the link.
              </Text>
              <Pressable
                onPress={onClose}
                className="bg-eco-600 rounded-xl py-3 items-center"
              >
                <Text className="text-white text-sm font-semibold">Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text className="text-carbon-600 text-sm mb-4">
                Enter the email on your account. We'll send a recovery link.
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="you@example.com"
                placeholderTextColor="#a3a3a3"
                className="bg-eco-50 border border-carbon-200 rounded-xl px-4 py-3 mb-4 text-carbon-900"
              />
              {error ? (
                <Text className="text-red-600 text-xs mb-3">{error}</Text>
              ) : null}
              <View className="flex-row">
                <Pressable
                  onPress={onClose}
                  className="flex-1 mr-2 rounded-xl border border-carbon-200 py-3 items-center"
                >
                  <Text className="text-carbon-700 text-sm font-semibold">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={submit}
                  disabled={requestingReset || email.trim().length < 4}
                  className={`flex-1 rounded-xl py-3 items-center ${
                    requestingReset || email.trim().length < 4
                      ? 'bg-carbon-300'
                      : 'bg-eco-600'
                  }`}
                >
                  {requestingReset ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-white text-sm font-semibold">Send link</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

export const SignInScreen: React.FC<Props> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  const { signIn, signInWithApple, busy, error, clearError } = useAuthStore();

  const canSubmit = email.length > 3 && password.length >= 6 && !busy;

  const onSubmit = () => {
    if (!canSubmit) return;
    clearError();
    signIn(email, password);
  };

  const onApplePress = async () => {
    clearError();
    try {
      const res = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        // FULL_NAME is only returned on first sign-in; we ignore it for
        // now and use the email prefix as display_name (see auth store
        // comment in signInWithApple).
        requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
      });
      const idToken = res.identityToken;
      if (!idToken) {
        // appleAuth resolved but the identity token is missing — this
        // happens when the user cancels mid-flow on some iOS versions.
        return;
      }
      await signInWithApple(idToken, res.nonce);
    } catch (e: any) {
      // Apple SDK throws AppleAuthError.CANCELED when the user dismisses
      // the sheet — treat as a no-op rather than surfacing as an error.
      if (e?.code === appleAuth.Error.CANCELED) return;
      // Anything else: surface to the same error banner used by signIn.
      useAuthStore.setState({ error: e?.message ?? 'Sign in with Apple failed' });
    }
  };

  // Apple's HIG requires the button only show on iOS 13+. We're at 15.1
  // minimum and Platform.OS === 'ios' covers it.
  const showApple = Platform.OS === 'ios' && appleAuth.isSupported;

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
            className="bg-white border border-carbon-200 rounded-xl px-4 py-3 mb-2 text-carbon-900"
          />

          {/* Forgot password — right-aligned secondary link */}
          <Pressable
            onPress={() => setForgotOpen(true)}
            className="self-end mb-5"
            hitSlop={8}
          >
            <Text className="text-eco-700 text-xs font-semibold">Forgot password?</Text>
          </Pressable>

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

          {/* Apple Sign In — iOS only, below email/password */}
          {showApple ? (
            <>
              <View className="flex-row items-center my-4">
                <View className="flex-1 h-px bg-carbon-200" />
                <Text className="text-carbon-400 text-xs mx-3">or</Text>
                <View className="flex-1 h-px bg-carbon-200" />
              </View>
              <AppleButton
                buttonStyle={AppleButton.Style.BLACK}
                buttonType={AppleButton.Type.SIGN_IN}
                style={{ width: '100%', height: 48 }}
                onPress={onApplePress}
              />
            </>
          ) : null}

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

      <ForgotPasswordModal
        visible={forgotOpen}
        prefillEmail={email}
        onClose={() => setForgotOpen(false)}
      />
    </SafeAreaView>
  );
};
