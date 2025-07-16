/**
 * Main Accountability Agent that processes user messages and creates reminders
 * Implements the Facade pattern to coordinate between LLM, storage, and notification services
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, DocumentSnapshot } from "firebase-admin/firestore";
import { LLMProvider, ReminderStorage, NotificationScheduler, UserMessage, AccountabilityAgentConfig, EnvironmentVariables } from "./types.js";
import { createLLMProvider } from "./llm-provider.js";
import { FirestoreReminderStorage } from "./reminder-service.js";
import { createNotificationScheduler, CloudTasksNotificationScheduler } from "./notification-service.js";

// Initialize Firebase Admin SDK
initializeApp();

/**
 * Main Accountability Agent class
 * Orchestrates the process of analyzing messages, creating reminders, and scheduling notifications
 */
class AccountabilityAgent {
    private readonly llmProvider: LLMProvider;
    private readonly reminderStorage: ReminderStorage;
    private readonly notificationScheduler: NotificationScheduler;

    constructor(config: AccountabilityAgentConfig) {
        this.llmProvider = createLLMProvider(config.llmConfig);
        this.reminderStorage = new FirestoreReminderStorage();
        this.notificationScheduler = createNotificationScheduler(config);
    }

    /**
     * Process a user message to extract commitments and create reminders
     * @param message - The user message to process
     */
    async processMessage(message: UserMessage): Promise<void> {
        try {
            console.log(`Processing message from user ${message.userId}: ${message.content.substring(0, 100)}...`);

            // Extract commitments using LLM
            const commitments = await this.llmProvider.extractCommitments(message.content);

            if (commitments.length === 0) {
                console.log("No future-dated commitments found in message");
                return;
            }

            console.log(`Found ${commitments.length} commitment(s)`);

            // Process each commitment
            for (const commitment of commitments) {
                await this.processCommitment(message.userId, commitment);
            }
        } catch (error) {
            console.error("Error processing message:", error);
            throw error;
        }
    }

    /**
     * Process a single commitment by creating reminder and scheduling notification
     * @param userId - The user ID
     * @param commitment - The commitment to process
     */
    private async processCommitment(userId: string, commitment: any): Promise<void> {
        try {
            // Check if reminder already exists (idempotency)
            const reminderExists = await this.reminderStorage.reminderExists(
                userId,
                commitment.dateIso,
                commitment.text
            );

            if (reminderExists) {
                console.log(`Reminder already exists for commitment: ${commitment.text}`);
                return;
            }

            // Get user's FCM token
            const fcmToken = await this.getUserFCMToken(userId);
            if (!fcmToken) {
                console.log(`No FCM token found for user ${userId}, skipping notification scheduling`);
                return;
            }

            // Create reminder object
            const reminder = (this.reminderStorage as FirestoreReminderStorage).createReminderFromCommitment(
                userId,
                commitment.dateIso,
                commitment.text
            );

            // Create notification task
            const notificationTask = (this.notificationScheduler as CloudTasksNotificationScheduler).createNotificationTask(
                reminder.id,
                userId,
                reminder.scheduledAt,
                fcmToken,
                commitment.text
            );

            // Schedule the notification
            const taskId = await this.notificationScheduler.scheduleNotification(notificationTask);

            // Update reminder with task ID
            const finalReminder = {
                ...reminder,
                notificationTaskId: taskId,
            };

            // Save reminder to Firestore
            await this.reminderStorage.saveReminder(finalReminder);

            console.log(`Created reminder ${reminder.id} for user ${userId} scheduled for ${reminder.scheduledAt.toISOString()}`);
        } catch (error) {
            console.error("Error processing commitment:", error);
            throw error;
        }
    }

    /**
     * Get the FCM token for a user
     * @param userId - The user ID
     * @returns The FCM token or null if not found
     */
    private async getUserFCMToken(userId: string): Promise<string | null> {
        try {
            const db = getFirestore();
            const userDoc = await db.collection("users").doc(userId).get();

            if (!userDoc.exists) {
                console.log(`User document not found: ${userId}`);
                return null;
            }

            const userData = userDoc.data();
            const fcmToken = userData?.fcmToken;

            if (!fcmToken || typeof fcmToken !== "string") {
                console.log(`No valid FCM token found for user: ${userId}`);
                return null;
            }

            // Validate token format
            if (!(this.notificationScheduler as CloudTasksNotificationScheduler).validateFCMToken(fcmToken)) {
                console.log(`Invalid FCM token format for user: ${userId}`);
                return null;
            }

            return fcmToken;
        } catch (error) {
            console.error("Error getting user FCM token:", error);
            return null;
        }
    }
}

/**
 * Create configuration from environment variables
 */
function createConfigFromEnvironment(): AccountabilityAgentConfig {
    const env = process.env as unknown as EnvironmentVariables;

    if (!env.LLM_PROVIDER) {
        throw new Error("LLM_PROVIDER environment variable is required");
    }

    if (!env.LLM_API_KEY) {
        throw new Error("LLM_API_KEY environment variable is required");
    }

    if (!env.GOOGLE_CLOUD_PROJECT) {
        throw new Error("GOOGLE_CLOUD_PROJECT environment variable is required");
    }

    const projectId = env.GOOGLE_CLOUD_PROJECT;
    const locationId = env.LOCATION_ID || "us-central1";
    const taskQueueName = env.TASK_QUEUE_NAME || "accountability-notifications";

    return {
        llmConfig: {
            provider: env.LLM_PROVIDER,
            apiKey: env.LLM_API_KEY,
            temperature: 0.1,
            maxTokens: 1000,
        },
        projectId,
        fcmEndpoint: CloudTasksNotificationScheduler.getFCMEndpoint(projectId),
        taskQueueName,
        locationId,
    };
}

/**
 * Convert Firestore document to UserMessage
 */
function documentToUserMessage(doc: DocumentSnapshot): UserMessage {
    const data = doc.data();
    if (!data) {
        throw new Error("Document has no data");
    }

    return {
        id: doc.id,
        userId: data.userId || "",
        sessionId: data.sessionId || "",
        content: data.content || "",
        timestamp: data.timestamp?.toDate() || new Date(),
        metadata: data.metadata || {},
    };
}

// Create the global accountability agent instance
const config = createConfigFromEnvironment();
const accountabilityAgent = new AccountabilityAgent(config);

/**
 * Firebase Cloud Function trigger for new user messages
 * Listens to /sessions/{sessionId}/messages/{msgId} onCreate events
 */
export const processUserMessage = onDocumentCreated(
    "sessions/{sessionId}/messages/{msgId}",
    async (event) => {
        try {
            const snapshot = event.data;
            if (!snapshot) {
                console.log("No data in snapshot");
                return;
            }

            // Convert document to UserMessage
            const message = documentToUserMessage(snapshot);

            // Only process messages that have content and are from users
            if (!message.content || !message.userId) {
                console.log("Skipping message: missing content or userId");
                return;
            }

            // Process the message with the accountability agent
            await accountabilityAgent.processMessage(message);
        } catch (error) {
            console.error("Error in processUserMessage function:", error);
            // Don't throw error to avoid function retries for non-recoverable errors
        }
    }
);

// Export for testing
export { AccountabilityAgent, createConfigFromEnvironment };
