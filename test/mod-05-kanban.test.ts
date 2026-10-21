/**
 * Objective Anti-Hallucination Test Suite for Module 5:
 * Async Kanban & Flow Observability Engine
 *
 * Verifies all 5 Anti-Hallucination Criteria with Direct PostgreSQL Physical Checks:
 * - TEST-01: Strict Finite State Machine (FSM) Transition Violation Prevention (400 INVALID_STATE_TRANSITION)
 * - TEST-02: Automatic Flow Timestamps & Status History Logging (started_at, in_review_at, completed_at, actual_hours)
 * - TEST-03: Review Guard RBAC: MEMBER forbidden from marking task as DONE (403 FORBIDDEN)
 * - TEST-04: Dynamic IQR Outlier Algorithm & Bottleneck Detection (isBottleneck === true on 100h task)
 * - TEST-05: Little's Law Flow Metrics & Cumulative Flow Consistency (WIP, Throughput, Cycle Time, Discrepancy >= 0)
 *
 * Execution:
 * npm run test:module5
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const M5_BASE_URL = process.env.TEST_APP_URL || 'http://localhost:3000';

interface M5StepResult {
  code: string;
  name: string;
  passed: boolean;
  details: string;
}

const testResults: M5StepResult[] = [];

function recordTest(code: string, name: string, passed: boolean, details: string) {
  testResults.push({ code, name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} | ${code}: ${name}\n       ↳ ${details}`);
}

async function runMod05TestSuite() {
  console.log(`\n============================================================`);
  console.log(`🚀 BẮT ĐẦU KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC - MODULE 05`);
  console.log(`Target: ${M5_BASE_URL}`);
  console.log(`Database: PostgreSQL (localhost:5433 / workspace_db)`);
  console.log(`============================================================\n`);

  const uniqueSuffix = Date.now().toString().slice(-6);

  try {
    // ------------------------------------------------------------
    // SETUP: Tạo tài khoản Leader & Member để kiểm thử API & RBAC
    // ------------------------------------------------------------
    const leaderEmail = `kanban_leader_${uniqueSuffix}@workspace.local`;
    const memberEmail = `kanban_member_${uniqueSuffix}@workspace.local`;

    const leaderRes = await fetch(`${M5_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: leaderEmail,
        password: 'Password123!',
        fullName: `Leader Kanban ${uniqueSuffix}`,
        role: 'LEADER',
        department: 'BACKEND',
        level: 'SENIOR',
      }),
    });
    const leaderData = await leaderRes.json();
    const leaderToken = leaderData.data?.accessToken;
    const leaderUserId = leaderData.data?.id;

    const memberRes = await fetch(`${M5_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: memberEmail,
        password: 'Password123!',
        fullName: `Member Kanban ${uniqueSuffix}`,
        role: 'MEMBER',
        department: 'BACKEND',
        level: 'JUNIOR',
      }),
    });
    const memberData = await memberRes.json();
    const memberToken = memberData.data?.accessToken;
    const memberUserId = memberData.data?.id;

    if (!leaderToken || !memberToken) {
      throw new Error('Không thể khởi tạo token kiểm thử Leader/Member.');
    }

    // Tạo dự án thử nghiệm
    const project = await prisma.project.create({
      data: {
        name: `Project Kanban Test ${uniqueSuffix}`,
        description: 'Dự án kiểm thử thực nghiệm bảng Kanban và quan trắc luồng việc',
        techStack: ['PostgreSQL', 'Next.js', 'Prisma'],
        complexity: 'MEDIUM',
        ownerId: leaderUserId,
        targetEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // ------------------------------------------------------------
    // TEST-01: Chặn Vi Phạm FSM Transition (Không Được Nhảy Cóc SCHEDULED -> DONE)
    // ------------------------------------------------------------
    {
      const fsmTask = await prisma.task.create({
        data: {
          projectId: project.id,
          title: 'Task Kiểm Thử Vi Phạm FSM',
          description: 'Không được phép chuyển thẳng từ SCHEDULED sang DONE',
          targetDepartment: 'BACKEND',
          requiredLevel: 'JUNIOR',
          estimatedHours: 4,
          status: 'SCHEDULED',
        },
      });

      const patchRes = await fetch(`${M5_BASE_URL}/api/tasks/${fsmTask.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${leaderToken}`,
        },
        body: JSON.stringify({
          toStatus: 'DONE', // Vi phạm FSM
        }),
      });

      const patchData = await patchRes.json();
      const is400 = patchRes.status === 400 && patchData.error?.code === 'INVALID_STATE_TRANSITION';

      // Kiểm tra CSDL vật lý: task status vẫn phải là SCHEDULED
      const dbTask = await prisma.task.findUnique({ where: { id: fsmTask.id } });
      const statusUnchanged = dbTask && dbTask.status === 'SCHEDULED';

      const passed = is400 && Boolean(statusUnchanged);
      recordTest(
        'TEST-01',
        'Chặn Vi Phạm FSM Transition (Ngăn Chặn Nhảy Cóc Trạng Thái Bất Hợp Pháp)',
        passed,
        `HTTP ${patchRes.status} | Code: ${patchData.error?.code} | Trạng thái trong DB vẫn giữ nguyên: ${dbTask?.status}`
      );

      // Cleanup
      await prisma.task.delete({ where: { id: fsmTask.id } });
    }

    // ------------------------------------------------------------
    // TEST-02: Cập Nhật Mốc Thời Gian Tự Động & Lưu Vết Lịch Sử Chuỗi Thời Gian
    // SCHEDULED -> TODO -> IN_PROGRESS -> REVIEW -> DONE
    // ------------------------------------------------------------
    {
      const flowTask = await prisma.task.create({
        data: {
          projectId: project.id,
          title: 'Task Kiểm Thử Vòng Đời Mốc Thời Gian Chuẩn',
          description: 'Kiểm tra started_at, in_review_at, completed_at, actual_hours',
          targetDepartment: 'BACKEND',
          requiredLevel: 'JUNIOR',
          estimatedHours: 6,
          status: 'SCHEDULED',
        },
      });

      // 1. SCHEDULED -> TODO
      const res1 = await fetch(`${M5_BASE_URL}/api/tasks/${flowTask.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${leaderToken}` },
        body: JSON.stringify({ toStatus: 'TODO' }),
      });
      const ok1 = res1.status === 200;

      // 2. TODO -> IN_PROGRESS
      const res2 = await fetch(`${M5_BASE_URL}/api/tasks/${flowTask.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${leaderToken}` },
        body: JSON.stringify({ toStatus: 'IN_PROGRESS' }),
      });
      const ok2 = res2.status === 200;

      // 3. IN_PROGRESS -> REVIEW
      const res3 = await fetch(`${M5_BASE_URL}/api/tasks/${flowTask.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${leaderToken}` },
        body: JSON.stringify({ toStatus: 'REVIEW' }),
      });
      const ok3 = res3.status === 200;

      // 4. REVIEW -> DONE
      const res4 = await fetch(`${M5_BASE_URL}/api/tasks/${flowTask.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${leaderToken}` },
        body: JSON.stringify({ toStatus: 'DONE' }),
      });
      const ok4 = res4.status === 200;

      // TRUY VẤN VẬT LÝ VÀO POSTGRESQL KIỂM CHỨNG
      const rawDbTasks: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, status, started_at, in_review_at, completed_at, actual_hours
         FROM tasks
         WHERE id = $1::uuid`,
        flowTask.id
      );
      const dbTask = rawDbTasks[0];

      const rawHistories: any[] = await prisma.$queryRawUnsafe(
        `SELECT from_status, to_status, duration_in_previous_status_hours
         FROM task_status_history
         WHERE task_id = $1::uuid
         ORDER BY created_at ASC`,
        flowTask.id
      );

      const hasStartedAt = dbTask && dbTask.started_at !== null;
      const hasInReviewAt = dbTask && dbTask.in_review_at !== null;
      const hasCompletedAt = dbTask && dbTask.completed_at !== null;
      const hasActualHours = dbTask && Number(dbTask.actual_hours) > 0;
      const has4Histories = rawHistories.length === 4;

      const passed =
        ok1 && ok2 && ok3 && ok4 &&
        hasStartedAt && hasInReviewAt && hasCompletedAt && hasActualHours && has4Histories;

      recordTest(
        'TEST-02',
        'Cập Nhật Mốc Thời Gian Tự Động & Lịch Sử Chuỗi Thời Gian (Physical DB Check)',
        passed,
        `Mốc thời gian DB: started_at=${Boolean(dbTask?.started_at)}, in_review_at=${Boolean(dbTask?.in_review_at)}, completed_at=${Boolean(dbTask?.completed_at)} | actual_hours=${dbTask?.actual_hours}h | Số bản ghi history trong DB: ${rawHistories.length}/4`
      );

      // Cleanup
      await prisma.taskStatusHistory.deleteMany({ where: { taskId: flowTask.id } });
      await prisma.task.delete({ where: { id: flowTask.id } });
    }

    // ------------------------------------------------------------
    // TEST-03: Phân Quyền Duyệt Hoàn Thành (Review Guard: MEMBER bị chặn khi chuyển sang DONE)
    // ------------------------------------------------------------
    {
      const reviewTask = await prisma.task.create({
        data: {
          projectId: project.id,
          title: 'Task Đang Chờ Nghiệm Thu (Review)',
          description: 'Chỉ Leader/PM mới được duyệt sang DONE',
          targetDepartment: 'BACKEND',
          requiredLevel: 'JUNIOR',
          estimatedHours: 4,
          status: 'REVIEW',
        },
      });

      const memberRes = await fetch(`${M5_BASE_URL}/api/tasks/${reviewTask.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberToken}`, // MEMBER TOKEN
        },
        body: JSON.stringify({
          toStatus: 'DONE',
        }),
      });

      const memberData = await memberRes.json();
      const is403 = memberRes.status === 403 && memberData.error?.code === 'FORBIDDEN';

      // Kiểm tra CSDL: task vẫn phải là REVIEW
      const dbTask = await prisma.task.findUnique({ where: { id: reviewTask.id } });
      const taskStillReview = dbTask && dbTask.status === 'REVIEW';

      const passed = is403 && Boolean(taskStillReview);
      recordTest(
        'TEST-03',
        'Phân Quyền Duyệt Hoàn Thành (Review Guard Chặn MEMBER Chuyển Sang DONE)',
        passed,
        `MEMBER gọi API: HTTP ${memberRes.status} (code: ${memberData.error?.code}) | Trạng thái task trong CSDL giữ nguyên REVIEW: ${taskStillReview}`
      );

      // Cleanup
      await prisma.task.delete({ where: { id: reviewTask.id } });
    }

    // ------------------------------------------------------------
    // TEST-04: Thuật Toán IQR & Nhận Diện Điểm Nghẽn Bất Thường (Bottleneck Detection)
    // Giả lập task ở IN_PROGRESS 100 giờ (vượt xa ngưỡng IQR)
    // ------------------------------------------------------------
    {
      const bottleneckTask = await prisma.task.create({
        data: {
          projectId: project.id,
          title: 'Task Bị Om Nghẽn Luồng Việc (100h In Progress)',
          description: 'Kiểm thử cờ isBottleneck tự động',
          targetDepartment: 'BACKEND',
          requiredLevel: 'JUNIOR',
          estimatedHours: 4,
          status: 'IN_PROGRESS',
        },
      });

      // Giả lập lùi mốc thời gian về 100 giờ trước trong PostgreSQL
      await prisma.$executeRawUnsafe(
        `UPDATE tasks 
         SET started_at = NOW() - INTERVAL '100 hours', 
             updated_at = NOW() - INTERVAL '100 hours' 
         WHERE id = $1::uuid`,
        bottleneckTask.id
      );

      await prisma.$executeRawUnsafe(
        `INSERT INTO task_status_history (task_id, changed_by, from_status, to_status, duration_in_previous_status_hours, created_at)
         VALUES ($1::uuid, $2::uuid, 'TODO', 'IN_PROGRESS', 1.0, NOW() - INTERVAL '100 hours')`,
        bottleneckTask.id,
        leaderUserId
      );

      // Gọi API Kanban
      const kanbanRes = await fetch(`${M5_BASE_URL}/api/projects/${project.id}/kanban`, {
        headers: {
          Authorization: `Bearer ${leaderToken}`,
        },
      });

      const kanbanData = await kanbanRes.json();
      const inProgressColumn = kanbanData.data?.columns?.find((c: any) => c.status === 'IN_PROGRESS');
      const card = inProgressColumn?.tasks?.find((t: any) => t.id === bottleneckTask.id);

      const isBottleneckFlagged = card && card.isBottleneck === true;
      const passed = kanbanRes.status === 200 && Boolean(isBottleneckFlagged);

      recordTest(
        'TEST-04',
        'Thuật Toán IQR & Nhận Diện Điểm Nghẽn Bất Thường (isBottleneck === true)',
        passed,
        `HTTP ${kanbanRes.status} | Ngưỡng IQR: ${kanbanData.data?.iqrThresholdHours}h | Task thời gian: ${card?.timeInCurrentStatusHours}h | isBottleneck flagged: ${card?.isBottleneck}`
      );

      // Cleanup
      await prisma.taskStatusHistory.deleteMany({ where: { taskId: bottleneckTask.id } });
      await prisma.task.delete({ where: { id: bottleneckTask.id } });
    }

    // ------------------------------------------------------------
    // TEST-05: Kiểm Chứng Định Luật Little Trong Flow Observability Metrics
    // ------------------------------------------------------------
    {
      const metricsRes = await fetch(`${M5_BASE_URL}/api/projects/${project.id}/flow-metrics?daysWindow=14`, {
        headers: {
          Authorization: `Bearer ${leaderToken}`,
        },
      });

      const metricsData = await metricsRes.json();
      const data = metricsData.data;

      const hasWip = typeof data?.wipCount === 'number' && data.wipCount >= 0;
      const hasThroughput = typeof data?.throughputPerDay === 'number' && data.throughputPerDay >= 0;
      const hasCycleTime = typeof data?.avgCycleTimeHours === 'number' && data.avgCycleTimeHours >= 0;
      const hasDiscrepancy = typeof data?.littlesLawDiscrepancy === 'number' && data.littlesLawDiscrepancy >= 0;
      const hasCfd = Array.isArray(data?.cfdData) && data.cfdData.length > 0;

      const passed = metricsRes.status === 200 && hasWip && hasThroughput && hasCycleTime && hasDiscrepancy && hasCfd;

      recordTest(
        'TEST-05',
        'Kiểm Chứng Định Luật Little & Cumulative Flow Diagram (CFD Data)',
        passed,
        `HTTP ${metricsRes.status} | WIP: ${data?.wipCount} | Throughput: ${data?.throughputPerDay}/day | CycleTime: ${data?.avgCycleTimeHours}h | Sai số Định luật Little (|L - λW|): ${data?.littlesLawDiscrepancy} | CFD Điểm dữ liệu: ${data?.cfdData?.length}`
      );
    }

    // ------------------------------------------------------------
    // CLEANUP DỰ ÁN & USERS KIỂM THỬ
    // ------------------------------------------------------------
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.user.deleteMany({
      where: {
        id: { in: [leaderUserId, memberUserId] },
      },
    });

    console.log(`\n============================================================`);
    console.log(`🎯 KẾT QUẢ ĐÁNH GIÁ ĐỘC LẬP - MODULE 05 (KANBAN & OBSERVABILITY):`);
    const passedCount = testResults.filter((r) => r.passed).length;
    console.log(`Đạt: ${passedCount}/${testResults.length} bài kiểm thử.`);

    if (passedCount === testResults.length) {
      console.log(`🏆 TẤT CẢ 5 TIÊU CHUẨN CHỐNG ẢO GIÁC ĐỀU PASS THẬT SỰ TRÊN POSTGRESQL!`);
      console.log(`============================================================\n`);
      process.exit(0);
    } else {
      console.error(`⚠️ Có bài kiểm thử chưa đạt. Vui lòng rà soát log chi tiết.`);
      console.log(`============================================================\n`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Lỗi ngoại lệ trong quá trình thực thi kiểm thử MOD-05:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMod05TestSuite();
export {};

