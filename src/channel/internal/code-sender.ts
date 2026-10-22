// The code sender. The portal decides the code and checks it. This module only delivers it.
//
// A laptop with nothing configured writes the code to the log, never the number. A revision
// (K_SERVICE) with nothing configured refuses. A real sender is off until its configuration is
// complete, and a half-set one refuses to boot rather than quietly disappearing. Tests inject
// the fetch; nothing here calls Meta or InforU on its own.
import { KernelError } from '../../kernel/errors.ts';

export type CodeChannel = 'whatsapp' | 'sms';

export interface CodeDelivery {
  to: string;
  code: string;
  channel: CodeChannel;
}

export interface NoticeDelivery {
  to: string;
  channel: CodeChannel;
}

export interface CodeSender {
  readonly channels: readonly CodeChannel[];
  send(delivery: CodeDelivery): Promise<void>;
  notify(delivery: NoticeDelivery): Promise<void>;
}

type CodeFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'json' | 'text'>>;

const GRAPH_VERSION = 'v25.0';
const INFORU_URL = 'https://cloud.inforu.co.il/api/v2/Otp/Message/Send';
const ISRAELI_MOBILE = /^\+9725\d{8}$/;
const SENDER_NAME = /^[A-Za-z0-9]{1,11}$/;
const SMS_TEXT = "קוד הכניסה לדונה דום: {OtpCode}. בתוקף 5 דק'.";
const NOTICE_TEXT = 'כניסה חדשה לפורטל דונה דום. לא אתם? פנו למשרד.';
const SMS_NOTICE_URL = 'https://cloud.inforu.co.il/api/v2/SMS/SendSms';

const NOT_SENT = new KernelError('unavailable', 'code was not sent');

export function createRecordingCodeSender(
  channels: readonly CodeChannel[] = ['whatsapp'],
): CodeSender & { sent: CodeDelivery[]; notices: NoticeDelivery[] } {
  const sent: CodeDelivery[] = [];
  const notices: NoticeDelivery[] = [];
  return {
    channels,
    sent,
    notices,
    async send(delivery) {
      sent.push({
        to: delivery.to,
        code: delivery.code,
        channel: delivery.channel,
      });
    },
    async notify(delivery) {
      notices.push({ to: delivery.to, channel: delivery.channel });
    },
  };
}

export function createLogCodeSender(write: (line: string) => void): CodeSender {
  return {
    channels: ['whatsapp'],
    async send(delivery) {
      write(`portal sign-in code ${delivery.code}`);
    },
    async notify() {
      write('portal new-device notice');
    },
  };
}

export function createUnavailableCodeSender(): CodeSender {
  return {
    channels: [],
    async send() {
      throw new KernelError('unavailable', 'code sender is not configured');
    },
    async notify() {
      throw new KernelError('unavailable', 'code sender is not configured');
    },
  };
}

export interface WhatsappCodeConfig {
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  noticeTemplateName?: string | null;
}

export function createWhatsappCodeSender(
  config: WhatsappCodeConfig,
  fetchImpl: CodeFetch,
): CodeSender {
  return {
    channels: ['whatsapp'],
    async send(delivery) {
      if (delivery.channel !== 'whatsapp') throw NOT_SENT;
      if (!ISRAELI_MOBILE.test(delivery.to)) {
        throw new KernelError('invalid', 'whatsapp recipient is not a mobile');
      }
      let response: Pick<Response, 'ok' | 'json' | 'text'>;
      try {
        response = await fetchImpl(
          `https://graph.facebook.com/${GRAPH_VERSION}/${config.phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: delivery.to.slice(1),
              type: 'template',
              template: {
                name: config.templateName,
                language: { code: 'he' },
                components: [
                  {
                    type: 'body',
                    parameters: [{ type: 'text', text: delivery.code }],
                  },
                  {
                    type: 'button',
                    sub_type: 'url',
                    index: '0',
                    parameters: [{ type: 'text', text: delivery.code }],
                  },
                ],
              },
            }),
          },
        );
      } catch {
        throw NOT_SENT;
      }
      if (!response.ok) throw NOT_SENT;
      const payload = (await response.json()) as {
        messages?: { id?: string }[];
      };
      const id = payload.messages?.[0]?.id ?? '';
      if (id === '') throw NOT_SENT;
    },
    async notify(delivery) {
      const name = config.noticeTemplateName ?? '';
      if (name === '') throw NOT_SENT;
      if (delivery.channel !== 'whatsapp') throw NOT_SENT;
      if (!ISRAELI_MOBILE.test(delivery.to)) {
        throw new KernelError('invalid', 'whatsapp recipient is not a mobile');
      }
      let response: Pick<Response, 'ok' | 'json' | 'text'>;
      try {
        response = await fetchImpl(
          `https://graph.facebook.com/${GRAPH_VERSION}/${config.phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: delivery.to.slice(1),
              type: 'template',
              template: { name, language: { code: 'he' } },
            }),
          },
        );
      } catch {
        throw NOT_SENT;
      }
      if (!response.ok) throw NOT_SENT;
      const payload = (await response.json()) as {
        messages?: { id?: string }[];
      };
      const id = payload.messages?.[0]?.id ?? '';
      if (id === '') throw NOT_SENT;
    },
  };
}

export interface SmsCodeConfig {
  username: string;
  token: string;
  senderName: string;
}

export function createSmsCodeSender(
  config: SmsCodeConfig,
  fetchImpl: CodeFetch,
): CodeSender {
  if (!SENDER_NAME.test(config.senderName)) {
    throw new Error('the SMS sender name must be at most 11 Latin characters');
  }
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.token}`).toString('base64')}`;
  return {
    channels: ['sms'],
    async send(delivery) {
      if (delivery.channel !== 'sms') throw NOT_SENT;
      if (!ISRAELI_MOBILE.test(delivery.to)) {
        throw new KernelError(
          'invalid',
          'sms recipient is not an Israeli mobile',
        );
      }
      let response: Pick<Response, 'ok' | 'json' | 'text'>;
      try {
        response = await fetchImpl(INFORU_URL, {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            Data: {
              Channel: 'SMS',
              OtpCode: delivery.code,
              Phone: `0${delivery.to.slice(4)}`,
              SMSSettings: {
                Sender: config.senderName,
                Message: SMS_TEXT,
              },
            },
          }),
        });
      } catch {
        throw NOT_SENT;
      }
      if (!response.ok) throw NOT_SENT;
      const payload = (await response.json()) as { StatusId?: number };
      if (payload.StatusId !== 1) throw NOT_SENT;
    },
    async notify(delivery) {
      if (delivery.channel !== 'sms') throw NOT_SENT;
      if (!ISRAELI_MOBILE.test(delivery.to)) {
        throw new KernelError(
          'invalid',
          'sms recipient is not an Israeli mobile',
        );
      }
      let response: Pick<Response, 'ok' | 'json' | 'text'>;
      try {
        response = await fetchImpl(SMS_NOTICE_URL, {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            Data: {
              Message: NOTICE_TEXT,
              Recipients: [{ Phone: `0${delivery.to.slice(4)}` }],
              Settings: { Sender: config.senderName },
            },
          }),
        });
      } catch {
        throw NOT_SENT;
      }
      if (!response.ok) throw NOT_SENT;
      const payload = (await response.json()) as { StatusId?: number };
      if (payload.StatusId !== 1) throw NOT_SENT;
    },
  };
}

function deployed(env: NodeJS.ProcessEnv): boolean {
  return (env.K_SERVICE ?? '') !== '';
}

function set(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim() ?? '';
  return value === '' ? null : value;
}

function whatsappFrom(env: NodeJS.ProcessEnv): WhatsappCodeConfig | null {
  const templateName = set(env, 'PORTAL_WHATSAPP_TEMPLATE');
  const accessToken = set(env, 'WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = set(env, 'WHATSAPP_PHONE_NUMBER_ID');
  if (templateName === null) return null;
  if (accessToken === null || phoneNumberId === null) {
    throw new Error('the WhatsApp code sender is only partly configured');
  }
  return {
    templateName,
    accessToken,
    phoneNumberId,
    noticeTemplateName: set(env, 'PORTAL_WHATSAPP_NOTICE_TEMPLATE'),
  };
}

function smsFrom(env: NodeJS.ProcessEnv): SmsCodeConfig | null {
  const username = set(env, 'INFORU_USERNAME');
  const token = set(env, 'INFORU_TOKEN');
  const senderName = set(env, 'SMS_SENDER');
  if (username === null && token === null && senderName === null) return null;
  if (username === null || token === null || senderName === null) {
    throw new Error('the SMS code sender is only partly configured');
  }
  return { username, token, senderName };
}

function route(parts: Partial<Record<CodeChannel, CodeSender>>): CodeSender {
  const channels = (['whatsapp', 'sms'] as const).filter(
    (channel) => parts[channel] !== undefined,
  );
  return {
    channels,
    async send(delivery) {
      const part = parts[delivery.channel];
      if (part === undefined) throw NOT_SENT;
      await part.send(delivery);
    },
    async notify(delivery) {
      const part = parts[delivery.channel];
      if (part === undefined) throw NOT_SENT;
      await part.notify(delivery);
    },
  };
}

/**
 * The sender this process is allowed to construct.
 *
 * A configured WhatsApp template, a configured SMS gateway, or both. Both means WhatsApp is
 * first. A laptop with neither writes the code to the log. A revision with neither refuses.
 * The log cannot be turned on where a revision is deployed.
 */
export function codeSenderFromEnv(
  env: NodeJS.ProcessEnv,
  write: (line: string) => void,
  fetchImpl: CodeFetch = fetch,
): CodeSender {
  if (env.PORTAL_CODE_LOG === '1' && deployed(env)) {
    throw new Error(
      'the portal code log sender cannot be configured on staging or production',
    );
  }
  const whatsapp = whatsappFrom(env);
  const sms = smsFrom(env);
  if (whatsapp !== null || sms !== null) {
    return route({
      ...(whatsapp === null
        ? {}
        : { whatsapp: createWhatsappCodeSender(whatsapp, fetchImpl) }),
      ...(sms === null ? {} : { sms: createSmsCodeSender(sms, fetchImpl) }),
    });
  }
  if (deployed(env)) return createUnavailableCodeSender();
  return createLogCodeSender(write);
}
