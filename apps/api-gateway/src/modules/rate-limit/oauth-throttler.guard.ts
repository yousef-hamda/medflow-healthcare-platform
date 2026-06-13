/**
 * ThrottlerGuard variant that keys rate-limit buckets by the OAuth client
 * (the `client_id` claim or token subject) instead of by IP, so a single
 * noisy client cannot exhaust the quota for a shared egress IP.
 *
 * Falls back to the request IP for unauthenticated routes (e.g. token endpoint).
 */

import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { TokenPayload } from '../auth/token-signer';

interface MaybeAuthedRequest extends Request {
  user?: TokenPayload;
}

@Injectable()
export class OAuthThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: MaybeAuthedRequest): Promise<string> {
    const clientId = req.user?.client_id ?? req.user?.sub;
    if (clientId) {
      return Promise.resolve(`client:${clientId}`);
    }
    const ip = req.ips?.length ? req.ips[0] : req.ip;
    return Promise.resolve(`ip:${ip ?? 'unknown'}`);
  }
}
