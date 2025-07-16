/**
 * Accountability Agent for Therapy Chat
 * 
 * This Cloud Function listens for new user messages in therapy sessions
 * and extracts future-dated commitments using pattern matching and LLM integration.
 * When a commitment is found, it creates a reminder document and schedules
 * an FCM notification using Cloud Tasks.
 */

// Load environment variables from .env file in parent directory
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../../.env") });

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { CloudTasksClient } from "@google-cloud/tasks";
import { createHash } from "crypto";
import * as z from "zod";
import type { Request, Response } from "express";
import type { FirestoreEvent } from "firebase-functions/v2/firestore";

// Initialize Firebase Admin
// In emulator environment, we don't need real credentials
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined ||
  process.env.NODE_ENV === 'development';

if (isEmulator) {
  // Clear the credential path for emulator
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'back-end-testing-6d8a8'
  });
  logger.info('Initialized Firebase Admin for emulator environment');
} else {
  initializeApp();
  logger.info('Initialized Firebase Admin for production environment');
}
const db = getFirestore();

// Schema for reminder data
const CreateReminderSchema = z.object({
  date_iso: z.string().describe("The commitment date in YYYY-MM-DD format"),
  text: z.string().describe("The commitment text to remind about"),
});

// Types
interface ReminderData {
  userId: string;
  date_iso: string;
  text: string;
  createdAt: Timestamp;
  messageId: string;
  sessionId: string;
}

interface MessageData {
  content: string;
  userId: string;
  timestamp: Timestamp;
  type: 'user' | 'agent';
}

/**
 * Generate a consistent reminder ID based on userId, date, and text
 * This ensures idempotency - same commitment will always generate same ID
 */
function generateReminderId(userId: string, dateIso: string, text: string): string {
  const hash = createHash('sha256');
  hash.update(`${userId}-${dateIso}-${text}`);
  return hash.digest('hex');
}

/**
 * Calculate the UTC timestamp for 00:00 on the given date
 */
function calculateScheduleTime(dateIso: string): Date {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateIso}`);
  }
  return date;
}

/**
 * Extract commitment information from user message using LLM or pattern matching
 */
async function analyzeMessage(messageContent: string): Promise<{
  hasCommitment: boolean;
  reminder?: z.infer<typeof CreateReminderSchema>;
}> {
  // For LLM integration, check environment variables
  const llmProvider = process.env.LLM_PROVIDER;
  const llmApiKey = process.env.LLM_API_KEY;

  if (llmProvider && llmApiKey) {
    try {
      return await analyzeMessageWithLLM(messageContent, llmProvider, llmApiKey);
    } catch (error) {
      logger.warn("LLM analysis failed, falling back to pattern matching:", error);
    }
  }

  // Fallback to pattern matching
  return analyzeMessageFallback(messageContent);
}

/**
 * Analyze message using LLM API (Vertex AI or OpenAI)
 */
async function analyzeMessageWithLLM(
  messageContent: string,
  provider: string,
  apiKey: string
): Promise<{
  hasCommitment: boolean;
  reminder?: z.infer<typeof CreateReminderSchema>;
}> {
  const prompt = `
You are an AI assistant that analyzes therapy chat messages to identify future-dated commitments.

Your task is to:
1. Determine if the message contains a commitment for a future date
2. If yes, extract the date (in YYYY-MM-DD format) and the commitment text
3. Only extract commitments that have specific future dates, not vague references like "soon" or "next week"

Message to analyze: "${messageContent}"

Current date for reference: ${new Date().toISOString().split('T')[0]}

Please respond with a JSON object:
- If you find a future-dated commitment: {"hasCommitment": true, "date_iso": "YYYY-MM-DD", "text": "commitment text"}
- If no commitment found: {"hasCommitment": false}

Only respond with the JSON, nothing else.
`;

  let response: string;

  if (provider.toLowerCase() === 'openai') {
    // OpenAI API call
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.statusText}`);
    }

    const data = await openaiResponse.json();
    response = data.choices[0].message.content;
  } else {
    // Vertex AI API call
    const vertexResponse = await fetch(
      `https://us-central1-aiplatform.googleapis.com/v1/projects/${process.env.GCLOUD_PROJECT}/locations/us-central1/publishers/google/models/gemini-1.5-flash:generateContent`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 200,
            temperature: 0.1,
          },
        }),
      }
    );

    if (!vertexResponse.ok) {
      throw new Error(`Vertex AI API error: ${vertexResponse.statusText}`);
    }

    const data = await vertexResponse.json();
    response = data.candidates[0].content.parts[0].text;
  }

  logger.info(`LLM response: ${response}`);

  // Parse the JSON response
  try {
    const parsed = JSON.parse(response);

    if (parsed.hasCommitment && parsed.date_iso && parsed.text) {
      // Validate the date
      const commitmentDate = new Date(parsed.date_iso + 'T00:00:00.000Z');
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (commitmentDate <= today) {
        logger.warn(`Commitment date ${parsed.date_iso} is not in the future`);
        return { hasCommitment: false };
      }

      return {
        hasCommitment: true,
        reminder: {
          date_iso: parsed.date_iso,
          text: parsed.text,
        },
      };
    }

    return { hasCommitment: false };
  } catch (parseError) {
    logger.warn(`Failed to parse LLM response as JSON: ${response}`);
    throw parseError;
  }
}

/**
 * Fallback commitment analysis using simple pattern matching
 */
function analyzeMessageFallback(messageContent: string): {
  hasCommitment: boolean;
  reminder?: z.infer<typeof CreateReminderSchema>;
} {
  // Simple regex patterns to identify date commitments
  const datePatterns = [
    /(?:on|by|until|before)\s+(\d{4}-\d{2}-\d{2})/i,
    /(?:on|by|until|before)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    /(?:on|by|until|before)\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /(\d{4}-\d{2}-\d{2})/i, // ISO date format
  ];

  const commitmentWords = [
    'commit', 'promise', 'will', 'going to', 'plan to', 'intend to',
    'goal', 'target', 'deadline', 'schedule', 'appointment', 'reminder'
  ];

  const hasCommitmentWord = commitmentWords.some(word =>
    messageContent.toLowerCase().includes(word)
  );

  if (!hasCommitmentWord) {
    return { hasCommitment: false };
  }

  for (const pattern of datePatterns) {
    const match = messageContent.match(pattern);
    if (match) {
      const dateStr = match[1];
      let isoDate: string;

      try {
        // Convert to ISO date format
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) continue;

        isoDate = date.toISOString().split('T')[0];

        // Check if it's in the future
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (date <= today) continue;

        return {
          hasCommitment: true,
          reminder: {
            date_iso: isoDate,
            text: messageContent.trim(),
          },
        };
      } catch (error) {
        continue;
      }
    }
  }

  return { hasCommitment: false };
}

/**
 * Create a Cloud Task to send FCM notification at the scheduled time
 */
async function scheduleNotification(
  userId: string,
  reminderText: string,
  scheduleTime: Date,
  projectId: string
): Promise<void> {
  const tasksClient = new CloudTasksClient();
  const queuePath = tasksClient.queuePath(projectId, 'us-central1', 'reminder-queue');

  // Create the task
  const task = {
    httpRequest: {
      httpMethod: 'POST' as const,
      url: `https://us-central1-${projectId}.cloudfunctions.net/sendReminderNotification`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: Buffer.from(JSON.stringify({
        userId,
        reminderText,
      })),
    },
    scheduleTime: {
      seconds: Math.floor(scheduleTime.getTime() / 1000),
    },
  };

  await tasksClient.createTask({
    parent: queuePath,
    task,
  });

  logger.info(`Scheduled notification for user ${userId} at ${scheduleTime.toISOString()}`);
}

/**
 * Main Cloud Function: Process new user messages
 */
export const processUserMessage = onDocumentCreated(
  {
    document: "sessions/{sessionId}/messages/{messageId}",
    region: "us-central1",
  },
  async (event: FirestoreEvent<any>) => {
    const messageData = event.data?.data() as MessageData;
    const messageId = event.params.messageId;
    const sessionId = event.params.sessionId;

    if (!messageData) {
      logger.warn(`No data found for message ${messageId}`);
      return;
    }

    // Only process user messages (not agent messages)
    if (messageData.type !== 'user') {
      logger.info(`Skipping non-user message ${messageId}`);
      return;
    }

    logger.info(`Processing user message ${messageId} from session ${sessionId}`);

    try {
      // Analyze the message for commitments
      const analysis = await analyzeMessage(messageData.content);

      if (!analysis.hasCommitment || !analysis.reminder) {
        logger.info(`No commitment found in message ${messageId}`);
        return;
      }

      const { date_iso, text } = analysis.reminder;
      const userId = messageData.userId;

      // Generate idempotent reminder ID
      const reminderId = generateReminderId(userId, date_iso, text);

      // Create reminder document
      const reminderData: ReminderData = {
        userId,
        date_iso,
        text,
        createdAt: Timestamp.now(),
        messageId,
        sessionId,
      };

      // Use merge: true for idempotent writes
      await db
        .collection('reminders')
        .doc(userId)
        .collection('userReminders')
        .doc(reminderId)
        .set(reminderData, { merge: true });

      logger.info(`Created reminder ${reminderId} for user ${userId}`);

      // Schedule the notification (skip in emulator environment)
      const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' ||
        process.env.FIRESTORE_EMULATOR_HOST !== undefined ||
        process.env.NODE_ENV === 'development';

      if (isEmulator) {
        logger.info(`Skipping notification scheduling in emulator environment for user ${userId}`);
      } else {
        try {
          const scheduleTime = calculateScheduleTime(date_iso);
          const projectId = process.env.GCLOUD_PROJECT;

          if (!projectId) {
            logger.warn('GCLOUD_PROJECT environment variable not set, skipping notification scheduling');
          } else {
            await scheduleNotification(userId, text, scheduleTime, projectId);
            logger.info(`Notification scheduled for user ${userId}`);
          }
        } catch (notificationError) {
          logger.warn(`Failed to schedule notification:`, notificationError);
          // Don't throw error - reminder was created successfully
        }
      }

      logger.info(`Successfully processed commitment for user ${userId}: "${text}" on ${date_iso}`);

    } catch (error) {
      logger.error(`Error processing message ${messageId}:`, error);
      // Only re-throw if it's not a notification scheduling error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('Cloud Tasks') && !errorMessage.includes('metadata')) {
        throw error;
      }
    }
  }
);

/**
 * Cloud Function to handle sending FCM notifications (called by Cloud Tasks)
 */
export const sendReminderNotification = onRequest(
  {
    region: "us-central1",
  },
  async (req: Request, res: Response) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    try {
      const { userId, reminderText } = req.body;

      if (!userId || !reminderText) {
        res.status(400).send('Missing required fields');
        return;
      }

      // Get user's FCM token
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data();

      if (!userData || !userData.fcmToken) {
        logger.warn(`No FCM token found for user ${userId}`);
        res.status(404).send('User or FCM token not found');
        return;
      }

      // Send FCM notification using Admin SDK
      const admin = await import('firebase-admin');
      const messaging = admin.messaging();

      const message = {
        token: userData.fcmToken,
        notification: {
          title: 'Therapy Commitment Reminder',
          body: reminderText,
        },
        data: {
          type: 'commitment_reminder',
          userId: userId,
        },
      };

      const response = await messaging.send(message);
      logger.info(`Successfully sent notification to user ${userId}:`, response);

      res.status(200).json({ success: true, messageId: response });

    } catch (error) {
      logger.error('Error sending FCM notification:', error);
      res.status(500).json({ error: 'Failed to send notification' });
    }
  }
);

// Keep the hello world function for testing
export const helloWorld = onRequest((request, response) => {
  logger.info("Hello logs!", { structuredData: true });
  response.send("Hello from Firebase!");
});

// Export utility functions for testing
export { generateReminderId, calculateScheduleTime, analyzeMessageFallback };
