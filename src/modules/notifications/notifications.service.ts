import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export abstract class EmailProvider {
  abstract sendEmail(input: { to: string; subject: string; html: string }): Promise<void>;
}
export abstract class WhatsAppProvider {
  abstract sendOtp(input: { phone: string; code: string }): Promise<void>;
}
@Injectable()
export class LogNotifications implements EmailProvider, WhatsAppProvider {
  private readonly logger = new Logger('DevOtp');
  constructor(config: ConfigService) {
    if (
      config.get('NODE_ENV') === 'production' ||
      config.get('EMAIL_PROVIDER') !== 'log' ||
      config.get('WHATSAPP_PROVIDER') !== 'log'
    )
      throw new Error(
        'Real notification providers are not implemented; log is development/test only',
      );
  }
  async sendEmail(input: { to: string; subject: string; html: string }): Promise<void> {
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
