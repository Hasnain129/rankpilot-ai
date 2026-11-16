# RankPilot AI — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict Multi-Tenant Isolation**: Every document in `websites`, `seoAudits`, `keywordProjects`, `generatedContents`, `visitorEvents`, `leads`, `quotes`, `orders`, and `integrations` must carry an `ownerId` equal to `request.auth.uid`. Reads, lists, updates, and deletes are strictly scoped to the owner.
2. **PII Protection**: `users/{userId}` contains `email` and `displayName` and is readable/writable strictly by `request.auth.uid == userId`. No blanket `isSignedIn()` read rules exist on any collection.
3. **Referential Integrity**: `seoAudits`, `leads`, `quotes`, `orders`, and `integrations` must reference an existing `websiteId` whose `ownerId` matches `request.auth.uid`.
4. **Immutable Ownership & Temporal Integrity**: `ownerId` and `createdAt` cannot be modified after creation. `createdAt` and `updatedAt` must strictly equal `request.time`.
5. **Tracking Ingest Validation**: Unauthenticated `visitorEvents` creation is permitted ONLY if `trackingId` exists in `trackingKeys/{trackingId}` and both `ownerId` and `websiteId` match the registered `trackingKey` record, with `createdAt == request.time` and strict schema bounds. Unauthenticated `read`, `list`, `update`, and `delete` on `visitorEvents` are denied.
6. **Terminal State Protection**: Quotes with status `'Accepted'` or `'Rejected'` and Orders with status `'Refunded'` cannot be mutated arbitrarily after reaching terminal state.
7. **Verified Account Gate**: Standard authenticated write operations require `request.auth.token.email_verified == true`.

## 2. The "Dirty Dozen" Adversarial Payloads
All 12 payloads below MUST fail with `PERMISSION_DENIED`:

1. **Identity Spoofing on Website Create**:
   - Auth: `{ uid: "user_a", email_verified: true }`
   - Path: `/websites/web_1`
   - Payload: `{ ownerId: "user_b", name: "Evil", url: "https://evil.com", domain: "evil.com", trackingId: "rp_123456", seoScore: 80, pagesScanned: 1, status: "active", createdAt: REQUEST_TIME, updatedAt: REQUEST_TIME }`
2. **Shadow / Ghost Field Injection on Website Create**:
   - Auth: `{ uid: "user_a", email_verified: true }`
   - Path: `/websites/web_2`
   - Payload: `{ ownerId: "user_a", name: "Acme", url: "https://acme.com", domain: "acme.com", trackingId: "rp_123457", seoScore: 90, pagesScanned: 1, status: "active", isAdmin: true, createdAt: REQUEST_TIME, updatedAt: REQUEST_TIME }`
3. **Privilege Escalation on User Profile**:
   - Auth: `{ uid: "user_a", email_verified: true }`
   - Path: `/users/user_a`
   - Payload: `{ uid: "user_a", email: "a@test.com", displayName: "User A", role: "admin", plan: "free", createdAt: REQUEST_TIME, updatedAt: REQUEST_TIME }`
4. **Cross-Tenant Read of Leads (PII Leak)**:
   - Auth: `{ uid: "user_b", email_verified: true }`
   - Operation: `get(/leads/lead_owned_by_a)`
5. **Blanket List Query Scraping**:
   - Auth: `{ uid: "user_b", email_verified: true }`
   - Operation: `list(/leads)` without `where("ownerId", "==", "user_b")`
6. **Orphaned Lead Creation (Fake Website ID)**:
   - Auth: `{ uid: "user_a", email_verified: true }`
   - Path: `/leads/lead_orphan`
   - Payload: `{ ownerId: "user_a", websiteId: "nonexistent_web", name: "Jane", email: "jane@co.com", leadSource: "Direct", status: "New", estimatedValue: 500, trackingSource: "manual", createdAt: REQUEST_TIME, updatedAt: REQUEST_TIME }`
7. **Timestamp Forgery on Lead Create**:
   - Auth: `{ uid: "user_a", email_verified: true }`
   - Path: `/leads/lead_time`
   - Payload: `{ ownerId: "user_a", websiteId: "web_a", name: "Jane", email: "jane@co.com", leadSource: "Direct", status: "New", estimatedValue: 500, trackingSource: "manual", createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z" }`
8. **ID Poisoning (1KB+ Doc ID)**:
   - Auth: `{ uid: "user_a", email_verified: true }`
   - Path: `/websites/${"a".repeat(200)}`
9. **Terminal State Mutation on Accepted Quote**:
   - Auth: `{ uid: "user_a", email_verified: true }`
   - Path: `/quotes/quote_accepted` (existing `status: "Accepted"`)
   - Update: `{ status: "Pending", amount: 999999, updatedAt: REQUEST_TIME }`
10. **Unverified Email Write Bypass**:
    - Auth: `{ uid: "user_unverified", email_verified: false }`
    - Path: `/websites/web_unverified`
11. **Value Poisoning on Lead Update (Type/Size Violation)**:
    - Auth: `{ uid: "user_a", email_verified: true }`
    - Path: `/leads/lead_a`
    - Update: `{ status: 12345, updatedAt: REQUEST_TIME }`
12. **Fake Tracking Event Injection with Spoofed Owner/TrackingKey**:
    - Auth: `null`
    - Path: `/visitorEvents/evt_spoof`
    - Payload: `{ ownerId: "user_a", websiteId: "web_a", trackingId: "rp_invalid_key", visitorId: "v1", sessionId: "s1", eventType: "pageview", path: "/", trafficSource: "Direct", deviceType: "desktop", conversionValue: 0, createdAt: REQUEST_TIME }`
