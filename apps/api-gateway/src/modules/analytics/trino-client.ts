import { Logger } from '@nestjs/common';

export type FetchFn = typeof fetch;

/**
 * Minimal Trino REST client.
 *
 * Trino's `POST /v1/statement` returns a chain of pages linked by `nextUri`;
 * we follow the chain until there is no `nextUri`, accumulating `data` rows.
 * Columns and rows are positional arrays (Trino's wire format).
 */
interface TrinoPage {
  columns?: Array<{ name: string }>;
  data?: unknown[][];
  nextUri?: string;
  error?: { message: string };
}

export interface TrinoResult {
  columns: string[];
  rows: unknown[][];
}

export class TrinoClient {
  private readonly logger = new Logger(TrinoClient.name);
  private readonly baseUrl: string;

  constructor(
    trinoUrl: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly user = 'api-gateway',
    private readonly catalog = 'lakehouse',
    private readonly schema = 'omop_gold',
  ) {
    this.baseUrl = trinoUrl.replace(/\/$/, '');
  }

  async query(sql: string): Promise<TrinoResult> {
    let page = await this.submit(sql);
    const columns: string[] = (page.columns ?? []).map((c) => c.name);
    const rows: unknown[][] = [...(page.data ?? [])];

    while (page.nextUri) {
      page = await this.next(page.nextUri);
      if (page.error) {
        throw new Error(`Trino query failed: ${page.error.message}`);
      }
      if (page.columns && columns.length === 0) {
        columns.push(...page.columns.map((c) => c.name));
      }
      if (page.data) rows.push(...page.data);
    }

    return { columns, rows };
  }

  private async submit(sql: string): Promise<TrinoPage> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/statement`, {
      method: 'POST',
      headers: {
        'X-Trino-User': this.user,
        'X-Trino-Catalog': this.catalog,
        'X-Trino-Schema': this.schema,
        'Content-Type': 'text/plain',
      },
      body: sql,
    });
    if (!res.ok) {
      throw new Error(`Trino submit failed with status ${res.status}`);
    }
    return (await res.json()) as TrinoPage;
  }

  private async next(uri: string): Promise<TrinoPage> {
    const res = await this.fetchFn(uri, {
      method: 'GET',
      headers: { 'X-Trino-User': this.user },
    });
    if (!res.ok) {
      throw new Error(`Trino paging failed with status ${res.status}`);
    }
    return (await res.json()) as TrinoPage;
  }
}
