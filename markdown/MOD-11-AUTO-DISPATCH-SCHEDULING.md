# MODULE ĐẶC TẢ KỸ THUẬT: MOD-11 - AI AUTO-DISPATCH & CALENDAR SCHEDULING (HUMAN-IN-THE-LOOP)

## 1. MỤC TIÊU & TỔNG QUAN NGHIỆP VỤ
Module này giải quyết bài toán phân công công việc thông minh sau khi AI hoàn tất phân rã đồ thị nhiệm vụ (Task Decomposition DAG từ MOD-02):
1. **AI Matchmaking Engine:** Đề xuất tự động thành viên phù hợp nhất cho từng tác vụ dựa trên độ tương đồng ngữ nghĩa vector kỹ năng (MOD-01, MOD-03), xếp hạng Elo năng lực (MOD-06), và cân bằng tải công việc (Workload Balancing).
2. **Auto Calendar Scheduling:** Đề xuất khung thời gian (`start_date`, `due_date`) dựa trên thuật toán đường găng CPM (Early Start / Early Finish) và tránh xung đột lịch trình cá nhân.
3. **Human-in-the-Loop Review:** Cung cấp API xem trước (Preview) cho Trưởng nhóm (Leader) kiểm tra. Leader có quyền chấp nhận toàn bộ hoặc chỉnh sửa tay thành viên/thời gian trước khi xác nhận.
4. **Calendar Persistence:** Ghi nhận hàng loạt vào CSDL, cập nhật bảng nhiệm vụ và đồng bộ hóa lịch biểu công việc.

---

## 2. KIẾN TRÚC & DỮ LIỆU ĐẦU VÀO / ĐẦU RA

### 2.1. Công thức Xếp hạng Ghép cặp Thành viên (Match Score)
Với mỗi tác vụ $T$ và thành viên dự án $M$, điểm phù hợp được tính như sau:
$$\text{Score}(T, M) = w_1 \cdot \text{CosineSim}(\vec{V}_T, \vec{V}_M) + w_2 \cdot \text{NormElo}(M) - w_3 \cdot \text{WorkloadPenalty}(M)$$
- $\vec{V}_T$: `task_embedding` của nhiệm vụ (1536 chiều).
- $\vec{V}_M$: `profile_embedding` của thành viên từ `user_talent_profiles`.
- $\text{NormElo}(M)$: Điểm kỹ năng chuẩn hóa về thang $[0, 1]$ từ bảng `user_skill_ratings`.
- $\text{WorkloadPenalty}(M)$: Tỷ lệ phạt dựa trên số lượng task đang ở trạng thái `IN_PROGRESS` của thành viên.
- Trọng số đề xuất: $w_1 = 0.5$, $w_2 = 0.3$, $w_3 = 0.2$. Điểm cuối cùng quy đổi về thang $0 - 100\%$.

### 2.2. Thuật toán Xếp lịch biểu (CPM Timeline Scheduling)
- Điểm mốc: `project.start_date` (hoặc thời điểm hiện tại nếu dự án đang chạy).
- Nhiệm vụ không có phụ thuộc (`dependsOn = []`): Bắt đầu tại mốc thời gian sớm nhất khả dụng trong giờ làm việc (08:00 - 17:00, bỏ qua Thứ 7, CN).
- Nhiệm vụ phụ thuộc: Bắt đầu ngay sau khi toàn bộ nhiệm vụ tiền đề hoàn tất theo kết quả tính toán đường găng CPM từ MOD-02.

---

## 3. ĐẶC TẢ API ENDPOINTS CẦN XÂY DỰNG TẠI `workspace-api`

### Endpoint 1: Sinh Kế Hoạch Đề Xuất Phân Công & Lịch Trình (Preview)
- **Đường dẫn:** `POST /api/projects/:id/auto-dispatch-plan`
- **Quyền hạn:** `LEADER`, `ADMIN` (xác thực qua JWT RBAC).
- **Quy trình xử lý:**
  1. Kiểm tra quyền sở hữu dự án hoặc vai trò Leader.
  2. Truy vấn danh sách tasks chưa được phân công (`assignee_id IS NULL`) hoặc vừa được phân rã của dự án.
  3. Lấy danh sách thành viên hợp lệ trong dự án (`project_members`), kèm hồ sơ năng lực (`user_talent_profiles`) và điểm Elo (`user_skill_ratings`).
  4. Thực thi thuật toán tính điểm ghép cặp và xếp lịch dự kiến.
  5. Trả về kế hoạch đề xuất hoàn chỉnh (không ghi trực tiếp vào DB, chỉ trả về để Preview).
- **Cấu trúc dữ liệu phản hồi (Response):**
  ```json
  {
    "success": true,
    "data": {
      "projectId": "string (uuid)",
      "totalTasks": 5,
      "estimatedCompletionDate": "2026-11-05T17:00:00Z",
      "assignments": [
        {
          "taskId": "string (uuid)",
          "taskTitle": "Xây dựng hạ tầng Database PostgreSQL",
          "estimatedHours": 8,
          "isCriticalPath": true,
          "suggestedAssignee": {
            "userId": "string (uuid)",
            "fullName": "Nguyễn Văn A",
            "email": "dev.a@company.com",
            "matchScore": 92,
            "matchReason": "Chuyên môn Database cao (Elo 1450), hiện chỉ có 1 task đang chạy"
          },
          "schedule": {
            "startDate": "2026-10-26T08:00:00Z",
            "dueDate": "2026-10-26T17:00:00Z"
          },
          "availableCandidates": [
            { "userId": "uuid-1", "fullName": "Nguyễn Văn A", "matchScore": 92 },
            { "userId": "uuid-2", "fullName": "Trần Thị B", "matchScore": 75 }
          ]
        }
      ]
    }
  }

```

### Endpoint 2: Phê Duyệt & Đồng Bộ Hóa Lịch Trình (Confirm & Commit)

* **Đường dẫn:** `POST /api/projects/:id/confirm-assignments`
* **Quyền hạn:** `LEADER`, `ADMIN`.
* **Cấu trúc yêu cầu (Request Body):**
```json
{
  "confirmations": [
    {
      "taskId": "string (uuid)",
      "finalAssigneeId": "string (uuid)",
      "startDate": "2026-10-26T08:00:00Z",
      "dueDate": "2026-10-26T17:00:00Z",
      "overrideReason": "Leader chủ động phân công" // Tùy chọn nếu có sửa tay
    }
  ]
}

```


* **Quy trình xử lý (Database Transaction):**
1. Mở Prisma Transaction `$transaction`.
2. Duyệt qua từng bản ghi:
* Cập nhật bảng `tasks`: `assignee_id = finalAssigneeId`, `start_date = startDate`, `due_date = dueDate`, `status = 'TODO'`.
* Tạo bản ghi trong bảng `dispatch_history` lưu vết phân công (ghi nhận rõ AI gợi ý hay do Leader chỉ định).
* (Tùy chọn) Ghi bản ghi vào bảng sự kiện lịch để phục vụ truy vấn Calendar nhanh.


3. Trả về kết quả thành công và tổng số task đã được kích hoạt lên lịch.



---

## 4. DỮ LIỆU ĐỐI SOÁT CƠ SỞ DỮ LIỆU (DATABASE INTEGRITY)

Sau khi gọi API xác nhận:

1. `tasks.assignee_id`: Không được rỗng (`NOT NULL`).
2. `tasks.start_date` & `tasks.due_date`: Phải là định dạng ngày hợp lệ và `due_date >= start_date`.
3. `dispatch_history`: Tăng thêm $N$ bản ghi tương ứng với $N$ task được duyệt.
4. `task_status_history`: Ghi nhận log khởi tạo trạng thái `TODO` cho từng nhiệm vụ.

---

## 5. THỰC HIỆN & KIỂM THỬ TÍCH HỢP

1. Tạo service tính toán tại `src/services/auto-dispatch-scheduler.service.ts`.
2. Tạo 2 Route Handlers tại:
* `src/app/api/projects/[id]/auto-dispatch-plan/route.ts`
* `src/app/api/projects/[id]/confirm-assignments/route.ts`


3. Tạo kịch bản kiểm thử tự động tại `scripts/test-auto-dispatch-flow.ts` để kiểm tra luồng: Tạo dự án $\to$ Phân rã DAG $\to$ Sinh kế hoạch gợi ý $\to$ Leader sửa đổi 1 người $\to$ Xác nhận $\to$ Đối soát ngày tháng và người nhận trong CSDL.
4. Chạy `npx tsc --noEmit` để đảm bảo không có bất kỳ lỗi biên dịch nào.

```

