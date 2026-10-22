import { NextResponse, type NextRequest } from 'next/server';
import { verifyWebhookSignature } from '@/lib/webhook-signature';
import { GithubWebhookPayloadSchema } from '@/types/git.types';
import { handlePullRequestEvent } from '@/services/git-verification.service';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export const GITHUB_WEBHOOK_SECRET =
  process.env.GITHUB_WEBHOOK_SECRET ||
  process.env.WEBHOOK_SECRET ||
  'smart-workspace-webhook-secret-key';

/**
 * POST /api/webhooks/github
 *
 * Public webhook endpoint for GitHub events.
 * Whitelisted in middleware.ts (does not require JWT Bearer token).
 * Authenticated strictly via HMAC-SHA256 signature in `x-hub-signature-256`.
 */
export async function POST(request: NextRequest) {
  try {
    const signatureHeader = request.headers.get('x-hub-signature-256');
    const rawBody = await request.text();

    // 1. Verify HMAC SHA-256 Signature
    const isSignatureValid = verifyWebhookSignature(
      rawBody,
      signatureHeader,
      GITHUB_WEBHOOK_SECRET
    );

    if (!isSignatureValid) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Webhook HMAC SHA-256 signature verification failed',
          },
        },
        { status: 401 }
      );
    }

    // 2. Parse Raw Body
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_JSON',
            message: 'Malformed JSON payload in request body',
          },
        },
        { status: 400 }
      );
    }

    // 3. Check for GitHub ping event
    const githubEvent = request.headers.get('x-github-event');
    if (githubEvent === 'ping') {
      return NextResponse.json<ApiResponse>(
        {
          success: true,
          message: 'GitHub ping event received successfully',
        },
        { status: 200 }
      );
    }

    // 4. Validate PR Payload Schema
    const validationResult = GithubWebhookPayloadSchema.safeParse(parsedBody);
    if (!validationResult.success) {
      // Return 200 for non-PR events to prevent GitHub webhook retries
      return NextResponse.json<ApiResponse>(
        {
          success: true,
          message: 'Ignored non-PullRequest event',
        },
        { status: 200 }
      );
    }

    const payload = validationResult.data;

    // 5. Process PR Event and Execute AI Verification
    const diffSummary =
      (parsedBody as any)?.diff_summary ||
      payload.pull_request.body ||
      `PR #${payload.pull_request.number}: ${payload.pull_request.title}`;

    const result = await handlePullRequestEvent(payload, diffSummary);

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: result,
        message: 'Webhook processed successfully',
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('POST /api/webhooks/github Error:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Internal webhook processing error',
        },
      },
      { status: 500 }
    );
  }
}

