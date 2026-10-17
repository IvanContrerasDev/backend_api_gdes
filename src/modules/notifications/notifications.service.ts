import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { isEmail } from 'class-validator';
import { ApiException } from '../../common/errors/api.exception';
import { NotificationHttpTransport, notificationRequest } from './notification-http.transport';

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  /** Same business event must reuse both this key and the original message content. */
  idempotencyKey?: string;
}
export abstract class EmailProvider {
  abstract sendEmail(input: EmailInput): Promise<void>;
}
export abstract class WhatsAppProvider {
  abstract sendOtp(input: { phone: string; code: string }): Promise<void>;
}

function unavailable(): ApiException {
  return new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'NOTIFICATION_UNAVAILABLE',
    'No se pudo enviar la notificación. Intentá nuevamente.',
  );
}
function hasId(data: unknown): data is { id: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'id' in data &&
    typeof data.id === 'string' &&
    data.id.trim().length > 0
  );
}

@Injectable()
export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly http: NotificationHttpTransport,
  ) {}

  async sendEmail(input: EmailInput): Promise<void> {
    const key = input.idempotencyKey ?? randomUUID();
    if (
      !isEmail(input.to) ||
      !input.subject.trim() ||
      !input.html.trim() ||
      !/^[\x21-\x7e]{1,256}$/.test(key)
    )
      throw unavailable();
    const body = JSON.stringify({
      from: this.config.getOrThrow<string>('EMAIL_FROM'),
      to: [input.to],
      subject: input.subject,
      html: input.html,
    });
    const headers = {
      Authorization: `Bearer ${this.config.getOrThrow<string>('RESEND_API_KEY')}`,
      'Idempotency-Key': key,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      let retry = false;
      try {
        const result = await notificationRequest(
          this.http,
          'https://api.resend.com/emails',
          headers,
          body,
        );
        if (result.status >= 200 && result.status < 300 && hasId(result.data)) return;
        retry = result.status === 429 || result.status >= 500;
      } catch {
        // Network errors and timeouts may have sent the email; reuse exact body/key.
        retry = true;
      }
      if (!retry || attempt === 2) throw unavailable();
      const delay = 250 * 2 ** attempt + Math.floor(Math.random() * 100);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

@Injectable()
export class MetaWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly http: NotificationHttpTransport,
  ) {}

  async sendOtp(input: { phone: string; code: string }): Promise<void> {
    if (!/^\d{6}$/.test(input.code) || !/^\d{10,13}$/.test(input.phone)) throw unavailable();
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      to: input.phone,
      type: 'template',
      template: {
        name: this.config.getOrThrow<string>('WHATSAPP_OTP_TEMPLATE_NAME'),
        language: { code: this.config.getOrThrow<string>('WHATSAPP_TEMPLATE_LANGUAGE') },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: input.code }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: input.code }],
          },
        ],
      },
    });
    const version = this.config.getOrThrow<string>('WHATSAPP_API_VERSION');
    const phoneId = this.config.getOrThrow<string>('WHATSAPP_PHONE_NUMBER_ID');
    // Validate path segments even when constructed outside the validated application module.
    if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(phoneId)) throw unavailable();
    try {
      const result = await notificationRequest(
        this.http,
        `https://graph.facebook.com/${version}/${phoneId}/messages`,
        { Authorization: `Bearer ${this.config.getOrThrow<string>('WHATSAPP_TOKEN')}` },
        body,
      );
      const data = result.data;
      if (
        result.status >= 200 &&
        result.status < 300 &&
        typeof data === 'object' &&
        data !== null &&
        'messages' in data &&
        Array.isArray(data.messages) &&
        hasId(data.messages[0])
      )
        return;
    } catch {
      // No automatic retry: Meta has no send idempotency key, delivery may be ambiguous.
    }
    throw unavailable();
  }
}

@Injectable()
export class LogNotifications implements EmailProvider, WhatsAppProvider {
  private readonly logger = new Logger('DevOtp');
  constructor(config: ConfigService) {
    if (config.get('NODE_ENV') === 'production')
      throw new Error(
        'Log notification providers are not implemented for production; select real notification providers',
      );
  }
  async sendEmail(input: EmailInput): Promise<void> {
    const code =
      input.subject === 'Código de acceso GdeS'
        ? /<strong>(\d{6})<\/strong>/.exec(input.html)?.[1]
        : undefined;
    this.logger.log(`Development email recipient=[redacted]${code ? ` code=${code}` : ''}`);
  }
  async sendOtp(input: { phone: string; code: string }): Promise<void> {
    this.logger.log(`Development WhatsApp recipient=[redacted] code=${input.code}`);
  }
}
