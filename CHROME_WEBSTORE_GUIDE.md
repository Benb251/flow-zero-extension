# 🚀 Hướng Dẫn Tải Lên FlowZero Lên Chrome Web Store

Tài liệu này hướng dẫn từng bước để tải tiện ích **FlowZero** lên **Chrome Web Store Developer Dashboard**.

---

## 📦 1. File Đóng Gói (ZIP Package)

File ZIP chuẩn bị tải lên Chrome Web Store đã được tự động tạo sẵn:
* **Tên file:** `FlowZero-ChromeWebStore-v1.3.0.zip`
* **Vị trí:** `d:\Tool\toby-extention\flow-zero-extension\FlowZero-ChromeWebStore-v1.3.0.zip`

> 💡 **Mẹo:** Nếu bạn có chỉnh sửa code sau này, chỉ cần chạy lệnh:
> ```bash
> npm run package
> ```
> Script sẽ tự động đóng gói file ZIP mới chuẩn cấu trúc Manifest V3 (loại bỏ `.git`, `node_modules`, `tests`,... để duyệt nhanh nhất).

---

## 🌐 2. Các Bước Đăng Lên Chrome Web Store

1. Truy cập [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Đăng nhập bằng tài khoản Google Developer của bạn.
3. Nhấp vào nút **New item** (Mục mới) ở góc trên bên phải.
4. Kéo thả hoặc chọn file **`FlowZero-ChromeWebStore-v1.3.0.zip`**.

---

## 📝 3. Thông Tin Chi Tiết Điền Vào Store Listing

### **A. Thông Tin Chung (Listing Details)**
* **Extension Name (Tên tiện ích):** `FlowZero - Flow Watermark Remover`
* **Short Description (Mô tả ngắn):** 
  ```text
  Tiện ích 1-click tự động xóa watermark khi tải hình ảnh và video từ Google Flow (labs.google).
  ```
* **Detailed Description (Mô tả chi tiết):**
  ```text
  FlowZero là tiện ích mở rộng giúp tự động loại bỏ watermark khỏi hình ảnh và video khi sử dụng Google Flow (labs.google).

  ✨ TÍNH NĂNG NỔI BẬT:
  - 📸 Tự động xóa watermark hình ảnh (độ phân giải 1K / 2K / 4K).
  - 🎬 Tự động xóa watermark video bằng công nghệ mã hóa WebCodecs cục bộ trên trình duyệt.
  - 🎵 Giữ nguyên âm thanh gốc của video.
  - ⚡ Tối ưu bộ nhớ, xử lý trực tiếp không qua server trung gian.
  - 🔒 Bảo mật tuyệt đối: 100% dữ liệu được xử lý trực tiếp trên máy tính người dùng.

  🚀 HƯỚNG DẪN SỬ DỤNG:
  1. Cài đặt tiện ích.
  2. Truy cập Google Flow (labs.google).
  3. Rê chuột vào ảnh/video để hiển thị menu FlowZero và chọn độ phân giải mong muốn để tải về.
  ```
* **Category (Danh mục):** `Productivity` (Năng suất) hoặc `Developer Tools`.
* **Primary Language (Ngôn ngữ chính):** `Vietnamese` (Tiếng Việt) hoặc `English`.

---

### **B. Giải Trình Quyền Hạn Cho Chrome Reviewer (Permission Justification)**

Khi chuyển sang mục **Privacy tab** (Quyền riêng tư), điền các nội dung giải trình sau:

| Quyền (Permission) | Lý do sử dụng (Justification cho Reviewer) |
| :--- | :--- |
| **`downloads`** | Cần thiết để kích hoạt tải xuống hình ảnh và video đã xóa watermark sạch về thư mục Downloads của người dùng. |
| **`offscreen`** | Yêu cầu bởi Chrome Manifest V3 để khởi tạo Offscreen Document chạy tác vụ Canvas rendering và WebCodecs giải mã/mã hóa video trong nền. |
| **`storage`** | Dùng để lưu trữ trạng thái bật/tắt (ON/OFF) của tiện ích và tier nhận diện cục bộ trên trình duyệt của người dùng. |

* **Host Permissions Justification (`labs.google`, `*.googleusercontent.com`, `*.googleapis.com`, `flow-content.google`):**
  > *Tiện ích cần truy cập vào các liên kết ảnh và video thuộc hệ sinh thái Google Flow để lấy dữ liệu phương tiện và tiến hành xóa watermark cục bộ trên trình duyệt của người dùng.*

---

### **C. Quyền Riêng Tư (Privacy Policy)**
* **Single Purpose Description:** `FlowZero only cleans watermarks from user-generated media on Google Flow and saves them locally.`
* **Data Usage:** Tích chọn **No, I do not collect or use user data** (Không thu thập dữ liệu người dùng).
* **Privacy Policy URL:** Dán link file `PRIVACY_POLICY.md` (sau khi push lên GitHub repo: `https://github.com/Benb251/flow-zero-extension/blob/master/PRIVACY_POLICY.md`).

---

### **D. Hình Ảnh Minh Họa (Graphic Assets)**
* **Store Icon:** Tải lên file `assets/icon128.png` (128x128).
* **Screenshots:** Tải lên ít nhất 1 ảnh chụp màn hình giao diện FlowZero hoạt động trên trang `labs.google` (Kích thước chuẩn: `1280x800` hoặc `640x400`).

---

## 📤 4. Nộp Duyệt (Submit for Review)

Sau khi hoàn tất thông tin, nhấn **Submit for review**. Đội ngũ Chrome Web Store thường duyệt tiện ích MV3 trong khoảng 1-3 ngày làm việc.
