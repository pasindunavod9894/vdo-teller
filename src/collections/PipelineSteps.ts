import type { CollectionConfig } from 'payload'
import { ownerOnly } from './access'

export const PipelineSteps: CollectionConfig = {
  slug: 'pipeline-steps',
  admin: { useAsTitle: 'agent' },
  // Written by the worker with overrideAccess; users can only read their own.
  access: { create: () => false, read: ownerOnly, update: () => false, delete: () => false },
  fields: [
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true },
    { name: 'episode', type: 'relationship', relationTo: 'episodes', required: true },
    { name: 'agent', type: 'text', required: true },
    { name: 'stepKey', type: 'text', required: true },
    { name: 'label', type: 'text' },
    { name: 'order', type: 'number', required: true },
    { name: 'status', type: 'select', options: ['pending', 'running', 'done', 'failed'], defaultValue: 'pending', required: true },
    { name: 'startedAt', type: 'date' },
    { name: 'endedAt', type: 'date' },
    { name: 'summary', type: 'textarea' },
    { name: 'inputHash', type: 'text' },
    { name: 'model', type: 'text' },
    { name: 'inputTokens', type: 'number' },
    { name: 'cachedTokens', type: 'number' },
    { name: 'outputTokens', type: 'number' },
    { name: 'reasoningTokens', type: 'number' },
    { name: 'imageCount', type: 'number' },
    { name: 'videoSeconds', type: 'number' },
    { name: 'costUsd', type: 'number' },
  ],
}
