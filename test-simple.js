#!/usr/bin/env node

/**
 * Simple test to demonstrate the pattern matching functionality
 */

console.log('🚀 Testing Accountability Agent Pattern Matching...\n');

// Mock require for the Cloud Functions module
const mockCloudTasksClient = function () {
    return {
        queuePath: () => 'mock-queue-path',
        createTask: async () => ({ name: 'mock-task-id' })
    };
};

const mockAdmin = {
    firestore: {
        Timestamp: {
            now: () => ({ seconds: Date.now() / 1000 })
        }
    },
    messaging: () => ({
        send: async () => 'mock-message-id'
    })
};

// Mock the dependencies
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
    if (id === '@google-cloud/tasks') {
        return { CloudTasksClient: mockCloudTasksClient };
    }
    if (id === 'firebase-admin') {
        return mockAdmin;
    }
    return originalRequire.apply(this, arguments);
};

// Now we can test our functions
const { analyzeMessageFallback, generateReminderId, calculateScheduleTime } = require('./functions/lib/index');

// Test cases
const testMessages = [
    {
        content: 'I will go to the gym on 2025-08-15',
        expected: true,
        expectedDate: '2025-08-15'
    },
    {
        content: 'I plan to visit the doctor by 2025-12-20',
        expected: true,
        expectedDate: '2025-12-20'
    },
    {
        content: 'My goal is to finish the project on 2025-10-30',
        expected: true,
        expectedDate: '2025-10-30'
    },
    {
        content: 'I had a nice day today',
        expected: false
    },
    {
        content: 'Maybe I will do something soon',
        expected: false
    },
    {
        content: 'I went to the gym yesterday',
        expected: false
    }
];

console.log('📝 Testing message analysis...\n');

testMessages.forEach((test, index) => {
    console.log(`Test ${index + 1}: "${test.content}"`);

    const result = analyzeMessageFallback(test.content);

    if (result.hasCommitment === test.expected) {
        console.log('   ✅ Commitment detection: PASS');

        if (test.expected && result.reminder) {
            if (result.reminder.date_iso === test.expectedDate) {
                console.log(`   ✅ Date extraction: PASS (${result.reminder.date_iso})`);
            } else {
                console.log(`   ❌ Date extraction: FAIL (got ${result.reminder.date_iso}, expected ${test.expectedDate})`);
            }
        }
    } else {
        console.log('   ❌ Commitment detection: FAIL');
    }

    console.log('');
});

// Test idempotency
console.log('🔄 Testing idempotency...\n');

const userId = 'user123';
const dateIso = '2025-08-15';
const text = 'Go to gym';

const id1 = generateReminderId(userId, dateIso, text);
const id2 = generateReminderId(userId, dateIso, text);
const id3 = generateReminderId(userId, dateIso, 'Different text');

console.log('Same inputs:');
console.log(`   ID 1: ${id1}`);
console.log(`   ID 2: ${id2}`);
console.log(`   ✅ Match: ${id1 === id2 ? 'PASS' : 'FAIL'}\n`);

console.log('Different text:');
console.log(`   ID 3: ${id3}`);
console.log(`   ✅ Different: ${id1 !== id3 ? 'PASS' : 'FAIL'}\n`);

// Test schedule time calculation
console.log('⏰ Testing schedule time calculation...\n');

try {
    const scheduleTime = calculateScheduleTime('2025-08-15');
    console.log(`   📅 Date: 2025-08-15`);
    console.log(`   ⏰ Schedule time: ${scheduleTime.toISOString()}`);
    console.log(`   ✅ UTC midnight: ${scheduleTime.getUTCHours() === 0 && scheduleTime.getUTCMinutes() === 0 ? 'PASS' : 'FAIL'}\n`);
} catch (error) {
    console.log(`   ❌ Error: ${error.message}\n`);
}

// Test invalid date
try {
    calculateScheduleTime('invalid-date');
    console.log('   ❌ Should have thrown error for invalid date');
} catch (error) {
    console.log(`   ✅ Invalid date handling: PASS (${error.message})`);
}

console.log('\n🎉 Pattern matching tests completed!');
console.log('\n💡 To test the full Cloud Function:');
console.log('   1. Make sure Firebase emulator is running');
console.log('   2. Add a message to /sessions/{sessionId}/messages/{messageId}');
console.log('   3. Check /reminders/{userId}/userReminders for created reminders');
console.log('   4. View logs at: http://127.0.0.1:4000/functions');
console.log('   5. View data at: http://127.0.0.1:4000/firestore');
