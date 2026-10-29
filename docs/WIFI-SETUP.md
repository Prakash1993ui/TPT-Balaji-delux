# Room Wi-Fi setup

## Recommended platform

Use a MikroTik RouterOS 7 HotSpot gateway. The hAP ax³ is one suitable starting
model for a small property, with wired access points added after a coverage survey.
Do not assume a single router covers a hotel: walls, floors, concurrent guests and
the internet line determine the final access-point count and gateway capacity.

This integration generates **hotspot portal logins**, not a different WPA password
for each room on a conventional shared-password SSID. Guests connect to the hotel
SSID and log in using the room credentials. Keep guest traffic isolated from hotel
management devices; have the installer configure guest isolation and the firewall.

Official references:
- https://mikrotik.com/product/hap_ax3
- https://manual.mikrotik.com/docs/authentication-authorization-accounting/hotspot-captive-portal/
- https://manual.mikrotik.com/docs/developer-guides/rest-api/

## Installer checklist

1. Configure RouterOS HotSpot on the guest network and test its login page.
2. Create a `hotel-guests` HotSpot profile. Choose bandwidth, simultaneous-device
   and session limits appropriate for the internet connection. This app does not
   create the profile or alter the firewall.
3. Enable the HTTPS REST API on RouterOS with a certificate trusted by the hotel
   server. Use a dedicated API account restricted to the hotel server address and
   only the needed read/write/API policies. RouterOS permissions are broad: keep
   this account private and never expose the management API to the guest network
   or public internet. Use a private LAN or VPN from a hosted hotel server.
4. Set these environment variables **on the hotel server**, not GitHub Pages or
   in browser settings:

   ```text
   MIKROTIK_URL=https://router.example.internal
   MIKROTIK_USERNAME=hotel-api
   MIKROTIK_PASSWORD=<set privately on your server>
   MIKROTIK_HOTSPOT_PROFILE=hotel-guests
   ```

   For a private certificate authority, configure Node's `NODE_EXTRA_CA_CERTS`
   with the CA file. Do not turn off TLS verification.
5. Restart the hotel server. In Room Wi-Fi select a room and the real SSID, generate
   the credentials, wait for Live sync, then choose **Activate on MikroTik** as an
   admin or manager. Activation success is shown only after a successful router response.
6. Join the guest network with a test phone and verify the login, internet access,
   guest isolation, bandwidth and device limits before giving credentials to guests.

## Rotation and checkout

Each generated credential has a new username, so replacing credentials does not
silently overwrite an unrelated router account. **Old logins remain valid until
removed or disabled in RouterOS.** At checkout the receptionist/installer must disable
that account and terminate its active sessions in RouterOS. Automatic checkout
revocation and wall-clock expiry are not implemented. Do not confuse a HotSpot
usage/uptime limit with expiration at the guest's checkout time.

In GitHub Pages/offline mode, generation, copying and printing work, but activation
requires the hotel server. Printed slips are for activated accounts only. Router API
secrets stay on the server; generated guest credentials are part of hotel backups.

The adapter is tested with simulated router responses; physical-router activation
must be validated during installation.

## Normal shared Wi-Fi (no special router required)

Use **Normal Wi-Fi — same password for everyone in a room** when a room already has
its own router/SSID/password. Save the existing SSID and password once; every guest
in that room receives the same details until a manager updates them.

Use **Normal Wi-Fi — one password for all hotel guests** for a conventional hotel-wide
guest network. Save the SSID and password once, then copy or print the same details
for every room. A normal shared-password router is sufficient for this mode.

These modes store and distribute details only: they never change the router. Enter
the existing password (8–63 characters or a 64-digit hexadecimal WPA key). Managers
can change the saved details; front-desk staff can view, copy and print them. Shared
Wi-Fi records are separate from generated hotspot accounts, so switching modes does
not delete existing credentials or disable router accounts.
