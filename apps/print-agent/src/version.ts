import packageJson from '../package.json' with { type: 'json' };

/**
 * Print Agent binary versiyonu — `package.json` tek kaynak.
 *
 * WiX `Package/@Version` ve `nssm DisplayName` aynı string'i kullansın diye
 * runtime'a expose edilir. Build:exe sırasında pkg JSON'u binary'ye gömer;
 * `--version` flag'i veya `/healthz` (Phase 4+) bu sabitten okur.
 */
export const VERSION: string = packageJson.version;
