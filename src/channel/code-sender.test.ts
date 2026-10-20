import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  codeSenderFromEnv,
  createSmsCodeSender,
  createWhatsappCodeSender,
} from './contract.ts';

const GRAPH_BODY = 'graph refused: trace-do-not-show';
const INFORU_BODY = 'inforu refused: quota-do-not-show';

function jsonResponse(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  } as Response;
}

describe('the portal code sender', () => {
  it('writes the code and not the number on a laptop', async () => {
    const lines: string[] = [];
    const sender = codeSenderFromEnv({}, (line) => {
      lines.push(line);
    });
    await sender.send({
      to: '+972520000191',
      code: '123456',
      channel: 'whatsapp',
    });
    assert.deepEqual(lines, ['portal sign-in code 123456']);
  });

  it('refuses to boot the log sender on staging or production', () => {
    assert.throws(
      () =>
        codeSenderFromEnv(
          {
            K_SERVICE: 'dona-staging',
            DOCS_BUCKET: 'dona-v5-staging-docs',
            PORTAL_CODE_LOG: '1',
          },
          () => {},
        ),
      /cannot be configured on staging or production/,
    );
    assert.throws(
      () =>
        codeSenderFromEnv(
          { K_SERVICE: 'dona-prod', PORTAL_CODE_LOG: '1' },
          () => {},
        ),
      /cannot be configured on staging or production/,
    );
  });

  it('does not deliver when a revision is deployed and the log was not asked for', async () => {
    const sender = codeSenderFromEnv({ K_SERVICE: 'dona-staging' }, () => {
      throw new Error('logged');
    });
    await assert.rejects(
      () =>
        sender.send({
          to: '+972520000191',
          code: '123456',
          channel: 'whatsapp',
        }),
      /not configured/,
    );
  });

  it('uses a configured sender on staging and never the log', async () => {
    const calls: string[] = [];
    const sender = codeSenderFromEnv(
      {
        K_SERVICE: 'dona-staging',
        WHATSAPP_ACCESS_TOKEN: 'token',
        WHATSAPP_PHONE_NUMBER_ID: '1099',
        PORTAL_WHATSAPP_TEMPLATE: 'portal_sign_in',
      },
      () => {
        throw new Error('logged');
      },
      async (url) => {
        calls.push(url);
        return jsonResponse(200, { messages: [{ id: 'wamid.1' }] });
      },
    );
    assert.deepEqual(sender.channels, ['whatsapp']);
    await sender.send({
      to: '+972520000191',
      code: '123456',
      channel: 'whatsapp',
    });
    assert.equal(calls.length, 1);
  });

  it('offers WhatsApp first when both senders are configured, and does not log', () => {
    const sender = codeSenderFromEnv(
      {
        WHATSAPP_ACCESS_TOKEN: 'token',
        WHATSAPP_PHONE_NUMBER_ID: '1099',
        PORTAL_WHATSAPP_TEMPLATE: 'portal_sign_in',
        INFORU_USERNAME: 'dona',
        INFORU_TOKEN: 'api-token',
        SMS_SENDER: 'DonaDom',
      },
      () => {
        throw new Error('logged');
      },
    );
    assert.deepEqual(sender.channels, ['whatsapp', 'sms']);
  });

  it('refuses to boot a half-configured sender or a sender name that is not short Latin', () => {
    assert.throws(
      () =>
        codeSenderFromEnv(
          { PORTAL_WHATSAPP_TEMPLATE: 'portal_sign_in' },
          () => {},
        ),
      /partly configured/,
    );
    assert.throws(
      () =>
        codeSenderFromEnv(
          { INFORU_USERNAME: 'dona', SMS_SENDER: 'DonaDom' },
          () => {},
        ),
      /partly configured/,
    );
    assert.throws(
      () =>
        createSmsCodeSender(
          { username: 'dona', token: 'secret', senderName: 'דונה דום' },
          async () => jsonResponse(200, {}),
        ),
      /11 Latin/,
    );
    assert.throws(
      () =>
        createSmsCodeSender(
          { username: 'dona', token: 'secret', senderName: 'DonaDomExtra' },
          async () => jsonResponse(200, {}),
        ),
      /11 Latin/,
    );
  });
});

describe('the WhatsApp authentication template', () => {
  it('sends the code as the template body and the copy button', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const sender = createWhatsappCodeSender(
      {
        phoneNumberId: '1099',
        accessToken: 'token-not-logged',
        templateName: 'portal_sign_in',
      },
      async (url, init) => {
        calls.push({ url, init });
        return jsonResponse(200, { messages: [{ id: 'wamid.1' }] });
      },
    );
    await sender.send({
      to: '+972520000191',
      code: '482913',
      channel: 'whatsapp',
    });
    const captured = calls[0];
    assert.ok(captured);
    assert.equal(
      captured.url,
      'https://graph.facebook.com/v25.0/1099/messages',
    );
    const headers = captured.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer token-not-logged');
    const body = JSON.parse(String(captured.init?.body));
    assert.equal(body.to, '972520000191');
    assert.equal(body.type, 'template');
    assert.equal(body.template.name, 'portal_sign_in');
    assert.equal(body.template.language.code, 'he');
    assert.equal(body.template.components[0].parameters[0].text, '482913');
    assert.equal(body.template.components[1].parameters[0].text, '482913');
  });

  it('refuses a provider error without the provider response', async () => {
    const sender = createWhatsappCodeSender(
      {
        phoneNumberId: '1099',
        accessToken: 'token',
        templateName: 'portal_sign_in',
      },
      async () => jsonResponse(400, GRAPH_BODY, false),
    );
    await assert.rejects(
      () =>
        sender.send({
          to: '+972520000191',
          code: '482913',
          channel: 'whatsapp',
        }),
      (error: Error) => {
        assert.equal(error.message.includes(GRAPH_BODY), false);
        assert.match(error.message, /not sent/);
        return true;
      },
    );
  });
});

describe('the SMS gateway', () => {
  it('sends our code to an Israeli mobile under the configured name', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const sender = createSmsCodeSender(
      { username: 'dona', token: 'api-token', senderName: 'DonaDom' },
      async (url, init) => {
        calls.push({ url, init });
        return jsonResponse(200, {
          StatusId: 1,
          StatusDescription: 'Success',
          DetailedDescription: '',
        });
      },
    );
    await sender.send({
      to: '+972520000191',
      code: '482913',
      channel: 'sms',
    });
    const captured = calls[0];
    assert.ok(captured);
    assert.equal(
      captured.url,
      'https://cloud.inforu.co.il/api/v2/Otp/Message/Send',
    );
    const headers = captured.init?.headers as Record<string, string>;
    assert.equal(
      headers.Authorization,
      `Basic ${Buffer.from('dona:api-token').toString('base64')}`,
    );
    const body = JSON.parse(String(captured.init?.body));
    assert.equal(body.Data.Channel, 'SMS');
    assert.equal(body.Data.OtpCode, '482913');
    assert.equal(body.Data.Phone, '0520000191');
    assert.equal(body.Data.SMSSettings.Sender, 'DonaDom');
    const message = body.Data.SMSSettings.Message as string;
    assert.equal(message, "קוד הכניסה לדונה דום: {OtpCode}. בתוקף 5 דק'.");
    assert.ok(message.replace('{OtpCode}', '482913').length <= 70);
    assert.equal(JSON.stringify(body).includes('api-token'), false);
  });

  it('does not call the gateway for a number that is not an Israeli mobile', async () => {
    let called = false;
    const sender = createSmsCodeSender(
      { username: 'dona', token: 'api-token', senderName: 'DonaDom' },
      async () => {
        called = true;
        return jsonResponse(200, { StatusId: 1 });
      },
    );
    await assert.rejects(() =>
      sender.send({ to: '+14155552671', code: '482913', channel: 'sms' }),
    );
    assert.equal(called, false);
  });

  it('refuses a provider error without the provider response', async () => {
    const sender = createSmsCodeSender(
      { username: 'dona', token: 'api-token', senderName: 'DonaDom' },
      async () =>
        jsonResponse(200, {
          StatusId: -13,
          StatusDescription: 'Failed',
          DetailedDescription: INFORU_BODY,
        }),
    );
    await assert.rejects(
      () =>
        sender.send({
          to: '+972520000191',
          code: '482913',
          channel: 'sms',
        }),
      (error: Error) => {
        assert.equal(error.message.includes(INFORU_BODY), false);
        assert.equal(error.message.includes('StatusId'), false);
        assert.match(error.message, /not sent/);
        return true;
      },
    );
  });
});
