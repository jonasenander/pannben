import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const app = mount(App, { target: document.getElementById("app")! });

/**
 * Register the offline shell, and keep it current.
 *
 * The first version registered and stopped there, which is why the installed
 * app kept serving an old build. Three things were missing, and all three had
 * to be true for an update to land:
 *
 *  - `updateViaCache: "none"`, so the browser fetches `/sw.js` itself rather
 *    than handing back its own cached copy of the worker.
 *  - An actual check. A home-screen PWA resumes instead of cold-starting, so
 *    without asking on every foreground it can go for weeks without looking.
 *  - A reload. `skipWaiting` and `clients.claim` in the worker mean the *new*
 *    worker takes control, but the page already running is still the old HTML
 *    and the old bundle. Nothing swaps it out on its own.
 */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  /**
   * On a page that loads with no worker yet — the very first visit — the first
   * `controllerchange` is that worker taking initial control. The page it
   * claims came off the network moments ago, so there is nothing stale to
   * replace and reloading would be a flash for no reason.
   *
   * Every change after that one *is* a replacement, and so is the first one on
   * any later visit, where a worker is already in charge before this script
   * runs. Read the state now, before registering, or the answer changes under
   * us.
   */
  let claimed = navigator.serviceWorker.controller !== null;

  window.addEventListener("load", async () => {
    let registration: ServiceWorkerRegistration;
    try {
      registration = await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });
    } catch (err) {
      // A failed registration means no offline shell — say so, don't swallow it.
      console.error("service worker registration failed", err);
      return;
    }

    // Ask on every foreground. Cheap: a 304 when nothing changed.
    const check = () => {
      if (document.visibilityState === "visible") void registration.update();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);

    // One reload when a new worker *replaces* another, and only one: without
    // the guard a worker that keeps claiming would leave the app in a loop.
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!claimed) { claimed = true; return; } // initial claim, nothing stale
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}

export default app;
