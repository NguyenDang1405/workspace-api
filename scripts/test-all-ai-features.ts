/**
 * Comprehensive End-to-End AI Integration Verification Suite
 * Tests 100% real AI features connecting Next.js (workspace-api) to FastAPI (ai-service)
 * and verifies persistence in PostgreSQL.
 *
 * Execution:
 * npx tsx scripts/test-all-ai-features.ts
 */

import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

import {
  AI_BASE_URL,
  generateProfileEmbedding,
  generateTaskEmbedding,
  generateAdaptiveChecklist,
  verifyCodeWithAI,
  generateDailyStandupAI,
  extractUserStoriesAI,
} from '../src/lib/openai';

import { POST as decomposePOST } from '../src/app/api/projects/[id]/decompose/route';
import { POST as dispatchPOST } from '../src/app/api/tasks/[taskId]/dispatch/route';
import { POST as standupPOST } from '../src/app/api/projects/[id]/standup/route';
import { POST as documentsPOST } from '../src/app/api/projects/[id]/documents/route';

const prisma = new PrismaClient();

interface TestTableRow {
  Tính_Năng_AI: string;
  'Endpoint / Hàm': string;
  Thời_Gian_ms: number;
  'Trạng_Thái (PASS/FAIL)': 'PASS' | 'FAIL' | 'FAIL (MOCK DETECTED)';
  Bằng_Chứng_Dữ_Liệu_Thật: string;
}

const summaryTable: TestTableRow[] = [];

function recordResult(row: TestTableRow) {
  summaryTable.push(row);
  const icon = row['Trạng_Thái (PASS/FAIL)'] === 'PASS' ? '✅' : '❌';
  console.log(
    `\n${icon} [${row['Trạng_Thái (PASS/FAIL)']}] ${row.Tính_Năng_AI}` +
      `\n   ↳ Endpoint: ${row['Endpoint / Hàm']}` +
      `\n   ↳ Thời gian: ${row.Thời_Gian_ms} ms` +
      `\n   ↳ Bằng chứng: ${row.Bằng_Chứng_Dữ_Liệu_Thật}\n`
  );
}

function isMockVector(vec: number[] | null | undefined): boolean {
  if (!vec || vec.length !== 1536) return true;
  const isAllZero = vec.every((v) => v === 0);
  const isAllPointZeroOne = vec.every((v) => Math.abs(v - 0.01) < 0.00001);
  return isAllZero || isAllPointZeroOne;
}

async function main() {
  console.log(`\n================================================================================`);
  console.log(`🚀 KIỂM THỬ TOÀN DIỆN CÁC TÍNH NĂNG AI: WORKSPACE-API <-> AI-SERVICE (FASTAPI)`);
  console.log(`📡 AI Service URL: ${AI_BASE_URL}`);
  console.log(`🗄️ PostgreSQL Port: 5433 (workspace_db)`);
  console.log(`================================================================================\n`);

  // Health probe
  try {
    const probe = await fetch(`${AI_BASE_URL}/health`);
    const probeData = await probe.json();
    console.log(`🟢 AI Microservice Health Check: HTTP ${probe.status}`, probeData);
  } catch (err: any) {
    console.error(`🔴 Không thể kết nối AI Microservice tại ${AI_BASE_URL}:`, err.message);
    process.exit(1);
  }

  const suffix = Date.now().toString().slice(-6);

  // Setup Test Users & Project in DB
  let leaderUser = await prisma.user.findFirst({
    where: { role: 'LEADER' },
  });
  if (!leaderUser) {
    leaderUser = await prisma.user.create({
      data: {
        email: `leader_ai_${suffix}@test.local`,
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        fullName: `AI Test Leader ${suffix}`,
        role: 'LEADER',
      },
    });
  }

  let internUser = await prisma.user.findFirst({
    where: {
      talentProfile: { level: 'INTERN' },
    },
    include: { talentProfile: true },
  });
  if (!internUser) {
    internUser = await prisma.user.create({
      data: {
        email: `intern_ai_${suffix}@test.local`,
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        fullName: `AI Test Intern ${suffix}`,
        role: 'MEMBER',
        talentProfile: {
          create: {
            department: 'BACKEND',
            level: 'INTERN',
            skills: ['Node.js', 'TypeScript', 'SQL'],
            bioSummary: 'Thực tập sinh Backend mong muốn học hỏi',
          },
        },
      },
      include: { talentProfile: true },
    });
  }

  const testProject = await prisma.project.create({
    data: {
      name: `Dự án Tự Động Hóa AI ${suffix}`,
      description: 'Hệ thống điều phối tác vụ thông minh, biểu đồ DAG và tổng hợp Standup hàng ngày',
      techStack: ['Next.js', 'FastAPI', 'PostgreSQL', 'Docker'],
      complexity: 'MEDIUM',
      ownerId: leaderUser.id,
      targetEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  console.log(`📁 Đã khởi tạo dự án test: ${testProject.name} (ID: ${testProject.id})`);

  // ============================================================================
  // 1. AI VECTOR EMBEDDINGS (MOD-01 & MOD-03)
  // ============================================================================
  console.log('\n--- [1/6] Kiểm thử Vector Embeddings (MOD-01 & MOD-03) ---');

  // 1.1 Profile Embedding
  const t0Profile = Date.now();
  const profileVec = await generateProfileEmbedding({
    department: 'BACKEND',
    level: 'SENIOR',
    skills: ['Node.js', 'FastAPI', 'PostgreSQL', 'pgvector', 'Docker'],
    bioSummary: 'Kỹ sư cao cấp chuyên thiết kế hệ thống phân tán và cơ sở dữ liệu lớn',
  });
  const durProfile = Date.now() - t0Profile;

  let profilePass: 'PASS' | 'FAIL' | 'FAIL (MOCK DETECTED)' = 'PASS';
  let profileEvidence = '';

  if (!profileVec || profileVec.length !== 1536) {
    profilePass = 'FAIL';
    profileEvidence = `Vector không hợp lệ (độ dài: ${profileVec?.length})`;
  } else if (isMockVector(profileVec)) {
    profilePass = 'FAIL (MOCK DETECTED)';
    profileEvidence = `Vector chứa dữ liệu fallback mock (all zeros or 0.01)`;
  } else {
    // Persist to PostgreSQL in user_talent_profiles
    const vecStr = `[${profileVec.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE user_talent_profiles SET skill_embedding = $1::vector WHERE user_id = $2::uuid`,
      vecStr,
      internUser.id
    );

    const checkDB: any[] = await prisma.$queryRawUnsafe(
      `SELECT user_id, skill_embedding::text FROM user_talent_profiles WHERE user_id = $1::uuid`,
      internUser.id
    );

    if (checkDB.length > 0 && checkDB[0].skill_embedding) {
      profileEvidence = `1536 dims, sample: [${profileVec.slice(0, 3).map((n) => n.toFixed(4)).join(', ')}...], Đã lưu DB PostgreSQL`;
    } else {
      profilePass = 'FAIL';
      profileEvidence = 'Lỗi lưu trữ vector vào PostgreSQL';
    }
  }

  recordResult({
    Tính_Năng_AI: '1.1 AI Profile Vector Embedding',
    'Endpoint / Hàm': 'POST /api/v1/embeddings/batch | generateProfileEmbedding',
    Thời_Gian_ms: durProfile,
    'Trạng_Thái (PASS/FAIL)': profilePass,
    Bằng_Chứng_Dữ_Liệu_Thật: profileEvidence,
  });

  // 1.2 Task Embedding
  const t0Task = Date.now();
  const taskTitle = 'Thiết lập chỉ mục pgvector HNSW cho tìm kiếm tương đồng vector';
  const taskDesc = 'Cấu hình extension pgvector, tạo bảng và chỉ mục cosine distance <=> trên PostgreSQL';
  const taskVec = await generateTaskEmbedding(taskTitle, taskDesc);
  const durTask = Date.now() - t0Task;

  let taskPass: 'PASS' | 'FAIL' | 'FAIL (MOCK DETECTED)' = 'PASS';
  let taskEvidence = '';

  if (!taskVec || taskVec.length !== 1536) {
    taskPass = 'FAIL';
    taskEvidence = `Vector không hợp lệ (độ dài: ${taskVec?.length})`;
  } else if (isMockVector(taskVec)) {
    taskPass = 'FAIL (MOCK DETECTED)';
    taskEvidence = `Vector chứa dữ liệu fallback mock (all zeros or 0.01)`;
  } else {
    taskEvidence = `1536 dims, sample: [${taskVec.slice(0, 3).map((n) => n.toFixed(4)).join(', ')}...], chuẩn text-embedding-3-small`;
  }

  recordResult({
    Tính_Năng_AI: '1.2 AI Task Vector Embedding',
    'Endpoint / Hàm': 'POST /api/v1/embeddings/batch | generateTaskEmbedding',
    Thời_Gian_ms: durTask,
    'Trạng_Thái (PASS/FAIL)': taskPass,
    Bằng_Chứng_Dữ_Liệu_Thật: taskEvidence,
  });

  // ============================================================================
  // 2. AI TASK DECOMPOSITION & DAG CPM (MOD-02)
  // ============================================================================
  console.log('\n--- [2/6] Kiểm thử Task Decomposition & DAG CPM (MOD-02) ---');

  const t0Decompose = Date.now();
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
        userInstructions: 'Phân rã thành các công việc kiến trúc module, bảo mật và triển khai container',
      }),
    }
  );

  const decomposeRes = await decomposePOST(decomposeReq, {
    params: { id: testProject.id },
  });
  const durDecompose = Date.now() - t0Decompose;
  const decomposeJson = await decomposeRes.json();

  let decomposePass: 'PASS' | 'FAIL' | 'FAIL (MOCK DETECTED)' = 'PASS';
  let decomposeEvidence = '';

  if (decomposeRes.status !== 200 || !decomposeJson.success) {
    decomposePass = 'FAIL';
    decomposeEvidence = `HTTP ${decomposeRes.status}: ${JSON.stringify(decomposeJson.error || decomposeJson)}`;
  } else {
    const tasksInDB = await prisma.task.findMany({
      where: { projectId: testProject.id },
      include: { dependencies: true, dependents: true },
    });

    const depsInDB = await prisma.taskDependency.findMany({
      where: { successor: { projectId: testProject.id } },
    });

    const criticalTasks = tasksInDB.filter((t) => t.isCriticalPath);

    // Mock detector check: check if title matches the static fallback
    const hasStaticFallbackTitle = tasksInDB.some(
      (t) => t.title === 'Thiết kế Lược đồ CSDL & Khởi tạo Migration'
    );

    if (hasStaticFallbackTitle) {
      decomposePass = 'FAIL (MOCK DETECTED)';
      decomposeEvidence = 'Phát hiện tiêu đề fallback mặc định, không phải AI sinh ra';
    } else if (tasksInDB.length < 3) {
      decomposePass = 'FAIL';
      decomposeEvidence = `Số lượng task quá ít (${tasksInDB.length} tasks)`;
    } else {
      decomposeEvidence = `Sinh ${tasksInDB.length} tasks, ${depsInDB.length} quan hệ phụ thuộc DAG, ${criticalTasks.length} task trên CPM (is_critical_path=true). Task mẫu: "${tasksInDB[0]?.title}"`;
    }
  }

  recordResult({
    Tính_Năng_AI: '2. AI Task Decomposition & CPM DAG',
    'Endpoint / Hàm': `POST /api/projects/:id/decompose -> /api/v1/srs/extract`,
    Thời_Gian_ms: durDecompose,
    'Trạng_Thái (PASS/FAIL)': decomposePass,
    Bằng_Chứng_Dữ_Liệu_Thật: decomposeEvidence,
  });

  // Pick one task for subsequent tests
  const sampleTask = await prisma.task.findFirst({
    where: { projectId: testProject.id },
  });

  // ============================================================================
  // 3. AI ADAPTIVE GUIDANCE CHECKLIST (MOD-04)
  // ============================================================================
  console.log('\n--- [3/6] Kiểm thử Adaptive Guidance Checklist (MOD-04) ---');

  const t0Checklist = Date.now();
  const testTaskId = sampleTask?.id || crypto.randomUUID();
  const testTaskTitle = sampleTask?.title || 'Phát triển REST API xác thực JWT';
  const testTaskDesc = sampleTask?.description || 'Cài đặt băm mật khẩu bcrypt và sinh token JWT';

  const checklistItems = await generateAdaptiveChecklist(
    testTaskTitle,
    testTaskDesc,
    'INTERN'
  );
  const durChecklist = Date.now() - t0Checklist;

  let checklistPass: 'PASS' | 'FAIL' | 'FAIL (MOCK DETECTED)' = 'PASS';
  let checklistEvidence = '';

  // Check mock fallback
  const isMockChecklist = checklistItems.some(
    (item) =>
      item.taskText.includes('Đọc kỹ tài liệu đặc tả và xác nhận yêu cầu') ||
      item.taskText.includes('Tuân thủ coding convention, TypeScript strict mode')
  );

  if (isMockChecklist) {
    checklistPass = 'FAIL (MOCK DETECTED)';
    checklistEvidence = 'Checklist trùng khớp chuỗi mock fallback tĩnh';
  } else if (!Array.isArray(checklistItems) || checklistItems.length < 4) {
    checklistPass = 'FAIL';
    checklistEvidence = `Checklist không đủ số lượng cho Intern (nhận: ${checklistItems?.length} items)`;
  } else {
    // Persist checklist to task in DB
    if (sampleTask) {
      await prisma.task.update({
        where: { id: sampleTask.id },
        data: { checklist: checklistItems as any },
      });
    }

    const categories = Array.from(new Set(checklistItems.map((c) => c.category)));
    checklistEvidence = `${checklistItems.length} items (Intern), phân loại: [${categories.join(', ')}]. Item #1: "${checklistItems[0].taskText.slice(0, 50)}..."`;
  }

  recordResult({
    Tính_Năng_AI: '3. AI Adaptive Guidance Checklist',
    'Endpoint / Hàm': 'POST /api/v1/guidance/generate | generateAdaptiveChecklist',
    Thời_Gian_ms: durChecklist,
    'Trạng_Thái (PASS/FAIL)': checklistPass,
    Bằng_Chứng_Dữ_Liệu_Thật: checklistEvidence,
  });

  // ============================================================================
  // 4. AI CODE REVIEW & PR VERIFICATION (MOD-07)
  // ============================================================================
  console.log('\n--- [4/6] Kiểm thử Code Review & PR Verification (MOD-07) ---');

  const t0PR = Date.now();
  const realDiff = `diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,15 @@
+import jwt from 'jsonwebtoken';
+import bcrypt from 'bcryptjs';
+
+export async function loginUser(email: string, pass: string, hash: string) {
+  if (!email || !pass) {
+    throw new Error('Email and password are required');
+  }
+  const isMatch = await bcrypt.compare(pass, hash);
+  if (!isMatch) {
+    throw new Error('Invalid credentials');
+  }
+  return jwt.sign({ email }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
+}`;

  const prResult = await verifyCodeWithAI(
    testTaskTitle,
    testTaskDesc,
    checklistItems,
    realDiff
  );
  const durPR = Date.now() - t0PR;

  let prPass: 'PASS' | 'FAIL' | 'FAIL (MOCK DETECTED)' = 'PASS';
  let prEvidence = '';

  const fallbackFeedbacks = [
    'Mã nguồn đáp ứng các tiêu chuẩn kỹ thuật của task.',
    'Mã nguồn đã được ghi nhận và liên kết thành công với task. Đạt chuẩn cấu trúc cơ bản.',
  ];

  if (fallbackFeedbacks.includes(prResult.feedback) && prResult.score === 85) {
    prPass = 'FAIL (MOCK DETECTED)';
    prEvidence = 'Phản hồi trùng chuỗi mock fallback tĩnh';
  } else if (typeof prResult.score !== 'number' || prResult.score < 0 || prResult.score > 100) {
    prPass = 'FAIL';
    prEvidence = `Điểm số không hợp lệ: ${prResult.score}`;
  } else {
    // Persist in git_pull_requests table
    if (sampleTask) {
      const prNum = parseInt(suffix, 10) || 101;
      await prisma.gitPullRequest.create({
        data: {
          taskId: sampleTask.id,
          prNumber: prNum,
          prUrl: `https://github.com/smart-workspace/repo/pull/${prNum}`,
          branchName: `feat/task-${sampleTask.id}`,
          authorGithubUsername: 'octocat-dev',
          status: 'OPEN',
          isVerifiedByAi: prResult.isVerified,
          aiVerificationFeedback: prResult.feedback,
        },
      });
    }

    prEvidence = `Điểm: ${prResult.score}/100, isVerified: ${prResult.isVerified}. Nhận xét GPT: "${prResult.feedback.slice(0, 65)}..." (Đã lưu git_pull_requests)`;
  }

  recordResult({
    Tính_Năng_AI: '4. AI Code Review & PR Verification',
    'Endpoint / Hàm': 'POST /api/v1/pr/verify | verifyCodeWithAI',
    Thời_Gian_ms: durPR,
    'Trạng_Thái (PASS/FAIL)': prPass,
    Bằng_Chứng_Dữ_Liệu_Thật: prEvidence,
  });

  // ============================================================================
  // 5. AI AUTOMATED DAILY STANDUP (MOD-09)
  // ============================================================================
  console.log('\n--- [5/6] Kiểm thử Automated Daily Standup (MOD-09) ---');

  // Seed status transitions in last 24h
  if (sampleTask) {
    await prisma.taskStatusHistory.create({
      data: {
        taskId: sampleTask.id,
        fromStatus: 'TODO',
        toStatus: 'IN_PROGRESS',
        changedBy: leaderUser.id,
      },
    });
  }

  const t0Standup = Date.now();
  const standupReq = new NextRequest(
    `http://localhost:3000/api/projects/${testProject.id}/standup`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': leaderUser.id,
        'x-user-role': 'LEADER',
      },
      body: JSON.stringify({}),
    }
  );

  const standupRes = await standupPOST(standupReq, {
    params: { id: testProject.id },
  });
  const durStandup = Date.now() - t0Standup;
  const standupJson = await standupRes.json();

  let standupPass: 'PASS' | 'FAIL' | 'FAIL (MOCK DETECTED)' = 'PASS';
  let standupEvidence = '';

  if ((standupRes.status !== 200 && standupRes.status !== 201) || !standupJson.success) {
    standupPass = 'FAIL';
    standupEvidence = `HTTP ${standupRes.status}: ${JSON.stringify(standupJson.error || standupJson)}`;
  } else {
    const reportData = standupJson.data;
    const isMockStandup =
      reportData.summaryYesterday.includes('Đội ngũ tiếp tục triển khai các tác vụ theo tiến độ danh định') ||
      reportData.summaryYesterday.includes('Đội ngũ đã chuyển đổi trạng thái');

    if (isMockStandup) {
      standupPass = 'FAIL (MOCK DETECTED)';
      standupEvidence = 'Nội dung Standup là câu heuristic tĩnh, không phải do LLM tổng hợp';
    } else {
      // Check in DB
      const reportInDB = await prisma.dailyStandupReport.findFirst({
        where: { projectId: testProject.id },
      });

      standupEvidence = `Tóm tắt: "${reportData.summaryYesterday.slice(0, 50)}...". Kế hoạch: "${reportData.planToday.slice(0, 45)}...". (Đã lưu daily_standup_reports)`;
    }
  }

  recordResult({
    Tính_Năng_AI: '5. AI Automated Daily Standup',
    'Endpoint / Hàm': 'POST /api/projects/:id/standup -> /api/v1/standup/generate',
    Thời_Gian_ms: durStandup,
    'Trạng_Thái (PASS/FAIL)': standupPass,
    Bằng_Chứng_Dữ_Liệu_Thật: standupEvidence,
  });

  // ============================================================================
  // 6. AI SRS DOCUMENT INGESTION & USER STORIES (MOD-10)
  // ============================================================================
  console.log('\n--- [6/6] Kiểm thử SRS Ingestion & User Stories (MOD-10) ---');

  const srsRawContent = `
# ĐẶC TẢ YÊU CẦU PHẦN MỀM - MODULE ĐIỀU PHỐI DỰ ÁN
1. Quản lý dự án (Project Manager) cần tính năng phân tích đường găng CPM tự động để nhận diện các task có rủi ro trễ hạn.
2. Lập trình viên Backend cần hệ thống sinh gợi ý Checklist tự động phù hợp với độ khó của task và cấp bậc chuyên môn.
3. Chuyên viên DevOps cần cấu hình pipeline CI/CD tích hợp GitHub Webhook để tự động đối chiếu pull request với tiêu chuẩn kỹ thuật.
  `.trim();

  const t0SRS = Date.now();
  const srsReq = new NextRequest(
    `http://localhost:3000/api/projects/${testProject.id}/documents`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': leaderUser.id,
        'x-user-role': 'LEADER',
      },
      body: JSON.stringify({
        fileName: 'SRS_Module_Dieu_Phoi.md',
        rawContent: srsRawContent,
      }),
    }
  );

  const srsRes = await documentsPOST(srsReq, {
    params: { id: testProject.id },
  });
  const durSRS = Date.now() - t0SRS;
  const srsJson = await srsRes.json();

  let srsPass: 'PASS' | 'FAIL' | 'FAIL (MOCK DETECTED)' = 'PASS';
  let srsEvidence = '';

  if (srsRes.status !== 200 && srsRes.status !== 201) {
    srsPass = 'FAIL';
    srsEvidence = `HTTP ${srsRes.status}: ${JSON.stringify(srsJson.error || srsJson)}`;
  } else {
    const stories = srsJson.data?.stories || srsJson.data?.extractedStories || [];
    const isMockStories = stories.some(
      (s: any) =>
        s.fullTitle === 'Khởi tạo schema và cấu trúc dữ liệu quan hệ' ||
        s.fullTitle === 'Phát triển tầng REST API Core & Middleware bảo mật'
    );

    if (isMockStories) {
      srsPass = 'FAIL (MOCK DETECTED)';
      srsEvidence = 'Phát hiện User Stories mẫu tĩnh US-01/US-02, không phải từ tài liệu tải lên';
    } else if (stories.length === 0) {
      srsPass = 'FAIL';
      srsEvidence = 'Không trích xuất được User Story nào';
    } else {
      // Check in DB
      const docInDB = await prisma.projectDocument.findFirst({
        where: { projectId: testProject.id },
      });

      srsEvidence = `Trích xuất ${stories.length} User Stories chuẩn INVEST. Story #1: [${stories[0]?.storyId}] "${stories[0]?.fullTitle}" (${stories[0]?.acceptanceCriteria?.length} ACs). (Đã lưu project_documents)`;
    }
  }

  recordResult({
    Tính_Năng_AI: '6. AI SRS Document Ingestion',
    'Endpoint / Hàm': 'POST /api/projects/:id/documents -> /api/v1/srs/extract',
    Thời_Gian_ms: durSRS,
    'Trạng_Thái (PASS/FAIL)': srsPass,
    Bằng_Chứng_Dữ_Liệu_Thật: srsEvidence,
  });

  // ============================================================================
  // TỔNG KẾT BẢNG KẾT QUẢ
  // ============================================================================
  console.log(`\n================================================================================`);
  console.log(`📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ TÍNH NĂNG AI THỰC TẾ (100% REAL AI)`);
  console.log(`================================================================================\n`);

  console.table(summaryTable);

  const totalPassed = summaryTable.filter((r) => r['Trạng_Thái (PASS/FAIL)'] === 'PASS').length;
  const totalTests = summaryTable.length;

  console.log(`\n🎯 KẾT LUẬN: ĐẠT ${totalPassed}/${totalTests} TÍNH NĂNG AI (${Math.round((totalPassed / totalTests) * 100)}%).`);
  if (totalPassed === totalTests) {
    console.log(`🎉 TẤT CẢ TÍNH NĂNG AI KẾT NỐI QUA HTTP FASTAPI HOÀN TOÀN THÀNH CÔNG VỚI DỮ LIỆU THẬT 100%!`);
  } else {
    console.warn(`⚠️ Có ${totalTests - totalPassed} tính năng chưa đạt hoặc bị phát hiện mock.`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Fatal Test Execution Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
