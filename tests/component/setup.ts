// Runs before every component test file (vitest.config.ts: setupFiles).
//
// 1. lib/supabase is replaced by the fake client in tests/support/fake-supabase.ts, so the real
//    screens run without a network. This path is the only place that knows where the client
//    module lives: if it moves, change it here.
// 2. Browser APIs jsdom does not provide are stubbed.
// 3. Every test starts clean: fake client, in-memory cache, URL, storage, timers.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { clearCache, setCacheOwner } from "../../lib/cache";
import { fake } from "../support/fake-supabase";

vi.mock("../../lib/supabase", async () => {
  const { fake: shared } = await import("../support/fake-supabase");
  return { supabase: shared.client };
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
  vi.useRealTimers();
  fake.reset();
  clearCache();
  setCacheOwner(null);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});
