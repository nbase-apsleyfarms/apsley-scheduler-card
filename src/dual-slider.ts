import { LitElement, html, css} from 'lit';
import { customElement, property } from 'lit/decorators.js';


@customElement('dual-slider')
export class DualSlider extends LitElement {
  @property({ type: Number }) value1 = 30;
  @property({ type: Number }) value2 = 60;

  static styles = css`
    :host {
      display: block;
      position: relative;
      height: 14px;
      margin: 45px 0 10px;
    }

    .slider-container {
      position: relative;
      height: 14px;
      width: 100%;
      background: #ccc;
      border-radius: 10px;
      margin: 0 7px;
    }

    .range {
      position: absolute;
      top: 0;
      height: 14px;
      border-radius: 14px;
      background-color: #1abc9c;
    }

    .thumb {
      position: absolute;
      top: -7px;
      z-index: 2;
      height: 28px;
      width: 28px;
      background-color: #fff;
      border-radius: 50%;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.4);
      cursor: pointer;
    }

    .value-display {
      position: absolute;
      top: -39px;
      background-color: #1abc9c;
      color: #fff;
      border-radius: 50%;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
    }
  `;

  updated(changedProperties: any) {
    super.updated(changedProperties);
    this.updateSliderStyles();
  }

  updateSliderStyles() {
    const range = this.shadowRoot?.querySelector('.range') as HTMLElement;
    const thumb1 = this.shadowRoot?.querySelector('.thumb1') as HTMLElement;
    const thumb2 = this.shadowRoot?.querySelector('.thumb2') as HTMLElement;
    const valueDisplay1 = this.shadowRoot?.querySelector('.value-display1') as HTMLElement;
    const valueDisplay2 = this.shadowRoot?.querySelector('.value-display2') as HTMLElement;

    if (range && thumb1 && thumb2 && valueDisplay1 && valueDisplay2) {
      const min = 0;
      const max = 100;
      const rangeWidth = (100 / (max - min)) * (this.value2 - this.value1);
      range.style.left = `${(100 / (max - min)) * this.value1}%`;
      range.style.width = `${rangeWidth}%`;

      thumb1.style.left = `${(100 / (max - min)) * this.value1}%`;
      thumb2.style.left = `${(100 / (max - min)) * this.value2}%`;

      valueDisplay1.textContent = String(this.value1);
      valueDisplay2.textContent = String(this.value2);
    }
  }

  handleInput1(event: Event) {
    const target = event.target as HTMLInputElement;
    this.value1 = Math.min(target.valueAsNumber, this.value2 - 1);
  }

  handleInput2(event: Event) {
    const target = event.target as HTMLInputElement;
    this.value2 = Math.max(target.valueAsNumber, this.value1 + 1);
  }

  render() {
    return html`
      <div class="slider-container">
        <div class="range"></div>
        <div class="thumb thumb1" style="left: ${this.value1}%"></div>
        <div class="thumb thumb2" style="left: ${this.value2}%"></div>
        <div class="value-display value-display1" style="left: ${this.value1}%">${this.value1}</div>
        <div class="value-display value-display2" style="left: ${this.value2}%">${this.value2}</div>
      </div>

      <input type="range" .value=${this.value1} min="0" max="100" step="1" @input="${this.handleInput1}" />
      <input type="range" .value=${this.value2} min="0" max="100" step="1" @input="${this.handleInput2}" />
    `;
  }
}
