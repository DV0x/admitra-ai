// server/actions/templates/generate-ad.ts
// One-file template: config + handler for ad image generation
// Auto-discovered by ActionsManager.loadAllTemplates()

import { mkdirSync } from 'fs';
import path from 'path';
import type { ActionTemplate, ActionHandler, ActionContext, ActionResult } from '../types.js';

export const config: ActionTemplate = {
  id: 'generate_ad',
  name: 'Generate Ad',
  description: 'Create an ad image using AI image generation (FAL.ai)',
  icon: '🎨',
  stage: 'ad',
  parameters: {
    prompt: {
      type: 'text',
      label: 'Prompt',
      description: 'The full prompt describing the ad creative',
      required: true,
      multiline: true,
      placeholder: 'A vibrant Diwali sale banner for a jewelry shop...',
    },
    language: {
      type: 'enum',
      label: 'Language',
      description: 'Target language for the ad',
      default: 'Hindi',
      options: [
        { value: 'Hindi', label: 'Hindi' },
        { value: 'Tamil', label: 'Tamil' },
        { value: 'Telugu', label: 'Telugu' },
        { value: 'Kannada', label: 'Kannada' },
        { value: 'Malayalam', label: 'Malayalam' },
        { value: 'Bengali', label: 'Bengali' },
        { value: 'Marathi', label: 'Marathi' },
        { value: 'Gujarati', label: 'Gujarati' },
        { value: 'English', label: 'English' },
      ],
    },
    aspectRatio: {
      type: 'enum',
      label: 'Aspect Ratio',
      description: 'Image aspect ratio',
      default: '1:1',
      options: [
        { value: '1:1', label: '1:1 (Square)' },
        { value: '9:16', label: '9:16 (Story/Reel)' },
        { value: '3:4', label: '3:4 (Portrait)' },
        { value: '16:9', label: '16:9 (Landscape)' },
      ],
    },
    resolution: {
      type: 'enum',
      label: 'Resolution',
      description: 'Output image resolution',
      default: '2K',
      options: [
        { value: '1K', label: '1K (Fast)' },
        { value: '2K', label: '2K (Balanced)' },
        { value: '4K', label: '4K (High Quality)' },
      ],
    },
    shopName: {
      type: 'text',
      label: 'Shop Name',
      description: 'Business name (baked into prompt by Claude)',
      placeholder: 'e.g. Lakshmi Jewellers',
      advanced: true,
    },
    festival: {
      type: 'text',
      label: 'Festival',
      description: 'Festival context (baked into prompt by Claude)',
      placeholder: 'e.g. Diwali, Pongal, Eid',
      advanced: true,
    },
    useReferenceImages: {
      type: 'boolean',
      label: 'Use Reference Images',
      description: 'Include uploaded reference images in generation',
      default: true,
    },
  },
  script: '.claude/skills/scripts/generate-image.ts',
  outputPattern: 'outputs/ads/ad-{language}-{timestamp}.png',
};

export const handler: ActionHandler = async (
  params: Record<string, unknown>,
  context: ActionContext
): Promise<ActionResult> => {
  const {
    prompt,
    language = 'Hindi',
    aspectRatio = '1:1',
    resolution = '2K',
    useReferenceImages = true,
  } = params;

  if (!prompt || typeof prompt !== 'string') {
    return {
      success: false,
      error: 'Prompt is required',
      errorCode: 'MISSING_PROMPT',
      retryable: false,
    };
  }

  // Ensure output directory exists (use session output dir, not agent cwd)
  const adsDir = path.join(context.outputDir, 'ads');
  mkdirSync(adsDir, { recursive: true });

  // Build unique output path (absolute — so video gen and asset storage work reliably)
  const timestamp = Date.now();
  const outputFilename = `ad-${String(language).toLowerCase()}-${timestamp}.png`;
  const outputPath = path.join(adsDir, outputFilename);

  console.log(`🎨 [AD] Generating ad image:`);
  console.log(`   Language: ${language}`);
  console.log(`   Output: ${outputPath}`);
  console.log(`   Reference images: ${context.referenceImages.length}`);

  const args: string[] = [
    '--prompt', String(prompt),
    '--output', outputPath,
    '--aspect-ratio', String(aspectRatio),
    '--resolution', String(resolution),
  ];

  // Add reference images if enabled and available
  if (useReferenceImages && context.referenceImages.length > 0) {
    for (const imagePath of context.referenceImages) {
      args.push('--input', imagePath);
    }
  }

  context.emitProgress('ad', 'Starting ad image generation...');

  try {
    const result = await context.runScript(config.script, args);

    if (result.exitCode !== 0) {
      const errorMessage = result.stderr || result.stdout;

      if (errorMessage.includes('FAL_KEY')) {
        return {
          success: false,
          error: 'FAL_KEY environment variable is not set',
          errorCode: 'MISSING_API_KEY',
          retryable: false,
        };
      }

      return {
        success: false,
        error: errorMessage || 'Image generation failed',
        errorCode: 'GENERATION_FAILED',
        retryable: true,
      };
    }

    const artifact = result.artifacts?.[0] || outputPath;

    console.log(`🎨 [AD] Generation complete:`);
    console.log(`   Artifact: ${artifact}`);

    context.emitProgress('ad', 'Ad image generated successfully', 100);

    return {
      success: true,
      artifact,
      message: `Ad image generated (${language})`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: 'EXECUTION_ERROR',
      retryable: true,
    };
  }
};
