/**
 * Simple integration test for the Accountability Agent
 * 
 * This test validates the basic functionality without complex mocking
 */

describe('Accountability Agent Integration', () => {
  test('should analyze message and detect commitment', () => {
    const messageWithCommitment = 'I will go to the gym on 2025-08-15';
    const messageWithoutCommitment = 'I had a good day today';

    // Import the function to test
    const { analyzeMessageFallback } = require('../src/index');

    // Test message with commitment
    const result1 = analyzeMessageFallback(messageWithCommitment);
    expect(result1.hasCommitment).toBe(true);
    expect(result1.reminder?.date_iso).toBe('2025-08-15');

    // Test message without commitment
    const result2 = analyzeMessageFallback(messageWithoutCommitment);
    expect(result2.hasCommitment).toBe(false);
  });

  test('should generate consistent reminder IDs', () => {
    const { generateReminderId } = require('../src/index');

    const userId = 'user123';
    const dateIso = '2025-08-15';
    const text = 'Go to gym';

    const id1 = generateReminderId(userId, dateIso, text);
    const id2 = generateReminderId(userId, dateIso, text);

    expect(id1).toBe(id2);
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);
  });

  test('should calculate correct schedule time', () => {
    const { calculateScheduleTime } = require('../src/index');

    const dateIso = '2025-08-15';
    const scheduleTime = calculateScheduleTime(dateIso);

    expect(scheduleTime).toBeInstanceOf(Date);
    expect(scheduleTime.getUTCHours()).toBe(0);
    expect(scheduleTime.getUTCMinutes()).toBe(0);
    expect(scheduleTime.getUTCSeconds()).toBe(0);
  });

  test('should reject invalid date formats', () => {
    const { calculateScheduleTime } = require('../src/index');

    expect(() => {
      calculateScheduleTime('invalid-date');
    }).toThrow('Invalid date format');
  });
});
