/** Transport boundary: tests replace HTTP, never credentials or endpoints via env flags. */
export abstract class NotificationHttpTransport {
  abstract fetch(url: string, init: RequestInit): Promise<Response>;
}

export class FetchNotificationHttpTransport extends NotificationHttpTransport {
  fetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }
}

const RESPONSE_LIMIT_BYTES = 16 * 1024;

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT_BYTES) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** The deadline covers headers AND body. Never read or expose upstream error bodies. */
export async function notificationRequest(
  transport: NotificationHttpTransport,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await transport.fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return { status: response.status, data: undefined };
    }
    return { status: response.status, data: await readJson(response) };
  } finally {
    clearTimeout(timer);
  }
}
