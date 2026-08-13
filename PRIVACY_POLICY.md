# Privacy Policy for FlowZero - Flow Watermark Remover

**Effective Date:** August 13, 2026

FlowZero ("we", "our", or "us") is committed to protecting user privacy. This Privacy Policy outlines how the FlowZero Chrome Extension handles user data and permissions.

## 1. Data Collection & Privacy
FlowZero does **NOT** collect, store, track, or transmit any personal data, user credentials, browsing history, or IP addresses. 

## 2. Local Processing
All image and video processing operations (such as canvas manipulation, watermark detection/removal, and format handling) occur **100% locally** inside your browser using Web APIs and Manifest V3 offscreen documents. No media files or processed content are ever sent to or stored on external servers.

## 3. Use of Permissions
- **`downloads`**: Used exclusively to save processed media files directly to your device upon your download action.
- **`offscreen`**: Used strictly to execute canvas rendering and image processing tasks in a background context as required by Manifest V3.
- **`storage`**: Used solely to persist your extension settings and user preferences locally on your browser.
- **Host Permissions (`labs.google`, `googleusercontent.com`, `storage.googleapis.com`, `flow-content.google`)**: Used strictly to access media resources on supported domains to perform local processing.

## 4. Third-Party Sharing
We do not sell, rent, trade, or transfer any user data to third parties.

## 5. Contact Information
If you have any questions or feedback regarding this Privacy Policy, please open an issue or reach out via our GitHub repository.
