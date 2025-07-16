#!/usr/bin/env node

/**
 * Test script to demonstrate the Accountability Agent functionality
 * 
 * This script:
 * 1. Creates test data in Firestore
 * 2. Simulates user messages with commitments
 * 3. Verifies reminder documents are created
 * 4. Tests the FCM notification endpoint
 */

const admin = require('firebase-admin');
const fetch = require('node-fetch');

// Initialize Firebase Admin for testing
const app = admin.initializeApp({
    projectId: 'back-end-testing-6d8a8'
});

// Connect to Firestore emulator
const db = admin.firestore(app);
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

async function testAccountabilityAgent() {
    console.log('🚀 Testing Accountability Agent...\n');

    try {
        // Test 1: Create a user with FCM token
        console.log('1. Creating test user with FCM token...');
        const userId = 'test-user-123';
        await db.collection('users').doc(userId).set({
            fcmToken: 'test-fcm-token-123',
            email: 'test@example.com',
            name: 'Test User'
        });
        console.log('   ✅ User created\n');

        // Test 2: Create a therapy session message with a commitment
        console.log('2. Creating message with future commitment...');
        const sessionId = 'session-456';
        const messageId = 'message-789';

        const messageData = {
            content: 'I will go to the gym on 2025-08-15',
            userId: userId,
            timestamp: new Date(),
            type: 'user'
        };

        await db.collection('sessions')
            .doc(sessionId)
            .collection('messages')
            .doc(messageId)
            .set(messageData);

        console.log('   ✅ Message created');
        console.log(`   📝 Content: "${messageData.content}"`);
        console.log('   ⏳ Waiting for function to process...\n');

        // Wait for the Cloud Function to process the message
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Test 3: Check if reminder document was created
        console.log('3. Checking for created reminder...');
        const remindersSnapshot = await db.collection('reminders')
            .doc(userId)
            .collection('userReminders')
            .get();

        if (remindersSnapshot.empty) {
            console.log('   ❌ No reminder document found');
            console.log('   💡 This might be because the function is using pattern matching fallback');
        } else {
            console.log('   ✅ Reminder document created!');
            remindersSnapshot.docs.forEach(doc => {
                const data = doc.data();
                console.log(`   📅 Date: ${data.date_iso}`);
                console.log(`   📝 Text: ${data.text}`);
                console.log(`   🆔 Reminder ID: ${doc.id}`);
            });
        }
        console.log('');

        // Test 4: Test FCM notification endpoint
        console.log('4. Testing FCM notification endpoint...');
        const notificationPayload = {
            userId: userId,
            reminderText: 'Time to go to the gym!'
        };

        try {
            const response = await fetch('http://127.0.0.1:5001/back-end-testing-6d8a8/us-central1/sendReminderNotification', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(notificationPayload)
            });

            console.log(`   📡 Response status: ${response.status}`);
            const result = await response.text();
            console.log(`   📨 Response: ${result}`);
        } catch (error) {
            console.log(`   ❌ Error calling notification endpoint: ${error.message}`);
        }
        console.log('');

        // Test 5: Test pattern matching with different message formats
        console.log('5. Testing different message formats...');

        const testMessages = [
            'I will exercise on 2025-09-01',
            'I plan to visit the doctor by 2025-12-15',
            'My goal is to finish the project on 2025-10-30',
            'I had a nice day today', // Should not create reminder
        ];

        for (let i = 0; i < testMessages.length; i++) {
            const testMessageId = `test-msg-${i}`;
            const testMessage = {
                content: testMessages[i],
                userId: userId,
                timestamp: new Date(),
                type: 'user'
            };

            await db.collection('sessions')
                .doc(sessionId)
                .collection('messages')
                .doc(testMessageId)
                .set(testMessage);

            console.log(`   📝 "${testMessage.content}"`);
        }

        console.log('   ⏳ Waiting for processing...\n');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Check final results
        console.log('6. Final reminder count...');
        const finalSnapshot = await db.collection('reminders')
            .doc(userId)
            .collection('userReminders')
            .get();

        console.log(`   📊 Total reminders created: ${finalSnapshot.size}`);
        finalSnapshot.docs.forEach(doc => {
            const data = doc.data();
            console.log(`      - ${data.date_iso}: "${data.text}"`);
        });

        console.log('\n🎉 Testing completed!');
        console.log('\n💡 Tips:');
        console.log('   - Check the Functions logs in the emulator UI: http://127.0.0.1:4000/functions');
        console.log('   - View Firestore data: http://127.0.0.1:4000/firestore');
        console.log('   - Set LLM_PROVIDER and LLM_API_KEY for enhanced analysis');

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        process.exit(0);
    }
}

testAccountabilityAgent();
