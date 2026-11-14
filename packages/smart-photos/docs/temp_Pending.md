# Smart Photos frame: what is pending (updated 2026-11-14)

All planned features are now built. What is left is checking them with a real person and over a long run (section 1), and two items that are deliberately later or by design (sections 2 and 3).

## 1. Built, but not yet tried (needs you, or a long run)

| Item | How to check it |
| --- | --- |
| Spoken commands (pause, next, delete, show me X, sound on/off, pause sensing, **search for**) | Turn the mic on in Settings and say each one in a quiet room, then with the TV on. Count first-attempt hits per command from the `VOICE` lines in the log |
| **Free-form voice search** with a real voice | Say "search for", then a phrase that is not in the word list ("red car at night"). Check the heard text on the chip. Offline test with synthetic speech: 8 of 10 phrases exact, 40 of 42 words; expect more errors with real voices and noise |
| Spelling a new name with a real voice | Name a group, choose "Spell it out", spell two or three names (offline synthetic test: 8 of 8). Real voices will confuse letters like B, D, P, T, so check how often "back" is needed |
| Recognising a live person at the camera | Name yourself in People, turn on walk-up detection, stand in front. The chain was tested with library photos as frames; the real camera path is the one the slice used |
| Boot start | Turn on "Start when the tablet boots" and reboot the tablet once |
| Wall-charger and warm-room soak, and a long memory run | Run for 60 minutes with the camera on and the index idle, on the wall charger. Suggested: a debug-only logger of memory (Java heap and native) and temperature every 30 s, as in the slice soak; compare the first and last 10 minutes |
| **Add photos** from a real USB stick or the SD card | Pick a folder on the SanDisk SD card (the tablet shows it, 61 GB free) and import. The picker path and the copy were tested with an internal folder |

## 2. Later phase (decided)

- **Encrypted face data.** Decision 2026-11-14: deferred. `faces.bin` and `people.json` are app-private and removable ("Delete all face data") but not encrypted.
  **Plan when built:** a key held in the Android Keystore (AES-GCM, `javax.crypto`; the project does not use AndroidX, so avoid `EncryptedFile`), encrypting both files at rest, loaded into memory on start, with a one-time migration of the existing files. Recorded in the design doc, section 10.
- **A consent screen.** Still open, and needed before the app is shared beyond personal use.
  **Suggested approach:** a first-run screen that explains in plain words that faces, camera and microphone stay on the tablet, and that walk-up detection and listening stay off until the user agrees. Store when consent was given, show it in the People screen, and require it before walk-up detection can be turned on.

## 3. By design or decided (not pending)

- **No deletion modes.** Delete always means "move to the trash" (the app's `.trash` folder on this Android 9 tablet, 30-day retention, with confirmation and undo). The system recycle bin is used where the platform supports it (Android 11 and later, for shared media).
- **Several people in view.** "Alternate" is a shuffle of their photos; a setting chooses "only photos with all of them" (falls back to any) or "any". Accepted as built.
- **No undo for naming.** Renaming or removing a person is the way to correct a name.
- **No desktop sync or desktop bundle.** Not needed because the index, faces and search all run on the tablet.
- **Faces in videos has two limits by design.** No naming from a playing video, and a group seen only in videos is not listed on the People screen (it has no still to show).
- **Kiosk lock** is Android's screen pinning, started from a Settings button. A full device-owner kiosk is an optional advanced setup (`adb shell dpm set-device-owner`, only on a tablet with no accounts).
- **Built:** photo import, faces in videos, free-form voice search, pin to screen, spelling new names, pause sensing (and the 60 s microphone silence pause).

## 4. Worth knowing

- The tablet has a **SanDisk SD card with 61 GB free**, while the internal storage has about 12.6 GB free. A photo library bigger than a few thousand photos would be better kept on the SD card; the importer currently copies into internal storage.
