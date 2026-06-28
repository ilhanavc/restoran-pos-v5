import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LoginRequestSchema } from '@restoran-pos/shared-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { login } from '../api/client';
import { AUTH_INVALID_CREDENTIALS, isApiError } from '../api/errors';
import { useAuthStore } from '../store/auth';
import {
  buttonHeight,
  colors,
  minTouchTarget,
  radius,
  spacing,
} from '../theme';

/**
 * Waiter login screen (ADR-026 K2/K3/K9).
 *
 * Light body, dark-slate accented brand mark, e-mail + password fields, a
 * password show/hide toggle, and a full-width primary action. Client-side
 * validation reuses the shared `LoginRequestSchema` (no react-hook-form). On
 * success the auth store flips the navigator gate to the Tables stack; on
 * failure a localized inline error is shown — invalid credentials and transport
 * failures map to distinct messages. All user-visible text goes through `t()`.
 */
export function LoginScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const authLogin = useAuthStore((state) => state.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (): Promise<void> => {
    setFieldError(null);
    setFormError(null);

    const parsed = LoginRequestSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const issuePath = parsed.error.issues[0]?.path[0];
      if (issuePath === 'email') {
        setFieldError(t('auth.login.email.invalid'));
      } else {
        setFieldError(t('auth.login.password.required'));
      }
      return;
    }

    setSubmitting(true);
    try {
      const response = await login(parsed.data);
      await authLogin(response);
      // Navigator gate (App.tsx) reacts to isAuthenticated → Tables stack.
    } catch (error) {
      // Bad-credential errors carry a code; anything else (transport/unknown)
      // is shown as a network problem so the waiter knows to check the
      // connection rather than re-typing a correct password. Real fetch lands
      // in PR-5d and reuses this same ApiError contract.
      const invalidCredentials =
        isApiError(error) && error.code === AUTH_INVALID_CREDENTIALS;
      setFormError(
        invalidCredentials
          ? t('auth.error.invalidCredentials')
          : t('auth.error.networkError'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.brandMark}>
              <MaterialCommunityIcons
                name="chef-hat"
                size={36}
                color={colors.slateText}
              />
            </View>
            <Text style={styles.title}>{t('auth.login.title')}</Text>
            <Text style={styles.subtitle}>{t('auth.login.subtitle')}</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>{t('auth.login.email.label')}</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder={t('auth.login.email.placeholder')}
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                editable={!submitting}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>{t('auth.login.password.label')}</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('auth.login.password.placeholder')}
                  placeholderTextColor={colors.textSecondary}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  editable={!submitting}
                />
                <Pressable
                  style={styles.eyeButton}
                  onPress={() => {
                    setShowPassword((value) => !value);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    showPassword ? 'auth.login.password.hide' : 'auth.login.password.show',
                  )}
                  hitSlop={8}
                >
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={22}
                    color={colors.textSecondary}
                  />
                </Pressable>
              </View>
            </View>

            {fieldError !== null ? (
              <Text style={styles.errorText}>{fieldError}</Text>
            ) : null}
            {formError !== null ? (
              <Text style={styles.errorText}>{formError}</Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.submit,
                (submitting || pressed) && styles.submitPressed,
              ]}
              onPress={() => {
                void onSubmit();
              }}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={t('auth.login.submit')}
            >
              {submitting ? (
                <ActivityIndicator color={colors.slateText} />
              ) : (
                <Text style={styles.submitText}>{t('auth.login.submit')}</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  brandMark: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: spacing.xs,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  form: {
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  input: {
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  passwordInput: {
    flex: 1,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  eyeButton: {
    width: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },
  submit: {
    height: buttonHeight,
    borderRadius: radius.md,
    backgroundColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  submitPressed: {
    opacity: 0.85,
  },
  submitText: {
    color: colors.slateText,
    fontSize: 17,
    fontWeight: '700',
  },
});
