# Privacy Policy for FlowZero

**Last updated:** August 11, 2026

FlowZero ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how FlowZero handles user data when you use our Chrome Extension.

## 1. Local Processing Only
FlowZero operates **entirely locally within your Google Chrome browser**. 
- All image and video processing (watermark removal) occurs on your local device using standard browser APIs (Canvas, WebCodecs).
- No image, video, URL, prompt, or any media content is ever transmitted to external servers, cloud services, or third parties.

## 2. Information Collection and Usage
- **Personal Data:** FlowZero does **NOT** collect, store, or transmit any personally identifiable information (PII) such as your name, email address, IP address, or Google account credentials.
- **Extension Settings:** FlowZero uses `chrome.storage.local` exclusively to store your extension preferences (e.g., ON/OFF toggle state) locally on your device. This data never leaves your browser.

## 3. Remote Code & Third-Party Analytics
- FlowZero contains **NO remote code**, tracking scripts, telemetries, or third-party analytics.
- It complies strictly with Chrome Web Store Manifest V3 guidelines.

## 4. Permissions Disclosure
- `downloads`: Used solely to save the watermark-free images and videos to your local Downloads folder upon your request.
- `offscreen`: Used to execute WebCodecs and Canvas rendering in an isolated offscreen document inside Chrome.
- `storage`: Used to persist local extension toggle states.
- Host permissions (`labs.google`, `*.googleusercontent.com`, `*.googleapis.com`, `flow-content.google`): Used exclusively to fetch local media Blobs on Google Flow pages for processing.

## 5. Contact Us
If you have any questions about this Privacy Policy, please open an issue on our GitHub repository:
https://github.com/Benb251/flow-zero-extension
