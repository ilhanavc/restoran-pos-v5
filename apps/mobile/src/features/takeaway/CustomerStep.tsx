import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createCustomer,
  searchCustomers,
  type CustomerSummary,
} from '../../api/customers';
import {
  buttonHeight,
  colors,
  inputHeight,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from '../../theme';
import { primaryPhoneOf } from './payload';

/** Arama debounce'u (K11) — her tuşta istek atılmaz; K4 bütçesini de korur. */
const SEARCH_DEBOUNCE_MS = 350;

interface CustomerStepProps {
  /** Müşteri seçildi → sarmalayıcı sheet kapanır, ödeme adımına geçilir. */
  onSelect: (customer: { id: string; fullName: string }) => void;
}

/**
 * Paket akışı — **müşteri seçimi** (ADR-039 Amendment 1 K1/K2).
 *
 * Sıra web ile HİZALIDIR: sepet doldurulur, "Devam"a basılır, müşteri **ondan
 * sonra** sorulur. Bu bileşen artık bir tam-ekran adım değil, `CustomerSheet`
 * içinde açılan sheet'in içeriğidir — sarmalayıcısı değişti, içeriği aynen
 * korundu (ikinci bir müşteri arama bileşeni yazmak yasaktır).
 *
 * Müşteri yine de **zorunlu kapıdır** (Amd1 K3): `orders_takeaway_customer_required`
 * DB CHECK'i müşterisiz paket siparişe izin vermez (ADR-017), bu yüzden "Devam"
 * müşterisiz ödeme sheet'ini açmaz ve akış burada durur. Garson sunucu reddini
 * hiç görmez; değişen tek şey kapının ekranın başında değil "Devam" tuşunda
 * durmasıdır.
 *
 * **Erişim kapsamı (ADR-039 S1=(c) / K3.1):** arama sunucuda kasiyerinkiyle
 * BİREBİR aynı uçtan, aynı projeksiyonla döner — minimum sorgu uzunluğu,
 * sonuç tavanı veya telefon maskeleme UYGULANMAZ. Bu, ürün sahibinin bilinçle
 * aldığı bir KVKK kararıdır (ADR-039 S1 alıntısı); burada rol-koşullu bir
 * daraltma yazmak o kararı fiilen uygulamamak olurdu.
 *
 * **Geri bildirim satır-içidir, toast DEĞİL** ([[feedback_rn_modal_layout_traps]]):
 * bu adım bir akış ekranıdır ve üstüne modal (yeni müşteri formu) açılabilir;
 * modal görünürken toast RN'de görünmez, kullanıcı "olmadı" sanar.
 */
export function CustomerStep({
  onSelect,
}: CustomerStepProps): React.JSX.Element {
  const { t } = useTranslation();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** Arama hiç yapılmadıysa "sonuç yok" yerine yönlendirici ipucu gösterilir. */
  const [searched, setSearched] = useState(false);

  // Yeni müşteri formu (satır-içi, modal DEĞİL — tek ekranda kalır).
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      setSearched(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      searchCustomers(term)
        .then((rows) => {
          if (cancelled) return;
          setResults(rows);
          setSearched(true);
        })
        .catch(() => {
          if (cancelled) return;
          // Arama terimi PII'dir; hata mesajına ve log'a KOYULMAZ (K8).
          setResults([]);
          setSearchError(t('takeaway.customer.searchError'));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, t]);

  async function handleCreate(): Promise<void> {
    const fullName = newName.trim();
    const rawPhone = newPhone.trim();
    // Sunucu şemasıyla AYNI eşik (fullName 2-120, en az 1 telefon) — burada
    // erken uyarı verilir, otorite yine sunucudur (DoD 6: garson gövdesi
    // kasiyerinkiyle aynı doğrulamadan geçer, ek kısıt/gevşetme yok).
    if (fullName.length < 2 || rawPhone.length === 0) {
      setCreateError(t('takeaway.customer.createInvalid'));
      return;
    }
    setSaving(true);
    setCreateError(null);
    try {
      const created = await createCustomer({ fullName, rawPhone });
      onSelect({ id: created.id, fullName: created.fullName });
    } catch {
      setCreateError(t('takeaway.customer.createError'));
    } finally {
      setSaving(false);
    }
  }

  const renderRow = ({
    item,
  }: {
    item: CustomerSummary;
  }): React.JSX.Element => {
    const phone = primaryPhoneOf(item.phones);
    return (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => onSelect({ id: item.id, fullName: item.fullName })}
        accessibilityRole="button"
        accessibilityLabel={t('takeaway.customer.selectLabel', {
          name: item.fullName,
        })}
      >
        <View style={styles.rowTexts}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.fullName}
          </Text>
          {phone !== null ? (
            <Text style={styles.rowPhone} numberOfLines={1}>
              {phone}
            </Text>
          ) : null}
        </View>
        {/* Kara listedeki müşteri gizlenmez, İŞARETLENİR: kararı garson verir
            (kasiyerle aynı bilgi — K3.1), sistem sessizce saklamaz. */}
        {item.isBlacklisted ? (
          <View style={styles.flagBadge}>
            <Text style={styles.flagText}>
              {t('takeaway.customer.blacklisted')}
            </Text>
          </View>
        ) : null}
        <Ionicons
          name="chevron-forward"
          size={20}
          color={colors.textSecondary}
        />
      </Pressable>
    );
  };

  if (creating) {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>{t('takeaway.customer.newTitle')}</Text>
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={(value) => {
            setNewName(value);
            setCreateError(null);
          }}
          placeholder={t('takeaway.customer.namePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="words"
        />
        <TextInput
          style={styles.input}
          value={newPhone}
          onChangeText={(value) => {
            setNewPhone(value);
            setCreateError(null);
          }}
          placeholder={t('takeaway.customer.phonePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          keyboardType="phone-pad"
        />
        {/* Satır-içi hata (toast DEĞİL) — akışın içinde, alanların hemen altında. */}
        {createError !== null ? (
          <Text style={styles.errorText}>{createError}</Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            saving && styles.buttonDisabled,
            pressed && !saving && styles.buttonPressed,
          ]}
          onPress={() => {
            void handleCreate();
          }}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          accessibilityLabel={t('takeaway.customer.createSave')}
        >
          {saving ? (
            <ActivityIndicator color={colors.slateText} />
          ) : (
            <Text style={styles.primaryButtonText}>
              {t('takeaway.customer.createSave')}
            </Text>
          )}
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            setCreating(false);
            setCreateError(null);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Text style={styles.secondaryButtonText}>{t('common.close')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={t('takeaway.customer.searchPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searching ? <ActivityIndicator color={colors.textSecondary} /> : null}
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              {searchError !== null
                ? searchError
                : searched
                  ? t('takeaway.customer.noResults')
                  : t('takeaway.customer.searchHint')}
            </Text>
          </View>
        }
      />

      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={() => {
          // Aranan metni ada ön-doldur: "yok, yeni açayım" akışında garson
          // aynı ismi ikinci kez yazmaz.
          setNewName(query.trim());
          setCreating(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={t('takeaway.customer.newCustomer')}
      >
        <Ionicons name="person-add" size={20} color={colors.slateText} />
        <Text style={styles.primaryButtonText}>
          {t('takeaway.customer.newCustomer')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: inputHeight,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSize.md,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: inputHeight,
    fontSize: typography.fontSize.md,
    color: colors.textPrimary,
  },
  list: {
    gap: spacing.xs,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  rowPressed: {
    opacity: 0.8,
  },
  rowTexts: {
    flex: 1,
  },
  rowName: {
    fontSize: typography.fontSize.md,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rowPhone: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
  },
  flagBadge: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  flagText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
    color: colors.danger,
  },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyText: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.danger,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: buttonHeight,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.slateText,
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  secondaryButton: {
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.md,
    fontWeight: '600',
  },
});
