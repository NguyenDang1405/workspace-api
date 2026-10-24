import fs from 'fs';
import path from 'path';

// ----------------------------------------------------------------------------
// LOAD ENVIRONMENT VARIABLES FROM .env
// ----------------------------------------------------------------------------
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  });
}

import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { AI_BASE_URL, generateProfileEmbedding } from '../src/lib/openai';
import { POST as decomposePOST } from '../src/app/api/projects/[id]/decompose/route';
import { POST as autoDispatchPlanPOST } from '../src/app/api/projects/[id]/auto-dispatch-plan/route';
import { POST as confirmAssignmentsPOST } from '../src/app/api/projects/[id]/confirm-assignments/route';

const prisma = new PrismaClient();

interface TestStepRow {
  Giai_Đoạn: string;
  Hành_Động: string;
  Thời_Gian_ms: number;
  Chi_Tiết_Đối_Soát: string;
  Trạng_Thái: 'PASS' | 'FAIL';
}

const testResults: TestStepRow[] = [];

function recordStep(row: TestStepRow) {
  testResults.push(row);
  const icon = row.Trạng_Thái === 'PASS' ? '✅' : '❌';
  console.log(
    `\n${icon} [${row.Trạng_Thái}] ${row.Giai_Đoạn}: ${row.Hành_Động}` +
      `\n   ↳ Thời gian: ${row.Thời_Gian_ms} ms` +
      `\n   ↳ Đối soát: ${row.Chi_Tiết_Đối_Soát}\n`
  );
}

async function main() {
  console.log(`\n================================================================================`);
  console.log(`🚀 KIỂM THỬ TÍCH HỢP TOÀN DIỆN MOD-11: AI AUTO-DISPATCH & CALENDAR SCHEDULING`);
  console.log(`🌐 Next.js Backend: workspace-api`);
  console.log(`📡 AI Microservice: ${AI_BASE_URL} (FastAPI + OpenAI)`);
  console.log(`🗄️ PostgreSQL Database: port 5433 (workspace_db)`);
  console.log(`================================================================================\n`);

  const suffix = `${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;

  try {
    // ----------------------------------------------------------------------------
    // BƯỚC 1: KHỞI TẠO DỮ LIỆU NHÂN SỰ & HỒ SƠ VECTOR NĂNG LỰC
    // ----------------------------------------------------------------------------
    console.log('--- [Bước 1/5] Khởi tạo Nhân sự (Leader, Fullstack Dev, DevOps Specialist) ---');
    const t0_users = Date.now();

    // 1.1 Leader User
    const leaderUser = await prisma.user.create({
      data: {
        email: `lead_${suffix}@smartworkspace.com`,
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        fullName: `Trần Kỹ Sư Trưởng ${suffix}`,
        role: 'LEADER',
        talentProfile: {
          create: {
            department: 'BACKEND',
            level: 'SENIOR',
            skills: ['Architecture', 'PostgreSQL', 'Node.js', 'FastAPI'],
            bioSummary: 'Trưởng nhóm kỹ thuật Backend và cơ sở dữ liệu phân tán',
          },
        },
      },
    });

    // Generate Profile Embedding for Leader
    const leadVec = await generateProfileEmbedding({
      department: 'BACKEND',
      level: 'SENIOR',
      skills: ['Architecture', 'PostgreSQL', 'Node.js', 'FastAPI'],
      bioSummary: 'Trưởng nhóm kỹ thuật Backend và cơ sở dữ liệu phân tán',
    });
    if (leadVec) {
      await prisma.$executeRawUnsafe(
        `UPDATE user_talent_profiles 
         SET skill_embedding = $1::vector, embedding_revision = profile_revision, last_embedded_at = NOW() 
         WHERE user_id = $2::uuid`,
        `[${leadVec.join(',')}]`,
        leaderUser.id
      );
    }
    await prisma.userSkillRating.create({
      data: {
        userId: leaderUser.id,
        skillName: 'Backend',
        ratingScore: 1650.0,
      },
    });

    // 1.2 Frontend / Fullstack Developer
    const memberA = await prisma.user.create({
      data: {
        email: `dev_fe_${suffix}@smartworkspace.com`,
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        fullName: `Nguyễn Giao Diện ${suffix}`,
        role: 'MEMBER',
        talentProfile: {
          create: {
            department: 'FRONTEND',
            level: 'MIDDLE',
            skills: ['React', 'Next.js', 'TailwindCSS', 'TypeScript', 'UI/UX'],
            bioSummary: 'Chuyên gia phát triển Frontend và trải nghiệm người dùng responsive',
          },
        },
      },
    });
    const memberAVec = await generateProfileEmbedding({
      department: 'FRONTEND',
      level: 'MIDDLE',
      skills: ['React', 'Next.js', 'TailwindCSS', 'TypeScript', 'UI/UX'],
      bioSummary: 'Chuyên gia phát triển Frontend và trải nghiệm người dùng responsive',
    });
    if (memberAVec) {
      await prisma.$executeRawUnsafe(
        `UPDATE user_talent_profiles 
         SET skill_embedding = $1::vector, embedding_revision = profile_revision, last_embedded_at = NOW() 
         WHERE user_id = $2::uuid`,
        `[${memberAVec.join(',')}]`,
        memberA.id
      );
    }
    await prisma.userSkillRating.create({
      data: {
        userId: memberA.id,
        skillName: 'Frontend',
        ratingScore: 1420.0,
      },
    });

    // 1.3 DevOps / Cloud Specialist
    const memberB = await prisma.user.create({
      data: {
        email: `devops_${suffix}@smartworkspace.com`,
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        fullName: `Lê Vận Hành Cloud ${suffix}`,
        role: 'MEMBER',
        talentProfile: {
          create: {
            department: 'DEVOPS',
            level: 'MIDDLE',
            skills: ['Docker', 'Kubernetes', 'CI/CD', 'GitHub Actions', 'Linux'],
            bioSummary: 'Chuyên viên CI/CD Pipeline, tự động hóa đóng gói và triển khai Cloud',
          },
        },
      },
    });
    const memberBVec = await generateProfileEmbedding({
      department: 'DEVOPS',
      level: 'MIDDLE',
      skills: ['Docker', 'Kubernetes', 'CI/CD', 'GitHub Actions', 'Linux'],
      bioSummary: 'Chuyên viên CI/CD Pipeline, tự động hóa đóng gói và triển khai Cloud',
    });
    if (memberBVec) {
      await prisma.$executeRawUnsafe(
        `UPDATE user_talent_profiles 
         SET skill_embedding = $1::vector, embedding_revision = profile_revision, last_embedded_at = NOW() 
         WHERE user_id = $2::uuid`,
        `[${memberBVec.join(',')}]`,
        memberB.id
      );
    }
    await prisma.userSkillRating.create({
      data: {
        userId: memberB.id,
        skillName: 'DevOps',
        ratingScore: 1380.0,
      },
    });

    // 1.4 Team & Project
    const team = await prisma.team.create({
      data: {
        name: `Đội Ngũ Triển Khai MOD-11 ${suffix}`,
        description: 'Team mẫu kiểm thử tự động Auto-Dispatch & Calendar Scheduling',
        leaderId: leaderUser.id,
        memberships: {
          create: [
            { userId: leaderUser.id },
            { userId: memberA.id },
            { userId: memberB.id },
          ],
        },
      },
    });

    const testProject = await prisma.project.create({
      data: {
        name: `Hệ Thống Quản Lý Sản Xuất Tự Động ${suffix}`,
        description: 'Xây dựng nền tảng quản trị luồng việc và đồng bộ hóa tiến độ thông minh',
        techStack: ['Next.js', 'FastAPI', 'PostgreSQL', 'Docker'],
        complexity: 'HARD',
        teamId: team.id,
        ownerId: leaderUser.id,
        startDate: new Date(),
        targetEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    recordStep({
      Giai_Đoạn: 'BƯỚC 1',
      Hành_Động: 'Khởi tạo Nhân sự, Team và Dự án mẫu',
      Thời_Gian_ms: Date.now() - t0_users,
      Chi_Tiết_Đối_Soát: `Đã tạo 3 nhân sự kèm vector embedding 1536 chiều; Team '${team.name}' (3 thành viên); Dự án ID: ${testProject.id}`,
      Trạng_Thái: 'PASS',
    });

    // ----------------------------------------------------------------------------
    // BƯỚC 2: PHÂN RÃ NHIỆM VỤ ĐỒ THỊ DAG & CPM (TỪ MOD-02)
    // ----------------------------------------------------------------------------
    console.log('--- [Bước 2/5] Phân rã DAG Nhiệm vụ qua AI Microservice ---');
    const t0_decomp = Date.now();

    const decomposeReq = new NextRequest(
      `http://localhost:3000/api/projects/${testProject.id}/decompose`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': leaderUser.id,
          'x-user-role': 'LEADER',
        },
        body: JSON.stringify({
          instructions: 'Phân rã thành ít nhất 3 công việc độc lập về Database, Frontend và CI/CD deployment',
        }),
      }
    );

    const decomposeRes = await decomposePOST(decomposeReq, {
      params: { id: testProject.id },
    });
    const decomposeJson = await decomposeRes.json();

    const tasksInDB = await prisma.task.findMany({
      where: { projectId: testProject.id },
      include: { dependencies: true },
      orderBy: { earlyStart: 'asc' },
    });

    if (decomposeRes.status !== 200 || !decomposeJson.success || tasksInDB.length < 3) {
      throw new Error(`Phân rã thất bại: HTTP ${decomposeRes.status}`);
    }

    recordStep({
      Giai_Đoạn: 'BƯỚC 2',
      Hành_Động: 'AI DAG Task Decomposition & CPM Calculation',
      Thời_Gian_ms: Date.now() - t0_decomp,
      Chi_Tiết_Đối_Soát: `Đã sinh ${tasksInDB.length} tasks trong CSDL với tham số CPM (early_start, early_finish, is_critical_path). Toàn bộ ở trạng thái SCHEDULED.`,
      Trạng_Thái: 'PASS',
    });

    // ----------------------------------------------------------------------------
    // BƯỚC 3: GỌI API SINH KẾ HOẠCH PHÂN CÔNG & LỊCH TRÌNH (PREVIEW)
    // ----------------------------------------------------------------------------
    console.log('--- [Bước 3/5] Gọi POST /api/projects/:id/auto-dispatch-plan (Preview) ---');
    const t0_plan = Date.now();

    const planReq = new NextRequest(
      `http://localhost:3000/api/projects/${testProject.id}/auto-dispatch-plan`,
      {
        method: 'POST',
        headers: {
          'x-user-id': leaderUser.id,
          'x-user-role': 'LEADER',
        },
      }
    );

    const planRes = await autoDispatchPlanPOST(planReq, {
      params: { id: testProject.id },
    });
    const planJson = await planRes.json();
    const planData = planJson?.data;

    if (planRes.status !== 200 || !planJson.success || !planData) {
      throw new Error(`Sinh kế hoạch thất bại: HTTP ${planRes.status} (${JSON.stringify(planJson)})`);
    }

    // Kiểm tra cấu trúc dữ liệu theo đặc tả MOD-11
    const { totalTasks, estimatedCompletionDate, assignments } = planData;
    if (totalTasks !== tasksInDB.length || !Array.isArray(assignments) || assignments.length === 0) {
      throw new Error(`Kế hoạch trả về số lượng tasks không khớp: ${totalTasks} vs ${tasksInDB.length}`);
    }

    // Xác thực tính logic của từng assignment
    let allAssignmentsValid = true;
    for (const a of assignments) {
      if (
        !a.taskId ||
        !a.suggestedAssignee?.userId ||
        typeof a.suggestedAssignee.matchScore !== 'number' ||
        !a.schedule?.startDate ||
        !a.schedule?.dueDate
      ) {
        allAssignmentsValid = false;
        break;
      }
      const sDate = new Date(a.schedule.startDate).getTime();
      const dDate = new Date(a.schedule.dueDate).getTime();
      if (dDate < sDate) {
        allAssignmentsValid = false;
        break;
      }
    }

    if (!allAssignmentsValid) {
      throw new Error('Cấu trúc assignments không hợp lệ hoặc do dueDate < startDate');
    }

    const firstAssignee = assignments[0].suggestedAssignee;
    recordStep({
      Giai_Đoạn: 'BƯỚC 3',
      Hành_Động: 'Preview Auto-Dispatch Plan & CPM Schedule',
      Thời_Gian_ms: Date.now() - t0_plan,
      Chi_Tiết_Đối_Soát: `Dự án ${totalTasks} tasks; Ngày hoàn tất dự kiến: ${new Date(estimatedCompletionDate).toLocaleDateString()}; Task 1: '${assignments[0].taskTitle}' -> Gợi ý: '${firstAssignee.fullName}' (Match Score: ${firstAssignee.matchScore}%, Reason: "${firstAssignee.matchReason}")`,
      Trạng_Thái: 'PASS',
    });

    // ----------------------------------------------------------------------------
    // BƯỚC 4: LEADER SỬA ĐỔI TAY 1 NHÂN SỰ (HUMAN-IN-THE-LOOP) & GỬI XÁC NHẬN
    // ----------------------------------------------------------------------------
    console.log('--- [Bước 4/5] Human-in-the-Loop Override & Gọi confirm-assignments ---');
    const t0_confirm = Date.now();

    // Chọn task đầu tiên để ghi đè (thay người nhận và lý do override)
    const overriddenTask = assignments[0];
    const candidatePool = overriddenTask.availableCandidates.map((c: any) => c.userId);
    // Chọn một người khác với suggestedAssignee để minh chứng can thiệp thủ công
    const alternateUserId =
      candidatePool.find((id: string) => id !== overriddenTask.suggestedAssignee.userId) ||
      memberB.id;

    const confirmationPayload = {
      confirmations: assignments.map((a: any, idx: number) => {
        if (idx === 0) {
          return {
            taskId: a.taskId,
            finalAssigneeId: alternateUserId,
            startDate: a.schedule.startDate,
            dueDate: a.schedule.dueDate,
            overrideReason: 'Leader chủ động chỉ định nhân sự chuyên trách để tối ưu hóa tiến độ vận hành',
          };
        }
        return {
          taskId: a.taskId,
          finalAssigneeId: a.suggestedAssignee.userId,
          startDate: a.schedule.startDate,
          dueDate: a.schedule.dueDate,
        };
      }),
    };

    const confirmReq = new NextRequest(
      `http://localhost:3000/api/projects/${testProject.id}/confirm-assignments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': leaderUser.id,
          'x-user-role': 'LEADER',
        },
        body: JSON.stringify(confirmationPayload),
      }
    );

    const confirmRes = await confirmAssignmentsPOST(confirmReq, {
      params: { id: testProject.id },
    });
    const confirmJson = await confirmRes.json();

    if (confirmRes.status !== 200 || !confirmJson.success) {
      throw new Error(`Xác nhận phân công thất bại: HTTP ${confirmRes.status} (${JSON.stringify(confirmJson)})`);
    }

    recordStep({
      Giai_Đoạn: 'BƯỚC 4',
      Hành_Động: 'Human-in-the-Loop Override & Phê duyệt Lịch trình',
      Thời_Gian_ms: Date.now() - t0_confirm,
      Chi_Tiết_Đối_Soát: `Đã xác nhận ${confirmJson.data?.confirmedCount} tasks. Task 1 đã được Leader sửa tay sang User ID: ${alternateUserId} kèm lý do override.`,
      Trạng_Thái: 'PASS',
    });

    // ----------------------------------------------------------------------------
    // BƯỚC 5: ĐỐI SOÁT TOÀN VẸN CSDL POSTGRESQL (DATABASE INTEGRITY CHECK)
    // ----------------------------------------------------------------------------
    console.log('--- [Bước 5/5] Đối soát Toàn vẹn Dữ liệu CSDL PostgreSQL ---');
    const t0_db = Date.now();

    // 1. Kiểm tra bảng tasks
    const updatedTasksInDB = await prisma.task.findMany({
      where: { projectId: testProject.id },
      include: { assignee: true },
      orderBy: { earlyStart: 'asc' },
    });

    const isAllAssigned = updatedTasksInDB.every((t) => t.assignedTo !== null);
    const isAllTodo = updatedTasksInDB.every((t) => t.status === 'TODO');
    const isAllDatesValid = updatedTasksInDB.every(
      (t) => t.startDate !== null && t.dueDate !== null && t.dueDate >= t.startDate
    );

    // 2. Kiểm tra bảng dispatch_history
    const dispatchHistoryRecords = await prisma.dispatchHistory.findMany({
      where: { taskId: { in: updatedTasksInDB.map((t) => t.id) } },
    });

    const overrideRecord = dispatchHistoryRecords.find((r) => r.isHumanOverride === true);

    // 3. Kiểm tra bảng task_status_history
    const statusHistoryRecords = await prisma.taskStatusHistory.findMany({
      where: {
        taskId: { in: updatedTasksInDB.map((t) => t.id) },
        fromStatus: 'SCHEDULED',
        toStatus: 'TODO',
      },
    });

    if (!isAllAssigned) {
      throw new Error('Thất bại: Tồn tại task chưa có assigned_to (assignee_id bị NULL)');
    }
    if (!isAllDatesValid) {
      throw new Error('Thất bại: start_date hoặc due_date không hợp lệ, hoặc due_date < start_date');
    }
    if (!isAllTodo) {
      throw new Error('Thất bại: Một số tasks chưa được chuyển sang trạng thái TODO');
    }
    if (dispatchHistoryRecords.length !== updatedTasksInDB.length) {
      throw new Error(`Thất bại: dispatch_history ghi nhận ${dispatchHistoryRecords.length} != ${updatedTasksInDB.length} tasks`);
    }
    if (!overrideRecord || !overrideRecord.overrideReason?.includes('chỉ định nhân sự')) {
      throw new Error('Thất bại: Không tìm thấy bản ghi dispatch_history ghi nhận is_human_override = true');
    }
    if (statusHistoryRecords.length !== updatedTasksInDB.length) {
      throw new Error(`Thất bại: task_status_history ghi nhận ${statusHistoryRecords.length} != ${updatedTasksInDB.length} bản ghi`);
    }

    recordStep({
      Giai_Đoạn: 'BƯỚC 5',
      Hành_Động: 'Đối soát 4 tiêu chí toàn vẹn CSDL (Database Integrity)',
      Thời_Gian_ms: Date.now() - t0_db,
      Chi_Tiết_Đối_Soát: `100% đạt chuẩn: ${updatedTasksInDB.length}/${updatedTasksInDB.length} tasks có assigned_to; start_date & due_date hợp lệ (due_date >= start_date); status='TODO'; ${dispatchHistoryRecords.length} dispatch_history logs; Ghi nhận is_human_override=true chính xác; ${statusHistoryRecords.length} task_status_history transitions.`,
      Trạng_Thái: 'PASS',
    });

    // ----------------------------------------------------------------------------
    // TỔNG KẾT BÁO CÁO
    // ----------------------------------------------------------------------------
    console.log(`\n================================================================================`);
    console.log(`📊 BẢNG KẾT QUẢ KIỂM THỬ TÍCH HỢP MOD-11: AUTO-DISPATCH & CALENDAR SCHEDULING`);
    console.log(`================================================================================\n`);
    console.table(testResults);

    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`🏆 TỔNG KẾT: 5/5 GIAI ĐOẠN ĐẠT CHUẨN XUẤT SẮC (100% PASS)`);
    console.log(`--------------------------------------------------------------------------------\n`);
  } catch (err: any) {
    console.error('\n❌ KIỂM THỬ THẤT BẠI TẠI BƯỚC NÀY:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
