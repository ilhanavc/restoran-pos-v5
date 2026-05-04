/**
 * Caller ID bypass pattern matcher — ADR-016 §11 Karar 11.4.
 *
 * Yemeksepeti / Trendyol Yemek / kurumsal santral hatları (örn. `0850...`,
 * `0444...`, `0440...`) müşteri rehberine eklenmemeli; backend bypass
 * pattern listesi ile bu numaraları sessizce yutar (popup gösterilmez,
 * call_logs'a yazılmaz). Pattern listesi `tenant_settings.caller_id_bypass_patterns`
 * (TEXT[]).
 *
 * Geçersiz regex pattern (admin yanlış yazdı) atlanır — listenin geri kalanı
 * çalışmaya devam eder; geçersiz pattern hata fırlatmaz (UI'da admin'e ayrı
 * validate endpoint ile uyarı verilir, runtime sürpriz olmasın).
 */

export interface BypassMatchResult {
  matched: boolean;
  patternMatched?: string;
}

/**
 * Normalize edilmiş telefon numarası (`0XXXXXXXXXX`) verilen regex pattern
 * listesinden herhangi birine uyuyorsa `matched=true` + ilk eşleşen pattern.
 *
 * @param normalizedPhone - `normalizePhoneTr` çıktısı (E.164 değil, TR formatı).
 * @param patterns - Tenant ayarlarındaki regex string listesi.
 */
export function isMaskedNumber(
  normalizedPhone: string,
  patterns: string[],
): BypassMatchResult {
  if (normalizedPhone === '' || patterns.length === 0) {
    return { matched: false };
  }
  for (const p of patterns) {
    let regex: RegExp;
    try {
      regex = new RegExp(p);
    } catch {
      // Geçersiz regex — atla, listenin geri kalanı çalışır.
      continue;
    }
    if (regex.test(normalizedPhone)) {
      return { matched: true, patternMatched: p };
    }
  }
  return { matched: false };
}
