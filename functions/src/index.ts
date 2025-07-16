/**
 * Accountability Agent fo// Configure Genkit with default model for simplicity
const ai = genkit({
  plugins: [
    // Configure based on environment variable
    process.env.LLM_PROVIDER === 'openai'
      ? openAI({ apiKey: process.env.LLM_API_KEY })
      : vertexAI({
        projectId: process.env.FIREBASE_PROJECT_ID || 'back-end-testing-6d8a8',
        location: 'us-central1'
      }),
  ],
});

/**
 * Accountability Agent for Therapy Chat with Genkit Integration
 * and extracts future-dated commitments using Genkit AI framework.
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

// Genkit imports
import { genkit } from "genkit";
import { vertexAI } from "@genkit-ai/vertexai";
import { openAI } from "genkitx-openai";

// Configure Genkit with default model for simplicity
const ai = genkit({
  plugins: [
    // Configure based on environment variable
    process.env.LLM_PROVIDER === 'openai'
      ? openAI({ apiKey: process.env.LLM_API_KEY })
      : vertexAI({
        projectId: process.env.FIREBASE_PROJECT_ID || 'back-end-testing-6d8a8',
        location: 'us-central1'
      }),
  ],
});

// Define date parser tool using Genkit tool calling  
const parseDateTool = ai.defineTool(
  {
    name: 'parseCommitmentDate',
    description: 'Extract and validate future commitment dates from natural language text',
    inputSchema: z.object({
      messageText: z.string().describe('The message text to analyze for dates'),
      currentDate: z.string().describe('Current date in YYYY-MM-DD format for comparison'),
    }),
    outputSchema: z.object({
      hasDate: z.boolean().describe('Whether a future date was found'),
      dateIso: z.string().optional().describe('Extracted date in YYYY-MM-DD format'),
      confidence: z.number().describe('Confidence level from 0-1'),
      extractedPhrase: z.string().optional().describe('The phrase containing the date'),
    }),
  },
  async (input) => {
    logger.info(`Parsing date from: "${input.messageText}" with current date: ${input.currentDate}`);

    // Date patterns to match
    const datePatterns = [
      { regex: /(\d{4}-\d{2}-\d{2})/i, format: 'ISO', confidence: 0.95 },
      { regex: /(?:on|by|until|before)\s+(\d{4}-\d{2}-\d{2})/i, format: 'ISO_WITH_PREPOSITION', confidence: 0.9 },
      { regex: /(?:on|by|until|before)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i, format: 'NATURAL', confidence: 0.8 },
      { regex: /(?:on|by|until|before)\s+(\d{1,2}\/\d{1,2}\/\d{4})/i, format: 'US_FORMAT', confidence: 0.7 },
      { regex: /(?:on|by|until|before)\s+(\d{1,2}-\d{1,2}-\d{4})/i, format: 'DASH_FORMAT', confidence: 0.7 },
    ];

    const currentDate = new Date(input.currentDate + 'T00:00:00.000Z');

    for (const pattern of datePatterns) {
      const match = input.messageText.match(pattern.regex);
      if (match) {
        const dateStr = match[1];
        const extractedPhrase = match[0];

        try {
          let parsedDate: Date;

          // Parse based on format
          switch (pattern.format) {
            case 'ISO':
            case 'ISO_WITH_PREPOSITION':
              parsedDate = new Date(dateStr + 'T00:00:00.000Z');
              break;
            case 'NATURAL':
              parsedDate = new Date(dateStr);
              break;
            case 'US_FORMAT':
              // Convert MM/DD/YYYY to proper date
              const [month, day, year] = dateStr.split('/');
              parsedDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`);
              break;
            case 'DASH_FORMAT':
              // Convert MM-DD-YYYY to proper date
              const [monthD, dayD, yearD] = dateStr.split('-');
              parsedDate = new Date(`${yearD}-${monthD.padStart(2, '0')}-${dayD.padStart(2, '0')}T00:00:00.000Z`);
              break;
            default:
              parsedDate = new Date(dateStr);
          }

          // Validate date is valid and in the future
          if (isNaN(parsedDate.getTime())) {
            continue;
          }

          if (parsedDate <= currentDate) {
            logger.info(`Date ${parsedDate.toISOString().split('T')[0]} is not in the future`);
            continue;
          }

          const dateIso = parsedDate.toISOString().split('T')[0];

          return {
            hasDate: true,
            dateIso,
            confidence: pattern.confidence,
            extractedPhrase,
          };

        } catch (error) {
          logger.warn(`Failed to parse date "${dateStr}": ${error}`);
          continue;
        }
      }
    }

    return {
      hasDate: false,
      confidence: 0,
    };
  }
);

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
 * Extract commitment information from user message using Genkit
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
      return await analyzeMessageWithGenkit(messageContent, llmProvider);
    } catch (error) {
      logger.warn("Genkit analysis failed, falling back to pattern matching:", error);
    }
  }

  // Fallback to pattern matching
  return analyzeMessageFallback(messageContent);
}

/**
 * Analyze message using Genkit AI framework with tool calling
 */
async function analyzeMessageWithGenkit(
  messageContent: string,
  provider: string
): Promise<{
  hasCommitment: boolean;
  reminder?: z.infer<typeof CreateReminderSchema>;
}> {
  const currentDate = new Date().toISOString().split('T')[0];

  const prompt = `
You are an AI assistant that analyzes therapy chat messages to identify future-dated commitments.

Your task is to determine if the message contains a commitment for a future date. You have access to a date parsing tool that can help extract and validate dates.

When you find a commitment with a specific future date:
1. Use the parseCommitmentDate tool to extract and validate the date
2. The message must contain both a commitment/action AND a specific future date
3. Only consider commitments with specific future dates, not vague references like "soon" or "next week"

Message to analyze: "${messageContent}"

Current date for reference: ${currentDate}

If the message contains a commitment with a specific future date, use the parseCommitmentDate tool. Otherwise, simply state that no commitment was found.
`;

  const modelName = provider === 'openai' ? 'openai/gpt-4' : 'vertexai/gemini-1.5-flash';

  const response = await ai.generate({
    model: modelName,
    prompt,
    tools: [parseDateTool],
    config: {
      maxOutputTokens: 300,
      temperature: 0.1,
    },
  });

  logger.info(`Genkit tool-enhanced response: ${response.text}`);

  // Parse the AI's text response for commitment information
  const responseText = response.text.toLowerCase();

  // Check if AI identified a commitment with specific future date
  if (responseText.includes('commitment') && responseText.includes('specific future date')) {
    // Extract date in ISO format (YYYY-MM-DD)
    const dateMatch = response.text.match(/\b(\d{4}-\d{2}-\d{2})\b/);

    if (dateMatch) {
      const dateIso = dateMatch[1];

      // Validate the date is in the future
      const commitmentDate = new Date(dateIso + 'T00:00:00.000Z');
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (commitmentDate <= today) {
        logger.warn(`Commitment date ${dateIso} is not in the future`);
        return { hasCommitment: false };
      }

      // Extract commitment text from original message
      let commitmentText = messageContent.trim();

      // Try to extract just the commitment part if possible
      const commitmentPatterns = [
        /I will (.+?)(?:\s+on|\s+by|\s+in|\s+at|\s*$)/i,
        /My goal is to (.+?)(?:\s+on|\s+by|\s+in|\s+at|\s*$)/i,
        /I plan to (.+?)(?:\s+on|\s+by|\s+in|\s+at|\s*$)/i,
        /I'm going to (.+?)(?:\s+on|\s+by|\s+in|\s+at|\s*$)/i,
      ];

      for (const pattern of commitmentPatterns) {
        const match = messageContent.match(pattern);
        if (match) {
          commitmentText = match[1].trim();
          break;
        }
      }

      logger.info(`Extracted commitment: "${commitmentText}" for date: ${dateIso}`);

      return {
        hasCommitment: true,
        reminder: {
          date_iso: dateIso,
          text: commitmentText,
        },
      };
    }
  }

  // Check if the model made tool calls and extract results (backup method)
  if (response.toolRequests && response.toolRequests.length > 0) {
    logger.info(`Genkit made ${response.toolRequests.length} tool call(s)`);

    // Find successful date parsing tool results
    for (const toolRequest of response.toolRequests) {
      if (toolRequest.toolRequest.name === 'parseCommitmentDate') {
        logger.info(`Date parsing tool request: ${JSON.stringify(toolRequest.toolRequest)}`);

        // Check if there's a tool response with successful parsing
        if (toolRequest.toolResponse) {
          logger.info(`Date parsing tool response: ${JSON.stringify(toolRequest.toolResponse)}`);

          try {
            // Access the tool result data - Genkit toolResponse structure
            const toolResult = (toolRequest.toolResponse as any).output;

            if (toolResult && toolResult.success && toolResult.dateIso) {
              // Validate the date is in the future
              const commitmentDate = new Date(toolResult.dateIso + 'T00:00:00.000Z');
              const today = new Date();
              today.setHours(0, 0, 0, 0);

              if (commitmentDate <= today) {
                logger.warn(`Commitment date ${toolResult.dateIso} is not in the future`);
                return { hasCommitment: false };
              }

              // Extract commitment text from original message
              let commitmentText = messageContent.trim();

              // Try to extract just the commitment part if possible
              const commitmentPatterns = [
                /I will (.+?)(?:\s+on|\s+by|\s+in|\s+at|\s*$)/i,
                /My goal is to (.+?)(?:\s+on|\s+by|\s+in|\s+at|\s*$)/i,
                /I plan to (.+?)(?:\s+on|\s+by|\s+in|\s+at|\s*$)/i,
                /I'm going to (.+?)(?:\s+on|\s+by|\s+in|\s+at|\s*$)/i,
              ];

              for (const pattern of commitmentPatterns) {
                const match = messageContent.match(pattern);
                if (match) {
                  commitmentText = match[1].trim();
                  break;
                }
              }

              return {
                hasCommitment: true,
                reminder: {
                  date_iso: toolResult.dateIso,
                  text: commitmentText,
                },
              };
            }
          } catch (error) {
            logger.warn(`Error parsing tool response: ${error}`);
          }
        }
      }
    }
  }

  // No valid tool calls found or no commitments identified
  return { hasCommitment: false };
}

/**
 * Analyze message using LLM API (Vertex AI or OpenAI)
 */
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
