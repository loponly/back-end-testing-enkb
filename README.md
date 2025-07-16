# Accountability Agent for Therapy Chat

A Cloud Function that automatically detects future-dated commitments in therapy session messages and schedules FCM push notifications as reminders.

## Architecture

- **Firebase Functions**: Cloud Function triggers on new user messages
- **LLM Integration**: Analyzes messages using configurable LLM providers (Vertex AI, OpenAI)  
- **Firestore**: Stores reminder documents with idempotent writes
- **Cloud Tasks**: Schedules FCM notifications for precise timing
- **Firebase Cloud Messaging**: Sends push notifications to users

## Setup

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```bash
# Required for deployment
FIREBASE_PROJECT_ID=your-project-id

# Optional: LLM Configuration (defaults to pattern matching)
LLM_PROVIDER=openai  # or 'vertexai'
LLM_API_KEY=your-openai-api-key

# Optional: Google Cloud credentials (for production)
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
```

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/loponly/back-end-testing-enkb.git
   cd back-end-testing-enkb
   ```

2. **Install root dependencies:**
   ```bash
   npm install
   ```

3. **Install function dependencies:**
   ```bash
   cd functions
   npm install
   cd ..
   ```

4. **Set up environment variables:**
   - Copy your OpenAI API key to the `.env` file
   - Set `LLM_PROVIDER=openai` for OpenAI integration

## How to Execute the App

### Method 1: Local Development with Firebase Emulator

1. **Start the Firebase emulator:**
   ```bash
   firebase emulators:start --only functions,firestore
   ```
   
   This will start:
   - Functions emulator on `http://127.0.0.1:5001`
   - Firestore emulator on `http://127.0.0.1:8080`
   - Emulator UI on `http://127.0.0.1:4000`

2. **Test the LLM integration:**
   ```bash
   node test-llm-integration.js
   ```

3. **Test pattern matching fallback:**
   ```bash
   node test-simple.js
   ```

4. **Test full integration:**
   ```bash
   node test-emulator.js
   ```

### Method 2: Run Tests

1. **Run unit tests:**
   ```bash
   cd functions
   npm test
   ```

2. **Run test with watch mode:**
   ```bash
   cd functions
   npm run test:watch
   ```

### Method 3: Manual Testing

1. **Open the Emulator UI:**
   Navigate to `http://127.0.0.1:4000` in your browser

2. **Add a test message to Firestore:**
   - Go to Firestore tab
   - Create collection: `sessions`
   - Create document: `test-session-1`
   - Create subcollection: `messages`
   - Create document: `msg-1` with data:
     ```json
     {
       "content": "I will go to the gym on 2025-08-15",
       "userId": "user123",
       "type": "user",
       "timestamp": "2025-07-16T10:00:00Z"
     }
     ```

3. **Check the results:**
   - View function logs in the Functions tab
   - Check for created reminders in `reminders/{userId}/userReminders`

### Method 4: Production Deployment

1. **Build the functions:**
   ```bash
   cd functions
   npm run build
   ```

2. **Deploy to Firebase:**
   ```bash
   firebase deploy --only functions
   ```

## How It Works

### Message Processing
- Listens for new documents in `/sessions/{sessionId}/messages/{msgId}`
- Only processes messages where `type === 'user'`
- Analyzes message content for future-dated commitments

### LLM Analysis
- Uses configurable LLM provider (Vertex AI or OpenAI)
- Falls back to regex pattern matching if LLM unavailable
- Extracts `date_iso` (YYYY-MM-DD) and commitment `text`

### Idempotency
- Generates consistent reminder IDs using: `hash(userId + date + text)`
- Uses Firestore `merge: true` to prevent duplicate reminders
- Same commitment mentioned multiple times creates only one reminder

### Notification Scheduling
- Creates Cloud Task scheduled for `date_iso 00:00 UTC`
- Task calls `/sendReminderNotification` HTTP function
- FCM notification sent using user's token from `/users/{userId}/fcmToken`

## Testing

The test suite validates:
- ✅ Message analysis and commitment extraction
- ✅ Reminder document creation in Firestore
- ✅ Cloud Task scheduling
- ✅ FCM notification handling
- ✅ Idempotency guarantees
- ✅ Date validation (rejects past dates)

```bash
npm test
```

## Cloud Task Timing

Schedule time calculation:
```typescript
const scheduleTime = new Date(`${date_iso}T00:00:00.000Z`);
const taskSchedule = {
  seconds: Math.floor(scheduleTime.getTime() / 1000)
};
```

This ensures notifications are sent exactly at midnight UTC on the commitment date.

## API Usage Examples

### Triggering the Accountability Agent

The system automatically processes messages when they are added to Firestore. Here's how to trigger it:

#### Example 1: Add a User Message (Triggers Cloud Function)
```javascript
// Add to /sessions/{sessionId}/messages/{messageId}
{
  "content": "I will go to the gym on 2025-08-15",
  "userId": "user123",
  "type": "user",
  "timestamp": "2025-07-16T10:00:00Z"
}
```

#### Example 2: HTTP Endpoint for Notifications
```bash
curl -X POST http://127.0.0.1:5001/your-project/us-central1/sendReminderNotification \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "commitment": "I will go to the gym",
    "originalMessage": "I will go to the gym on 2025-08-15"
  }'
```

### Expected Results

After adding a message with a commitment:

1. **Reminder Document Created:**
   ```json
   // /reminders/user123/userReminders/{reminderId}
   {
     "userId": "user123",
     "date_iso": "2025-08-15",
     "text": "I will go to the gym on 2025-08-15",
     "createdAt": "2025-07-16T10:00:00Z",
     "messageId": "msg-1",
     "sessionId": "test-session-1"
   }
   ```

2. **Cloud Task Scheduled** (in production)
3. **Function Logs** showing LLM analysis or pattern matching

## Troubleshooting

### Common Issues

1. **"No reminder created"**
   - Check if message `type` is set to `"user"`
   - Verify the commitment has a future date
   - Check function logs for errors

2. **"LLM API Error"**
   - Verify `LLM_API_KEY` is set correctly in `.env`
   - Check internet connection
   - System will fallback to pattern matching

3. **"Firebase emulator not starting"**
   - Kill existing processes: `pkill -f firebase`
   - Check if ports 8080, 5001, 4000 are available
   - Try: `lsof -ti:8080 | xargs kill -9`

4. **"Function not triggering"**
   - Ensure emulator is running
   - Check Firestore path matches: `/sessions/{sessionId}/messages/{messageId}`
   - Verify message structure is correct

### Debug Commands

```bash
# Test LLM API directly
node test-llm.js

# Test pattern matching
node test-simple.js

# Test with emulator
node test-emulator.js

# Check function logs
firebase emulators:start --only functions,firestore
# Then visit: http://127.0.0.1:4000/functions
```

### Environment Variables Verification

```bash
# Check if .env is loaded
node -e "require('dotenv').config(); console.log('LLM_PROVIDER:', process.env.LLM_PROVIDER)"
```

A Firebase-based backend testing project with Cloud Functions.

## Project Structure

```
back-end-testing-enkb/
├── .env                          # Environment variables (create this)
├── firebase.json                 # Firebase configuration
├── README.md                     # This file
├── package.json                  # Root dependencies
├── functions/                    # Firebase Cloud Functions
│   ├── src/
│   │   └── index.ts             # Main Cloud Function code
│   ├── lib/                     # Compiled JavaScript
│   ├── tests/                   # Unit tests
│   ├── package.json             # Function dependencies
│   └── tsconfig.json            # TypeScript configuration
├── test-llm.js                  # LLM API test script
├── test-simple.js               # Pattern matching test
├── test-emulator.js             # Full integration test
└── serviceAccount.json.example   # Template for service account
```

### Key Files

- **`functions/src/index.ts`**: Main Cloud Function implementation
- **`.env`**: Environment variables (LLM configuration)
- **`test-*.js`**: Various test scripts for verification
- **`firebase.json`**: Firebase project configuration

## Security Notes

- Never commit `.env` or `serviceAccount.json` to version control
- The `.env` file contains your OpenAI API key
- Use environment variables in production environments
- Firebase emulator doesn't require real credentials for local testing