import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FetchNotificationHttpTransport,
  NotificationHttpTransport,
} from './notification-http.transport';
import {
  EmailProvider,
  LogNotifications,
  MetaWhatsAppProvider,
  ResendEmailProvider,
  WhatsAppProvider,
} from './notifications.service';

@Module({
  providers: [
    { provide: NotificationHttpTransport, useFactory: () => new FetchNotificationHttpTransport() },
    {
      provide: EmailProvider,
      inject: [ConfigService, NotificationHttpTransport],
      useFactory: (config: ConfigService, http: NotificationHttpTransport): EmailProvider => {
        switch (config.get<string>('EMAIL_PROVIDER')) {
          case 'resend':
            return new ResendEmailProvider(config, http);
          case 'log':
            return new LogNotifications(config);
          default:
            throw new Error('Invalid EMAIL_PROVIDER');
        }
      },
    },
    {
      provide: WhatsAppProvider,
      inject: [ConfigService, NotificationHttpTransport],
      useFactory: (config: ConfigService, http: NotificationHttpTransport): WhatsAppProvider => {
        switch (config.get<string>('WHATSAPP_PROVIDER')) {
          case 'meta':
            return new MetaWhatsAppProvider(config, http);
          case 'log':
            return new LogNotifications(config);
          default:
            throw new Error('Invalid WHATSAPP_PROVIDER');
        }
      },
    },
  ],
  exports: [EmailProvider, WhatsAppProvider],
})
export class NotificationsModule {}
