# Offline Verification

1. Run `build-standalone.bat`.
2. Open `dist/index.html` and `dist/index.self-extract.html` directly.
3. Open browser developer tools and clear the Network panel.
4. Enable offline mode or disconnect the device.
5. Reload the local HTML.
6. Exercise every core input, editing, preview, worker, and export flow.
7. Confirm there is no failed external resource request and no console error.
8. Change the suggested output filename, export, and confirm both the filename and file contents are correct.
9. If the app can replace its primary input while processing, change the input mid-process and confirm no stale result from the old input appears.
10. Confirm output files still open correctly.

For GitHub Pages, one initial request downloads the HTML. Clear the Network panel after the page has loaded, then test the complete app flow.


## Self-extracting variant

Open `dist/index.html` first and confirm that the browser favicon and upper-left application brand icon use the same artwork from `assets/favicon.svg`. Then open `dist/index.self-extract.html` directly, confirm that the loading screen text is readable, the same favicon as `dist/index.html` is visible, and the loading screen disappears. Repeat the same offline checks and verify that the browser console contains no decompression or CSP errors. `scripts/verify-self-extract.ps1` also enforces an ASCII-only loader and byte-for-byte restoration of the readable HTML.
## Optional WebRTC QR pairing component

The starter does not enable WebRTC by default. If the application copies `components/webrtc-qr-pairing.html`, verify the connection behavior separately in addition to the normal no-CDN/API checks:

1. Confirm `RTCPeerConnection` is created with `iceServers: []`.
2. Confirm no signaling server, STUN, TURN, WebSocket, fetch/XHR API, or runtime CDN was added.
3. Complete a host → joining device → host QR exchange on the same reachable LAN.
4. Confirm Offer/Answer QR data is not shown until ICE gathering reaches `complete`.
5. Deny camera permission and confirm the manual copy/paste signaling fallback remains usable.
6. Test connect → disconnect → reconnect repeatedly so stale PeerConnection/DataChannel events do not corrupt the next attempt.
7. Test a pre-connect joining-side ICE failure and confirm the Answer QR is regenerated with a fresh PeerConnection/session.
8. Force a network failure (for example, a guest network or client-isolation environment) and confirm diagnostics explain candidate/route state without exposing IP addresses.

`connect-src 'none'` remains expected. The direct WebRTC DataChannel is intentional peer-to-peer application traffic, not a hidden runtime dependency.

