# Claude Session Manager (VS Code Extension)

**Tiếng Việt** | [English](README.md)

[![Visual Studio Code](https://img.shields.io/badge/VS%20Code-Extension-blue.svg)](https://marketplace.visualstudio.com)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-brightgreen.svg)]()
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Extension trực quan, siêu nhẹ và thời gian thực (real-time) giúp theo dõi, quản lý, phân loại và chuyển đổi nhanh giữa các session làm việc của **Claude Code** trực tiếp ngay trong VS Code. Hỗ trợ toàn diện cả **Issue/Ticket-based workflow (`#xxxx`)** lẫn **Chat tự do hàng ngày**.

---

## 💡 Vấn đề giải quyết

Khi sử dụng Claude Code (hoặc các AI agent tự động) cường độ cao:
- Bạn thường mở nhiều task cùng lúc nhưng không biết task nào **đang chạy**, task nào **đã xong**, task nào **đang dừng chờ duyệt lệnh (`need accept`)**.
- Lịch sử chat bị trôi, khó tìm lại đúng ngữ cảnh cũ.
- Khi cần duyệt lệnh terminal hoặc muốn quay lại cuộc trò chuyện cũ, phải gõ lệnh hoặc tìm ID thủ công.

**Claude Session Manager** quét trực tiếp runtime session và lịch sử của Claude Code trên máy bạn để tạo thành một bảng Dashboard trực quan 1-chạm ngay trên thanh công cụ của VS Code.

---

## ✨ Tính năng nổi bật

### 1. Giám sát trạng thái chính xác theo Runtime OS
- 🔵 **ĐANG CHẠY (`Running`)**: Nhận diện theo Process ID (PID) và trạng thái runtime của Claude Code. Khi Claude đang thực sự suy nghĩ, sinh mã hoặc chạy script (`running`/`busy`) thì mới hiển thị Đang chạy. Khi Claude đã trả lời xong và chuyển sang trạng thái chờ lệnh (`idle`), extension sẽ tự động cập nhật sang **Đã hoàn thành**.
- 🟡 **CHỜ DUYỆT (`Need Accept`)**: Phát hiện ngay khoảnh khắc Claude dừng lại để xin phép bạn thực thi lệnh terminal nguy hiểm hoặc apply file code.
- 🟢 **ĐÃ HOÀN THÀNH (`Done`)**: Các phiên làm việc đã hoàn tất turn hoặc tiến trình đã kết thúc, hiển thị thời gian tương đối (`vừa xong`, `5 phút trước`...).

### 2. Tương thích 100% mọi phương thức đăng nhập & Gói cước
Extension hoạt động bằng cách đọc trực tiếp dữ liệu runtime và nhật ký local tại `~/.claude/`:
- **Đăng nhập Web (`claude login`)**: Hỗ trợ đầy đủ tài khoản **Claude Pro**, **Claude Team**, **Claude Enterprise** qua trình duyệt.
- **Đăng nhập API (`ANTHROPIC_API_KEY`)**: Hỗ trợ trả phí theo token qua Anthropic Console.
- Bất kể bạn dùng gói nào hay đăng nhập bằng cách nào, extension đều nhận diện trơn tru.

### 3. Tự động tương thích 2 chế độ làm việc
- **Làm việc tự do (Không dùng Issue)**: Nếu bạn chỉ chat fix bug, trao đổi thông thường, extension tự động lấy câu hỏi đầu tiên làm tiêu đề, tuyệt đối **không hiện rác `#0`**.
- **Làm việc theo Issue / Ticket**: Tự động nhận diện cú pháp `#<số>` (ví dụ: `#100`, `#7152`, `#5433`) để gắn **Badge Issue màu xanh** nổi bật và làm sạch các đoạn text trùng lặp.

### 4. Thông báo đa điểm tiện lợi (2 vị trí)
- **Thanh Activity Bar (Sidebar bên trái)**: Icon Claude đặc trưng kèm **Badge số màu cam/xanh** nhảy realtime khi có task cần duyệt lệnh.
- **Thanh Status Bar (Dưới đáy màn hình)**: Hiển thị nhanh số task đang xử lý (ví dụ: `🔔 Claude: 1 Chờ duyệt` hoặc `✨ Claude: 5 Tasks`), 1 click mở ngay panel.

### 5. 1-Click mở đúng cuộc trò chuyện (Instant Session Jump)
Click vào bất kỳ card nào trên giao diện ➔ VS Code sẽ kích hoạt trực tiếp Claude Code chuyển thẳng đến đúng session đó ngay lập tức.

### 6. Thống kê kỹ thuật rõ ràng & Layout thoáng đãng
Giao diện card được thiết kế hiện đại, tăng khoảng cách dòng, dễ đọc cho người quản lý nhiều session:
- 🕒 **Thời gian tương đối**: `vừa xong`, `3 phút trước`, `2 giờ trước`...
- 🌿 **Git Branch & Repo**: Nhận diện đúng repo và nhánh git đang làm việc.
- ✨ **Model AI**: `Opus 5.5`, `Sonnet 3.7`, `Haiku 3.5`...
- 🗄️ **Tokens In / Out**: Ghi rõ ràng `in: 20.6M • out: 68K` (phân biệt rõ ràng token đầu vào và token đầu ra).
- 💵 **Chi phí ($ USD)**: Tổng tiền API tiêu thụ (nếu có).
- 💬 **Số lượt tương tác (Turns)**: Đếm chính xác số lần gửi prompt trao đổi trong phiên (1 prompt người dùng + 1 phản hồi = 1 turn).
- 🆔 **Session ID rút gọn**: 8 ký tự đầu để tra cứu nhanh.

---

## 🛠️ Cài đặt

### Cách 1: Cài đặt từ file đóng gói `.vsix` (Khuyên dùng cho người dùng)

Tương thích hoàn toàn với macOS, Linux, và Windows mà không cần cài Node.js hay build code:

1. Tải file **`claude-session-manager-0.1.0.vsix`** từ Release hoặc thư mục gốc repository.
2. Mở VS Code, nhấn tổ hợp phím:
   - **macOS**: `Cmd + Shift + P`
   - **Windows / Linux**: `Ctrl + Shift + P`
3. Gõ:
   ```text
   Extensions: Install from VSIX...
   ```
4. Chọn file `claude-session-manager-0.1.0.vsix` và bấm **Install**.
5. Nhấn **Reload Window** (`Developer: Reload Window`).

---

### Cách 2: Cài đặt & Phát triển từ mã nguồn (Dành cho Developers)

```bash
# 1. Clone repository
git clone https://github.com/mquand/Claude-Session-Manager-.git
cd Claude-Session-Manager-

# 2. Cài đặt dependencies
npm install

# 3. Biên dịch mã nguồn TypeScript
npm run compile

# 4. Mở trong VS Code và nhấn phím F5 để chạy Debug
code .
```

---

## ⚙️ Cấu hình (Settings)

Extension tự động tìm kiếm theo đường dẫn mặc định của Claude Code trên máy tính của bạn:
- `~/.claude/projects` (lịch sử hội thoại `.jsonl`)
- `~/.claude/sessions` (runtime PID đang active)

Nếu bạn thay đổi cấu hình Claude Code sang thư mục khác:
1. Mở **Settings** (`Cmd + ,` hoặc `Ctrl + ,`).
2. Tìm từ khóa `Claude Session Manager`.
3. Tùy chỉnh:
   - `claudeSessionManager.storagePath`: Đường dẫn thư mục projects tùy chỉnh.
   - `claudeSessionManager.autoRefreshInterval`: Tần suất quét định kỳ (mặc định: `10` giây).

---

## 📦 Hướng dẫn đóng gói bản `.vsix` mới

Nếu bạn chỉnh sửa code và muốn đóng gói file cài đặt để chia sẻ hoặc phát hành lên GitHub Releases:

```bash
npm run compile
npx @vscode/vsce package --no-dependencies
```

---

## 🤝 Đóng góp & Phát triển (Contributing)

Mọi đóng góp, báo lỗi (Issues) hoặc tính năng mới (Pull Requests) đều được hoan nghênh:
1. Fork dự án
2. Tạo branch tính năng (`git checkout -b feature/tinh-nang-moi`)
3. Commit thay đổi (`git commit -m 'feat: thêm bộ lọc dự án'`)
4. Push branch (`git push origin feature/tinh-nang-moi`)
5. Mở Pull Request trên GitHub

---

## 📄 Bản quyền (License)

Dự án được phát hành theo giấy phép [MIT License](LICENSE).
