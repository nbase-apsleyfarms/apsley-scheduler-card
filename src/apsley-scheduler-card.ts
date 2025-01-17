import { LitElement, html, css, PropertyValues, TemplateResult, CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  HomeAssistant,
  hasConfigOrEntityChanged,
  hasAction,
  ActionHandlerEvent,
  handleAction,
  LovelaceCardEditor,
  getLovelace,
} from 'custom-card-helpers';

import type { ApsleyCardConfig } from './types';
import { actionHandler } from './action-handler-directive';
import { CARD_VERSION } from './const';
import { localize } from './localize/localize';
import './dual-slider';


interface TimeSlot {
  start: number; // hour, 0..24
  end: number;   // hour, 0..24
  on: boolean;   // is this segment ON or OFF
}

@customElement('apsley-scheduler-card')
export class SchedulerCard extends LitElement {
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import('./editor');
    return document.createElement('apsley-scheduler-card-editor');
  }

  public static getStubConfig(): Record<string, unknown> {
    return {};
  }

  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private config!: ApsleyCardConfig;
  @state() private _draggingTrackIndex: number | null = null;
  @state() private _isDragging: boolean = false;
  private _startDragOffset: number = 0;
  private _draggingTrackInitialStart = 0;
  private _draggingTrackInitialEnd = 0;
  private _draggingTrackPointerFrac = 0;

  // Track multiple time segments. For each segment, we show a colored bar with boundary lines.
  @state() private _mondayTimeSlots: TimeSlot[] = [
    { start: 8, end: 19, on: true }, // default 8 AM - 7 PM, "on"
  ];

  // For drag-and-drop
  private _dragSlotIndex: number | null = null;    // which timeslot is being dragged
  private _dragBoundary: 'start' | 'end' | null = null; // are we dragging the start or end boundary?

  public setConfig(config: ApsleyCardConfig): void {
    if (!config) {
      throw new Error(localize('common.invalid_configuration'));
    }
    if (config.test_gui) {
      getLovelace().setEditMode(true);
    }
    this.config = {
      name: 'Scheduler',
      ...config,
    };
  }

  // protected shouldUpdate(changedProps: PropertyValues): boolean {
  //   if (!this.config) {
  //     return false;
  //   }
  //   return hasConfigOrEntityChanged(this, changedProps, false);
  // }  
  

  // Toggle the ON/OFF state of a clicked timeslot
  private _toggleTimeslot(e: Event, index: number) {
    e.stopPropagation();
  
    // Do not toggle if dragging is happening
    if (this._isDragging) {
      return;
    }
  
    this._mondayTimeSlots = this._mondayTimeSlots.map((slot, i) =>
      i === index ? { ...slot, on: !slot.on } : slot
    );
  }

  /**
   * Create a new timeslot from 8 AM to 9 AM (or any desired default).
   * 
   * Alternatively, you could create it after the last timeslot’s end, etc.
   */
  private _addTimeslot() {
    this._mondayTimeSlots = [
      ...this._mondayTimeSlots,
      { start: 8, end: 9, on: true },
    ];
  }

  /**
   * Remove the last timeslot in the array (if there is more than one).
   */
  private _removeTimeslot() {
    if (this._mondayTimeSlots.length > 1) {
      this._mondayTimeSlots = this._mondayTimeSlots.slice(0, -1);
    }
  }

  private _onTrackPointerDown(e: PointerEvent, slotIndex: number) {
    e.stopPropagation();
  
    const trackRect = this.renderRoot.querySelector('.track')?.getBoundingClientRect();
    if (!trackRect) return;
  
    const timeslot = this._mondayTimeSlots[slotIndex];
    if (!timeslot) return;
  
    // The original edges of the timeslot (in hours)
    this._draggingTrackInitialStart = timeslot.start;
    this._draggingTrackInitialEnd = timeslot.end;
    const duration = timeslot.end - timeslot.start;
  
    // Calculate the pointer’s hour
    const pointerPx = e.clientX - trackRect.left; // how far from the left edge of the track in pixels
    const pointerHour = (pointerPx / trackRect.width) * 24;
  
    // Fraction: how far into the slot did we click? (0 = left boundary, 1 = right boundary)
    // e.g. if pointerHour is halfway between slot.start & slot.end, fraction = ~0.5
    this._draggingTrackPointerFrac =
      (pointerHour - timeslot.start) / duration;
  
    // Constrain fraction to [0,1] in edge cases
    this._draggingTrackPointerFrac = Math.max(0, Math.min(1, this._draggingTrackPointerFrac));
  
    // Mark that we're dragging
    this._isDragging = true;
    this._draggingTrackIndex = slotIndex;
  
    // Capture the pointer
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
  
    console.log(
      `PointerDown track slot=${slotIndex}, start=${timeslot.start}, end=${timeslot.end}, ` +
      `pointerHour=${pointerHour.toFixed(2)}, fraction=${this._draggingTrackPointerFrac.toFixed(2)}`
    );
  }
  
  
  

  private _onTrackPointerMove(e: PointerEvent) {
    if (this._draggingTrackIndex == null) return;
  
    const trackRect = this.renderRoot.querySelector('.track')?.getBoundingClientRect();
    if (!trackRect) return;
  
    // Original slot boundaries
    const originalStart = this._draggingTrackInitialStart;
    const originalEnd = this._draggingTrackInitialEnd;
    const duration = originalEnd - originalStart;
  
    // Current pointer hour
    const pointerPx = e.clientX - trackRect.left;
    const pointerHour = (pointerPx / trackRect.width) * 24;
  
    // The anchor hour is where we “picked up” the slot from, measured from the left boundary
    // anchorHour = originalStart + fraction * duration
    const anchorHour = originalStart + this._draggingTrackPointerFrac * duration;
  
    // hoursDelta is how far the pointer is from that anchor
    let rawHoursDelta = pointerHour - anchorHour;
  
    // Snap to whole hours (or half-hours, etc.):
    rawHoursDelta = Math.round(rawHoursDelta);
  
    // Compute new start/end
    let newStart = originalStart + rawHoursDelta;
    let newEnd = newStart + duration;
  
    // Clamp within [0,24]
    if (newStart < 0) {
      newStart = 0;
      newEnd = duration; // maintain timeslot length
    } else if (newEnd > 24) {
      newEnd = 24;
      newStart = 24 - duration;
    }
  
    // In case the clamp inverts them, skip that update
    if (newEnd < newStart) return;
  
    console.log(
      `Dragging track #${this._draggingTrackIndex}: rawDelta=${rawHoursDelta.toFixed(2)}, ` +
      `anchorHour=${anchorHour.toFixed(2)}, pointerHour=${pointerHour.toFixed(2)}, ` +
      `newStart=${newStart}, newEnd=${newEnd}`
    );
  
    // Update just the slot being dragged
    this._mondayTimeSlots = this._mondayTimeSlots.map((slot, i) => {
      if (i !== this._draggingTrackIndex) return slot;
      return { ...slot, start: newStart, end: newEnd };
    });
  
    this.requestUpdate();
  }
  
  
  
  
  private _onTrackPointerUp(e: PointerEvent) {
    if (this._draggingTrackIndex != null) {
      const target = e.currentTarget as HTMLElement;
      target.releasePointerCapture(e.pointerId);
      console.log(`PointerUp track #${this._draggingTrackIndex}`);
    }
  
    // Reset
    this._isDragging = false;
    this._draggingTrackIndex = null;
    this._draggingTrackInitialStart = 0;
    this._draggingTrackInitialEnd = 0;
    this._draggingTrackPointerFrac = 0;
  }
  
  



  private _onPointerMove(e: PointerEvent, slotIndex: number, boundary: 'start' | 'end') {
    if (this._dragSlotIndex == null || this._dragBoundary == null) {
      return; // not dragging anything
    }
  
    const trackRect = this.renderRoot.querySelector('.track')?.getBoundingClientRect();
    if (!trackRect) return;
  
    // Calculate relative position of pointer inside the track container
    const relativeX = e.clientX - trackRect.left;
    const pct = relativeX / trackRect.width; 
    let hour = Math.round(pct * 24);
    if (hour < 0) hour = 0;
    if (hour > 24) hour = 24;
  
    console.log(`${boundary} Pointer move: dragging ${this._dragBoundary} boundary at hour ${hour} for ${slotIndex}`);
  
    // Update the slot start or end based on which boundary is being dragged
    this._mondayTimeSlots = this._mondayTimeSlots.map((slot, i) => {
      if (i !== this._dragSlotIndex) return slot;
  
      // Update based on dragged boundary
      if (this._dragBoundary === 'start') {
        const newStart = Math.min(hour, slot.end); // Ensure it doesn't cross the end boundary
        return { ...slot, start: newStart };
      } else {
        const newEnd = Math.max(hour, slot.start); // Ensure it doesn't cross the start boundary
        return { ...slot, end: newEnd };
      }
    });
  
    // Force LitElement to re-render after state changes
    this.requestUpdate();
  }
  
  private _onPointerDown(e: PointerEvent, slotIndex: number, boundary: 'start' | 'end') {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
  
    // Start dragging
    this._isDragging = true;
  
    // Set pointer capture
    target.setPointerCapture(e.pointerId);
  
    console.log(`Pointer down at slot ${slotIndex}, boundary ${boundary}`);
    
    this._dragSlotIndex = slotIndex;
    this._dragBoundary = boundary;
  }
  
  private _onPointerUp(e: PointerEvent, slotIndex: number, boundary: 'start' | 'end') {
    if (this._dragSlotIndex != null) {
      // Release pointer capture
      const target = e.currentTarget as HTMLElement;
      target.releasePointerCapture(e.pointerId);
      console.log(`${boundary} Pointer up at slot ${this._dragSlotIndex} for ${slotIndex}`);
    }
  
    // Stop dragging
    this._isDragging = false;
  
    this._dragSlotIndex = null;
    this._dragBoundary = null;
  }

  private _handleAction(ev: ActionHandlerEvent): void {
    if (this.hass && this.config && ev.detail.action) {
      handleAction(this, this.hass, this.config, ev.detail.action);
    }
  }

  private _showWarning(warning: string): TemplateResult {
    return html`<hui-warning>${warning}</hui-warning>`;
  }

  private _showError(error: string): TemplateResult {
    const errorCard = document.createElement('hui-error-card');
    errorCard.setConfig({
      type: 'error',
      error,
      origConfig: this.config,
    });
    return html`${errorCard}`;
  }
  
  protected render(): TemplateResult {
    return html`
      <ha-card
        .header=${this.config.name}
        @action=${this._handleAction}
        .actionHandler=${actionHandler({
          hasHold: hasAction(this.config.hold_action),
          hasDoubleClick: hasAction(this.config.double_tap_action),
        })}
        tabindex="0"
        .label=${`Scheduler: ${this.config.entity || 'No Entity Defined'}`}
      >
        <div class="schedule-container">
          <!-- Monday Schedule -->
          <div class="day-label">Monday</div>
          <div class="track">
            ${this._mondayTimeSlots.map((slot, index) => {
              const left = (slot.start / 24) * 100;
              const width = ((slot.end - slot.start) / 24) * 100;
              return html`
                <div 
                  class="timeslot ${slot.on ? 'on' : 'off'}"
                  style="left: ${left}%; width: ${width}%;"
                  @click=${(e: Event) => this._toggleTimeslot(e, index)}
                  @pointerdown=${(e: PointerEvent) => this._onTrackPointerDown(e, index)}
                  @pointermove=${this._onTrackPointerMove}
                  @pointerup=${this._onTrackPointerUp}
                  @pointercancel=${this._onTrackPointerUp}
                  @pointerleave=${this._onTrackPointerUp}>
                </div>
                <div 
                  class="boundary"
                  style="left: ${left}%;"
                  @pointerdown=${(e: PointerEvent) => this._onPointerDown(e, index, 'start')}
                  @pointerup=${(e: PointerEvent) => this._onPointerUp(e, index, 'start')}
                  @pointermove=${(e: PointerEvent) => this._onPointerMove(e, index, 'start')}
                  @pointercancel=${(e: PointerEvent) => this._onPointerUp(e, index, 'start')}
                  @pointerleave=${(e: PointerEvent) => this._onPointerUp(e, index, 'start')}>
                </div>
                <div 
                  class="boundary"
                  style="left: ${left + width}%;"
                  @pointerdown=${(e: PointerEvent) => this._onPointerDown(e, index, 'end')}
                  @pointerup=${(e: PointerEvent) => this._onPointerUp(e, index, 'end')}
                  @pointermove=${(e: PointerEvent) => this._onPointerMove(e, index, 'end')}
                  @pointercancel=${(e: PointerEvent) => this._onPointerUp(e, index, 'end')}
                  @pointerleave=${(e: PointerEvent) => this._onPointerUp(e, index, 'end')}>
                </div>
              `;
            })}
          </div>
  
          <!-- Hour markers -->
          <div class="hour-axis">
            ${[...Array(25).keys()].map((hour) => {
              const left = (hour / 24) * 100;
              return html`
                <div
                  class="hour-marker"
                  style="left: ${left}%"
                >
                  ${hour}
                </div>
              `;
            })}
          </div>
  
          <!-- + and - to add or remove timeslots -->
          <div class="buttons">
            <mwc-button outlined @click=${this._addTimeslot}>+</mwc-button>
            <mwc-button outlined @click=${this._removeTimeslot}>-</mwc-button>
          </div>
          
        </div>
      </ha-card>
    `;
  }

  static get styles(): CSSResultGroup {
    return css`
      ha-card {
        padding: 16px;
      }
      .schedule-container {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .day-label {
        font-weight: bold;
        margin-bottom: 0.25rem;
      }

      .track {
        position: relative;
        width: 100%;
        height: 50px; /* you can adjust the height */
        background: #333; /* just a dark background behind everything */
        border-radius: 8px;
        cursor: pointer;
        overflow: hidden;
      }

      .timeslot {
        position: absolute;
        top: 0;
        bottom: 0;
        /* “on” segments in pastel blue, “off” in black */
      }
      .timeslot.on {
        background: #63b763;
      }
      .timeslot.off {
        background: #c83838;
      }

      /* The vertical boundary line (green). 
         Give it some clickable width so it's easier to grab. */
      .boundary {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 10px;
        background: grey;
        transform: translateX(-3px); /* center it on the exact boundary line */
        cursor: col-resize;
      }

      /* Hour markers (below the track) */
      .hour-axis {
        position: relative;
        width: 100%;
        height: 20px;
      }
      .hour-marker {
        position: absolute;
        top: 0;
        transform: translateX(-50%);
        font-size: 0.7rem;
        color: var(--secondary-text-color);
      }

      .buttons {
        margin-top: 0.5rem;
      }
    `;
  }
}
