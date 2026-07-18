import type { ProviderId } from './providers'
import type { RunningHubWorkflowCapability } from './workflows/runninghub'

export type GenerationMode = 'text-to-image' | 'image-to-image' | 'image-to-video'

export function resolveGenerationMode(
  providerId: ProviderId,
  hasReferenceImage: boolean,
  workflowCapability?: RunningHubWorkflowCapability,
  modeOverride?: GenerationMode,
): GenerationMode {
  if (modeOverride) return modeOverride
  if (providerId === 'runninghub') return workflowCapability ?? 'text-to-image'
  return hasReferenceImage ? 'image-to-image' : 'text-to-image'
}
