#!/usr/bin/env node

/**
 * Direct test of the LLM analysis function
 * This tests the function logic without Firebase triggers
 */

// Load environment variables
require('dotenv').config({ path: '.env' });

console.log('🧠 Direct Test of LLM Analysis Function...\n');

// Check environment variables
console.log('📋 Environment Configuration:');
console.log(`   LLM_PROVIDER: ${process.env.LLM_PROVIDER || 'Not set'}`);
console.log(`   LLM_API_KEY: ${process.env.LLM_API_KEY ? 'Set (' + process.env.LLM_API_KEY.substring(0, 10) + '...)' : 'Not set'}`);
console.log('');

// Import the compiled functions
try {
    const { analyzeMessageFallback } = require('./functions/lib/index');

    console.log('✅ Functions imported successfully from compiled lib');

    // Test cases
    const testMessages = [
        'I will go to the gym on 2025-08-15',
        'My goal is to finish reading the book by 2025-12-20',
        'I had a nice session today',
        'I might visit the doctor sometime next month'
    ];

    console.log('\n🧪 Testing Pattern Matching Fallback:');

    for (const message of testMessages) {
        const result = analyzeMessageFallback(message);
        console.log(`\n📝 "${message}"`);
        console.log(`   Has Commitment: ${result.hasCommitment}`);
        if (result.reminder) {
            console.log(`   Date: ${result.reminder.date_iso}`);
            console.log(`   Text: ${result.reminder.text}`);
        }
    }

    console.log('\n🎉 Direct function test completed!');

} catch (error) {
    console.error('❌ Error importing or testing functions:', error);
}

// Let's also test the LLM API directly
async function testLLMDirect() {
    const axios = require('axios');

    console.log('\n🔍 Testing LLM API directly...');

    const provider = process.env.LLM_PROVIDER;
    const apiKey = process.env.LLM_API_KEY;

    if (!provider || !apiKey) {
        console.log('❌ LLM not configured, skipping direct API test');
        return;
    }

    try {
        const testMessage = 'I will go to the gym on 2025-08-15';

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'You are an assistant that extracts future-dated commitments from text. Respond with JSON containing "hasCommitment" (boolean), and if true, "date_iso" (YYYY-MM-DD format) and "text" (the commitment).'
                },
                {
                    role: 'user',
                    content: `Analyze this message for future commitments: "${testMessage}"`
                }
            ],
            temperature: 0.1,
            max_tokens: 150
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ LLM API working correctly');
        const llmResult = JSON.parse(response.data.choices[0].message.content);
        console.log(`   Has Commitment: ${llmResult.hasCommitment}`);
        console.log(`   Date: ${llmResult.date_iso || 'N/A'}`);
        console.log(`   Text: ${llmResult.text || 'N/A'}`);

    } catch (error) {
        console.log('❌ LLM API Error:', error.response?.data?.error?.message || error.message);
    }
}

testLLMDirect();
