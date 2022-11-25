/**
 * Welcome to Cloudflare Workers! This is your first scheduled worker.
 *
 * - Run `wrangler dev --local` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/cdn-cgi/mf/scheduled"` to trigger the scheduled event
 * - Go back to the console to see what your worker has logged
 * - Update the Cron trigger in wrangler.toml (see https://developers.cloudflare.com/workers/wrangler/configuration/#triggers)
 * - Run `wrangler publish --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/runtime-apis/scheduled-event/
 */

export interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  // MY_KV_NAMESPACE: KVNamespace;
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  // MY_BUCKET: R2Bucket;

  AIRTABLE_API_KEY: string;
  CURRENCY_API_KEY: string;
}

const AIRTABLE_BANK_URL = "https://api.airtable.com/v0/appfAJWPbKnggpaHy/banks";

interface Row {
  id: string;
  createdTime: string;
  fields: {
    date: string;
    amount: number;
    currency: string;
    bank: string;
    modify_at: string;
  };
}

interface Changes {
  records: {
    id: string;
    fields: Record<string, any>;
  }[];
}

interface Table {
  records: Row[];
  offset?: string;
}

async function fetchHkdRates(apiKey: string): Promise<Record<string, number>> {
  const url = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/HKD`;
  const response = await fetch(url);
  return ((await response.json()) as any).conversion_rates;
}

async function fetchTable(apiKey: string): Promise<Table> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };
  const response = await fetch(AIRTABLE_BANK_URL, { headers, method: "GET" });
  return (await response.json()) as Table;
}

async function patchTable(changes: Changes, apiKey: string): Promise<void> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  await fetch(AIRTABLE_BANK_URL, {
    headers,
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

async function convertToHkd(
  amount: number,
  currency: string,
  rates: Record<string, number>
) {
  return amount / rates[currency.toUpperCase()];
}

async function convertTable(table: Table, rates: Record<string, number>) {
  const changes: Changes = {
    records: [],
  };
  for (const row of table.records) {
    const { amount, currency } = row.fields;
    const hkdAmount = await convertToHkd(amount, currency, rates);
    changes.records.push({
      id: row.id,
      fields: {
        "worth-hkd": hkdAmount,
      },
    });
  }
  return changes;
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(env);
    console.log(`Start currency job at`, new Date().toISOString());
    const [table, rate] = await Promise.all([
      fetchTable(env.AIRTABLE_API_KEY),
      fetchHkdRates(env.CURRENCY_API_KEY),
    ]);
    const changes = await convertTable(table, rate);
    await patchTable(changes, env.AIRTABLE_API_KEY);
    console.log(`Updated at`, new Date().toISOString());
  },
};
