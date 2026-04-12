# Frontend Architecture Specification

Tài liệu này đóng vai trò là bảng thiết kế tổng thể (Specification Document) dành cho AI Coding Agents (như v0, Claude Code, Cursor) và đội ngũ Frontend, nhằm mục đích xây dựng một hệ thống Web Frontend hoàn chỉnh (Applicant Tracking System - ATS) dựa trên hệ thống Backend hiện có.

---

## 1. Phân tích Use Case & User Flow
Từ các Controller của backend (Auth, Users, Roles, Permissions, Companies, Jobs, Resumes, Subscribers, Files), chúng ta có thể làm rõ hệ thống tính năng cho các vai trò khác nhau.

### 1.1 Tính năng (Features) theo phân quyền
- **Guest (Chưa đăng nhập):**
  - Đăng ký (Register) / Đăng nhập (Login).
  - Duyệt danh sách Công ty (Companies) và Việc làm (Jobs).
  - Đăng ký nhận thông báo tuyển dụng (Subscribers).
- **Candidate (Ứng viên):**
  - Chỉnh sửa thông tin cá nhân (Profile).
  - Nộp đơn ứng tuyển: Tải file CV lên (Files) và lưu dữ liệu ứng tuyển (Resumes).
  - Quản lý lịch sử nộp CV (Resumes: `POST /by-user` hoặc GET).
- **HR / Company Admin (Nhà tuyển dụng):**
  - Quản lý thông tin Công ty (Companies).
  - Quản lý tin tuyển dụng (Jobs: Create, Update, Delete).
  - Xem và cập nhật trạng thái CV ứng viên cho các Job của công ty mình (Resumes: duyệt CV, reject CV).
- **Super Admin (Quản trị hệ thống):**
  - Quản lý Người dùng (Users).
  - Quản lý Vai trò (Roles) và Quyền hạn (Permissions).
  - Quản lý tất cả Công ty, Jobs, Resumes, Subscribers.

### 1.2 Data Flow cơ bản (Luồng dữ liệu UI -> API)
1. **Lấy dữ liệu (Fetch):** UI Layer gọi custom hooks (VD: `useGetJobs`) -> Hook gọi tới Data Fetching library (TanStack Query) -> Service (Axios) -> Endpoint `/jobs` -> Trả về data hoặc Error.
2. **Cập nhật dữ liệu (Mutate):** Người dùng submit form (VD: tạo Job) -> Form validated (Zod) -> Gửi Mutation (TanStack Query) -> Service -> Endpoint `POST /jobs` -> Trả kết quả -> Invalidate cache để UI tự động cập nhật danh sách Job.

### 1.3 Danh sách trang bắt buộc (Required Pages)
- **Public Area:**
  - `/` (Trang chủ)
  - `/jobs` (Danh sách việc làm)
  - `/jobs/:id` (Chi tiết việc làm)
  - `/companies` (Danh sách công ty)
  - `/companies/:id` (Chi tiết công ty)
  - `/login`, `/register`
- **Candidate Area:**
  - `/profile` (Quản lý hồ sơ cá nhân)
  - `/history` (Lịch sử ứng tuyển)
- **Admin/HR Dashboard:**
  - `/admin` (Tổng quan)
  - `/admin/users`, `/admin/roles`, `/admin/permissions`
  - `/admin/companies`, `/admin/jobs`
  - `/admin/resumes` (Quản lý CV)

---

## 2. Chiến lược Xác thực & Phân quyền (Authentication & Authorization)

Hệ thống backend hiện tại đang sử dụng RBAC (Role-Based Access Control) quét qua từng module, kết hợp với JWT & Token Rotation (Access/Refresh Token). Đọc logic tại `LocalAuthGuard` và `JwtAuthGuard`.

### 2.1 Quản lý Token & Session
- **Đăng nhập (`POST /auth/login`):** Backend trả về Access Token qua response body và Refresh Token được set trong HTTP-only Cookie (`refresh_token`).
- **Lưu trữ trên Frontend:**
  - Access Token: Lưu dưới dạng biến in-memory hoặc LocalStorage để đính kèm lên header `Authorization: Bearer <token>` thông qua Axios Interceptor.
  - Refresh Token: Không cần lưu, trình duyệt tự gửi HTTP-only cookie về API theo set-cookie từ backend.
- **Refresh Flow (`GET /auth/refresh`):** 
  - Axios Interceptor sẽ lắng nghe lỗi `401 Unauthorized` từ API Backend.
  - Khi gặp lỗi, interceptor gọi ngầm tới `GET /auth/refresh` để xin Access Token mới (dựa trên HTTP-only cookie). Tải lại request ban đầu với Token mới.
- **Đăng xuất (`POST /auth/logout`):** Hủy token từ backend và xóa session ở phía frontend. Xóa HTTP-only cookie.

### 2.2 Route Guard & RBAC UI
Dựa vào data được trả về khi gọi `/auth/account`, Frontend sẽ nhận được object User kèm theo mảng `permissions` (các endpoint & method).
- **Route Guard (Chặn trang):** Component `ProtectedRoute` bọc các route trong Admin. Nếu user chưa auth -> redirect về `/login`.
- **Role-based UI access:** 
  - Chức năng ẩn/hiện nút (Button level). Tạo một component `<AccessControl />` hoặc custom hook `useHasPermission(apiPath, method)`. 
  - Nếu `permissions` mảng của user không chứa `{ apiPath: "/api/v1/users", method: "POST" }` thì Frontend sẽ không hiển thị nút "Add User". Điều này mapping trực tiếp với logic backend ở `src/auth/jwt-auth.guard.ts`.

---

## 3. Đề xuất Tech Stack (Công nghệ & Thư viện)

Hệ sinh thái React hiện đại nhất sẽ giúp frontend đạt hiệu suất cao, dễ bảo trì và dễ dàng cho cấu trúc ứng dụng scale up.

- **Framework Cốt lõi:** `Next.js 14+ (App Router)` kết hợp `TypeScript`. Next.js giúp Routing dễ bóc tách (Group routes `(auth)`, `(admin)`, `(public)`), đồng thời hỗ trợ SEO tốt cho màn hình tìm kiếm việc làm.
- **Quản lý State & Data Fetching:** 
  - `TanStack Query (React Query) v5` cho Server State (caching danh sách Job, User, mutations tạo mới...).
  - `Zustand` cho Client State (lưu user session, trạng thái giỏ/lọc).
- **Http Client:** `Axios` (cho phép cài đặt global interceptors cực dễ để handle refresh token).
- **UI & Styling:** `Tailwind CSS` kết hợp `shadcn/ui`. Shadcn/ui cung cấp các Headless component đẹp mắt, dễ dàng custom và cực kì thích hợp cho layout Dashboard Admin complex.
- **Forms & Validation:** `React Hook Form` kết hợp với `Zod` schema. Mapping kiểu dữ liệu DTO từ Backend sang Frontend một cách chặt chẽ 1-1 qua Typescript.

---

## 4. Kiến trúc Thư mục Frontend (Folder Structure)

Áp dụng Feature-based kết hợp phân tách layer thông thường để AI Agent luôn biết vị trí đặt module:

```text
src/
├── app/                      // Next.js App Router Pages
│   ├── (public)/             // Layout cho user/guest bình thường (Header, Footer khách)
│   │   ├── jobs/             // page.tsx
│   │   ├── companies/        // page.tsx
│   │   └── page.tsx          // Homepage
│   ├── (dashboard)/          // Layout riêng cho Admin/HR (Sidebar, Header Admin)
│   │   └── admin/            // Role, Permission, Jobs, Resumes pages...
│   ├── (auth)/               // Layout authentication (Login, Register)
│   ├── layout.tsx            // Root layout
│   └── globals.css
├── components/
│   ├── ui/                   // Shadcn UI components (button, input, table, dialog, ...)
│   ├── common/               // Reusable components (Header, Footer, Sidebar, Cards)
│   └── guarded/              // Components bọc auth: <AccessControl />, <ProtectedRoute />
├── hooks/
│   ├── useAuth.ts            // Hook gọi Zustand lấy session
│   └── usePermissions.ts     // Hook logic check RBAC
├── services/                 // Logic tương tác Backend (API Calls)
│   ├── api.ts                // Khởi tạo Axios instance + Interceptors + Error Handler
│   ├── auth.service.ts
│   ├── jobs.service.ts
│   └── ...
├── store/
│   └── authStore.ts          // Zustand Slice cho User Auth
├── lib/
│   └── utils.ts              // tailwind merge, format date, format currecy
└── types/                    // TS Interfaces, map với DTO Data Backend
    ├── resume.type.ts
    ├── auth.type.ts
    └── job.type.ts
```

---

## 5. Hướng dẫn Tích hợp API (API Integration Guidelines)

### 5.1 Cấu hình Axios Instance
Tạo Base HTTP Client có base URL trỏ vào `/api/v1` của backend.
- Request Interceptor: Thêm access token nếu có vào Header (`Authorization: Bearer xyz`).
- Response Interceptor: 
  - Bắt lỗi `401`. Nếu URL không phải là `/login` hoặc `/refresh`, đẩy vào hàng chờ (Queue) -> gọi Service `/auth/refresh`.
  - Thành công lấy refresh -> cập nhật token tĩnh, lặp lại call request trong Queue.
  - Vẫn lỗi `401` -> Chạy lệnh Logout user, đẩy văng về `/login` kèm thông báo.

### 5.2 Xử lý lỗi tập trung (Global Error Handling)
Backend có Decorator `ResponseMessage` và format response chuẩn. Định dạng lỗi (Exception) thường trả về status code kèm JSON có `{ statusCode, message, error }`.
- Ở Frontend (trong file `api.ts` catch block):
  - Lỗi mạng (Network Error) -> Hiển thị Toast "Không thể kết nối đến máy chủ."
  - Lỗi `400 Bad Request` -> Thường là do Validation (như thiếu field `email`). Lấy field `message` mảng string (ex: `["email must be an email"]`) hiển thị Toast cảnh báo hoặc nhúng thẳng xuống HelpText của Input qua React Hook Form.
  - Lỗi `403 Forbidden` -> Xuất hiện toast cảnh báo "Bạn không có quyền thực hiện hành động này."
  - Lỗi `201`/`200` Thành công -> Lấy thông báo định nghĩa từ `ResponseMessage` trả về từ Backend (thường nằm ở `res.data.message`) rồi dùng thẻ Toast thông báo thành công cho Admin/User.

---
_Đây là tài liệu tiêu chuẩn, đóng gói sẵn cấu trúc để một AI Engineer có khả năng trích xuất toàn bộ yêu cầu dự án để tạo Scaffold, Component, Services mà không cần tham chiếu lại phía Backend Server liên tục._
