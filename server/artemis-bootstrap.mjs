import express from 'express';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getCustomerAttributes(customer) {
  const attributes = {};

  if (typeof customer.plan === 'string') {
    attributes.plan = customer.plan;
  }
  if (typeof customer.region === 'string') {
    attributes.region = customer.region;
  }

  return attributes;
}

export function createArtemisBootstrapRouter({ requireCustomerSession }) {
  if (typeof requireCustomerSession !== 'function') {
    throw new TypeError('requireCustomerSession middleware is required');
  }

  const runtimeUrl = new URL(requiredEnv('ARTEMIS_RUNTIME_BASE_URL'));
  if (runtimeUrl.protocol !== 'https:') {
    throw new Error('ARTEMIS_RUNTIME_BASE_URL must use HTTPS');
  }
  const runtimeBaseUrl = runtimeUrl.toString().replace(/\/+$/, '');
  const tenantId = requiredEnv('ARTEMIS_TENANT_ID');
  const projectId = requiredEnv('ARTEMIS_PROJECT_ID');
  const channelId = requiredEnv('ARTEMIS_SDK_CHANNEL_ID');
  const channelSecret = requiredEnv('ARTEMIS_SDK_CHANNEL_SECRET');
  const router = express.Router();

  router.post('/api/artemis/bootstrap', requireCustomerSession, async (req, res, next) => {
    const startTime = Date.now();
    const customer = req.customer;
    if (!customer || typeof customer.id !== 'string' || !customer.id) {
      console.warn('[Artemis Bootstrap] Rejected request without an authenticated customer');
      res.status(401).json({ error: 'Customer authentication required' });
      return;
    }

    console.info('[Artemis Bootstrap] Request accepted; requesting a Runtime token');

    try {
      const runtimeResponse = await fetch(`${runtimeBaseUrl}/api/v1/sdk/customer-sessions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sdk-channel-secret': channelSecret,
        },
        body: JSON.stringify({
          tenantId,
          projectId,
          channelId,
          verifiedUserId: customer.id,
          customAttributes: getCustomerAttributes(customer),
        }),
        signal: AbortSignal.timeout(15000),
      });

      let body;
      try {
        body = await runtimeResponse.json();
      } catch {
        console.error('[Artemis Bootstrap] Runtime returned invalid JSON', {
          status: runtimeResponse.status,
          durationMs: Date.now() - startTime,
        });
        res.status(502).json({ error: 'Unable to start chat' });
        return;
      }

      if (
        !runtimeResponse.ok ||
        !body ||
        typeof body !== 'object' ||
        typeof body.bootstrapToken !== 'string' ||
        !body.bootstrapToken
      ) {
        console.error('[Artemis Bootstrap] Runtime failed to mint a bootstrap token', {
          status: runtimeResponse.status,
          durationMs: Date.now() - startTime,
        });
        res.status(502).json({ error: 'Unable to start chat' });
        return;
      }

      res.set('Cache-Control', 'no-store, private');
      res.json({
        bootstrapToken: body.bootstrapToken,
        ...(Number.isInteger(body.expiresIn) ? { expiresIn: body.expiresIn } : {}),
      });
      console.info('[Artemis Bootstrap] Bootstrap completed successfully', {
        durationMs: Date.now() - startTime,
        expiresIn: Number.isInteger(body.expiresIn) ? body.expiresIn : undefined,
      });
    } catch (error) {
      console.error('[Artemis Bootstrap] Runtime request failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        durationMs: Date.now() - startTime,
      });
      next(error);
    }
  });

  return router;
}
