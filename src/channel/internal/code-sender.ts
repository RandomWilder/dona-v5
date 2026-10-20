// The code sender. The portal decides the code and checks it. This module only delivers it.
// #273 has no provider: a recording sender for tests, a log sender for a laptop, and a sender
// that refuses everywhere a revision is actually deployed.
//
// The log line is the code and not the number. A number in a log is the PII rule, and the person
// clicking :3000 already knows which number they typed.
import { KernelError } from '../../kernel/errors.ts';

export interface CodeDelivery {
  to: string;
  code: string;
}

export interface CodeSender {
  readonly kind: 'log' | 'unavailable' | 'recording';
  send(delivery: CodeDelivery): Promise<void>;
}

export function createRecordingCodeSender(): CodeSender & {
  sent: CodeDelivery[];
} {
  const sent: CodeDelivery[] = [];
  return {
    kind: 'recording',
    sent,
    async send(delivery) {
      sent.push({ to: delivery.to, code: delivery.code });
    },
  };
}

export function createLogCodeSender(write: (line: string) => void): CodeSender {
  return {
    kind: 'log',
    async send(delivery) {
      write(`portal sign-in code ${delivery.code}`);
    },
  };
}

export function createUnavailableCodeSender(): CodeSender {
  return {
    kind: 'unavailable',
    async send() {
      throw new KernelError('unavailable', 'code sender is not configured');
    },
  };
}

function deployed(env: NodeJS.ProcessEnv): boolean {
  return (env.K_SERVICE ?? '') !== '';
}

/**
 * The sender this process is allowed to construct.
 *
 * A laptop has no provider, so the code goes to the log and the flow can be clicked. A revision
 * on Cloud Run (`K_SERVICE`) gets the sender that refuses. Asking for the log there — staging or
 * production, the variable does not get to choose — refuses to boot rather than writing codes
 * into a deployed log.
 */
export function codeSenderFromEnv(
  env: NodeJS.ProcessEnv,
  write: (line: string) => void,
): CodeSender {
  if (env.PORTAL_CODE_LOG === '1' && deployed(env)) {
    throw new Error(
      'the portal code log sender cannot be configured on staging or production',
    );
  }
  if (deployed(env)) return createUnavailableCodeSender();
  return createLogCodeSender(write);
}
