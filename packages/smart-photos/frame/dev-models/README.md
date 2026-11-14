# dev-models: a scratch folder for the search and voice models

**Development only.** Ordinary users never see this folder: the app downloads the models itself on first run (see `docs/MODELS.md`).

Everything here except this README, `.gitignore` and `push-models.ps1` is **git-ignored** (the models are about 310 MB once unpacked; never commit them).

Put these in this folder:

| Item | Where to get it |
| --- | --- |
| `clip_b32_vision_q8mm.onnx` | https://huggingface.co/GuideAxon/smart-photos-clip-b32-q8mm/resolve/main/clip_b32_vision_q8mm.onnx |
| `clip_b32_text_q8mm.onnx` | https://huggingface.co/GuideAxon/smart-photos-clip-b32-q8mm/resolve/main/clip_b32_text_q8mm.onnx |
| `vosk-model-small-en-us-0.15/` (unzipped folder) | https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip (unzip it here, so `vosk-model-small-en-us-0.15/am/final.mdl` exists) |

Then copy them to the tablet:

```powershell
.\push-models.ps1
```

The script checks each CLIP file's SHA-256 first and refuses a wrong file. The files land in `/sdcard/Android/data/com.smartphotos.frame/files/models/`; the app finds them there and does not ask to download.

To test the real download instead, remove that folder on the tablet (`adb shell rm -rf /sdcard/Android/data/com.smartphotos.frame/files/models`) and start the app.
