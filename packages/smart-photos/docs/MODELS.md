# Models used by the Smart Photos frame

Checked 2026-11-14. Every address and fingerprint below was compared with the public source (the Hugging Face and GitHub "pointer" files list the SHA-256 and size of each large file) or with the file the tablet runs today.

The frame uses **six model files**. Three are inside the app already; the other three are **downloaded by the app on first run** (with the user's consent, resumable, checked against the fingerprints below). For development they can instead be copied with `adb` from the git-ignored scratch folder `packages/smart-photos/frame/dev-models/` using `push-models.ps1`.

## 1. Models the app downloads on first run (not inside the app file)

| # | File on the tablet | What it does | Size | SHA-256 |
| --- | --- | --- | --- | --- |
| 1 | `models/clip_b32_vision_q8mm.onnx` | CLIP image model: turns a photo or video frame into a "meaning" vector | 96,308,691 | `0a8e2bba4c35a7549f7d0611d4f7e5df7b979ef94178b8c4ab1e7d71d6accd6a` |
| 2 | `models/clip_b32_text_q8mm.onnx` | CLIP text model: turns a typed or spoken query into the same kind of vector | 140,536,263 | `bb57af7e847e6154b11552fe21e1157765b9fa327e10279703775ca48523a4ae` |
| 3 | `models/vosk-model-small-en-us-0.15/` (folder) | Offline speech recognition (commands, spelling, "search for") | 41,205,931 (zip), about 68 MB unpacked | zip: `30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498` |

Location on the tablet: `/sdcard/Android/data/com.smartphotos.frame/files/models/`.

### Where they come from

**1 and 2 (CLIP) are made by us from a public source and are hosted in our own Hugging Face repo (published and verified 2026-11-14):**

- **`https://huggingface.co/GuideAxon/smart-photos-clip-b32-q8mm`** (public, MIT, with a model card and the OpenAI licence text). The app downloads from
  `.../resolve/main/clip_b32_vision_q8mm.onnx` and `.../resolve/main/clip_b32_text_q8mm.onnx`. Both were downloaded back from the public address and
  matched the fingerprints in the table byte for byte. **Never overwrite these two files**: every tablet's search index depends on the exact bytes.
  A changed model needs a new file name, new fingerprints in `Models.kt` and rebuilt indexes.

- Source: Hugging Face repo **`Xenova/clip-vit-base-patch32`** (licence **MIT**, "openai/clip-vit-base-patch32 with ONNX weights"). Files:
  - `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx`: 351,685,709 bytes, SHA-256 `fd6e1402a588279d1723c7534d4bcba5bc0b14b47dfab0e46f8c47b8270d7d40`
  - `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model.onnx`: 254,058,553 bytes, SHA-256 `3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc`
  - (Both matched the full-size files used here, byte for byte.)
- Conversion (done on a PC, `tools/s2/s2_q8.py`): ONNX Runtime `quantize_dynamic`, `QInt8`, **MatMul operators only, per-channel**. The result is the "q8mm" file.
- Why not the public compressed files (`*_quantized.onnx`): they also compress the first convolution and lose too much quality (image vectors cosine 0.92 against full size, top-10 overlap 0.45). The matrix-only version reaches 0.99. Details: `SmartPhotos.md` section 7.3.3.
- The app also needs the CLIP **tokenizer** (see section 2), and its image preprocessing must match Pillow exactly (section 7.3.4).
- **Search vectors only match if every tablet uses these exact files.** Re-running the conversion is not guaranteed to give identical bytes, so whoever distributes the app must host *these* files (or new ones, then rebuild every index) and have the app check the fingerprints above.

**3 (Vosk voice model)** is downloadable as is:

- `https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip` (40 MB, licence **Apache 2.0**, from Alpha Cephei). Unzip into `models/`.
- The Vosk code library itself comes from Maven (`com.alphacephei:vosk-android:0.3.75`) and is already in the app.

## 2. Models already inside the app (`app/src/main/assets/`)

| File | What it does | Size | SHA-256 | Source and licence |
| --- | --- | --- | --- | --- |
| `clip_tokenizer.json` | Turns words into numbers for the CLIP text model | 2,224,119 | `f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd` | Tokenizer file of `Xenova/clip-vit-base-patch32` (MIT) |
| `yunet.onnx` | Face detector | 232,589 | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` | OpenCV Zoo, `models/face_detection_yunet/face_detection_yunet_2023mar.onnx` (matches the public file exactly). Licence recorded earlier as MIT; not re-checked on 2026-11-14 |
| `sface.onnx` | Face recogniser | 38,696,353 | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` | OpenCV Zoo, `models/face_recognition_sface/face_recognition_sface_2021dec.onnx` (matches exactly). README: "All files in this directory are licensed under Apache 2.0 License"; it names no training dataset, so the terms of the training data are **not verified** |

## 3. Notes for anyone distributing the app

- **Licence notices:** the app should show where each model comes from and its licence (MIT for CLIP and the tokenizer, Apache 2.0 for Vosk and SFace, YuNet to confirm). OpenAI CLIP is MIT.
- **Not used:** EmbeddingGemma (does not fit this tablet's memory and has no GPU path), MobileCLIP (research-only licence, and slower here). See `SmartPhotos.md` sections 5.0 and 7.3.2.
- **Changing a model** means rebuilding every index. The index stores a preprocessing version (`PREP_VERSION` in `PhotoStore.kt`), and the file names are fixed in `Clip.kt`.

## 4. How the app gets the models

- **First run:** if a model is missing the app shows a consent screen (what is downloaded, the size, where from, and whether the connection looks metered) with **Download** and **Not now**. "Not now" is remembered; the same download is under **Settings, Search and voice models**.
- **Download:** HTTPS only (redirects are followed by hand and a non-HTTPS redirect is refused), resumes a partly downloaded file after a pause, a network break or an app restart (`.part` file plus an HTTP Range request), retries by itself up to 4 times, then asks the user to try again.
- **Check:** every file's SHA-256 is compared with the fingerprint in the table above (`Models.kt`). A mismatch deletes the file and shows an error; nothing unchecked is ever used.
- **Voice model:** the zip is checked, then unpacked (entries that would land outside the target folder are refused) and deleted.
- **Privacy:** the internet permission is used for this download only. The request carries a plain `User-Agent: SmartPhotosFrame/0.1` and nothing else: no photo, face, voice or device data leaves the tablet.
- **Space:** the app refuses to start a download that would leave less than 300 MB free.
