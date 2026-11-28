// Runs before every component test file (vitest.config.ts: setupFiles).
//
// 1. lib/supabase is replaced by the fake client in tests/support/fake-supabase.ts, so the real
//    screens run without a network. This path is the only place that knows where the client
//    module lives: if it moves, change it here.
// 2. components/ui/toast is wrapped by tests/support/toast-spy.ts: `notifySpy()` (tests/support/helpers.ts) makes `useToast()` answer a
//    spy for the rest of the test, so a screen rendered on its own, with no ToastProvider, shows its toasts to the test. With no spy
//    made, `useToast()` is the real one. No test file mocks the toast module itself.
// 3. Browser APIs jsdom does not provide are stubbed.
// 4. Every test starts clean: fake client, in-memory cache, URL, storage, timers, toast spy.
import "@testing-library/jest-dom/vitest";
import { configure as configureDom, getConfig } from "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { clearCache, setCacheOwner } from "../../lib/cache";
import { fake } from "../support/fake-supabase";
import { forgetToastSpy } from "../support/toast-spy";

vi.mock("../../lib/supabase", async () => {
  const { fake: shared } = await import("../support/fake-supabase");
  return { supabase: shared.client };
});

vi.mock("../../components/ui/toast", async (importOriginal) => {
  const { withToastSpy } = await import("../support/toast-spy");
  return withToastSpy(await importOriginal<typeof import("../../components/ui/toast")>());
});

// jsdom builds a form's FormData from files it holds itself, so a file a test puts into a file input
// (userEvent.upload, fireEvent.change) never reaches `new FormData(form)`: the screens would read an empty file.
// This makes FormData read `input.files` the way a browser does.
const JsdomFormData = window.FormData;
class FormDataWithFiles extends JsdomFormData {
  constructor(form?: HTMLFormElement, submitter?: HTMLElement | null) {
    super(form, submitter);
    if (!form) return;
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="file"][name]')) {
      const file = input.files?.[0];
      if (file && file.size) { this.delete(input.name); this.append(input.name, file); }
    }
  }
}

// A find*/waitFor that has just succeeded must hand back a screen on which React's effects have run.
//
// React commits a render to the DOM and runs its passive effects (the `useEffect`s: a dialog registers its Escape handler and moves the focus
// in, a hook asks the browser for an idle callback, a list starts its fetch) in a separate task that it queues with the real setImmediate
// (scheduler). Testing Library's asyncWrapper gives control back after a `setTimeout(0)`. Both are queued by the same commit, but a timer
// runs first as soon as one millisecond has passed since it was set, and a setImmediate callback only runs after the timers that are due: on an idle
// machine the effects win, on a loaded one (the whole suite on four busy cores, or CI) the test resumed with the DOM drawn and the effects
// not run yet. Escape pressed on a dialog that had not registered its handler was lost, focus had not moved in, a hook had not yet asked for its
// idle callback. Waiting one more real setImmediate (the same queue the scheduler uses, taken before any test can fake the timers) puts the test
// behind everything React had already queued, whatever the load. It waits for no time and for no state: it is an order, not a delay.
const nextTask = globalThis.setImmediate.bind(globalThis);
const rtlAsyncWrapper = getConfig().asyncWrapper;
configureDom({
  asyncUtilTimeout: 5000,
  asyncWrapper: async (callback) => {
    const result = await rtlAsyncWrapper(callback);
    await new Promise<void>((resolve) => nextTask(() => resolve()));
    return result;
  },
});

beforeEach(() => {
  vi.stubGlobal("FormData", FormDataWithFiles);
  window.scrollTo = vi.fn();
  window.open = vi.fn(() => null);
  window.confirm = vi.fn(() => true);
  window.prompt = vi.fn(() => null);
  window.alert = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  fake.reset();
  forgetToastSpy();
  clearCache();
  setCacheOwner(null);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});
