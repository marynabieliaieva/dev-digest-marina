import sgMail from '@sendgrid/mail';
import type { EmailMessage, EmailSender } from '@devdigest/shared';

export class SendgridEmailSender implements EmailSender {
  constructor(apiKey: string, private readonly from: string) {
    sgMail.setApiKey(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    await sgMail.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.body,
    });
  }
}
