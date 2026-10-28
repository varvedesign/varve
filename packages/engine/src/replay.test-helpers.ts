/** Shared replay recorder helpers for the split replay test modules. */
import type { ReplayTarget } from './replay';

export interface RecorderProxy {
  target: ReplayTarget;
  calls: string[];
  props: Record<string, unknown>;
  lineWidthValues: number[];
}

export function recorder(): RecorderProxy {
  const calls: string[] = [];
  const lineWidthValues: number[] = [];
  const props: Record<string, unknown> = {};
  const mk =
    (k: string) =>
    (...args: unknown[]) =>
      calls.push(`${k}(${args.length})`);
  const target: Record<string, unknown> = {
    save: mk('save'),
    restore: mk('restore'),
    clip: mk('clip'),
    transform: mk('transform'),
    translate: mk('translate'),
    rotate: mk('rotate'),
    scale: mk('scale'),
    fillRect: mk('fillRect'),
    strokeRect: mk('strokeRect'),
    beginPath: mk('beginPath'),
    rect: mk('rect'),
    ellipse: mk('ellipse'),
    arc: mk('arc'),
    moveTo: mk('moveTo'),
    lineTo: mk('lineTo'),
    bezierCurveTo: mk('bezierCurveTo'),
    fill: mk('fill'),
    stroke: mk('stroke'),
    closePath: mk('closePath'),
    setLineDash: mk('setLineDash'),
    roundRect: mk('roundRect'),
    fillText: mk('fillText'),

    get fillStyle() {
      return (props.fillStyle as string) ?? '';
    },
    set fillStyle(v) {
      props.fillStyle = v;
      calls.push('set fillStyle');
    },
    get lineWidth() {
      return (props.lineWidth as number) ?? 0;
    },
    set lineWidth(v) {
      props.lineWidth = v;
      lineWidthValues.push(v as number);
      calls.push('set lineWidth');
    },
    get lineCap() {
      return (props.lineCap as CanvasLineCap) ?? 'butt';
    },
    set lineCap(v) {
      props.lineCap = v;
      calls.push('set lineCap');
    },
    get strokeStyle() {
      return (props.strokeStyle as string) ?? '';
    },
    set strokeStyle(v) {
      props.strokeStyle = v;
      calls.push('set strokeStyle');
    },
    get lineJoin() {
      return (props.lineJoin as CanvasLineJoin) ?? 'miter';
    },
    set lineJoin(v) {
      props.lineJoin = v;
      calls.push('set lineJoin');
    },
    get globalAlpha() {
      return (props.globalAlpha as number) ?? 1;
    },
    set globalAlpha(v) {
      props.globalAlpha = v;
      calls.push('set globalAlpha');
    },
    get globalCompositeOperation() {
      return (props.globalCompositeOperation as string) ?? 'source-over';
    },
    set globalCompositeOperation(v) {
      props.globalCompositeOperation = v;
      calls.push('set globalCompositeOperation');
    },
    get filter() {
      return (props.filter as string) ?? 'none';
    },
    set filter(v) {
      props.filter = v;
      calls.push('set filter');
    },
    get lineDashOffset() {
      return (props.lineDashOffset as number) ?? 0;
    },
    set lineDashOffset(v) {
      props.lineDashOffset = v;
      calls.push('set lineDashOffset');
    },
    get shadowColor() {
      return (props.shadowColor as string) ?? 'transparent';
    },
    set shadowColor(v) {
      props.shadowColor = v;
      calls.push('set shadowColor');
    },
    get shadowBlur() {
      return (props.shadowBlur as number) ?? 0;
    },
    set shadowBlur(v) {
      props.shadowBlur = v;
      calls.push('set shadowBlur');
    },
    get shadowOffsetX() {
      return (props.shadowOffsetX as number) ?? 0;
    },
    set shadowOffsetX(v) {
      props.shadowOffsetX = v;
      calls.push('set shadowOffsetX');
    },
    get shadowOffsetY() {
      return (props.shadowOffsetY as number) ?? 0;
    },
    set shadowOffsetY(v) {
      props.shadowOffsetY = v;
      calls.push('set shadowOffsetY');
    },
    get font() {
      return (props.font as string) ?? '10px sans-serif';
    },
    set font(v) {
      props.font = v;
      calls.push('set font');
    },
    get textAlign() {
      return (props.textAlign as CanvasTextAlign) ?? 'left';
    },
    set textAlign(v) {
      props.textAlign = v;
      calls.push('set textAlign');
    },
    get textBaseline() {
      return (props.textBaseline as string) ?? 'alphabetic';
    },
    set textBaseline(v) {
      props.textBaseline = v;
      calls.push('set textBaseline');
    },
  };
  return { target: target as unknown as ReplayTarget, calls, props, lineWidthValues };
}

/** Class-based recorder for text-focused tests — tracks actual values. */
export class Recorder implements ReplayTarget {
  public calls: string[] = [];
  public lineWidthValues: number[] = [];
  save() {
    this.calls.push('save');
  }
  restore() {
    this.calls.push('restore');
  }
  clip() {
    this.calls.push('clip');
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.calls.push(`transform(${a},${b},${c},${d},${e},${f})`);
  }
  translate(x: number, y: number) {
    this.calls.push(`translate(${x},${y})`);
  }
  rotate(angle: number) {
    this.calls.push(`rotate(${angle})`);
  }
  scale(x: number, y: number) {
    this.calls.push(`scale(${x},${y})`);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`fillRect(${x},${y},${w},${h})`);
  }
  beginPath() {
    this.calls.push('beginPath');
  }
  rect(x: number, y: number, w: number, h: number) {
    this.calls.push(`rect(${x},${y},${w},${h})`);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number) {
    this.calls.push(`ellipse(${x},${y},${rx},${ry},${rot},${start},${end})`);
  }
  arc(x: number, y: number, r: number, start: number, end: number) {
    this.calls.push(`arc(${x},${y},${r},${start},${end})`);
  }
  moveTo(x: number, y: number) {
    this.calls.push(`moveTo(${x},${y})`);
  }
  lineTo(x: number, y: number) {
    this.calls.push(`lineTo(${x},${y})`);
  }
  fill() {
    this.calls.push('fill');
  }
  stroke() {
    this.calls.push('stroke');
  }
  closePath() {
    this.calls.push('closePath');
  }
  fillStyle: string = '';
  private _lineWidth = 1;
  get lineWidth(): number {
    return this._lineWidth;
  }
  set lineWidth(value: number) {
    this._lineWidth = value;
    this.lineWidthValues.push(value);
    this.calls.push(`set lineWidth(${value})`);
  }
  lineCap: CanvasLineCap = 'round';
  font: string = '';
  textAlign: CanvasTextAlign = 'left';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  fillText(text: string, x: number, y: number) {
    this.calls.push(`fillText("${text}",${x},${y})`);
  }
  strokeText(text: string, x: number, y: number) {
    this.calls.push(`strokeText("${text}",${x},${y})`);
  }
  // Stubs for required ReplayTarget members
  strokeRect() {}
  bezierCurveTo() {}
  setLineDash() {}
  roundRect() {}
  lineJoin: CanvasLineJoin = 'miter';
  strokeStyle: string = '';
  globalAlpha: number = 1;
  globalCompositeOperation: string = 'source-over';
  filter: string = 'none';
  lineDashOffset: number = 0;
  shadowColor: string = 'transparent';
  shadowBlur: number = 0;
  shadowOffsetX: number = 0;
  shadowOffsetY: number = 0;
}

export class MeasuredRecorder extends Recorder {
  measureText(text: string): TextMetrics {
    return { width: text.length * 10 } as TextMetrics;
  }
}
