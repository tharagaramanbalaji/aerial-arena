/**
 * Speedometer-style boost gauge (SVG): 240° dial with ticks and labels, neon fill arc,
 * needle, big boost number, speed readout and a SUPERSONIC lamp.
 */
const START = 150; // degrees (SVG: 0 = +x, clockwise), bottom-left
const SWEEP = 240;
const CX = 100;
const CY = 100;

const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
};

const arcPath = (r: number, fromDeg: number, toDeg: number) => {
  const a = polar(r, fromDeg);
  const b = polar(r, toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
};

export class BoostGauge {
  readonly el: HTMLDivElement;
  private fill!: SVGPathElement;
  private needle!: SVGGElement;
  private num!: HTMLElement;
  private speed!: HTMLElement;
  private lamp!: HTMLElement;
  private shown = -1;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'gauge';
    this.el.setAttribute('aria-label', 'Boost');
    let ticks = '';
    for (let v = 0; v <= 100; v += 2) {
      const major = v % 10 === 0;
      const deg = START + (SWEEP * v) / 100;
      const p1 = polar(major ? 70 : 74, deg);
      const p2 = polar(82, deg);
      const color = v <= 20 ? '#ff4d4d' : major ? '#e8eef8' : 'rgba(232,238,248,0.45)';
      ticks += `<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke="${color}" stroke-width="${major ? 2.6 : 1.2}" stroke-linecap="round"/>`;
      if (major && v % 20 === 0) {
        const lp = polar(58, deg);
        ticks += `<text x="${lp.x.toFixed(1)}" y="${(lp.y + 3.5).toFixed(1)}" class="g-label">${v}</text>`;
      }
    }
    this.el.innerHTML = `
      <svg viewBox="0 0 200 200">
        <defs>
          <radialGradient id="g-face" cx="50%" cy="42%" r="60%">
            <stop offset="0" stop-color="#1b2233"/><stop offset="1" stop-color="#05070c"/>
          </radialGradient>
          <linearGradient id="g-bezel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#8aa0c0"/><stop offset="0.5" stop-color="#2b3445"/><stop offset="1" stop-color="#6c7a90"/>
          </linearGradient>
          <linearGradient id="g-fill" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stop-color="#ff2d55"/><stop offset="0.45" stop-color="#ff8a00"/><stop offset="1" stop-color="#ffe14d"/>
          </linearGradient>
          <filter id="g-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <circle cx="100" cy="100" r="97" fill="url(#g-bezel)"/>
        <circle cx="100" cy="100" r="92" fill="url(#g-face)"/>
        <path d="${arcPath(88, START, START + SWEEP)}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="7"/>
        <path id="g-fill" d="" fill="none" stroke="url(#g-fill)" stroke-width="7" stroke-linecap="round" filter="url(#g-glow)"/>
        ${ticks}
        <g id="g-needle" style="transform-origin:100px 100px; transition: transform 90ms linear">
          <polygon points="97,100 103,100 100.6,30 99.4,30" fill="#ff5a1f" filter="url(#g-glow)"/>
          <polygon points="98.6,100 101.4,100 100.3,34 99.7,34" fill="#fff3d6"/>
        </g>
        <circle cx="100" cy="100" r="9" fill="#11151f" stroke="#ff7a1a" stroke-width="2"/>
      </svg>
      <div class="g-num" id="g-num">0</div>
      <div class="g-cap">BOOST</div>
      <div class="g-speed"><span id="g-speed">0</span> km/h</div>
      <div class="g-lamp" id="g-lamp">SUPERSONIC</div>`;
    this.fill = this.el.querySelector('#g-fill')!;
    this.needle = this.el.querySelector('#g-needle')!;
    this.num = this.el.querySelector('#g-num')!;
    this.speed = this.el.querySelector('#g-speed')!;
    this.lamp = this.el.querySelector('#g-lamp')!;
    this.update(33, 0, false);
  }

  /** boost 0..100, speed in m/s. */
  update(boost: number, speedMs: number, supersonic: boolean): void {
    const v = Math.max(0, Math.min(100, Math.round(boost)));
    if (v !== this.shown) {
      this.shown = v;
      this.num.textContent = String(v);
      this.num.classList.toggle('low', v <= 20);
      const end = START + (SWEEP * v) / 100;
      this.fill.setAttribute('d', v > 0 ? arcPath(88, START, Math.max(START + 0.5, end)) : '');
      // needle drawn pointing up (-90°); rotate to the value angle
      this.needle.style.transform = `rotate(${end + 90}deg)`;
    }
    const kmh = String(Math.round(speedMs * 3.6));
    if (this.speed.textContent !== kmh) this.speed.textContent = kmh;
    this.lamp.classList.toggle('on', supersonic);
  }
}
