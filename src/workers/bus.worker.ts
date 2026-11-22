/**
 * The bus worker shell (ADR 0010). It builds the real clock, the simulated bench and, when the page
 * came from the server with a token, the server transport, and hands them to the engine. It never
 * sends a frame itself: the engine's router does (SPEC S2.1).
 *
 * One function receives and one posts. Panic is handled as soon as it is read, before any call.
 */
import { TimerClock } from '../bus/clock.ts';
import { withFloors } from '../bus/timing.ts';
import { Engine } from '../engine/engine.ts';
import {
  consoleContext,
  parseToWorker,
  type Call,
  type CallResult,
  type FromWorker,
  type ToWorker,
} from '../engine/protocol.ts';
import { fitBench, unitProfile } from '../sim/settings.ts';
import { DEFAULT_CEILING_ARC } from '../safety/governor.ts';
import { extraUnit, Simulator } from '../sim/simulator.ts';
import { ServerTransport, type WebSocketLike } from '../transport/server.ts';
import { SimTransport } from '../transport/sim.ts';

interface WorkerScope {
  postMessage(m: unknown): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  readonly location: { readonly href: string };
}

const scope = self as unknown as WorkerScope;
let engine: Engine | undefined;

function post(m: FromWorker): void {
  scope.postMessage(m);
}

function start(m: Extract<ToWorker, { type: 'init' }>): Engine {
  const token = m.token;
  const clock = new TimerClock({
    now: () => performance.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (h) => {
      clearTimeout(h as Parameters<typeof clearTimeout>[0]);
    },
  });
  const timing = withFloors({});
  // A stored set-up that cannot hold the starting ceiling starts from its defaults (SPEC R6.5).
  const bench = fitBench(m.bench ?? {}, m.ceilingArc ?? DEFAULT_CEILING_ARC);
  const sim = Simulator.bench({
    at: clock.now(),
    a: unitProfile('A', bench.A),
    b: unitProfile('B', bench.B),
  });
  const extras = m.extras ?? [];
  for (const x of extras) sim.add(extraUnit(x, clock.now()));
  const simTransport = new SimTransport(sim, clock, timing);
  let hardware: ServerTransport | undefined;
  if (token !== undefined) {
    // The page's own origin: the server serves the app and /bus from one origin (ADR 0003).
    const url = new URL('/bus', scope.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    hardware = new ServerTransport({
      clock,
      token,
      // A real WebSocket has the shape the transport uses; only the handlers' event types differ.
      open: () => new WebSocket(url.href) as unknown as WebSocketLike,
      onState: (s, reason) => {
        engine?.onTransportState(s, reason);
      },
      onDevice: (attached) => {
        engine?.onDevice(attached);
      },
    });
  }
  const e = new Engine({
    clock,
    sim,
    simTransport,
    timing,
    bench,
    extras,
    dryTransport: (copy, virtual) => new SimTransport(copy, virtual, timing),
    ...(m.ceilingArc === undefined ? {} : { ceilingArc: m.ceilingArc }),
    ...(hardware === undefined ? {} : { hardware }),
  });
  e.subscribe((snapshot) => {
    post({ type: 'snapshot', snapshot });
  });
  return e;
}

async function handle(e: Engine, call: Call): Promise<CallResult> {
  // Everything the page asks for comes from a person at the UI. A typed console line is `console`,
  // and a script's steps are `script`, set inside the engine (ADR 0014).
  const src = 'ui';
  switch (call.op) {
    case 'setTarget':
      return e.setTarget(call.target, src);
    case 'reconnect':
      return e.reconnect(src);
    case 'resume':
      return e.resume(src);
    case 'setCeiling':
      return e.setCeiling(call.arc, src, call.confirmed);
    case 'unlock':
      return e.unlock(call.unlock, src, call.confirmed);
    case 'lock':
      e.lock(call.unlock);
      return { ok: true };
    case 'swingLimit':
      return e.setSwingLimit(call.n, src);
    case 'canSee':
      return e.answerCanSee(call.can, src);
    case 'request':
      return e.request(call.intent, src);
    case 'rescan':
      return e.rescan(src);
    case 'reapplyProfile':
      return e.reapplyProfile(src);
    case 'commission':
      return e.commission(src, call.typed);
    case 'check':
      return e.runCheck(call.step, src, {
        ...(call.confirmed === undefined ? {} : { confirmed: call.confirmed }),
        ...(call.note === undefined ? {} : { note: call.note }),
        ...(call.skip === undefined ? {} : { skip: call.skip }),
      });
    case 'checkReport':
      return { ok: true, text: e.checkReportText() };
    case 'clearCheck':
      e.clearCheck();
      return { ok: true };
    case 'clearDivergences':
      e.clearDivergences();
      return { ok: true };
    case 'bench':
      return e.setBench(call.setup, src);
    case 'extras':
      return e.setExtras(call.extras, src);
    case 'planCheck':
      return e.planCheck(call.run, src);
    case 'runPlan':
      return e.runDesign(call.run, src);
    case 'stopRun':
      e.stopRun();
      return { ok: true };
    case 'sceneWrite':
      return e.sceneWrite(call.address, call.slot, call.look, src);
    case 'sceneRemove':
      return e.sceneRemove(call.address, call.slot, src);
    case 'sceneRead':
      return e.sceneRead(call.address, src);
    case 'sceneRecall':
      return e.sceneRecall(call.target, call.slot, call.fade, src);
    case 'console': {
      const c = consoleContext(call.aliases, call.use);
      if (!c.ok) return c;
      return e.console(call.line, c.ctx, call.confirmed === true);
    }
    case 'runScript': {
      const c = consoleContext(call.aliases);
      if (!c.ok) return c;
      return e.runScript(call.name, call.text, c.ctx);
    }
    case 'scriptContinue':
      return e.scriptContinue();
    case 'stopConsole':
      e.stopConsole();
      return { ok: true };
  }
}

function receive(data: unknown): void {
  const m = parseToWorker(data);
  if (m === undefined) return;
  switch (m.type) {
    case 'panic': {
      // Latch and drop every queue now; the frames follow. Confirm at once (SPEC S4.5).
      const p = engine?.panic();
      post({ type: 'panicked', id: m.id });
      void p;
      return;
    }
    case 'init':
      engine ??= start(m);
      return;
    case 'heartbeat':
      engine?.heartbeat(m.visible);
      return;
    case 'call': {
      const e = engine;
      if (e === undefined) return;
      const id = m.id;
      handle(e, m.call).then(
        (result) => {
          post({ type: 'reply', id, result });
        },
        (err: unknown) => {
          post({
            type: 'reply',
            id,
            result: { ok: false, reason: err instanceof Error ? err.message : String(err) },
          });
        },
      );
      return;
    }
  }
}

scope.onmessage = (ev) => {
  receive(ev.data);
};
