# AI SPECIFICATION PROMPT: MODULE 1 (AUTH & TALENT PROFILE - PRODUCTION GRADE)

> **Mục tiêu:** Xây dựng hoàn chỉnh tầng Backend API cho Phân hệ Xác thực (Authentication), Quản lý Phiên (Session/Token Rotation with Grace Period), Phân quyền (RBAC Middleware) và Hồ sơ Năng lực (Talent Profile) theo kiến trúc Next.js App Router (Route Handlers) và Prisma ORM.
> **Yêu cầu kỹ thuật:** Đảm bảo khả năng tương thích 100% với Frontend (React Hook Form, TanStack Query), loại bỏ triệt để hiện tượng văng phiên khi F5 tải lại trang và tối ưu hóa thời gian phản hồi API dưới 50ms.

---

## 1. NGUYÊN TẮC THIẾT KẾ & BẢO MẬT BẮT BUỘC

1. **Chuẩn hóa Phản hồi (Uniform Envelope & Form Validation):**
* Thành công (2xx):json
{
"success": true,
"data": { ... },
"message": "Thông báo tùy chọn"
}
```

```


* Thất bại (4xx, 5xx):
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | INTERNAL_ERROR",
    "message": "Thông báo lỗi tổng quan",
    "fieldErrors": {
      "email": "Email không đúng định dạng chuẩn",
      "password": "Mật khẩu phải chứa tối thiểu 8 ký tự"
    }
  }
}

```




2. **Cơ chế Khoảng đệm an toàn cho Token Rotation (Grace Period = 15s):**
* Khi client gửi đồng thời nhiều request lúc Access Token hết hạn, request đầu tiên sẽ thu hồi Refresh Token cũ và tạo cặp token mới.
* Nếu các request tiếp theo gửi lại token vừa bị thu hồi trong vòng 15 giây (và lý do thu hồi là `ROTATED`), hệ thống **không được coi là xâm nhập (Reuse Attack)** mà trả về token mới đã sinh. Chỉ kích hoạt cơ chế khóa tài khoản/hủy token family nếu token bị dùng lại sau 15 giây.


3. **Vector hóa Bất đồng bộ Không chặn luồng (Non-blocking Vectorization):**
* Tại API cập nhật profile: Lưu thông tin văn bản vào CSDL trong 30ms, phản hồi ngay `200 OK` cho Frontend.
* Việc gọi OpenAI sinh véc-tơ 1536 chiều được đẩy xuống xử lý ngầm (background promise). Khi hoàn thành mới dùng Raw SQL cập nhật vào `skill_embedding` và gán `embedding_revision = profile_revision`.


4. **Tuân thủ Cơ sở dữ liệu Thực tế:**
* Tuyệt đối không chèn dữ liệu vào các cột `GENERATED ALWAYS AS ... STORED` (`is_embedding_stale`, `search_vector`).
* Mọi thao tác cập nhật `skill_embedding` bắt buộc dùng `prisma.$executeRaw` với cú pháp ép kiểu `${vectorString}::vector`.
* Thiết lập `SET LOCAL app.actor_id = '<current_user_id>'` trước các lệnh update profile để trigger audit log ghi nhận đúng người thực hiện.



---

## 2. PHẠM VI TỆP TIN TRIỂN KHAI

AI Assistant cần triển khai mã nguồn vào đúng các tệp tin theo cấu trúc dự án:

* `src/lib/prisma.ts`: Singleton Prisma Client tránh cạn kiệt connection pool.
* `src/lib/auth.ts`: Băm mật khẩu (`bcryptjs`), tạo/verify JWT bằng `jose`, tạo mã băm SHA-256 cho Refresh Token.
* `src/lib/openai.ts`: Hàm gọi OpenAI API (`text-embedding-3-small`) sinh véc-tơ 1536 chiều với timeout an toàn 5000ms.
* `src/types/index.ts`: Zod Schemas, DTOs và định dạng phản hồi chuẩn (`ApiResponse`).
* `src/middleware.ts`: Next.js Edge Middleware chặn `/api/*` (ngoại trừ whitelist), xác thực Bearer Token và gán headers định danh.
* `src/app/api/auth/register/route.ts`: Endpoint `POST` đăng ký người dùng mới.
* `src/app/api/auth/login/route.ts`: Endpoint `POST` xác thực mật khẩu, cấp Access Token và gán Refresh Token vào HttpOnly Cookie.
* `src/app/api/auth/refresh/route.ts`: Endpoint `POST` xoay vòng Refresh Token có xử lý Grace Period chống nghẽn phiên.
* `src/app/api/auth/logout/route.ts`: Endpoint `POST` thu hồi phiên và xóa Cookie.
* `src/app/api/auth/me/route.ts`: Endpoint `GET` lấy toàn bộ thông tin phiên làm việc, hồ sơ cá nhân và quyền hạn người dùng.
* `src/app/api/users/route.ts`: Endpoint `GET` lấy danh sách nhân sự (lọc/phân trang) và `PUT` cập nhật hồ sơ năng lực (xử lý bất đồng bộ véc-tơ).

---

## 3. CHI TIẾT KỸ THUẬT CÁC TỆP TIN CỐT LÕI

### 3.1. `src/types/index.ts`

Cần định nghĩa đầy đủ:

* `ApiResponse<T>`: Cấu trúc envelope chuẩn.
* Các Enum chuẩn hóa: `Role`, `Department`, `Level`.
* Zod Schemas:
* `LoginSchema`: Validate `email` chuẩn RFC 5322, `password` tối thiểu 8 ký tự.
* `RegisterSchema`: Validate `email`, `password`, `fullName` (2–100 ký tự), `department` (Enum), `level` (Enum).
* `UpdateProfileSchema`: Validate `department` (optional), `level` (optional), `skills` (array string), `bioSummary` (string, max 1000 ký tự).


* DTOs:
* `UserResponseDto`: Bao gồm `id`, `email`, `fullName`, `role`, `department`, `level`, `skills`, `bioSummary`, `isEmbeddingStale`. **Tuyệt đối loại trừ `hashedPassword`, `skillEmbedding`, và `searchVector**`.
* `AuthMeDto`: Mở rộng từ `UserResponseDto` có thêm trường `permissions: { canDecomposeProject: boolean, canDispatch: boolean, canApproveTask: boolean }`.



### 3.2. `src/lib/auth.ts`

* `hashPassword(password: string): Promise<string>`: Dùng `bcryptjs` với salt rounds = 10.
* `comparePassword(plain: string, hashed: string): Promise<boolean>`.
* `createAccessToken(payload: { userId: string; email: string; role: string; authVersion: number }): Promise<string>`:
* Sử dụng thư viện `jose.SignJWT`.
* Ký bằng `JWT_ACCESS_SECRET` dạng `Uint8Array`, thuật toán `HS256`, thời hạn sống `1h`.


* `generateRefreshToken(): string`: Sinh chuỗi hex 64 ký tự bằng `crypto.randomBytes(32).toString('hex')`.
* `hashRefreshToken(token: string): string`: Tính mã băm SHA-256 để lưu trữ an toàn trong CSDL.
* `verifyAccessToken(token: string)`: Giải mã và kiểm tra hạn dùng bằng `jose.jwtVerify`.

### 3.3. `src/lib/openai.ts`

* Khởi tạo `OpenAI` client với API key từ `process.env.OPENAI_API_KEY`.
* `generateProfileEmbedding(data: { department: string; level: string; skills: string[]; bioSummary?: string | null }): Promise<number[] | null>`:
* Chuỗi ngữ cảnh:
`Context = "Phòng ban: " + data.department + " | Cấp bậc: " + data.level + " | Kỹ năng: " + data.skills.join(", ") + " | Kinh nghiệm: " + (data.bioSummary || "")`
* Gọi OpenAI API model `text-embedding-3-small`, timeout 5000ms.
* Nếu xảy ra lỗi mạng hoặc timeout: Ghi log lỗi và trả về `null` (để CSDL duy trì `is_embedding_stale = true` mà không làm gián đoạn luồng nghiệp vụ).



### 3.4. `src/middleware.ts`

* Matcher áp dụng: `['/api/:path*']`.
* Whitelist các route công khai: `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`, `/api/health`.
* Trích xuất token từ Header `Authorization: Bearer <token>` hoặc Cookie `access_token`.
* Giải mã token bằng `verifyAccessToken`. Nếu token không hợp lệ hoặc hết hạn: Trả về HTTP 401 Unauthorized kèm error envelope.
* Chuyển tiếp các thông tin định danh vào request headers:
* `x-user-id`: payload.userId
* `x-user-email`: payload.email
* `x-user-role`: payload.role
* `x-auth-version`: payload.authVersion



---

## 4. CHI TIẾT LOGIC XỬ LÝ CÁC ROUTE HANDLERS

### 4.1. `POST /api/auth/register` (`src/app/api/auth/register/route.ts`)

1. Validate body qua `RegisterSchema`. Nếu lỗi, trả về HTTP 400 kèm `fieldErrors`.
2. Kiểm tra email trong bảng `users`. Nếu tồn tại $\to$ trả về HTTP 409 Conflict.
3. Băm mật khẩu.
4. Chạy `prisma.$transaction`:
* Tạo bản ghi mới trong bảng `users`.
* Tạo bản ghi liên kết trong `user_talent_profiles` với các giá trị phòng ban và cấp bậc ban đầu.


5. Trả về HTTP 201 Created kèm thông tin người dùng cơ bản.

### 4.2. `POST /api/auth/login` (`src/app/api/auth/login/route.ts`)

1. Validate body qua `LoginSchema`. Nếu lỗi, trả về HTTP 400 kèm `fieldErrors`.
2. Truy vấn user theo email (kèm `talentProfile`). Nếu không tìm thấy hoặc sai mật khẩu $\to$ trả về HTTP 401.
3. Kiểm tra `user.isActive`. Nếu `false` $\to$ trả về HTTP 403 Forbidden.
4. Cấp Access Token (1h).
5. Sinh Refresh Token thô, tính SHA-256 hash và tạo bản ghi trong bảng `user_tokens` (hạn 30 ngày).
6. Thiết lập Cookie `refresh_token`: `HttpOnly`, `Secure` (nếu production), `SameSite=Strict`, `Path=/api/auth`.
7. Trả về HTTP 200 OK kèm `accessToken` và thông tin user.

### 4.3. `POST /api/auth/refresh` (`src/app/api/auth/refresh/route.ts`)

1. Đọc `refresh_token` từ Cookie. Nếu thiếu $\to$ HTTP 401.
2. Tính hash SHA-256 và tìm trong bảng `user_tokens`.
3. **Xử lý Grace Period & Phát hiện Xâm nhập:**
* Nếu tìm thấy token nhưng trường `revoked_at` KHÔNG NULL:
* Tính khoảng cách thời gian từ lúc thu hồi đến hiện tại: $\Delta t = \text{NOW}() - \text{revoked\_at}$.
* Nếu $\Delta t \le 15$ giây và `revoke_reason === 'ROTATED'`: Đây là request gửi đồng thời từ client khi F5. Tìm token mới nhất trong cùng `token_family_id` và cấp lại Access Token mới mà không khóa tài khoản.
* Nếu $\Delta t > 15$ giây hoặc token bị thu hồi do nguyên nhân khác: Lập tức cập nhật thu hồi toàn bộ `token_family_id` (`revoke_reason = 'REUSE_DETECTED'`) và trả về HTTP 401.




4. Kiểm tra hết hạn: Nếu `expires_at < NOW()` $\to$ HTTP 401.
5. Kiểm tra user: Nếu `user.isActive === false` $\to$ HTTP 403.
6. **Xoay vòng Token:**
* Thu hồi token hiện tại: `revoked_at = NOW()`, `revoke_reason = 'ROTATED'`.
* Sinh token mới, lưu vào `user_tokens` với cùng `token_family_id`.
* Tạo Access Token mới.


7. Cập nhật lại Cookie và trả về HTTP 200 OK kèm Access Token mới.

### 4.4. `GET /api/auth/me` (`src/app/api/auth/me/route.ts`)

1. Đọc header `x-user-id` và `x-auth-version` từ middleware.
2. Truy vấn user và `talentProfile`.
3. Kiểm tra tính hợp lệ: Nếu `user.authVersion !== authVersion` hoặc `user.isActive === false` $\to$ HTTP 401 (buộc đăng nhập lại).
4. Tính toán quyền hạn (Permissions Map):
* `canDecomposeProject`: `['ADMIN', 'PM', 'LEADER'].includes(user.role)`
* `canDispatch`: `['ADMIN', 'PM', 'LEADER'].includes(user.role)`
* `canApproveTask`: `['ADMIN', 'PM', 'LEADER'].includes(user.role)`


5. Trả về HTTP 200 OK kèm đối tượng `AuthMeDto` đầy đủ để Frontend khởi tạo phiên ngay lập tức.

### 4.5. `POST /api/auth/logout` (`src/app/api/auth/logout/route.ts`)

1. Đọc `refresh_token` từ Cookie.
2. Nếu có token: Tính hash và cập nhật bản ghi trong `user_tokens`: `revoked_at = NOW()`, `revoke_reason = 'LOGOUT'`.
3. Xóa Cookie `refresh_token` trên client.
4. Trả về HTTP 200 OK.

### 4.6. `GET /api/users` (`src/app/api/users/route.ts`)

1. Đọc header `x-user-role`. Yêu cầu quyền: `ADMIN`, `PM` hoặc `LEADER`. Nếu là `MEMBER` $\to$ HTTP 403.
2. Nhận query params: `page` (default 1), `limit` (default 10), `department`, `level`.
3. Truy vấn danh sách users kèm `talentProfile` (loại bỏ các trường nhạy cảm).
4. Trả về HTTP 200 OK kèm metadata phân trang.

### 4.7. `PUT /api/users` (`src/app/api/users/route.ts`)

1. Đọc headers `x-user-id` và `x-user-role`.
2. Validate body qua `UpdateProfileSchema`. Nếu lỗi, trả về HTTP 400 kèm `fieldErrors`.
3. Kiểm tra quyền hạn:
* Nếu `role === 'MEMBER'`: Bắt buộc `targetUserId === currentUserId`. Tự động loại bỏ `department` và `level`, chỉ cho phép cập nhật `skills` và `bioSummary`.
* Nếu `role === 'ADMIN'` hoặc `'PM'`: Cho phép cập nhật toàn bộ.


4. Chạy `prisma.$transaction`:
* Gán actor ID cho trigger kiểm toán:
`await tx.$executeRawUnsafe("SET LOCAL app.actor_id = '" + currentUserId + "'");`
* Cập nhật thông tin văn bản trong bảng `user_talent_profiles`. (Trigger CSDL sẽ tự động tăng `profile_revision`).


5. Đọc lại bản ghi để lấy giá trị `profile_revision` mới nhất.
6. **Kích hoạt Xử lý Ngầm (Non-blocking Vectorization):**
* Đẩy việc gọi AI xuống chạy bất đồng bộ trong background:
```typescript
(async () => {
  try {
    const vector = await generateProfileEmbedding({
      department: updatedProfile.department,
      level: updatedProfile.level,
      skills: updatedProfile.skills,
      bioSummary: updatedProfile.bioSummary,
    });

    if (vector) {
      const vectorStr = `[${vector.join(",")}]`;
      await prisma.$executeRaw`
        UPDATE user_talent_profiles
        SET skill_embedding = ${vectorStr}::vector,
            embedding_revision = ${observedRevision},
            last_embedded_at = CURRENT_TIMESTAMP
        WHERE user_id = ${targetUserId}::uuid
          AND profile_revision = ${observedRevision}
      `;
    }
  } catch (err) {
    console.error("[Background Embedding Error]:", err);
  }
})();

```




7. Trả về HTTP 200 OK ngay lập tức (dưới 50ms) cho Frontend kèm thông báo: *"Cập nhật hồ sơ thành công. Dữ liệu tìm kiếm thông minh đang được đồng bộ ngầm."*

---

## 5. TIÊU CHÍ NGHIỆM THU ĐẦU RA (DEFINITION OF DONE)

* [ ] Lệnh `npx tsc --noEmit` chạy thành công tuyệt đối, không có lỗi kiểu dữ liệu.
* [ ] Không có câu lệnh Prisma nào cố tình can thiệp vào hai cột `is_embedding_stale` và `search_vector`.
* [ ] Gửi body không hợp lệ nhận đúng HTTP 400 kèm cấu trúc `fieldErrors` tương thích với React Hook Form.
* [ ] Khi F5 client gửi đồng thời nhiều request refresh token, hệ thống xử lý mượt mà trong Grace Period 15 giây mà không hủy phiên người dùng.
* [ ] Endpoint `GET /api/auth/me` trả về đầy đủ thông tin định danh, hồ sơ và bảng permissions.
* [ ] API `PUT /api/users` phản hồi tức thì dưới 50ms; véc-tơ 1536 chiều được đồng bộ ngầm an toàn vào cột `skill_embedding` trong PostgreSQL.
* [ ] Bảng `talent_audit_logs` tự động ghi nhận đúng lịch sử thay đổi kèm ID người thực hiện.

```

