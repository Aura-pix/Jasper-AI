/**
 * This agent's config anchor: identity-level choices the builder makes.
 * Builder-editable. `modelId` is required — there is no platform fallback;
 * the remaining fields are optional. Platform code reads this ONLY through
 * `bl/config-bridge.ts` (the sanctioned seam — see `zone-boundary.test.ts`).
 */
export interface AgentVoiceConfig {
  /** 'realtime' enables the voice gateway; 'v0' keeps record-and-transcribe. */
  engine: 'realtime' | 'v0';
  /** Browser voice defaults to gpt-live-1; phone uses its channel default.
   * An explicit model applies to both channels. Live currently supports browser
   * audio only. Leave this unset when the same agent also answers phone calls.
   */
  model?: string;
  /** Monthly cap in realtime minutes; sessions refuse politely past it. */
  monthlyMinutesCap?: number;
}

export interface AgentConfig {
  modelId: string;
  /** Optional reasoning level for a model route that supports it. */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Optional answer detail for supported models. */
  verbosity?: 'low' | 'medium' | 'high';
  /** Optional processing tier; Mantle Astra supports standard and ultrafast. */
  processingTier?: 'standard' | 'fast' | 'ultrafast';
  localization: {
    /** Language used by FormatJS descriptor default messages. */
    sourceLocale: string;
  };
  voice?: AgentVoiceConfig;
}

export const AGENT_CONFIG: AgentConfig = {
  modelId: 'gpt-6-luna',
  reasoningEffort: 'low',
  processingTier: 'fast',
  localization: { sourceLocale: 'en' },
  voice: { engine: 'realtime' },
};
