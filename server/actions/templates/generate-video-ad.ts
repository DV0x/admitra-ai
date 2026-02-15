// server/actions/templates/generate-video-ad.ts
// One-file template: config + handler for video ad generation
// Auto-discovered by ActionsManager.loadAllTemplates()

import { mkdirSync } from 'fs';
import path from 'path';
import type { ActionTemplate, ActionHandler, ActionContext, ActionResult } from '../types.js';

export const config: ActionTemplate = {
  id: 'generate_video_ad',
  name: 'Generate Video Ad',
  description: 'Create a video ad from an existing ad image using AI video generation (Kling AI)',
  icon: '🎬',
  stage: 'video',
  parameters: {
    motionPrompt: {
      type: 'text',
      label: 'Motion Prompt',
      description: 'Describe the camera movement and animation',
      required: true,
      multiline: true,
      placeholder: 'Slow zoom into the product with festive particles...',
    },
    language: {
      type: 'enum',
      label: 'Language',
      description: 'Target language for the video ad',
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
    duration: {
      type: 'enum',
      label: 'Duration',
      description: 'Video duration in seconds',
      default: '5',
      options: [
        { value: '5', label: '5 seconds' },
        { value: '10', label: '10 seconds' },
      ],
    },
    negativePrompt: {
      type: 'text',
      label: 'Negative Prompt',
      description: 'What to avoid in generation',
      default: 'blur, distort, low quality, text changing',
      advanced: true,
    },
  },
  script: '.claude/skills/scripts/generate-video.ts',
  outputPattern: 'outputs/ads/video-ad-{language}-{timestamp}.mp4',
};

export const handler: ActionHandler = async (
  params: Record<string, unknown>,
  context: ActionContext
): Promise<ActionResult> => {
  const {
    motionPrompt,
    language = 'Hindi',
    duration = '5',
    negativePrompt = 'blur, distort, low quality, text changing',
  } = params;

  if (!motionPrompt || typeof motionPrompt !== 'string') {
    return {
      success: false,
      error: 'Motion prompt is required',
      errorCode: 'MISSING_PROMPT',
      retryable: false,
    };
  }

  // Get most recent ad image — video ad requires an existing ad
  const ads = context.getAsset('ads');
  if (!ads || ads.length === 0) {
    return {
      success: false,
      error: 'No ad images found. Generate an ad image first.',
      errorCode: 'MISSING_AD_IMAGE',
      retryable: false,
    };
  }

  const sourceImage = ads[ads.length - 1]; // most recent

  // Ensure output directory exists
  const adsDir = path.join(context.cwd, 'outputs', 'ads');
  mkdirSync(adsDir, { recursive: true });

  // Build unique output path: video-ad-{language}-{timestamp}.mp4
  const timestamp = Date.now();
  const outputFilename = `video-ad-${String(language).toLowerCase()}-${timestamp}.mp4`;
  const outputPath = `outputs/ads/${outputFilename}`;

  console.log(`🎬 [VIDEO-AD] Generating video ad:`);
  console.log(`   Source image: ${sourceImage}`);
  console.log(`   Language: ${language}`);
  console.log(`   Duration: ${duration}s`);
  console.log(`   Output: ${outputPath}`);

  const args: string[] = [
    '--prompt', String(motionPrompt),
    '--input', sourceImage,
    '--output', outputPath,
    '--duration', String(duration),
  ];

  if (negativePrompt && typeof negativePrompt === 'string') {
    args.push('--negative-prompt', negativePrompt);
  }

  context.emitProgress('video', 'Starting video ad generation...');

  try {
    const result = await context.runScript(config.script, args);

    if (result.exitCode !== 0) {
      const errorMessage = result.stderr || result.stdout;

      if (errorMessage.includes('KLING')) {
        return {
          success: false,
          error: 'KLING_ACCESS_KEY and KLING_SECRET_KEY environment variables are required',
          errorCode: 'MISSING_API_KEY',
          retryable: false,
        };
      }

      return {
        success: false,
        error: errorMessage || 'Video generation failed',
        errorCode: 'GENERATION_FAILED',
        retryable: true,
      };
    }

    const artifact = result.artifacts?.[0] || outputPath;

    console.log(`🎬 [VIDEO-AD] Generation complete:`);
    console.log(`   Artifact: ${artifact}`);

    context.emitProgress('video', 'Video ad generated successfully', 100);

    return {
      success: true,
      artifact,
      message: `Video ad generated (${language}, ${duration}s)`,
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
