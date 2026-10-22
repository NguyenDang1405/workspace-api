/**
 * Objective Anti-Hallucination Test Suite for Module 9:
 * Automated Daily Standup & Team Intelligence Engine (Trợ lý Scrum Master Thông minh)
 *
 * Verifies all 5 Anti-Hallucination Criteria with Direct PostgreSQL Physical Checks:
 * - TEST-01: Automated report synthesis & physical storage in daily_standup_reports with flow metrics snapshot.
 * - TEST-02: Idempotent UPSERT invariance (multiple POSTs for same date yield strictly 1 DB row).
 * - TEST-03: Real-time blocked task reflection (isBlocked = true captured in flowMetrics & identifiedBlockers).
 * - TEST-04: Team Member authorization to read standup report (GET /api/projects/:id/standup returns HTTP 200).
 * - TEST-05: RBAC Security Enforcement (MEMBER role blocked from triggering POST report with HTTP 403 Forbidden).
 *
 * Execution:
 * npm run test:module9
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = process.env.TEST_APP_URL || 'http://localhost:3000';

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

async function runMod09TestSuite() {
  console.log(`\n============================================================`);
  console.log(`🚀 BẮT ĐẦU KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC - MODULE 09`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Database: PostgreSQL (localhost:5433 / workspace_db)`);
  console.log(`============================================================\n`);

  const uniqueSuffix = Date.now().toString().slice(-6);
  const leaderEmail = `leader_standup_${uniqueSuffix}@workspace.local`;
  const memberEmail = `member_standup_${uniqueSuffix}@workspace.local`;
  const password = 'Password123@Valid';

  let leaderToken = '';
  let memberToken = '';
  let leaderUserId = '';
  let memberUserId = '';
  let testProjectId = '';

  let task1Id = '';
  let task2Id = '';
  let task3Id = '';

  const todayStr = new Date().toISOString().split('T')[0];
  const todayDateOnly = new Date(`${todayStr}T00:00:00.000Z`);

  try {
    // ------------------------------------------------------------
    // SETUP: Tạo tài khoản Leader & Member qua API Auth
    // ------------------------------------------------------------
    const leaderRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: leaderEmail,
        password,
        fullName: `Scrum Master Lead ${uniqueSuffix}`,
        role: 'LEADER',
        department: 'FULLSTACK',
        level: 'SENIOR',
        skills: ['TypeScript', 'Agile', 'PostgreSQL'],
      }),
    });
    const leaderData = await leaderRes.json();
    leaderToken = leaderData.data?.accessToken;
    leaderUserId = leaderData.data?.id;

    const memberRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: memberEmail,
        password,
        fullName: `Dev Team Member ${uniqueSuffix}`,
        role: 'MEMBER',
        department: 'BACKEND',
        level: 'JUNIOR',
        skills: ['TypeScript', 'Node.js'],
      }),
    });
    const memberData = await memberRes.json();
    memberToken = memberData.data?.accessToken;
    memberUserId = memberData.data?.id;

    if (!leaderToken || !memberToken) {
      throw new Error('Không thể khởi tạo token kiểm thử Leader/Member.');
    }

    // Tạo dự án mẫu trong database
    const project = await prisma.project.create({
      data: {
        name: `Project Standup Intelligence ${uniqueSuffix}`,
        description: 'Dự án đo lường tính năng Daily Standup tự động',
        techStack: ['PostgreSQL', 'TypeScript', 'Next.js'],
        complexity: 'MEDIUM',
        ownerId: leaderUserId,
        targetEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    testProjectId = project.id;

    // Khởi tạo các tasks cho dự án:
    // Task 1: Đã DONE trong 24h qua kèm TaskStatusHistory
    const t1 = await prisma.task.create({
      data: {
        projectId: testProjectId,
        title: 'Cài đặt Schema Database PostgreSQL',
        description: 'Định nghĩa 14 bảng chuẩn DDL',
        status: 'DONE',
        assignedTo: memberUserId,
        estimatedHours: new Prisma.Decimal(8.0),
        actualHours: new Prisma.Decimal(7.5),
        isCriticalPath: true,
        completedAt: new Date(),
      },
    });
    task1Id = t1.id;

    // Ghi nhận lịch sử chuyển trạng thái trong 24h qua cho Task 1
    await prisma.taskStatusHistory.create({
      data: {
        taskId: task1Id,
        changedBy: memberUserId,
        fromStatus: 'IN_PROGRESS',
        toStatus: 'DONE',
        durationInPreviousStatusHours: new Prisma.Decimal(7.5),
        createdAt: new Date(),
      },
    });

    // Tạo PR trong 24h qua cho Task 1
    await prisma.gitPullRequest.create({
      data: {
        taskId: task1Id,
        prNumber: 101,
        prUrl: 'https://github.com/org/repo/pull/101',
        branchName: `feat/task-${task1Id}`,
        authorGithubUsername: 'member_dev',
        status: 'MERGED',
        diffSummary: 'Đã hoàn thành bảng DDL schema',
        isVerifiedByAi: true,
        mergedAt: new Date(),
      },
    });

    // Task 2: Đang IN_PROGRESS trên đường găng (Kế hoạch hôm nay)
    const t2 = await prisma.task.create({
      data: {
        projectId: testProjectId,
        title: 'Xây dựng API Daily Standup Route Handler',
        description: 'Triển khai GET và POST endpoints',
        status: 'IN_PROGRESS',
        assignedTo: memberUserId,
        estimatedHours: new Prisma.Decimal(12.0),
        isCriticalPath: true,
        startedAt: new Date(),
      },
    });
    task2Id = t2.id;

    // Task 3: Đang TODO
    const t3 = await prisma.task.create({
      data: {
        projectId: testProjectId,
        title: 'Viết Test Suite Kiểm thử Khách quan MOD-09',
        description: 'Kiểm thử 5 tiêu chuẩn chống ảo giác',
        status: 'TODO',
        assignedTo: leaderUserId,
        estimatedHours: new Prisma.Decimal(6.0),
        isCriticalPath: false,
      },
    });
    task3Id = t3.id;

    console.log(`[Seed Setup] Khởi tạo thành công 3 tasks và 1 PR:`);
    console.log(` - Task 1: DONE (StatusHistory: IN_PROGRESS -> DONE, PR #101 MERGED)`);
    console.log(` - Task 2: IN_PROGRESS (Critical = true, 12.0h)`);
    console.log(` - Task 3: TODO (6.0h)\n`);

    // ============================================================
    // TEST-01: TỰ ĐỘNG SINH BÁO CÁO & LƯU BẢNG DAILY_STANDUP_REPORTS
    // ============================================================
    // Gọi POST /api/projects/:id/standup với Leader Token.
    // Kỳ vọng: HTTP 201 hoặc 200, trả về báo cáo Standup đầy đủ.
    // Kiểm tra trực tiếp PostgreSQL: Bảng daily_standup_reports lưu trữ chính xác.
    const resTest01 = await fetch(`${BASE_URL}/api/projects/${testProjectId}/standup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leaderToken}`,
      },
      body: JSON.stringify({
        reportDate: todayStr,
      }),
    });

    const isTest01HttpOk = resTest01.status === 201 || resTest01.status === 200;
    const dataTest01 = await resTest01.json();
    const body01 = dataTest01.data;

    // Kiểm tra trực tiếp CSDL PostgreSQL
    const dbReport01 = await prisma.dailyStandupReport.findUnique({
      where: {
        projectId_reportDate: {
          projectId: testProjectId,
          reportDate: todayDateOnly,
        },
      },
    });

    const flowMetrics01 = dbReport01?.flowMetrics as any;

    const isTest01Passed =
      isTest01HttpOk &&
      dataTest01.success === true &&
      dbReport01 !== null &&
      dbReport01.summaryYesterday.trim().length > 0 &&
      dbReport01.planToday.trim().length > 0 &&
      dbReport01.identifiedBlockers.trim().length > 0 &&
      flowMetrics01 !== null &&
      typeof flowMetrics01.activeWip === 'number' &&
      flowMetrics01.completedLast24h >= 1;

    recordTest(
      'TEST-01',
      'Tự động sinh báo cáo Standup & Lưu CSDL bảng daily_standup_reports (Ground Truth)',
      isTest01Passed,
      `HTTP Status: ${resTest01.status} | DB Report ID: ${dbReport01?.id} | ` +
        `Summary: "${dbReport01?.summaryYesterday.slice(0, 60)}..." | ` +
        `Flow Metrics: activeWip=${flowMetrics01?.activeWip}, completedLast24h=${flowMetrics01?.completedLast24h}, criticalHours=${flowMetrics01?.criticalPathRemainingHours}h`
    );

    // ============================================================
    // TEST-02: KIỂM TRA TÍNH BẤT BIẾN IDEMPOTENT UPSERT
    // ============================================================
    // Gọi POST /api/projects/:id/standup lần 2 cho cùng ngày hôm nay.
    // Kỳ vọng: Cơ chế Prisma UPSERT cập nhật bản ghi cũ mà không tạo thêm dòng mới.
    // Kiểm tra trực tiếp CSDL: COUNT(*) WHERE project_id = ... AND report_date = today BẮT BUỘC = 1.
    const resTest02 = await fetch(`${BASE_URL}/api/projects/${testProjectId}/standup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leaderToken}`,
      },
      body: JSON.stringify({
        reportDate: todayStr,
        forceRegenerate: true,
      }),
    });

    const isTest02HttpOk = resTest02.status === 201 || resTest02.status === 200;

    // Đối soát trực tiếp CSDL PostgreSQL
    const reportsCount = await prisma.dailyStandupReport.count({
      where: {
        projectId: testProjectId,
        reportDate: todayDateOnly,
      },
    });

    const isTest02Passed = isTest02HttpOk && reportsCount === 1;

    recordTest(
      'TEST-02',
      'Kiểm tra tính bất biến Idempotent UPSERT (Ràng buộc duy nhất project_id + report_date)',
      isTest02Passed,
      `HTTP Status: ${resTest02.status} | Tổng số bản ghi trong CSDL sau 2 lần POST: ${reportsCount} (Kỳ vọng duy nhất: 1)`
    );

    // ============================================================
    // TEST-03: PHẢN ÁNH ĐÚNG TASK BỊ NGHẼN TRONG BÁO CÁO (BLOCKED TASK DETECTION)
    // ============================================================
    // Đánh dấu Task 2 có isBlocked = true và lý do nghẽn cụ thể.
    // Gọi POST /api/projects/:id/standup để sinh lại báo cáo.
    // Kỳ vọng: flowMetrics.blockedTasksCount >= 1 và identifiedBlockers phản ánh rõ lý do nghẽn.
    const blockReasonText = 'Thiếu API key Sandbox bên thứ 3';
    await prisma.task.update({
      where: { id: task2Id },
      data: {
        isBlocked: true,
        blockReason: blockReasonText,
      },
    });

    const resTest03 = await fetch(`${BASE_URL}/api/projects/${testProjectId}/standup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leaderToken}`,
      },
      body: JSON.stringify({
        reportDate: todayStr,
      }),
    });

    const dataTest03 = await resTest03.json();
    const isTest03HttpOk = resTest03.status === 201 || resTest03.status === 200;
    const body03 = dataTest03.data;

    // Kiểm tra trực tiếp CSDL PostgreSQL
    const dbReport03 = await prisma.dailyStandupReport.findUnique({
      where: {
        projectId_reportDate: {
          projectId: testProjectId,
          reportDate: todayDateOnly,
        },
      },
    });

    const flowMetrics03 = dbReport03?.flowMetrics as any;
    const blockersText = dbReport03?.identifiedBlockers || '';

    const isBlockerReflected =
      blockersText.toLowerCase().includes('api key') ||
      blockersText.toLowerCase().includes('sandbox') ||
      blockersText.toLowerCase().includes('thiếu') ||
      blockersText.toLowerCase().includes('nghẽn');

    const isTest03Passed =
      isTest03HttpOk &&
      flowMetrics03?.blockedTasksCount >= 1 &&
      isBlockerReflected;

    recordTest(
      'TEST-03',
      'Phản ánh chính xác Task bị nghẽn (Evidence-based Blocker Detection)',
      isTest03Passed,
      `HTTP Status: ${resTest03.status} | Blocked Tasks Count: ${flowMetrics03?.blockedTasksCount} | ` +
        `DB Identified Blockers: "${blockersText.slice(0, 100)}..."`
    );

    // ============================================================
    // TEST-04: THÀNH VIÊN ĐƯỢC QUYỀN XEM BÁO CÁO (GET AUTHORIZATION)
    // ============================================================
    // Sử dụng token của MEMBER để gọi GET /api/projects/:id/standup.
    // Kỳ vọng: HTTP 200 OK, trả về đúng bản ghi báo cáo của ngày hôm nay.
    const resTest04 = await fetch(
      `${BASE_URL}/api/projects/${testProjectId}/standup?date=${todayStr}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${memberToken}`,
        },
      }
    );

    const isTest04HttpOk = resTest04.status === 200;
    const dataTest04 = await resTest04.json();
    const body04 = dataTest04.data;

    const isTest04Passed =
      isTest04HttpOk &&
      dataTest04.success === true &&
      body04?.id === dbReport03?.id &&
      body04?.reportDate === todayStr &&
      typeof body04?.summaryYesterday === 'string' &&
      typeof body04?.planToday === 'string' &&
      typeof body04?.identifiedBlockers === 'string';

    recordTest(
      'TEST-04',
      'Thành viên nhóm (MEMBER) được quyền đọc báo cáo Standup (GET HTTP 200 OK)',
      isTest04Passed,
      `HTTP Status: ${resTest04.status} | Report Date: ${body04?.reportDate} | ` +
        `Report ID khớp CSDL: ${body04?.id === dbReport03?.id} | Member Token truy cập hợp lệ`
    );

    // ============================================================
    // TEST-05: CHẶN QUYỀN MEMBER TỰ Ý SINH BÁO CÁO (RBAC POST 403)
    // ============================================================
    // Sử dụng token của MEMBER để gọi POST /api/projects/:id/standup.
    // Kỳ vọng: Nhận đúng HTTP 403 Forbidden.
    const resTest05 = await fetch(`${BASE_URL}/api/projects/${testProjectId}/standup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        reportDate: todayStr,
      }),
    });

    const isTest05Forbidden = resTest05.status === 403;
    const dataTest05 = await resTest05.json();

    const isTest05Passed =
      isTest05Forbidden &&
      dataTest05.success === false &&
      dataTest05.error?.code === 'FORBIDDEN';

    recordTest(
      'TEST-05',
      'Chặn quyền Member tự ý kích hoạt sinh báo cáo (RBAC Security: HTTP 403 Forbidden)',
      isTest05Passed,
      `HTTP Status: ${resTest05.status} (Kỳ vọng: 403 Forbidden) | ` +
        `Error Code: ${dataTest05.error?.code} | ` +
        `Message: "${dataTest05.error?.message}"`
    );
  } catch (error: any) {
    console.error('❌ Lỗi ngoại lệ trong quá trình chạy Test Suite MOD-09:', error);
  } finally {
    // Dọn dẹp dữ liệu kiểm thử
    if (testProjectId) {
      try {
        await prisma.project.delete({ where: { id: testProjectId } });
      } catch (_) {}
    }
    if (leaderUserId) {
      try {
        await prisma.user.delete({ where: { id: leaderUserId } });
      } catch (_) {}
    }
    if (memberUserId) {
      try {
        await prisma.user.delete({ where: { id: memberUserId } });
      } catch (_) {}
    }
    await prisma.$disconnect();
  }

  // Bảng tổng kết kết quả
  console.log(`\n============================================================`);
  console.log(`📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ KHÁCH QUAN - MODULE 09`);
  console.log(`============================================================`);

  const summaryTable = testResults.map((r) => ({
    'Mã Test': r.code,
    'Tên Tiêu Chuẩn': r.name,
    'Kết Quả': r.passed ? 'PASS ✅' : 'FAIL ❌',
    'Chi Tiết Đối Soát Thực Tế': r.details,
  }));

  console.table(summaryTable);

  const totalPassed = testResults.filter((r) => r.passed).length;
  const totalFailed = testResults.filter((r) => !r.passed).length;

  console.log(`\nTổng số bài test: ${testResults.length}`);
  console.log(`Thành công (PASS): ${totalPassed}`);
  console.log(`Thất bại (FAIL):   ${totalFailed}`);

  if (totalPassed === 5 && totalFailed === 0) {
    console.log(`\n🎉 TOÀN BỘ 5 TIÊU CHUẨN CHỐNG ẢO GIÁC CỦA MOD-09 ĐÃ ĐẠT 100%!`);
  } else {
    console.error(`\n⚠️ CÓ BÀI TEST CHƯA ĐẠT. VUI LÒNG KIỂM TRA LẠI LOG CHI TIẾT TRÊN.`);
    process.exit(1);
  }
}

runMod09TestSuite();

