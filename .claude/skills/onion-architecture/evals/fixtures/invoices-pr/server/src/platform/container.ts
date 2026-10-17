import type { SecretsProvider, EmailSender } from '@devdigest/shared';
import type { Db } from '../db/client.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { SendgridEmailSender } from '../adapters/email/sendgrid.js';

export interface ContainerOverrides {
  secrets?: SecretsProvider;
}

export class Container {
  private _email?: EmailSender;
  readonly secrets: SecretsProvider;

  constructor(readonly db: Db, overrides: ContainerOverrides = {}) {
    this.secrets = overrides.secrets ?? new LocalSecretsProvider();
  }

  get email(): EmailSender {
    this._email ??= new SendgridEmailSender(process.env.SENDGRID_API_KEY ?? '', 'billing@example.com');
    return this._email;
  }
}
