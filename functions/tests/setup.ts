/**
 * Test setup file
 * 
 * Global test configuration and mocks
 */

// Mock fetch for LLM API calls
global.fetch = jest.fn();

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.GCLOUD_PROJECT = 'test-project';
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

// Increase timeout for integration tests
jest.setTimeout(30000);

beforeEach(() => {
    jest.clearAllMocks();
});
