import { ActionConfig, LovelaceCard, LovelaceCardConfig, LovelaceCardEditor } from 'custom-card-helpers';

declare global {
  interface HTMLElementTagNameMap {
    'apsley-scheduler-card-editor': LovelaceCardEditor;
    'hui-error-card': LovelaceCard;
  }
}

export interface TimeSlot {
  start: number;
  end: number;
  on: boolean;
  value: number;
  disabled?: boolean;
}

export interface ApsleyDay {
  dayName: string;
  timeSlots: TimeSlot[];
}

export interface ApsleyCardConfig extends LovelaceCardConfig {
  type: string;
  name?: string;
  entity?: string;
  days?: ApsleyDay[];
  show_warning?: boolean;
  show_error?: boolean;
  test_gui?: boolean;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
  time_step?: number;
  selection_timeout?: number;
  show_line_markers?: boolean;
  show_today_only?: boolean;
}