# Accountability Agent for Therapy Chat

A Cloud Function that automatically detects future-dated commitments in therapy session messages using **Genkit AI framework** with agentic tool calling and schedules FCM push notifications as reminders.

## Architecture

- **Firebase Functions**: Cloud Function triggers on new user messages
- **Genkit AI Framework**: Advanced AI integration with agentic tool calling for intelligent date parsing
- **LLM Integration**: Supports OpenAI (GPT-4) and Google Vertex AI (Gemini) through Genkit plugins
- **Agentic Tool Calling**: Custom date parser tool using `ai.defineTool()` for accurate commitment extraction
- **Firestore**: Stores reminder documents with idempotent writes
- **Cloud Tasks**: Schedules FCM notifications for precise timing
- **Firebase Cloud Messaging**: Sends push notifications to users

## Setup

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```bash
# Required for deployment
FIREBASE_PROJECT_ID=your-project-id

# Required: LLM Configuration for Genkit
LLM_PROVIDER=openai  # or 'vertexai'
LLM_API_KEY=your-openai-api-key  # Required for OpenAI integration

# Optional: Google Cloud credentials (for Vertex AI or production)
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
```

**Note**: Genkit requires an LLM provider to be configured. The system will fall back to pattern matching only if LLM configuration fails.

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
   - **Important**: Genkit requires proper LLM configuration to function

## Features

### 🤖 Genkit Agentic Tool Calling
- **Custom Date Parser Tool**: Implemented using `ai.defineTool()` with comprehensive date parsing patterns
- **Intelligent Analysis**: AI model uses the tool to extract and validate future commitment dates
- **Multiple Date Formats**: Supports ISO dates (2025-08-15), natural language (August 15th, 2025), and US format (08/15/2025)
- **Future Date Validation**: Automatically rejects past dates and vague references
- **Confidence Scoring**: Tool provides confidence levels for parsed dates

### 🎯 Smart Commitment Detection
- **Pattern Recognition**: Identifies commitment language ("I will", "My goal is", "I plan to")
- **Context Awareness**: Distinguishes between firm commitments and casual mentions
- **Text Extraction**: Intelligently extracts just the commitment text without date information

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
- **Genkit Framework**: Uses Google's Genkit AI framework for advanced LLM integration
- **Agentic Tool Calling**: AI model intelligently calls the `parseDateTool` when it detects dates
- **Dual Provider Support**: Configurable for OpenAI (gpt-4) or Vertex AI (gemini-1.5-flash)
- **Smart Response Parsing**: Extracts commitment information from AI-generated responses
- **Fallback Support**: Falls back to regex pattern matching if Genkit analysis fails
- **Tool Definition**: Custom tool with structured input/output schemas using Zod validation

### Tool Implementation Example
```typescript
const parseDateTool = ai.defineTool({
  name: 'parseCommitmentDate',
  description: 'Extract and validate future commitment dates from text',
  inputSchema: z.object({
    text: z.string().describe('Text containing potential date references'),
    currentDate: z.string().describe('Current date in YYYY-MM-DD format')
  }),
  outputSchema: z.object({
    success: z.boolean(),
    dateIso: z.string().optional(),
    confidence: z.number().optional(),
    reasoning: z.string().optional()
  })
}, async ({ text, currentDate }) => {
  // Comprehensive date parsing logic
  // Multiple format support
  // Future date validation
});
```

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
- ✅ **Genkit Tool Calling**: Verifies custom `parseDateTool` execution and results
- ✅ **Message Analysis**: Tests AI-powered commitment extraction with multiple LLM providers
- ✅ **Date Parsing**: Validates multiple date formats (ISO, natural language, US format)
- ✅ **Future Date Validation**: Ensures past dates and vague references are rejected
- ✅ **Reminder Creation**: Confirms Firestore document creation with correct data
- ✅ **Cloud Task Scheduling**: Tests notification scheduling for precise timing
- ✅ **FCM Integration**: Validates push notification handling
- ✅ **Idempotency**: Ensures duplicate commitments create only one reminder
- ✅ **Fallback Logic**: Tests pattern matching when Genkit analysis fails

### Test Examples

**Successful Commitments (Creates Reminders):**
- "I will go to the gym on 2025-08-15" ✅
- "My goal is to finish reading the book by 2025-12-20" ✅
- "I plan to visit the doctor on August 15th, 2025" ✅

**Ignored Messages (No Reminders):**
- "I had a nice session today" ❌ (past reference)
- "I might visit the doctor sometime next month" ❌ (vague date)
- "I went to the gym yesterday" ❌ (past tense)

```bash
cd functions
npm test
```

### Live Testing with Genkit

```bash
# Test full Genkit integration with LLM
node test-llm-integration.js

# Test pattern matching fallback
node test-simple.js

# Test emulator integration
node test-emulator.js
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

After adding a message with a commitment, you'll see:

1. **Genkit Tool Execution Logs:**
   ```
   INFO: Parsing date from: "I will go to the gym on 2025-08-15" with current date: 2025-07-16
   INFO: Genkit tool-enhanced response: The message contains a commitment with a specific future date...
   INFO: Extracted commitment: "go to the gym" for date: 2025-08-15
   ```

2. **Reminder Document Created:**
   ```json
   // /reminders/user123/userReminders/{reminderId}
   {
     "userId": "user123",
     "date_iso": "2025-08-15",
     "text": "go to the gym",
     "createdAt": "2025-07-16T10:00:00Z",
     "messageId": "msg-1",
     "sessionId": "test-session-1"
   }
   ```

3. **Cloud Task Scheduled** (in production)
4. **Success Logs:**
   ```
   INFO: Created reminder {reminderId} for user user123
   INFO: Successfully processed commitment for user user123: "go to the gym" on 2025-08-15
   ```

## Troubleshooting

### Common Issues

1. **"No reminder created"**
   - Check if message `type` is set to `"user"`
   - Verify the commitment has a future date in recognizable format
   - Check function logs for Genkit tool calling errors
   - Ensure LLM_PROVIDER and LLM_API_KEY are configured correctly

2. **"Genkit tool calling failed"**
   - Verify `LLM_API_KEY` is set correctly in `.env`
   - Check internet connection for API access
   - Monitor function logs for tool execution details
   - System will fallback to pattern matching if Genkit fails

3. **"LLM API Error"**
   - Confirm API key format: `sk-proj-...` for OpenAI
   - Check API key permissions and quotas
   - Try switching providers: `LLM_PROVIDER=vertexai` or `LLM_PROVIDER=openai`
   - Verify network connectivity

4. **"Firebase emulator not starting"**
   - Kill existing processes: `pkill -f firebase`
   - Check if ports 8080, 5001, 4000 are available
   - Try: `lsof -ti:8080 | xargs kill -9`

5. **"Function not triggering"**
   - Ensure emulator is running with functions and firestore
   - Check Firestore path matches: `/sessions/{sessionId}/messages/{messageId}`
   - Verify message structure includes required fields
   - Check that `type: "user"` is set on the message document

### Debug Commands

```bash
# Test Genkit integration with full logging
node test-llm-integration.js

# Test LLM API connection directly
node test-llm.js

# Test pattern matching fallback
node test-simple.js

# Test with emulator (basic integration)
node test-emulator.js

# Check function logs in real-time
firebase emulators:start --only functions,firestore
# Then visit: http://127.0.0.1:4000/functions

# View Genkit tool calling in action
# Look for logs containing:
# - "Parsing date from:"
# - "Genkit tool-enhanced response:"
# - "Extracted commitment:"
```

### Environment Variables Verification

```bash
# Check if .env is loaded correctly
node -e "require('dotenv').config(); console.log('LLM_PROVIDER:', process.env.LLM_PROVIDER); console.log('API_KEY set:', !!process.env.LLM_API_KEY);"

# Test Genkit configuration
node -e "require('dotenv').config(); const { genkit } = require('genkit'); console.log('Genkit configured for:', process.env.LLM_PROVIDER);"
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

- **`functions/src/index.ts`**: Main Cloud Function with Genkit AI framework integration
- **`.env`**: Environment variables (LLM configuration - required for Genkit)
- **`test-llm-integration.js`**: Complete Genkit integration test with tool calling
- **`test-*.js`**: Various test scripts for verification
- **`firebase.json`**: Firebase project configuration
- **`functions/package.json`**: Dependencies including Genkit packages

### Dependencies

**Genkit AI Framework:**
- `genkit`: Core Genkit framework
- `@genkit-ai/core`: Core AI capabilities
- `@genkit-ai/ai`: AI model integration
- `@genkit-ai/vertexai`: Google Vertex AI plugin
- `genkitx-openai`: OpenAI integration plugin

**Firebase:**
- `firebase-functions`: Cloud Functions runtime
- `firebase-admin`: Admin SDK for Firestore/FCM
- `@google-cloud/tasks`: Cloud Tasks for scheduling

## Security Notes

- **Never commit** `.env` or `serviceAccount.json` to version control
- The `.env` file contains your **OpenAI API key** - keep it secure
- Use environment variables in production environments
- **Genkit requires API keys** - ensure proper key management
- Firebase emulator doesn't require real credentials for local testing
- **API rate limits**: Monitor usage to avoid exceeding LLM provider quotas

## Performance Notes

- **Genkit tool calling** adds ~2-5 seconds to processing time
- **Fallback pattern matching** is instantaneous if LLM fails
- **Caching**: Consider implementing response caching for repeated patterns
- **Cost optimization**: Monitor LLM API usage and implement request batching if needed