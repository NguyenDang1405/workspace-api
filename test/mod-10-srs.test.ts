/**
 * Objective Anti-Hallucination Test Suite for Module 10:
 * SRS Document Ingestion & AI Project Seeding (Tiếp nhận SRS & Phân rã Dự án Tự động)
 *
 * Verifies all 5 Anti-Hallucination Criteria with Direct PostgreSQL Physical Checks:
 * - TEST-01: Recursive text chunking algorithm (5,000 chars -> 3-5 chunks, <= 2000 chars, consecutive overlap).
 * - TEST-02: SRS ingestion & persistence in project_documents table (extracted_stories JSON with >= 2 stories).
 * - TEST-03: INVEST compliance verification (role, action, benefit, department, complexity, acceptanceCriteria).
 * - TEST-04: Cross-module automatic seeding (MOD-10 -> MOD-02 DAG: tasks, dependencies, critical path, task_embedding NOT NULL).
 * - TEST-05: RBAC Security Enforcement (MEMBER role blocked from uploading SRS with HTTP 403 Forbidden).
 *
 * Execution:
 * npm run test:module10
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = process.env.TEST_APP_URL || 'http://localhost:3000';

/**
 * Splits text into overlapping semantic chunks based on structural markdown and natural punctuation.
 */
function chunkTextRecursively(
  text: string,
  chunkSize: number = 1500,
  overlap: number = 200
): string[] {
  if (!text || text.length <= chunkSize) {
    return text ? [text.trim()] : [];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + chunkSize;
    if (endIndex >= text.length) {
      const lastChunk = text.slice(startIndex).trim();
      if (lastChunk.length > 0) {
        chunks.push(lastChunk);
      }
      break;
    }

    // Find the most natural breaking boundary
    const slice = text.slice(startIndex, endIndex);
    let splitPos = slice.lastIndexOf('\n# ');
    if (splitPos === -1) splitPos = slice.lastIndexOf('\n## ');
    if (splitPos === -1) splitPos = slice.lastIndexOf('\n### ');
    if (splitPos === -1) splitPos = slice.lastIndexOf('\n\n');
    if (splitPos === -1) splitPos = slice.lastIndexOf('\n');
    if (splitPos === -1) splitPos = slice.lastIndexOf('. ');
    if (splitPos === -1) splitPos = slice.lastIndexOf(' ');

    if (splitPos > chunkSize * 0.4) {
      endIndex = startIndex + splitPos + 1;
    }

    const chunkContent = text.slice(startIndex, endIndex).trim();
    if (chunkContent.length > 0) {
      chunks.push(chunkContent);
    }

    const nextStart = endIndex - overlap;
    startIndex = nextStart > startIndex ? nextStart : endIndex;
  }

  return chunks.filter((c) => c.length >= 20);
}

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

async function runMod10TestSuite() {
  console.log(`\n============================================================`);
  console.log(`🚀 BẮT ĐẦU KIỂM THỬ KHÁCH QUAN & CHỐNG ẢO GIÁC - MODULE 10`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Database: PostgreSQL (localhost:5433 / workspace_db)`);
  console.log(`============================================================\n`);

  const uniqueSuffix = Date.now().toString().slice(-6);
  const leaderEmail = `leader_srs_${uniqueSuffix}@workspace.local`;
  const memberEmail = `member_srs_${uniqueSuffix}@workspace.local`;
  const password = 'Password123@Valid';

  let leaderToken = '';
  let memberToken = '';
  let leaderUserId = '';
  let memberUserId = '';
  let testProjectId = '';

  try {
    // ============================================================
    // TEST-01: PHÂN ĐOẠN VĂN BẢN ĐỆ QUY (RECURSIVE CHUNKING LOGIC)
    // ============================================================
    // Chạy chunkTextRecursively với văn bản dài 5,000 ký tự.
    // Kỳ vọng: Mảng có 3 đến 5 chunks, không chunk nào vượt 2000 chars,
    // các chunk liền kề có phần gối đầu (overlap).
    const section1 = '# 1. TỔNG QUAN HỆ THỐNG THƯƠNG MẠI ĐIỆN TỬ\nHệ thống phục vụ bán hàng đa kênh với khả năng xử lý đơn hàng thời gian thực. '.padEnd(1200, 'Xây dựng kiến trúc microservices chịu tải cao. ');
    const section2 = '\n\n## 2. YÊU CẦU PHÂN HỆ BACKEND & XÁC THỰC\nCài đặt REST API với JWT token, mã hóa mật khẩu bcrypt, bảo vệ chống brute-force và DDoS. '.padEnd(1250, 'Quản lý giỏ hàng và tích hợp cổng thanh toán trực tuyến. ');
    const section3 = '\n\n## 3. YÊU CẦU PHÂN HỆ FRONTEND DASHBOARD\nGiao diện responsive chuẩn Tailwind CSS, hỗ trợ kéo thả Kanban, hiển thị biểu đồ doanh thu. '.padEnd(1250, 'Tối ưu hóa thời gian tải trang dưới 1.5 giây. ');
    const section4 = '\n\n## 4. YÊU CẦU HẠ TẦNG CI/CD & DEVOPS\nĐóng gói container Docker, cấu hình pipeline GitHub Actions tự động kiểm thử và deploy. '.padEnd(1300, 'Giám sát hệ thống với Prometheus và Grafana. ');

    const sample5000Text = (section1 + section2 + section3 + section4).slice(0, 5000);

    const chunks = chunkTextRecursively(sample5000Text, 1500, 200);

    const isChunkCountValid = chunks.length >= 3 && chunks.length <= 5;
    const isNoChunkExceedLimit = chunks.every((c) => c.length <= 2000);

    // Kiểm tra tính gối đầu (overlap) giữa chunk[i] và chunk[i+1]
    let hasOverlap = true;
    for (let i = 0; i < chunks.length - 1; i++) {
      const c1End = chunks[i].slice(-60).trim();
      const c2Start = chunks[i + 1].slice(0, 300).trim();
      // Lấy 3 từ cuối của chunk trước
      const words = c1End.split(/\s+/).slice(-3).join(' ');
      if (!c2Start.includes(words) && !chunks[i].includes(chunks[i + 1].slice(0, 30))) {
        hasOverlap = false;
        break;
      }
    }

    const isTest01Passed = isChunkCountValid && isNoChunkExceedLimit && hasOverlap;

    recordTest(
      'TEST-01',
      'Phân đoạn văn bản đệ quy (Recursive Semantic Chunking)',
      isTest01Passed,
      `Tổng ký tự: ${sample5000Text.length} | Số chunks: ${chunks.length} (Kỳ vọng: 3-5) | ` +
        `Độ dài các chunks: [${chunks.map((c) => c.length).join(', ')}] | Có tính gối đầu: ${hasOverlap}`
    );

    // ------------------------------------------------------------
    // SETUP: Tạo tài khoản Leader & Member qua API Auth
    // ------------------------------------------------------------
    const leaderRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: leaderEmail,
        password,
        fullName: `Product Owner Lead ${uniqueSuffix}`,
        role: 'LEADER',
        department: 'FULLSTACK',
        level: 'SENIOR',
        skills: ['Requirements Analysis', 'Product Architecture', 'TypeScript'],
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
        fullName: `Software Developer ${uniqueSuffix}`,
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
        name: `E-Commerce Platform Ingestion ${uniqueSuffix}`,
        description: 'Dự án thương mại điện tử đa kênh tiếp nhận từ SRS',
        techStack: ['PostgreSQL', 'TypeScript', 'Next.js', 'Docker'],
        complexity: 'HARD',
        ownerId: leaderUserId,
        targetEndDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    });
    testProjectId = project.id;

    // ============================================================
    // TEST-02: TIẾP NHẬN SRS & LƯU BẢNG PROJECT_DOCUMENTS
    // ============================================================
    // Gửi request POST /api/projects/:id/documents với nội dung SRS mẫu.
    // Kiểm tra trực tiếp PostgreSQL: Bảng project_documents lưu thành công
    // và extracted_stories chứa tối thiểu 2 User Stories hợp lệ.
    const sampleSRSContent = `# ĐẶC TẢ YÊU CẦU KỸ THUẬT (SRS) - HỆ THỐNG THƯƠNG MẠI ĐIỆN TỬ
## 1. Phân hệ Cơ sở dữ liệu và Xác thực
- Người dùng có thể đăng ký tài khoản mới bằng email và mật khẩu bảo mật.
- Hệ thống hỗ trợ cấp phát JWT Token và phân quyền vai trò (Admin, Member).
- Cần có cơ sở dữ liệu quan hệ PostgreSQL chuẩn hóa 14 bảng với chỉ mục HNSW vector.

## 2. Phân hệ Bảng điều khiển Quản trị & Kanban
- Lập trình viên có thể xem danh sách công việc trên bảng Kanban 5 cột.
- Cho phép kéo thả thẻ công việc và cập nhật trạng thái luồng việc theo FSM.

## 3. Phân hệ DevOps & Đóng gói
- Triển khai ứng dụng qua Docker Compose và tích hợp GitHub Actions CI/CD pipeline.`;

    const resTest02 = await fetch(`${BASE_URL}/api/projects/${testProjectId}/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leaderToken}`,
      },
      body: JSON.stringify({
        fileName: 'ecommerce-srs-spec.md',
        fileUrl: 'https://storage.workspace.local/ecommerce-srs-spec.md',
        rawContent: sampleSRSContent,
      }),
    });

    const isTest02HttpOk = resTest02.status === 201;
    const dataTest02 = await resTest02.json();
    const body02 = dataTest02.data;

    // Đối soát trực tiếp CSDL PostgreSQL
    const dbDoc = await prisma.projectDocument.findFirst({
      where: { projectId: testProjectId },
      orderBy: { createdAt: 'desc' },
    });

    const rawStoriesFromDb = dbDoc?.extractedStories;
    const dbStories: any[] = Array.isArray(rawStoriesFromDb)
      ? (rawStoriesFromDb as any[])
      : JSON.parse((rawStoriesFromDb as string) || '[]');

    const isTest02Passed =
      isTest02HttpOk &&
      dbDoc !== null &&
      dbDoc.fileName === 'ecommerce-srs-spec.md' &&
      dbStories.length >= 2;

    recordTest(
      'TEST-02',
      'Tiếp nhận SRS & Lưu CSDL bảng project_documents (Ground Truth Verification)',
      isTest02Passed,
      `HTTP Status: ${resTest02.status} | DB Document ID: ${dbDoc?.id} | ` +
        `File Name: "${dbDoc?.fileName}" | Số lượng User Stories lưu trong DB: ${dbStories.length} (Kỳ vọng: >= 2)`
    );

    // ============================================================
    // TEST-03: TÍNH ĐẦY ĐỦ CỦA USER STORY THEO CHUẨN INVEST
    // ============================================================
    // Kiểm tra cấu trúc từng User Story:
    // role, action, benefit, fullTitle, description, targetDepartment, complexity, acceptanceCriteria.
    const validDepartments = ['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK'];
    const validComplexities = ['EASY', 'MEDIUM', 'HARD'];

    const areAllStoriesInvestCompliant = dbStories.every((story: any) => {
      const hasBasicFields =
        typeof story.role === 'string' && story.role.trim().length > 0 &&
        typeof story.action === 'string' && story.action.trim().length > 0 &&
        typeof story.benefit === 'string' && story.benefit.trim().length > 0 &&
        typeof story.fullTitle === 'string' && story.fullTitle.trim().length > 0 &&
        typeof story.description === 'string' && story.description.trim().length > 0;

      const hasValidDept = validDepartments.includes(story.targetDepartment);
      const hasValidComplexity = validComplexities.includes(story.complexity);
      const hasAcceptanceCriteria =
        Array.isArray(story.acceptanceCriteria) && story.acceptanceCriteria.length >= 1;

      return hasBasicFields && hasValidDept && hasValidComplexity && hasAcceptanceCriteria;
    });

    const isTest03Passed = dbStories.length >= 2 && areAllStoriesInvestCompliant;

    const firstStory = dbStories[0] || {};
    recordTest(
      'TEST-03',
      'Tính đầy đủ của User Story theo chuẩn INVEST & Structured Outputs',
      isTest03Passed,
      `Tổng User Stories kiểm tra: ${dbStories.length} | INVEST Compliant: ${areAllStoriesInvestCompliant} | ` +
        `Mẫu US đầu tiên: "${firstStory.storyId} - Là một ${firstStory.role}, tôi muốn ${firstStory.action}..." ` +
        `[Dept: ${firstStory.targetDepartment}, Complexity: ${firstStory.complexity}, ACs: ${firstStory.acceptanceCriteria?.length}]`
    );

    // ============================================================
    // TEST-04: KHỞI TẠO TỰ ĐỘNG XUYÊN TẦNG SEEDING -> MOD-02 DAG
    // ============================================================
    // Gọi POST /api/projects/:id/seed-from-srs.
    // Đối soát CSDL thật: Bảng tasks & task_dependencies sinh ra các bản ghi thật,
    // có ít nhất 1 task găng (is_critical_path = true) và task_embedding KHÔNG bị NULL.
    const resTest04 = await fetch(`${BASE_URL}/api/projects/${testProjectId}/seed-from-srs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leaderToken}`,
      },
    });

    const isTest04HttpOk = resTest04.status === 200;
    const dataTest04 = await resTest04.json();
    const body04 = dataTest04.data;

    // Đối soát trực tiếp CSDL PostgreSQL
    const tasksCount = await prisma.task.count({
      where: { projectId: testProjectId },
    });

    const criticalTasksCount = await prisma.task.count({
      where: { projectId: testProjectId, isCriticalPath: true },
    });

    const depsCount = await prisma.taskDependency.count({
      where: {
        predecessor: { projectId: testProjectId },
      },
    });

    // Soi trực tiếp cột vector task_embedding trong PostgreSQL
    const vectorCheck: Array<{ count: bigint }> = await prisma.$queryRaw`
      SELECT COUNT(*)::bigint AS count
      FROM tasks
      WHERE project_id = ${testProjectId}::uuid AND task_embedding IS NOT NULL
    `;
    const tasksWithEmbeddingCount = Number(vectorCheck[0]?.count || 0);

    const dbProjectAfter = await prisma.project.findUnique({
      where: { id: testProjectId },
      select: { status: true },
    });

    const isTest04Passed =
      isTest04HttpOk &&
      tasksCount >= 2 &&
      depsCount >= 1 &&
      criticalTasksCount >= 1 &&
      tasksWithEmbeddingCount === tasksCount &&
      dbProjectAfter?.status === 'ACTIVE';

    recordTest(
      'TEST-04',
      'Khởi tạo tự động xuyên tầng Seeding -> MOD-02 DAG & Lưu Task Embeddings',
      isTest04Passed,
      `HTTP Status: ${resTest04.status} | Tổng tasks tạo trong DB: ${tasksCount} | ` +
        `Dependencies: ${depsCount} | Critical Tasks: ${criticalTasksCount} | ` +
        `Tasks có Embedding không NULL: ${tasksWithEmbeddingCount}/${tasksCount} | ` +
        `Project Status cập nhật: ${dbProjectAfter?.status}`
    );

    // ============================================================
    // TEST-05: CHẶN QUYỀN MEMBER TẢI LÊN SRS (RBAC 403)
    // ============================================================
    // Sử dụng token của MEMBER để gọi POST /api/projects/:id/documents.
    // Kỳ vọng: Nhận đúng HTTP 403 Forbidden.
    const resTest05 = await fetch(`${BASE_URL}/api/projects/${testProjectId}/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        fileName: 'unauthorized-srs.md',
        rawContent: sampleSRSContent,
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
      'Chặn quyền Member tải lên tài liệu SRS (RBAC Security: HTTP 403 Forbidden)',
      isTest05Passed,
      `HTTP Status: ${resTest05.status} (Kỳ vọng: 403 Forbidden) | ` +
        `Error Code: ${dataTest05.error?.code} | ` +
        `Message: "${dataTest05.error?.message}"`
    );
  } catch (error: any) {
    console.error('❌ Lỗi ngoại lệ trong quá trình chạy Test Suite MOD-10:', error);
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
  console.log(`📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ KHÁCH QUAN - MODULE 10`);
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
    console.log(`\n🎉 TOÀN BỘ 5 TIÊU CHUẨN CHỐNG ẢO GIÁC CỦA MOD-10 ĐÃ ĐẠT 100%!`);
  } else {
    console.error(`\n⚠️ CÓ BÀI TEST CHƯA ĐẠT. VUI LÒNG KIỂM TRA LẠI LOG CHI TIẾT TRÊN.`);
    process.exit(1);
  }
}

runMod10TestSuite();
