Bạn có thể tạo một file có tên **`markdown/00_DEFINITION_OF_DONE.md`** (hoặc `docs/MODULE_VERIFICATION_CHECKLIST.md`) trong thư mục dự án.

File này đóng vai trò là **Bộ tiêu chuẩn nghiệm thu & Kiểm thử chất lượng (Quality Assurance & Verification Framework)** dùng chung cho toàn bộ dự án. Bất kỳ module nào sau khi AI sinh code xong chỉ được đánh dấu là **"HOÀN THÀNH"** khi và chỉ khi vượt qua đầy đủ 6 tầng kiểm tra trong bảng kiểm chuẩn dưới đây:

---

# BẢNG TIÊU CHUẨN NGHIỆM THU DỰ ÁN (DEFINITION OF DONE - DoD)

> **Mục đích:** Quy chuẩn hóa quy trình kiểm thử và nghiệm thu kỹ thuật cho từng module trong hệ thống Smart Workspace, loại bỏ hoàn toàn "ảo giác hoàn thành" từ mã nguồn do AI tạo sinh và bảo đảm hệ thống sẵn sàng vận hành thực tế.

---

## TẦNG 1: BIÊN DỊCH VÀ SỨC KHỎE MÃ NGUỒN (CODE HEALTH & BUILD)

Trước khi kiểm tra logic nghiệp vụ, toàn bộ mã nguồn phải vượt qua các bài kiểm tra cú pháp và kiểu dữ liệu tĩnh:

* [ ] **Kiểm tra kiểu dữ liệu TypeScript (Zero Type Errors):**
Chạy lệnh `npx tsc --noEmit`. Không được xuất hiện bất kỳ cảnh báo hoặc lỗi đỏ nào.
* [ ] **Quy chuẩn cấm sử dụng kiểu `any`:**
Toàn bộ Request Body, Query Params, Response Payload và Model Prisma phải được định kiểu tường minh qua TypeScript Interfaces hoặc Zod Schemas.
* [ ] **Kiểm tra biên dịch dự án (Production Build):**
Chạy lệnh `npm run build`. Ứng dụng Next.js phải build thành công toàn bộ các Route Handlers và Server Components mà không bị crash.
* [ ] **Biến môi trường an toàn (.env Sanitization):**
Mọi khóa bí mật (`JWT_ACCESS_SECRET`, `OPENAI_API_KEY`, `DATABASE_URL`) đều được đọc qua `process.env`. Không có bất kỳ hardcoded secret nào tồn tại trong mã nguồn.

---

## TẦNG 2: TÍNH TOÀN VẸN CƠ SỞ DỮ LIỆU (DATABASE CONTRACT)

Kiểm tra trực tiếp bên trong container PostgreSQL (`smart_workspace_postgres`) qua `psql`:

* [ ] **Đồng bộ Lược đồ (Schema Sync):**
Cấu trúc bảng trong PostgreSQL khớp 100% với `prisma/schema.prisma`. Chạy `npx prisma db pull` không phát hiện sự sai lệch cấu trúc ngoài ý muốn.
* [ ] **Cưỡng chế toàn vẹn dữ liệu (Constraints Validation):**
* Thử chèn email sai định dạng $\rightarrow$ CSDL ném lỗi `chk_users_email_format`.
* Thử chèn role/department nằm ngoài Enum $\rightarrow$ CSDL ném lỗi `chk_...`.
* Thử tạo quan hệ phụ thuộc tự trỏ vào chính mình (`predecessor_id = successor_id`) $\rightarrow$ CSDL ném lỗi `chk_no_self_dependency`.


* [ ] **Cột sinh tự động (Generated Columns Protection):**
Không có bất kỳ câu lệnh ORM nào cố tình chèn dữ liệu vào các cột `GENERATED ALWAYS AS ... STORED` (`search_vector`, `is_embedding_stale`).
* [ ] **Kích hoạt Trigger tự động:**
* Cập nhật thông tin nhân sự $\rightarrow$ Cột `updated_at` và `profile_revision` tự động nhảy số.
* Sửa đổi kỹ năng hoặc tiểu sử $\rightarrow$ Cờ `is_embedding_stale` tự động chuyển sang `true`.
* Bảng `talent_audit_logs` tự động ghi nhận bản ghi với đúng `changed_by`.



---

## TẦNG 3: CHUẨN GIAO THỨC HTTP VÀ PHÂN QUYỀN (API & RBAC CONTRACT)

Mọi API endpoint phải được kiểm thử qua Postman / Thunder Client / cURL:

* [ ] **Định dạng phản hồi chuẩn hóa (Uniform Envelope Response):**
* Khi thành công: Trả về `{ success: true, data: { ... }, message?: string }`.
* Khi thất bại: Trả về `{ success: false, error: { code: string, message: string } }`.


* [ ] **Mã trạng thái HTTP đúng chuẩn kỹ thuật:**
* Sai định dạng dữ liệu đầu vào (Zod validation fail) $\rightarrow$ `400 Bad Request`.
* Thiếu token, sai token, hoặc token hết hạn $\rightarrow$ `401 Unauthorized`.
* Người dùng hợp lệ nhưng không đủ quyền hạn thực thi $\rightarrow$ `403 Forbidden`.
* Không tìm thấy ID tài nguyên $\rightarrow$ `404 Not Found`.
* Trùng lặp khóa duy nhất (như email) $\rightarrow$ `409 Conflict`.


* [ ] **Xác thực Phân quyền thực tế (RBAC Real-test):**
* Dùng Access Token của `MEMBER` gọi các API điều phối (`/api/projects/:id/decompose`, `/api/projects/:id/dispatch/approve`) $\rightarrow$ Phải nhận đúng mã `403 Forbidden`.
* Dùng Access Token của `MEMBER` thử sửa `department` hoặc `level` trong hồ sơ của chính mình $\rightarrow$ Bị hệ thống từ chối hoặc tự động loại bỏ khỏi payload cập nhật.


* [ ] **Bảo mật dữ liệu nhạy cảm (Data Privacy):**
Payload JSON trả về client ở mọi endpoint tuyệt đối không chứa `hashedPassword`, mảng véc-tơ thô `skill_embedding` (1536 số thực), hoặc `search_vector`.

---

## TẦNG 4: BỘ TIÊU CHUẨN NGHIỆM THU THEO TỪNG MODULE CỤ THỂ

| Module | Nghiệp vụ cốt lõi | Bài kiểm tra nghiệm thu bắt buộc (Pass/Fail Test) |
| --- | --- | --- |
| **Module 1**<br>

<br>*(Auth & Talent)* | Đăng nhập, Token Rotation & Vector hóa hồ sơ | 1. Đăng ký & Đăng nhập cấp đúng Access Token (1h) và Set-Cookie `refreshToken` (`HttpOnly`, `SameSite=Strict`).<br>

<br>2. Gửi refresh token cũ đã bị thu hồi $\rightarrow$ Hệ thống phát hiện `REUSE_DETECTED` và hủy toàn bộ phiên của family đó.<br>

<br>3. Cập nhật hồ sơ nhân sự $\rightarrow$ Cột `skill_embedding` trong PostgreSQL có dữ liệu véc-tơ không rỗng (`IS NOT NULL`) và `is_embedding_stale = false`. |
| **Module 2**<br>

<br>*(DAG & CPM)* | Phân rã dự án & Tính toán đường găng | 1. Nhập mô tả dự án $\rightarrow$ OpenAI Structured Outputs trả về danh sách task và quan hệ phụ thuộc.<br>

<br>2. Thuật toán Kahn chạy trên backend phát hiện và triệt tiêu chu trình khép kín $100\%$, sắp xếp đúng thứ tự tô-pô.<br>

<br>3. Thuật toán CPM tính toán $ES, EF, LS, LF, \text{Slack}$; các task có $\text{Slack} = 0$ được gán cờ `is_critical_path = true`. |
| **Module 3**<br>

<br>*(Hybrid Search)* | Tìm kiếm nhân sự lai (BM25 + pgvector qua RRF) | 1. Thực thi câu lệnh SQL CTE kết hợp GIN index và HNSW index.<br>

<br>2. Thử nghiệm với từ khóa công nghệ đặc thù (ví dụ: "Redis Sentinel", "Docker") $\rightarrow$ Thuật toán RRF ($k=60$) đưa đúng kỹ sư có kỹ năng liên quan lên Top 1–3.<br>

<br>3. Thời gian phản hồi của câu truy vấn dưới 30ms trên tập dữ liệu mẫu. |
| **Module 4**<br>

<br>*(Smart Dispatch)* | Gợi ý nhân sự có tính tải & Sinh checklist thích ứng | 1. Kiểm tra điều kiện mở khóa: Chỉ các task có toàn bộ tiền nhiệm `DONE` mới xuất hiện trong danh sách điều phối.<br>

<br>2. Kỹ sư đang gánh $\ge 3$ tasks `IN_PROGRESS` bị áp dụng trọng số phạt tải, không bị dồn việc.<br>

<br>3. Giao task cho Intern/Fresher $\rightarrow$ Trường `checklist` tự động sinh 3–4 bước vi mô; giao cho Senior $\rightarrow$ Trường `checklist` giữ rỗng. |
| **Module 5**<br>

<br>*(Kanban & Flow)* | Vận hành Kanban 5 trạng thái & Quan trắc luồng | 1. Kéo thả mượt mà; Member chỉ được chuyển task của mình lên tối đa cột `REVIEW`.<br>

<br>2. Chỉ Leader/Admin mới có quyền bấm Approve chuyển task từ `REVIEW` sang `DONE`.<br>

<br>3. Tác vụ ngâm ở cột `IN_PROGRESS` quá ngưỡng bất thường IQR được tự động gắn cờ `is_blocked = true` và đưa vào danh sách cảnh báo. |
| **Module 6**<br>

<br>*(Elo & Benchmark)* | Cập nhật năng lực động & Bộ kiểm thử thực nghiệm | 1. Khi task đạt `DONE` $\rightarrow$ Điểm Elo tại kỹ năng tương ứng trong bảng `user_skill_ratings` tự động tăng.<br>

<br>2. Khi task bị reject từ `REVIEW` $\rightarrow$ Điểm Elo tự động giảm nhẹ.<br>

<br>3. Script `benchmark.py` chạy giả lập độc lập thành công trên 100 kỹ sư, xuất ra bảng ma trận Ablation Study với các chỉ số Precision@3, Makespan và Hệ số Gini. |

---

## TẦNG 5: KHẢ NĂNG CHỊU LỖI VÀ TÌNH HUỐNG BIÊN (FAULT TOLERANCE & EDGE CASES)

* [ ] **Chịu lỗi ngắt kết nối OpenAI API (Graceful Degradation):**
Ngắt kết nối mạng hoặc nhập sai `OPENAI_API_KEY` $\rightarrow$ Người dùng bấm cập nhật hồ sơ vẫn nhận phản hồi `200 OK`, dữ liệu văn bản được lưu an toàn, cờ `is_embedding_stale = true` được giữ nguyên mà không làm sập server.
* [ ] **Chống lỗi tranh chấp dữ liệu (Race Condition / Concurrency):**
Khi hai người quản lý cùng mở modal phân công một task tại cùng một thời điểm, transaction của CSDL đảm bảo task chỉ được gán cho một người duy nhất, người còn lại nhận thông báo lỗi hợp lệ.
* [ ] **Khả năng chịu tải truy vấn (Query Under Load):**
Chạy đồng thời 20 truy vấn tìm kiếm lai RRF mà PostgreSQL không bị khóa bảng (Deadlock) hoặc cạn kiệt Connection Pool.

---

