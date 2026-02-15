#!/usr/bin/env npx tsx
/**
 * propose-action.ts
 *
 * Emit an action proposal for user review and approval.
 * The server intercepts this output and sends an ActionInstance to the frontend.
 *
 * Params JSON is read from stdin to avoid shell escaping issues with
 * Unicode text (Telugu, Hindi, etc.), nested quotes, and special characters.
 *
 * Usage:
 *   echo '{"prompt": "...", "language": "Telugu"}' | \
 *     npx tsx propose-action.ts \
 *       --templateId generate_ad \
 *       --label "Telugu Diwali Ad"
 */

import { randomUUID } from "crypto";
import { parseArgs } from "util";

// Valid template IDs
const VALID_TEMPLATES = [
  "generate_ad",
  "generate_video_ad",
];

function parseArguments() {
  const { values } = parseArgs({
    options: {
      templateId: { type: "string", short: "t" },
      label: { type: "string", short: "l" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
propose-action.ts - Propose an action for user approval

Usage:
  echo '<json_params>' | npx tsx propose-action.ts [options]

Options:
  -t, --templateId  Action template ID (required)
  -l, --label       Human-readable action description (required)
  -h, --help        Show this help message

Params JSON is piped via stdin (avoids shell escaping issues with Unicode text).

Valid templateIds:
  ${VALID_TEMPLATES.join(", ")}

Example:
  echo '{"prompt": "A professional Diwali sale...", "language": "Telugu", "aspectRatio": "1:1"}' | \\
    npx tsx propose-action.ts \\
      --templateId generate_ad \\
      --label "Telugu Diwali Ad - Jewelry Offer"
`);
    process.exit(0);
  }

  if (!values.templateId) {
    console.error("Error: --templateId is required");
    process.exit(1);
  }

  if (!VALID_TEMPLATES.includes(values.templateId)) {
    console.error(`Error: Invalid templateId "${values.templateId}"`);
    console.error(`Valid options: ${VALID_TEMPLATES.join(", ")}`);
    process.exit(1);
  }

  if (!values.label) {
    console.error("Error: --label is required");
    process.exit(1);
  }

  return {
    templateId: values.templateId,
    label: values.label,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
  const args = parseArguments();

  // Read params JSON from stdin (shell-safe for Unicode + nested quotes)
  const rawInput = await readStdin();
  const trimmed = rawInput.trim();

  if (!trimmed) {
    console.error("Error: params JSON must be piped via stdin");
    console.error('Example: echo \'{"prompt": "..."}\' | npx tsx propose-action.ts --templateId generate_ad --label "Ad"');
    process.exit(1);
  }

  let params: Record<string, unknown>;
  try {
    params = JSON.parse(trimmed);
  } catch {
    console.error("Error: stdin must contain valid JSON");
    console.error(`Received (first 200 chars): ${trimmed.substring(0, 200)}`);
    process.exit(1);
  }

  // Generate unique instance ID
  const instanceId = `action_${randomUUID()}`;

  // Emit action proposal JSON
  // The server's PostToolUse hook will intercept this and send to frontend
  const proposal = {
    type: "action_proposal",
    instanceId,
    templateId: args.templateId,
    label: args.label,
    params,
    timestamp: new Date().toISOString(),
  };

  // Output as JSON line (server parses this from stdout)
  console.log(JSON.stringify(proposal));

  // Also log human-readable confirmation to stderr
  console.error(`Action proposed: ${args.label}`);
  console.error(`   Template: ${args.templateId}`);
  console.error(`   Instance: ${instanceId}`);
}

main();
