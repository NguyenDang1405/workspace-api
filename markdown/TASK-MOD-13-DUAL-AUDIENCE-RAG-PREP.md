Dưới đây là nội dung tách biệt hoàn toàn cho từng file, bạn chỉ cần sao chép từng phần vào đúng thư mục tương ứng.

---

### PHẦN 1: FILE DÀNH CHO THƯ MỤC `workspace-api`

* **Đường dẫn tạo file:** `workspace-api/markdown/TASK-MOD-13-DUAL-AUDIENCE-RAG-PREP.md`
* **Nội dung sao chép:**

```markdown
# CHỈ ĐẠO KỸ THUẬT: TRIỂN KHAI MOD-13 & CHUẨN BỊ NỀN TẢNG RAG (WORKSPACE-API)

## 1. MỤC TIÊU CẦN ĐẠT ĐƯỢC
1. Phân tách người dùng: Cá nhân/Sinh viên (`INDIVIDUAL`) và Doanh nghiệp (`ENTERPRISE`).
2. Tự động Onboarding cho `INDIVIDUAL`: Tạo sẵn 1 Workspace cá nhân và 1 Dự án mẫu đầu tiên ngay khi đăng ký.
3. Bổ sung bảng `UserAvailabilitySlot`: Quản lý thời khóa biểu/giờ rảnh cá nhân để AI tránh xếp lịch vào giờ học.
4. Tinh chỉnh Xếp lịch (MOD-11): Nếu là dự án cá nhân (`isPersonalMode = true`), tự động gán task cho chính user, đưa vào khung giờ rảnh và bỏ qua bước phê duyệt phân công.
5. Tạo sẵn bảng `ProjectKnowledgeChunk` hỗ trợ `pgvector` (1536 chiều) làm nền tảng cho RAG sau này.
6. Đồng bộ CSDL PostgreSQL cổng 5433 qua Prisma và chạy script kiểm thử.

---

## 2. NỘI DUNG CẬP NHẬT `prisma/schema.prisma`

Cập nhật trực tiếp tệp `prisma/schema.prisma` bằng các đoạn mã sau:

```prisma
// 1. Thêm các Enums mới
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

// 2. Cập nhật Model User: Thêm accountType và quan hệ tới availabilitySlots
model User {
  // ... (giữ nguyên các trường hiện có)
  accountType       AccountType            @default(INDIVIDUAL) @map("account_type")
  availabilitySlots UserAvailabilitySlot[]

  // ... (giữ nguyên các quan hệ hiện có)
}

// 3. Cập nhật Model Project: Thêm cờ isPersonalMode và quan hệ knowledgeChunks
model Project {
  // ... (giữ nguyên các trường hiện có)
  isPersonalMode  Boolean                 @default(false) @map("is_personal_mode")
  knowledgeChunks ProjectKnowledgeChunk[]

  // ... (giữ nguyên các quan hệ hiện có)
}

// 4. Thêm Model UserAvailabilitySlot (Thời khóa biểu / Giờ rảnh sinh viên)
model UserAvailabilitySlot {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  dayOfWeek Int      @map("day_of_week") // 0 (Chủ nhật) -> 6 (Thứ 7)
  startTime String   @map("start_time")   // Định dạng "HH:mm" (ví dụ "19:00")
  endTime   String   @map("end_time")     // Định dạng "HH:mm" (ví dụ "22:30")
  slotType  SlotType @default(FREE_TIME)  @map("slot_type")
  createdAt DateTime @default(now())      @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_availability_slots")
}

// 5. Thêm Model ProjectKnowledgeChunk (Chuẩn bị sẵn cho RAG)
model ProjectKnowledgeChunk {
  id         String                 @id @default(uuid()) @db.Uuid
  projectId  String                 @map("project_id") @db.Uuid
  chunkIndex Int                    @map("chunk_index")
  content    String                 @db.Text
  embedding  Unsupported("vector")? // Chứa vector 1536 chiều từ pgvector
  createdAt  DateTime               @default(now()) @map("created_at")

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@map("project_knowledge_chunks")
}

```

---

## 3. LOGIC XỬ LÝ CÁC ROUTE & SERVICES

### 3.1. Route Đăng Ký (`src/app/api/auth/register/route.ts`)

* Nhận thêm `accountType` từ request body (mặc định là `INDIVIDUAL` nếu không gửi).
* Xử lý trong một transaction:
1. Tạo `User` kèm `accountType`.
2. Nếu `accountType === 'INDIVIDUAL'`:
* Tự động tạo 1 `Workspace` mang tên `"Không gian của " + fullName`.
* Thêm user vào bảng thành viên workspace với vai trò cao nhất (`OWNER`/`ADMIN`).
* Tự động tạo 1 `Project` mẫu: `"Kế hoạch Học tập & Phát triển"`, đặt `isPersonalMode = true`.
* Thêm user vào `project_members` của dự án này.


3. Trả về JWT Token có đính kèm thông tin `accountType`.



### 3.2. Route Quản lý Thời Gian Biểu (`src/app/api/users/me/availability/route.ts`)

* `GET`: Trả về toàn bộ danh sách các slot thời gian rảnh/học tập của user đang đăng nhập.
* `PUT`: Cập nhật lại lịch rảnh (xóa sạch các slot cũ của user đó và chèn mảng slots mới gửi lên).

### 3.3. Service Xếp Lịch Tự Động (`src/services/auto-dispatch-scheduler.service.ts`)

* Kiểm tra điều kiện: Nếu `project.isPersonalMode || user.accountType === 'INDIVIDUAL'`:
1. Không cần tìm kiếm nhiều ứng viên, người nhận task duy nhất là chính `current_user_id`.
2. Đọc bảng `user_availability_slots` để lấy các khung giờ `FREE_TIME`, xếp `startDate` và `dueDate` rơi đúng vào thời gian rảnh.
3. Bỏ qua bước chờ Leader phê duyệt: Khi lưu, gán trực tiếp `assignee_id = current_user_id` và `status = 'TODO'`.



---

## 4. CÁC BƯỚC THỰC THI (CLI COMMANDS)

Chạy lần lượt các lệnh sau trong thư mục `workspace-api`:

```bash
# 1. Đồng bộ cấu trúc mới xuống PostgreSQL (Port 5433)
npx prisma db push

# 2. Sinh lại Prisma Client
npx prisma generate

```

```

---

## 3. ĐẶC TẢ TÍCH HỢP RAG TRONG TƯƠNG LAI (KHI CẦN)

Khi cần hỗ trợ tài liệu học tập hoặc quy chuẩn doanh nghiệp dài, chỉ cần tạo thêm router độc lập sau:

### Endpoint đề xuất: `POST /api/v1/rag/chunk-embed`

* **Nhiệm vụ:**
1. Nhận chuỗi văn bản tài liệu thô tải lên từ `workspace-api`.
2. Cắt nhỏ văn bản (Chunking) theo kích thước 800 tokens, độ gối đầu 150 tokens.
3. Nhúng vector cho từng đoạn qua `text-embedding-3-small`.
4. Trả về mảng dữ liệu gồm: `chunkIndex`, `content`, `embedding`.


* `workspace-api` nhận kết quả này và lưu thẳng vào bảng `project_knowledge_chunks` đã chuẩn bị sẵn ở database.

--