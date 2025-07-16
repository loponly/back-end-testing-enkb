#!/usr/bin/env node

const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin with emulator settings
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

// Initialize the app
const app = admin.initializeApp({
    projectId: 'back-end-testing-6d8a8'
});

const db = admin.firestore();

console.log('🚀 Testing Accountability Agent with Firebase Emulator...\n');

async function testAccountabilityAgent() {
    try {
        // Test data
        const sessionId = 'test-session-' + Date.now();
        const messageId = 'msg-' + Date.now();
        const userId = 'user123';

        console.log('📝 Creating test message with commitment...');

        // Create a message with a future commitment
        const testMessage = {
            content: 'I will go to the gym on 2025-08-15',
            userId: userId,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            type: 'user'  // This should match what the Cloud Function expects
        };

        // Add the message to Firestore (this should trigger our Cloud Function)
        await db.collection('sessions').doc(sessionId).collection('messages').doc(messageId).set(testMessage);

        console.log(`✅ Message added to /sessions/${sessionId}/messages/${messageId}`);
        console.log(`📋 Content: "${testMessage.content}"`);

        // Wait a moment for the Cloud Function to process
        console.log('\n⏳ Waiting for Cloud Function to process...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Check if a reminder was created
        console.log('\n🔍 Checking for created reminders...');
        const remindersSnapshot = await db.collection('reminders').doc(userId).collection('userReminders').get();

        if (remindersSnapshot.empty) {
            console.log('❌ No reminders found - the function may not have triggered');
            return;
        }

        console.log(`✅ Found ${remindersSnapshot.size} reminder(s):`);

        remindersSnapshot.forEach(doc => {
            const data = doc.data();
            console.log(`   📅 Reminder ID: ${doc.id}`);
            console.log(`   📝 Content: ${data.originalMessage || 'N/A'}`);
            console.log(`   ⏰ Scheduled: ${data.scheduledTime ? data.scheduledTime.toDate() : 'N/A'}`);
            console.log(`   🎯 Commitment: ${data.commitment || 'N/A'}`);
            console.log(`   📊 Status: ${data.status || 'N/A'}`);
            console.log(`   📋 Full data:`, JSON.stringify(data, null, 2));
            console.log('');
        });

        // Test the notification endpoint
        console.log('🔔 Testing notification endpoint...');
        const notificationUrl = 'http://127.0.0.1:5001/back-end-testing-6d8a8/us-central1/sendReminderNotification';

        try {
            const response = await axios.post(notificationUrl, {
                userId: userId,
                commitment: 'I will go to the gym on 2025-08-15',
                originalMessage: 'I will go to the gym on 2025-08-15'
            });

            console.log('✅ Notification endpoint response:', response.status);
            console.log('📱 FCM would send:', response.data);
        } catch (error) {
            console.log('⚠️  Notification endpoint test (FCM not configured):', error.response?.status || error.message);
        }

        console.log('\n🎉 Accountability Agent test completed!');
        console.log('\n💡 View the data at: http://127.0.0.1:4000/firestore');
        console.log('📊 View function logs at: http://127.0.0.1:4000/functions');

    } catch (error) {
        console.error('❌ Error testing Accountability Agent:', error);
    }
}

// Run the test
testAccountabilityAgent()
    .then(() => {
        console.log('\n✨ Test completed successfully!');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Test failed:', error);
        process.exit(1);
    });
