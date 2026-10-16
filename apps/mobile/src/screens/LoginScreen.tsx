import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  LoginRequestSchema,
  normalizeTenantSlug,
} from '@restoran-pos/shared-types';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Keyboard,
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
import {
  AUTH_BASELINE_RATE_LIMITED,
  AUTH_INVALID_CREDENTIALS,
  AUTH_RATE_LIMITED,
  isApiError,
} from '../api/errors';
import { useAuthStore } from '../store/auth';
import {
  buttonHeight,
  colors,
  inputHeight,
  minTouchTarget,
  radius,
  spacing,
} from '../theme';

/**
 * Waiter login screen (ADR-026 K2/K3/K9).
 *
 * Light body, dark-slate brand mark, e-mail + password fields. Tuned for a
 * one-handed, in-a-hurry waiter at shift start:
 *  - the last e-mail is remembered (auth store) and prefilled; focus then lands
 *    on the password so a returning waiter just types the password,
 *  - keyboard flows email → "next" → password → "go" → submit,
 *  - autoComplete surfaces saved-email / password suggestions in the keyboard,
 *  - validation reuses the shared `LoginRequestSchema`; errors are per-field and
 *    clear as the user types; invalid credentials vs transport map to distinct
 *    messages,
 *  - the focused field is highlighted; tapping empty space or scrolling
 *    dismisses the keyboard.
 * All user-visible text goes through `t()` (no hardcoded TR).
 */
export function LoginScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const authLogin = useAuthStore((state) => state.login);
  const lastEmail = useAuthStore((state) => state.lastEmail);
  const lastTenantSlug = useAuthStore((state) => state.lastTenantSlug);

  const [email, setEmail] = useState(lastEmail ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [tenantSlug, setTenantSlug] = useState(lastTenantSlug ?? '');
  const [tenantSlugError, setTenantSlugError] = useState<string | null>(null);
  const [slugOpen, setSlugOpen] = useState(false);
  const [focusSlugOnOpen, setFocusSlugOnOpen] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | 'tenantSlug' | null>(
    null,
  );

  // ADR-002 §13.6 (Amd7) — oturum sunucu tarafından sonlandırıldıysa sebebi
  // söyle. Aksi halde garson sebepsizce atılmış gibi hisseder (Nielsen #1).
  //
  // 🔑 Mevcut KALICI `formError` alanı yeniden kullanılıyor: toast DEĞİL.
  // Toast bu ekranda iki kez kaybolur — navigator remount'unda ve RN'de bir
  // Modal/Alert açıkken hiç görünmez (kayıtlı tuzaklar).
  const logoutReason = useAuthStore((state) => state.logoutReason);
  const clearLogoutReason = useAuthStore((state) => state.clearLogoutReason);
  useEffect(() => {
    if (logoutReason === 'session-ended') {
      setFormError(t('auth.error.tokenInvalid'));
      // Tek kullanımlık: bir sonraki girişte tekrar gösterilmesin.
      clearLogoutReason();
    }
  }, [logoutReason, clearLogoutReason, t]);
  const [submitting, setSubmitting] = useState(false);

  const passwordRef = useRef<TextInput>(null);
  const tenantSlugRef = useRef<TextInput>(null);
  const hasRememberedEmail = (lastEmail ?? '') !== '';

  /**
   * Panel ELLE açıldığında alana odaklan (bir dokunuş eksilir).
   *
   * ⚠️ KENDİLİĞİNDEN açılışta (401 veya biçim hatası) odak **zorlanmaz**:
   * klavye açılır ve tam o anda okunması gereken hata metnini + gönder
   * düğmesini örter. Hata görünmeden klavye açmak, kullanıcıyı sebebi
   * göremeden tekrar denemeye iter.
   */
  useEffect(() => {
    if (slugOpen && focusSlugOnOpen) {
      tenantSlugRef.current?.focus();
      setFocusSlugOnOpen(false);
    }
  }, [slugOpen, focusSlugOnOpen]);

  const onSubmit = async (): Promise<void> => {
    Keyboard.dismiss();
    setEmailError(null);
    setPasswordError(null);
    setFormError(null);
    setTenantSlugError(null);

    // Boş kod UNDEFINED olmalı: şema `.optional()` AMA regex'li, '' geçmez ve
    // "boş bırakmak geçerli" kuralı sessizce kırılırdı (kullanıcı gönderemez).
    const normalizedSlug = normalizeTenantSlug(tenantSlug);
    const parsed = LoginRequestSchema.safeParse({
      email: email.trim(),
      password,
      ...(normalizedSlug === '' ? {} : { tenantSlug: normalizedSlug }),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'email') {
          setEmailError(
            email.trim() === ''
              ? t('auth.login.email.required')
              : t('auth.login.email.invalid'),
          );
        } else if (issue.path[0] === 'password') {
          setPasswordError(t('auth.login.password.required'));
        } else if (issue.path[0] === 'tenantSlug') {
          // Panel kapalıyken hata GÖRÜNMEZ; kullanıcı butona basar ve hiçbir
          // şey olmaz. Hata varsa paneli kendiliğinden aç (web'le aynı karar).
          setSlugOpen(true);
          setTenantSlugError(t('auth.login.tenantSlug.invalid'));
        }
      }
      return;
    }

    setSubmitting(true);
    try {
      const response = await login(parsed.data);
      await authLogin(response, normalizedSlug === '' ? undefined : normalizedSlug);
      // Navigator gate (App.tsx) reacts to isAuthenticated → Tables stack.
    } catch (error) {
      // Bad-credential and rate-limit errors carry a known code; anything else
      // (transport/unknown) is shown as a network problem so the waiter checks
      // the connection rather than re-typing a correct password. Real fetch
      // lands in PR-5d and reuses this same ApiError contract.
      //
      // ⚠️ İKİ rate-limit kodu AYRI metin alır, çünkü metin bekleme SÜRESİNİ
      // söylüyor ve pencereler farklı: `/login` kovaları 15 dk, router
      // seviyesindeki taban kova 60 sn. `/login` isteği her ikisine de
      // takılabilir (ADR-002 Amd8 madde 131, S141'de kapandı).
      const code = isApiError(error) ? error.code : null;
      const messageKeyByCode: Record<string, string> = {
        [AUTH_INVALID_CREDENTIALS]: 'auth.error.invalidCredentials',
        [AUTH_RATE_LIMITED]: 'auth.error.rateLimited',
        [AUTH_BASELINE_RATE_LIMITED]: 'auth.error.rateLimitedBaseline',
      };
      setFormError(t(messageKeyByCode[code ?? ''] ?? 'auth.error.networkError'));
      // 401'de paneli aç: sunucu bilerek ayırt edici hata vermiyor
      // (enumeration), ama İSTEMCİ kodun kullanıldığını biliyor. Açılmazsa
      // garson şifreyi suçlar, yanlış/bayat kodu asla aklına getirmez.
      if (code === AUTH_INVALID_CREDENTIALS) setSlugOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // Amd5 hci-fix — üst inset App kabuğunda; ekran yalnız alt inset'i taşır
    // (root-stack ekranı: altında sekme çubuğu yok).
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Pressable
            style={styles.pressArea}
            onPress={() => {
              Keyboard.dismiss();
            }}
            accessible={false}
          >
            <View style={styles.header}>
              <View style={styles.brandMark}>
                <MaterialCommunityIcons
                  name="chef-hat"
                  size={34}
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
                  style={[
                    styles.input,
                    focusedField === 'email' && styles.inputFocused,
                    emailError !== null && styles.inputError,
                  ]}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    if (emailError !== null) setEmailError(null);
                  }}
                  placeholder={t('auth.login.email.placeholder')}
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  editable={!submitting}
                  autoFocus={!hasRememberedEmail}
                />
                {emailError !== null ? (
                  <Text style={styles.errorText}>{emailError}</Text>
                ) : null}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>
                  {t('auth.login.password.label')}
                </Text>
                <View
                  style={[
                    styles.passwordRow,
                    focusedField === 'password' && styles.inputFocused,
                    passwordError !== null && styles.inputError,
                  ]}
                >
                  <TextInput
                    ref={passwordRef}
                    style={styles.passwordInput}
                    value={password}
                    onChangeText={(text) => {
                      setPassword(text);
                      if (passwordError !== null) setPasswordError(null);
                    }}
                    placeholder={t('auth.login.password.placeholder')}
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    textContentType="password"
                    autoComplete="off"
                    importantForAutofill="no"
                    returnKeyType="go"
                    onSubmitEditing={() => {
                      void onSubmit();
                    }}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    editable={!submitting}
                    autoFocus={hasRememberedEmail}
                  />
                  <Pressable
                    style={styles.eyeButton}
                    onPress={() => {
                      setShowPassword((value) => !value);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t(
                      showPassword
                        ? 'auth.login.password.hide'
                        : 'auth.login.password.show',
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
                {passwordError !== null ? (
                  <Text style={styles.errorText}>{passwordError}</Text>
                ) : null}
              </View>

              {/*
                ADR-042 K1.7 — işletme kodu. VARSAYILAN OLARAK KAPALI; boş
                bırakmak geçerli bir giriştir (sunucu varsayılan işletmeye
                düşer). Web ile AYNI karar: bugün tek işletme var ve her gün
                kullanılan bu ekrana sıfır fayda katacak bir alanı açık tutmak
                garsonun işini yavaşlatırdı.
              */}
              <View style={styles.field}>
                <Pressable
                  style={styles.slugToggle}
                  onPress={() => {
                    const next = !slugOpen;
                    setSlugOpen(next);
                    if (next) setFocusSlugOnOpen(true);
                  }}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: slugOpen }}
                  // accessibilityLabel YOK: sabit "İşletme kodu" verilseydi
                  // ekran okuyucu hatırlanan kodu ("İşletme: dilan-pide")
                  // OKUMAZDI. Görünen metin zaten ad görevi görüyor
                  // (WCAG 2.5.3 etiket-ad uyumu).
                  hitSlop={8}
                >
                  <MaterialCommunityIcons
                    name="storefront-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.slugToggleText}>
                    {lastTenantSlug !== null && lastTenantSlug !== ''
                      ? t('auth.login.tenantSlug.current', {
                          slug: lastTenantSlug,
                        })
                      : t('auth.login.tenantSlug.toggle')}
                  </Text>
                  <MaterialCommunityIcons
                    name={slugOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </Pressable>
                {slugOpen ? (
                  <View style={styles.slugPanel}>
                    <TextInput
                      ref={tenantSlugRef}
                      style={[
                        styles.input,
                        focusedField === 'tenantSlug' && styles.inputFocused,
                        tenantSlugError !== null && styles.inputError,
                      ]}
                      value={tenantSlug}
                      onChangeText={(text) => {
                        setTenantSlug(text);
                        if (tenantSlugError !== null) setTenantSlugError(null);
                      }}
                      placeholder={t('auth.login.tenantSlug.placeholder')}
                      placeholderTextColor={colors.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      autoComplete="off"
                      returnKeyType="go"
                      onSubmitEditing={() => {
                        void onSubmit();
                      }}
                      onFocus={() => setFocusedField('tenantSlug')}
                      onBlur={() => setFocusedField(null)}
                      editable={!submitting}
                    />
                    <Text style={styles.slugHint}>
                      {t('auth.login.tenantSlug.hint')}
                    </Text>
                    {tenantSlugError !== null ? (
                      <Text style={styles.errorText}>{tenantSlugError}</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {formError !== null ? (
                <Text style={[styles.errorText, styles.formError]}>
                  {formError}
                </Text>
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
                  <View style={styles.submitLoading}>
                    <ActivityIndicator color={colors.slateText} />
                    <Text style={styles.submitText}>
                      {t('auth.login.submitting')}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.submitText}>{t('auth.login.submit')}</Text>
                )}
              </Pressable>

              <Text style={styles.forgotHint}>{t('auth.login.forgotHint')}</Text>
            </View>
          </Pressable>
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
  },
  pressArea: {
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
    width: 76,
    height: 76,
    borderRadius: radius.lg,
    backgroundColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 27,
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
  // ADR-042 K1.7 — işletme kodu açılır bölümü.
  // ⚠️ Dokunma hedefi `buttonHeight` (52) — mobilin kendi sabiti.
  // `docs/hci/exceptions.md` #2'deki 44px istisnası YALNIZ web içindir
  // (fare-öncelikli dükkan PC'si); mobil parmak-önceliklidir ve
  // pos-checklist'in 52×52 kuralı burada aynen geçerlidir.
  slugToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: buttonHeight,
  },
  slugToggleText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
  },
  slugPanel: {
    gap: spacing.xs,
  },
  slugHint: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  input: {
    minHeight: inputHeight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  inputFocused: {
    borderColor: colors.slate,
  },
  inputError: {
    borderColor: colors.danger,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: inputHeight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  passwordInput: {
    flex: 1,
    minHeight: inputHeight,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  eyeButton: {
    width: minTouchTarget,
    minHeight: inputHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },
  formError: {
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  submit: {
    height: buttonHeight,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  submitPressed: {
    opacity: 0.85,
  },
  submitLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  submitText: {
    color: colors.slateText,
    fontSize: 17,
    fontWeight: '700',
  },
  forgotHint: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
