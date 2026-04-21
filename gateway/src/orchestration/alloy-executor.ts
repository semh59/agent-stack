import { AlloyGatewayClient } from './gateway-client';

/**
 * AlloyExecutor: High-performance autonomous execution.
 * Consolidates the 18-agent pipeline logic into a single alloy execution cycle
 * to minimize LLM overhead and rate-limiting while maintaining project standards.
 */
export class AlloyExecutor {
  private client: AlloyGatewayClient;
  private projectRoot: string;

  constructor(projectRoot: string, client: AlloyGatewayClient) {
    this.projectRoot = projectRoot;
    this.client = client;
  }

  /**
   * Execute a task with absolute alloy autonomy.
   */
  public async execute(userTask: string): Promise<string> {
    console.log(`[Alloy] Initializing consolidated architect-developer-qa cycle...`);

    const systemPrompt = `You are the Alloy Execution Engine of the Alloy v4 project.
Your mission is to fulfill the user's task with absolute autonomy.
You embody the knowledge of all 18 specialists (CEO to DevOps).

STANDARDS:
1. Technology: HTML/Vanilla CSS/Modern JS.
2. Design: Premium, Glassmorphism, Inter font, vibrant gradients.
3. UI: Wow the user at first glance.
4. Files: Create all necessary files (index.html, style.css, app.js).

OUTPUT FORMAT:
Return only the files to be created in the format:
FILE: [Path]
CONTENT:
[Content]
END_FILE

Task: ${userTask}`;

    const response = await (this.client as any).fetch('https://generativelanguage.googleapis.com/v1beta/models/Alloy-claude-opus-4-6-thinking:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          { role: 'user', parts: [{ text: userTask }] }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
        }
      })
    });

    console.log(`[Alloy] API Response Status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown');
      throw new Error(`Alloy API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error(`Alloy Error: No candidates in response. DATA: ${JSON.stringify(data)}`);
    }
    
    return data.candidates[0].content.parts[0].text;
  }
}
