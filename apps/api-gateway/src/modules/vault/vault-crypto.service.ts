/**
 * VaultCryptoService
 *
 * Wraps HashiCorp Vault Transit engine for envelope-encryption of PHI fields.
 * Mount: "medflow-transit", Key: "phi-field-key"
 *
 * Circuit breaker pattern:
 *   - Opens after CIRCUIT_FAILURE_THRESHOLD consecutive failures
 *   - Half-open after CIRCUIT_OPEN_MS milliseconds — one probe attempt allowed
 *   - On vault outage: reads degrade to masked placeholder "***unavailable***"
 *     but writes FAIL (never write plaintext as a fallback — data integrity first)
 */

export type VaultCiphertext = string; // "vault:v1:..."

interface VaultEncryptResponse {
  data: { ciphertext: VaultCiphertext };
}

interface VaultDecryptResponse {
  data: { plaintext: string }; // base64
}

interface VaultBatchEncryptResponse {
  data: { batch_results: Array<{ ciphertext: VaultCiphertext }> };
}

interface VaultBatchDecryptResponse {
  data: { batch_results: Array<{ plaintext: string }> };
}

type CircuitState = 'closed' | 'open' | 'half-open';

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 30_000; // 30 s before attempting half-open

export const VAULT_UNAVAILABLE_PLACEHOLDER = '***unavailable***';

/** Injectable fetch-wrapper type so tests can mock network calls cleanly. */
export type FetchFn = typeof fetch;

export class VaultCryptoService {
  private readonly vaultAddr: string;
  private readonly vaultToken: string;
  private readonly mount = 'medflow-transit';
  private readonly key = 'phi-field-key';

  private circuitState: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openSince = 0;

  constructor(
    vaultAddr: string,
    vaultToken: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.vaultAddr = vaultAddr.replace(/\/$/, '');
    this.vaultToken = vaultToken;
  }

  // ── Circuit breaker helpers ───────────────────────────────────────────────

  private isCircuitOpen(): boolean {
    if (this.circuitState === 'open') {
      if (Date.now() - this.openSince >= CIRCUIT_OPEN_MS) {
        this.circuitState = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitState = 'closed';
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitState = 'open';
      this.openSince = Date.now();
    }
  }

  // ── Core request helper ───────────────────────────────────────────────────

  private async vaultPost<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.vaultAddr}/v1/${path}`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vault-Token': this.vaultToken,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Vault returned ${response.status} for ${path}`);
    }
    return response.json() as Promise<T>;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Encrypts a plaintext string using Vault Transit.
   * Returns "vault:v1:..." ciphertext.
   * THROWS if vault is unavailable — callers must not persist plaintext.
   */
  async encrypt(plaintext: string): Promise<VaultCiphertext> {
    if (this.isCircuitOpen()) {
      throw new Error(
        'VaultCryptoService circuit breaker OPEN — refusing write to prevent plaintext storage',
      );
    }
    const b64 = Buffer.from(plaintext).toString('base64');
    try {
      const result = await this.vaultPost<VaultEncryptResponse>(
        `${this.mount}/encrypt/${this.key}`,
        { plaintext: b64 },
      );
      this.recordSuccess();
      return result.data.ciphertext;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  /**
   * Decrypts a Vault ciphertext. On vault outage the circuit opens and
   * returns the masked placeholder so reads degrade gracefully.
   */
  async decrypt(ciphertext: VaultCiphertext): Promise<string> {
    if (this.isCircuitOpen()) {
      return VAULT_UNAVAILABLE_PLACEHOLDER;
    }
    try {
      const result = await this.vaultPost<VaultDecryptResponse>(
        `${this.mount}/decrypt/${this.key}`,
        { ciphertext },
      );
      this.recordSuccess();
      return Buffer.from(result.data.plaintext, 'base64').toString('utf8');
    } catch (err) {
      this.recordFailure();
      return VAULT_UNAVAILABLE_PLACEHOLDER;
    }
  }

  /**
   * Batch encrypt — uses Vault batch_input for efficiency.
   * All-or-nothing: throws if vault is unavailable.
   */
  async encryptBatch(plaintexts: string[]): Promise<VaultCiphertext[]> {
    if (this.isCircuitOpen()) {
      throw new Error(
        'VaultCryptoService circuit breaker OPEN — refusing batch write',
      );
    }
    const batch_input = plaintexts.map((p) => ({
      plaintext: Buffer.from(p).toString('base64'),
    }));
    try {
      const result = await this.vaultPost<VaultBatchEncryptResponse>(
        `${this.mount}/encrypt/${this.key}`,
        { batch_input },
      );
      this.recordSuccess();
      return result.data.batch_results.map((r) => r.ciphertext);
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  /**
   * Batch decrypt — uses Vault batch_input. Returns masked placeholder per
   * item on vault outage so partial reads still degrade gracefully.
   */
  async decryptBatch(ciphertexts: VaultCiphertext[]): Promise<string[]> {
    if (this.isCircuitOpen()) {
      return ciphertexts.map(() => VAULT_UNAVAILABLE_PLACEHOLDER);
    }
    const batch_input = ciphertexts.map((c) => ({ ciphertext: c }));
    try {
      const result = await this.vaultPost<VaultBatchDecryptResponse>(
        `${this.mount}/decrypt/${this.key}`,
        { batch_input },
      );
      this.recordSuccess();
      return result.data.batch_results.map((r) =>
        Buffer.from(r.plaintext, 'base64').toString('utf8'),
      );
    } catch (err) {
      this.recordFailure();
      return ciphertexts.map(() => VAULT_UNAVAILABLE_PLACEHOLDER);
    }
  }

  /** Exposed for testing — resets circuit state. */
  _resetCircuit(): void {
    this.circuitState = 'closed';
    this.consecutiveFailures = 0;
    this.openSince = 0;
  }

  /** Exposed for testing — force open circuit. */
  _forceOpen(): void {
    this.circuitState = 'open';
    this.openSince = Date.now();
  }
}
