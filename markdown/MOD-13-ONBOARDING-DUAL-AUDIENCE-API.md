# MODULE ĐẶC TẢ KỸ THUẬT: MOD-13 - CẬP NHẬT TẦNG API PHÂN HÓA ĐỐI TƯỢNG (INDIVIDUAL / ENTERPRISE)

## 1. MỤC TIÊU NGHIỆP VỤ
Mở rộng kiến trúc Backend của `workspace-api` để hỗ trợ cơ chế phân tách đối tượng sử dụng ngay từ khâu đăng ký / onboarding:
1. **Phân loại Tài khoản:** Bổ sung trường định danh `accountType` (`INDIVIDUAL` dành cho học sinh, sinh viên, người dùng cá nhân; `ENTERPRISE` dành cho tổ chức, doanh nghiệp, nhóm chuyên nghiệp).
2. **Tự động Khởi tạo Workspace Cá nhân (Zero-friction Onboarding):** Nếu là `INDIVIDUAL`, hệ thống tự động sinh 1 Workspace riêng, tự phong quyền Owner/Admin mà không bắt người dùng phải trải qua các bước mời thành viên hoặc khai báo cấu trúc phòng ban rườm rà.
3. **Cơ chế Phân công Thích ứng (Bypass Approval cho Cá nhân):** Khi người dùng cá nhân tạo dự án hoặc phân rã task qua AI, hệ thống tự động gán công việc cho chính người đó và chuyển sang trạng thái `TODO` ngay lập tức, bỏ qua bước chờ Leader phê duyệt.
4. **Quản lý Thời Gian Biểu Cá nhân (Personal Availability Slots):** Hỗ trợ lưu trữ các khung giờ rảnh / bận (thời khóa biểu trên lớp, ca làm thêm) để phục vụ thuật toán xếp lịch tự động (MOD-11).

---

## 2. CẬP NHẬT DATABASE SCHEMA (`prisma/schema.prisma`)

### 2.1. Thêm Enum & Cập nhật Bảng `User`
```prisma
enum AccountType {
  INDIVIDUAL
  ENTERPRISE
}

enum SlotType {
  FREE_TIME
  BUSY_CLASS
  BUSY_EXAM
  OTHER
}

// Cập nhật model User hiện tại:
model User {
  // ... các trường hiện có (id, email, passwordHash, fullName, role, ...)
  accountType AccountType @default(INDIVIDUAL) @map("account_type")

  // Quan hệ mới:
  availabilitySlots UserAvailabilitySlot[]

  // ... các quan hệ hiện có
}

```

### 2.2. Thêm Model `UserAvailabilitySlot` (Khung giờ rảnh/bận cá nhân)

```prisma
model UserAvailabilitySlot {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  dayOfWeek Int      @map("day_of_week") // 0 (Chủ nhật) -> 6 (Thứ 7)
  startTime String   @map("start_time")   // Format "HH:mm" (ví dụ: "19:00")
  endTime   String   @map("end_time")     // Format "HH:mm" (ví dụ: "22:30")
  slotType  SlotType @default(FREE_TIME)  @map("slot_type")
  createdAt DateTime @default(now())      @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_availability_slots")
}

```

### 2.3. Cập nhật Model `Project`

```prisma
// Bổ sung cờ đánh dấu dự án cá nhân
model Project {
  // ... các trường hiện có (id, name, description, ownerId, ...)
  isPersonalMode Boolean @default(false) @map("is_personal_mode")

  // ... các quan hệ hiện có
}

```

---

## 3. ĐẶC TẢ API ENDPOINTS CẦN BỔ SUNG & CẬP NHẬT

### 3.1. Cập nhật Luồng Đăng Ký (`POST /api/auth/register`)

* **Yêu cầu mở rộng:** Cho phép client gửi thêm trường `accountType` (Tùy chọn, mặc định là `INDIVIDUAL`).
* **Logic thực thi trong Database Transaction:**
1. Tạo bản ghi `User` với `accountType` đã chọn.
2. **Nếu `accountType === 'INDIVIDUAL'`:**
* Tự động tạo 1 Workspace mặc định: `name = "Không gian của " + fullName`, `slug = "personal-" + user.id.slice(0, 8)`.
* Thêm user vào bảng `workspace_members` với quyền cao nhất (`role = 'ADMIN'` hoặc `'OWNER'`).
* Tự động tạo một dự án mẫu đầu tiên: `name = "Kế hoạch Học tập & Mục tiêu Cá nhân"`, `is_personal_mode = true`.


3. Trả về token JWT có chứa thông tin `accountType` trong payload.



### 3.2. API Quản lý Thời Gian Rảnh Cá nhân (`/api/users/me/availability`)

* **`GET /api/users/me/availability`:**
* Lấy danh sách toàn bộ các slot thời gian rảnh/bận của user hiện tại theo 7 ngày trong tuần.


* **`PUT /api/users/me/availability`:**
* Cập nhật lại toàn bộ ma trận thời gian biểu của user (thường dùng cho học sinh, sinh viên cập nhật thời khóa biểu đầu kỳ).
* Body:
```json
{
  "slots": [
    { "dayOfWeek": 1, "startTime": "19:00", "endTime": "22:00", "slotType": "FREE_TIME" },
    { "dayOfWeek": 2, "startTime": "08:00", "endTime": "11:30", "slotType": "BUSY_CLASS" }
  ]
}

```


* Thay thế toàn bộ slots cũ của user trong bảng `user_availability_slots`.



### 3.3. Cập nhật Logic Xếp Lịch & Phân Công (MOD-11 Service)

* Mở rộng tệp `src/services/auto-dispatch-scheduler.service.ts`:
* Trước khi tính toán phân công, kiểm tra: `project.isPersonalMode || user.accountType === 'INDIVIDUAL'`.
* **Nếu là Cá nhân:**
1. Bỏ qua việc tìm kiếm danh sách ứng viên (Candidate Search). Người nhận việc luôn luôn là chính `current_user_id`.
2. Kiểm tra các slot `FREE_TIME` trong `user_availability_slots` của user để xếp `startDate` và `dueDate` rơi đúng vào khung giờ rảnh, không bị đè vào giờ học.
3. Trả về kế hoạch với trạng thái sẵn sàng kích hoạt ngay.


* Khi gọi `POST /api/projects/:id/confirm-assignments` đối với dự án cá nhân: Tự động lưu task với `assignee_id = current_user_id`, `status = 'TODO'`.



---

## 4. KỊCH BẢN KIỂM THỬ XÁC THỰC (INTEGRATION TEST)

Tạo script kiểm thử độc lập tại `scripts/test-dual-audience-flow.ts`:

1. **Test 1:** Đăng ký tài khoản `INDIVIDUAL` $\to$ Kiểm tra CSDL xem đã tự động tạo Workspace cá nhân và dự án mẫu hay chưa.
2. **Test 2:** Đăng ký tài khoản `ENTERPRISE` $\to$ Xác nhận không tự động sinh Workspace cá nhân để doanh nghiệp tự cấu hình tổ chức.
3. **Test 3:** Gọi API `PUT /api/users/me/availability` thiết lập lịch rảnh buổi tối cho sinh viên $\to$ Kiểm tra bảng `user_availability_slots`.
4. **Test 4:** Tạo một task trong dự án cá nhân $\to$ Kiểm tra task được gán tự động cho chính sinh viên đó mà không yêu cầu phê duyệt phân công.

---

## 5. HƯỚNG DẪN THỰC THI CHO AGENT / DEVELOPER

1. Chỉnh sửa file `prisma/schema.prisma` theo đúng cấu trúc ở Mục 2.
2. Chạy lệnh: `npx prisma db push` để đồng bộ CSDL PostgreSQL cổng 5433.
3. Cập nhật các Route Handlers và Service tương ứng.
4. Chạy `npx tsx scripts/test-dual-audience-flow.ts` và đảm bảo toàn bộ bài test đều `PASS`.

```
