import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './auth.ts';
import { identifyAuthErasure, beginAuthErasure, authErasureStatus, finishAuthErasure, cancelAuthErasure } from './account-erasure.ts';
export { default } from './index.ts';

// A named service binding is the authority. This class has no fetch handler and
// is absent from Heavy's entrypoint. Public URLs cannot invoke lifecycle RPC.
export class MyProAccountLifecycle extends WorkerEntrypoint<Env> {
  identify(authorization: string) { return identifyAuthErasure(this.env, authorization); }
  begin(authorization: string, requestId: string) { return beginAuthErasure(this.env, authorization, requestId); }
  status(requestId: string) { return authErasureStatus(this.env, requestId); }
  cancel(requestId: string) { return cancelAuthErasure(this.env, requestId); }
  finish(requestId: string) { return finishAuthErasure(this.env, requestId); }
}
