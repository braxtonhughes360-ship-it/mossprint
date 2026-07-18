# Installing MOSS on macOS

MOSS beta builds are **unsigned** — we haven't bought Apple's developer certificate yet — so macOS is cautious with the app the first time you open it. That caution is a good instinct on Apple's part. Here's how to tell your Mac that you chose this app, in about twenty seconds.

## The normal path

1. Open the `.dmg` you downloaded from [Releases](https://github.com/braxtonhughes360-ship-it/mossprint/releases).
2. Drag **MOSS** into **Applications**.
3. In Applications, **right-click (or Control-click) MOSS → Open**, then click **Open** in the dialog.

That's it — the right-click matters only the very first time. After that, MOSS opens like any other app.

## If macOS says "MOSS is damaged and can't be opened"

It isn't damaged — that's macOS's quarantine flag being extra strict with an unsigned download. Clear it with one command:

1. Open **Terminal** (press <kbd>⌘Space</kbd>, type `terminal`, press Return).
2. Paste this and press Return:

   ```bash
   xattr -cr /Applications/MOSS.app
   ```

3. Open MOSS normally.

The command removes the "this came from the internet" tag from the app you just installed — nothing more.

## The keychain question

When you first sign in to Google (or add a mail account), macOS may ask for your **Mac login password** so MOSS can keep your sign-in tokens in the keychain — the same place your other apps keep theirs. Choose **Always Allow**.

One honest note: because the beta is unsigned, macOS can forget that permission when MOSS updates, and it may ask again. Annoying, known, and not a bug in your setup.

## When does this all go away?

At **1.0**, when we ship signed and notarized builds. Then it's open-the-dmg, drag, done — no right-click, no Terminal, no repeat keychain prompts.

Until then: only download MOSS from this repository's [Releases page](https://github.com/braxtonhughes360-ship-it/mossprint/releases), or build it from source (`npm run package`) — same app, nobody in between.
