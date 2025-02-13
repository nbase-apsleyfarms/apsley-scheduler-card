import { LitElement, html, css, TemplateResult, CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
} from 'custom-card-helpers';
import { ApsleyCardConfig, TimeSlot } from './types';
import './editor';
import { fireEvent } from 'custom-card-helpers';

@customElement('apsley-scheduler-card')
export class ApsleySchedulerCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  private _config?: ApsleyCardConfig;

  // Each slot's start/end is stored in "intervals of 10 minutes".
  // 0 = 00:00, 1 = 00:10, ..., 144 = 24:00
  @state() private _days: { dayName: string; timeSlots: TimeSlot[] }[] = [];
  @state() private _selectedDayIndex: number | null = null;
  @state() private _selectedSlotIndex: number | null = null;
  @state() private _isSynced = false;

  // For dragging entire slots
  private _draggingTrackDayIndex: number | null = null;
  private _draggingTrackSlotIndex: number | null = null;
  private _draggingTrackInitialStart = 0; // in intervals
  private _draggingTrackInitialEnd = 0;   // in intervals
  private _draggingTrackPointerFrac = 0;  // fraction along the slot for anchoring

  // For dragging slot boundaries
  private _draggingBoundaryDayIndex: number | null = null;
  private _draggingBoundarySlotIndex: number | null = null;
  private _dragBoundary: 'start' | 'end' | null = null;
  private _dragBoundaryOriginalInterval: number | null = null;

  private _focusTimeout: number | null = null;
  @state() private _isDragging = false;

  private get minutesPerInterval(): number {
    // fallback to 10 if not specified
    return this._config?.time_step ?? 60;
  }
  /**
   * Convert "HH:MM" → number of 10-min intervals.
   * E.g.  "00:00" → 0,  "00:10" → 1,  "09:10" → 9*6 + 1 = 55, ...
   */
  private _parseTimeToIntervals(timeStr: string): number {
    const [hourStr, minuteStr] = timeStr.split(':');
    const hour = parseInt(hourStr, 10) || 0;
    const minute = parseInt(minuteStr, 10) || 0;

    const step = this.minutesPerInterval;         // e.g. 10, 15, 30, or 60
    const intervalsPerHour = 60 / step;           // e.g. 6 (10-min), 4 (15-min), etc.

    return hour * intervalsPerHour + Math.floor(minute / step);
  }
  private get maxIntervals(): number {
    return (24 * 60) / this.minutesPerInterval; 
  }
  /**
   * Convert intervals (0..144) → "HH:MM"
   * E.g.  0 → "00:00",  1 → "00:10",  55 → "09:10"
   */
  private _formatIntervals(intervals: number): string {
    const maxIntervals = this.maxIntervals; // Maximum intervals based on time_step
    const step = this.minutesPerInterval; // Minutes per interval
  
    // Clamp intervals within valid range
    if (intervals < 0) intervals = 0;
    if (intervals > maxIntervals) intervals = maxIntervals;
  
    // Convert intervals to total minutes
    const totalMinutes = intervals * step;
  
    // Calculate hours and minutes
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
  
    // Return formatted time string
    return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
  }

  /**
   * Mapping from e.g. 'mon' to 'Monday'
   */
  private _mapDayCodeToName(code: string): string | null {
    switch (code) {
      case 'mon': return 'Monday';
      case 'tue': return 'Tuesday';
      case 'wed': return 'Wednesday';
      case 'thu': return 'Thursday';
      case 'fri': return 'Friday';
      case 'sat': return 'Saturday';
      case 'sun': return 'Sunday';
      default: return null;
    }
  }

  // Load existing schedules from HA state objects, parse them into 10-min intervals
  private _loadExistingSchedulesFromHA(): void {
    if (!this.hass || !this._config) return;
  
    const targetEntity = this._config.entity;
    if (!targetEntity) return;
  
    const dayNameToSlots: Record<string, TimeSlot[]> = {
      Monday: [],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
      Saturday: [],
      Sunday: [],
    };
  
    // Grab all schedule entities that look like switch.schedule_*
    const scheduleStates = Object.values(this.hass.states).filter((s) =>
      s.entity_id.startsWith('switch.schedule_')
    );
  
    console.log('Found schedule states:', scheduleStates);
  
    for (const stateObj of scheduleStates) {
      const attr = stateObj.attributes as any;
      const weekdays: string[] = attr.weekdays || [];
      // `timeslots` is an array of strings like "HH:MM:SS - HH:MM:SS"
      const timeslotStrs: string[] = attr.timeslots || [];
      // `actions` is a parallel array
      const timeslotActions: Array<{ service: string; data?: any }> = attr.actions || [];
  
      const entities = attr.entities || [];

      // Skip schedules that don't apply to our target entity
      if (!entities.includes(targetEntity)) {
        continue;
      }

      // Skip if it's off or if timeslot count doesn't match action count
      if (stateObj.state !== 'on') {
        continue;
      }
      if (timeslotStrs.length !== timeslotActions.length) {
        console.warn(
          'Timeslot length does not match actions length for',
          stateObj.entity_id
        );
        continue;
      }
  
      for (const dayCode of weekdays) {
        const dayName = this._mapDayCodeToName(dayCode);
        if (!dayName) {
          // skip unknown codes like "daily", "weekend", etc.
          continue;
        }
  
        const localSlots: TimeSlot[] = [];
  
        // Loop through each timeslot, parse the string into start/stop
        for (let i = 0; i < timeslotStrs.length; i++) {
          const slotStr = timeslotStrs[i]; // e.g. "00:00:00 - 09:00:00"
          const action  = timeslotActions[i];
  
          const [startStr, stopStr] = slotStr.split('-').map(s => s.trim());
          if (!startStr || !stopStr) {
            console.warn('Invalid timeslot string:', slotStr);
            continue;
          }
  
          // Convert "HH:MM:SS" to 10-min intervals
          const startIntervals = this._parseTimeToIntervals(startStr);
          const endIntervals   = this._parseTimeToIntervals(stopStr);
  
          if (endIntervals <= startIntervals) {
            // skip invalid or zero-length
            continue;
          }
  
          // Determine on/off + temperature from the action
          let on = false;
          let value = 0;
  
          // e.g. service = "climate.set_hvac_mode" or "climate.set_temperature"
          if (action.service === 'climate.set_hvac_mode') {
            if (action.data?.hvac_mode === 'off') {
              on = false;
              value = 0;
            } else if (action.data?.hvac_mode === 'heat') {
              on = true;
              value = action.data?.temperature ?? 20;
            }
          } else if (action.service === 'climate.set_temperature') {
            on = true;
            value = action.data?.temperature ?? 20;
          }
  
          localSlots.push({
            start: startIntervals,
            end: endIntervals,
            on,
            value,
          });
        }
  
        // Add all these slots to the dayName
        dayNameToSlots[dayName].push(...localSlots);
      }
    }
  
    // Finally, convert dayNameToSlots into the array structure used by your card
    this._days = Object.keys(dayNameToSlots).map((dayName) => ({
      dayName,
      timeSlots: dayNameToSlots[dayName],
    }));
  
    console.log('Loaded schedules:', this._days);
  }
  
  
  

  firstUpdated(_changedProperties: Map<string | number | symbol, unknown>): void {
    super.firstUpdated(_changedProperties);
    this._loadExistingSchedulesFromHA();
  }

  public setConfig(config: ApsleyCardConfig): void {
    const copy = { ...config };
  
    // If days not defined, provide a default
    if (!copy.days || !Array.isArray(copy.days)) {
      copy.days = [
        { dayName: 'Monday', timeSlots: [{ start: 48, end: 72, on: true, value: 20 }] },
        { dayName: 'Tuesday', timeSlots: [] },
        { dayName: 'Wednesday', timeSlots: [] },
        { dayName: 'Thursday', timeSlots: [] },
        { dayName: 'Friday', timeSlots: [] },
        { dayName: 'Saturday', timeSlots: [] },
        { dayName: 'Sunday', timeSlots: [] },
      ];
    }
  
    // Give a default for selection_timeout if not set
    if (copy.selection_timeout == null) {
      copy.selection_timeout = 25000; // 25 seconds
    }

    this._config = copy;
    this._days = copy.days;
  }

  public getCardSize(): number {
    return 6;
  }

  public static getConfigElement(): LovelaceCardEditor {
    return document.createElement('apsley-scheduler-card-editor');
  }

  public static getStubConfig(): Partial<ApsleyCardConfig> {
    return { type: 'custom:apsley-scheduler-card', name: 'Scheduler Card' };
  }

  private async _onSyncClick(): Promise<void> {
    if (!this.hass) return;
  
    try {
      await this._syncSchedules();
      this._isSynced = true;
      console.log('Schedules synced successfully.');
    } catch (err) {
      console.error('Failed to sync schedules:', err);
    } finally {
      setTimeout(() => {
        this._isSynced = false;
      }, 3000);
    }
  }
  private _toggleShowTodayOnly(): void {
    if (!this._config) return;
  
    // Toggle the `show_today_only` option
    this._config = {
      ...this._config,
      show_today_only: !this._config.show_today_only,
    };
  
    // Trigger re-render
    this.requestUpdate();
  
    // Fire a config-changed event to notify the parent of the change
    fireEvent(this, 'config-changed', { config: this._config });
  }
  protected render(): TemplateResult {
    if (!this._config) {
      return html`<ha-card>Configuration missing!</ha-card>`;
    }
  
    const cardTitle = this._config.entity
      ? `${this._config.name || 'Scheduler'}`
      : this._config.name || 'Scheduler';
  
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  
    return html`
      <ha-card>
        <!-- Header with sync button -->
        <div class="header">
          <span>${cardTitle}</span>
          <div>
          <button
            outlined
            class="toggle-today-button"
            @click=${this._toggleShowTodayOnly}
          >${this._config?.show_today_only ? 'Show week' : 'Show today'}</button>
          <button
            class="sync-button ${this._isSynced ? 'synced' : ''}"
            @click=${this._onSyncClick}
          >
            Sync
          </button>
          </div>
        </div>
  
        <!-- Warning if no entity is configured -->
        ${!this._config.entity
          ? html`
              <div class="warning">
                <strong>Warning:</strong> No entity configured. Please edit this card and select an entity.
              </div>
            `
          : null}
  
        <!-- Main content of the card -->
        <div
          class="days-container ${this._config?.show_today_only ? 'show-today-only' : ''}"
        >
          ${this._days.map((day, dayIndex) => this._renderDayRow(day, dayIndex, today))}
        </div>
        ${this._renderOptionsPanel()}
      </ha-card>
    `;
  }
  
  private getEntityDomain(entityId: string): string {
    // e.g. "light.living_room_lamp" => "light"
    const [domain] = entityId.split('.');
    return domain;
  }

  private _buildSlotActions(entityId: string, slot: TimeSlot) {
    const domain = this.getEntityDomain(entityId);
    const isOff = !slot.on;
  
    let service = '';
    let serviceData: any = {};
  
    if (domain === 'switch') {
      // Switch domain only supports on/off
      service = isOff ? 'switch.turn_off' : 'switch.turn_on';
      serviceData = {};
  
    } else if (domain === 'light') {
      if (isOff) {
        service = 'light.turn_off';
        serviceData = {};
      } else {
        // Turn on
        service = 'light.turn_on';
        // if you want to use `slot.value` as brightness:
        //   0 = just "on", >0 = brightness_pct
        if (slot.value > 0) {
          serviceData = { brightness_pct: slot.value };
        } else {
          serviceData = {};
        }
      }
  
    } else if (domain === 'climate') {
      // e.g. your original climate logic
      if (isOff) {
        service = 'climate.set_hvac_mode';
        serviceData = { hvac_mode: 'off' };
      } else {
        // "value" is a temperature
        service = 'climate.set_temperature';
        serviceData = { hvac_mode: 'heat', temperature: slot.value };
      }
  
    } else {
      // fallback domain
      // You could default to on/off if you like:
      service = isOff ? `${domain}.turn_off` : `${domain}.turn_on`;
    }
  
    return [{
      entity_id: entityId,
      service,
      service_data: serviceData,
    }];
  }
  

  /**
   * Example: create a new schedule entity for each day that has timeslots
   * Convert intervals -> "HH:MM" for start times; default end is implied or
   * you might create multiple timeslots in the service call.
   */
  private async _syncSchedules(): Promise<void> {
    if (!this.hass || !this._config?.entity) return;
  
    const entityId = this._config.entity;
    if (!entityId) {
      console.error('No entity configured in _config.');
      return;
    }
  
    // e.g. "light", "switch", "climate", ...
    const domain = this.getEntityDomain(entityId);
  
    // For mapping "Monday" -> ["mon"], etc.
    const dayToWeekday: Record<string, string[]> = {
      Monday:    ['mon'],
      Tuesday:   ['tue'],
      Wednesday: ['wed'],
      Thursday:  ['thu'],
      Friday:    ['fri'],
      Saturday:  ['sat'],
      Sunday:    ['sun'],
    };
  
    // 1) Get all existing scheduler entities
    const allSchedules = Object.values(this.hass.states).filter((s) =>
      s.entity_id.startsWith('switch.schedule_')
    );
  
    for (const day of this._days) {
      if (!day.timeSlots.length) continue;  // skip empty
  
      const dayCodes = dayToWeekday[day.dayName] || [];
      if (!dayCodes.length) continue;
  
      // 2) Remove existing schedules for this day & entity
      for (const stateObj of allSchedules) {
        const attr = stateObj.attributes as any;
        const weekdays: string[] = attr.weekdays || [];
        const entities: string[] = attr.entities || [];
        const isOn = stateObj.state === 'on';
  
        if (entities.includes(entityId) && dayCodes.some(dc => weekdays.includes(dc)) && isOn) {
          try {
            await this.hass.callService('scheduler', 'remove', {
              entity_id: stateObj.entity_id,
            });
            console.log('Removed existing schedule:', stateObj.entity_id);
          } catch (err) {
            console.error('Failed to remove existing schedule:', stateObj.entity_id, err);
          }
        }
      }
  
      // 3) Build timeslots array
      const timeslots = day.timeSlots.map(slot => {
        const start = this._formatIntervals(slot.start) + ':00';
        let stop   = this._formatIntervals(slot.end)   + ':00';
        if (stop === '24:00:00') {
          stop = '23:59:59';
        }
  
        const actions = this._buildSlotActions(entityId, slot);
        return { start, stop, actions };
      });
  
      // 4) Add new schedule
      try {
        await this.hass.callService('scheduler', 'add', {
          name: `${day.dayName} schedule (${entityId})`,
          weekdays: dayCodes,
          timeslots,
          repeat_type: 'repeat',
          tags: [],
        });
        console.log(`Created schedule for ${day.dayName}.`);
      } catch (err) {
        console.error(`Failed to add schedule for ${day.dayName}:`, err);
      }
    }
  
    console.log('Finished creating schedules via scheduler.add()');
  }
  
  
  

  private _renderDayRow(
    day: { dayName: string; timeSlots: TimeSlot[] },
    dayIndex: number,
    today: string
  ): TemplateResult {
    const isToday = day.dayName === today;
    return html`
      <div class="day-row ${isToday ? 'current-day' : ''}">
        <div class="day-label">${day.dayName.substring(0, 2)}</div>
        <div class="track-container">
          <div
            class="track"
            @click=${(e: MouseEvent) => this._onTrackClick(e, dayIndex)}
          >
            ${day.timeSlots.map((slot, slotIndex) => {
              const leftFrac = slot.start / this.maxIntervals;
              const widthFrac = (slot.end - slot.start) / this.maxIntervals;
              const left = leftFrac * 100;
              const width = widthFrac * 100;
  
              const isSelected =
                dayIndex === this._selectedDayIndex &&
                slotIndex === this._selectedSlotIndex;
  
              // Decide how to label the timeslot
              let displayText: string;
              if (!slot.on) {
                displayText = 'Off';
              } else {
                // slot.on === true
                displayText = (slot.value > 0) ? String(slot.value) : 'On';
              }
  
              return html`
                <!-- Timeslot background -->
                <div
                  class="timeslot
                    ${slot.on ? 'on' : 'off'}
                    ${isSelected ? 'selected' : ''}
                    ${slot.disabled ? 'disabled' : ''}"
                  style="left: ${left}%; width: ${width}%;"
                  @click=${(evt: Event) => this._onTimeslotClick(evt, dayIndex, slotIndex)}
                  @pointerdown=${(evt: PointerEvent) => this._onTrackPointerDown(evt, dayIndex, slotIndex)}
                  @pointermove=${this._onTrackPointerMove}
                  @pointerup=${this._onTrackPointerUp}
                  @pointercancel=${this._onTrackPointerUp}
                  @pointerleave=${this._onTrackPointerUp}
                >
                  <div class="value-badge">
                    ${displayText}
                  </div>
                </div>
  
                <!-- Left boundary -->
                <div
                  class="boundary ${isSelected ? 'selected-boundary' : ''}"
                  style="left: ${left}%;"
                  @pointerdown=${(evt: PointerEvent) =>
                    this._onPointerDownBoundary(evt, dayIndex, slotIndex, 'start')}
                  @pointermove=${(evt: PointerEvent) =>
                    this._onPointerMoveBoundary(evt, dayIndex, slotIndex, 'start')}
                  @pointerup=${(evt: PointerEvent) =>
                    this._onPointerUpBoundary(evt, dayIndex, slotIndex, 'start')}
                  ...
                ></div>
  
                <!-- Right boundary -->
                <div
                  class="boundary ${isSelected ? 'selected-boundary' : ''}"
                  style="left: ${left + width}%;"
                  @pointerdown=${(evt: PointerEvent) =>
                    this._onPointerDownBoundary(evt, dayIndex, slotIndex, 'end')}
                  @pointermove=${(evt: PointerEvent) =>
                    this._onPointerMoveBoundary(evt, dayIndex, slotIndex, 'end')}
                  @pointerup=${(evt: PointerEvent) =>
                    this._onPointerUpBoundary(evt, dayIndex, slotIndex, 'end')}
                  ...
                ></div>
              `;
            })}
          </div>
  
          <!-- Hour axis (0..24) -->
          <div class="hour-axis">
            ${this._config?.show_line_markers
              ? this._renderMinimalAxis()  // see below
              : this._renderNumericMarkers() // your old approach
            }
          </div>
        </div>
      </div>
    `;
  }
  private _renderNumericMarkers(): TemplateResult {
    // e.g. markers for 0..24
    return html`
      ${[...Array(25).keys()].map((hour) => {
        const left = (hour / 24) * 100;
        return html`
          <div class="hour-marker" style="left: ${left}%;">
            <span>${hour}</span>
          </div>
        `;
      })}
    `;
  }
  private _renderMinimalAxis(): TemplateResult {
    // We'll only show numeric labels at these key hours
    const labelHours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  
    return html`
      ${[...Array(25).keys()].map((hour) => {
        const left = (hour / 24) * 100;
        const isLabelHour = labelHours.includes(hour);
  
        // If it's one of the labelHours, show a short marker with text.
        // Otherwise, show a line marker from top to bottom, with no text.
        if (isLabelHour) {
          return html`
            <div class="hour-marker label-hour" style="left: ${left}%;">
              <span>${hour}</span>
            </div>
          `;
        } else {
          return html`
            <div class="hour-marker line-hour" style="left: ${left}%;">
              <!-- no label -->
            </div>
          `;
        }
      })}
    `;
  }
  
  private _renderLineMarkers(): TemplateResult {
    // Only lines at 3-hour increments: 0,3,6,9,12,15,18,21,24
    const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    return html`
      ${hours.map((hour) => {
        const left = (hour / 24) * 100;
        return html`
          <div class="hour-marker line-only" style="left: ${left}%;">
            <!-- no numeric label, or optionally just show "0" and "24" if you want -->
            ${hour === 0 || hour === 24
              ? html`<span>${hour}</span>`
              : null}
          </div>
        `;
      })}
    `;
  }
  
  private _setSlotMode(dayIndex: number, slotIndex: number, mode: 'off' | 'on' | 'value'): void {
    this._days = this._days.map((day, di) => {
      if (di !== dayIndex) return day;
  
      const newSlots = day.timeSlots.map((slot, si) => {
        if (si !== slotIndex) return slot;
  
        if (mode === 'off') {
          // Turn it off, set value=0
          return { ...slot, on: false, value: 0 };
        } else if (mode === 'on') {
          // Turn on, but no slider => value=0
          return { ...slot, on: true, value: 0 };
        } else {
          // mode === 'value'
          // We'll keep the old value if it's > 0, otherwise default to 20
          const newVal = slot.value > 0 ? slot.value : 20;
          return { ...slot, on: true, value: newVal };
        }
      });
  
      return { ...day, timeSlots: newSlots };
    });
  
    // Keep the timeslot selected & reset the focus timer if it was already selected
    if (this._selectedDayIndex === dayIndex && this._selectedSlotIndex === slotIndex) {
      this._resetFocusTimeout();
    }
  }
  
  private _getAllowedModesForDomain(domain: string): Array<'off' | 'on' | 'value'> {
    if (domain === 'climate') {
      // Only show Off / Value
      return ['off', 'value'];
    } else if (domain === 'light') {
      // Off / On / Value
      return ['off', 'on', 'value'];
    } else if (domain === 'switch') {
      // Off / On
      return ['off', 'on'];
    }
    // Default fallback
    return ['off', 'on'];
  }
  private _renderOptionsPanel(): TemplateResult {
    if (this._selectedDayIndex == null || this._selectedSlotIndex == null) return html``;
    const dayEntry = this._days[this._selectedDayIndex];
    if (!dayEntry) return html``;
  
    const slot = dayEntry.timeSlots[this._selectedSlotIndex];
    if (!slot) return html``;
  
    // Convert intervals to "HH:MM"
    const startLabel = this._formatIntervals(slot.start);
    const endLabel   = this._formatIntervals(slot.end);
  
    // Figure out domain
    const domain = this.getEntityDomain(this._config!.entity!);
    // Which modes are allowed for this domain?
    const allowedModes = this._getAllowedModesForDomain(domain);
  
    // Slider label
    let sliderLabel = '';
    if (domain === 'climate') {
      sliderLabel = 'Temperature';
    } else if (domain === 'light') {
      sliderLabel = 'Brightness';
    }
  
    // Determine the current mode
    let currentMode: 'off' | 'on' | 'value';
    if (!slot.on) {
      currentMode = 'off';
    } else {
      currentMode = slot.value > 0 ? 'value' : 'on';
    }
  
    // We'll only show the slider if domain supports "value"
    // and the user selected "value" mode
    const supportsValue = allowedModes.includes('value');
    const showSlider = supportsValue && (currentMode === 'value');
  
    return html`
      <div class="options-panel">
        <div class="option-row">
          <span class="day-display">${dayEntry.dayName}</span>
          <span class="time-display">${startLabel} - ${endLabel}</span>
        </div>
  
        <!-- Render each allowed mode as a button -->
        <div class="option-row">
          ${allowedModes.map(mode => {
            // e.g. mode could be 'off', 'on', or 'value'
            // We label the button accordingly:
            const buttonLabel = (mode === 'off')
              ? 'Off'
              : (mode === 'on')
                ? 'On'
                : 'Value';
  
            // Check if this is the active mode
            const isActive = (currentMode === mode);
  
            return html`
              <mwc-button
                .label=${buttonLabel}
                ?unelevated=${isActive}
                ?outlined=${!isActive}
                @click=${() => this._setSlotMode(this._selectedDayIndex!, this._selectedSlotIndex!, mode)}
              >
              </mwc-button>
            `;
          })}
        </div>
  
        <!-- If in "value" mode and domain supports it, show the slider -->
        ${showSlider
          ? html`
              <div class="option-row">
                <span>${sliderLabel}:</span>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  .value=${String(slot.value)}
                  @input=${(e: Event) => {
                    const target = e.currentTarget as HTMLInputElement;
                    this._updateSlotValue(
                      this._selectedDayIndex!,
                      this._selectedSlotIndex!,
                      parseInt(target.value, 10)
                    );
                  }}
                />
                <span class="value-display">${slot.value}</span>
              </div>
            `
          : null}
  
        <!-- Delete Button -->
        <div class="option-row">
          <mwc-button
            outlined
            @click=${() => this._deleteSlot(this._selectedDayIndex!, this._selectedSlotIndex!)}
          >
            Delete Timeslot
          </mwc-button>
        </div>
      </div>
    `;
  }
  

  // ────────────────────────────────────────────────────────────────────────────
  // Selection + focus timeout
  // ────────────────────────────────────────────────────────────────────────────
  private get selectionTimeout(): number {
    // Guaranteed to be set from setConfig(), or fallback if needed
    return this._config?.selection_timeout ?? 25000;
  }
  private _clearSelectionAfterDelay(): void {
    if (this._focusTimeout !== null) {
      clearTimeout(this._focusTimeout);
    }
    this._focusTimeout = window.setTimeout(() => {
      this._selectedDayIndex = null;
      this._selectedSlotIndex = null;
      this._focusTimeout = null;
    }, this.selectionTimeout);
  }
  
  private _selectTimeslot(dayIndex: number, slotIndex: number): void {
    this._selectedDayIndex = dayIndex;
    this._selectedSlotIndex = slotIndex;
    this._resetFocusTimeout();
  }
  
  private _resetFocusTimeout(): void {
    if (this._focusTimeout !== null) {
      clearTimeout(this._focusTimeout);
    }
    this._focusTimeout = window.setTimeout(() => {
      this._selectedDayIndex = null;
      this._selectedSlotIndex = null;
      this._focusTimeout = null;
    }, this.selectionTimeout);
  }
  

  // ────────────────────────────────────────────────────────────────────────────
  // Click on empty track => add new slot (2 hours = 12 intervals)
  // ────────────────────────────────────────────────────────────────────────────
  private _onTrackClick(e: MouseEvent, dayIndex: number): void {
    // If click was on a child element (like the timeslot or boundary), ignore
    if (e.target !== e.currentTarget) return;
  
    const trackRect = (
      this.renderRoot.querySelectorAll('.track')[dayIndex] as HTMLElement
    )?.getBoundingClientRect();
    if (!trackRect) return;
  
    const clickX = e.clientX - trackRect.left;
    // Convert to fraction across track
    const frac = clickX / trackRect.width;
    // Convert fraction → intervals
    let intervalStart = Math.floor(frac * this.maxIntervals);
    // Default new slot = 12 intervals (2 hours)
    const intervalsPer2Hours = 120 / this.minutesPerInterval; 
    let intervalEnd = intervalStart + intervalsPer2Hours;
    if (intervalEnd > this.maxIntervals) {
      intervalEnd = this.maxIntervals;
      intervalStart = this.maxIntervals - intervalsPer2Hours;
    }
  
    // Check for overlap
    const day = this._days[dayIndex];
    const overlaps = day.timeSlots.some(
      (slot) => intervalStart < slot.end && slot.start < intervalEnd
    );
    if (!overlaps) {
      const newSlots = [...day.timeSlots];
      newSlots.push({
        start: intervalStart,
        end: intervalEnd,
        on: true,
        value: 20,
      });
      this._days = this._days.map((d, i) =>
        i === dayIndex ? { ...d, timeSlots: newSlots } : d
      );
      // Select new slot
      this._selectTimeslot(dayIndex, newSlots.length - 1);
    }
  }

  private _onTimeslotClick(e: Event, dayIndex: number, slotIndex: number): void {
    e.stopPropagation();
    this._selectTimeslot(dayIndex, slotIndex);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._focusTimeout !== null) {
      clearTimeout(this._focusTimeout);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Toggle / Value / Delete
  // ────────────────────────────────────────────────────────────────────────────
  private _toggleSlotOnOff(dayIndex: number, slotIndex: number) {
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
  // DRAG LOGIC: move entire slot
  // ────────────────────────────────────────────────────────────────────────────
  private _onTrackPointerDown(e: PointerEvent, dayIndex: number, slotIndex: number) {
    e.stopPropagation();
    // Select if not already selected
    if (this._selectedDayIndex !== dayIndex || this._selectedSlotIndex !== slotIndex) {
      this._selectTimeslot(dayIndex, slotIndex);
    } else {
      this._resetFocusTimeout();
    }

    const day = this._days[dayIndex];
    const slot = day.timeSlots[slotIndex];
    if (!slot) return;

    this._draggingTrackDayIndex = dayIndex;
    this._draggingTrackSlotIndex = slotIndex;
    this._draggingTrackInitialStart = slot.start;
    this._draggingTrackInitialEnd = slot.end;

    const duration = slot.end - slot.start;
    const trackRect = (
      this.renderRoot.querySelectorAll('.track')[dayIndex] as HTMLElement
    )?.getBoundingClientRect();
    if (!trackRect) return;

    // Where did we grab the slot?
    const pointerPx = e.clientX - trackRect.left;
    const pointerInterval = (pointerPx / trackRect.width) * this.maxIntervals;
    // The anchor point within the slot
    this._draggingTrackPointerFrac = (pointerInterval - slot.start) / duration;
    this._draggingTrackPointerFrac = Math.max(0, Math.min(1, this._draggingTrackPointerFrac));

    this._isDragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  private _onTrackPointerMove(e: PointerEvent) {
    if (
      this._draggingTrackDayIndex == null ||
      this._draggingTrackSlotIndex == null
    ) {
      return;
    }
    const dayIndex  = this._draggingTrackDayIndex;
    const slotIndex = this._draggingTrackSlotIndex;
  
    const trackRect = (
      this.renderRoot.querySelectorAll('.track')[dayIndex] as HTMLElement
    )?.getBoundingClientRect();
    if (!trackRect) return;
  
    const slot = this._days[dayIndex].timeSlots[slotIndex];
    if (!slot) return;
  
    const originalStart = this._draggingTrackInitialStart;
    const originalEnd   = this._draggingTrackInitialEnd;
    const duration      = originalEnd - originalStart;
  
    // Convert mouse X → fraction → intervals
    const pointerPx = e.clientX - trackRect.left;
    let pointerInterval = (pointerPx / trackRect.width) * this.maxIntervals;
    pointerInterval = Math.round(pointerInterval);
  
    // Anchor within the slot so you can drag from the middle
    const anchorInterval = originalStart + this._draggingTrackPointerFrac * duration;
    let rawDelta = pointerInterval - anchorInterval;
    rawDelta = Math.round(rawDelta);
  
    let newStart = originalStart + rawDelta;
    let newEnd   = newStart + duration;
  
    // Clamp to valid range [0..this.maxIntervals]
    if (newStart < 0) {
      newStart = 0;
      newEnd = duration;
    }
    if (newEnd > this.maxIntervals) {
      newEnd = this.maxIntervals;
      newStart = this.maxIntervals - duration;
    }
  
    // Check for overlap
    if (this._wouldOverlap(dayIndex, slotIndex, newStart, newEnd)) {
      return;
    }
  
    // Update the slot
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
    if (
      this._draggingTrackDayIndex != null &&
      this._draggingTrackSlotIndex != null
    ) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
    this._isDragging = false;
    this._draggingTrackDayIndex = null;
    this._draggingTrackSlotIndex = null;
    this._draggingTrackInitialStart = 0;
    this._draggingTrackInitialEnd = 0;
    this._draggingTrackPointerFrac = 0;
    this._resetFocusTimeout();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // DRAG LOGIC: boundary
  // ────────────────────────────────────────────────────────────────────────────
  private _onPointerDownBoundary(
    e: PointerEvent,
    dayIndex: number,
    slotIndex: number,
    boundary: 'start' | 'end'
  ) {
    e.stopPropagation();
    // Only allow if it's already selected
    if (
      this._selectedDayIndex !== dayIndex ||
      this._selectedSlotIndex !== slotIndex
    ) {
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const slot = this._days[dayIndex].timeSlots[slotIndex];
    if (!slot) return;

    this._draggingBoundaryDayIndex = dayIndex;
    this._draggingBoundarySlotIndex = slotIndex;
    this._dragBoundary = boundary;
    this._dragBoundaryOriginalInterval =
      boundary === 'start' ? slot.start : slot.end;

    this._isDragging = true;
    this._resetFocusTimeout();
  }

  private _onPointerMoveBoundary(
    e: PointerEvent,
    dayIndex: number,
    slotIndex: number,
    boundary: 'start' | 'end'
  ) {
    this._resetFocusTimeout();
    if (
      this._draggingBoundaryDayIndex == null ||
      this._draggingBoundarySlotIndex == null ||
      this._dragBoundary == null
    ) {
      return;
    }
    if (
      this._draggingBoundaryDayIndex !== dayIndex ||
      this._draggingBoundarySlotIndex !== slotIndex ||
      this._dragBoundary !== boundary
    ) {
      return;
    }

    const originalInterval = this._dragBoundaryOriginalInterval;
    if (originalInterval == null) return;

    const trackRect = (
      this.renderRoot.querySelectorAll('.track')[dayIndex] as HTMLElement
    )?.getBoundingClientRect();
    if (!trackRect) return;

    const pointerPx = e.clientX - trackRect.left;
    let newInterval = Math.round((pointerPx / trackRect.width) * this.maxIntervals);
    if (newInterval < 0) newInterval = 0;
    if (newInterval > this.maxIntervals) newInterval = this.maxIntervals;

    const slot = this._days[dayIndex].timeSlots[slotIndex];
    if (!slot) return;

    if (boundary === 'start') {
      // Must not exceed the slot's end
      if (newInterval > slot.end) return;
      if (!this._wouldOverlap(dayIndex, slotIndex, newInterval, slot.end)) {
        this._days = this._days.map((d, di) => {
          if (di !== dayIndex) return d;
          const newSlots = d.timeSlots.map((s, si) => {
            if (si !== slotIndex) return s;
            return { ...s, start: newInterval };
          });
          return { ...d, timeSlots: newSlots };
        });
      }
    } else {
      // boundary === 'end'
      if (newInterval < slot.start) return;
      if (!this._wouldOverlap(dayIndex, slotIndex, slot.start, newInterval)) {
        this._days = this._days.map((d, di) => {
          if (di !== dayIndex) return d;
          const newSlots = d.timeSlots.map((s, si) => {
            if (si !== slotIndex) return s;
            return { ...s, end: newInterval };
          });
          return { ...d, timeSlots: newSlots };
        });
      }
    }
  }

  private _onPointerUpBoundary(
    e: PointerEvent,
    dayIndex: number,
    slotIndex: number,
    boundary: 'start' | 'end'
  ) {
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
    this._dragBoundaryOriginalInterval = null;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CSS
  // ────────────────────────────────────────────────────────────────────────────
  static get styles(): CSSResultGroup {
    return css`
      ha-card {
        padding: 0;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        font-size: 1.25rem;
        font-weight: bold;
        border-bottom: 1px solid var(--divider-color);
      }

      .header-buttons {
        display: flex;
        gap: 8px;
      }

      .sync-button, .toggle-today-button{
        background: var(--primary-color, #007bff);
        color: #fff;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.3s;
      }

      .sync-button.synced {
        background: #28a745; /* Green when synced */
      }

      .sync-button:hover {
        background: var(--primary-color-dark, #0056b3);
      }

      .days-container.show-today-only .day-row {
        display: none;
      }

      .days-container.show-today-only .day-row.current-day {
        display: flex;
      }

      .day-row.current-day {
        border-radius: 4px;
      }
      .sync-button.synced {
        background: #28a745; /* Green when synced */
      }

      .sync-button:hover {
        background: var(--primary-color-dark, #0056b3); /* Default dark blue on hover */
      }

      .sync-button.synced:hover {
        background: #218838; /* Darker green when synced and hovered */
      }


      .warning {
        background: var(--error-color, #ef5350);
        color: var(--text-primary-color, #fff);
        margin: 16px;
        padding: 8px;
        border-radius: 4px;
      }

      .days-container {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 15px;
      }

      .day-row {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
      }
      .day-label {
        width: 18px;
        text-align: left;
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
        height: 20px;
        background: rgb(68, 68, 68);
        cursor: pointer;
        overflow: visible;
        touch-action: none;
        user-select: none;
      }
      .hour-axis {
        position: relative;
        height: 15px;
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
        top: -2px;
      }
      .timeslot {
        position: absolute;
        top: 0;
        bottom: 0;
        transition: filter 0.2s ease;
        touch-action: none;
        user-select: none;
        border-left: solid 1px #ffffff;
        border-right: solid 1px #ffffff;
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
      .timeslot.disabled {
        background: #ccc;
        opacity: 0.5;
        pointer-events: none;
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
        /* Hidden by default; only visible on selected slot */
        display: none;
      }
      .boundary.selected-boundary {
        display: block;
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

      /* Shared base: position absolute, top:0 so lines can appear. */
      .hour-marker {
        position: absolute;
        transform: translateX(-50%);
      }

      /* 1) line-hour: a full-height line with no label */
      .line-hour {
        top: 7px;
        bottom: 0;       /* so the line spans the full height */
        width: 1px;      /* thin line */
        background: #fff;
      }

      /* 2) label-hour: no line, just the numeric label */
      .label-hour {
        /* If you want a small tick, set a small height or use a short line */
        top: 0px;          /* or top: 2px; if you want it slightly below the top */
        width: 1px;
        height: 1px;     /* effectively invisible line or a small dot */
        background: none;
      }

      .label-hour span {
        position: absolute;
        top: -2px;      /* place the text above the marker dot */
        left: 50%;
        transform: translateX(-50%);
        color: #fff;
        font-size: 0.75rem;
      }


    `;
  }
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: 'apsley-scheduler-card',
  name: 'Apsley Scheduler Card',
  description: 'A card for scheduling timeslots to control an entity (10-min intervals).',
});
