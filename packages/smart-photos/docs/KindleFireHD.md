# Kindle Fire HD 10 (9th gen) - ADB connection notes

Reference for connecting to this tablet over ADB from other projects.

## Device

| Item | Value |
|---|---|
| Model | Fire HD 10 (9th gen, 2019), model code `KFMAWI`, codename `maverick` |
| Serial (adb) | `<SERIAL>` (from `adb devices -l`) |
| OS | Fire OS 7.3.1.5 (Android 9, API 28) |
| CPU ABI | `armeabi-v7a`, `armeabi` (32-bit only) |
| Screen density | 240 dpi |
| Google apps | Sideloaded (Fire Toolbox, 2020/2022); updated Nov 2026 |

When choosing APKs for this tablet use: **arm / armeabi-v7a**, **Android 9 (min API 28 or lower)**, **240dpi or nodpi**. arm64-only builds will not install.

## ADB path

```
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
```

This folder is already in the Windows **user PATH**:

```
%LOCALAPPDATA%\Android\Sdk\platform-tools
```

A terminal (or tool) started **before** the PATH was set will not see it and reports "adb is not recognized". Open a new terminal, or call adb by its full path:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices -l
```

Build tools (for `apksigner`, `aapt2`) are in:

```
%LOCALAPPDATA%\Android\Sdk\build-tools\36.0.0
```

## How the connection was made

1. On the tablet: Settings -> Device Options -> tap **Serial Number / Build** 7 times to enable Developer Options, then turn on **USB debugging** (also "ADB debugging" on Fire OS).
2. Connect the tablet to the PC with a USB cable (data cable, not charge-only).
3. Run `adb devices -l`. The first time it shows the device as `unauthorized`.
4. On the tablet, accept the **"Allow USB debugging?"** popup. Tick "Always allow from this computer". If no popup appears: unplug and replug, or Developer Options -> "Revoke USB debugging authorizations" and replug.
5. `adb devices -l` should now show:

```
<SERIAL>   device product:maverick model:KFMAWI device:maverick
```

If you started a second adb copy earlier, stop it first (`adb kill-server`, or stop the other `adb.exe` process), otherwise the two servers fight over port 5037.

## Useful commands

```powershell
adb devices -l                                            # list / check authorisation
adb shell getprop ro.build.version.release                # Android version (9)
adb shell getprop ro.build.version.fireos                 # Fire OS version
adb shell getprop ro.product.cpu.abilist                  # CPU ABIs
adb shell wm density                                      # screen dpi
adb shell pm list packages                                # installed packages
adb shell dumpsys package <pkg> | findstr versionName     # app version
adb shell pm path <pkg>                                   # where an app's APKs live
adb pull <device path> <local path>                       # copy file/APK off the device
adb install -r app.apk                                    # install/update a single APK
adb install-multiple -r base.apk split1.apk split2.apk    # install a split bundle
adb shell pm clear <pkg>                                  # wipe an app's data
adb shell am start -a android.intent.action.VIEW -d "market://details?id=<pkg>"   # open a Play Store page
adb logcat -d -t 1500                                     # recent log
```

## Installing an `.apkm` bundle (APKMirror)

1. Copy the `.apkm` and rename/copy it to `.zip`, then extract it to a fresh folder.
2. Check `info.json` (package, arch, min API, dpi).
3. Verify the signature matches the installed app:
   `apksigner.bat verify --print-certs base.apk` (compare the `Signer #1 certificate SHA-256`).
4. Install base plus the splits needed for this tablet (the `armeabi_v7a` split if present, `en`, and the closest density split, `hdpi` or `tvdpi`):
   `adb install-multiple -r base.apk split_config.armeabi_v7a.apk split_config.en.apk split_config.hdpi.apk`

## What is installed now (Nov 2026)

| Package | Version | Notes |
|---|---|---|
| `com.google.android.gms` (Play Services) | 26.43.30 (100300) | Updated from 23.43.13 |
| `com.android.vending` (Play Store) | 49.9.21-23 | Updated from 26.8.15; data cleared once to fix a sign-in loop |
| `com.google.android.gsf` | 9-6794505 | Old, unchanged |
| `com.google.android.gsf.login` | 7.1.2 | Old, unchanged |
| `com.mgoogle.android.gms` | 0.2.6 | microG leftover from the 2020 Fire Toolbox install |
| `com.google.android.projection.gearhead` (Android Auto) | 15.7.654633 | Sideloaded; has no launcher icon (normal) |
| `com.andrerinas.headunitrevived` ("Open Headunit") | 4.0.0 | Sideloaded from the project's GitHub release |

## APKMirror variants used

All were `.apkm` bundles from APKMirror, picked to match this tablet (armeabi-v7a, Android 9, 240dpi). Signatures of the Play Services and Play Store bundles were checked against the installed copies before installing.

| App | Version / version code | Variant row chosen | Min API | Splits installed |
|---|---|---|---|---|
| Play Services | 26.43.30 (100300-1006944126), code 264330009, posted 2026-11-02 | `(arm-v7a) (213-480dpi) (Android 9.0+)` | 28 | `base`, `en`, `tvdpi` |
| Play Store | 49.9.21-23 [0] [PR] 864439599, code 84992100, posted 2026-02-13 | `(arm-v7a) (nodpi) (Android 6.0+)` | 23 | `base`, `armeabi_v7a`, `en` |
| Android Auto | 15.7.654633-release, code 157654633 | `(arm-v7a) (120-640dpi) (Android 9.0+)` | 28 | `base`, `armeabi_v7a`, `en`, `hdpi` |

Play Services bundle filename (the hash at the end is cut off here): `com.google.android.gms_26.43.30_(100300-1006944126)-264330009_2dpi_24lang_848cb4fca8cb3b1033e9c6e...apkm`

Notes on choosing a Play Services variant:
- The `100300` tag is the same build line as the 23.43.13 build that was installed before, so it is the safest upgrade.
- Rows for Android 10+/11+/12+/15+, x86, and arm64-only will not run on this tablet.
- Patch builds with only 2-4 variants and beta builds were avoided.
- The files were downloaded to the project's download folder (the `.apkm` files can be deleted once you no longer need them).

## Android Auto notes

- Use **Open Headunit -> Wi-Fi / Wireless Mode -> Native** to show a phone's Android Auto on the tablet. Only Android Auto is needed on the phone (Galaxy S25 supports wireless Android Auto).
- **Self Mode** runs Android Auto on the tablet itself, but the tablet has no GPS, so navigation needs a location source.
- Play Store lists Android Auto as "not compatible"; sideload instead.

## Open Headunit source

- Project: https://github.com/andreknieriem/open-headunit (also known as Headunit Revived).
- Installed file: release `v.4.0.0`, `com.andrerinas.headunitrevived_4.0.0.apk` (package `com.andrerinas.headunitrevived`, min SDK 16, includes armeabi-v7a).
- Signer SHA-256: `615bc3c7a74839918d01517e49397f503a5473f89266af55a26d485c1e86155d`.
- Wireless mode choices in the app: **Native** (chosen), Wireless Helper (needs Android Auto 17.3 or older on the phone, otherwise root), Headunit Server (mainly for Self Mode).
- Open Headunit goes on the **tablet only**. The phone needs just Android Auto.

## Known issues and fixes

- **Play Store sign-in loop** after updating Play Services and the Play Store: the Google account was added but the Play Store did not pick it up ("Storage info not created for Play Store" in logcat). Fixed with `adb shell pm clear com.android.vending`, then signing in again.
- **Google Services Framework crash** in logcat: "You cannot keep your settings in the secure settings". It started before the updates, appears harmless, and was left alone.
- **Android Auto "not compatible" in the Play Store:** a Play Store filter. Sideloading works.
- **Android Auto has no launcher icon.** Use Open Headunit instead.
- The Android Auto bundle's signature was **not** cross-checked (nothing installed to compare against); it came from APKMirror.

## Navigation / GPS

- The tablet has **no GPS**. Plan: let the phone (Galaxy S25) run Android Auto and show it on the tablet through Open Headunit Wi-Fi mode, so the phone supplies GPS and mobile data.
- Fallbacks if that does not work: share the phone's GPS to the tablet with a mock-location app, a Bluetooth GPS receiver, or a USB wireless Android Auto dongle (the project's most reliable option).
- **Status:** Native wireless mode has not been tested yet.


## Backups and rollback

Original APKs were pulled before updating, into a local backup folder (path not recorded):

```
<backup folder>
```

Contents: `com.google.android.gms.0/1/2.apk` (base + en + hdpi splits), `com.android.vending.0.apk`, `com.google.android.gsf.0.apk`.

Keep that folder somewhere permanent if you want the rollback option. To restore Play Services:
`adb install-multiple -r com.google.android.gms.0.apk com.google.android.gms.1.apk com.google.android.gms.2.apk`
Installing an older version over a newer one may need `adb install -r -d` (allow downgrade).
