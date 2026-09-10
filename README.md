# 360 Tour Builder

Two pages, one tour:

- **`/` — the viewer.** Read-only. Anyone with the link can look around and click
  between rooms. Safe to send to clients.
- **`/editor` — the editor.** Add or remove 360 photos, rename scenes, connect
  scenes together, and set the project's name and description. Protected by an
  edit key (see below) so random visitors can't change your tour.

Both pages talk to the same backend, so anything you do in the editor shows up in
the viewer immediately.

## What's new in this version

- **Bottom thumbnail strip.** The viewer now shows a scrollable row of room
  thumbnails along the bottom, with the current one highlighted — click any
  thumbnail to jump straight there.
- **Floor plan overlay.** In the editor sidebar, under "Floor plan (optional)",
  attach a single image (ideally a transparent PNG) and it appears as a small
  overlay in the top-left corner of both the editor and the public viewer.
  Replace or remove it any time.
- **Mobile-friendly layout.** The viewer works full-screen on phones, with
  larger touch targets and a layout that adapts to narrow screens. The editor's
  sidebar stacks above the viewer on small screens instead of squeezing it.
- **Gyroscope look control.** On phones that support it, a compass button
  appears bottom-right in the viewer. Tap it (iPhones will ask for a one-time
  motion permission) to look around by physically moving the phone instead of
  dragging. Tap again to go back to drag mode. This is a best-effort
  implementation — it calibrates from wherever you're facing when you tap the
  button, so it may need a re-tap if it feels off after rotating a lot.

## Setting an edit key (recommended)

Without an edit key, anyone who finds `/editor` can edit the tour. Set one before
putting this on the internet.

- **Pi / self-hosted:** set the `EDIT_KEY` environment variable before starting
  the server (see the systemd example below).
- **Netlify:** Site settings → Environment variables → add `EDIT_KEY`.

The first time you try to edit something, the editor will ask you to type the key
once and remembers it in your browser after that.

## Option A — Raspberry Pi (or any computer), running 24/7

1. **Install Node.js** on the Pi if it isn't already there (Node 18+):
   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
2. **Copy this folder** onto the Pi (via `git clone`, `scp`, or a USB stick).
3. **Install and start it**:
   ```
   cd tour-app
   npm install
   EDIT_KEY=something-only-you-know npm start
   ```
   - Viewer: `http://<your-pi-ip>:3000/`
   - Editor: `http://<your-pi-ip>:3000/editor`

   Photos and tour data are saved to `tour-app/data/` on the Pi's own storage —
   nothing leaves the device.
4. **Keep it running 24/7** with a systemd service so it survives reboots and crashes:
   ```
   sudo tee /etc/systemd/system/tour-builder.service > /dev/null <<'EOF'
   [Unit]
   Description=360 Tour Builder
   After=network.target

   [Service]
   ExecStart=/usr/bin/node /home/pi/tour-app/server.js
   Restart=always
   User=pi
   Environment=PORT=3000
   Environment=EDIT_KEY=something-only-you-know

   [Install]
   WantedBy=multi-user.target
   EOF

   sudo systemctl enable --now tour-builder
   ```
   (Adjust the `ExecStart` path if you copied the folder somewhere other than
   `/home/pi/tour-app`, and pick your own `EDIT_KEY`.)
5. **Access it from other devices on your network** at `http://<pi-ip>:3000`. To get
   a proper public link (so you can share a tour with a client from anywhere), the
   easiest route is a free [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
   pointed at port 3000 — it gives you a stable `https://` URL without opening ports
   on your router.

## Option B — Netlify

Netlify doesn't offer persistent local disk, so this option stores photos in
[Netlify Blobs](https://docs.netlify.com/blobs/overview/) instead — no extra database
to set up, it's built into Netlify.

1. Push this folder to a GitHub repo.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Netlify will read `netlify.toml` automatically (publish dir `public/`, functions in
   `netlify/functions/`) — no build command needed, just deploy.
4. In **Site settings → Environment variables**, add `EDIT_KEY` with a value only you know.
5. That's it:
   - Viewer: `https://your-site.netlify.app/`
   - Editor: `https://your-site.netlify.app/editor`

You can also run it locally with the Netlify CLI (`netlify dev`) to test before
deploying.

## Which should I use?

- **Pi**: best if you want full control, no third-party accounts, and don't mind
  handling your own public URL (e.g. via Cloudflare Tunnel).
- **Netlify**: best if you want a public link instantly with zero server maintenance.

Both use the exact same editor/viewer pages — you can even try one, then switch to
the other later; the data isn't shared between them, so you'd re-upload photos if
you switch.
