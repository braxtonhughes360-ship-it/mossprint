import type { AppRouteId } from './types'

export type ModuleTexture = 'grid' | 'rules' | 'organic' | 'scan' | 'quiet'

/** Visual identity for module destinations — design metadata only, no fake data. */
export interface ModuleVisual {
  tag: string
  lane: string
  descriptor: string
  texture: ModuleTexture
  watermark: string
}

export const MODULE_VISUAL: Record<
  Exclude<AppRouteId, 'dashboard' | 'settings'>,
  ModuleVisual
> = {
  calendar: {
    tag: 'Schedule',
    lane: 'Time',
    descriptor: 'Structure · sequence · precision',
    texture: 'grid',
    watermark: ''
  },
  money: {
    tag: 'Budget',
    lane: 'Ledger',
    descriptor: 'Position · flow · confidence',
    texture: 'quiet',
    watermark: ''
  },
  nutrition: {
    tag: 'Intake',
    lane: 'Measure',
    descriptor: 'Cycles · intake · balance',
    texture: 'organic',
    watermark: ''
  },
  inbox: {
    tag: 'Mail',
    lane: 'Flow',
    descriptor: 'Triage · quiet · present',
    texture: 'quiet',
    watermark: '—'
  },
  notes: {
    tag: 'Capture',
    lane: 'Lists',
    descriptor: 'Quick · folders · checklists',
    texture: 'rules',
    watermark: ''
  }
}
