/* eslint-disable @typescript-eslint/no-explicit-any */
import { LitElement, html, TemplateResult, css, CSSResultGroup } from 'lit';
import { HomeAssistant, fireEvent, LovelaceCardEditor } from 'custom-card-helpers';

import { ScopedRegistryHost } from '@lit-labs/scoped-registry-mixin';
import { ApsleyCardConfig } from './types';
import { customElement, property, state } from 'lit/decorators';
import { formfieldDefinition } from '../elements/formfield';
import { selectDefinition } from '../elements/select';
import { switchDefinition } from '../elements/switch';
import { textfieldDefinition } from '../elements/textfield';

@customElement('apsley-scheduler-card-editor')
export class SchedulerCardEditor extends ScopedRegistryHost(LitElement) implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: ApsleyCardConfig;

  @state() private _helpers?: any;

  private _initialized = false;

  static elementDefinitions = {
    ...textfieldDefinition,
    ...selectDefinition,
    ...switchDefinition,
    ...formfieldDefinition,
  };

  public setConfig(config: ApsleyCardConfig): void {
    this._config = {
      ...config,
      time_step: config.time_step ?? 60,          // already present
      selection_timeout: config.selection_timeout ?? 25000, // default 25s
      show_line_markers: config.show_line_markers ?? false,
    };
  
    this.loadCardHelpers();
  }

  protected shouldUpdate(): boolean {
    if (!this._initialized) {
      this._initialize();
    }

    return true;
  }

  get _name(): string {
    return this._config?.name || '';
  }

  get _entity(): string {
    return this._config?.entity || '';
  }

  get _show_warning(): boolean {
    return this._config?.show_warning || false;
  }

  get _show_error(): boolean {
    return this._config?.show_error || false;
  }

  protected render(): TemplateResult | void {
    if (!this.hass || !this._helpers) {
      return html``;
    }
  
    // You can restrict on domain type
    const entities = Object.keys(this.hass.states);
  
    return html`
      <!-- Entity selection -->
      <mwc-select
        naturalMenuWidth
        fixedMenuPosition
        label="Entity (Required)"
        .configValue=${'entity'}
        .value=${this._entity}
        @selected=${this._valueChanged}
        @closed=${(ev) => ev.stopPropagation()}
      >
        ${entities.map((entity) => {
          return html`<mwc-list-item .value=${entity}>${entity}</mwc-list-item>`;
        })}
      </mwc-select>
  
      <!-- Name (Optional) -->
      <mwc-textfield
        label="Name (Optional)"
        .value=${this._name}
        .configValue=${'name'}
        @input=${this._valueChanged}
      ></mwc-textfield>
  
      <!-- Interval Step (new) -->
      <mwc-select
        label="Interval Step (minutes)"
        .configValue=${"time_step"}
        .value=${String(this._time_step)}
        @change=${this._valueChanged}
        @closed=${(ev) => ev.stopPropagation()}
      >
        <mwc-list-item value="10">10 minutes</mwc-list-item>
        <mwc-list-item value="15">15 minutes</mwc-list-item>
        <mwc-list-item value="30">30 minutes</mwc-list-item>
        <mwc-list-item value="60">1 hour</mwc-list-item>
      </mwc-select>

      <!-- Selection Timeout (ms) -->
      <mwc-textfield
        label="Selection Timeout (ms)"
        .configValue=${'selection_timeout'}
        .value=${String(this._selectionTimeout)}
        @input=${this._valueChanged}
      ></mwc-textfield>

      <!-- Existing toggles, etc. -->
      <mwc-formfield .label=${`Toggle warning ${this._show_warning ? 'off' : 'on'}`}>
        <mwc-switch
          .checked=${this._show_warning !== false}
          .configValue=${'show_warning'}
          @change=${this._valueChanged}
        ></mwc-switch>
      </mwc-formfield>
      <mwc-formfield .label=${`Toggle error ${this._show_error ? 'off' : 'on'}`}>
        <mwc-switch
          .checked=${this._show_error !== false}
          .configValue=${'show_error'}
          @change=${this._valueChanged}
        ></mwc-switch>
      </mwc-formfield>

      <mwc-formfield .label=${"Show line markers only?"}>
        <mwc-switch
          .checked=${this._config?.show_line_markers ?? false}
          .configValue=${"show_line_markers"}
          @change=${this._valueChanged}
        ></mwc-switch>
      </mwc-formfield>

      <mwc-formfield .label=${"Show Just Today"}>
        <mwc-switch
          .checked=${this._config?.show_today_only ?? false}
          .configValue=${"show_today_only"}
          @change=${this._valueChanged}
        ></mwc-switch>
      </mwc-formfield>

    `;
  }
  private get _time_step(): number {
    // Default to 10 if not set
    return this._config?.time_step ?? 60;
  }
  private get _selectionTimeout(): number {
    return this._config?.selection_timeout ?? 25000;
  }
  private _initialize(): void {
    if (this.hass === undefined) return;
    if (this._config === undefined) return;
    if (this._helpers === undefined) return;
    this._initialized = true;
  }

  private async loadCardHelpers(): Promise<void> {
    this._helpers = await (window as any).loadCardHelpers();
  }
  
  private _valueChanged(ev: Event): void {
    if (!this._config) return;
  
    const target = ev.currentTarget as HTMLInputElement | HTMLSelectElement;
    const configKey = (target as any).configValue;
    if (!configKey) {
      return; 
    }
  
    let newValue: any;
    // Switch/checkbox logic
    if (typeof (target as any).checked !== 'undefined') {
      newValue = (target as any).checked;
    } else {
      newValue = target.value;
    }
  
    // Convert certain keys to numbers
    if (configKey === 'time_step' || configKey === 'selection_timeout') {
      newValue = Number(newValue);
    }
  
    // If it hasn't changed, do nothing
    if (this._config[configKey] === newValue) {
      return;
    }
  
    // Update config
    const updated = {
      ...this._config,
      [configKey]: newValue === '' ? undefined : newValue,
    };
  
    this._config = updated;
    fireEvent(this, 'config-changed', { config: this._config });
  }


  static styles: CSSResultGroup = css`
    mwc-select,
    mwc-textfield {
      margin-bottom: 16px;
      display: block;
    }
    mwc-formfield {
      padding-bottom: 8px;
    }
    mwc-switch {
      --mdc-theme-secondary: var(--switch-checked-color);
    }
  `;
}
