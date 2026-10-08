import { createHash, randomUUID } from 'node:crypto';
import { PublicError } from './config.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Only the existing owner-scoped Coin endpoint can perform managed inference.
 * Lost acknowledgements poll the original receipt, never another paid request. */
export function creditProxy(config, authenticate, fetchFn = fetch, wait = pause) {
  return async (job, raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.messages) || !raw.messages.length)
      throw new PublicError('Invalid model request.');
    const request = { model: 'filey-ai', messages: raw.messages,
      ...(raw.tools ? { tools: raw.tools } : {}), max_tokens: 2048, stream: false,
      reasoning_enabled: job.reasoning };
    const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    if (job.completions.has(fingerprint)) return job.completions.get(fingerprint);
    if (job.completions.size >= 12) throw new PublicError('The task reached its request limit.', 429);
    const work = (async () => {
      await authenticate(job.identity.token, job.identity.org);
      const token = job.identity.token, org = job.identity.org;
      const requestId = randomUUID();
      const body = { action: 'completion', funding: 'credits', recoverable: true,
        org_id: org, run_id: job.id, request_id: requestId, request };
      let action = 'completion';
      for (let attempt = 0; attempt < 100; attempt++) {
        if (job.controller.signal.aborted && action === 'completion') throw new PublicError('Task stopped.', 409);
        let response, data;
        try {
          response = await fetchFn(`${config.base}/functions/v1/ai-credits`, {
            method: 'POST', headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(action === 'completion' ? body : { action, request_id: requestId, org_id: org }),
            redirect: 'error', signal: AbortSignal.timeout(15_000),
          });
          if (response.ok) data = await response.json();
          else {
            await response.body?.cancel();
            if (response.status < 500) throw new PublicError(response.status === 402 ? 'Insufficient credit. Add Coin to continue.' : 'Filey AI could not complete this request.', response.status);
          }
        } catch (error) { if (error instanceof PublicError) throw error; }
        if (data?.state === 'complete' && data.completion?.choices) return data.completion;
        if (data?.state === 'failed' || data?.state === 'missing')
          throw new PublicError('This model request could not be recovered. It was not repeated.', 503);
        // Even a malformed or lost 2xx acknowledgement is ambiguous. Status only.
        action = 'completion_status';
        await wait([500, 1000, 1500, 3000][Math.min(attempt, 3)]);
      }
      throw new PublicError('Filey AI is still reconnecting. This request was not repeated.', 503);
    })();
    job.completions.set(fingerprint, work);
    return work;
  };
}
