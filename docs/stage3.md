# Stage 3 feature map (voice)

Feature IDs come from the owner's project page. Status as of v0.8.0. Design notes: ADR 24 in [`decisions.md`](decisions.md); what's next: [`roadmap.md`](roadmap.md#stage-3-voice).

| ID | Feature | Status | Code |
|---|---|---|---|
| S3-01 | Speech input and spoken replies | Built: push-to-talk mic (ElevenLabs Scribe `scribe_v2`), listen buttons, auto-read, optional auto-send. No realtime mode. | `src/core/voice/stt.ts`, `index.ts` (`speak`, `transcribe`); `components/Composer.tsx`, `components/Speak.tsx`, `lib/voice.ts` |
| S3-02 | Pronunciation playback | Built: words in the word popover and whole tutor messages, normal speed and 0.7×, speed setting 0.8× to 1.25×. | `components/WordPopover.tsx`, `components/MessageList.tsx` |
| S3-03 | Separate provider choices | Partly: text to speech (ElevenLabs or free Edge voices) and speech to text (ElevenLabs) are separate jobs; several ElevenLabs accounts tried in order. Tutor model unchanged. | `src/core/voice/accounts.ts`, Settings > Voice |
| S3-04 | Voice evidence and assessment | Partly: voice time counted apart (`voiceMs`); spoken messages flagged, never pronunciation evidence. No assessment yet. | `records/store.ts` (`addVoiceTime`), `records/stats.ts`, `agent/prompt.ts` (`SPOKEN_MARKER`) |
| S3-05 | Audio practice and quizzes | Not started. | |
| S3-06 | Provider and quality evaluation | Not started (ElevenLabs Flash v2.5 and Edge only). | |

## How a spoken turn works

1. The learner clicks (or holds) the mic. `Recorder` asks main for microphone access (`requestMicrophone`, macOS prompts once) and records webm/opus.
2. On stop, the clip goes to `transcribe` as bytes. `ElevenLabsAccounts.run("stt", …)` tries each account in order; Scribe gets the session language.
3. The text lands in the composer (or is sent at once with "Send right after transcribing"). `send` carries `spoken: true`; the stored message has `spoken`, the model sees `[spoken] …`.
4. With "Read tutor replies aloud", `useAutoSpeak` plays the reply when it arrives: `speak` cleans the text, tries the ElevenLabs accounts, falls back to Edge, caches the clip, and the renderer plays it from a blob URL.
