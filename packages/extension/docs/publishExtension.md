Build the store zip (run from `packages/extension`):

```
npx wxt zip --mode production
```

Output: `packages/extension/.output/prod/smart-search-ext-<version>-chrome.zip` (name from `zip.artifactTemplate` in `wxt.config.js`). Only the manifest name is shown to users, so the file name does not matter.

## Before you upload

- **Version:** `packages/extension/package.json` is `0.0.1`. The Web Store rejects a version it already has, so bump it for every resubmission.
- **Manifest `key`:** `wxt.config.js` omits it in production (the Store rejects uploads that contain it). Confirm the built `manifest.json` has no `key`.
- **E2E fake embedder:** the build throws if `WXT_E2E_FAKE_EMBEDDER` is set with `NODE_ENV=production`. Make sure it is not set in your shell.
- **Built manifest check:** open `.output/prod/chrome-mv3/manifest.json` and confirm the permissions are exactly `sidePanel, storage, offscreen`, with no `host_permissions` and no `content_scripts`. The justifications below assume this.
- **Privacy policy is stale:** `packages/extension/PRIVACY.md` and `docs/terms-and-privacy.md` still describe *Page Agent* (DOM automation, a testing LLM API run via Alibaba Cloud). They do not describe Smart Search. Rewrite them before you submit; the Store requires a policy URL that matches the listing.
- **Review prompt:** off unless `WXT_REVIEW_PROMPT_ENABLED=true` is set. If you turn it on, the feedback form posts name, email and message to a Google Form, and the privacy policy and the data-usage answers below must say so.
- **Store id fallback:** `reviewConfig.ts` has a `TEMP_STORE_EXTENSION_ID` placeholder. Set `WXT_STORE_EXTENSION_ID` after the first publish.
- **Icon:** the manifest icon is `assets/images/page-agent-64.png` (a leftover name). The Store also needs a 128x128 icon for the listing, plus screenshots and a small promo tile.

## Product details

**Name** (from `_locales/en/messages.json`): Smart Search

**Summary** (132 characters max; the manifest `extDescription` is shown on the Store card too):
Search your own files by describing them. Indexing and search run on your device; nothing is uploaded.

## Description

Smart Search finds files on your computer by meaning, not by file name. Pick a folder, let it index once, then describe what you want: "beach sunset", "invoice from March" or "the meeting where we talked about pricing".

WHAT YOU CAN SEARCH
- Photos and images (JPG, PNG, WebP, GIF, AVIF and more)
- Video clips
- Audio files and spoken audio
- Documents: PDF, Word (.docx), text, Markdown, CSV, JSON, HTML and similar
- PDF pages are searched by what they look like as well as by their text

WAYS TO SEARCH
- Type a description
- Search by voice or sound: say it or play it, and Smart Search finds matching audio and files
- Search with your camera: point it at something and find similar photos
- Browse your indexed files as a visual wall

ANSWERS FROM YOUR FILES (OPTIONAL)
- Ask a question and get an answer with the source files cited. This needs a private AI provider you choose: a local server such as Ollama or LM Studio, or a model running inside your browser. Search itself never needs one.

YOUR FILES STAY YOURS
- Indexing and search run on your device, in your browser
- Your files are read from the folder you pick, are never uploaded, and are only read, never changed
- The index is stored in your browser, and you can delete it at any time
- The search model is downloaded once from huggingface.co, only after you click Download, and you see its size first
- Obvious secrets such as .env files, private keys and password files are skipped
- No account, no sign-up, no ads, no tracking

HOW TO START
Click the Smart Search icon to open the side panel. Choose the model download, pick a folder, wait for indexing, then search. A computer with WebGPU gives the best speed; a slower CPU mode is offered if WebGPU is unavailable.

## Category

Productivity > Tools

## Permissions

sidePanel, storage, offscreen

## Permission justifications

**Single purpose:** Smart Search lets you search files in a folder you choose by describing them. It reads the folder, builds a private search index in the browser, and shows matching photos, videos, audio and documents in the side panel.

**sidePanel**
The whole interface (setup, search, results, browse) is shown in Chrome's side panel. The toolbar icon opens it.

**storage**
Saves settings and the search index on the user's device. Nothing is stored on our servers.

**offscreen**
Indexing and search run an on-device AI model (WebAssembly and WebGPU) and need a long-lived page with workers. A service worker cannot host them, so an offscreen document does. It handles only the user's own files and search queries, locally.

**Host permissions:** none requested. No content scripts. The extension reads no web pages.

**Folder access:** uses the File System Access API (`showDirectoryPicker`). Chrome shows its own folder picker and the user chooses the folder. No manifest permission is involved.

**Microphone and camera:** not manifest permissions. Chrome asks the user when they press the voice or camera button in the extension. Audio and video frames are used only to make the search query on the device and are not recorded, stored or sent.

**Remote code:** none. All code is packaged. The content security policy is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'`. `wasm-unsafe-eval` is needed to run ONNX Runtime (WebAssembly) for the on-device model. The runtime files are bundled, not loaded from a CDN.

**Network use:** the extension downloads the search model weights (data, not code) from huggingface.co after the user clicks Download. Optionally, if the user configures a local or in-browser AI provider for answers, excerpts go to that endpoint (see Data usage).

## Data usage

**What user data do you plan to collect from users now or in the future?**

We (the developer) collect nothing. There is no Smart Search server, account or backend, and we receive no data. Files, the index and search queries are processed on the user's device.

**Check these boxes:** none. Nothing is transmitted to the developer, and Chrome's data-usage form is about data collected, meaning sent off the device. Everything the extension reads (files, voice and camera queries) stays local. Re-check this if you enable the review prompt, because it sends name, email and message to a Google Form (then tick Personal communications or Personally identifiable information as it applies).

**Edge cases worth knowing**
- If the user turns on "answers from your files" and points it at an endpoint, excerpts of their files go to that endpoint. The UI only offers private options (a local server or an in-browser model), but the endpoint URL is user-editable. This is a user-initiated transfer to a service they chose.
- Model weights are downloaded from huggingface.co. That request exposes the user's IP address to Hugging Face, as any download does. Disclose it in the privacy policy.

**How the data is used**
- Only to provide search, browse and optional answers that the user starts.
- Not sold or transferred to third parties.
- Not used or transferred for purposes unrelated to the item's single purpose.
- Not used to determine creditworthiness or for lending.
- Not used for advertising or to build user profiles.

**Certifications to tick:** the three Limited Use statements (not sold, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:** required. Publish a rewritten Smart Search policy (see "Before you upload") and use its URL.

## Not verified

- No production build or zip was inspected for this doc; the permission list comes from `wxt.config.js`.
- Voice, camera and AI-provider claims were not checked against the live UI. Spot-check them before submitting.
- The welcome page is not yet opened by the background script (no install handler wiring), so it is not part of the shipped flow.
