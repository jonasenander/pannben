# 0011 — Making it stop feeling like a web page

**Phase:** 7c · **Date:** 2026-09-10

## Context

Tapping `+` and `−` repeatedly to set reps zoomed the page. Pinch zoomed it
too. Both are browser defaults, and the set row's stepper is the one control in
this app that gets tapped fast and repeatedly — so this was not cosmetic, it
actively fought the thing the app exists to do.

## Decision

**`touch-action: manipulation`** is the fix for the reported bug, and it is a
CSS one rather than a viewport one. A phone treats two fast taps in the same
place as double-tap-to-zoom; this says a second tap is never a zoom gesture. It
also removes the ~300 ms the browser otherwise spends waiting to see whether a
second tap is coming, so the stepper answers immediately.

`touch-action` is not an inherited property, but the allowed behaviours are
intersected down the ancestor chain, so setting it on `body` covers the app. It
is repeated on the interactive elements to say so where the control is.

**Pinch needs the viewport meta**, `maximum-scale=1, user-scalable=no`. Safari
ignores these in a browser tab and honours them in a home-screen app, which is
how this is used.

Three more of the same family, because they are the same complaint:
`-webkit-tap-highlight-color: transparent` (the grey flash), `user-select: none`
on the chrome, and `overscroll-behavior: none` (no rubber-band).

**`user-select` is scoped.** `input` and `textarea` keep `text`, because
session and exercise notes are text and text has to be selectable. A blanket
`none` would have quietly broken note editing — and there is a Playwright
assertion on exactly that, so it cannot regress unnoticed.

## The trade-off, on the record

Blocking pinch removes a real accessibility affordance (WCAG 1.4.4). This is a
private single-user app and the owner asked for it directly; body text is
already 15–16 px on a deliberate type scale, and the phone's own system-wide
zoom is unaffected. It is one attribute to put back.

## Consequences

The three checks are automated even though the real test is a thumb: the
rendered viewport meta, the computed `touch-action` on a live `+` button, and
`user-select` being `none` on `body` but `text` on a note input.
