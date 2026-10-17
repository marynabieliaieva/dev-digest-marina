export interface SecretsProvider {
  get(name: string): Promise<string | null>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
