/**
 * Tests for the Accountability Agent functionality
 * 
 * This test suite validates:
 * - Message processing and commitment extraction
 * - Firestore reminder document creation
 * - Cloud Task scheduling for FCM notifications
 * - Idempotency guarantees
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { FirestoreTestWrapper } from './utils/firestore-test-wrapper';

// Mock dependencies
jest.mock('@google-cloud/tasks');
jest.mock('firebase-admin/messaging');

import { CloudTasksClient } from '@google-cloud/tasks';
import * as admin from 'firebase-admin';

const MockedCloudTasksClient = CloudTasksClient as jest.MockedClass<typeof CloudTasksClient>;

describe('Accountability Agent', () => {
    let firestoreWrapper: FirestoreTestWrapper;
    let mockTasksClient: jest.Mocked<CloudTasksClient>;
    let mockMessaging: jest.Mocked<admin.messaging.Messaging>;

    beforeEach(async () => {
        // Initialize Firestore emulator wrapper
        firestoreWrapper = new FirestoreTestWrapper();
        await firestoreWrapper.setup();

        // Mock Cloud Tasks client
        mockTasksClient = {
            queuePath: jest.fn().mockReturnValue('projects/test-project/locations/us-central1/queues/reminder-queue'),
            createTask: jest.fn().mockResolvedValue({ name: 'task-id' }),
        } as any;

        MockedCloudTasksClient.mockImplementation(() => mockTasksClient);

        // Mock Firebase messaging
        mockMessaging = {
            send: jest.fn().mockResolvedValue('message-id'),
        } as any;

        (admin.messaging as jest.Mock) = jest.fn().mockReturnValue(mockMessaging);

        // Set environment variables
        process.env.GCLOUD_PROJECT = 'test-project';
    });

    afterEach(async () => {
        await firestoreWrapper.cleanup();
        jest.clearAllMocks();
    });

    describe('Message Processing', () => {
        test('should process user message with future date commitment', async () => {
            const sessionId = 'test-session-123';
            const messageId = 'test-message-456';
            const userId = 'test-user-789';

            const messageData = {
                content: 'I will go to the gym on 2025-08-15',
                userId: userId,
                timestamp: firestoreWrapper.admin.firestore.Timestamp.now(),
                type: 'user' as const,
            };

            // Simulate adding a message to trigger the function
            const messageRef = firestoreWrapper.db
                .collection('sessions')
                .doc(sessionId)
                .collection('messages')
                .doc(messageId);

            await messageRef.set(messageData);

            // Import and call the function
            const { processUserMessage } = await import('../functions/src/index');

            // Create mock event
            const mockEvent = {
                data: {
                    data: () => messageData,
                },
                params: {
                    sessionId,
                    messageId,
                },
            };

            await processUserMessage(mockEvent as any);

            // Verify reminder document was created
            const reminderQuery = await firestoreWrapper.db
                .collection('reminders')
                .doc(userId)
                .collection('userReminders')
                .get();

            expect(reminderQuery.docs).toHaveLength(1);

            const reminderDoc = reminderQuery.docs[0];
            const reminderData = reminderDoc.data();

            expect(reminderData).toMatchObject({
                userId: userId,
                date_iso: '2025-08-15',
                text: 'I will go to the gym on 2025-08-15',
                messageId: messageId,
                sessionId: sessionId,
            });

            // Verify Cloud Task was created
            expect(mockTasksClient.createTask).toHaveBeenCalledWith({
                parent: 'projects/test-project/locations/us-central1/queues/reminder-queue',
                task: expect.objectContaining({
                    httpRequest: expect.objectContaining({
                        httpMethod: 'POST',
                        url: 'https://us-central1-test-project.cloudfunctions.net/sendReminderNotification',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    }),
                    scheduleTime: {
                        seconds: expect.any(Number),
                    },
                }),
            });
        });

        test('should ignore agent messages', async () => {
            const sessionId = 'test-session-123';
            const messageId = 'test-message-456';
            const userId = 'test-user-789';

            const messageData = {
                content: 'I will go to the gym on 2025-08-15',
                userId: userId,
                timestamp: firestoreWrapper.admin.firestore.Timestamp.now(),
                type: 'agent' as const, // This should be ignored
            };

            const { processUserMessage } = await import('../functions/src/index');

            const mockEvent = {
                data: {
                    data: () => messageData,
                },
                params: {
                    sessionId,
                    messageId,
                },
            };

            await processUserMessage(mockEvent as any);

            // Verify no reminder document was created
            const reminderQuery = await firestoreWrapper.db
                .collection('reminders')
                .doc(userId)
                .collection('userReminders')
                .get();

            expect(reminderQuery.docs).toHaveLength(0);
            expect(mockTasksClient.createTask).not.toHaveBeenCalled();
        });

        test('should ignore messages without future commitments', async () => {
            const sessionId = 'test-session-123';
            const messageId = 'test-message-456';
            const userId = 'test-user-789';

            const messageData = {
                content: 'I had a good day today',
                userId: userId,
                timestamp: firestoreWrapper.admin.firestore.Timestamp.now(),
                type: 'user' as const,
            };

            const { processUserMessage } = await import('../functions/src/index');

            const mockEvent = {
                data: {
                    data: () => messageData,
                },
                params: {
                    sessionId,
                    messageId,
                },
            };

            await processUserMessage(mockEvent as any);

            // Verify no reminder document was created
            const reminderQuery = await firestoreWrapper.db
                .collection('reminders')
                .doc(userId)
                .collection('userReminders')
                .get();

            expect(reminderQuery.docs).toHaveLength(0);
            expect(mockTasksClient.createTask).not.toHaveBeenCalled();
        });

        test('should ensure idempotency for duplicate commitments', async () => {
            const sessionId = 'test-session-123';
            const userId = 'test-user-789';

            const messageData = {
                content: 'I will exercise on 2025-08-15',
                userId: userId,
                timestamp: firestoreWrapper.admin.firestore.Timestamp.now(),
                type: 'user' as const,
            };

            const { processUserMessage } = await import('../functions/src/index');

            // Process the same commitment twice with different message IDs
            for (const messageId of ['msg-1', 'msg-2']) {
                const mockEvent = {
                    data: {
                        data: () => ({ ...messageData }),
                    },
                    params: {
                        sessionId,
                        messageId,
                    },
                };

                await processUserMessage(mockEvent as any);
            }

            // Verify only one reminder document was created (idempotency)
            const reminderQuery = await firestoreWrapper.db
                .collection('reminders')
                .doc(userId)
                .collection('userReminders')
                .get();

            expect(reminderQuery.docs).toHaveLength(1);
        });
    });

    describe('FCM Notification Handler', () => {
        test('should send FCM notification successfully', async () => {
            const userId = 'test-user-789';
            const reminderText = 'Time to go to the gym!';
            const fcmToken = 'test-fcm-token';

            // Create user document with FCM token
            await firestoreWrapper.db
                .collection('users')
                .doc(userId)
                .set({ fcmToken });

            const { sendReminderNotification } = await import('../functions/src/index');

            // Mock request and response
            const mockReq = {
                method: 'POST',
                body: {
                    userId,
                    reminderText,
                },
            } as any;

            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
                send: jest.fn(),
            } as any;

            await sendReminderNotification(mockReq, mockRes);

            // Verify FCM message was sent
            expect(mockMessaging.send).toHaveBeenCalledWith({
                token: fcmToken,
                notification: {
                    title: 'Therapy Commitment Reminder',
                    body: reminderText,
                },
                data: {
                    type: 'commitment_reminder',
                    userId: userId,
                },
            });

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                messageId: 'message-id',
            });
        });

        test('should handle missing FCM token', async () => {
            const userId = 'test-user-789';
            const reminderText = 'Time to go to the gym!';

            // Create user document without FCM token
            await firestoreWrapper.db
                .collection('users')
                .doc(userId)
                .set({ email: 'test@example.com' });

            const { sendReminderNotification } = await import('../functions/src/index');

            const mockReq = {
                method: 'POST',
                body: {
                    userId,
                    reminderText,
                },
            } as any;

            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
                send: jest.fn(),
            } as any;

            await sendReminderNotification(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.send).toHaveBeenCalledWith('User or FCM token not found');
            expect(mockMessaging.send).not.toHaveBeenCalled();
        });
    });

    describe('Date Validation', () => {
        test('should reject past dates', async () => {
            const sessionId = 'test-session-123';
            const messageId = 'test-message-456';
            const userId = 'test-user-789';

            const messageData = {
                content: 'I will go to the gym on 2020-01-01', // Past date
                userId: userId,
                timestamp: firestoreWrapper.admin.firestore.Timestamp.now(),
                type: 'user' as const,
            };

            const { processUserMessage } = await import('../functions/src/index');

            const mockEvent = {
                data: {
                    data: () => messageData,
                },
                params: {
                    sessionId,
                    messageId,
                },
            };

            await processUserMessage(mockEvent as any);

            // Verify no reminder document was created for past date
            const reminderQuery = await firestoreWrapper.db
                .collection('reminders')
                .doc(userId)
                .collection('userReminders')
                .get();

            expect(reminderQuery.docs).toHaveLength(0);
            expect(mockTasksClient.createTask).not.toHaveBeenCalled();
        });
    });
});
