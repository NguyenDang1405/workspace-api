/**
 * Objective Anti-Hallucination Test Suite for Module 6:
 * Adaptive Skill Elo Calibration Engine (Vòng lặp Phản hồi Năng lực Thích ứng)
 *
 * Verifies all 5 Anti-Hallucination Criteria with Direct PostgreSQL Physical Checks:
 * - TEST-01: Rating increases upon task approval (ΔR > 0) due to exceeding expectations.
 * - TEST-02: Rating decreases upon task rejection (ΔR < 0) and tasks_rejected counter increments.
 * - TEST-03: Time-series log continuity: Log 2's old_rating strictly equals Log 1's new_rating.
 * - TEST-04: Critical Path modulation: |ΔR_critical| = 1.25 * |ΔR_non_critical| (μ_critical = 1.25).
 * - TEST-05: RBAC Security Enforcement: MEMBER role blocked with HTTP 403 Forbidden.
 *
 * Execution:
 * npm run test:module6
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

async function runMod06TestSuite() {
  console.log(`\n============================================================`);
  console.log(`🚀 BẮT ĐẦU KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC - MODULE 06`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Database: PostgreSQL (localhost:5433 / workspace_db)`);
  console.log(`============================================================\n`);

  const uniqueSuffix = Date.now().toString().slice(-6);
  const leaderEmail = `leader_elo_${uniqueSuffix}@workspace.local`;
  const memberEmail = `member_elo_${uniqueSuffix}@workspace.local`;
  const password = 'Password123@Valid';

  let leaderToken = '';
  let memberToken = '';
  let leaderUserId = '';
  let memberUserId = '';
  let testProjectId = '';

  try {
    // ------------------------------------------------------------
    // SETUP: Tạo tài khoản Leader & Member qua API
    // ------------------------------------------------------------
    const leaderRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: leaderEmail,
        password,
        fullName: `Lead Reviewer ${uniqueSuffix}`,
        role: 'LEADER',
        department: 'BACKEND',
        level: 'SENIOR',
        skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
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
        fullName: `Dev Engineer ${uniqueSuffix}`,
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
        name: `Project Elo Calibration ${uniqueSuffix}`,
        description: 'Dự án đo lường biến thiên năng lực Elo thích ứng',
        techStack: ['PostgreSQL', 'TypeScript', 'Next.js'],
        complexity: 'MEDIUM',
        ownerId: leaderUserId,
        targetEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    testProjectId = project.id;

    // Khởi tạo điểm Elo ban đầu 1200.00 cho kỹ năng 'TypeScript' của Member
    await prisma.userSkillRating.upsert({
      where: {
        userId_skillName: { userId: memberUserId, skillName: 'TypeScript' },
      },
      create: {
        userId: memberUserId,
        skillName: 'TypeScript',
        ratingScore: new Prisma.Decimal(1200.00),
        tasksCompleted: 0,
        tasksRejected: 0,
      },
      update: {
        ratingScore: new Prisma.Decimal(1200.00),
        tasksCompleted: 0,
        tasksRejected: 0,
      },
    });

    // ------------------------------------------------------------
    // TEST-01: Hiệu Chuẩn Tăng Điểm Khi Approve Task (ΔR > 0)
    // ------------------------------------------------------------
    {
      // Task JUNIOR (độ khó 1400) > Kỹ sư (1200) -> Thắng trận vượt cấp
      const taskApprove = await prisma.task.create({
        data: {
          projectId: testProjectId,
          title: 'Implement Core Payment Service in TypeScript',
          description: 'Xây dựng service xử lý thanh toán với độ khó Junior (1400)',
          targetDepartment: 'BACKEND',
          requiredLevel: 'JUNIOR',
          estimatedHours: new Prisma.Decimal(4.0),
          actualHours: new Prisma.Decimal(3.5),
          status: 'REVIEW',
          assignedTo: memberUserId,
          isCriticalPath: false,
          startedAt: new Date(Date.now() - 4 * 3600 * 1000),
          inReviewAt: new Date(),
        },
      });

      const res = await fetch(`${BASE_URL}/api/tasks/${taskApprove.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${leaderToken}`,
        },
        body: JSON.stringify({
          action: 'APPROVE',
          feedback: 'Hoàn thành xuất sắc trước hạn định',
          primarySkill: 'TypeScript',
        }),
      });

      const data = await res.json();
      const apiOk = res.status === 200 && data.success === true && data.data?.newStatus === 'DONE';

      // TRUY VẤN VẬT LÝ VÀO POSTGRESQL KIỂM CHỨNG
      const dbRating = await prisma.userSkillRating.findUnique({
        where: {
          userId_skillName: { userId: memberUserId, skillName: 'TypeScript' },
        },
      });

      const dbTask = await prisma.task.findUnique({
        where: { id: taskApprove.id },
      });

      const newScore = dbRating ? Number(dbRating.ratingScore) : 0;
      const tasksCompleted = dbRating ? dbRating.tasksCompleted : 0;
      const delta = data.data?.elo?.delta;

      const isScoreIncreased = newScore > 1200.0 && delta > 0;
      const isTaskDone = dbTask?.status === 'DONE';
      const isCompletedIncremented = tasksCompleted === 1;

      const passed = apiOk && isScoreIncreased && isTaskDone && isCompletedIncremented;
      recordTest(
        'TEST-01',
        'Hiệu Chuẩn Tăng Điểm Khi Approve Task (Kỹ Sư Vượt Cấp Thành Công)',
        passed,
        `HTTP ${res.status} | Old: 1200.00 -> New: ${newScore} (ΔR = +${delta}) | tasks_completed: ${tasksCompleted} | Task status: ${dbTask?.status}`
      );
    }

    // ------------------------------------------------------------
    // TEST-02: Hiệu Chuẩn Giảm Điểm Khi Reject Task (ΔR < 0)
    // ------------------------------------------------------------
    let ratingAfterTest1 = 0;
    {
      const currentRating = await prisma.userSkillRating.findUnique({
        where: {
          userId_skillName: { userId: memberUserId, skillName: 'TypeScript' },
        },
      });
      ratingAfterTest1 = Number(currentRating!.ratingScore);

      const taskReject = await prisma.task.create({
        data: {
          projectId: testProjectId,
          title: 'Refactor Auth Service with TypeScript Generics',
          description: 'Tối ưu hóa mã nguồn xác thực',
          targetDepartment: 'BACKEND',
          requiredLevel: 'JUNIOR',
          estimatedHours: new Prisma.Decimal(4.0),
          actualHours: new Prisma.Decimal(4.0),
          status: 'REVIEW',
          assignedTo: memberUserId,
          isCriticalPath: false,
          startedAt: new Date(Date.now() - 4 * 3600 * 1000),
          inReviewAt: new Date(),
        },
      });

      const res = await fetch(`${BASE_URL}/api/tasks/${taskReject.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${leaderToken}`,
        },
        body: JSON.stringify({
          action: 'REJECT',
          feedback: 'Chưa đạt chuẩn kiểm thử đơn vị, yêu cầu bổ sung test coverage',
          primarySkill: 'TypeScript',
        }),
      });

      const data = await res.json();
      const apiOk = res.status === 200 && data.success === true && data.data?.newStatus === 'IN_PROGRESS';

      // TRUY VẤN VẬT LÝ VÀO POSTGRESQL KIỂM CHỨNG
      const dbRating = await prisma.userSkillRating.findUnique({
        where: {
          userId_skillName: { userId: memberUserId, skillName: 'TypeScript' },
        },
      });

      const dbTask = await prisma.task.findUnique({
        where: { id: taskReject.id },
      });

      const newScore = dbRating ? Number(dbRating.ratingScore) : 0;
      const tasksRejected = dbRating ? dbRating.tasksRejected : 0;
      const delta = data.data?.elo?.delta;

      const isScoreDecreased = newScore < ratingAfterTest1 && delta < 0;
      const isTaskReverted = dbTask?.status === 'IN_PROGRESS';
      const isRejectedIncremented = tasksRejected === 1;

      const passed = apiOk && isScoreDecreased && isTaskReverted && isRejectedIncremented;
      recordTest(
        'TEST-02',
        'Hiệu Chuẩn Giảm Điểm Khi Reject Task (Phạt Điểm & Lùi Trạng Thái Task)',
        passed,
        `HTTP ${res.status} | Old: ${ratingAfterTest1} -> New: ${newScore} (ΔR = ${delta}) | tasks_rejected: ${tasksRejected} | Task status: ${dbTask?.status}`
      );
    }

    // ------------------------------------------------------------
    // TEST-03: Tính Toàn Vẹn Chuỗi Thời Gian (Time-Series Continuity)
    // ------------------------------------------------------------
    {
      // Truy vấn vật lý bảng user_skill_rating_logs
      const logs = await prisma.userSkillRatingLog.findMany({
        where: {
          userId: memberUserId,
          skillName: 'TypeScript',
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      // Gọi endpoint /skill-history kiểm tra tính tương thích
      const historyRes = await fetch(
        `${BASE_URL}/api/users/${memberUserId}/skill-history?skillName=TypeScript`,
        {
          headers: { Authorization: `Bearer ${leaderToken}` },
        }
      );
      const historyData = await historyRes.json();
      const apiHistory = historyData.data?.history;

      const hasExactlyTwoLogs = logs.length === 2 && Array.isArray(apiHistory) && apiHistory.length === 2;

      // Khẳng định: old_rating của log 2 PHẢI BẰNG new_rating của log 1
      const log1 = logs[0];
      const log2 = logs[1];

      const log1New = Number(log1?.newRating);
      const log2Old = Number(log2?.oldRating);
      const isContinuous = log1New === log2Old;

      const isEvent1Valid = log1?.eventType === 'TASK_DONE';
      const isEvent2Valid = log2?.eventType === 'REVIEW_REJECT';

      const passed = hasExactlyTwoLogs && isContinuous && isEvent1Valid && isEvent2Valid;
      recordTest(
        'TEST-03',
        'Tính Toàn Vẹn Chuỗi Thời Gian (Time-Series Log Continuity & Audit)',
        passed,
        `Số bản ghi: ${logs.length} | Log 1 New: ${log1New} === Log 2 Old: ${log2Old} (${isContinuous}) | EventTypes: [${log1?.eventType}, ${log2?.eventType}]`
      );
    }

    // ------------------------------------------------------------
    // TEST-04: Hệ Số Phạt Thưởng Đường Găng CPM (μ_critical = 1.25)
    // ------------------------------------------------------------
    {
      // Sử dụng kỹ năng riêng 'Golang' với số task ban đầu = 10 để cố định μ_uncertainty = 1.0
      await prisma.userSkillRating.upsert({
        where: {
          userId_skillName: { userId: memberUserId, skillName: 'Golang' },
        },
        create: {
          userId: memberUserId,
          skillName: 'Golang',
          ratingScore: new Prisma.Decimal(1200.00),
          tasksCompleted: 10, // 5 <= tasksCompleted <= 20 => mu_uncertainty = 1.0
          tasksRejected: 0,
        },
        update: {
          ratingScore: new Prisma.Decimal(1200.00),
          tasksCompleted: 10,
          tasksRejected: 0,
        },
      });

      // Task A: Nằm trên đường găng (isCriticalPath = true) -> K_A = 32 * 1.0 * 1.25 = 40.0
      const taskCritical = await prisma.task.create({
        data: {
          projectId: testProjectId,
          title: 'High-Throughput Golang Order Processor (Critical)',
          description: 'Nằm trên đường găng CPM',
          targetDepartment: 'BACKEND',
          requiredLevel: 'MIDDLE', // 1600
          estimatedHours: new Prisma.Decimal(8.0),
          actualHours: new Prisma.Decimal(8.0), // ratio = 1.0 -> actualScore = 1.0
          status: 'REVIEW',
          assignedTo: memberUserId,
          isCriticalPath: true,
          startedAt: new Date(Date.now() - 8 * 3600 * 1000),
          inReviewAt: new Date(),
        },
      });

      const resCrit = await fetch(`${BASE_URL}/api/tasks/${taskCritical.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${leaderToken}`,
        },
        body: JSON.stringify({
          action: 'APPROVE',
          primarySkill: 'Golang',
        }),
      });
      const dataCrit = await resCrit.json();
      const deltaCrit = dataCrit.data?.elo?.delta;
      const kFactorCrit = dataCrit.data?.elo?.kFactor;

      // Reset rating Golang về lại 1200.00 và tasksCompleted = 10 để Task Non-Critical có cùng xuất phát điểm
      await prisma.userSkillRating.update({
        where: {
          userId_skillName: { userId: memberUserId, skillName: 'Golang' },
        },
        data: {
          ratingScore: new Prisma.Decimal(1200.00),
          tasksCompleted: 10,
        },
      });

      // Task B: Không nằm trên đường găng (isCriticalPath = false) -> K_B = 32 * 1.0 * 1.0 = 32.0
      const taskNonCrit = await prisma.task.create({
        data: {
          projectId: testProjectId,
          title: 'Golang Telemetry Logger (Non-Critical)',
          description: 'Task phụ không nằm trên đường găng',
          targetDepartment: 'BACKEND',
          requiredLevel: 'MIDDLE', // 1600
          estimatedHours: new Prisma.Decimal(8.0),
          actualHours: new Prisma.Decimal(8.0), // ratio = 1.0 -> actualScore = 1.0
          status: 'REVIEW',
          assignedTo: memberUserId,
          isCriticalPath: false,
          startedAt: new Date(Date.now() - 8 * 3600 * 1000),
          inReviewAt: new Date(),
        },
      });

      const resNonCrit = await fetch(`${BASE_URL}/api/tasks/${taskNonCrit.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${leaderToken}`,
        },
        body: JSON.stringify({
          action: 'APPROVE',
          primarySkill: 'Golang',
        }),
      });
      const dataNonCrit = await resNonCrit.json();
      const deltaNonCrit = dataNonCrit.data?.elo?.delta;
      const kFactorNonCrit = dataNonCrit.data?.elo?.kFactor;

      // Tỷ số giữa deltaCrit và deltaNonCrit phải xấp xỉ 1.25 (do K = 40.0 vs 32.0)
      const ratioK = kFactorCrit / kFactorNonCrit;
      const ratioDelta = deltaCrit / deltaNonCrit;

      const isKModulated = Math.abs(ratioK - 1.25) < 0.01;
      const isDeltaModulated = Math.abs(ratioDelta - 1.25) < 0.02;

      const passed =
        resCrit.status === 200 &&
        resNonCrit.status === 200 &&
        isKModulated &&
        isDeltaModulated;

      recordTest(
        'TEST-04',
        'Hệ Số Phạt Thưởng Đường Găng CPM (K_factor Critical gấp 1.25 lần)',
        passed,
        `K_Crit: ${kFactorCrit} vs K_NonCrit: ${kFactorNonCrit} (Tỷ số K: ${ratioK.toFixed(2)}) | ΔR_Crit: +${deltaCrit} vs ΔR_NonCrit: +${deltaNonCrit} (Tỷ số ΔR: ${ratioDelta.toFixed(2)})`
      );
    }

    // ------------------------------------------------------------
    // TEST-05: Chặn Quyền MEMBER Nghiệm Thu Task (HTTP 403 Forbidden)
    // ------------------------------------------------------------
    {
      const taskReviewRbac = await prisma.task.create({
        data: {
          projectId: testProjectId,
          title: 'Sensitive Security Task awaiting Review',
          description: 'Task kiểm tra quyền RBAC',
          targetDepartment: 'BACKEND',
          requiredLevel: 'SENIOR',
          estimatedHours: new Prisma.Decimal(8.0),
          status: 'REVIEW',
          assignedTo: memberUserId,
          isCriticalPath: false,
          startedAt: new Date(),
          inReviewAt: new Date(),
        },
      });

      const memberAttemptRes = await fetch(`${BASE_URL}/api/tasks/${taskReviewRbac.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberToken}`, // Sử dụng Token của MEMBER
        },
        body: JSON.stringify({
          action: 'APPROVE',
          primarySkill: 'TypeScript',
        }),
      });

      const memberAttemptData = await memberAttemptRes.json();

      // Kiểm tra trong PostgreSQL: Trạng thái task KHÔNG được đổi sang DONE
      const dbTaskAfterAttempt = await prisma.task.findUnique({
        where: { id: taskReviewRbac.id },
      });

      const isForbidden =
        memberAttemptRes.status === 403 &&
        memberAttemptData.error?.code === 'FORBIDDEN';

      const isTaskUnchanged = dbTaskAfterAttempt?.status === 'REVIEW';

      const passed = isForbidden && isTaskUnchanged;
      recordTest(
        'TEST-05',
        'Cưỡng Chế Phân Quyền RBAC (Chặn MEMBER Tự Nghiệm Thu / Phê Duyệt Task)',
        passed,
        `MEMBER gọi API: HTTP ${memberAttemptRes.status} (code: ${memberAttemptData.error?.code}) | Task trong CSDL giữ nguyên REVIEW: ${isTaskUnchanged}`
      );
    }

    // ============================================================
    // BÁO CÁO TỔNG HỢP KIỂM THỬ KHÁCH QUAN MODULE 06
    // ============================================================
    console.log(`\n============================================================`);
    console.log(`🎯 KẾT QUẢ ĐÁNH GIÁ ĐỘC LẬP - MODULE 06 (ADAPTIVE SKILL ELO):`);
    const passedCount = testResults.filter((r) => r.passed).length;
    console.log(`Đạt: ${passedCount}/${testResults.length} bài kiểm thử.`);

    if (passedCount === 5) {
      console.log(`🏆 TẤT CẢ 5 TIÊU CHUẨN CHỐNG ẢO GIÁC ĐỀU PASS THẬT SỰ TRÊN POSTGRESQL!`);
    } else {
      console.error(`❌ CÓ ${testResults.length - passedCount} TIÊU CHUẨN THẤT BẠI.`);
    }
    console.log(`============================================================\n`);
  } catch (error) {
    console.error('Lỗi nghiêm trọng khi thực thi kiểm thử MOD-06:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runMod06TestSuite().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

export {};

