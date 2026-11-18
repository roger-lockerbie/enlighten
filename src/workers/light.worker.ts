/**
 * The light worker shell (ADR 0010): it solves radiosity for a scene and posts the layers back, so
 * a solve of a second or two never holds up the page or the bus. All of the work is in
 * `src/light`. The page ends this worker and starts another when a newer scene supersedes the one
 * being solved (ADR 0017).
 */
import { answer } from '../light/protocol.ts';

interface WorkerScope {
  postMessage(m: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (ev) => {
  answer(ev.data, (reply, transfer) => {
    scope.postMessage(reply, transfer);
  });
};
