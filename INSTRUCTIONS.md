# Take‑home Assignment (48 hours)

## Background Accountability‑Agent for Therapy Chat

**Tech stack fixed to Firebase: Firestore + Cloud Functions + FCM**

---

### 1 · Scenario

A **Therapy Agent** already stores every user message in **Firestore** at  
`/sessions/{sessionId}/messages/{msgId}`.

Build a silent **Accountability Agent** that runs as a **Cloud Function listener**.  
When a user message mentions a future‑dated commitment the agent must:

1. Use an LLM **function‑calling** interface to extract `date_iso` and `text`.
2. Write an idempotent reminder document to  
   `/reminders/{userId}/{reminderId}`.
3. Create a **Cloud Task** that will send a Firebase Cloud Messaging (FCM) push‑notification to the user at `date_iso 00:00 UTC`.

The Accountability Agent must never write back into the chat thread.

---

### 2 · Requirements

#### Message ingestion

- Implement a Firestore **onCreate trigger** for new user messages.

#### LLM analysis

- Pass the message to a provider‑agnostic model (your choice of **ADK, Genkit, LiteLLM, LangChain JSON‑mode, etc.**).
- Expose one function: `create_reminder(date_iso, text)`.
- Select the provider with the `LLM_PROVIDER` env var; read the key from `LLM_API_KEY`.

#### Reminder storage

- Save `{ userId, date_iso, text }` under `/reminders/{userId}/{reminderId}`.
- Ensure idempotency (e.g., hash userId + date + text for the doc ID).

#### Notification scheduling

- Use **Cloud Tasks** to enqueue an HTTP request to the FCM HTTP v1 endpoint  
  `https://fcm.googleapis.com/v1/projects/<PROJECT_ID>/messages:send`  
  that will execute at the scheduled time.
- Payload should reference the user’s FCM registration token, stored at `/users/{userId}/fcmToken`.

#### No chat interruption

- Do **not** modify the sessions/messages collection.

_Language:_ **TypeScript** is recommended (Firebase Functions TS template), but Python or Go functions are allowed.

---

### 3 · Deliverables

- **Source code** – Cloud Function(s) + any helper files.
- **README** (≤ 300 words) that explains
  - how to run locally with the Firebase Emulator Suite,
  - environment variables to set (`LLM_PROVIDER`, `LLM_API_KEY`, `FIREBASE_PROJECT_ID`),
  - how idempotency is guaranteed and how Cloud Task timing is calculated.
- **Automated test** – stub the LLM call, toggle the Firestore emulator, and assert that a reminder doc and a Cloud Task are created.
- **Screen‑recording link** – show your entire workflow, including IDE, searches, and AI tools.

---

### 4 · Constraints

- All secrets come from env vars or `firebase functions:config:set`.
- Dates must be valid `YYYY‑MM‑DD`.
- Cloud Task ETA must match `date_iso 00:00 UTC`.
- Keep dependencies lean—focus on core logic.

---

### 5 · Evaluation (qualitative)

- **LLM wiring** – provider switchable, correct tool schema and prompt.
- **Firestore trigger reliability** – only user messages processed; duplicates avoided.
- **Reminder doc** – clean schema, idempotent write.
- **Cloud Task & FCM** – payload correct, timing accurate, explained in README.
- **Code & docs** – readable structure, helpful comments, quick local setup.

---

### 6 · Time box

You have **48 hours** from receiving this brief to submit your solution.  
Good luck, and enjoy building!
