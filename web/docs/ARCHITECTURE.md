# AoosGPT / سعود — Architecture and delivery plan

## Scope and source of truth

This `web` application extends the current `Aoos-Art1/AoosGPT` repository. The existing SwiftUI clients remain separate clients. Their device-local accounts are not silently migrated or synchronized with web accounts. The older website repositories are not the source of truth for this implementation.

## Runtime

- Next.js App Router, TypeScript, React, Tailwind, shadcn-style accessible primitives, Framer Motion.
- Arabic RTL, locally bundled IBM Plex Sans Arabic and Tajawal fonts; emerald/charcoal/sand design tokens.
- Portable PostgreSQL, database migrations, distinct migration and runtime roles, self-hostable container build.
- Server-only access layer; opaque revocable cookie sessions, scrypt password hashing, invitation-only onboarding, and CLI-only initial administrator creation.
- User-facing portals select an audience; they never grant permissions. Platform administrators and tenant membership roles are independent.

## Boundaries

1. Every protected request revalidates a database session and current account/membership status.
2. Tenant operations share one database transaction and locally scoped user/tenant settings. Runtime database roles cannot bypass row-level security.
3. Company knowledge is tenant-scoped; conversations and memories additionally belong to a user. Composite foreign keys enforce ownership across child records.
4. The superadmin console exposes administrative metadata and audited management operations. It is owned by an explicitly provisioned human operator, not by an AI agent.
5. Model endpoints and keys are server configuration. Retrieved documents are untrusted data; a model response cannot grant permissions or execute actions.
6. Saved memory is opt-in, visible, editable/deletable. This is retrieval of preferences, not autonomous training of a foundation model.
7. Provider configuration is reported honestly. No fake assistant response, regulatory certification, integration success, or Saudi data-residency claim is inferred from a successful build.

## Delivery sequence

1. Contracts, theme, layout, three portal forms, explicitly labeled public preview.
2. Schema, sessions, role enforcement, invitations, tenant and admin management.
3. Working company profile, employees, tasks, letter editor, transparent cost calculators, evidence checklist, platform directory.
4. Tenant-scoped chat/history/documents, source-linked retrieval, preference memory, transcription and Saudi-locale speech adapters.
5. Cross-tenant database tests, authentication/authorization tests, UI keyboard/mobile checks, lint/typecheck/build and a written release checklist.

## Production acceptance

- No elevated runtime database role; no tenant crossing via forged IDs or omitted SQL filters.
- Public signup cannot create an administrator or join an arbitrary company.
- Cookies are httpOnly; production requires HTTPS, same-origin mutations, payload bounds and durable rate limits.
- Provider keys, database credentials and user secrets never ship to the browser or repository.
- Live database/provider/backup/restore/host checks are recorded separately from local tests. Passing local tests does not imply a live deployment.

## Primary references

- https://nextjs.org/docs/app/guides/authentication
- https://nextjs.org/docs/app/guides/data-security
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- https://developers.openai.com/api/docs/guides/your-data
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support
