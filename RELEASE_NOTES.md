# FlowZero v1.3.0 Beta 1

First external beta build of the redesigned FlowZero extension.

## Highlights

* Local image watermark removal
* Local video watermark removal using WebCodecs
* Google Flow native 1K / 2K resolution workflow
* Native 720p video selection
* Native 1080p video selection
* Automatic 4K visibility based on detected Flow tier
* Restored FlowZero glassmorphism interface
* Preserves original video audio
* Reduced video memory overhead with direct HTTP media transport
* `blob:` media fallback support
* Improved Manifest V3 Offscreen processing
* Correct originating-tab progress routing
* Passive behavior when FlowZero is disabled
* Prevention of FlowZero self-intercepting its own downloads
* Improved media MIME detection
* Safer URL validation and narrower permissions

## Requirements

```text
Google Chrome 116 or newer
Google Flow / labs.google access
```

## Installation

1. Download `FlowZero-v1.3.0-beta.1.zip` below.
2. Extract the ZIP archive.
3. Open `chrome://extensions` in your Chrome browser.
4. Enable **Developer mode** in the top-right corner.
5. Click **Load unpacked**.
6. Select the extracted FlowZero folder containing `manifest.json`.
7. Open or reload Google Flow (`https://labs.google`).

## Beta testing requested

Please test:
* Image 1K
* Image 2K
* Video 720p
* Video 1080p
* Audio retention
* Extension ON/OFF
* Google Flow reload

If your Flow subscription supports additional native resolutions, test those as well.

## Known compatibility note

Video processing uses browser WebCodecs. Behavior may vary depending on:
* Chrome version
* Video codec
* GPU model & driver
* Hardware acceleration support
* Available RAM

If video processing fails on your machine, please report:
* Chrome version
* OS version (Windows/macOS)
* GPU model
* Video resolution
* FlowZero console error
* Whether hardware acceleration is enabled

## Privacy

Image and video watermark processing is performed locally in the user's browser.
No external FlowZero processing server is required.

## Checksum

```text
FlowZero-v1.3.0-beta.1.zip
SHA256: FBB28E7439579DD2DB760ECADBAB2D71845D6AFD2DC6655F6252ED43F6A06F58
```
