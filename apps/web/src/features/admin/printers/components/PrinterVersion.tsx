import { useTranslation } from 'react-i18next';

/**
 * ADR-044 K4 — yazıcı kartının **salt-okunur** sürüm göstergesi.
 *
 * İki parça, kartta iki ayrı yerde yaşar: satır gövdede (cihaz kimliği / son
 * görülme satırlarının yanında), çip ad hizasındaki rozet grubunda. Bu yüzden
 * tek bileşen değiller.
 *
 * DİL KURALI (ADR-032 Amd2 K1 + ADR-004 Amd14 as-built): kullanıcıya "yazıcı"
 * denir, "agent"/"ajan" kelimesi bu ekranda GEÇMEZ — alan adı wire'da
 * `agentVersion` olsa bile.
 *
 * Yıkıcı aksiyon YOK: sürüm yükseltme dükkan PC'sinde elle yapılıyor
 * (ADR-044 K5 `update-agents.ps1`), buradan tetiklenemez.
 */

/** Sürüm satırı — değer varsa sürüm, NULL ise "bildirilmedi". */
export function PrinterVersionLine({
  agentVersion,
}: {
  agentVersion: string | null;
}) {
  const { t } = useTranslation();
  return (
    <p className="text-[12px] text-muted-foreground" data-testid="printer-version-line">
      {agentVersion === null
        ? t('admin.printers.versionUnknown')
        : t('admin.printers.agentVersion', { version: agentVersion })}
    </p>
  );
}

/**
 * "Güncel değil" uyarı çipi — yalnız `versionStale` true iken.
 *
 * Kural SUNUCUDA hesaplanır (`PRINT_AGENT_EXPECTED_VERSION`); istemci yeniden
 * hesaplamaz, env'i bilmez. Görsel dil karttaki `filterless-chip` ile AYNI
 * (amber uyarı) — yeni bir stil icat edilmedi.
 */
export function PrinterVersionStaleChip() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="version-stale-chip"
      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: '#fef3c7', color: '#92400e' }}
    >
      {t('admin.printers.versionStale')}
    </span>
  );
}
