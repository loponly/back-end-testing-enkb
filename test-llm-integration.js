#!/usr/bin/env node

/**
 * Test Full Accountability Agent with LLM Integration
 * This script tests the complete flow including LLM analysis
 */

// Load environment variables
require('dotenv').config({ path: '.env' });

const admin = require('firebase-admin');

// Initialize Firebase Admin with emulator settings
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

// Initialize the app
const app = admin.initializeApp({
    projectId: 'back-end-testing-6d8a8'
});

const db = admin.firestore();

console.log('🧠 Testing Accountability Agent with LLM Integration...\n');

// Check environment variables
console.log('📋 Environment Configuration:');
console.log(`   LLM_PROVIDER: ${process.env.LLM_PROVIDER || 'Not set'}`);
console.log(`   LLM_API_KEY: ${process.env.LLM_API_KEY ? 'Set (' + process.env.LLM_API_KEY.substring(0, 10) + '...)' : 'Not set'}`);
console.log(`   FIREBASE_PROJECT_ID: ${process.env.FIREBASE_PROJECT_ID || 'Not set'}`);
console.log('');

async function testAccountabilityAgentWithLLM() {
    try {
        // Test data with various commitment types
        const testCases = [
            {
                message: 'I will go to the gym on 2025-08-15',
                expected: true,
                description: 'Simple future commitment'
            },
            {
                message: 'My goal is to finish reading the book by 2025-12-20',
                expected: true,
                description: 'Goal-based commitment'
            },
            {
                message: 'I had a nice session today',
                expected: false,
                description: 'Past reference (no commitment)'
            },
            {
                message: 'I might visit the doctor sometime next month',
                expected: false,
                description: 'Vague future reference'
            }
        ];

        for (let i = 0; i < testCases.length; i++) {
            const testCase = testCases[i];
            const sessionId = `test-session-llm-${Date.now()}-${i}`;
            const messageId = `msg-${Date.now()}-${i}`;
            const userId = `user-${i}`;

            console.log(`🧪 Test ${i + 1}: ${testCase.description}`);
            console.log(`📝 Message: "${testCase.message}"`);

            // Create the test message
            const testMessage = {
                content: testCase.message,
                userId: userId,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: 'user'
            };

            // Add the message to Firestore (this should trigger our Cloud Function)
            await db.collection('sessions').doc(sessionId).collection('messages').doc(messageId).set(testMessage);

            console.log(`✅ Message added to /sessions/${sessionId}/messages/${messageId}`);

            // Wait for the Cloud Function to process
            console.log('⏳ Waiting for Cloud Function processing...');
            await new Promise(resolve => setTimeout(resolve, 4000)); // Longer wait for LLM processing

            // Check if a reminder was created
            const remindersSnapshot = await db.collection('reminders').doc(userId).collection('userReminders').get();

            if (testCase.expected) {
                if (remindersSnapshot.empty) {
                    console.log('❌ Expected reminder but none found');
                } else {
                    console.log(`✅ Found ${remindersSnapshot.size} reminder(s) as expected`);
                    remindersSnapshot.forEach(doc => {
                        const data = doc.data();
                        console.log(`   📅 Date: ${data.date_iso || 'N/A'}`);
                        console.log(`   📝 Text: ${data.text || 'N/A'}`);
                    });
                }
            } else {
                if (remindersSnapshot.empty) {
                    console.log('✅ No reminder created as expected');
                } else {
                    console.log('❌ Unexpected reminder created');
                    remindersSnapshot.forEach(doc => {
                        const data = doc.data();
                        console.log(`   📅 Unexpected Date: ${data.date_iso || 'N/A'}`);
                        console.log(`   📝 Unexpected Text: ${data.text || 'N/A'}`);
                    });
                }
            }

            console.log('');
        }

        console.log('🎉 LLM integration test completed!');
        console.log('\n💡 View the data at: http://127.0.0.1:4000/firestore');
        console.log('📊 View function logs at: http://127.0.0.1:4000/functions');

    } catch (error) {
        console.error('❌ Error testing Accountability Agent with LLM:', error);
    }
}

// Run the test
testAccountabilityAgentWithLLM()
    .then(() => {
        console.log('\n✨ Test completed successfully!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n💥 Test failed:', error);
        process.exit(1);
    });
