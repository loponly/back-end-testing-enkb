/**
 * Provider-agnostic LLM service for extracting commitments from user messages
 * Implements the Strategy pattern for different LLM providers
 * 
 * Note: This is a simplified implementation. In production, you would integrate with
 * the actual Genkit API based on the specific version and proper setup.
 */

import { LLMProvider, LLMConfig, Commitment } from "./types.js";

/**
 * Implementation of LLMProvider using an improved rule-based approach
 * This serves as a working demo for the actual Genkit integration
 */
export class GenkitLLMProvider implements LLMProvider {

    constructor() {
        // Remove unused config parameter
    }

    /**
     * Extract commitments from user message using rule-based analysis
     * @param message - The user message to analyze
     * @returns Array of extracted commitments
     */
    async extractCommitments(message: string): Promise<Commitment[]> {
        try {
            // In production, this would call the Genkit LLM API
            // For now, use an improved rule-based approach for demonstration
            return this.extractCommitmentsRuleBased(message);
        } catch (error) {
            console.error("Error extracting commitments:", error);
            throw new Error(`Failed to extract commitments: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }

    /**
     * Rule-based commitment extraction with improved natural language support
     * In production, this would be replaced with actual LLM API calls
     */
    private extractCommitmentsRuleBased(message: string): Commitment[] {
        const commitments: Commitment[] = [];

        // Commitment keywords that indicate future actions
        const commitmentWords = [
            'will', 'need to', 'should', 'must', 'plan to', 'going to',
            'have to', 'intend to', 'want to', 'promise to'
        ];

        // Time indicators
        const timeIndicators = [
            'tomorrow', 'today', 'tonight', 'morning', 'afternoon', 'evening',
            'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
            'daily', 'weekly', 'every day', 'next week', 'this week',
            'am', 'pm', 'o\'clock'
        ];

        const lowerMessage = message.toLowerCase();

        // Check if message contains commitment indicators
        const hasCommitmentWord = commitmentWords.some(word => lowerMessage.includes(word));
        const hasTimeIndicator = timeIndicators.some(word => lowerMessage.includes(word));

        if (hasCommitmentWord || hasTimeIndicator) {
            // Extract commitment text - simplified extraction
            let commitmentText = this.extractCommitmentText(message);

            if (commitmentText.length > 5) { // Only meaningful commitments
                const dateIso = this.parseDate(message);

                commitments.push({
                    dateIso,
                    text: commitmentText,
                    confidence: this.calculateConfidence(message, hasCommitmentWord, hasTimeIndicator)
                });
            }
        }

        return commitments;
    }

    /**
     * Extract the main commitment text from the message
     */
    private extractCommitmentText(message: string): string {
        // Remove common prefixes and get the action part
        let text = message
            .replace(/^(I will|I need to|I should|I must|I plan to|I'm going to|I have to|I intend to|I want to|I promise to)\s+/i, '')
            .replace(/\s+(tomorrow|today|tonight|on \w+|at \d+)/i, '')
            .trim();

        // If text is too short, use a larger portion of the original message
        if (text.length < 10) {
            text = message.replace(/^(I\s+)?/i, '').trim();
        }

        return this.truncateAtSentenceBoundary(text, 100);
    }

    /**
     * Parse relative date expressions into YYYY-MM-DD format
     */
    private parseDate(message: string): string {
        const today = new Date();
        const lowerMessage = message.toLowerCase();

        // Check for exact date patterns first
        const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;
        const exactDate = message.match(dateRegex);
        if (exactDate) {
            return exactDate[1];
        }

        // Handle relative dates
        if (lowerMessage.includes('tomorrow')) {
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            return tomorrow.toISOString().split('T')[0];
        }

        if (lowerMessage.includes('today')) {
            return today.toISOString().split('T')[0];
        }

        // Handle specific days of the week
        const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        for (let i = 0; i < daysOfWeek.length; i++) {
            if (lowerMessage.includes(daysOfWeek[i])) {
                const targetDay = new Date(today);
                const currentDay = today.getDay();
                const targetDayIndex = i;

                let daysToAdd = targetDayIndex - currentDay;
                if (daysToAdd <= 0) {
                    daysToAdd += 7; // Next week
                }

                targetDay.setDate(today.getDate() + daysToAdd);
                return targetDay.toISOString().split('T')[0];
            }
        }

        // Default to tomorrow if no specific date found
        const defaultDate = new Date(today);
        defaultDate.setDate(today.getDate() + 1);
        return defaultDate.toISOString().split('T')[0];
    }

    /**
     * Calculate confidence score based on commitment indicators
     */
    private calculateConfidence(message: string, hasCommitmentWord: boolean, hasTimeIndicator: boolean): number {
        let confidence = 0.5; // Base confidence

        if (hasCommitmentWord) confidence += 0.3;
        if (hasTimeIndicator) confidence += 0.2;

        // Boost confidence for specific strong indicators
        const strongIndicators = ['will', 'promise', 'commit', 'scheduled', 'appointment'];
        if (strongIndicators.some(word => message.toLowerCase().includes(word))) {
            confidence += 0.2;
        }

        return Math.min(confidence, 1.0);
    }

    /**
     * Truncate text at sentence boundary to avoid cutting words
     * @param text - The text to truncate
     * @param maxLength - Maximum length
     * @returns Truncated text
     */
    private truncateAtSentenceBoundary(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }

        // Find the last sentence boundary within the limit
        const truncated = text.substring(0, maxLength);
        const lastPeriod = truncated.lastIndexOf('.');
        const lastExclamation = truncated.lastIndexOf('!');
        const lastQuestion = truncated.lastIndexOf('?');

        const lastSentenceBoundary = Math.max(lastPeriod, lastExclamation, lastQuestion);

        if (lastSentenceBoundary > maxLength * 0.6) { // Only use if not too short
            return truncated.substring(0, lastSentenceBoundary + 1);
        }

        // Fallback: return the truncated text if no sentence boundary found
        return truncated;
    }
}

/**
 * Factory function to create LLM provider based on configuration
 */
export function createLLMProvider(_config?: LLMConfig): LLMProvider {
    return new GenkitLLMProvider();
}
