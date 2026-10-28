import type { ReplayGradient, ReplayTarget } from './replay';

export interface RecorderProxy {
  target: ReplayTarget;
  calls: string[];
  props: Record<string, unknown>;
}

export function recorder(): RecorderProxy {
  const calls: string[] = [];
  const props: Record<string, unknown> = {};
  const mk =
    (k: string) =>
    (...args: unknown[]) => {
      const s = `${k}(${args.length})`;
      calls.push(s);
      return undefined;
    };

  const tracked: Record<string, PropertyDescriptor> = {};
  const defProp = (name: string, def: unknown) => {
    tracked[name] = {
      get() {
        return name in props ? props[name] : def;
      },
      set(v: unknown) {
        props[name] = v;
        calls.push(`set ${name}`);
      },
      configurable: true,
      enumerable: true,
    };
  };
  defProp('fillStyle', '');
  defProp('strokeStyle', '');
  defProp('lineWidth', 1);
  defProp('lineCap', 'butt');
  defProp('lineJoin', 'miter');
  defProp('globalAlpha', 1);
  defProp('globalCompositeOperation', 'source-over');
  defProp('filter', 'none');
  defProp('lineDashOffset', 0);
  defProp('shadowColor', 'transparent');
  defProp('shadowBlur', 0);
  defProp('shadowOffsetX', 0);
  defProp('shadowOffsetY', 0);
  defProp('font', '10px sans-serif');
  defProp('textAlign', 'left');
  defProp('textBaseline', 'alphabetic');

  let gradientId = 0;
  const gradients: Record<string, ReplayGradient> = {};

  const target: Record<string, unknown> = {
    save: mk('save'),
    restore: mk('restore'),
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push(`transform(${[a, b, c, d, e, f].join(',')})`);
    },
    translate: mk('translate'),
    rotate: mk('rotate'),
    scale: mk('scale'),
    fillRect: mk('fillRect'),
    strokeRect: mk('strokeRect'),
    beginPath: mk('beginPath'),
    rect: mk('rect'),
    clip: mk('clip'),
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

    createLinearGradient(x0: number, y0: number, x1: number, y1: number): ReplayGradient {
      const id = `lg${gradientId++}`;
      calls.push(`createLinearGradient(${[x0, y0, x1, y1].join(',')})`);
      const stops: { pos: number; col: string }[] = [];
      const g: ReplayGradient = {
        addColorStop(pos: number, col: string) {
          stops.push({ pos, col });
          calls.push(`addColorStop(${pos.toFixed(3)},${col})`);
        },
      };
      gradients[id] = g;
      return g;
    },

    createRadialGradient(
      x0: number,
      y0: number,
      r0: number,
      x1: number,
      y1: number,
      r1: number,
    ): ReplayGradient {
      const id = `rg${gradientId++}`;
      calls.push(`createRadialGradient(${[x0, y0, r0, x1, y1, r1].join(',')})`);
      const stops: { pos: number; col: string }[] = [];
      const g: ReplayGradient = {
        addColorStop(pos: number, col: string) {
          stops.push({ pos, col });
          calls.push(`addColorStop(${pos.toFixed(3)},${col})`);
        },
      };
      gradients[id] = g;
      return g;
    },

    createConicGradient(angle: number, cx: number, cy: number): ReplayGradient {
      const id = `cg${gradientId++}`;
      calls.push(`createConicGradient(${[angle, cx, cy].join(',')})`);
      const stops: { pos: number; col: string }[] = [];
      const g: ReplayGradient = {
        addColorStop(pos: number, col: string) {
          stops.push({ pos, col });
          calls.push(`addColorStop(${pos.toFixed(3)},${col})`);
        },
      };
      gradients[id] = g;
      return g;
    },

    createPattern(_image: CanvasImageSource, repetition: string): CanvasPattern | null {
      calls.push(`createPattern(${repetition})`);
      return {} as CanvasPattern;
    },
  };

  Object.entries(tracked).forEach(([k, desc]) => {
    Object.defineProperty(target, k, desc);
  });

  return { target: target as unknown as ReplayTarget, calls, props };
}

export function mockImage(src: string, w: number, h: number): HTMLImageElement {
  return {
    src,
    naturalWidth: w,
    naturalHeight: h,
    toString: () => src,
  } as unknown as HTMLImageElement;
}
