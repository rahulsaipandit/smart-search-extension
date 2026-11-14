# Smart Photo Frame (Fire HD) — Design Document

Status: **Draft for discussion. No option is chosen yet.** Date: 2026-11-13.
Owner: Rahul. Original brief: kept verbatim in [Appendix A](#appendix-a-original-brief).

The purpose of this document is to lay out the problem, the constraints of the target device, the
hard parts, and the realistic options for each major decision, so we can pick an architecture
deliberately (§9) after a short list of spikes (§12). Where a statement is a fact from this repo it
is cited; where it is an assumption about the Fire HD or a library it is marked **[verify]** and
appears in the spike list.

## 1. Summary

A Fire HD tablet on a table acts as a **smart photo frame**:

1. It shows a slideshow of the family's photos and videos.
2. You can ask for photos by meaning ("seaside", "ocean", "birthday cake") and the frame finds them.
3. Faces in photos are detected and can be named.
4. The front camera notices **who is standing in front of it**, and if it recognises them it shows
   photos of that person.
5. Everything is controllable by voice: request photos, pause, name the faces in the paused photo
   from left to right, delete a photo (with confirmation).

**The central tension:** the semantic-search model we want (EmbeddingGemma 2, 740M parameters
across text, vision and audio encoders) and a face-recognition pipeline are comfortable on a desktop
GPU, but the Fire HD is a low-RAM, low-end-GPU, Android-fork tablet that probably has **no WebGPU**.
Most of this design is about deciding *which work happens on the tablet and which happens
elsewhere*, and how the two halves share one index.

**Update 2026-11-13:** the frame must run **fully on the Fire HD** and NameTag cannot be used as is.
That favours **Option E (§9.1)**: everything on the tablet, with a small mobile image–text model in
place of EmbeddingGemma 2 and a new in-repo face module. The hybrid below is kept as the fallback.

**Update 2026-11-13 (device measured over ADB, §5.0):** the target is a **Fire HD 10 (9th gen, 2019,
`KFMAWI`)**: Android 9, **32-bit only**, **1.83 GB RAM (~0.68 GB free)**, MT8183 CPU, **no WebGPU**,
Silk on Chromium 85 (**no WASM SIMD**), ~2 MP front camera. Consequences: EmbeddingGemma 2 cannot run
on this tablet; the model budget is ~150–250 MB resident; and a **native Android app (Kotlin/KMP)
with a 32-bit ONNX Runtime or LiteRT build** is now the leading runtime, ahead of Silk and Tauri.

**Earlier lean (superseded unless on-device spikes fail):** a **hybrid** — heavy, one-time work
(embedding thousands of photos, finding and clustering faces) runs on a desktop using code we already
have; the tablet receives a compact **index bundle** and does only the light, interactive work
(display, query embedding or lookup, live face detection/recognition, voice). See §9, option B.

## 2. Goals and non-goals

### Goals

- G1. Natural-language photo/video retrieval ("seaside", "ocean at sunset", "kids playing in snow").
- G2. Face detection in the library and the ability to name people.
- G3. Recognise the person in front of the frame and show their photos automatically.
- G4. Hands-free control by voice, including pause, naming faces, and deletion with confirmation.
- G5. Runs on a Fire HD tablet, usable as an always-on appliance (powered, on a table).
- G6. **Private by default:** photos, face data and audio stay in the home; no cloud inference.

### Non-goals (v1)

- Cloud photo services (Google Photos, iCloud) as a source.
- Multi-user accounts, remote sharing, or syncing between several frames.
- Cloud speech or cloud vision APIs.
- Editing photos (crop, filters).
- Recognising people who are not enrolled (the frame never names strangers).

### Personas / scenarios

| Scenario     | What happens                                                                                    |
|--------------|-------------------------------------------------------------------------------------------------|
| **Ambient**  | Frame idles on a shuffled slideshow, dims at night.                                             |
| **Walk-up**  | Person stops in front → frame recognises them within ~2 s → switches to photos of them.         |
| **Ask**      | "Show me the beach." → results appear; slideshow plays through them.                            |
| **Curate**   | "Pause." → faces numbered 1..n → "This is Rahul, Priya, Asha." → names saved.                   |
| **Clean up** | "Delete this photo." → toast "Delete this photo? Say *yes* or *cancel*" → removed (or trashed). |

## 3. Requirements

Refined from the original four, each with an identifier so options can be scored against them.

### Functional

| ID | Requirement |
| --- | --- |
| F1 | Search images **and videos** by keyword or phrase; multilingual desirable. |
| F2 | Combine filters: person + concept ("Priya at the beach"). *(new; falls out of F1 + F4)* |
| F3 | Detect faces in every library photo; store boxes and embeddings. |
| F4 | Cluster/recognise faces and assign names. |
| F5 | Live camera: detect a face, recognise an enrolled person, trigger their photo set. |
| F6 | Voice: request photos, pause/resume, next/previous, name faces left→right, delete. |
| F7 | Delete with an on-screen toast confirmation (and a voice confirmation path). |
| F8 | Slideshow with transitions, dimming schedule, video playback. |

### Non-functional

| ID | Requirement | Target (to be validated) |
| --- | --- | --- |
| N1 | Walk-up recognition latency | ≤ 2 s from face appearing to photos changing |
| N2 | Voice command latency | ≤ 1.5 s from end of utterance to action |
| N3 | Query latency | ≤ 1 s for text search on a 20k-photo library |
| N4 | Library size | **~2,000 images** (confirmed 2026-11-13); design headroom for 10k |
| N5 | Thermal / battery | Runs 12+ h/day powered with no throttling visible in the slideshow |
| N6 | Offline | Fully functional with no internet after setup |
| N7 | Privacy | No image, audio or face vector leaves the LAN |
| N8 | Install | Sideloadable on Fire OS without Google Play services |

## 4. What we already have

The brief's last sentence was cut off ("This smart search extension already has functionality to…").
From the code, the relevant existing capability is:

| Asset | Where | Relevance to the frame |
| --- | --- | --- |
| **EmbeddingGemma 2 embedder** (text, image, audio, video → one 768-d space; Matryoshka 256/128; q4/q8) | `packages/extension/src/browser-ml/gemma-embeddings.ts`, `docs/designLocalFolderSearch.md` §3.2 | Exactly the semantic search the brief asks for (G1). Runs transformers.js + ONNX on **WebGPU**. |
| Folder indexer: walk, classify, extract, embed, checkpoint, resumable | `folder-search/indexer.ts`, `walker.ts` | Library indexing on the desktop. |
| Index store: files, image vectors, 256 px thumbnails, keywords, `meta` (model/dtype/dim) | `folder-search/db.ts`, `searchIndex.ts` | Basis for an exportable index bundle. |
| Ranking: brute-force cosine over `Float32Array`, z-score calibration, clear-gap cutoff, hybrid keyword fusion | `folder-search/ranking.ts`, `keywords.ts` | Query-time scoring on the tablet. |
| Image/audio/camera **query** (mic and webcam as search inputs) and the permission-tab workaround | design §4B.2 | Camera/mic permission patterns. |
| Glass media wall (WebGL2, texture pool, CSS fallback) | `sidepanel/components/FolderSearch/glass/` | Possible slideshow/browse visual; **likely too heavy for Fire HD**, CSS fallback exists. |
| Speech package (STT sessions, utterance cutter, echo guard, dictation) | `packages/cognitive-brain/speech` | Reusable turn-taking logic; engine choice is open (§7.5). |
| **NameTag** face pipeline (web): `@vladmandic/face-api` TinyFaceDetector + 68-pt landmarks + 128-d recognition net, L2-normalised, cosine threshold 0.7, Orama in-memory vector index over SQLite (sql.js) | `d:\Github\NameTag\NameTagApp\src\ml\inferenceEngine.web.ts`, `docs\design.md` | Face detection/recognition (G2, G3). Already runs in a browser and offline. |

### 4.1 NameTag is a reference, not a dependency

Decision (2026-11-13): **NameTag cannot be used as is.** We do not import its code or run its app.
We reuse only its *ideas*: the persons / faces / embeddings schema, the enrol-then-match flow,
cosine-similarity matching with a tunable threshold, and the swappable vector-search interface.
The face module is **new, in this repo**, with models chosen after a licence check (D4). The
"Reuse NameTag" wording in §7.4 option A means "reuse its model choices as a baseline to compare",
not "embed NameTag". *(The specific reason NameTag is unusable was not stated; assumed: React
Native/Expo coupling and older face-api models. Confirm.)*

**Important constraints inherited from the extension:**

- It is a **Chrome extension** (WXT, side panel, offscreen document). Silk on Fire OS does not run
  Chrome extensions **[verify]**, so we **reuse libraries, not the extension itself**.
- Its own design records that the **q4/q8 EmbeddingGemma 2 builds do not run on the WASM backend**;
  WebGPU is required, otherwise an fp16 CPU fallback (text 543 MB + vision 336 MB) is needed
  (design §3.2). This is the single biggest problem for running the model *on the tablet*.
- The model-calling code has "only been compile- and bundle-checked, never executed" in a real
  browser (design status notes). We should not build on it for a new platform before it is proven
  on the desktop.

## 5. Target device: Fire HD

### 5.0 Measured on the user's tablet (2026-11-13, via ADB; see [KindleFireHD.md](KindleFireHD.md))

The target is a **Fire HD 10 (9th gen, 2019), `KFMAWI`**, older and tighter than first assumed.

| Property | Measured | Consequence |
| --- | --- | --- |
| OS | Fire OS 7 (Android 9, API 28) | Old platform APIs; min SDK 28. |
| ABI | **32-bit only** (`armeabi-v7a`, `armeabi`) | No arm64 libraries or APKs; per-process address space is limited; check every native dependency (ONNX Runtime, speech libs) ships `armeabi-v7a` **[verify]**. |
| RAM | **1.83 GB total, ~0.68 GB available** (idle, 512 MB swap) | **EmbeddingGemma 2 on the tablet is ruled out in practice** (text encoder fp16 ≈ 543 MB, WebGPU-less CPU only). Model + runtime budget is **≈ 150–250 MB resident**, not the 600 MB assumed earlier. |
| SoC | MediaTek MT8183, 8 cores (4× Cortex-A53, 4× Cortex-A73, ~2.0 GHz) | CPU-only inference; thermal throttling under sustained load; no usable NPU path assumed. |
| GPU / WebGPU | None expected: Silk is Chromium 85, Chrome 119 is installed but WebGPU needs Android 12+ | WebGPU is **out**. |
| Browsers | Silk 85.3 (Chromium 85); Amazon WebView 75; Android System WebView 66; Chrome 119 (sideloaded) | Chromium 85 has **no WASM SIMD** (shipped in 91) → slow ONNX/WASM in Silk. Chrome 119 has SIMD but is a sideloaded, non-guaranteed path. A WebView-based shell (Tauri) would use the 66/75 WebView **[verify provider]** → effectively no SIMD. |
| Google services | Sideloaded Play Services 26.43.30 and Play Store (Fire Toolbox), plus microG leftover | Available **on this tablet only**; do not depend on them (ML Kit, Google speech) so the app is not tied to a customised device. |
| Display | 1200×1920, 240 dpi | Design thumbnails at ~1200 px on the long edge. |
| Storage | 25 GB data partition, 17 GB free | Plenty for ~2,000 thumbnails (~300 MB). |
| Cameras | Front and back, both **1600×1200 sensors (~2 MP)**; camera2 reports hardware level *full* with manual sensor/post-processing and RAW capability; front orientation 270° | A face ~0.5 m wide at 1.5–2 m spans only ~60–90 px of 1600, so detection must run on the full-resolution frame (not a downscaled one) and the recognition range is short. The *full* level helps (control exposure/focus for dim rooms) but only via native Camera2/CameraX, not `getUserMedia`. Real preview sizes and low-light quality still to confirm in S0. |
| Microphone | `android.hardware.microphone` present; Amazon audio manager and "eve" audio feature present | Single built-in mic assumed; distance/noise quality unmeasured (S4). |
| Browser ABI | Silk and Chrome are both **32-bit** (`armeabi-v7a`) | Even Chrome 119 runs a 32-bit renderer: WASM heap and tab memory are tightly capped, another reason against large in-browser models. |
| Power | USB powered, battery 52% (during test) | Run soak tests on the real charger, not USB from a PC. |

**What this settles / changes**

- **Model:** a small joint image–text model (tens of MB) is the only realistic on-tablet choice; Gemma
  on the tablet is dropped (§7.3.1 gate budget lowered). Gemma can still build the desktop index only
  if the tablet could embed queries with it, which it cannot, so **index and query must both use the
  small model.**
- **Runtime:** plain Silk (no SIMD) and a Tauri shell (old system WebView) both look weak. **Native
  Android (Kotlin/KMP) with ONNX Runtime or LiteRT, 32-bit build, is now the strongest candidate.**
  Chrome 119 as a kiosk browser is a possible stopgap for prototyping only.

### 5.0.1 S0 probe results (2026-11-13, native app on the tablet)

Source: [`../s0-probe/`](../s0-probe/) (Kotlin, `armeabi-v7a` only, ONNX Runtime 1.31.1). Run on USB
power from the PC, room-temperature, ~1 minute total. Camera frames and audio were analysed in memory
and discarded; only a text report was written. Re-run: build with `./gradlew assembleDebug`, install, read
`adb logcat -s S0:I`.

| Area | Result | Meaning for the design |
| --- | --- | --- |
| Process | 32-bit (`is64bitProcess=false`); Java heap limit 384 MB (512 MB with `largeHeap`); 861 MB available at start | Native memory (ONNX Runtime) is outside the Java heap, but the overall ~0.7–0.8 GB free budget stands. |
| **ONNX Runtime on 32-bit** | **Loads and runs** (CPU, XNNPACK and NNAPI providers present) | The central "does a native runtime even exist for this device" risk is closed. |
| CPU speed, vision-encoder proxy (0.4 GFLOP conv net, 224×224) | 1 thread 54 ms, 2 threads 35 ms, **4 threads 21 ms**, 8 threads 19 ms | ≈20 GFLOP/s effective on 4 threads. Use **4 threads**; 8 adds little. A real mobile image encoder of ~1–4 GFLOP should take roughly **0.05–0.2 s/image**, i.e. **~2–7 min for 2,000 images** (linear estimate, **not measured with a real model**). |
| Text-encoder proxy (0.27 GFLOP matmul, 64×512) | 1 thread 32 ms, **4 threads 9 ms** | A small text tower is interactive (well under N3's 1 s). |
| XNNPACK vs plain CPU vs NNAPI | XNNPACK 21 ms ≈ CPU 21 ms; **NNAPI 29 ms (slower)** | No accelerator gain: use the plain CPU provider (optionally XNNPACK); skip NNAPI. |
| Memory in use while benchmarking | PSS ~105–130 MB with ~2–8 MB models; native heap 17–24 MB | Runtime overhead is ~90 MB before the model; the **150–250 MB resident budget** for model + runtime is realistic only for models of roughly ≤ 60–100 MB. |
| Front camera, live capture (Camera2, 4 s each) | 1600×1200: **15 fps**, first frame 1.2 s; 1280×720: 14 fps, 0.4 s; 640×480: 14 fps | Frame rate is capped at ~15 fps regardless of size, ample for 1–2 Hz detection. Full-resolution frames are available natively (not via `getUserMedia`). |
| Front camera optics | Focal length 2.01 mm; **fixed focus** (AF mode off only, min focus distance 0); exposure 0.1 ms–400 ms; ISO 100–6400; AE ranges 5–30 fps; mean luma 116–128/255 in a normal lit room | No autofocus: faces are sharp only within the lens's fixed focal range. **Low-light capability is real** (long exposure, high ISO) but costs fps and noise; still to test in dim light with real faces (S3). |
| Microphone | Opens at 16/44.1/48 kHz; ambient floor **−60.8 dBFS RMS** (quiet room), peak −42.6 dBFS | Quiet-room noise is low. Speech-at-distance accuracy is unmeasured (S4). |
| **System speech recogniser** | `SpeechRecognizer.isRecognitionAvailable=false`, **no recognition service installed**, even with sideloaded Play Services | Android/Google speech is **not an option**: voice needs an **offline engine we ship** (32-bit build). D5-E is dead; D5-A (Web Speech) is unavailable too. |
| WebView | Provider is **Amazon WebView 75** (Chromium 75) | A Tauri/WebView app would run on Chromium 75: no WASM SIMD (needs 91), no modern APIs. **Tauri is effectively ruled out** for ML work; UI-only use remains possible. |
| Thermal | Battery temperature unchanged (21.0 °C) after the short run | Sustained load is **not yet tested** (S6); this run was too short to say anything. |

**Decisions this settles**

1. **Native Android (Kotlin/KMP) is confirmed** as the runtime; Tauri and Silk are out for the main app.
2. **ONNX Runtime (CPU, 4 threads) is the inference engine**; no accelerator is worth the complexity.
3. **A small joint image–text model** is feasible for index and queries; indexing 2,000 images is minutes,
   not hours, so desktop-built indexes are an optional convenience only.
4. **Offline speech is mandatory** and must ship `armeabi-v7a` binaries. A closed-grammar recogniser
   (Vosk-class) for commands is the first thing to prototype (S4).
5. Face detection runs on 1600×1200 frames at ~1–2 Hz; fixed focus and the ~2 MP sensor make recognition range the
   main risk (S3).

Still unmeasured: a **real** image/text model's latency and RAM, real-face recognition accuracy at 1–2 m and in
dim light, speech accuracy at distance, sustained thermal behaviour, and 32-bit builds of candidate speech and
face libraries.

### 5.1 Expected (general knowledge, superseded where measured above)

**First spike: collect the real numbers (S0).**

| Property | Expected | Why it matters |
| --- | --- | --- |
| OS | Fire OS (Android fork; recent models Android 11 base) **[verify]** | Old WebView/Chromium; no Google Play services by default. |
| Browser | Silk (Chromium-based) **[verify version]** | WebGPU needs a recent Chromium *and* a supporting Android GPU driver; unlikely here. |
| RAM | ~2–3 GB **[verify]** | A single 500 MB model plus the OS and a video decoder is already tight. A browser tab can be killed. |
| SoC / GPU | MediaTek octa-core, Mali class **[verify]** | WASM SIMD CPU inference only realistically; thermal throttling under sustained load. |
| Storage | 32–64 GB + microSD | Library thumbnails fit; full-resolution library may live on microSD or a LAN share. |
| Front camera | ~2 MP, fixed focus **[verify]** | Faces at 1–2 m are small (~50–100 px) and noisy, especially in dim rooms. |
| Microphone | Basic single mic **[verify]** | Voice at a distance, with TV/room noise, and the frame's own audio (video playback). |
| Web APIs | `getUserMedia` needs a secure context (https or localhost); `SpeechRecognition` availability in Silk unknown; Screen Wake Lock support unknown **[verify all]** | Determines whether a pure web page is viable. |
| Always-on | Powered, but camera/mic and screen-on drain and heat the device | Informs duty-cycling (§7.7). |

## 6. Core challenges

Ordered roughly by how much they threaten the project.

1. **Model size vs. tablet capability.** EmbeddingGemma 2 is built for GPU/desktop. On a 2–3 GB, probably
   WebGPU-less tablet, even the text encoder alone (174 MB q4; 543 MB fp16 on CPU) is heavy, slow to
   load, and at risk of out-of-memory kills. Embedding thousands of photos on the tablet is
   unrealistic (the vision encoder on CPU would take far longer than the ~25 min/4.6k files estimate
   for a laptop).
2. **One embedding space, two devices.** If indexing happens elsewhere, the tablet's query vector must
   come from the *same model, dtype and Matryoshka dimension* as the index (`meta` already records
   this). A different, lighter query model will not work against Gemma image vectors.
3. **Face recognition under domain gap.** Gallery faces come from varied phone photos (good light,
   many ages, many poses); probe faces come from a 2 MP fixed-focus camera in a living room. NameTag's
   fixed cosine threshold (0.7) was not calibrated for that. Too loose → shows the wrong person's
   photos; too strict → never recognises anyone.
4. **Face *detection* cost across the library.** Running detection + 68-pt alignment + 128-d embedding
   on 20k photos is hours on a tablet, minutes on a desktop. Plus clustering unnamed faces into
   people so the user names clusters instead of faces one by one.
5. **Voice on a weak device in a noisy room.** Need low-latency, offline recognition; open vocabulary
   for *names* is the hard part ("this is Priya" → STT writes "pre ya"). Always-listening needs
   wake-word or push-to-talk, and the frame's own video audio can trigger it (echo).
6. **Browser capability uncertainty.** Camera, mic, WebGPU, file access, wake lock and background
   behaviour on Silk/WebView are all unverified. This decides whether a web page is enough or we need
   a native shell.
7. **Photo source and deletion.** A web page generally cannot read an arbitrary folder persistently or
   *delete* original files. Deletion semantics (hide vs. trash vs. real delete) depend on where the
   originals live.
8. **Privacy and consent for biometrics.** A camera continuously matching faces in a home is a
   sensitive feature: visitors have not consented, legal regimes (e.g. biometric privacy laws)
   differ, and children are involved.
9. **Policy ambiguity.** What to show when two people stand there, when recognition flips between two
   people, or when a recognised person's photos include someone private.
10. **Appliance reliability.** Sleep/dim schedule, camera and mic permission loss after reboot,
    memory leaks in a long-running page, thermal throttling.

## 7. Decision areas and options

Each area lists options, trade-offs and a preliminary lean. "Lean" means "what I would test first".

### 7.1 D1 — Runtime and packaging on the tablet

| Option | Description | Pros | Cons |
| --- | --- | --- | --- |
| **A. Web page in Silk (or PWA)** | Static site loaded in Silk, optionally "Add to home screen", Fire kiosk-style launch. | Fastest to build; reuses web code and NameTag's web engine; easy updates. | Browser sandbox: no WebGPU (probably), permission re-prompts, tab can be killed, no real file/delete access, camera needs https/localhost, voice API uncertain. |
| **B. Tauri 2 Android app** (system WebView + Rust) | Same web code in an Android app; Rust side for files, trash, keep-awake, services, possibly native ONNX Runtime. Capacitor and Cordova are **excluded by decision (2026-11-13)**. | Persistent permissions, file access, kiosk/immersive mode, auto-start, microSD; one codebase could also serve the desktop indexer. | Newer Android support and smaller plugin ecosystem; WebView version is whatever Fire OS ships **[verify]**; Fire OS compatibility untested **[verify S0]**. |
| **C. Native Android app (Kotlin) with on-device runtimes** | ONNX Runtime Mobile / LiteRT / NCNN for models; Android camera/audio APIs. | Best performance (NNAPI/XNNPACK, quantised int8), real file access, offline speech libs (Vosk/whisper.cpp) are mature. | New code base; cannot reuse the TS pipeline; two codebases to keep in sync with the desktop indexer (preprocessing must match exactly). |
| **D. Thin display client only** | Tablet is just a browser pointed at a server on the LAN that does all the AI (§9 option C). | Tablet needs almost nothing. | Needs an always-on server; face camera frames leave the tablet (stay on LAN). |
| **E. Kotlin Multiplatform (KMP) + Compose Multiplatform** | Shared Kotlin for the Android tablet app and a JVM desktop indexer: one implementation of preprocessing, face/vector matching, ranking and the bundle format. ONNX Runtime (Android and JVM builds) runs the same models on both. Android-specific parts: CameraX, mic, keep-awake, foreground service. | Native speed and memory; real file access and trash; makes portability rule 3 (identical preprocessing) and the §7.3.1 equivalence test far easier; no WebView version risk. | Rewrite: the existing TypeScript `folder-search`, Gemma embedder and glass wall are not reusable; Compose Multiplatform desktop is less mature than Android; more initial work than a web page; Fire OS lacks Google Play services, so ML Kit and Google speech are unavailable **[verify]**. |

**Excluded by decision (2026-11-13):** Capacitor, Cordova, Flutter. (React Native, .NET MAUI, Unity and
Godot were considered and not pursued: RN's only draw was NameTag, which cannot be used as is; the
others are a poor fit for ML plumbing.)

*Lean (updated after measuring the device, §5.0):* **E (KMP / native Android) is now the lead
candidate.** Reasons specific to this tablet: Silk is Chromium 85 with no WASM SIMD and a 32-bit
renderer; the only system WebViews are 66 and 75 (so **B/Tauri** would inherit them **[verify which
WebView Tauri selects]**); RAM is 1.83 GB; the front camera needs full-resolution frames and Camera2
controls that `getUserMedia` does not expose. **A** (Silk, or sideloaded Chrome 119) stays useful only
as a throwaway prototype for UI and voice experiments. Every native dependency must ship an
`armeabi-v7a` build; the S0 app proves that for ONNX Runtime/LiteRT and the speech library before
we commit.

### 7.2 D2 — Photo source and who builds the index

The index is the expensive artefact. Where it is built and where the originals live drive most other
choices.

| Option | Description | Pros | Cons |
| --- | --- | --- | --- |
| **A. Index on tablet** | Tablet reads photos (microSD / file picker) and embeds them itself. | No other device. | Needs vision encoder + face pipeline over thousands of photos on a weak CPU; days of heat; OOM risk. Practically ruled out above a few hundred photos. |
| **B. Index on desktop, export a bundle to the tablet** | The existing extension (or a CLI sharing its code) indexes a folder, runs face detection/clustering, then exports `index bundle` (vectors, thumbnails, face data, manifest). Copy to tablet via USB / microSD / LAN. | Uses the code we already have; tablet work is light; originals stay in one place. | Two-step workflow; updates require re-export; deletion must sync back. |
| **C. Index and serve from a home server (PC/NAS/Raspberry Pi)** | Server holds originals, index, models; tablet is a client over the LAN. | Always-on, powerful; incremental indexing as new photos arrive; deletion happens on the real files; one source of truth. | Needs a server running 24/7; adds setup; the "frame" stops working if the server is off (mitigate with a cached subset). |
| **D. Hybrid of B + C** | Desktop/server indexes; tablet caches thumbnails + index and falls back to local operation when the server is unreachable. | Resilient. | Most moving parts. |

**Index bundle sketch (for B/D):**

```
photoframe-index/
  manifest.json        { version, model: "embeddinggemma-2", dtype, dim: 256, createdAt, counts }
  media.json           [{ id, relPath, kind, w, h, takenAt, duration?, faces:[faceId] }]
  vectors.f16          contiguous Float16/Float32 matrix, row i = media[i]   (e.g. 20k × 256 × 2 B = ~10 MB)
  thumbs/              1024×768 JPEG/WebP per photo (display-size, not original)
  faces.json           [{ id, mediaId, box, embedding(128 or 512), personId? }]
  people.json          [{ id, name, centroid, sampleFaceIds }]
```

Sizes: vectors ~10 MB at 20k × 256-d fp16; thumbnails ~150 KB × 20k ≈ 3 GB (so size thumbnails to
the tablet screen, not the originals). **[verify]** against the tablet's free storage.

*Lean:* **B for v1** (cheapest to prove, reuses the extension), designed so the bundle can later be
served from a LAN host (C/D) without changing the tablet's data model.

**Library size update (2026-11-13): ~2,000 images, not tens of thousands.** At that size the bundle
is tiny: vectors ≈ 2,000 × 256 × 2 B ≈ 1 MB; display-size thumbnails ≈ 300 MB. Brute-force search
is instant. On-tablet indexing is also realistic (estimates, **[verify]**): faces ~30–40 min, a
mobile CLIP-class model ~10–30 min, Gemma's vision encoder on CPU possibly overnight (memory, not
time, is its risk). So **building on the desktop is now an option, not a necessity.**

**Portability rules (embeddings built on desktop, used on tablet).** Vectors are plain float arrays
and are portable if, and only if, all of these match between builder and consumer; the bundle's
`manifest.json` records them and the tablet refuses a mismatch (as the extension's `meta` store does):

1. Same **model id and revision**, same **dtype/quantisation** (q4 vs q8 vectors differ slightly;
   keep one end to end).
2. Same **Matryoshka dimension**, truncated *then* re-normalised.
3. Same **preprocessing**: image resize/crop/normalisation, text prefixes
   (`task: search result | query: …`), tokeniser version.
4. Same **face detector, aligner and embedder** for face vectors, plus the same alignment crop size.
5. Float precision: store fp16 or fp32; normalise after loading.

**The real constraint is the query side:** whatever built the index, the tablet must embed the
*query text* with the same model. Gemma index ⇒ Gemma **text** encoder on the tablet (~543 MB fp16
on CPU, no vision encoder needed), or a vocabulary/tag fallback (§7.3 C/E). Small-model index ⇒ its
small text tower runs on the tablet easily. Face vectors are cheap enough to compute on the tablet
directly, so only the semantic index needs to be portable.

### 7.3 D3 — Semantic search on the tablet (query embedding)

Whatever builds the index, a *query* (typed or spoken text → vector) must be produced at runtime.

| Option | Description | Pros | Cons |
| --- | --- | --- | --- |
| **A. EmbeddingGemma 2 text encoder on tablet** | Same model as the index. | Highest quality, multilingual, matches vectors exactly. | 174 MB q4 needs WebGPU (design §3.2); WASM needs fp16 ≈ 543 MB. **Ruled out on the measured device** (1.83 GB RAM, ~0.68 GB free, no WebGPU, 32-bit). |
| **B. Same model, run on a server/PC and called over the LAN** | Tablet sends the *text query only* to an embedding endpoint. | Tiny payload (text, no images), exact vector match, no tablet model. | Requires a reachable host; breaks the "fully offline on the tablet" story unless the host is also home. |
| **C. Precomputed vocabulary lookup** | At export time embed a large keyword list (e.g. 5–20k concepts + names + places + dates found in the library) with the real model; the tablet matches the user's phrase to the nearest vocabulary entries (string/fuzzy/synonym) and averages their stored vectors. | Zero model on tablet; instant; exact space. | Only covers words in the list; compound phrases degrade; voice mishearing needs fuzzy matching. |
| **D. Different, smaller joint text–image model for *both* index and query** (e.g. a MobileCLIP / SigLIP-family model, ~50–150 MB) | Drop Gemma for this product; use a model with a small text tower that runs on CPU. | Runs on-device end-to-end; smaller everything. | Loses video/audio/multilingual strengths of Gemma; two embedding stacks to maintain; **[verify]** licences, ONNX availability, and quality on our library. |
| **E. Auto-tagging at index time + keyword search** | Generate captions/tags (e.g. "beach, ocean, sunset") on the desktop; tablet does plain text/BM25 search over tags. | Very cheap on tablet; explainable; works with any voice engine. | No true semantic match for unseen phrasing; needs a tagging model; weaker than embeddings. |

*Lean:* ship **C + E as the baseline** (cheap, always works offline), test **A on the tablet as an
optional "full semantic" mode** and **B** where a LAN host exists. Pick D only if A is infeasible and
quality of C/E is judged insufficient. Spike S2 decides.

#### 7.3.1 Selection method: tablet first, then desktop (decided 2026-11-13)

The Fire HD is the constrained side, so **the model is chosen by what runs well on the tablet, and
the desktop indexer is then built to use that same model.** Procedure:

1. **Candidate list** (all must have a text *and* image encoder in one space, an ONNX export, and a
   licence that permits our use): EmbeddingGemma 2 (text-only on tablet), MobileCLIP-class,
   SigLIP-small/base-class, plus any others found. Licence is checked first, before any benchmarking.
2. **Tablet gate** (run on the real Fire HD, in the chosen runtime, S0/S1'): cold-start load time,
   peak RAM, per-query latency, per-image latency, no tab/app kill over 1 h. Drop anything that fails
   the N2/N3 targets or exceeds a RAM budget (measured device has ~0.68 GB free RAM: model + runtime ≤ ~150–250 MB resident, §5.0).
3. **Quality gate** (among survivors): on a labelled ~2,000-image sample with ~30 queries, compare
   Recall@10 / nDCG. Pick the **smallest model that clears the quality bar**, not the best-scoring one.
4. **Lock the contract:** record model id/revision, dtype, dimension, preprocessing and text prefixes
   in `manifest.json` (§7.2 portability rules). Run an **equivalence test**: embed the same 50 images
   and 20 queries on tablet and desktop; cosine between corresponding vectors must be ≥ 0.99 (≥ 0.975
   if quantisation differs by design), otherwise the preprocessing is not identical.
5. **Desktop indexer** then embeds the library with the locked model and exports the bundle; the tablet
   loads it and embeds queries locally.

**Implication for the extension:** `browser-ml/gemma-embeddings.ts` and `folder-search/modelCatalog.ts`
are Gemma-specific. If the winner is not Gemma, the desktop indexer needs an **embedder interface**
(`embedText`, `embedImage`, `dim`, `modelId`, `prefixes`) with Gemma as one implementation. Better to
build that interface in the frame's own package and share it, rather than changing the shipped
extension. If the winner is a small model, the desktop does not need a GPU at all (2,000 images
index in minutes on CPU).

#### 7.3.2 S1' results: real models on the tablet (2026-11-13)

Method: the S0 app's model mode (`--es mode models`) loads each ONNX file with ONNX Runtime 1.31.1 (CPU,
`armeabi-v7a`), batch 1, dummy inputs (224×224 images, 77-token text), 12 runs, median of the last 10.
Latency is the median at **4 threads**. Memory is process PSS after loading (indicative: PSS readings between
back-to-back models carry over, so treat them as ±30 MB). Quality is **not** measured here (that is S2).
Model files are the Hugging Face ONNX exports `Xenova/clip-vit-base-patch32` and `Xenova/mobileclip_s0`.

| Model (encoder, precision, file size) | Licence | Latency (4 thr) | Resident after load | Verdict |
| --- | --- | --- | --- | --- |
| **OpenAI CLIP ViT-B/32 vision, int8, 89 MB** | **MIT** | **261 ms/image** | ~150 MB | **Fits.** 2,000 images ≈ 9 min of inference. |
| **OpenAI CLIP ViT-B/32 text, int8, 65 MB** | **MIT** | **201 ms/query** (2 thr: 328 ms) | ~130–145 MB | **Fits.** Interactive; load ~1 s. |
| CLIP ViT-B/32 vision, fp32, 352 MB | MIT | 430 ms/image | ~415 MB | Too much RAM for no gain. |
| CLIP ViT-B/32 vision, fp16, 176 MB | MIT | 447 ms/image | ~425 MB (expanded to fp32 at load) | No benefit from fp16 on this CPU. |
| MobileCLIP-S0 vision, fp32, 45 MB | Apple AMLR (research) | 410 ms/image (256 px) | ~100–150 MB | Slower than CLIP B/32 int8 here, licence-restricted. |
| MobileCLIP-S0 vision, int8, 12 MB | Apple AMLR (research) | 658 ms/image (256 px) | ~85 MB | int8 is *slower* than its fp32 build on this CPU. |
| MobileCLIP-S0 text, int8, 43 MB | Apple AMLR (research) | 101 ms/query | ~105–150 MB | Faster text, but not selectable (licence). |

What this tells us:

- **A real, MIT-licensed model already meets the targets on this tablet.** CLIP ViT-B/32 int8 gives 0.26 s/image
  and 0.2 s/query inside the 150–250 MB budget, so the "small model" does not have to be exotic.
- **Phased memory:** index time needs only the vision encoder (~150 MB); query time needs only the text encoder
  (~140 MB) plus the vectors (~1 MB for 2,000 × 512 fp16). The two are never resident together, so the RAM
  budget is per phase, not combined.
- **FLOPs do not predict speed here.** MobileCLIP-S0 (fewer FLOPs, built for phones) is slower than ViT-B/32 on
  this 32-bit CPU, and int8 convolutions are slower than fp32 while int8 matmul-heavy transformers are faster.
  Always benchmark on the device.
- **Use 4 threads** (2 threads is ~1.5× slower; 8 was no better in S0).
- **Gemma and MobileCLIP drop out:** Gemma for memory (§5.0), MobileCLIP for licence and speed. Both stay
  available only as research references.

**Leading candidate: OpenAI CLIP ViT-B/32, int8 (MIT).** Known costs to check in S2: English-only text, no native
video/audio (videos via sampled frames), and quantisation loss versus fp32 (compare on the desktop). Not yet
tried: TinyCLIP (MIT, needs our own ONNX export, smaller but weaker), SigLIP-base (Apache-2.0, ~4× the image
tokens so likely >1 s/image), and an fp32 *text* tower. Still to build: the CLIP BPE tokenizer and image
preprocessing in Kotlin, and the desktop/tablet equivalence test from §7.3.1.

#### 7.3.3 S2 results: quantisation and retrieval on the user's 2025 album (2026-11-13)

Data: 1,427 JPEGs from `scripts/Photos/2025` (4.1 GB). Scripts: [`../tools/s2/`](../tools/s2/). Everything ran
locally; the photos were only read, no image was viewed by the assistant or uploaded. The album folder was added to
`.git/info/exclude` (local, uncommitted) because it was not git-ignored. 40 generic queries ("seaside", "birthday
cake", "dog", …) with the prompt template `a photo of {query}` (raw queries overlap only ~66% with templated ones, so
**the tablet must use the template**). "Overlap@10" = share of the fp32 top-10 that a configuration also returns;
it measures *fidelity to fp32*, **not relevance** (see the human-judgement step below).

**Finding 1: the public int8 files are too lossy.** The Hugging Face `*_quantized.onnx` CLIP files quantise
everything, including the patch-embedding convolution. Against fp32: image-vector cosine mean **0.92**, worst
**0.73**; text cosine mean **0.94**; top-10 overlap only **0.45** ("seaside" 0%). The S1' speed numbers for those
files (261 ms/image, 201/55 ms/query) are therefore **not** what we would ship.

**Finding 2: quantising only the MatMuls, per channel, recovers most of it.** Re-quantising the fp32 tower
(`quantize_dynamic`, `QInt8`, `op_types_to_quantize=["MatMul"]`, `per_channel=True`):

| Configuration | Image cos vs fp32 (mean / min) | Top-10 overlap vs fp32 | Tablet latency (4 thr) | Resident (indicative) |
| --- | --- | --- | --- | --- |
| Public int8 image + public int8 text (S1') | 0.92 / 0.73 | 0.45 | 261 ms img / 55 ms query | ~150 MB |
| **Requantised image (96 MB) + fp32 text (254 MB)** | **0.990 / 0.94** | **0.76** | **315 ms img / 58 ms query** | ~175–190 MB (index phase) / **~315 MB (query phase)** |
| Requantised image + requantised text (141 MB) | 0.990 / 0.94 (text cos 0.945) | 0.57 | 315 ms img / 54 ms query | ~175–190 MB / ~200 MB |
| fp32 image + fp32 text (reference) | 1.0 | 1.0 | 430 ms img | ~415 MB image alone |

- With **realistic 16-token queries** the fp32 text encoder takes **58 ms** (4 threads; the earlier 201 ms used a 77-token
  pad), so text precision is nearly free in time; its cost is **memory (~315 MB in the query phase)**.
- **The text tower is the quantisation-sensitive part** (cos 0.945 even with MatMul-only per-channel). Keep it fp32 if RAM
  allows, otherwise use the requantised text tower (~200 MB) and accept ~0.57 overlap, or precompute common query
  vectors on the desktop with fp32 (vocabulary option D3-C) and use the quantised tower only for unseen phrases.
- Indexing 2,000 images with the requantised image encoder ≈ 315 ms × 2,000 ≈ **10.5 min** plus decode/resize.

**What the overlap numbers do and do not say.** In a 1,427-photo album many photos are near-ties for a query, so
modest overlap with fp32 can still be equally relevant. Relevance needs a human. A local contact sheet is at
`D:\Temp\claude\1e874d58a8b54efe\a4a4dc9a-125a-43bb-89a9-fd3a8940a8b9\scratchpad\s2\out\contact_sheet2.html`
(28 queries × three configurations A/B/C, tick the clear matches, press the button for precision@8 per config;
it embeds thumbnails of the photos, so keep it local). **Status: awaiting the user's judgement.** Decision rule:
choose the cheapest configuration whose precision@8 is within ~10% (absolute ~0.05–0.1) of the fp32 ceiling (A).

**Updated recommendation.** CLIP ViT-B/32 (MIT) with a **self-requantised MatMul-only int8 image tower** is viable on
the tablet. Text tower: fp32 (preferred, ~315 MB in the query phase only) or requantised, pending the human judgement
above. Never ship the public `*_quantized.onnx` CLIP files. The tablet and any desktop builder must use the **same
requantised files** (record their hashes in `manifest.json`, §7.2) or vectors will not be comparable.

### 7.4 D4 — Face detection and recognition

Two jobs with different costs: (i) **library faces** (batch, offline) and (ii) **live camera**
(real-time, on tablet).

| Option | Description | Pros | Cons |
| --- | --- | --- | --- |
| **A. Reuse NameTag web engine** (`@vladmandic/face-api`: TinyFaceDetector + 68-pt + 128-d net) | Already implemented with a tested vector layer. | Zero new model work; tiny models (single-digit MB); runs on TF.js WASM/WebGL. | Older, weaker embeddings (accuracy drops with pose/low light/ageing); TF.js WebGL on Mali is uneven **[verify]**; 128-d descriptors cluster less cleanly than modern 512-d nets. |
| **B. Modern ONNX stack** (e.g. a lightweight detector such as YuNet/SCRFD-small/BlazeFace + ArcFace/MobileFaceNet-class embedder) | Better accuracy per MB; ONNX Runtime Web (WASM) is already in the extension. | Higher accuracy under pose/light; 512-d; good alignment; actively used. | New integration; model licences vary (some popular face weights are non-commercial) **[verify before adopting]**; more work than A. |
| **C. MediaPipe Face Detection / Landmarker** (NameTag already ships `public/mediapipe`) | Fast detection + landmarks on mobile. | Optimised for mobile, accurate small-face detection. | Detection/landmarks only — still needs an embedder; WASM/WebGL delegate on Fire OS **[verify]**. |
| **D. Native Android ML (ML Kit / LiteRT)** | Platform detectors. | Fastest. | ML Kit needs Google Play services: present on the user's tablet only because it was sideloaded (Fire Toolbox), so **do not depend on it**. Not web-portable. |

Design rule regardless of option: **use the same detector, aligner and embedder** for library
indexing (desktop) and live probing (tablet), or the vectors are not comparable.

*Lean:* **A for a first end-to-end demo** (it exists), run a head-to-head vs **B** on a labelled set
from the user's own photos plus tablet-camera captures (spike S3), then lock one.

**Recognition logic (option-independent):**

- Enrol a person from ≥ 5–10 varied faces; store a **centroid + exemplars** rather than a single vector.
- Live: detect a face every 500–1000 ms (not every frame); require the **same person to win N
  consecutive frames** (e.g. 3 of 4) with a margin over the runner-up before switching.
- Thresholds are **calibrated per device** on tablet-camera captures; expose "recognition
  sensitivity" in settings. Log similarity scores for tuning (as the extension already does for
  search).
- Quality gates: ignore faces smaller than a pixel-size floor, too blurry, or too dark; show a gentle
  "come a little closer" cue only in setup, never in normal use.

### 7.5 D5 — Voice control

| Option | Description | Pros | Cons |
| --- | --- | --- | --- |
| **A. Web Speech API (`SpeechRecognition`)** | Browser built-in. | No model to ship; trivial code (speech package + `speechPolyfill` exist). | On Chromium it normally sends audio to a cloud service — violates N7/G6 — and may be missing in Silk **[verify]**. |
| **B. On-device Whisper (tiny/base) via transformers.js or whisper.cpp** | Open-source offline STT. | Good accuracy, multilingual; transformers.js is already a dependency. | CPU-only on this device is slow (seconds per utterance) and RAM-heavy; needs VAD/segmenting (`utteranceCutter` exists). |
| **C. Small keyword/grammar recogniser (Vosk-style, or a small streaming model with a constrained grammar)** | Tiny offline model, supports a restricted command vocabulary. | ~40 MB, real-time on weak CPUs, high accuracy for a closed command set. | Weak on open vocabulary (names, "seaside"); needs a separate path for free-form queries. |
| **D. Two-tier (recommended shape)** | Tier 1: wake word or push-to-talk + grammar recogniser for fixed commands (*pause, next, delete, yes, cancel, show me …*). Tier 2: free-form transcription (Whisper or Web Speech *if the user accepts cloud*) only for the phrase after "show me …" and for names. | Fast and robust for control; heavier model runs only when needed. | Two engines to integrate. |
| **E. Native Android recogniser** | OS `SpeechRecognizer`. | Integrated. | **Not available on the user's tablet (measured):** `SpeechRecognizer` reports unavailable and no recognition service is installed, even with sideloaded Play Services. |

**Names are the hard case.** Mitigations: (1) constrain to the known people list plus "new person
…"; (2) show the transcribed text on screen with an "is this right?" step; (3) allow touch/keyboard
fallback; (4) phonetic fuzzy-match to existing names; (5) allow recording the name once as a voice
sample for later matching.

**Audio hygiene:** push-to-talk (tap, or a wake word) rather than an always-open mic by default;
duck/pause video audio while listening; reuse `echoGuard`; show a visible "listening" indicator.

*Lean:* **D** with grammar-based commands first; free-form query via on-device Whisper-tiny as an
opt-in, **and Web Speech only if the user explicitly accepts cloud audio**. Spike S4 measures latency
and accuracy on the tablet mic.

### 7.6 D6 — Deletion model

"Delete with confirmation" has three meanings with different consequences:

| Option | Behaviour | Fits when |
| --- | --- | --- |
| **A. Hide** | Mark as removed in the frame's index only; original untouched. | Originals are not writable (web-only, microSD read-only). Safe default. |
| **B. Move to a trash folder** | Original moved under `.trash/` with 30-day retention; "undo" available. | Tauri/native app or LAN server with write access. Recommended when possible. |
| **C. Permanent delete** | Remove the file. | Only with explicit settings opt-in; never the default. |

Confirmation flow (all options): on "delete this photo" show a **toast with the thumbnail, a
countdown (e.g. 8 s), and Confirm / Cancel buttons**; voice "yes/confirm" or "cancel/no" also works;
no response ⇒ cancel; the photo is paused during the confirmation and an **undo toast** appears
afterwards. Deleting a *person's* photo while in walk-up mode deletes the photo, not the person.

Consequence: with desktop-built bundles (D2-B), deletion on the frame only edits the *tablet copy*;
we need a **tombstone list** exported back (or applied on the next sync) so the desktop original is
also trashed.

*Lean:* **A in a web-only tablet, B once there is a write path**; C is a hidden advanced setting.

### 7.7 D7 — Presence-based display policy

When the camera sees someone:

| Situation | Options |
| --- | --- |
| One recognised person | Switch to their photos (slow cross-fade); return to ambient after 30–60 s without a face. |
| Several recognised people | (a) show photos that contain **all** of them, falling back to (b) alternate between them, or (c) prefer the largest/closest face. Make it a setting. |
| Unrecognised face | Do nothing visible. Never show "unknown person". |
| Flapping | Hysteresis: N consecutive wins to enter, M seconds absence to leave. |
| Privacy of content | Optional per-person "private" tag so an album only appears when *that* person is recognised alone. |

**Duty cycle / power:** camera runs at low fps; detect at 1–2 Hz; if no face for X minutes drop to
0.5 Hz; optionally disable the camera on a schedule (night). The camera preview is **never shown**
and frames are **never stored**; only a similarity score is kept transiently.

## 8. Feature designs (option-independent)

### 8.1 Slideshow state machine

```
          face recognised / voice "show X"
AMBIENT ────────────────────────────────▶ FILTERED(person | query)
  ▲   ▲                                         │
  │   └──── idle timeout / "show everything" ───┘
  │
  │ "pause"                    "resume"
  ├──────────▶ PAUSED ─────────────────▶ (previous state)
  │              │ "name the faces"
  │              ▼
  │          NAMING (§8.3)
  │ "delete this photo"
  └──────────▶ CONFIRM_DELETE (§8.4) ──▶ (previous state)
```

Slideshow engine: preload next 2 images, cross-fade, `object-fit: contain` with blurred backdrop for
mixed aspect ratios, video plays muted by default (voice "sound on"), burn-in prevention by slow pan
and overnight dim/black.

### 8.2 Voice command set (closed grammar, tier 1)

| Intent | Examples |
| --- | --- |
| Search | "show me *seaside*", "photos of *Priya*", "Priya at the beach" |
| Playback | "pause", "resume", "next", "back", "slower", "faster", "show everything" |
| Naming | "name the faces", "this is Rahul, Priya, Asha", "second one is Priya", "skip", "done" |
| Delete | "delete this photo" → "yes" / "cancel" |
| System | "dim the screen", "stop listening", "sound on/off" |

### 8.3 Naming faces left → right

1. User says "pause" then "name the faces" (or taps).
2. The frame detects faces in the current photo (cached from the index if present) and sorts them by
   the **centre x of each bounding box, left to right in the displayed image** (not the stored
   file orientation — apply EXIF rotation first).
3. Numbered badges 1…n appear on the faces; faces that already have a name show it, unknown faces
   show a number.
4. User says "this is Rahul, Priya, Asha" → names are assigned in order to the **unnamed faces** (or
   to all faces if the user says "all"); "skip" leaves a face unnamed; "second one is Priya"
   targets a number.
5. Show the parsed assignment as text for a 3 s confirm; commit; the face embeddings join the
   person's exemplar set, improving later recognition. Provide **undo**.
6. Edge cases: two faces overlap/rows (sort by x then y); a face is wrong person → "number 2 is
   not Priya"; new name vs. existing person spelled differently ("Pria" vs "Priya") → fuzzy match and
   ask.

### 8.4 Delete flow

See §7.6. UI contract: modal-free toast anchored at the bottom with the thumbnail, countdown ring,
two large buttons (touch targets ≥ 48 dp), spoken prompt optional, `aria-live` announcement for
accessibility.

### 8.5 Data model (tablet side)

| Entity | Fields |
| --- | --- |
| `media` | id, kind, path/uri, w, h, takenAt, duration, thumbUri, vector, deleted? |
| `face` | id, mediaId, box, embedding, personId?, quality |
| `person` | id, name, centroid, exemplarFaceIds, private? |
| `tombstone` | mediaId, deletedAt, mode (hide\|trash\|delete), synced? |
| `settings` | thresholds, dim schedule, camera schedule, voice mode, presence policy |
| `meta` | embedding model, dtype, dim, face model versions (mismatch ⇒ re-index prompt, as in the extension) |

Storage: IndexedDB (as in the extension) or SQLite (sql.js as NameTag uses; native SQLite if Tauri/native).
Vector search: brute-force dot product over a contiguous typed array is fine at N4 sizes
(2k × 256 floats ≈ 2 MB; 20k ≈ 20 MB), as the extension's design already concluded.

## 9. Candidate end-to-end architectures

```
A. Standalone tablet            B. Desktop-built bundle            C. Home-server thin client
┌──────────────────┐            ┌─────────────┐   export   ┌────────────────┐    ┌──────────┐ LAN ┌──────────────┐
│ Tablet           │            │ Desktop     │ ─────────▶ │ Tablet         │    │ Tablet   │ ◀─▶ │ Server       │
│ index+embed+face │            │ extension / │  USB/SD/   │ show + query   │    │ show only│     │ index, embed,│
│ +voice+display   │            │ CLI indexer │  LAN       │ + live faces   │    │ + camera │     │ faces, trash │
└──────────────────┘            │ + clustering│            │ + voice        │    │ + mic    │     │              │
                                └─────────────┘            └────────────────┘    └──────────┘     └──────────────┘
```

| Criterion | A. Standalone | B. Desktop bundle (+ tablet runtime) | C. Server + thin client | D. Native Android |
| --- | --- | --- | --- | --- |
| Feasible on Fire HD hardware | ✗ for >few hundred photos | ✓ (light work only) | ✓ | ✓ best perf |
| Reuses existing code | medium | **high** (extension indexer, ranking; NameTag engine) | high server-side; client new | low |
| Fully offline on tablet | ✓ | ✓ (with D3-C/E or on-tablet text model) | ✗ needs LAN host | ✓ |
| Privacy (N7) | ✓ | ✓ | ✓ if server is local | ✓ |
| New photos appear automatically | ✗ | ✗ (re-export) | ✓ | depends |
| Real delete / trash | ✗ | ✗ (tombstones) | ✓ | ✓ |
| Setup friction | low | medium (export step) | high (server) | medium (sideload) |
| Failure mode | slow/crash | stale index | blank frame if server off | build/maintenance |
| Estimated effort | – | **medium** | medium-high | high |

**Superseded recommendation (before device measurement):** Option B, Silk-first, Gemma text optional.

**Current recommendation (2026-11-13, after measuring the Fire HD 10 9th gen):** **Option E
(fully on-tablet)**, runtime **D1-E (KMP / native Android, 32-bit)**, embedding model a **small joint
image–text model for both index and queries** (§7.3.1, ≤ ~250 MB resident), faces a **new in-repo
module** (§4.1, small detector + embedder, same code for library and live camera), voice **D5-D**
with an offline engine that ships `armeabi-v7a`, deletion **D6-B** (app trash folder, possible with a
native app). The desktop may still build the index as an optional accelerator, but only with the
*same small model* the tablet uses. Gemma-based options (D3-A, Option B with Gemma vectors) are
dropped for this device. This is still a hypothesis; §12 is how we test it. Fall back to Option C
(home server) only if the on-device spikes fail the N1–N3 targets.

### 9.1 Option E — Fully on the tablet (added 2026-11-13)

**Requirement update:** the frame must run fully on the Fire HD, and **NameTag cannot be used as is**
(see §4.1). Option B's desktop step is therefore out; this is the variant to design for.

**What changes**

| Area | Fully on-device choice |
| --- | --- |
| Embedding model | **Replace EmbeddingGemma 2** with a mobile-sized joint image–text model (MobileCLIP / SigLIP-small class, tens of MB). Same model embeds library images and queries. Videos: sample keyframes. Loses Gemma's audio and multilingual strengths. **[verify]** ONNX availability, licence, quality (spike S2'). |
| Indexing | Either (a) background job on the tablet while charging, resumable, newest first; ~2,000 images ≈ 10–30 min with a mobile CLIP-class model **[verify S1']**; or (b) **build on desktop with the existing extension and import the bundle** (§7.2 portability rules), which also keeps Gemma available for the index if the tablet can host its text encoder. |
| Faces | Library pass runs on the tablet with the same detector/embedder as the live camera; resumable; downscale to ~640 px before detecting. ~2,000 photos ≈ 30–40 min **[verify S3]**, so no need to port face vectors from the desktop. |
| Runtime | **Native Kotlin / KMP (D1-E)**; Tauri (D1-B) demoted because of the old system WebViews (§5.0). Reasons: survives memory pressure, runs as a foreground service, can use native ONNX Runtime/XNNPACK for ~2–4x over WASM **[verify]**, gets real file access to internal storage/microSD, and real trash/delete. |
| Photo source | Photos copied to the tablet or microSD (USB, SD card, or one-off LAN copy). The frame then owns the library. |
| Voice | Tier-1 grammar recogniser on-device; free-form queries via Whisper-tiny only if latency is acceptable, otherwise typed/tag-picker fallback. |
| Delete | Move to an app trash folder (D6-B) becomes possible with a Tauri/native app. |

**Cost of this option:** lower semantic quality than Gemma; first-run indexing takes hours; thermal
and storage budgeting matter (S6). **Benefit:** one device, no server, no export, fully private.

**New spikes:** S1' (mobile CLIP-class model: per-image and per-query latency, peak RAM, recall vs
Gemma on a 2–5k sample) replaces S1/S5; S3 gains an overnight library-pass timing.

## 10. Privacy, security and safety

- **Local only:** no cloud calls for images, audio or faces (N7). Model downloads happen once, with
  user consent, as in the extension. The bundle travels over USB/SD or the LAN.
- **Biometric data:** face embeddings are biometric identifiers. Store them only on the frame/desktop,
  encrypt at rest where the platform allows, provide **"Delete all face data"**, and enrol only people
  who agreed (the household), never visitors.
- **Camera/mic transparency:** a persistent on-screen indicator when the camera is analysing and when
  the mic is listening; physical camera cover advice; a "pause sensing" voice command and switch.
  Frames are processed in memory and discarded.
- **Children and guests:** default to no enrolment of children without a household decision; the
  frame never labels or reacts to unrecognised people.
- **Spoofing:** a photo held up to the camera could trigger someone's album; acceptable for a photo
  frame, but document it. Do not use recognition to unlock anything sensitive.
- **LAN server (if used):** bind to the LAN only, require a pairing token, no open internet exposure,
  `127.0.0.1`/LAN interfaces per the repo's security guidance, no secrets in git.
- **Legal:** biometric laws vary by jurisdiction (consent/notice for face templates). We should add
  a consent screen and retention policy before any distribution beyond personal use.
- **Delete safety:** never permanent by default; undo window; tombstones.

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| No WebGPU and weak CPU make on-tablet Gemma impractical | **High** | High | Plan baseline D3-C/E; B/C options; spike S1/S2 early. |
| Silk/WebView lacks camera/mic/permission persistence or voice API | Medium | High | Spike S0; Tauri app (D1-B) or native (D1-C). |
| Face recognition inaccurate with the 2 MP camera | Medium | Medium | Per-device calibration; stricter consecutive-frame rule; modern embedder (D4-B); setup guidance (distance/light). |
| STT mishears names | **High** | Medium | Constrained grammar, confirmation step, touch fallback. |
| Thermal throttling / OOM in long runs | Medium | Medium | Duty-cycled sensing, bounded caches, watchdog reload, soak test. |
| Model licences (face weights, CLIP-family) restrict use | Medium | Medium | Licence check before adopting any model (S3). |
| Gemma embedder untested in a real browser | Medium | Medium | Validate on desktop first before packaging the index (S2 prerequisite). |
| Scope creep (video semantic search, multi-frame sync) | Medium | Medium | Phase plan §13. |

## 12. Spikes — how we decide

Each spike is short and ends in a recorded number so the decisions in §7/§9 are evidence-based.

| # | Question | Method | Pass criterion |
| --- | --- | --- | --- |
| **S0** | What exactly can the Fire HD browser do? | Open a test page in Silk and in a minimal native Android test app (WebView page plus a native ONNX Runtime load; Tauri 2 shell only if still wanted): print `navigator.gpu`, `getUserMedia` (https/localhost), `SpeechRecognition`, wake lock, WASM SIMD/threads, memory (`performance.memory`, `navigator.deviceMemory`), `showDirectoryPicker`. Record Chromium version, RAM, free storage. | A one-page capability table for the user's actual model(s). **Status: done for the native app (§5.0.1); the Silk/Chrome page checks are no longer needed now that native Android is chosen.** |
| **S1** | Can the tablet run any Gemma text encoder? | Load fp16 text model on WASM; measure load time, peak memory, per-query latency. If WebGPU exists, repeat q4. | Cold start ≤ 20 s, query ≤ 1.5 s, no tab kill over 1 h. **Status: superseded by S1' (§7.3.2). Gemma is ruled out on memory; CLIP ViT-B/32 int8 passes the latency and RAM gates (0.26 s/image, 0.2 s/query, ~150 MB). Quality gate (S2) still open.** |
| **S2** | Does vocabulary/tag search (D3-C/E) give acceptable results vs full Gemma? | On a 2–5k photo sample indexed on desktop, compare top-10 for ~30 queries (seaside, ocean, birthday, snow …) by full-Gemma vs vocabulary vs tag search; label relevance. | Recall@10 within an agreed gap of full-Gemma (e.g. ≥ 80%). |
| **S3** | Which face stack works with this camera? | Capture 20+ frames of 3–4 people at 1, 1.5, 2 m in day/dim light; enrol each from ~10 library photos; compare NameTag (A) vs a modern ONNX stack (B) on TPR/FPR, latency, memory; verify licences. | ≥ 95% correct at 1.5 m in normal light with < 1% wrong-person switches; ≤ 500 ms per detection+embed. |
| **S4** | Is voice good enough? | Test grammar recogniser and Whisper-tiny on the tablet mic at 1–2 m with room noise; measure command accuracy, name accuracy, latency; test self-echo with video audio. | ≥ 95% command accuracy; ≤ 1.5 s latency; names workable with the confirm step. |
| **S5** | Is the bundle workable? | Export an index from the extension (or a script) and load it on the tablet; check size, load time, scroll/slideshow smoothness, brute-force search time. | Load ≤ 10 s, search ≤ 200 ms for 20k vectors. |
| **S6** | Soak/thermal | Run slideshow + camera loop for 8–12 h powered. | No crash, no visible throttling, memory flat. |

Suggested order (updated 2026-11-13, tablet-first model selection, §7.3.1): **S0 → S1' (tablet gate
across candidate models, then quality gate = S2) → lock model + equivalence test → S5 (desktop
bundle import) → S3 → S4 → S6**. S0 decides whether plain Silk, Tauri or native
app is even possible, so run it first; it is ~1 hour of work.

### 12.1 Runtime decision record (app platform)

The app lives in `packages/smart-photos/`. Question: HTML, Tauri, React Native or KMP (native Android)?

**Already settled by measurement (2026-11-13):**

| Option | Verdict | Evidence |
| --- | --- | --- |
| HTML page in Silk | **Rejected** for the main app (prototype UI only) | Silk = Chromium 85, no WASM SIMD, no WebGPU, 32-bit; camera only via `getUserMedia` (§5.0, §5.0.1). |
| Tauri | **Rejected** | WebView is Amazon WebView 75 (no SIMD); a WebView shell cannot run the models acceptably (§5.0.1). |
| KMP / native Android | **Leading** | ONNX Runtime 1.31.1 runs on `armeabi-v7a`; Camera2 gives 1600×1200 at 15 fps; real files, services (§5.0.1, §7.3.2). The user's `ochat` repo already uses KMP/Compose Multiplatform. |
| React Native | **Open, untested** | Needs 32-bit builds of ONNX Runtime, a camera frame pipeline and an offline speech engine; JS-bridge cost in the camera loop. |

**Gate (the vertical slice, `packages/smart-photos/slice/`)** proves the three unknowns on the real tablet, in native
Kotlin (the Android target of the future KMP project; shared `commonMain` code is introduced when we adopt it):

| # | Unknown | Slice test | Pass |
| --- | --- | --- | --- |
| G1 | 32-bit face stack | Detect + align + embed a live face (YuNet + SFace via ONNX Runtime); licences checked | Detection ≤ 150 ms and embedding ≤ 150 ms per frame; same person's repeated frames cosine ≥ 0.6 and different-person < 0.4 where testable; licences permit the intended use |
| G2 | 32-bit offline speech | Vosk small English model with a closed command grammar | ≥ 90% of ~20 spoken commands recognised at ~1 m; result ≤ 1.5 s after the utterance |
| G3 | Camera → model loop | Camera2 YUV at 1–2 Hz into G1 for **30 min** on the charger | No crash/OOM; frame rate and latency stay within 20% of the first minute; battery temperature rise ≤ 10 °C; memory flat |

**Decision rule:** all of G1–G3 pass ⇒ **KMP (native Android) is adopted**, recorded here with date and numbers, and P1
starts. Any fail ⇒ check whether React Native (or an alternative library) solves that specific failure *before*
adopting it; if neither does, the fallback is Option C (home server, §9). **Decision date: when the slice's 30-minute
run has finished.**

**Interim results (2026-11-13, slice at `packages/smart-photos/slice/`, native Kotlin, `armeabi-v7a`, ONNX Runtime 1.31.1, Vosk 0.3.75):**

| Gate | Evidence so far | Status |
| --- | --- | --- |
| G1 face stack | Port validated against the Python reference on a real photo: embedding cosine **0.985**, box within ~1 px, score 0.934 vs 0.935. Isolated latency on 1280×960 frames: **detect 138 ms median, embed 109 ms** (both ≤ 150 ms). An un-timed 95 ms cost was a heap→native buffer copy, removed with a reusable direct buffer (detect 214 → 138 ms). **Under full load** (camera + mic + YUV conversion) detect rises to **~230 ms**, embed stays ~108 ms. Licences: YuNet MIT, SFace Apache-2.0 (SFace's training-data terms not verified). Reference run on 120 album photos: 96 had faces, 195 faces, median face width 8% of frame. | Latency **pass in isolation**; **identity test (same ≥ 0.6, different < 0.4) pending a live session** |
| G2 speech | Vosk small English model (41 MB, 32-bit `libvosk.so`) with a 21-command grammar plus `[unk]`: **21/21 commands correct, 4/4 unrelated phrases rejected**, decode ≈ **0.11× real time**, model load 1.2–1.3 s. Test audio was **synthetic clean TTS** (Microsoft David), so this is optimistic; a WAV-header bug (SAPI's audio starts at byte 46, not 44) was found and fixed. 30 minutes of open-mic listening in a quiet room produced **0 false commands**. | **Pass on synthetic speech**; **live ~1 m test pending** |
| G3 camera → model loop (30 min, USB power, quiet room, nobody in front) | 2,869 cycles, **no crash**. Cycles/30 s 50.3 → 47.8 (**−5%**); detect 203 → 236 ms (**+16%**); embed 110 → 110 ms; battery temperature 22 → 23 °C (**+1 °C**); PSS 240 → **261 MB (+21 MB, ~0.7 MB/min)**. Loop cost per cycle ≈ YUV→ARGB conversion ~200 ms + detect ~230 ms + embed ~108 ms ≈ **540 ms**, i.e. ~1.7 Hz, not the planned 2 Hz. | Crash/rate/latency/temperature **pass**; **memory flat: inconclusive** (fix per-frame allocations, rerun); no real face was in view, so embeddings were synthetic |

Caveats: CPU frequency samples taken from the host swung between 0.8 and 2.0 GHz (the governor scales dynamically; this does not by
itself prove thermal throttling, and latency stayed within +16%); the run was on USB power from a PC in a cool room, so a
wall-charger, warm-room soak is still needed (S6). Cheap wins identified: do the colour conversion at the detector's
input size or in native code (~200 ms now), reuse per-frame arrays, and consider detecting at ≤ 1.5 Hz.

**Live session results (2026-11-14, same slice, now with a guided enrolment/recognition UI; the device owner at ~1 m, real microphone and front camera):**

| Gate | Evidence | Status |
| --- | --- | --- |
| G2 speech, live | Guided one-command-at-a-time test: the prompt waits until the recogniser hears exactly the phrase. **All 21 commands were completed in order** with the real mic at ~1 m. Results arrived **0.7–1.3 s** after the speaker finished (limit 1.5 s). Unrelated sentences produced no command. Recognition sometimes merged back-to-back commands into one result ("next photo previous photo …"), and "resume" came back as "the resume": the app must match phrases inside a result, not require an exact string. First-attempt accuracy was **not** recorded (the attempt log was lost on an app restart). | **Pass** (accuracy per attempt still to be counted) |
| G1 face, live identity | First two live runs used a **single enrolment frame**: same-person cosine mean 0.43 (n=104, min 0.04, max 0.82) and 0.46 (n=168, max 0.90): **below the 0.6 target**, but the label stayed on "same" while the user spoke, looked away and moved, so these numbers mix good and bad frames. A 5-pose enrolment (straight, left, right, chin up, chin down; auto-captured) was completed and saved; **the same-person / different-person scores with the 5-pose enrolment have not been measured yet.** | **Pending** (needs one live run with a second person) |
| Persistence | Enrolment (5 embeddings + name) is saved to app-private storage and reloaded on launch (`LOADED enrolment: 5 embeddings`); the name can be set by typing or by saying "this is <name>". | Works |

**Engineering finding: camera stall.** With the `ImageReader` holding a 2-image pool and the colour conversion running inside the
camera callback, the camera stopped delivering frames after ~60–185 frames (no error, process alive, the HAL reported
"Frames produced: 185"). It happened in portrait, where the rotation step is slower, and also with the old text-only mode.
Fix: copy the YUV planes out and release the image immediately, convert on the worker thread, and raise the pool to 4. After
the fix: **958 frames in 50 s (~19 fps), analysis ticking continuously**. Lesson for the real app: never do per-frame work
while holding a camera buffer, and never add a second capture stream (a `TextureView` preview stream also froze the session on
this device). The on-screen mirror is drawn from the same frames at ~12 fps.

**Rotation:** the camera frame rotation is now recomputed from the display rotation on every frame, so the picture and the
face box follow portrait/landscape. Verified in portrait; landscape still to be confirmed by hand.

**G1 identity result (2026-11-14, two people enrolled with the guided 5-pose scan; the scan itself is the test):**

| Measure | Result | Target |
| --- | --- | --- |
| Same-person scores (all pose pairs of one person, n = 16) | mean **0.66**, min 0.48, max 0.88 | ≥ 0.6 on average |
| Different-person scores (every pose of person A against every pose of person B, n = 20) | mean **0.20**, min 0.11, max **0.34** | < 0.4 |
| Gap between the groups | highest different-person 0.34 < lowest same-person 0.48; OpenCV threshold 0.363 sits in the gap | separable |
| Live recognition of the enrolled owner (several launches, including portrait and landscape, a hand over the chin, a low camera angle) | 0.62, 0.66, 0.68, 0.75, 0.82 | ≥ 0.363 |

Caveats: one pair of people; the second person's scan captured 4 of 5 poses (one skipped); the owner's own pose pairs go as low
as 0.48 (left vs right profile), so the threshold must stay low and a 5-pose template is needed; live different-person scores
were not recorded separately (the template cross-scores above stand in for them). Worth re-measuring with a larger household
once the real app exists.

**Decision (2026-11-14): native Android is adopted as the app platform (Kotlin now, KMP shared code introduced in P1).**
G1 passes (latency in isolation, identity separation), G2 passes (21/21 live, 0.7–1.3 s), G3 passes on crash, rate, latency and
temperature. React Native was not needed and was not tested. **Still open, none of which reverses the decision:** (1) a 30-minute
re-run of the soak with the final UI to confirm memory is flat (the UI has run for several minutes at 245–268 MB); (2) a
wall-charger, warm-room soak (S6); (3) first-attempt voice accuracy per command, which was not logged; (4) per-frame colour
conversion (~200 ms) still to be made cheaper.

**Product flow validated in the slice (carry into P1):** first scan → name; "Add person" for each further person (refuses a
face that is already enrolled, ≥ 0.50 similarity); recognition against everybody (best match ≥ 0.363); unknown face → "Unknown
person - tap ADD PERSON"; names are tidied to Title Case; "Start over" names the people it will erase and asks for confirmation;
enrolment is stored app-private and survives restarts. **Voice listening is OFF by default** and is cycled from the mic icon: OFF (microphone released, voice model not even loaded) → AUTO (listens only while a face was seen in the last 5 s) → ON (always); each change shows a toast.

## 13. Phasing (once the option is chosen)

| Phase | Scope | Exit |
| --- | --- | --- |
| **P0** | Spikes S0–S6; pick architecture; update this doc §9 to "Decided". | Written decision + numbers. |
| **P1 — Frame** | Index bundle export from desktop; tablet slideshow (images + video); keyword/tag search; touch UI only. | Usable offline frame. |
| **P2 — Faces** | Library face detection + clustering on desktop; naming UI (touch); person albums. | Browse by person. |
| **P3 — Presence** | Live camera recognition, hysteresis, presence policy, privacy indicators. | Walk-up works reliably. |
| **P4 — Voice** | Grammar commands; query phrases; left→right naming; voice delete + toast. | Hands-free operation. |
| **P5 — Semantics on device (optional)** | Gemma text encoder or alternative on tablet; "Priya at the beach" composition. | Full semantic search. |
| **P6 — Hardening** | Sync tombstones, trash, kiosk mode, boot-start, soak tests, settings. | Appliance-grade. |

## 14. Open questions for you

1. ~~Which Fire HD model and free storage?~~ Answered in §5.0: Fire HD 10 (9th gen), 17 GB free.
2. Where do the photos live today — one PC folder, NAS, cloud export? Is there a machine that could
   stay on 24/7 (option C)?
3. Is a **desktop export step** acceptable, or must the frame work by itself from an SD card?
4. Is any **cloud speech** acceptable for free-form queries, or strictly offline?
5. Who gets enrolled (family only)? Are children/guests in scope, and is a consent screen required?
6. Should delete be **hide-only** in v1, or must it remove/trash originals?
7. Do you want **video** semantic search in v1 (needs vision encoder + frame sampling at index time),
   or images only?
8. Should this live in this monorepo as a new package (e.g. `packages/photo-frame`) sharing
   `folder-search` code, or as a separate repo that consumes it?
9. The brief's last sentence was truncated — is there more of the existing-functionality statement
   to capture?

## 15. References

- EmbeddingGemma 2 developer guide: https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/
- EmbeddingGemma 2 WebGPU demo (Embed Anything): https://huggingface.co/spaces/webml-community/embeddinggemma-2-webgpu
- This repo: `packages/extension/docs/designLocalFolderSearch.md`, `packages/extension/src/browser-ml/gemma-embeddings.ts`, `packages/extension/src/folder-search/*`, `packages/cognitive-brain/speech/*`
- NameTag: `d:\Github\NameTag\docs\design.md`, `NameTagApp/src/ml/inferenceEngine.web.ts`, `NameTagApp/src/recognition/recognitionService.ts`

---

## Appendix A: Original brief

> I want to design a Smart Photo Frame app or html page to display Photos. This has to work in Fire HD tablet.
>
> Here are the requirements -
>
> 1> Ability to use a model like EmbeddingGemma or something suitable that lets us fetch images or videos based on keywords like seaside or ocean etc.
>
> 2> Ability to detect and recognize faces in Photos
>
> 3> Use FireHD camera to capture the face of the person standing in front of the table and use a feature like d:\Github\NameTag to recognize faces. If a person's face is recognized, we will automatically show photos for that person. We will also allow users to request photos by voice commands. Ability to pause a photo using voice commands and assign names to faces from left to right.
>
> 4> Ability to delete a photo using voice commands along with a toast confirmation before delete
>
> References
> https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/
> https://huggingface.co/spaces/webml-community/embeddinggemma-2-webgpu
>
> This smart search extension already has functionality to *(sentence truncated in the original)*

## Appendix B: Facts from the repo vs. assumptions

| Statement | Basis |
| --- | --- |
| EmbeddingGemma 2 gives one 768-d space for text/image/audio/video; q4 text 174 MB + vision 109 MB; WebGPU required, fp16 CPU fallback 543 + 336 MB | `designLocalFolderSearch.md` §3.2 (from the model card as of 2026-10-18) |
| Gemma embedder code never executed in a real browser | `designLocalFolderSearch.md` status notes |
| NameTag web = face-api TinyFaceDetector + 68-pt + 128-d, cosine 0.7, Orama + sql.js | `NameTag/docs/design.md`, `inferenceEngine.web.ts` |
| Extension indexer stores vectors, 256 px thumbnails, `meta` with model/dtype/dim | `designLocalFolderSearch.md` §3.4 |
| Fire HD 10 9th gen: Fire OS 7/Android 9, 32-bit ABI, 1.83 GB RAM, MT8183, Silk 85, WebViews 66/75, Chrome 119, 1600×1200 front camera, sideloaded Play Services | **Measured via ADB 2026-11-13** (§5.0, [KindleFireHD.md](KindleFireHD.md)) |
| ONNX Runtime 1.31.1 runs on `armeabi-v7a` (CPU 4 threads ≈ 21 ms for a 0.4 GFLOP conv; NNAPI slower), camera 15 fps at 1600×1200 with fixed focus, mic floor −60.8 dBFS, no system speech recogniser, native WebView = Amazon WebView 75 | **Measured by the S0 probe 2026-11-13** (§5.0.1, `s0-probe/`) |
| WebGPU absence (inferred from Chromium/Android versions, not probed), real-model latency and RAM, face accuracy at range and in dim light, speech accuracy at distance, sustained thermals, 32-bit builds of speech/face libraries | **Still unmeasured → S1', S3, S4, S6** |
| Licences of candidate face and CLIP-family models | **Assumptions → S3** |
