# AI, knowledge, memory, and voice

This directory implements server-side provider calls. There are no canned model replies, browser API keys, autonomous external actions, automatic memory extraction, fine-tuning, or third-party URL fetching.

## Configuration

- `AI_API_KEY`: server-side provider credential.
- `AI_MODEL`: required Responses-compatible text model. No model is silently selected.
- `AI_BASE_URL`: optional HTTPS API base, default `https://api.openai.com/v1`. The server appends `/responses` or `/audio/transcriptions`. This implementation requires a Responses-compatible provider; a Chat-Completions-only endpoint is not compatible.
- `AI_TRANSCRIPTION_MODEL`: required to enable recorded speech transcription independently from text chat.
- `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`: enable Azure Speech with `ar-SA-HamedNeural`, a documented Arabic (Saudi Arabia) voice. The region must be the region of the deployed Azure resource.

Capability flags mean configuration is present and syntactically valid, not that credentials or provider accounts have passed a live health check. Missing or invalid configuration returns a structured 503. Live providers must be tested by the operator with their own credentials before deployment. Do not use a `NEXT_PUBLIC_` prefix for credentials.

Current primary references: [Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses), [API data controls](https://developers.openai.com/api/docs/guides/your-data), [transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [model lifecycle](https://developers.openai.com/api/docs/deprecations), [Azure voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=text-to-speech), [Azure REST speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech).

## Access and context

Authentication and live tenant membership are resolved on the server. Chat and voice require the `write` permission. Reading history, knowledge, or memories requires `read`; knowledge changes require `manage`. Conversation and memory queries are scoped by both tenant and user. Knowledge is shared only within a tenant. RLS adds a second authorization boundary, including inside similarity/retrieval operations. `withTenant` revalidates membership for each transaction.

Knowledge uses bounded **lexical substring ranking**, not embeddings or vector search. It normalizes selected Arabic characters, extracts up to 12 terms, ranks tenant-authorized chunks, and supplies at most six. Titles and source URLs are uploader-provided provenance, not proof that their contents are official or current. URLs are validated as HTTPS hyperlinks and are never fetched. Returned citations are limited to source IDs actually retrieved for the request and mentioned by the model. Every new citation retains its exact inline `reference` (for example `S2` or `S4`), so a source card maps to the marker in the answer even when intermediate sources are not cited. The optional DTO field permits reading legacy stored citations without inventing their numbering. Prompt instructions require uncertainty for government/legal details lacking suitable sources, but model answers still require user review.

Untrusted documents and memory values enter a lower-priority user message, serialized as JSON. They are never interpolated into standing instructions. This reduces prompt-injection risk; it is not a claim that prompting can eliminate that risk. The model has no arbitrary network, database, shell, or transaction tool.

## Memory lifecycle

Memory is off unless the user explicitly enables it. Only the dedicated POST endpoint saves exact user-submitted memory text, and only while enabled; PATCH on a memory ID permits an explicit edit under the same consent and ownership requirements. Turning memory off prevents its inclusion in model input; saved rows remain inspectable and deletable. Delete removes the row immediately. This implementation produces no embedding, summary, provider thread, cache copy, or training artifact from a memory.

Every saved-memory create, edit, deletion, or actual change of the enabled state starts a fresh **model-context revision** for that user within that tenant. Database triggers advance the revision atomically. Generated messages are tagged with the revision used to prepare them; only messages from the current revision can enter later model requests. A previously completed answer might repeat a memory, so merely deleting the memory row would be insufficient. Prior messages remain visible in history and can be deleted separately, but are not replayed after a memory change. Turning memory back on does not restore old model context. Users can, of course, explicitly provide information again in a new message. Migration `002_memory_context_boundary.sql` conservatively resets legacy contexts because the origins of old answers cannot be reconstructed reliably.

In-flight requests may already have submitted context before a memory changes; that upstream input cannot be recalled. Every pending answer rechecks the revision before delivery/persistence, including requests whose direct-memory snapshot was empty. A changed revision discards the pending answer. Preference-row locks are acquired before memory-row locks and held through persistence so a revision cannot change between the final check and inserting messages. Direct-memory snapshot checks provide an additional guard.

## Budgets, cancellation, and retention

Input characters, historical context, retrieved chunks, output tokens, recording duration, and TTS text are bounded. Shared database counters impose per-user and per-tenant minute/day ceilings before each provider request; counters remain consumed for failed/cancelled requests. These are request budgets with bounded requests, not a currency billing ledger. Monetary spend also needs provider-side limits and monitoring. No automatic retries can silently multiply requests.

Text generation has a 45-second deadline; audio calls have 30 seconds. Client cancellation propagates to fetch. The application uses a single JSON chat response. User/assistant messages are saved atomically only after a provider result, and an optimistic conversation timestamp prevents interleaving concurrent responses. Message ordering uses the database-generated identity `sequence_no` for both displayed history and model context; equal timestamps and random UUID order cannot reverse a new user/assistant pair. Migration `003_message_sequence.sql` assigns deterministic legacy values, starts the sequence after the backfill, restores FORCE RLS, and permits runtime allocation without sequence-reset privileges. It also replaces table-wide INSERT/UPDATE grants on messages with column-level grants excluding `sequence_no`: identity generation alone would not block `OVERRIDING SYSTEM VALUE` or `UPDATE ... SET sequence_no = DEFAULT`. Other authorized message CRUD continues to work. The migration runner does not regrant broad table permissions afterward. Legacy rows with exact timestamp ties have no recoverable original insertion order, so their backfill uses a stable user-before-assistant fallback. Provider response bodies and audio output are size-bounded, and raw provider errors are not returned to users.

OpenAI requests use `store:false`, with app-managed history. This does not promise zero retention at the provider: review its contractual retention, residency, and abuse-monitoring policies. Provider keys and raw audio are not persisted by these routes. No Saudi hosting or legal-compliance certification is implied.

## Recorded audio

The browser must produce RIFF/WAVE PCM format 1, 16-bit mono at 16 kHz. The server independently validates the file structure and derives duration from audio bytes. Maximum duration is 60 seconds and maximum file size 2 MiB. MIME declarations or browser duration metadata alone are not trusted. The transcript is returned for user review; it is not automatically submitted to chat. Azure TTS uses escaped SSML and a fixed server-selected Saudi voice. Disclose synthesized speech in the UI and request the microphone only after a user action.
