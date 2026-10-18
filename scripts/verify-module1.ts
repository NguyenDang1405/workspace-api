/**
 * Automated Verification Script for Module 1 (Auth & Talent Profile)
 * Based on markdown/00_DEFINITION_OF_DONE.md
 *
 * To run: npx ts-node scripts/verify-module1.ts
 */

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
  console.log(`🚀 BẮT ĐẦU KIỂM THỬ DEFINITION OF DONE - MODULE 1 (AUTH & TALENT)`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`============================================================\n`);

  const uniqueSuffix = Date.now().toString().slice(-6);
  const memberEmail = `member_${uniqueSuffix}@workspace.test`;
  const leaderEmail = `leader_${uniqueSuffix}@workspace.test`;
  const password = 'Password123@Valid';

  let memberToken = '';
  let memberRefreshToken = '';
  let leaderToken = '';

  // ------------------------------------------------------------
  // TEST 1: Register Member User
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: memberEmail,
        password,
        fullName: 'Test Member',
        role: 'MEMBER',
        department: 'FRONTEND',
        level: 'JUNIOR',
        skills: ['React', 'CSS'],
        bioSummary: 'Junior Frontend Developer',
      }),
    });
    const data = await res.json();
    const passed = res.status === 201 && data.success === true && !!data.data?.accessToken;
    memberToken = data.data?.accessToken || '';
    record(
      'TẦNG 4.1: Đăng ký Member',
      passed,
      `HTTP ${res.status} | ID: ${data.data?.id || 'none'}`
    );
  } catch (err: unknown) {
    record('TẦNG 4.1: Đăng ký Member', false, `Lỗi kết nối server: ${String(err)}`);
    console.error('\n⚠️ Vui lòng đảm bảo dev server đang chạy: npm run dev\n');
    return;
  }

  // ------------------------------------------------------------
  // TEST 2: Register Duplicate Email (Constraint Check)
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: memberEmail,
        password,
        fullName: 'Duplicate',
      }),
    });
    const data = await res.json();
    const passed = res.status === 409 && data.success === false && data.error?.code === 'EMAIL_ALREADY_EXISTS';
    record(
      'TẦNG 3.2: Kiểm tra Conflict 409 khi trùng email',
      passed,
      `HTTP ${res.status} | Code: ${data.error?.code}`
    );
  } catch (err: unknown) {
    record('TẦNG 3.2: Kiểm tra Conflict 409', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 3: Register Leader User
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: leaderEmail,
        password,
        fullName: 'Test Leader',
        role: 'LEADER',
        department: 'BACKEND',
        level: 'SENIOR',
        skills: ['Node.js', 'PostgreSQL', 'Docker'],
      }),
    });
    const data = await res.json();
    leaderToken = data.data?.accessToken || '';
    record('TẦNG 4.1: Đăng ký Leader', res.status === 201, `HTTP ${res.status}`);
  } catch (err: unknown) {
    record('TẦNG 4.1: Đăng ký Leader', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 4: Login Member (Token & Cookie Verification)
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberEmail, password }),
    });
    const data = await res.json();
    const setCookie = res.headers.get('set-cookie') || '';
    const hasRefreshCookie = setCookie.includes('refresh_token');

    // Extract raw refresh token cookie for later reuse testing
    const match = setCookie.match(/refresh_token=([^;]+)/);
    if (match) memberRefreshToken = match[1];

    if (data.data?.accessToken) memberToken = data.data.accessToken;

    const passed =
      res.status === 200 &&
      data.success === true &&
      !!data.data?.accessToken &&
      hasRefreshCookie;

    record(
      'TẦNG 4.1: Đăng nhập & Cấp phát HttpOnly Refresh Token',
      passed,
      `HTTP ${res.status} | Set-Cookie refresh_token: ${hasRefreshCookie}`
    );
  } catch (err: unknown) {
    record('TẦNG 4.1: Đăng nhập', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 5: Login with Wrong Password (401 check)
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberEmail, password: 'WrongPassword999' }),
    });
    const data = await res.json();
    const passed = res.status === 401 && data.success === false;
    record('TẦNG 3.2: Đăng nhập sai mật khẩu trả về 401', passed, `HTTP ${res.status}`);
  } catch (err: unknown) {
    record('TẦNG 3.2: Đăng nhập sai mật khẩu', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 6: Get Current Session Profile (/api/auth/me) & Data Privacy
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const data = await res.json();
    const user = data.data;

    // Check Data Privacy (TẦNG 3.4): no hashedPassword, no 1536 float embedding array
    const hasNoSensitiveData =
      user &&
      user.passwordHash === undefined &&
      user.hashedPassword === undefined &&
      user.skillEmbedding === undefined;

    const passed = res.status === 200 && data.success === true && hasNoSensitiveData;
    record(
      'TẦNG 3.4: Bảo vệ dữ liệu nhạy cảm (không lộ passwordHash / skillEmbedding)',
      passed,
      `HTTP ${res.status} | Role: ${user?.role} | Dept: ${user?.department}`
    );
  } catch (err: unknown) {
    record('TẦNG 3.4: GET /api/auth/me', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 7: Token Rotation (/api/auth/refresh)
  // ------------------------------------------------------------
  let rotatedRefreshToken = '';
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `refresh_token=${memberRefreshToken}`,
      },
      body: JSON.stringify({ refreshToken: memberRefreshToken }),
    });
    const data = await res.json();
    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/refresh_token=([^;]+)/);
    if (match) rotatedRefreshToken = match[1];

    const passed = res.status === 200 && data.success === true && !!data.data?.accessToken;
    record(
      'TẦNG 4.2: Xoay vòng Refresh Token (Token Rotation)',
      passed,
      `HTTP ${res.status} | Nhận Access Token mới: ${Boolean(data.data?.accessToken)}`
    );
  } catch (err: unknown) {
    record('TẦNG 4.2: Token Rotation', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 8: Token Reuse Detection (Re-submitting old revoked token)
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `refresh_token=${memberRefreshToken}`, // OLD REUSED TOKEN
      },
      body: JSON.stringify({ refreshToken: memberRefreshToken }),
    });
    const data = await res.json();
    const passed =
      res.status === 401 &&
      data.success === false &&
      data.error?.code === 'REUSE_DETECTED';

    record(
      'TẦNG 4.2: Phát hiện tái sử dụng Token (REUSE_DETECTED) & Hủy phiên',
      passed,
      `HTTP ${res.status} | Code: ${data.error?.code}`
    );
  } catch (err: unknown) {
    record('TẦNG 4.2: Token Reuse Detection', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 9: RBAC Enforcement - Member Cannot View All Users (GET /api/users)
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/users`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    const data = await res.json();
    const passed = res.status === 403 && data.success === false;
    record(
      'TẦNG 3.3: RBAC chặn MEMBER xem danh sách toàn bộ nhân sự',
      passed,
      `HTTP ${res.status} (Forbidden)`
    );
  } catch (err: unknown) {
    record('TẦNG 3.3: RBAC Member GET /api/users', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 10: RBAC Leader Can View All Users (GET /api/users)
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/users?page=1&limit=5`, {
      headers: { Authorization: `Bearer ${leaderToken}` },
    });
    const data = await res.json();
    const passed =
      res.status === 200 &&
      data.success === true &&
      Array.isArray(data.data?.users) &&
      data.data?.pagination?.total >= 2;

    record(
      'TẦNG 3.3: LEADER xem danh bạ nhân sự & phân trang',
      passed,
      `HTTP ${res.status} | Tổng nhân sự: ${data.data?.pagination?.total}`
    );
  } catch (err: unknown) {
    record('TẦNG 3.3: LEADER GET /api/users', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 11: Member Cannot Tamper Department/Level on PUT /api/users
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/users`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        department: 'DEVOPS', // Attempt to escalate
        level: 'SENIOR',      // Attempt to escalate
        skills: ['React', 'Next.js', 'TypeScript', 'Tailwind'],
        bioSummary: 'Updated profile by member',
      }),
    });
    const data = await res.json();
    // Department and Level must NOT be changed to DEVOPS/SENIOR
    const passed =
      res.status === 200 &&
      data.data?.department === 'FRONTEND' &&
      data.data?.level === 'JUNIOR' &&
      data.data?.skills?.includes('Tailwind');

    record(
      'TẦNG 3.3: Cưỡng chế phân quyền Member không được đổi Department/Level',
      passed,
      `Dept giữ nguyên: ${data.data?.department} | Level giữ nguyên: ${data.data?.level}`
    );
  } catch (err: unknown) {
    record('TẦNG 3.3: Member escalate test', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 12: Leader Profile Update & Vector Revision Handling
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/users`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${leaderToken}`,
      },
      body: JSON.stringify({
        skills: ['PostgreSQL', 'Docker', 'pgvector', 'Microservices', 'FastAPI'],
        bioSummary: 'Experienced Tech Lead & System Architect',
      }),
    });
    const data = await res.json();
    const passed =
      res.status === 200 &&
      data.success === true &&
      data.data?.profileRevision >= 1;

    record(
      'TẦNG 4.3 & 5.1: Cập nhật hồ sơ & Quản trị phiên bản Revision / Vector',
      passed,
      `HTTP ${res.status} | Profile Rev: ${data.data?.profileRevision} | Stale: ${data.data?.isEmbeddingStale}`
    );
  } catch (err: unknown) {
    record('TẦNG 4.3: Leader profile update', false, String(err));
  }

  // ------------------------------------------------------------
  // TEST 13: Logout (/api/auth/logout)
  // ------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `refresh_token=${rotatedRefreshToken}`,
      },
    });
    const data = await res.json();
    const passed = res.status === 200 && data.success === true;
    record('TẦNG 4.1: Đăng xuất & Thu hồi phiên làm việc', passed, `HTTP ${res.status}`);
  } catch (err: unknown) {
    record('TẦNG 4.1: Đăng xuất', false, String(err));
  }

  // ------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;

  console.log(`\n============================================================`);
  console.log(`🎯 KẾT QUẢ ĐÁNH GIÁ NGUYÊN TẮC DEFINITION OF DONE (MODULE 1):`);
  console.log(`Đạt: ${passedCount}/${totalCount} bài kiểm thử`);
  if (passedCount === totalCount) {
    console.log(`🏆 TẤT CẢ TIÊU CHÍ DoD CỦA MODULE 1 ĐÃ ĐẠT CHUẨN XUẤT SẮC!`);
  } else {
    console.log(`⚠️ Có ${totalCount - passedCount} bài kiểm thử chưa đạt.`);
  }
  console.log(`============================================================\n`);
}

runVerification();

