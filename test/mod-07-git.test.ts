/**
 * Objective Anti-Hallucination Test Suite for Module 7:
 * Git Webhook & AI PR Verification Engine (Thẩm định Mã nguồn Tự động bằng AI)
 *
 * Verifies all 5 Anti-Hallucination Criteria with Direct PostgreSQL Physical Checks:
 * - TEST-01: Rejection of invalid HMAC SHA-256 signature (HTTP 401 Unauthorized).
 * - TEST-02: Valid HMAC signature verification and task UUID extraction from branch name.
 * - TEST-03: Real PostgreSQL verification: record saved in git_pull_requests with non-empty AI feedback.
 * - TEST-04: Automatic FSM state transition: task advances from IN_PROGRESS to REVIEW with timestamp.
 * - TEST-05: Safe handling of PRs without Task ID: returns HTTP 200 with 0 ghost rows in database.
 *
 * Execution:
 * npm run test:module7
 */

import crypto from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = process.env.TEST_APP_URL || 'http://localhost:3000';
const WEBHOOK_SECRET =
  process.env.GITHUB_WEBHOOK_SECRET ||
  process.env.WEBHOOK_SECRET ||
  'smart-workspace-webhook-secret-key';

interface StepResult {
  code: string;
  name: string;
  passed: boolean;
  details: string;
}

const testResults: StepResult[] = [];

function recordTest(code: string, name: string, passed: boolean, details: string) {
  testResults.push({ code, name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} | ${code}: ${name}\n       ↳ ${details}`);
}

function signPayload(payloadStr: string, secret: string = WEBHOOK_SECRET): string {
  const hmac = crypto.createHmac('sha256', secret).update(payloadStr, 'utf8').digest('hex');
  return `sha256=${hmac}`;
}

async function runMod07TestSuite() {
  console.log(`\n============================================================`);
  console.log(`🚀 BẮT ĐẦU KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC - MODULE 07`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Database: PostgreSQL (localhost:5433 / workspace_db)`);
  console.log(`============================================================\n`);

  const uniqueSuffix = Date.now().toString().slice(-6);
  const leaderEmail = `leader_git_${uniqueSuffix}@workspace.local`;
  const password = 'Password123@Valid';

  let leaderToken = '';
  let leaderUserId = '';
  let testProjectId = '';
  let targetTask: any = null;

  try {
    // ------------------------------------------------------------
    // SETUP: Tạo tài khoản Leader, Dự án và Task IN_PROGRESS
    // ------------------------------------------------------------
    const leaderRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: leaderEmail,
        password,
        fullName: `Lead Git Reviewer ${uniqueSuffix}`,
        role: 'LEADER',
        department: 'BACKEND',
        level: 'SENIOR',
        skills: ['TypeScript', 'Git', 'CI/CD'],
      }),
    });
    const leaderData = await leaderRes.json();
    leaderToken = leaderData.data?.accessToken;
    leaderUserId = leaderData.data?.id;

    if (!leaderToken) {
      throw new Error('Không thể khởi tạo token Leader kiểm thử.');
    }

    const project = await prisma.project.create({
      data: {
        name: `Project Git Verification ${uniqueSuffix}`,
        description: 'Dự án kiểm thử tích hợp Git Webhook và AI PR Verification',
        techStack: ['TypeScript', 'Next.js', 'PostgreSQL', 'Docker'],
        complexity: 'HARD',
        ownerId: leaderUserId,
        targetEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    testProjectId = project.id;

    // Tạo Task ở trạng thái IN_PROGRESS để sẵn sàng đón nhận PR kích hoạt sang REVIEW
    targetTask = await prisma.task.create({
      data: {
        projectId: testProjectId,
        title: 'Develop Distributed Payment Settlement Gateway',
        description: 'Implement idempotent payment settlement controller with Redis locks and PostgreSQL transactions',
        targetDepartment: 'BACKEND',
        requiredLevel: 'SENIOR',
        estimatedHours: new Prisma.Decimal(12.0),
        status: 'IN_PROGRESS',
        assignedTo: leaderUserId,
        isCriticalPath: true,
        checklist: [
          { id: 'c1', text: 'Implement Idempotency Key check with Redis', done: false },
          { id: 'c2', text: 'Add transactional integrity for double-entry ledger', done: false },
          { id: 'c3', text: 'Ensure test coverage is >= 80%', done: false },
        ],
        startedAt: new Date(Date.now() - 6 * 3600 * 1000),
      },
    });

    // ------------------------------------------------------------
    // TEST-01: Chặn Webhook Sai Chữ Ký HMAC SHA-256 (HTTP 401)
    // ------------------------------------------------------------
    {
      const fakePayload = JSON.stringify({
        action: 'opened',
        pull_request: {
          number: 101,
          html_url: 'https://github.com/org/repo/pull/101',
          title: 'Fake PR',
          head: { ref: `feat/task-${targetTask.id}` },
          user: { login: 'attacker' },
        },
      });

      const invalidSignature =
        'sha256=0000000000000000000000000000000000000000000000000000000000000000';

      const res = await fetch(`${BASE_URL}/api/webhooks/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': invalidSignature,
        },
        body: fakePayload,
      });

      const data = await res.json();
      const isBlocked = res.status === 401 && data.error?.code === 'INVALID_SIGNATURE';

      recordTest(
        'TEST-01',
        'Chặn Webhook Giả Mạo / Sai Chữ Ký HMAC SHA-256 (HTTP 401 Unauthorized)',
        isBlocked,
        `HTTP ${res.status} | Code: ${data.error?.code} | Message: "${data.error?.message}"`
      );
    }

    // ------------------------------------------------------------
    // TEST-02: Xác Thực Chữ Ký Đúng & Bóc Tách Task UUID Từ Branch
    // ------------------------------------------------------------
    const prNumber = 102;
    const branchName = `feat/task-${targetTask.id}`;
    let prApiResponseData: any = null;
    {
      const validPayload = JSON.stringify({
        action: 'opened',
        pull_request: {
          number: prNumber,
          html_url: `https://github.com/org/repo/pull/${prNumber}`,
          title: 'feat: implement distributed payment settlement engine',
          body: `Closes #${targetTask.id}. Implemented Redis idempotency check and atomic transaction.`,
          head: {
            ref: branchName,
          },
          user: {
            login: 'senior-engineer',
          },
          merged: false,
        },
        diff_summary: `Added PaymentController with IdempotencyMiddleware, ledger balance verification in PostgreSQL, and 14 unit test suites.`,
      });

      const validSignature = signPayload(validPayload);

      const res = await fetch(`${BASE_URL}/api/webhooks/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': validSignature,
        },
        body: validPayload,
      });

      const data = await res.json();
      prApiResponseData = data.data;

      const isValid =
        res.status === 200 &&
        data.success === true &&
        data.data?.taskId === targetTask.id &&
        data.data?.prNumber === prNumber;

      recordTest(
        'TEST-02',
        'Xác Thực Chữ Ký Đúng & Bóc Tách Task UUID Từ Tên Nhánh (HTTP 200 OK)',
        isValid,
        `HTTP ${res.status} | Branch: "${branchName}" -> Matched Task ID: ${data.data?.taskId} (Trùng khớp 100%)`
      );
    }

    // ------------------------------------------------------------
    // TEST-03: Tự Động Lưu Dữ Liệu Bảng git_pull_requests (Ground Truth)
    // ------------------------------------------------------------
    {
      // TRUY VẤN VẬT LÝ VÀO POSTGRESQL KIỂM CHỨNG BẢNG git_pull_requests
      const dbPr = await prisma.gitPullRequest.findFirst({
        where: {
          taskId: targetTask.id,
          prNumber,
        },
      });

      // Gọi endpoint /pull-requests để kiểm chứng tầng đọc API
      const listPrRes = await fetch(
        `${BASE_URL}/api/tasks/${targetTask.id}/pull-requests`,
        {
          headers: { Authorization: `Bearer ${leaderToken}` },
        }
      );
      const listPrData = await listPrRes.json();
      const prList = listPrData.data?.pullRequests;

      const isDbPrFound = dbPr !== null && dbPr.prNumber === prNumber;
      const isFeedbackSaved = Boolean(dbPr?.aiVerificationFeedback && dbPr.aiVerificationFeedback.length > 5);
      const isBranchSaved = dbPr?.branchName === branchName;
      const isListApiMatched = Array.isArray(prList) && prList.some((p: any) => p.prNumber === prNumber);

      const passed = isDbPrFound && isFeedbackSaved && isBranchSaved && isListApiMatched;
      recordTest(
        'TEST-03',
        'Tự Động Lưu Dữ Liệu Bảng git_pull_requests & Phản Hồi Thẩm Định AI',
        passed,
        `DB Record ID: ${dbPr?.id} | PR #${dbPr?.prNumber} | isVerifiedByAi: ${dbPr?.isVerifiedByAi} | AI Feedback: "${dbPr?.aiVerificationFeedback?.slice(0, 50)}..."`
      );
    }

    // ------------------------------------------------------------
    // TEST-04: Tự Động Kích Hoạt FSM Chuyển Trạng Thái IN_PROGRESS -> REVIEW
    // ------------------------------------------------------------
    {
      // TRUY VẤN VẬT LÝ VÀO POSTGRESQL KIỂM CHỨNG BẢNG tasks VÀ task_status_history
      const updatedDbTask = await prisma.task.findUnique({
        where: { id: targetTask.id },
      });

      const dbStatusHistories = await prisma.taskStatusHistory.findMany({
        where: { taskId: targetTask.id },
        orderBy: { createdAt: 'desc' },
      });

      const latestHistory = dbStatusHistories[0];

      const isTaskInReview = updatedDbTask?.status === 'REVIEW';
      const hasInReviewAt = updatedDbTask?.inReviewAt !== null;
      const isHistoryRecorded =
        latestHistory?.fromStatus === 'IN_PROGRESS' && latestHistory?.toStatus === 'REVIEW';

      const passed = isTaskInReview && hasInReviewAt && isHistoryRecorded;
      recordTest(
        'TEST-04',
        'Tự Động Kích Hoạt FSM Chuyển Trạng Thái IN_PROGRESS -> REVIEW & Ghi Log Lịch Sử',
        passed,
        `Task status trong DB: ${updatedDbTask?.status} | in_review_at: ${updatedDbTask?.inReviewAt?.toISOString()} | Lịch sử FSM: ${latestHistory?.fromStatus} -> ${latestHistory?.toStatus}`
      );
    }

    // ------------------------------------------------------------
    // TEST-05: Bỏ Qua An Toàn Khi PR Không Chứa Task ID (0 Ghost Rows)
    // ------------------------------------------------------------
    {
      const randomPrNumber = 999;
      const unlinkedPayload = JSON.stringify({
        action: 'opened',
        pull_request: {
          number: randomPrNumber,
          html_url: `https://github.com/org/repo/pull/${randomPrNumber}`,
          title: 'chore: update documentation and contributor guidelines',
          body: 'Fix minor typo in README.md without linking to any task',
          head: {
            ref: 'docs/update-readme', // Không chứa UUID
          },
          user: {
            login: 'open-source-contributor',
          },
          merged: false,
        },
      });

      const validSignature = signPayload(unlinkedPayload);

      const res = await fetch(`${BASE_URL}/api/webhooks/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': validSignature,
        },
        body: unlinkedPayload,
      });

      const data = await res.json();

      // TRUY VẤN VẬT LÝ VÀO POSTGRESQL: KHÔNG ĐƯỢC CÓ BẢN GHI RÁC NÀO
      const ghostPrCount = await prisma.gitPullRequest.count({
        where: { prNumber: randomPrNumber },
      });

      const isSkippedSafely = res.status === 200 && data.success === true && data.data?.skipped === true;
      const hasZeroGhostRows = ghostPrCount === 0;

      const passed = isSkippedSafely && hasZeroGhostRows;
      recordTest(
        'TEST-05',
        'Bỏ Qua An Toàn Khi PR Không Chứa Task ID (Không Sinh Bản Ghi Rác CSDL)',
        passed,
        `HTTP ${res.status} | skipped: ${data.data?.skipped} (reason: ${data.data?.reason}) | Số bản ghi rác phát sinh trong DB: ${ghostPrCount}`
      );
    }

    // ============================================================
    // BÁO CÁO TỔNG HỢP KIỂM THỬ KHÁCH QUAN MODULE 07
    // ============================================================
    console.log(`\n============================================================`);
    console.log(`🎯 KẾT QUẢ ĐÁNH GIÁ ĐỘC LẬP - MODULE 07 (GIT PR VERIFICATION):`);
    const passedCount = testResults.filter((r) => r.passed).length;
    console.log(`Đạt: ${passedCount}/${testResults.length} bài kiểm thử.`);

    if (passedCount === 5) {
      console.log(`🏆 TẤT CẢ 5 TIÊU CHUẨN CHỐNG ẢO GIÁC ĐỀU PASS THẬT SỰ TRÊN POSTGRESQL!`);
    } else {
      console.error(`❌ CÓ ${testResults.length - passedCount} TIÊU CHUẨN THẤT BẠI.`);
    }
    console.log(`============================================================\n`);
  } catch (error) {
    console.error('Lỗi nghiêm trọng khi thực thi kiểm thử MOD-07:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runMod07TestSuite().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

export {};

