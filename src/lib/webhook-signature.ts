import crypto from 'crypto';

/**
 * Creates an HMAC SHA-256 signature header matching GitHub's `x-hub-signature-256` convention.
 *
 * @param rawBody - Raw JSON payload string
 * @param secret - Secret key shared between GitHub and application
 * @returns Formatted signature string e.g. "sha256=abcdef123..."
 */
export function createWebhookSignature(rawBody: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${hmac}`;
}

/**
 * Verifies that the incoming webhook payload is authentic and was signed with WEBHOOK_SECRET.
 * Uses `crypto.timingSafeEqual` to prevent timing analysis attacks.
 *
 * @param rawBody - Raw body string of the incoming HTTP request
 * @param signatureHeader - Value of the `x-hub-signature-256` HTTP header
 * @param secret - The shared webhook secret
 * @returns boolean indicating if the signature is valid
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=') || !secret) {
    return false;
  }

  const expectedSignature = createWebhookSignature(rawBody, secret);

  const headerBuffer = Buffer.from(signatureHeader, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (headerBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(headerBuffer, expectedBuffer);
}

