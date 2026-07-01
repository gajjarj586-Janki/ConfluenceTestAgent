/**
 * Claude API Client
 *
 * Unified interface to Claude API using your company's account.
 * Handles all AI operations: code generation, test fixing, DOM analysis, etc.
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
const DEFAULT_MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10);

/**
 * Send a message to Claude and get a response
 * @param {string} message - The message to send
 * @param {object} options - Additional options
 * @param {string} options.model - Model to use (default: claude-3-5-sonnet-20241022)
 * @param {number} options.maxTokens - Max tokens in response (default: 4096)
 * @param {array} options.systemPrompt - System prompt as array of content blocks
 * @param {number} options.temperature - Temperature (0-1, default: 0.7)
 * @returns {Promise<string>} - Claude's response
 */
export async function chat(message, options = {}) {
  const {
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    systemPrompt = null,
    temperature = 0.7,
  } = options;

  const systemPromptArray = systemPrompt
    ? Array.isArray(systemPrompt)
      ? systemPrompt
      : [{ type: 'text', text: systemPrompt }]
    : [];

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPromptArray.length > 0 ? systemPromptArray : undefined,
      messages: [{ role: 'user', content: message }],
      temperature,
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  } catch (error) {
    console.error('Claude API error:', error.message);
    throw error;
  }
}

/**
 * Multi-turn conversation with Claude
 * @param {array} messages - Array of {role, content} messages
 * @param {object} options - Additional options (same as chat)
 * @returns {Promise<string>} - Claude's response
 */
export async function converse(messages, options = {}) {
  const {
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    systemPrompt = null,
    temperature = 0.7,
  } = options;

  const systemPromptArray = systemPrompt
    ? Array.isArray(systemPrompt)
      ? systemPrompt
      : [{ type: 'text', text: systemPrompt }]
    : [];

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPromptArray.length > 0 ? systemPromptArray : undefined,
      messages,
      temperature,
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  } catch (error) {
    console.error('Claude API error:', error.message);
    throw error;
  }
}

/**
 * Generate test step definitions from a feature file
 * @param {string} featureName - Name of the feature file
 * @param {array} steps - Array of step objects with {keyword, text}
 * @param {string} domMap - DOM map from DOM inspector
 * @returns {Promise<string>} - Generated Playwright code
 */
export async function generateStepDefinitions(featureName, steps, domMap) {
  const systemPrompt = `You are a Playwright test automation expert. Generate Playwright step definitions in JavaScript (ES6 module syntax).
Your output should be ONLY valid JavaScript code with NO markdown, NO code fences, NO explanations.
Use the provided DOM map to create accurate selectors. Prefer data-testid or id attributes when available.`;

  const stepsText = steps
    .map((s) => `${s.keyword} ${s.text}`)
    .join('\n');

  const message = `Generate Playwright step definitions for these Cucumber steps from feature "${featureName}":

${stepsText}

Available DOM elements and selectors:
${domMap}

Output: JavaScript code only, no explanations.`;

  return chat(message, { systemPrompt, maxTokens: 8192, temperature: 0 });
}

/**
 * Fix a broken test step
 * @param {string} stepDefinition - The broken step definition code
 * @param {string} errorMessage - The error/failure message
 * @param {string} domMap - Current DOM map from the page
 * @returns {Promise<string>} - Fixed step definition
 */
export async function fixTestStep(stepDefinition, errorMessage, domMap) {
  const systemPrompt = `You are a Playwright test debugging expert. Analyze the failing step definition and fix it.
Output ONLY the corrected JavaScript code, no markdown, no explanations.`;

  const message = `Fix this broken Playwright step definition:

ORIGINAL CODE:
\`\`\`javascript
${stepDefinition}
\`\`\`

ERROR MESSAGE:
${errorMessage}

CURRENT PAGE DOM MAP:
${domMap}

Output the corrected code only.`;

  return chat(message, { systemPrompt, maxTokens: 4096, temperature: 0 });
}

/**
 * Analyze DOM and suggest selectors
 * @param {string} hint - What element to find (e.g., "email input", "submit button")
 * @param {string} domMap - HTML snippet or DOM map
 * @returns {Promise<object>} - Suggested selectors {css, xpath, dataTestId, etc.}
 */
export async function suggestSelectors(hint, domMap) {
  const systemPrompt = `You are a DOM selector expert. Respond with ONLY a valid JSON object with selector suggestions, no explanations.`;

  const message = `For this hint: "${hint}"
Find the best selectors in this DOM:

${domMap}

Respond with JSON: {"css": "...", "xpath": "...", "label": "...", "id": "..."}`;

  try {
    const response = await chat(message, { systemPrompt, maxTokens: 1024, temperature: 0 });
    return JSON.parse(response);
  } catch {
    return {};
  }
}

export default { chat, converse, generateStepDefinitions, fixTestStep, suggestSelectors };
