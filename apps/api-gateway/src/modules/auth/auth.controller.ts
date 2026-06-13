import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { AuthService } from './auth.service';

interface AuthorizeQuery {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: string;
  login_hint?: string;
  launch?: string;
  patient?: string;
}

interface TokenBody {
  grant_type: string;
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  username?: string;
  password?: string;
  scope?: string;
}

@ApiTags('OAuth2 / OIDC')
@Controller()
export class AuthController {
  // Temporary in-memory login session store — for the demo login page
  private readonly loginSessions = new Map<
    string,
    {
      query: AuthorizeQuery;
      expiresAt: number;
    }
  >();

  constructor(private readonly authService: AuthService) {}

  // ── OIDC Discovery ────────────────────────────────────────────────────────

  @Get('.well-known/openid-configuration')
  @ApiOperation({ summary: 'OIDC Discovery document' })
  getOidcConfig(): Record<string, unknown> {
    return this.authService.getDiscoveryDocument();
  }

  @Get('.well-known/jwks.json')
  @ApiOperation({ summary: 'JSON Web Key Set' })
  getJwks(): { keys: unknown[] } {
    return this.authService.getJwks();
  }

  // ── Login page ────────────────────────────────────────────────────────────

  @Get('oauth/login')
  @ApiExcludeEndpoint()
  loginPage(
    @Query('session_id') sessionId: string,
    @Res() res: Response,
  ): void {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MedFlow — Sign In</title>
  <style>
    body { font-family: system-ui, sans-serif; display:flex; align-items:center;
           justify-content:center; min-height:100vh; margin:0; background:#f0f4f8; }
    .card { background:#fff; padding:2rem; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.1);
            width:100%; max-width:380px; }
    h1 { margin:0 0 1.5rem; font-size:1.5rem; color:#1a202c; }
    label { display:block; font-size:0.875rem; font-weight:500; color:#4a5568; margin-bottom:0.25rem; }
    input { width:100%; box-sizing:border-box; padding:0.5rem 0.75rem; border:1px solid #e2e8f0;
            border-radius:4px; font-size:1rem; margin-bottom:1rem; }
    button { width:100%; padding:0.625rem; background:#3b82f6; color:#fff; border:none;
             border-radius:4px; font-size:1rem; cursor:pointer; }
    button:hover { background:#2563eb; }
    .hint { font-size:0.75rem; color:#718096; margin-top:0.5rem; text-align:center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>MedFlow Sign In</h1>
    <form method="POST" action="/oauth/login">
      <input type="hidden" name="session_id" value="${sessionId ?? ''}">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" autocomplete="username" required>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign In</button>
    </form>
    <p class="hint">Demo credentials — any username/password accepted in development.</p>
  </div>
</body>
</html>`);
  }

  @Post('oauth/login')
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.FOUND)
  async loginSubmit(
    @Body() body: { session_id: string; username: string; password: string },
    @Res() res: Response,
  ): Promise<void> {
    const session = this.loginSessions.get(body.session_id);
    if (!session || session.expiresAt < Date.now()) {
      res.status(400).send('Login session expired or invalid');
      return;
    }
    this.loginSessions.delete(body.session_id);

    const query = session.query;

    // For demo: create a synthetic user record on-the-fly if it doesn't exist
    // In production this would authenticate against the users table
    const code = randomBytes(16).toString('hex');
    const patientId =
      query.patient ?? (query.scope.includes('launch/patient') ? 'demo-patient-1' : undefined);

    this.authService.storeCode(code, {
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      scope: query.scope,
      userId: `demo-user-${body.username}`,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      expiresAt: this.authService.codeExpiresAt(),
      patientId,
    });

    const redirect = new URL(query.redirect_uri);
    redirect.searchParams.set('code', code);
    if (query.state) redirect.searchParams.set('state', query.state);
    res.redirect(redirect.toString());
  }

  // ── Authorization endpoint ────────────────────────────────────────────────

  @Get('oauth/authorize')
  @ApiOperation({ summary: 'OAuth2 Authorization Code + PKCE' })
  authorize(
    @Query() query: AuthorizeQuery,
    @Req() _req: Request,
    @Res() res: Response,
  ): void {
    if (query.response_type !== 'code') {
      res.status(400).json({ error: 'unsupported_response_type' });
      return;
    }
    if (!query.code_challenge || query.code_challenge_method !== 'S256') {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'PKCE S256 code_challenge required',
      });
      return;
    }

    // Store query in a temporary session and redirect to login page
    const sessionId = randomUUID();
    this.loginSessions.set(sessionId, {
      query,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
    });

    // Clean stale sessions
    const now = Date.now();
    for (const [k, v] of this.loginSessions.entries()) {
      if (v.expiresAt < now) this.loginSessions.delete(k);
    }

    res.redirect(`/oauth/login?session_id=${sessionId}`);
  }

  // ── Token endpoint ────────────────────────────────────────────────────────

  @Post('oauth/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'OAuth2 Token endpoint' })
  async token(
    @Body() body: TokenBody,
  ): Promise<Record<string, unknown>> {
    switch (body.grant_type) {
      case 'authorization_code': {
        if (!body.code || !body.code_verifier || !body.redirect_uri || !body.client_id) {
          return { error: 'invalid_request' };
        }
        return this.authService.handleAuthorizationCode({
          code: body.code,
          codeVerifier: body.code_verifier,
          redirectUri: body.redirect_uri,
          clientId: body.client_id,
        });
      }

      case 'refresh_token': {
        if (!body.refresh_token) return { error: 'invalid_request' };
        return this.authService.handleRefreshToken({
          refreshToken: body.refresh_token,
        });
      }

      case 'password': {
        if (!body.username || !body.password) return { error: 'invalid_request' };
        return this.authService.handlePassword({
          username: body.username,
          password: body.password,
          scope: body.scope ?? 'openid',
        });
      }

      case 'client_credentials': {
        if (!body.client_id || !body.client_secret) {
          return { error: 'invalid_request' };
        }
        return this.authService.handleClientCredentials({
          clientId: body.client_id,
          clientSecret: body.client_secret,
          scope: body.scope ?? '',
        });
      }

      default:
        return { error: 'unsupported_grant_type' };
    }
  }
}
