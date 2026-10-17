import { Resend } from 'resend';

export const mailer = new Resend(process.env.RESEND_KEY ?? '');
