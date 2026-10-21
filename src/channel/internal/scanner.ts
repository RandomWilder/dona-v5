// The malware scanner is injected. This file is the local one `npm run dev`
// uses, and the choice of whether a revision may use it. It does not decide
// what a file is allowed to be.

export interface MalwareScanner {
  scan(bytes: Buffer): Promise<'clean' | 'infected'>;
}

const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Clean, except the EICAR test string, which is infected. */
export function createDevMalwareScanner(): MalwareScanner {
  return {
    async scan(bytes) {
      return bytes.includes(EICAR) ? 'infected' : 'clean';
    },
  };
}

/**
 * The local scanner exists only where `K_SERVICE` is unset. A Cloud Run
 * revision with no other scanner leaves files in quarantine.
 */
export function scannerFromEnv(
  env: NodeJS.ProcessEnv,
): MalwareScanner | undefined {
  if (env.K_SERVICE) return undefined;
  return createDevMalwareScanner();
}
