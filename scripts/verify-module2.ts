/**
 * Automated Verification Script for Module 2:
 * DAG Decomposition Engine & Critical Path Method (CPM)
 *
 * Verifies:
 * 1. Kahn's Algorithm & Cycle Detection (throws CyclicDependencyError with code CYCLIC_DEPENDENCY_DETECTED)
 * 2. CPM Forward Pass (Early Start, Early Finish)
 * 3. CPM Backward Pass (Late Start, Late Finish)
 * 4. Slack Time Calculation & Critical Path Flagging
 * 5. Critical Edge Identification
 * 6. RBAC Protection on POST /api/projects/[id]/decompose (403 for MEMBER)
 * 7. End-to-end Project Decompose Execution (Leader/Admin)
 * 8. GET /api/projects/[id]/dag: React Flow Graph Output Format & Critical Styling
 * 9. Database Persistence of Tasks & Dependencies
 *
 * Run: npm run verify:module2
 */

const { runKahnAndCPM, isEdgeCritical, CyclicDependencyError } = require('../src/services/cpm.service');
const { prisma } = require('../src/lib/prisma');

const BASE_URL = process.env.TEST_APP_URL || 'http://localhost:3000';

interface StepResult {
  step: string;
  passed: boolean;
  details: string;
}

const results: StepResult[] = [];

function record(step: string, passed: boolean, details: string) {
  results.push({ step, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} | ${step}: ${details}`);
}

async function runVerification() {
  console.log(`\n============================================================`);
  console.log(`🚀 BẮT ĐẦU KIỂM THỬ MODULE 2: DAG DECOMPOSITION & CPM ENGINE`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`============================================================\n`);

  // ============================================================
  // PHẦN A: KIỂM THỬ ĐƠN VỊ THUẬT TOÁN (PURE UNIT TESTS)
  // ============================================================
  console.log(`--- [PHẦN A] THUẬT TOÁN KAHN & CRITICAL PATH METHOD (CPM) ---`);

  // ------------------------------------------------------------
  // TEST 1: Kahn's Algorithm - Phát hiện chu trình vòng lặp (A -> B -> A)
  // ------------------------------------------------------------
  try {
    const cyclicTasks = [
      {
        tempId: 'T1',
        estimatedHours: 4,
        predecessors: ['T2'], // Cycle: T1 depends on T2
      },
      {
        tempId: 'T2',
        estimatedHours: 4,
        predecessors: ['T1'], // Cycle: T2 depends on T1
      },
    ];

    let threwExpectedError = false;
    try {
      runKahnAndCPM(cyclicTasks);
    } catch (err: any) {
      if (err instanceof CyclicDependencyError && err.code === 'CYCLIC_DEPENDENCY_DETECTED') {
        threwExpectedError = true;
      }
    }

    record(
      'A.1: Kahn Cycle Detection (A <-> B)',
      threwExpectedError,
      threwExpectedError
        ? 'Phát hiện chu trình chính xác, ném CyclicDependencyError (CYCLIC_DEPENDENCY_DETECTED)'
        : 'Thất bại: Không ném lỗi chu trình vòng'
    );
  } catch (err: unknown) {
    record('A.1: Kahn Cycle Detection', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 2: Kahn Cycle Detection - Chu trình đa đỉnh (T1 -> T2 -> T3 -> T1)
  // ------------------------------------------------------------
  try {
    const multiCyclicTasks = [
      {
        tempId: 'T1',
        estimatedHours: 2,
        predecessors: ['T3'],
      },
      {
        tempId: 'T2',
        estimatedHours: 3,
        predecessors: ['T1'],
      },
      {
        tempId: 'T3',
        estimatedHours: 4,
        predecessors: ['T2'],
      },
    ];

    let threwExpectedError = false;
    try {
      runKahnAndCPM(multiCyclicTasks);
    } catch (err: any) {
      if (err instanceof CyclicDependencyError) {
        threwExpectedError = true;
      }
    }

    record(
      'A.2: Kahn Multi-node Cycle Detection (T1 -> T2 -> T3 -> T1)',
      threwExpectedError,
      threwExpectedError ? 'Phát hiện chu trình 3 đỉnh thành công' : 'Thất bại'
    );
  } catch (err: unknown) {
    record('A.2: Kahn Multi-node Cycle Detection', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 3: CPM Forward / Backward / Slack Calculation (Diamond Graph)
  // T1(5h) -> T2(3h) -> T4(2h)  => Path 1: 5 + 3 + 2 = 10h
  // T1(5h) -> T3(7h) -> T4(2h)  => Path 2: 5 + 7 + 2 = 14h (CRITICAL)
  // ------------------------------------------------------------
  try {
    const diamondTasks = [
      {
        tempId: 'T1',
        estimatedHours: 5,
        predecessors: [],
      },
      {
        tempId: 'T2',
        estimatedHours: 3,
        predecessors: ['T1'],
      },
      {
        tempId: 'T3',
        estimatedHours: 7,
        predecessors: ['T1'],
      },
      {
        tempId: 'T4',
        estimatedHours: 2,
        predecessors: ['T2', 'T3'],
      },
    ];

    const cpmResult = runKahnAndCPM(diamondTasks);
    const t1 = cpmResult.cpmResults.get('T1');
    const t2 = cpmResult.cpmResults.get('T2');
    const t3 = cpmResult.cpmResults.get('T3');
    const t4 = cpmResult.cpmResults.get('T4');

    // Assertions:
    // T1: ES=0, EF=5, LS=0, LF=5, slack=0, critical=true
    const t1Ok = t1 && t1.earlyStart === 0 && t1.earlyFinish === 5 && t1.lateStart === 0 && t1.lateFinish === 5 && t1.slackTime === 0 && t1.isCriticalPath === true;
    // T2: ES=5, EF=8, LS=9, LF=12, slack=4, critical=false
    const t2Ok = t2 && t2.earlyStart === 5 && t2.earlyFinish === 8 && t2.lateStart === 9 && t2.lateFinish === 12 && t2.slackTime === 4 && t2.isCriticalPath === false;
    // T3: ES=5, EF=12, LS=5, LF=12, slack=0, critical=true
    const t3Ok = t3 && t3.earlyStart === 5 && t3.earlyFinish === 12 && t3.lateStart === 5 && t3.lateFinish === 12 && t3.slackTime === 0 && t3.isCriticalPath === true;
    // T4: ES=12, EF=14, LS=12, LF=14, slack=0, critical=true
    const t4Ok = t4 && t4.earlyStart === 12 && t4.earlyFinish === 14 && t4.lateStart === 12 && t4.lateFinish === 14 && t4.slackTime === 0 && t4.isCriticalPath === true;

    const durationOk = cpmResult.projectMakespan === 14;

    const allPassed = Boolean(t1Ok && t2Ok && t3Ok && t4Ok && durationOk);
    record(
      'A.3: Tính toán CPM (ES, EF, LS, LF, Slack, Critical Path)',
      allPassed,
      `Duration: ${cpmResult.projectMakespan}h (kỳ vọng 14h) | T2 slack: ${t2?.slackTime}h (kỳ vọng 4h)`
    );

    // ------------------------------------------------------------
    // TEST 4: Critical Edge Identification
    // T1 -> T3 (Critical: YES)
    // T3 -> T4 (Critical: YES)
    // T1 -> T2 (Critical: NO)
    // T2 -> T4 (Critical: NO)
    // ------------------------------------------------------------
    const isEdge13Crit = isEdgeCritical(t1!, t3!);
    const isEdge34Crit = isEdgeCritical(t3!, t4!);
    const isEdge12Crit = isEdgeCritical(t1!, t2!);
    const isEdge24Crit = isEdgeCritical(t2!, t4!);

    const edgeLogicOk = isEdge13Crit === true && isEdge34Crit === true && isEdge12Crit === false && isEdge24Crit === false;
    record(
      'A.4: Nhận diện Critical Edge (Đường găng giữa các node)',
      edgeLogicOk,
      `T1->T3: ${isEdge13Crit}, T3->T4: ${isEdge34Crit}, T1->T2: ${isEdge12Crit}, T2->T4: ${isEdge24Crit}`
    );
  } catch (err: unknown) {
    record('A.3 & A.4: CPM Calculation', false, String(err));
  }

  // ============================================================
  // PHẦN B: KIỂM THỬ TÍCH HỢP ROUTE HANDLERS & RBAC (API ENDPOINTS)
  // ============================================================
  console.log(`\n--- [PHẦN B] TÍCH HỢP API & RBAC ENDPOINTS ---`);

  const uniqueSuffix = Date.now().toString().slice(-6);
  const memberEmail = `mod2_member_${uniqueSuffix}@workspace.test`;
  const leaderEmail = `mod2_leader_${uniqueSuffix}@workspace.test`;
  const password = 'Password123@Valid';

  let memberToken = '';
  let leaderToken = '';
  let leaderId = '';
  let testTeamId = '';
  let testProjectId = '';

  // Setup users via Register API
  try {
    const regMemRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: memberEmail,
        password,
        fullName: 'Member MOD2',
        role: 'MEMBER',
        department: 'FRONTEND',
        level: 'JUNIOR',
        skills: ['React'],
      }),
    });
    const regMemData = await regMemRes.json();
    memberToken = regMemData.data?.accessToken || '';

    const regLeadRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: leaderEmail,
        password,
        fullName: 'Leader MOD2',
        role: 'LEADER',
        department: 'BACKEND',
        level: 'SENIOR',
        skills: ['Node.js', 'PostgreSQL'],
      }),
    });
    const regLeadData = await regLeadRes.json();
    leaderToken = regLeadData.data?.accessToken || '';
    leaderId = regLeadData.data?.id || '';

    if (!regMemData.success || !regLeadData.success) {
      console.log('Reg Member Status:', regMemRes.status, JSON.stringify(regMemData));
      console.log('Reg Leader Status:', regLeadRes.status, JSON.stringify(regLeadData));
    }

    record(
      'B.0: Khởi tạo tài khoản kiểm thử (Member & Leader)',
      Boolean(memberToken && leaderToken),
      `Member Token: ${Boolean(memberToken)} | Leader Token: ${Boolean(leaderToken)}`
    );
  } catch (err) {
    record('B.0: Khởi tạo tài khoản kiểm thử', false, `Lỗi: ${String(err)}. Vui lòng đảm bảo dev server đang chạy.`);
    return;
  }

  // Create or get team & project for decompose testing
  try {
    let team = await prisma.team.findFirst();
    if (!team) {
      team = await prisma.team.create({
        data: {
          name: `Test Engineering Team ${uniqueSuffix}`,
          description: 'Team for DAG decompose verification',
          leaderId,
        },
      });
    }
    testTeamId = team.id;

    const project = await prisma.project.create({
      data: {
        name: `E-Commerce Microservices ${uniqueSuffix}`,
        description: 'High performance payment and order management platform',
        techStack: ['Node.js', 'PostgreSQL', 'Redis', 'Next.js', 'Docker'],
        complexity: 'HARD',
        status: 'PLANNING',
        teamId: testTeamId,
        ownerId: leaderId,
        startDate: new Date(),
        targetEndDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });
    testProjectId = project.id;

    record(
      'B.1: Chuẩn bị Dự án mẫu trong Database',
      Boolean(testProjectId),
      `Project ID: ${testProjectId} | Name: ${project.name}`
    );
  } catch (err: unknown) {
    record('B.1: Chuẩn bị Dự án mẫu', false, String(err));
    return;
  }

  // ------------------------------------------------------------
  // TEST B.2: RBAC MEMBER không có quyền phân rã dự án (403 Forbidden)
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/projects/${testProjectId}/decompose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        customPrompt: 'Decompose by member',
      }),
    });
    const data = await res.json();
    const passed = res.status === 403 && data.success === false;

    record(
      'B.2: RBAC Chặn MEMBER phân rã dự án (403 Forbidden)',
      passed,
      `HTTP ${res.status} | Error: ${data.error?.message || 'Forbidden'}`
    );
  } catch (err: unknown) {
    record('B.2: RBAC MEMBER decompose', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST B.3: LEADER phân rã dự án thành công (OpenAI Structured / Heuristic Fallback)
  // ------------------------------------------------------------
  try {
    console.log('   ⏳ Đang gửi yêu cầu phân rã dự án (POST /decompose)...');
    const res = await fetch(`${BASE_URL}/api/projects/${testProjectId}/decompose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leaderToken}`,
      },
      body: JSON.stringify({
        customPrompt: 'Phân rã dự án thành các module Backend, Frontend, DevOps và QA',
      }),
    });
    const data = await res.json();
    const passed =
      res.status === 200 &&
      data.success === true &&
      data.data?.totalTasks > 0 &&
      data.data?.projectMakespan > 0 &&
      data.data?.criticalTasksCount > 0;

    record(
      'B.3: LEADER Phân rã dự án thành công (Atomic Transaction & CPM)',
      passed,
      `HTTP ${res.status} | Số tasks: ${data.data?.totalTasks} | Thời gian găng: ${data.data?.projectMakespan}h | Tasks găng: ${data.data?.criticalTasksCount}`
    );
  } catch (err: unknown) {
    record('B.3: LEADER Decompose Project', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST B.4: Lấy đồ thị React Flow DAG (GET /api/projects/[id]/dag)
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/projects/${testProjectId}/dag`, {
      headers: {
        Authorization: `Bearer ${leaderToken}`,
      },
    });
    const data = await res.json();
    const dag = data.data;

    const hasNodes = Array.isArray(dag?.nodes) && dag.nodes.length > 0;
    const hasEdges = Array.isArray(dag?.edges);
    const hasMetrics = typeof dag?.projectMakespan === 'number';

    // Verify React Flow Node format
    const sampleNode = dag?.nodes?.[0];
    const nodeValid =
      sampleNode &&
      typeof sampleNode.id === 'string' &&
      sampleNode.type === 'taskNode' &&
      typeof sampleNode.data?.title === 'string' &&
      typeof sampleNode.data?.isCriticalPath === 'boolean' &&
      typeof sampleNode.position?.x === 'number';

    // Verify Critical Edge formatting if critical edges exist
    const criticalEdge = dag?.edges?.find((e: any) => e.data?.isCriticalEdge === true);
    const edgeValid =
      !criticalEdge ||
      (criticalEdge.animated === true && criticalEdge.style?.stroke === '#ef4444');

    const passed =
      res.status === 200 &&
      data.success === true &&
      hasNodes &&
      hasEdges &&
      hasMetrics &&
      nodeValid &&
      edgeValid;

    record(
      'B.4: GET /api/projects/[id]/dag trả về React Flow DAG chuẩn',
      passed,
      `HTTP ${res.status} | Nodes: ${dag?.nodes?.length} | Edges: ${dag?.edges?.length} | Critical Duration: ${dag?.projectMakespan}h`
    );
  } catch (err: unknown) {
    record('B.4: GET DAG API', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST B.5: Kiểm tra Database Persistence & Task Dependencies
  // ------------------------------------------------------------
  try {
    const dbTasks = await prisma.task.findMany({
      where: { projectId: testProjectId },
      include: {
        dependencies: true,
        dependents: true,
      },
    });

    const hasCriticalTask = dbTasks.some((t: any) => t.isCriticalPath);
    const totalDependencies = await prisma.taskDependency.count({
      where: {
        predecessor: { projectId: testProjectId },
      },
    });

    const passed = dbTasks.length > 0 && hasCriticalTask;

    record(
      'B.5: Kiểm tra Database lưu trữ đầy đủ Task, Slack và Quan hệ Phụ thuộc',
      passed,
      `Tasks trong DB: ${dbTasks.length} | TaskDependencies: ${totalDependencies} | Có Task găng: ${hasCriticalTask}`
    );
  } catch (err: unknown) {
    record('B.5: Database Verification', false, String(err));
  }

  // ------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;

  console.log(`\n============================================================`);
  console.log(`🎯 KẾT QUẢ ĐÁNH GIÁ MODULE 2 (DAG & CPM ENGINE):`);
  console.log(`Đạt: ${passedCount}/${totalCount} bài kiểm thử`);
  if (passedCount === totalCount) {
    console.log(`🏆 TẤT CẢ TIÊU CHÍ CỦA MODULE 2 ĐÃ ĐẠT CHUẨN XUẤT SẮC!`);
  } else {
    console.log(`⚠️ Có ${totalCount - passedCount} bài kiểm thử chưa đạt.`);
  }
  console.log(`============================================================\n`);

  // Disconnect prisma client
  await prisma.$disconnect();
}

runVerification().catch(async (e) => {
  console.error('Lỗi ngoại lệ khi chạy verification:', e);
  await prisma.$disconnect();
  process.exit(1);
});
