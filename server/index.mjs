import cors from 'cors';
import express from 'express';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { createArtemisBootstrapRouter } from './artemis-bootstrap.mjs';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const entraTenantId = requiredEnv('ENTRA_TENANT_ID');
const audiences = requiredEnv('ENTRA_API_AUDIENCES')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const requiredScope = process.env.ENTRA_REQUIRED_SCOPE || 'access_as_user';
const allowedOrigins = requiredEnv('SPFX_ALLOWED_ORIGINS')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const jwks = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${entraTenantId}/discovery/v2.0/keys`),
);

const app = express();
app.disable('x-powered-by');
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, false);
      if (!allowedOrigins.includes(origin)) {
        return callback(new Error('Origin not allowed'));
      }
      return callback(null, origin);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    maxAge: 600,
  }),
);

app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
});

async function requireCustomerSession(req, res, next) {
  const authorization = req.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);

  if (!tokenMatch) {
    res.status(401).json({ error: 'Bearer token required' });
    return;
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(tokenMatch[1], jwks, {
      issuer: [
        `https://login.microsoftonline.com/${entraTenantId}/v2.0`,
        `https://sts.windows.net/${entraTenantId}/`,
      ],
      audience: audiences,
      algorithms: ['RS256'],
    }));
  } catch (error) {
    let claims;
    try {
      const unverified = decodeJwt(tokenMatch[1]);
      claims = {
        aud: unverified.aud,
        iss: unverified.iss,
        ver: unverified.ver,
        tid: unverified.tid,
        scp: unverified.scp,
      };
    } catch {
      claims = 'unreadable';
    }
    console.warn('[Entra Auth] Token validation failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: error?.code,
      reason: error?.claim ? `${error.claim}: ${error.reason}` : undefined,
      claims,
    });
    res.status(401).json({ error: 'Invalid access token' });
    return;
  }

  const scopes = typeof payload.scp === 'string' ? payload.scp.split(' ') : [];
  if (
    String(payload.tid).toLowerCase() !== entraTenantId.toLowerCase() ||
    typeof payload.oid !== 'string' ||
    !scopes.includes(requiredScope)
  ) {
    res.status(403).json({ error: 'Required API scope or user identity missing' });
    return;
  }

  req.customer = { id: payload.oid };
  next();
}

app.use(createArtemisBootstrapRouter({ requireCustomerSession }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.message === 'Origin not allowed') {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  console.error('[Backend] Request failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => {
  console.info(`[Backend] Listening on port ${port}`);
});