# Development only: copy the search and voice models from this folder to a tablet over adb.
# (Ordinary users get the models from the app's first-run download screen instead.)
#
#   .\push-models.ps1            # to the connected tablet
#
# Checks each CLIP file against the fixed SHA-256 (docs/MODELS.md) before copying, so a wrong file is never pushed.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkg  = "com.smartphotos.frame"
$dest = "/sdcard/Android/data/$pkg/files/models"

$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb -and $env:ANDROID_HOME) { $adb = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe" }
if (-not $adb -or -not (Test-Path $adb)) { throw "adb not found. Put platform-tools on PATH or set ANDROID_HOME." }

$expected = @{
  "clip_b32_vision_q8mm.onnx" = "0a8e2bba4c35a7549f7d0611d4f7e5df7b979ef94178b8c4ab1e7d71d6accd6a"
  "clip_b32_text_q8mm.onnx"   = "bb57af7e847e6154b11552fe21e1157765b9fa327e10279703775ca48523a4ae"
}
foreach ($name in $expected.Keys) {
  $f = Join-Path $here $name
  if (-not (Test-Path $f)) { throw "Missing $name in dev-models. See README.md for where to get it." }
  $got = (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $expected[$name]) { throw "$name does not match its fingerprint (got $got). Refusing to push." }
  Write-Host "ok  $name"
}
$vosk = Join-Path $here "vosk-model-small-en-us-0.15"
if (-not (Test-Path (Join-Path $vosk "am\final.mdl"))) { throw "Missing the unpacked vosk-model-small-en-us-0.15 folder in dev-models." }

& $adb shell mkdir -p $dest
foreach ($name in $expected.Keys) { & $adb push (Join-Path $here $name) "$dest/" }
& $adb shell rm -rf "$dest/vosk-model-small-en-us-0.15"
& $adb push $vosk "$dest/"
Write-Host "Done. Models are in $dest"
