#!/usr/bin/env node

/**
 * Test LLM Integration with Environment Variables
 * This script tests that the LLM is properly configured and working
 */

// Load environment variables
require('dotenv').config({ path: '.env' });

const axios = require('axios');

console.log('🧠 Testing LLM Integration with Environment Variables...\n');

// Check environment variables
console.log('📋 Environment Variables:');
console.log(`   LLM_PROVIDER: ${process.env.LLM_PROVIDER || 'Not set'}`);
console.log(`   LLM_API_KEY: ${process.env.LLM_API_KEY ? 'Set (' + process.env.LLM_API_KEY.substring(0, 10) + '...)' : 'Not set'}`);
console.log('');

async function testLLMAPI() {
    const provider = process.env.LLM_PROVIDER;
    const apiKey = process.env.LLM_API_KEY;

    if (!provider || !apiKey) {
        console.log('❌ LLM_PROVIDER or LLM_API_KEY not configured');
        console.log('💡 Make sure .env file contains:');
        console.log('   LLM_PROVIDER=openai');
        console.log('   LLM_API_KEY=your-api-key');
        return;
    }

    console.log(`🔍 Testing ${provider.toUpperCase()} API...`);

    const testMessage = "I will go to the gym on 2025-08-15";

    try {
        if (provider.toLowerCase() === 'openai') {
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

            console.log('✅ OpenAI API connected successfully!');
            console.log('📝 Response:', JSON.stringify(response.data.choices[0].message.content, null, 2));

            // Try to parse the response as JSON
            try {
                const result = JSON.parse(response.data.choices[0].message.content);
                console.log('✅ JSON parsing successful:');
                console.log(`   Has Commitment: ${result.hasCommitment}`);
                console.log(`   Date: ${result.date_iso || 'N/A'}`);
                console.log(`   Text: ${result.text || 'N/A'}`);
            } catch (parseError) {
                console.log('⚠️  Response is not valid JSON, but API is working');
            }

        } else {
            console.log(`❌ Provider "${provider}" not implemented in this test`);
            console.log('💡 Currently supported: openai');
        }

    } catch (error) {
        console.log('❌ LLM API Error:');
        if (error.response) {
            console.log(`   Status: ${error.response.status}`);
            console.log(`   Message: ${error.response.data?.error?.message || error.response.statusText}`);
        } else {
            console.log(`   Error: ${error.message}`);
        }
    }
}

// Test the LLM integration
testLLMAPI()
    .then(() => {
        console.log('\n🎉 LLM integration test completed!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n💥 Test failed:', error);
        process.exit(1);
    });
