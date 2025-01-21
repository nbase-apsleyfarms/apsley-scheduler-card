import { LitElement, html, css, TemplateResult, CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';

/** Basic interface for a time slot. */
interface TimeSlot {
  start: number;
  end: number;
  on: boolean;
  value: number;
}

/** Config interface for your card. */
interface ApsleyCardConfig {
  name?: string;
  days?: {
    dayName: string;
    timeSlots: TimeSlot[];
  }[];
}

@customElement('apsley-scheduler-card')
export class ApsleySchedulerCard extends LitElement {
  private _config?: ApsleyCardConfig;

  @state() private _days: { dayName: string; timeSlots: TimeSlot[] }[] = [];
  @state() private _selectedDayIndex: number | null = null;
  @state() private _selectedSlotIndex: number | null = null;

  /** For dragging entire slots */
  private _draggingTrackDayIndex: number | null = null;
  private _draggingTrackSlotIndex: number | null = null;
  private _draggingTrackInitialStart = 0;
  private _draggingTrackInitialEnd = 0;
  private _draggingTrackPointerFrac = 0;

  /** For dragging boundaries */
  private _draggingBoundaryDayIndex: number | null = null;
  private _draggingBoundarySlotIndex: number | null = null;
  private _dragBoundary: 'start' | 'end' | null = null;
  private _dragBoundaryOriginalHour: number | null = null;
  private _focusTimeout: number | null = null; // Timeout ID for clearing focus
  /** If the user is actively dragging something. */
  @state() private _isDragging = false;

  public setConfig(config: ApsleyCardConfig): void {
    const copy = { ...config };
    if (!copy.days || !Array.isArray(copy.days)) {
      copy.days = [
        {
          dayName: 'Monday',
          timeSlots: [{ start: 8, end: 12, on: true, value: 50 }],
        },
        {
          dayName: 'Tuesday',
          timeSlots: [],
        },
        {
          dayName: 'Wednesday',
          timeSlots: [],
        },
        {
          dayName: 'Thursday',
          timeSlots: [],
        },
        {
          dayName: 'Friday',
          timeSlots: [],
        },
      ];
    }
    this._config = copy;
    this._days = copy.days;
  }

  public getCardSize(): number {
    return 6;
  }

  protected render(): TemplateResult {
    if (!this._config) {
      return html`<ha-card>Configuration missing!</ha-card>`;
    }

    return html`
      <ha-card .header=${this._config.name || 'Scheduler'}>
        <div class="days-container">
          ${this._days.map((day, dayIndex) => this._renderDayRow(day, dayIndex))}
        </div>
        ${this._renderOptionsPanel()}
      </ha-card>
    `;
  }

  private _renderDayRow(day: { dayName: string; timeSlots: TimeSlot[] }, dayIndex: number): TemplateResult {
    return html`
      <div class="day-row">
        <div class="day-label">${day.dayName.charAt(0)}</div>
        <div class="track-container">
          <div class="track" @click=${(e: MouseEvent) => this._onTrackClick(e, dayIndex)}>
            ${day.timeSlots.map((slot, slotIndex) => {
              const left = (slot.start / 24) * 100;
              const width = ((slot.end - slot.start) / 24) * 100;
              const isSelected =
                dayIndex === this._selectedDayIndex && slotIndex === this._selectedSlotIndex;
  
              return html`
                <!-- Timeslot background -->
                <div
                  class="timeslot ${slot.on ? 'on' : 'off'} ${isSelected ? 'selected' : ''}"
                  style="left: ${left}%; width: ${width}%;"
                  @click=${(evt: Event) => this._onTimeslotClick(evt, dayIndex, slotIndex)}
                  @pointerdown=${(evt: PointerEvent) => this._onTrackPointerDown(evt, dayIndex, slotIndex)}
                  @pointermove=${this._onTrackPointerMove}
                  @pointerup=${this._onTrackPointerUp}
                  @pointercancel=${this._onTrackPointerUp}
                  @pointerleave=${this._onTrackPointerUp}
                >
                  <div class="value-badge">
                    ${slot.on ? slot.value : 'Off'}
                  </div>
                </div>
  
                <!-- Left boundary -->
                <div
                  class="boundary ${isSelected ? 'selected-boundary' : ''}"
                  style="left: ${left}%;"
                  @pointerdown=${(evt: PointerEvent) => this._onPointerDownBoundary(evt, dayIndex, slotIndex, 'start')}
                  @pointermove=${(evt: PointerEvent) => this._onPointerMoveBoundary(evt, dayIndex, slotIndex, 'start')}
                  @pointerup=${(evt: PointerEvent) => this._onPointerUpBoundary(evt, dayIndex, slotIndex, 'start')}
                  @pointercancel=${(evt: PointerEvent) => this._onPointerUpBoundary(evt, dayIndex, slotIndex, 'start')}
                  @pointerleave=${(evt: PointerEvent) => this._onPointerUpBoundary(evt, dayIndex, slotIndex, 'start')}
                ></div>
  
                <!-- Right boundary -->
                <div
                  class="boundary ${isSelected ? 'selected-boundary' : ''}"
                  style="left: ${left + width}%;"
                  @pointerdown=${(evt: PointerEvent) => this._onPointerDownBoundary(evt, dayIndex, slotIndex, 'end')}
                  @pointermove=${(evt: PointerEvent) => this._onPointerMoveBoundary(evt, dayIndex, slotIndex, 'end')}
                  @pointerup=${(evt: PointerEvent) => this._onPointerUpBoundary(evt, dayIndex, slotIndex, 'end')}
                  @pointercancel=${(evt: PointerEvent) => this._onPointerUpBoundary(evt, dayIndex, slotIndex, 'end')}
                  @pointerleave=${(evt: PointerEvent) => this._onPointerUpBoundary(evt, dayIndex, slotIndex, 'end')}
                ></div>
              `;
            })}
          </div>
          <div class="hour-axis">
            ${[...Array(25).keys()].map(hour => {
              const left = (hour / 24) * 100;
              return html`
                <div class="hour-marker" style="left: ${left}%;"><span>${hour}</span></div>
              `;
            })}
          </div>
        </div>
      </div>
    `;
  }

  private _renderOptionsPanel(): TemplateResult {
    if (this._selectedDayIndex == null || this._selectedSlotIndex == null) {
      return html``;
    }
    const dayEntry = this._days[this._selectedDayIndex];
    if (!dayEntry) return html``;

    const slot = dayEntry.timeSlots[this._selectedSlotIndex];
    if (!slot) return html``;

    const startLabel = `${slot.start.toString().padStart(2, '0')}:00`;
    const endLabel = `${slot.end.toString().padStart(2, '0')}:00`;

    return html`
      <div class="options-panel">
        <div class="option-row">
          <span class="day-display">${dayEntry.dayName}</span>
          <span class="time-display">${startLabel} - ${endLabel}</span>
        </div>

        <div class="option-row">
          <span>Power:</span>
          <ha-switch
            .checked=${slot.on}
            @click=${() => this._toggleSlotOnOff(this._selectedDayIndex!, this._selectedSlotIndex!)}
          ></ha-switch>
        </div>

        ${slot.on
          ? html`
              <div class="option-row">
                <span>Value:</span>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  .value=${String(slot.value)}
                  @input=${(e: Event) => {
                    const target = e.currentTarget as HTMLInputElement;
                    this._updateSlotValue(this._selectedDayIndex!, this._selectedSlotIndex!, parseInt(target.value, 10));
                  }}
                />
                <span class="value-display">${slot.value}</span>
              </div>
            `
          : null}

        <div class="option-row">
          <mwc-button outlined @click=${() => this._deleteSlot(this._selectedDayIndex!, this._selectedSlotIndex!)}>
            Delete Timeslot
          </mwc-button>
        </div>
      </div>
    `;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // On track click → add new timeslot (only if you click empty track)
  // ────────────────────────────────────────────────────────────────────────────
  private _clearSelectionAfterDelay(): void {
    // Clear the existing timeout if it's already running
    if (this._focusTimeout !== null) {
      clearTimeout(this._focusTimeout);
    }
  
    // Set a new timeout to clear the selection after 5 seconds
    this._focusTimeout = window.setTimeout(() => {
      this._selectedDayIndex = null;
      this._selectedSlotIndex = null;
      this._focusTimeout = null; // Clear the timeout reference
    }, 2500); // 5 seconds
  }
  
  // Update selection and reset focus timeout
  private _selectTimeslot(dayIndex: number, slotIndex: number): void {
    this._selectedDayIndex = dayIndex;
    this._selectedSlotIndex = slotIndex;
    // Now just reset the focus timer
    this._resetFocusTimeout();
  }
  private _resetFocusTimeout(): void {
    // Clear any existing timer
    if (this._focusTimeout !== null) {
      clearTimeout(this._focusTimeout);
    }
  
    // Restart the timer
    this._focusTimeout = window.setTimeout(() => {
      this._selectedDayIndex = null;
      this._selectedSlotIndex = null;
      this._focusTimeout = null;
    }, 2500); // or however many ms you prefer
  }
  
  // Update the `_onTrackClick` method to select the newly created timeslot
  private _onTrackClick(e: MouseEvent, dayIndex: number): void {
    if (e.target !== e.currentTarget) return;
  
    const trackRect = (this.renderRoot.querySelectorAll('.track')[dayIndex] as HTMLElement)?.getBoundingClientRect();
    if (!trackRect) return;
  
    const clickX = e.clientX - trackRect.left;
    const hour = Math.floor((clickX / trackRect.width) * 24);
  
    const day = this._days[dayIndex];
    const newSlots = [...day.timeSlots];
  
    let newStart = hour;
    let newEnd = hour + 2;
    if (newEnd > 24) {
      newEnd = 24;
      newStart = 22;
    }
  
    const overlaps = newSlots.some((s) => newStart < s.end && s.start < newEnd);
    if (!overlaps) {
      newSlots.push({ start: newStart, end: newEnd, on: true, value: 50 });
      this._days = this._days.map((d, i) =>
        i === dayIndex ? { ...d, timeSlots: newSlots } : d
      );
  
      // Automatically select the newly created timeslot
      this._selectTimeslot(dayIndex, newSlots.length - 1);
    }
  }
  
  // Optional: Clear focus timeout when the component is disconnected
  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._focusTimeout !== null) {
      clearTimeout(this._focusTimeout);
    }
  }
  
  // Example of updating the `_onTimeslotClick` method
  private _onTimeslotClick(e: Event, dayIndex: number, slotIndex: number): void {
    e.stopPropagation();
    this._selectTimeslot(dayIndex, slotIndex);
    this._selectedDayIndex = dayIndex;
    this._selectedSlotIndex = slotIndex;
  }

  private _toggleSlotOnOff(dayIndex: number, slotIndex: number) {
    // Only reset if we're toggling the currently selected slot
    if (this._selectedDayIndex === dayIndex && this._selectedSlotIndex === slotIndex) {
      this._resetFocusTimeout();
    }
    this._days = this._days.map((day, di) => {
      if (di !== dayIndex) return day;
      const newSlots = day.timeSlots.map((slot, si) => {
        if (si !== slotIndex) return slot;
        return { ...slot, on: !slot.on };
      });
      return { ...day, timeSlots: newSlots };
    });
  }

  private _updateSlotValue(dayIndex: number, slotIndex: number, newValue: number) {
    // Reset if the selected slot is being changed
    if (this._selectedDayIndex === dayIndex && this._selectedSlotIndex === slotIndex) {
      this._resetFocusTimeout();
    }
    this._days = this._days.map((day, di) => {
      if (di !== dayIndex) return day;
      const newSlots = day.timeSlots.map((slot, si) => {
        if (si !== slotIndex) return slot;
        return { ...slot, value: newValue };
      });
      return { ...day, timeSlots: newSlots };
    });
  }

  private _deleteSlot(dayIndex: number, slotIndex: number) {
    this._days = this._days.map((day, di) => {
      if (di !== dayIndex) return day;
      const newSlots = day.timeSlots.filter((_, si) => si !== slotIndex);
      return { ...day, timeSlots: newSlots };
    });

    if (this._selectedDayIndex === dayIndex && this._selectedSlotIndex === slotIndex) {
      this._selectedDayIndex = null;
      this._selectedSlotIndex = null;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Overlap check
  // ────────────────────────────────────────────────────────────────────────────
  private _wouldOverlap(dayIndex: number, slotIndex: number, start: number, end: number): boolean {
    const day = this._days[dayIndex];
    return day.timeSlots.some((slot, idx) => {
      if (idx === slotIndex) return false;
      return start < slot.end && slot.start < end;
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // DRAG LOGIC: Move entire slot
  // ────────────────────────────────────────────────────────────────────────────
  private _onTrackPointerDown(e: PointerEvent, dayIndex: number, slotIndex: number) {
    e.stopPropagation();
    // If not selected, select it (which calls _resetFocusTimeout internally).
    if (this._selectedDayIndex !== dayIndex || this._selectedSlotIndex !== slotIndex) {
      this._selectTimeslot(dayIndex, slotIndex);
    } else {
      // If it’s already selected, just reset the timer now.
      this._resetFocusTimeout();
    }

    // If the slot isn't selected, select it now
    if (this._selectedDayIndex !== dayIndex || this._selectedSlotIndex !== slotIndex) {
      this._selectedDayIndex = dayIndex;
      this._selectedSlotIndex = slotIndex;
    }

    const day = this._days[dayIndex];
    const slot = day.timeSlots[slotIndex];
    if (!slot) return; // safety

    // We now allow drag to proceed, because the slot is effectively selected
    this._draggingTrackDayIndex = dayIndex;
    this._draggingTrackSlotIndex = slotIndex;
    this._draggingTrackInitialStart = slot.start;
    this._draggingTrackInitialEnd = slot.end;

    const duration = slot.end - slot.start;
    const trackRect = (this.renderRoot.querySelectorAll('.track')[dayIndex] as HTMLElement)?.getBoundingClientRect();
    if (!trackRect) return;

    const pointerPx = e.clientX - trackRect.left;
    const pointerHour = (pointerPx / trackRect.width) * 24;
    this._draggingTrackPointerFrac = (pointerHour - slot.start) / duration;
    this._draggingTrackPointerFrac = Math.max(0, Math.min(1, this._draggingTrackPointerFrac));

    this._isDragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  private _onTrackPointerMove(e: PointerEvent) {
    if (this._draggingTrackDayIndex == null || this._draggingTrackSlotIndex == null) return;

    const dayIndex = this._draggingTrackDayIndex;
    const slotIndex = this._draggingTrackSlotIndex;

    const trackRect = (this.renderRoot.querySelectorAll('.track')[dayIndex] as HTMLElement)?.getBoundingClientRect();
    if (!trackRect) return;

    const slot = this._days[dayIndex].timeSlots[slotIndex];
    if (!slot) return;

    const originalStart = this._draggingTrackInitialStart;
    const originalEnd = this._draggingTrackInitialEnd;
    const duration = originalEnd - originalStart;

    const pointerPx = e.clientX - trackRect.left;
    const pointerHour = (pointerPx / trackRect.width) * 24;
    const anchorHour = originalStart + this._draggingTrackPointerFrac * duration;
    let rawDelta = pointerHour - anchorHour;
    rawDelta = Math.round(rawDelta);

    let newStart = originalStart + rawDelta;
    let newEnd = newStart + duration;

    // clamp
    if (newStart < 0) {
      newStart = 0;
      newEnd = duration;
    }
    if (newEnd > 24) {
      newEnd = 24;
      newStart = 24 - duration;
    }

    if (this._wouldOverlap(dayIndex, slotIndex, newStart, newEnd)) return;

    this._days = this._days.map((d, di) => {
      if (di !== dayIndex) return d;
      const newSlots = d.timeSlots.map((s, si) => {
        if (si !== slotIndex) return s;
        return { ...s, start: newStart, end: newEnd };
      });
      return { ...d, timeSlots: newSlots };
    });
  }

  private _onTrackPointerUp(e: PointerEvent) {
    if (this._draggingTrackDayIndex != null && this._draggingTrackSlotIndex != null) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
    this._isDragging = false;
    this._draggingTrackDayIndex = null;
    this._draggingTrackSlotIndex = null;
    this._draggingTrackInitialStart = 0;
    this._draggingTrackInitialEnd = 0;
    this._draggingTrackPointerFrac = 0;
    if (
      this._selectedDayIndex === this._draggingTrackDayIndex && 
      this._selectedSlotIndex === this._draggingTrackSlotIndex
    ) {
      this._resetFocusTimeout();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // DRAG LOGIC: Boundaries (only draggable if slot is already selected)
  // ────────────────────────────────────────────────────────────────────────────
  private _onPointerDownBoundary(e: PointerEvent, dayIndex: number, slotIndex: number, boundary: 'start' | 'end') {
    e.stopPropagation();

    // Only allow boundary dragging if already selected
    if (this._selectedDayIndex !== dayIndex || this._selectedSlotIndex !== slotIndex) {
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const slot = this._days[dayIndex].timeSlots[slotIndex];
    if (!slot) return;

    this._draggingBoundaryDayIndex = dayIndex;
    this._draggingBoundarySlotIndex = slotIndex;
    this._dragBoundary = boundary;
    this._dragBoundaryOriginalHour = boundary === 'start' ? slot.start : slot.end;
    this._resetFocusTimeout();
    this._isDragging = true;
  }

  private _onPointerMoveBoundary(e: PointerEvent, dayIndex: number, slotIndex: number, boundary: 'start' | 'end') {
    this._resetFocusTimeout();
    if (
      this._draggingBoundaryDayIndex == null ||
      this._draggingBoundarySlotIndex == null ||
      this._dragBoundary == null
    ) {
      return;
    }

    // Must match the slot/boundary we started on
    if (
      this._draggingBoundaryDayIndex !== dayIndex ||
      this._draggingBoundarySlotIndex !== slotIndex ||
      this._dragBoundary !== boundary
    ) {
      return;
    }

    const originalHour = this._dragBoundaryOriginalHour;
    if (originalHour == null) return;

    const trackRect = (this.renderRoot.querySelectorAll('.track')[dayIndex] as HTMLElement)?.getBoundingClientRect();
    if (!trackRect) return;

    const pointerPx = e.clientX - trackRect.left;
    let newHour = Math.round((pointerPx / trackRect.width) * 24);
    if (newHour < 0) newHour = 0;
    if (newHour > 24) newHour = 24;

    const slot = this._days[dayIndex].timeSlots[slotIndex];
    if (!slot) return;

    // Update only that boundary
    if (boundary === 'start') {
      if (newHour > slot.end) return;
      if (!this._wouldOverlap(dayIndex, slotIndex, newHour, slot.end)) {
        this._days = this._days.map((d, di) => {
          if (di !== dayIndex) return d;
          const newSlots = d.timeSlots.map((s, si) => {
            if (si !== slotIndex) return s;
            return { ...s, start: newHour };
          });
          return { ...d, timeSlots: newSlots };
        });
      }
    } else {
      // boundary === 'end'
      if (newHour < slot.start) return;
      if (!this._wouldOverlap(dayIndex, slotIndex, slot.start, newHour)) {
        this._days = this._days.map((d, di) => {
          if (di !== dayIndex) return d;
          const newSlots = d.timeSlots.map((s, si) => {
            if (si !== slotIndex) return s;
            return { ...s, end: newHour };
          });
          return { ...d, timeSlots: newSlots };
        });
      }
    }
  }

  private _onPointerUpBoundary(e: PointerEvent, dayIndex: number, slotIndex: number, boundary: 'start' | 'end') {
    this._resetFocusTimeout();
    if (
      this._draggingBoundaryDayIndex === dayIndex &&
      this._draggingBoundarySlotIndex === slotIndex &&
      this._dragBoundary === boundary
    ) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
    this._isDragging = false;
    this._draggingBoundaryDayIndex = null;
    this._draggingBoundarySlotIndex = null;
    this._dragBoundary = null;
    this._dragBoundaryOriginalHour = null;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CSS
  // ────────────────────────────────────────────────────────────────────────────
  static get styles(): CSSResultGroup {
    return css`
      ha-card {
        padding: 0px;
      }

      .days-container {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding:16px;
        padding-top:0;
      }

      .day-row {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
      }
      .day-label {
        width: 7px;
        text-align: right;
        font-weight: bold;
        font-size: 1rem;
        margin-top: 6px;
      }

      .track-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: 0 10px;
        background: #222;
        border-radius: 5px;
      }
      .track {
        position: relative;
        height: 40px;
        background: rgb(68, 68, 68);
        cursor: pointer;
        overflow: visible;
        touch-action: none;
        user-select: none;
      }
      .hour-axis {
        position: relative;
        height: 20px;
        background: #222;
        overflow: visible;
      }
      .hour-marker {
        position: absolute;
        top: 0;
        transform: translateX(-50%);
        font-size: 0.75rem;
        color: #fff;
      }
      .hour-marker span {
        position: relative;
        top: 2px;
      }
      .timeslot {
        position: absolute;
        top: 0;
        bottom: 0;
        transition: filter 0.2s ease;
        touch-action: none;
        user-select: none;
        border-left:solid 1px #ffffff;
        border-right:solid 1px #ffffff;
      }
      .timeslot.on {
        background: #63b763;
      }
      .timeslot.off {
        background: #c83838;
      }
      .timeslot.selected {
        filter: brightness(1.2);
      }

      .value-badge {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: #fff;
        font-weight: bold;
        text-shadow: 0 0 4px rgba(0, 0, 0, 0.7);
        pointer-events: none;
      }
      .boundary {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 10px;
        background: #ffffff;
        transform: translateX(-3px);
        cursor: col-resize;
        z-index: 1;
        touch-action: none;
        user-select: none;
        
        /* Hide boundaries by default */
        display: none;
      }
      .boundary.selected-boundary {
        /* Show them only if we have the "selected-boundary" class */
        display: block;
      }
      
      /* Keep the higher z-index for selected boundaries */
      .boundary.selected-boundary {
        z-index: 5;
      }

      .options-panel {
        margin-top: 1rem;
        padding: 1rem;
        background-color: var(--card-background-color);
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .option-row {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      .option-row > span {
        font-weight: 500;
      }
      .day-display {
        font-size: 1.1em;
      }
      .time-display {
        font-size: 1em;
      }
      .value-display {
        min-width: 2em;
        text-align: center;
      }
    `;
  }
}
