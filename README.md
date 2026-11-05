# Kestrel Mobile

Android companion and local-first notebook for Kestrel Brain. It supports encrypted phone-only notes and processed sources, QR pairing, Noise-encrypted Relay requests, confirmed capture, bounded offline source downloads, revision-protected Desktop note editing, useful memory connections, and experimental Mobile Codex asking.

## Cloud transcription beta — 0.3.19-beta.1

Both Noterel and Kestrel Owner use the same invitation-based ElevenLabs Scribe v2 workflow. The beta has ten identities, including the owner, with 120 minutes each for 30 days from activation. Recordings are limited to ten minutes and 128 MiB. Local Whisper transcription remains available.

Both beta APKs are built and package-verified: `dist/noterel-0.3.19-beta.1.apk` and `dist/kestrel-owner-0.3.19-beta.1.apk`, Android version code 25. Cloud transcription is not live until the separate backend has a reachable HTTPS address, server-side secrets, and a successful real-provider check. The API key belongs in the backend's `.env`, never in the APK. The stable Noterel update feed remains on 0.3.18.

Once the service is configured, open **Settings → Cloud transcription · Beta**, enter its HTTPS origin and invitation code, then activate. Add or share an audio/video file, select **Cloud · Beta**, choose the spoken language, and confirm the upload. Keep the app open until upload finishes; processing then continues on the server. Open **Review** and **Save encrypted transcript** to save through the existing source-linked note workflow.

Use **Retry upload** for an interrupted upload, **Discard upload** to abandon an unsubmitted task safely, and **Use a recovery invitation** after the owner issues a replacement code. Recovery retains the original allowance and expiry. **Reset beta connection** clears beta access without deleting notes. Server results expire after seven days; save wanted transcripts. Source links/thumbnails remain phone metadata and cannot be reconstructed after reinstall from the server alone.

See the [implementation and release handoff](docs/plans/cloud-transcription-beta-2026-11-05.md). Backend deployment and administration are documented in `services/transcription-beta/README.md` in the desktop repository.

## Implemented boundaries

- QR validation and explicit display of the Relay host before trust
- Native Rust `snow` XK/IK bridge with bounded messages and disposable sessions
- SecureStore-backed phone identity and device ticket
- SQLCipher-only database with WAL, a protected random key, and fail-closed key loss
- Android sharing and selected-text capture saved immediately into encrypted phone storage through a dedicated translucent activity
- Editable phone-only notes and links in a dedicated local-note store without a Desktop pairing
- A combined 10 MiB/500-item phone storage limit with explicit transfer into the destination-bound delivery outbox
- Explicit reassignment, regenerated operation keys after edits, durable Desktop idempotency, and exact per-capture results
- Explicit 2 MiB source downloads in UTF-8-safe 24 KiB pages
- SHA-256 and revision verification before atomic publication
- 100 MiB pinned download budget, reconciliation, removal, and model-free search across titles, excerpts, and complete downloaded text
- Revision-protected Desktop Markdown-note editing with encrypted offline edits and explicit conflict choices
- Durable save receipts and verified successor-source downloads: a lost acknowledgment retries the same operation, and a conflicting revision keeps the phone draft
- Resumable staged Desktop edits for note text up to 1 MiB and titles up to 512 UTF-8 bytes, without enlarging the 60 KiB direct application-message limit
- Related Desktop memories shown inside note details only when useful
- Separately confirmed local deletion, cache removal, pending-capture discard, and Desktop-wide erasure
- Consistent Note, Link, categorized Upload, and background audio-transcription capture plus Android sharing that saves and processes on the phone immediately; **Send to Desktop** remains an explicit action in each memory's `⋯` menu
- Previewed Markdown, Obsidian/Notion ZIP, and supported Anki APKG imports saved atomically as encrypted phone notes without overwriting existing notes
- Optional downloadable multilingual Whisper Small and Medium models for local transcription of shared OGG/Opus, M4A/AAC, MP3, WAV, and other Android-decodable audio; speech-language detection defaults to automatic with Arabic and English overrides, independently of the display language. Confirmed downloads continue in the background with visible progress and can be cancelled or resumed
- A privacy-safe home widget plus separate Quick Settings actions for jotting, clipboard capture, and opening audio transcription
- Bounded on-phone public webpage extraction without JavaScript, DNS-pinned private-network refusal, four-hop redirect limits, content-type checks, and a 2 MiB response cap
- On-phone YouTube title, channel, duration, thumbnail, and available-caption extraction without account cookies
- Social-video extraction saves only public timed captions; it does not substitute post descriptions, engagement metadata, or login chrome for spoken content
- Captionless Facebook, Instagram, and TikTok videos direct the user to audio transcription instead of saving unrelated metadata; the beta offers local Whisper or opt-in cloud processing
- On-phone PDFs use embedded text on Android 15 or newer when available and downloadable Google Play services ML Kit recognition for scanned pages, with visible foreground work, encrypted retry, 100-page and 16 MiB limits, and OCR word positions for citations
- Encrypted, hash-bound, versioned source artifacts with a 64 MiB quota, durable operation identities, transfer receipts, and retry-safe Desktop reuse
- Paginated Notes and wording search across complete processed source text, plus lightweight local memory relationships; private meaning search remains a Desktop capability until an optional Mobile embedding model is shipped
- AES-256-GCM export and restore for phone-owned captures and personal metadata, with a separately saved recovery key
- Opt-in automatic encrypted phone-note backups to Desktop with restore discovery and a newly generated recovery key shown once for 60 seconds with copy and Save/Share actions
- Separately authenticated experimental Codex device login with Mobile-only SecureStore credentials and explicit sign-out in the owner-only Kestrel Mobile edition
- Owner-edition note summaries use explicit OpenAI submission, stream into a reviewable preview, and save only on request as separate encrypted phone notes
- Explicit Ask scope between relevant Entire-Brain evidence and selected memories, with offline Entire-Brain fallback to automatically retrieved encrypted phone/downloaded memories
- Entire-Brain retrieval using Desktop wording search plus semantic search when the private index is available, followed by the same fusion, deduplication, and reranking rules as Desktop Ask
- Copyable Codex device codes and an optional lock-screen-secret Android notification that keeps the code available while OpenAI is open
- Streaming Codex answers limited to 64 KiB and labeled as not Desktop-validated
- Android backup disabled and sensitive-window screen capture blocked

Mobile provides Notes, Ask, Add, and Settings navigation. Notes includes wording search, which never invokes Codex; a result can be passed explicitly into Selected memories before asking.

The phone does not store embeddings or provider credentials copied from Desktop. Codex credentials are authenticated separately on Mobile and never sent through Desktop or Relay. Phone-only notes and processed sources remain local until the owner explicitly sends them to a paired Desktop. When Mobile completed extraction, Desktop verifies the package hashes and supported extraction version, reuses that extraction, and still builds its own indexes and global relationships. A retained phone copy, a pending transfer, a downloaded Desktop cache entry, and the Desktop memory remain distinct. Desktop cache removal, phone-memory deletion, pending-delivery discard, backup deletion, and Desktop-wide erasure are separate operations.

## Button layout in 0.3.15 source

Both editions use full-width stacked action groups, smaller 14-base button labels, and stacked link reference/preparation choices. Labels retain font scaling and wrapping; shared actions retain a 48dp minimum touch height. Compact share capture scrolls to keep Save reachable, and the font-size caption sits above wide A−/A+ controls. This layout change preserves existing callbacks, busy/disabled behavior, storage, and edition boundaries. See [the release and readiness report](docs/plans/button-layout-release-2026-11-04.md) for verification and package status; browser rendering does not establish native Android behavior.

## Video recovery and visible controls in 0.3.16

All / Phone / Desktop and the type, date, collection, and caption-language choices wrap into visible rows instead of requiring sideways scrolling. Long labels remain readable with enlarged text.

A link remains saved and readable when content preparation fails. Its recovery controls offer the original source, another preparation attempt, and video-file transcription. Public Facebook video references also offer **Transcribe video**: the app retrieves available audio belonging to that video, then opens the existing local Whisper model/language selection. No model is downloaded automatically. Review and save the transcript as a separate note; a retained link is not presented as an extracted transcript.

**Add → Upload → Video** and Android video sharing use the existing audio-track transcription worker. Files must be no larger than 128 MiB and audio duration must not exceed 30 minutes. A matching local Whisper model is required. Leaving recovery or opening another reader/editor invalidates pending results; unfinished Add drafts stay mounted while a media review is shown.

See [the 0.3.16 release report](docs/plans/video-recovery-segments-release-2026-11-05.md) for checks, package status, and native-device limitations.

## Transcription controls and legacy social posts in 0.3.17

Quality and spoken-language controls now have separate, spaced groups. Tapping an uninstalled model opens a confirmation that leads to Settings → Whisper models. Download there, then return to Add; the file and spoken-language choice remain available. Model availability refreshes on return and is checked again before transcription starts.

Automatic repair of older social posts reparses their saved HTML. If that HTML cannot provide post content, the app retains the original and remembers the failed repair version instead of repeating the warning every launch. This does not recover missing X content or fetch a replacement.

Medium still runs locally and loads its stored model files once per job. The revised warning distinguishes loading from downloading; these UI changes do not improve inference speed. See [the focused verification report](docs/plans/transcription-controls-2026-11-05.md).

## Source-linked transcripts and library navigation in 0.3.18

Library pagination stays above the scrolling notes, with 5, 10 or 20 combined items per page. Cards show one contextual recovery action; secondary preparation, file selection and original-link actions remain in `⋯`. The link editor separates its Ready to save preview from the reference/offline choices.

Transcription started from a failed video reference retains its source URL and available thumbnail through the background job and saved note. After review, saving upgrades the unchanged failed phone note under its existing ID, preserving personal notes and collections. If the source was edited, sent, delivered or deleted, the transcript is saved separately. Cancelled or failed transcription does not remove the original. Old jobs without source metadata are not matched to an original by guessing. Backups preserve the metadata; a Markdown source link keeps the URL portable through the existing Desktop note transport.

These changes do not alter Whisper inference accuracy. An independent audio comparison for the supplied Facebook example confirms that its spoken CI/CD, Docker and Terraform headings were omitted by the supplied transcript. See [the release and evidence report](docs/plans/video-context-library-2026-11-05.md).

## Learning workflow in 0.3.14 source

Links default to **Save reference** with an optional title and takeaway. Saving does not fetch content, preview captions, require pairing, or start transcription; **Prepare content** is a separate action. Personal takeaways, source-passage annotations, available real video moments, collections, and revisit selections stay separate from source text. Search includes available source and personal text, with Arabic-aware matching and filters for website, type, updated date, collection, and revisiting before counts and pagination.

Local schema **14** stores personal details and same-Desktop source aliases. Revision conflicts preserve drafts for an explicit choice; aliases keep personal notes reachable when a replacement download fails and the old body remains cached. Sync is foreground/resume based and bounded to 100 remote requests per pass. Desktop/downloaded moment selection exposes the first 100 real caption segments; local artifacts use their stored segments.

Settings can share readable Markdown for all available notes or one collection. The export selects the collection before loading bodies and enforces a 20 MiB bound; it contains text and source links, not original PDF/image attachments. Encrypted phone-note backups use a version-2 plaintext payload containing phone-owned captures and personal metadata, accept version-1 payloads during recovery, and restore them atomically. The encrypted envelope retains version 1. This is not a complete downloaded-file backup. These features are shared by Noterel and owner Kestrel Mobile without paid-cloud requirements.

See the Brain repository's `docs/plans/noterel-full-plan-release-2026-10-31.md` for current package/test status and manual acceptance steps. Native Android rendering, SQLCipher, real network interruption, and actual speech accuracy require installed-device evidence.

## Desktop note synchronization

These changes are implemented in source for both editions; this is not an announcement of a published APK or Desktop installer. Update Desktop and Mobile together. Desktop migration `0037_companion_note_edits.sql` is included and tested against isolated databases; applying it to a user's database remains a release step.

Save writes the phone edit into encrypted storage before attempting delivery. The queued operation retains its identity across interrupted requests. Mobile waits for Desktop ingestion to succeed, verifies the accepted note's content/title/project, and installs a complete hash-checked offline copy before removing that queued draft. Desktop text changes can create a successor source ID; mobile follows the replacement chain. Metadata changes update the revision as well. A stale base revision or failed/cancelled save preserves the phone version for explicit resolution.

Queued Desktop edits and downloaded copies record their originating mailbox. Switching pairings does not authorize sending an old draft to the new Desktop; delivery refuses mismatched or unknown origins, and automatic reconciliation checks only downloads bound to the current mailbox. Local schema version 12 adds this origin metadata. Earlier drafts whose origin cannot be established become retained conflicts instead of being assigned silently to the current Desktop. The conflict card offers Edit and preserves the draft; Keep phone is offered only for the matching Desktop and supported sync size. Keep both is available only when the complete phone-copy payload fits local note limits. Generated copy titles are bounded without truncating the note body.

Legacy unbound cached notes remain readable, but pairing alone does not verify their origin or bind old drafts. Recover an unbound draft through Edit and, when it fits, Keep both as a separate phone note; sending that copy is an explicit action. A newly downloaded copy from the intended Desktop records a verified origin for future edits. This is a safe recovery boundary, not an automatic migration of every existing cache entry.

For a phone-created note explicitly sent to Desktop, the phone retains a readable copy until the accepted ingestion completes and the canonical copy is verified. An immutable dispatched snapshot keeps its operation key when an acknowledgment is lost; edits made during dispatch remain in a separate local draft. Reconciliation is scoped to the receipt's original mailbox. It can queue the newer draft against the accepted source without creating another original note; a failed/cancelled ingestion leaves a phone copy for recovery. Original payload text needed during reconciliation is scrubbed from the delivery receipt after successful conversion or explicit local discard. Editing a pending capture does not silently reassign it to a newly paired Desktop.

Connected library refresh and app resume reconcile cached notes. While the library is active and connected, a 15-second poll also reconciles changes outside active editing. This is foreground synchronization, not a permanent character stream or simultaneous collaborative editor. Desktop must be reachable to send changes or fetch a new revision. With Desktop unavailable, downloaded text and saved drafts remain on the phone. Closing an editor without pressing Save does not create a durable queued edit.

Library refresh preserves a successful listing when later synchronization or download work fails. Independent refresh phases can continue after a failure, and the interface reports a partial refresh in English or Arabic instead of claiming every update finished. Saved drafts and readable offline copies remain available. Obsolete refreshes stop before publishing newer results or starting subsequent synchronization work.

A downloaded stale note stays readable while a replacement downloads. An interrupted transfer resumes from its stored byte offset only when the originating mailbox, card metadata, revision, digest, size, and staged byte count match. Incompatible or legacy partial transfers restart from zero. Only one source is staged at a time, so starting another download can discard the previous source's partial progress. Pages are serialized; complete text must pass UTF-8 and SHA-256 verification before atomic replacement. Failed or corrupted downloads retain the earlier readable copy, and corrupt staging is cleared for a clean retry. A transfer whose revision changes is retried once against the current revision. Conflicting pending phone edits prevent automatic cache replacement. Reconciliation checks cached notes in batches of at most 100.

Direct application messages remain capped at 60 KiB. Larger supported initial phone-note sends and existing-note edits use staged start/chunk/commit requests with up to 1 MiB of UTF-8 text, 512 UTF-8 bytes of title and 24 KiB decoded chunks. The existing local capture limit still applies to the complete serialized note payload, so escaped text/title overhead can reduce the initial-capture text capacity below 1 MiB. Desktop returns the accepted byte offset on retry, checks matching replay bytes and the final content digest, and retains an idempotent save receipt while wiping staged text on successful commit. At most 20 unfinished staged transfers are admitted; completed receipts do not consume that allowance. Stages older than one day are removed opportunistically when another staged transfer starts, not by a guaranteed timer. Existing offline source-download limits remain separate: 2 MiB per source from Desktop, 24 KiB pages, and a 100 MiB pinned cache budget.

Cloud transcription, hosted account/usage billing, cloud note storage and concurrent live editing are not implemented by this repair. See the Brain repository's `docs/plans/cloud-transcription-and-sync.md` for the proposed integration and privacy/cost decisions. Cloud transcription would disclose only explicitly selected audio to a processing provider; encrypted companion transport does not make provider processing end-to-end encrypted.

## Build editions

The default owner edition remains **Kestrel Mobile** under `com.kestrelbrain.mobile`, exposes the separately authenticated Codex tools, and keeps its update manifest. The customer edition is **Noterel**, a Sideryn Labs product under the `com.siderynlabs.noterel` package identity, with separate primary and legacy deep-link schemes. Noterel routes Ask to its plans and usage page while the purchase service is unavailable. Both editions remain standalone; neither embeds provider credentials.

```sh
npm run android
npm run android:internal
npm run prebuild:public
npm run prebuild:internal
npm run release:owner:apk
npm run release:user:apk
npm run release:user:aab
```

Codex credentials are established by signing in on the owner Kestrel Mobile app and remain in that app's SecureStore. Note text is sent to OpenAI only after an explicit Ask or Summarize action.

## Requirements

- Node.js 22 or newer
- Rust with Android targets for `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, and `x86_64-linux-android`
- `cargo-ndk` 4.1.2
- Android SDK 36 and NDK 27.1.12297006
- JDK 17 or newer

## Checks

```sh
npm install
npm run verify
npx expo-doctor
cd modules/kestrel-noise/native
cargo test
cd ../../..
npx expo prebuild --clean --platform android
cd android
./gradlew assembleRelease
```

The Gradle build invokes `cargo ndk` and packages the native Noise library. The user AAB includes all four supported Android ABIs; direct APK builds target arm64. SQLCipher, SecureStore, camera and audio sharing, downloadable models, widgets, screenshot protection, and JNI behavior cannot be established by Expo Go or Node tests.

On 23 October 2026 the source-processing Android module compiled successfully with `:kestrel-source-processing:compileDebugKotlin --console=plain`, using `ANDROID_HOME=D:\Android\SDK` from the `android` directory. The online run resolved the dependency that blocked an earlier offline Foojay attempt. This confirms Kotlin compilation of that module; it does not establish a built APK, installed release, native model inference, or device UI behavior.

## Current release blockers

- No Android device or emulator is currently attached for native rendered, TalkBack, RTL, largest-text and physical two-device validation. Installed-release verification remains outstanding; module compilation or bundle checks do not establish those results. Current package-build status is recorded in the full learning workflow report linked above.
- The latest source revision still needs release-device testing for cold/warm text and PDF Share behavior, on-phone webpage/video extraction, scanned-PDF OCR duration and failure, artifact retry/reconciliation, automatic backup and restore, Desktop note conflicts, connections caching, deletion choices, and old-mailbox reassignment.
- SecureStore key loss, backup exclusion, camera, revocation, offline relaunch, and interrupted downloads still need complete release-device evidence.
- Desktop and Mobile must be updated together before offline note edits, connection details, automatic Desktop backup, hybrid Desktop context retrieval, PDF transfer, and Desktop-wide deletion are enabled.
- The experimental Codex integration still needs a live device-code login and completion call. It uses OpenAI’s existing Codex device flow; official authorization for Kestrel as a third-party Android client has not been established.
- `npm audit --omit=dev` reports moderate transitive findings in Expo configuration/build tooling, with no available fix. The reported `uuid` advisory is reached through the `xcode` configuration package; it is not used by Kestrel request identifiers. Reassess when Expo publishes a compatible update.

See `docs/phase-0-baseline.md`, `docs/phase-1-2-protocol-baseline.md`, and the Brain repository’s `docs/plans/kestrel-mobile-handoff.md` for protocol evidence and remaining gates.
