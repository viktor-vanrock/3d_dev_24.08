// shared/api/generated.ts
// ⚠️ GENERATED — DO NOT EDIT
// TODO: заменить на: pnpm run generate:types

export type PrinterCommand = 'gcode' | 'start' | 'pause' | 'resume' | 'stop' | 'cancel'

export interface PrinterCommandRequest {
  command: PrinterCommand
  script?: string
  file_name?: string
  slice_id?: string
}

export interface SliceJob {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  error?: string | null
  gcode_url?: string
  retryable?: boolean
  error_code?: string
}

export interface PrinterCommandError {
  error: 'LAN_FORBIDDEN' | 'DEVICE_OFFLINE' | 'CAPABILITY_UNSUPPORTED' 
    | 'slice_not_found' | 'slice_not_ready' | 'fingerprint_mismatch'
    // ... остальные по мере необходимости
}