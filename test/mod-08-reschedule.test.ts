/**
 * Objective Anti-Hallucination Test Suite for Module 8:
 * Dynamic Rescheduling Engine & PERT-Beta Monte Carlo Risk Simulation
 *
 * Verifies all 5 Anti-Hallucination Criteria with Direct PostgreSQL Physical Checks:
 * - TEST-01: Slack Absorption on Non-Critical Task (Delay <= Slack -> Makespan unchanged, ΔT = 0, no event created).
 * - TEST-02: Critical Path Delay Propagation (Delay on critical task -> Makespan extends, physical record in rescheduling_events with AI mitigation).
 * - TEST-03: PERT-Beta Monte Carlo mathematical validity (1,000 iterations: P50 <= P80 <= P95, 10 bins sum strictly to 1,000).
 * - TEST-04: Blocked task penalty impact (P95 strictly increases when critical task isBlocked = true).
 * - TEST-05: RBAC Security Enforcement (MEMBER role blocked with HTTP 403 Forbidden).
 *
 * Execution:
 * npm run test:module8
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

async function runMod08TestSuite() {
  console.log(`\n============================================================`);
  console.log(`🚀 BẮT ĐẦU KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC - MODULE 08`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Database: PostgreSQL (localhost:5433 / workspace_db)`);
  console.log(`============================================================\n`);

  const uniqueSuffix = Date.now().toString().slice(-6);
  const leaderEmail = `leader_resched_${uniqueSuffix}@workspace.local`;
  const memberEmail = `member_resched_${uniqueSuffix}@workspace.local`;
  const password = 'Password123@Valid';

  let leaderToken = '';
  let memberToken = '';
  let leaderUserId = '';
  let memberUserId = '';
  let testProjectId = '';

  let task1Id = '';
  let task2Id = '';
  let task3Id = '';
  let task4Id = '';

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
        fullName: `Lead Project Planner ${uniqueSuffix}`,
        role: 'LEADER',
        department: 'FULLSTACK',
        level: 'SENIOR',
        skills: ['TypeScript', 'Project Planning', 'PostgreSQL'],
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
        fullName: `Dev Implementer ${uniqueSuffix}`,
        role: 'MEMBER',
        department: 'BACKEND',
        level: 'JUNIOR',
        skills: ['TypeScript', 'Docker'],
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
        name: `Project Dynamic Rescheduling ${uniqueSuffix}`,
        description: 'Dự án đo lường thuật toán Tái lập lịch thích ứng & Monte Carlo',
        techStack: ['PostgreSQL', 'TypeScript', 'Docker', 'Next.js'],
        complexity: 'HARD',
        ownerId: leaderUserId,
        targetEndDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    });
    testProjectId = project.id;

    // Khởi tạo đồ thị 4 Tasks:
    // Task 1: Kiến trúc CSDL (20h) -> ES: 0, EF: 20, LS: 0, LF: 20, Slack: 0 (Găng)
    // Task 2: Backend API Core (40h) [Phụ thuộc Task 1] -> ES: 20, EF: 60, LS: 20, LF: 60, Slack: 0 (Găng)
    // Task 3: Cấu hình Docker & CI (10h) [Phụ thuộc Task 1] -> ES: 20, EF: 30, LS: 50, LF: 60, Slack: 30h (Không găng)
    // Task 4: Tích hợp Hệ thống (20h) [Phụ thuộc Task 2, Task 3] -> ES: 60, EF: 80, LS: 60, LF: 80, Slack: 0 (Găng)
    // Tổng thời gian dự án (Makespan): 80 giờ = 10.0 ngày làm việc (8h/ngày)

    const t1 = await prisma.task.create({
      data: {
        projectId: testProjectId,
        title: 'Thiết kế Kiến trúc CSDL & Bảng dữ liệu',
        description: 'Định nghĩa schema PostgreSQL và quan hệ khóa ngoại',
        estimatedHours: new Prisma.Decimal(20.0),
        status: 'SCHEDULED',
        earlyStart: new Prisma.Decimal(0.0),
        earlyFinish: new Prisma.Decimal(20.0),
        lateStart: new Prisma.Decimal(0.0),
        lateFinish: new Prisma.Decimal(20.0),
        slackTime: new Prisma.Decimal(0.0),
        isCriticalPath: true,
      },
    });
    task1Id = t1.id;

    const t2 = await prisma.task.create({
      data: {
        projectId: testProjectId,
        title: 'Phát triển Backend API Core & Business Logic',
        description: 'Xây dựng các Route Handler nghiệp vụ chính',
        estimatedHours: new Prisma.Decimal(40.0),
        status: 'SCHEDULED',
        earlyStart: new Prisma.Decimal(20.0),
        earlyFinish: new Prisma.Decimal(60.0),
        lateStart: new Prisma.Decimal(20.0),
        lateFinish: new Prisma.Decimal(60.0),
        slackTime: new Prisma.Decimal(0.0),
        isCriticalPath: true,
      },
    });
    task2Id = t2.id;

    const t3 = await prisma.task.create({
      data: {
        projectId: testProjectId,
        title: 'Cấu hình Docker Compose & CI/CD Pipeline',
        description: 'Viết Dockerfile và GitHub Actions workflow',
        estimatedHours: new Prisma.Decimal(10.0),
        status: 'SCHEDULED',
        earlyStart: new Prisma.Decimal(20.0),
        earlyFinish: new Prisma.Decimal(30.0),
        lateStart: new Prisma.Decimal(50.0),
        lateFinish: new Prisma.Decimal(60.0),
        slackTime: new Prisma.Decimal(30.0),
        isCriticalPath: false,
      },
    });
    task3Id = t3.id;

    const t4 = await prisma.task.create({
      data: {
        projectId: testProjectId,
        title: 'Tích hợp & Kiểm thử Toàn diện Hệ thống',
        description: 'Kiểm thử E2E liên chuỗi và chuẩn bị đóng gói',
        estimatedHours: new Prisma.Decimal(20.0),
        status: 'SCHEDULED',
        earlyStart: new Prisma.Decimal(60.0),
        earlyFinish: new Prisma.Decimal(80.0),
        lateStart: new Prisma.Decimal(60.0),
        lateFinish: new Prisma.Decimal(80.0),
        slackTime: new Prisma.Decimal(0.0),
        isCriticalPath: true,
      },
    });
    task4Id = t4.id;

    // Tạo các cạnh phụ thuộc (Task Dependencies)
    await prisma.taskDependency.createMany({
      data: [
        { predecessorId: task1Id, successorId: task2Id, dependencyType: 'FS' },
        { predecessorId: task1Id, successorId: task3Id, dependencyType: 'FS' },
        { predecessorId: task2Id, successorId: task4Id, dependencyType: 'FS' },
        { predecessorId: task3Id, successorId: task4Id, dependencyType: 'FS' },
      ],
    });

    console.log(`[Seed Setup] Khởi tạo thành công đồ thị 4 tasks:`);
    console.log(` - Task 1 (DB Schema): 20h, Critical = true, Slack = 0.0h`);
    console.log(` - Task 2 (Backend API): 40h, Critical = true, Slack = 0.0h`);
    console.log(` - Task 3 (Docker & CI): 10h, Critical = false, Slack = 30.0h`);
    console.log(` - Task 4 (System Integration): 20h, Critical = true, Slack = 0.0h`);
    console.log(` - Tổng Makespan ban đầu: 80.0 giờ (10.0 ngày làm việc)\n`);

    // ============================================================
    // TEST-01: HẤP THỤ ĐỘ TRỄ TRÊN TASK KHÔNG GĂNG (SLACK ABSORPTION)
    // ============================================================
    // Task 3 có slackTime = 30.0h. Kích hoạt trễ thêm 10.0h (< 30.0h).
    // Kỳ vọng: T_new == T_original = 80.0h, deltaHours = 0, isDelayAbsorbed = true.
    // Không có bản ghi mới nào trong bảng rescheduling_events.
    const resTest01 = await fetch(`${BASE_URL}/api/projects/${testProjectId}/reschedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leaderToken}`,
      },
      body: JSON.stringify({
        triggerTaskId: task3Id,
        actualDelayHours: 10.0,
        reason: 'Nghẽn mạng khi kéo Docker image từ GitHub Registry',
      }),
    });

    const dataTest01 = await resTest01.json();
    const isTest01HttpOk = resTest01.status === 200 && dataTest01.success === true;
    const body01 = dataTest01.data;

    // Kiểm tra trực tiếp CSDL PostgreSQL
    const dbTask3After = await prisma.task.findUnique({ where: { id: task3Id } });
    const eventsCountAfter01 = await prisma.reschedulingEvent.count({
      where: { projectId: testProjectId },
    });

    const isTest01Passed =
      isTest01HttpOk &&
      body01?.isDelayAbsorbed === true &&
      body01?.deltaHours === 0 &&
      body01?.newMakespanHours === 80.0 &&
      body01?.originalMakespanHours === 80.0 &&
      Number(dbTask3After?.estimatedHours) === 20.0 && // 10 + 10 = 20h
      Number(dbTask3After?.slackTime) === 20.0 && // 30 - 10 = 20h slack còn lại
      dbTask3After?.isCriticalPath === false &&
      eventsCountAfter01 === 0; // Không sinh event khi độ trễ bị hấp thụ

    recordTest(
      'TEST-01',
      'Hấp thụ độ trễ trên Task không găng (Slack Absorption)',
      isTest01Passed,
      `HTTP Status: ${resTest01.status} | Delay Absorbed: ${body01?.isDelayAbsorbed} | ` +
        `Makespan: ${body01?.originalMakespanHours}h -> ${body01?.newMakespanHours}h (Δ: ${body01?.deltaHours}h) | ` +
        `DB Task3: estimatedHours=${dbTask3After?.estimatedHours}, slackTime=${dbTask3After?.slackTime}h, critical=${dbTask3After?.isCriticalPath} | ` +
        `Rescheduling Events Count: ${eventsCountAfter01}`
    );

    // ============================================================
    // TEST-02: LAN TRUYỀN TRỄ TRÊN ĐƯỜNG GĂNG & LƯU CSDL SỰ KIỆN TÁI LẬP LỊCH
    // ============================================================
    // Task 2 nằm trên đường găng (slackTime = 0.0h). Kích hoạt trễ thêm 15.0h.
    // Kỳ vọng: Makespan tăng từ 80h -> 95h (10.0 ngày -> 11.9 ngày, Δ: 15h).
    // isDelayAbsorbed = false, bản ghi được lưu vào CSDL bảng rescheduling_events kèm AI mitigation strategy.
    const resTest02 = await fetch(`${BASE_URL}/api/projects/${testProjectId}/reschedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leaderToken}`,
      },
      body: JSON.stringify({
        triggerTaskId: task2Id,
        actualDelayHours: 15.0,
        reason: 'Phát sinh nghiệp vụ phức tạp ngoài dự kiến kiến trúc API',
      }),
    });

    const dataTest02 = await resTest02.json();
    const isTest02HttpOk = resTest02.status === 200 && dataTest02.success === true;
    const body02 = dataTest02.data;

    // Kiểm tra trực tiếp CSDL PostgreSQL bảng rescheduling_events
    const dbEventRecord = await prisma.reschedulingEvent.findFirst({
      where: {
        projectId: testProjectId,
        triggerTaskId: task2Id,
      },
      orderBy: { createdAt: 'desc' },
    });

    const dbTask2After = await prisma.task.findUnique({ where: { id: task2Id } });

    const isTest02Passed =
      isTest02HttpOk &&
      body02?.isDelayAbsorbed === false &&
      body02?.deltaHours === 15.0 &&
      body02?.newMakespanHours === 95.0 &&
      body02?.mitigationStrategy !== null &&
      dbEventRecord !== null &&
      Number(dbEventRecord.newMakespanDays) > Number(dbEventRecord.originalMakespanDays) &&
      Number(dbTask2After?.estimatedHours) === 55.0 && // 40 + 15 = 55h
      dbTask2After?.isCriticalPath === true &&
      Number(dbTask2After?.slackTime) === 0;

    recordTest(
      'TEST-02',
      'Lan truyền trễ trên đường găng & Lưu bản ghi sự kiện CSDL (Ground Truth)',
      isTest02Passed,
      `HTTP Status: ${resTest02.status} | Delta Hours: +${body02?.deltaHours}h | ` +
        `Makespan Mới: ${body02?.newMakespanHours}h | ` +
        `DB Event ID: ${dbEventRecord?.id} | ` +
        `DB Original Makespan: ${dbEventRecord?.originalMakespanDays}d -> New Makespan: ${dbEventRecord?.newMakespanDays}d | ` +
        `AI Strategy Type: ${(dbEventRecord?.mitigationStrategy as any)?.strategyType || 'N/A'}`
    );

    // ============================================================
    // TEST-03: MÔ PHỎNG RỦI RO LẬP LỊCH MONTE CARLO 1,000 LẦN
    // ============================================================
    // Gọi GET /api/projects/:id/risk-simulation?iterations=1000.
    // Kỳ vọng: Toán học tuân thủ nghiêm ngặt P50 <= P80 <= P95.
    // Mảng histogram có đúng 10 bin với tổng tần suất bằng chính xác 1,000.
    const startTimeSim = Date.now();
    const resTest03 = await fetch(
      `${BASE_URL}/api/projects/${testProjectId}/risk-simulation?iterations=1000`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${leaderToken}`,
        },
      }
    );
    const simDurationMs = Date.now() - startTimeSim;

    const dataTest03 = await resTest03.json();
    const isTest03HttpOk = resTest03.status === 200 && dataTest03.success === true;
    const body03 = dataTest03.data;

    let totalHistogramFreq = 0;
    if (Array.isArray(body03?.histogram)) {
      totalHistogramFreq = body03.histogram.reduce(
        (sum: number, b: any) => sum + (b.frequency || 0),
        0
      );
    }

    const baselineP95 = body03?.p95Hours || 0;
    const isTest03Passed =
      isTest03HttpOk &&
      body03?.iterations === 1000 &&
      body03?.p50Hours <= body03?.p80Hours &&
      body03?.p80Hours <= body03?.p95Hours &&
      body03?.histogram?.length === 10 &&
      totalHistogramFreq === 1000;

    recordTest(
      'TEST-03',
      'Mô phỏng rủi ro tiến độ Monte Carlo 1,000 lần (Toán học P50 <= P80 <= P95)',
      isTest03Passed,
      `HTTP Status: ${resTest03.status} | Latency: ${simDurationMs}ms | Iterations: ${body03?.iterations} | ` +
        `P50: ${body03?.p50Hours}h | P80: ${body03?.p80Hours}h | P95: ${body03?.p95Hours}h | ` +
        `Mean: ${body03?.meanMakespanHours}h, StdDev: ${body03?.standardDeviationHours} | ` +
        `Histogram Bins: ${body03?.histogram?.length} (Tổng tần suất: ${totalHistogramFreq}/1000)`
    );

    // ============================================================
    // TEST-04: TÁC ĐỘNG CỦA TASK BỊ NGHẼN (BLOCKED TASK PENALTY)
    // ============================================================
    // Đánh dấu Task 4 (nằm trên đường găng) isBlocked = true trong PostgreSQL.
    // Khi task bị nghẽn, phân phối PERT mở rộng cận trên b = 2.0 * est (thay vì 1.5 * est).
    // Kỳ vọng: Giá trị P95 khi bị nghẽn phải tăng cao hơn baselineP95 ban đầu.
    await prisma.task.update({
      where: { id: task4Id },
      data: {
        isBlocked: true,
        blockReason: 'Chờ đối tác cấp khóa API Sandbox và hồ sơ xác thực bảo mật',
      },
    });

    const resTest04 = await fetch(
      `${BASE_URL}/api/projects/${testProjectId}/risk-simulation?iterations=1000`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${leaderToken}`,
        },
      }
    );

    const dataTest04 = await resTest04.json();
    const isTest04HttpOk = resTest04.status === 200 && dataTest04.success === true;
    const body04 = dataTest04.data;

    // Đối soát trực tiếp DB
    const dbBlockedTask = await prisma.task.findUnique({ where: { id: task4Id } });

    const blockedP95 = body04?.p95Hours || 0;
    const isTest04Passed =
      isTest04HttpOk &&
      dbBlockedTask?.isBlocked === true &&
      dbBlockedTask?.blockReason ===
        'Chờ đối tác cấp khóa API Sandbox và hồ sơ xác thực bảo mật' &&
      blockedP95 > baselineP95;

    recordTest(
      'TEST-04',
      'Tác động của Task bị nghẽn (Blocked Task Penalty làm tăng rủi ro P95)',
      isTest04Passed,
      `HTTP Status: ${resTest04.status} | DB isBlocked: ${dbBlockedTask?.isBlocked} | ` +
        `Baseline P95 (Chưa nghẽn): ${baselineP95}h -> Blocked P95 (Đã nghẽn): ${blockedP95}h ` +
        `(Chênh lệch rủi ro: +${(blockedP95 - baselineP95).toFixed(1)}h)`
    );

    // ============================================================
    // TEST-05: CHẶN QUYỀN MEMBER KÍCH HOẠT TÁI LẬP LỊCH (RBAC 403)
    // ============================================================
    // Sử dụng token của MEMBER để gọi POST /api/projects/:id/reschedule.
    // Kỳ vọng: Nhận HTTP 403 Forbidden. CSDL không bị thay đổi thời lượng task.
    const resTest05 = await fetch(`${BASE_URL}/api/projects/${testProjectId}/reschedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        triggerTaskId: task1Id,
        actualDelayHours: 5.0,
        reason: 'Member cố tình tái lập lịch trái thẩm quyền',
      }),
    });

    const isTest05Forbidden = resTest05.status === 403;
    const dataTest05 = await resTest05.json();

    // Đối soát CSDL thật: Task 1 không được phép bị tăng giờ
    const dbTask1Untouched = await prisma.task.findUnique({ where: { id: task1Id } });
    const isTask1Intact = Number(dbTask1Untouched?.estimatedHours) === 20.0;

    const isTest05Passed = isTest05Forbidden && isTask1Intact;

    recordTest(
      'TEST-05',
      'Chặn quyền Member kích hoạt Tái lập lịch dự án (RBAC Security: HTTP 403)',
      isTest05Passed,
      `HTTP Status: ${resTest05.status} (Kỳ vọng: 403 Forbidden) | ` +
        `Error Code: ${dataTest05.error?.code || 'FORBIDDEN'} | ` +
        `DB Task 1 Estimated Hours nguyên vẹn: ${dbTask1Untouched?.estimatedHours}h`
    );
  } catch (error: any) {
    console.error('❌ Lỗi ngoại lệ trong quá trình chạy Test Suite MOD-08:', error);
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
  console.log(`📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ KHÁCH QUAN - MODULE 08`);
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
    console.log(`\n🎉 TOÀN BỘ 5 TIÊU CHUẨN CHỐNG ẢO GIÁC CỦA MOD-08 ĐÃ ĐẠT 100%!`);
  } else {
    console.error(`\n⚠️ CÓ BÀI TEST CHƯA ĐẠT. VUI LÒNG KIỂM TRA LẠI LOG CHI TIẾT TRÊN.`);
    process.exit(1);
  }
}

runMod08TestSuite();
