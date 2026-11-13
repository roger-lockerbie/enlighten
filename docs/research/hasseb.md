# hasseb USB DALI Master and WebHID

Research for Stage 1, read on 13 and 14 November 2026. The hasseb has not arrived, so nothing here is measured. The protocol comes from python-dali 0.16 and the vendor's own protocol note. The USB details are inferred from the microcontroller's documentation and the vendor's firmware file, and that inference raises a risk to the WebHID plan, set out in section 3.

## Sources

| Key    | Source                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PD     | python-dali 0.16, `dali/driver/hasseb.py` and `dali/driver/hid.py`, cited by line. The sdist was checked against the hash in `tools/golden/requirements.txt`.                                                 |
| FW     | The vendor's protocol note: https://github.com/hasseb/python-dali/blob/master/dali/driver/hasseb_firmware/README.md                                                                                           |
| SHOP   | Product page: https://hasseb.fi/shop3/index.php?route=product%2Fproduct&product_id=52                                                                                                                         |
| UM     | NXP UM10375, the LPC1343 user manual, Rev. 5: https://docs.rs/crate/lpc13xx/0.0.0/source/UM10375.pdf                                                                                                          |
| DRAFT  | An independent, unfinished firmware rewrite: https://github.com/sde1000/hasseb-usb                                                                                                                            |
| SPEC   | The WebHID standard, now at WHATWG: https://hid.spec.whatwg.org/ (source at https://github.com/whatwg/hid/blob/main/index.bs)                                                                                 |
| CHROME | Chrome's WebHID guide: https://developer.chrome.com/docs/capabilities/hid                                                                                                                                     |
| BCD    | MDN browser compatibility data: https://github.com/mdn/browser-compat-data/blob/main/api/HIDDevice.json                                                                                                       |
| CRHID  | Chromium source: `services/device/public/cpp/hid/hid_report_utils.cc`, `content/browser/hid/hid_service.cc` and `services/device/hid/hid_connection.cc` under https://github.com/chromium/chromium/blob/main/ |

## 1. The device

Confirmed:

- The microcontroller is an NXP LPC1343 (SHOP, FW). It is USB HID and needs no driver on Windows, macOS or Linux (SHOP).
- It has an integrated bus power supply and galvanic isolation between the bus and USB. A 24 V supply is included. The page says a DALI bus "requires a 16 V voltage source with a current limit of 200 mA" (SHOP). The supply's guaranteed current is not stated.
- The firmware is closed and shipped as a binary. The vendor has said it is based on NXP example code, which is why it has not been opened (https://github.com/sde1000/python-dali/pull/67).
- There are two firmware generations. The original used 2-byte reports and an internal table of which commands reply. Version 2.0, from November 2019, uses 10-byte reports with a 0xAA first byte (commit history of the firmware folder in the vendor's fork). `dali/driver/hid.py` speaks the old protocol and `dali/driver/hasseb.py` the new one.
- "Input buffer of 10 messages and output buffer of 2 messages are implemented into the device" (FW).
- 24-bit frames: "The default is 16 bits. 24-bit frames will be supported in future" (FW). The device cannot talk to DALI-2 control devices by that note, which matches the brief.
- Firmware 2.0 has a sniffing mode (FW). The brief's statement that the hasseb cannot hear other devices comes from the old firmware's driver (PD `hid.py:735`). A third-party script enables sniffing and prints whole 16-bit frames from current units (https://github.com/peterisza/iec62386-wall-panel). This does not change the brief's conclusion, because input devices use 24-bit frames.
- Firmware is updated by shorting jumper JP1, after which the device appears as a USB disk (FW).

New since the brief was written: the vendor's repository gained support, between June and October 2026, for an STM32-based unit with Ethernet, with USB vendor 0x0483 and product 0x0803 (https://github.com/hasseb/python-dali/blob/master/gui/hasseb.py). A filter on 0x04CC and 0x0802 would not match such a unit. Check which one arrives.

Not confirmed: the firmware version shipping today, whether a unit could still arrive with the old 2-byte firmware, and whether the device appears in the DALI Alliance database.

## 2. The 10-byte protocol

### Host to device

From PD `hasseb.py:119-141` (`construct`) and FW. The two agree.

| Byte | Meaning                                                                  | python-dali sends                                                       |
| ---- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 0    | Preamble                                                                 | 0xAA                                                                    |
| 1    | Command                                                                  | 0x07 send frame, 0x02 read firmware version, 0x05 configure device      |
| 2    | Sequence number                                                          | 1 to 255, then back to 1. "zero is not an allowed sequence number" (FW) |
| 3    | Frame length in bits                                                     | 16                                                                      |
| 4    | Expect a reply                                                           | 1 if the command is a query, otherwise 0                                |
| 5    | Reserved (the driver calls it transmitter settling time)                 | 0                                                                       |
| 6    | Send twice: 0 for once, otherwise the delay between the two frames in ms | 10 for send-twice commands, otherwise 0                                 |
| 7, 8 | The DALI frame, address byte first                                       | the two frame bytes                                                     |
| 9    | Third data byte, for 24-bit frames                                       | 0                                                                       |

Other commands: read firmware version is `AA 02 sn 00 ...` (PD `hasseb.py:205-221`). Configure device is `AA 05 sn mode ...`, with mode 1 to enable sniffing and 0 to disable it (PD `hasseb.py:223-237`). FW lists 0x01, 0x03, 0x04 and 0x06 as not implemented.

### Device to host

From PD `hasseb.py:143-173` (`extract`) and FW.

| Byte   | Meaning                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------- |
| 0      | 0xAA                                                                                               |
| 1      | Report type: 0x00 no operation (ignore), 0x02 firmware version, 0x07 transmission report           |
| 2      | Sequence number of the command this answers. Zero for reports the device generates by itself (FW). |
| 3      | For type 0x07, the status. For type 0x02, the major version.                                       |
| 4      | For type 0x07, a length. For type 0x02, the minor version.                                         |
| 5 to 7 | Data. A backward frame is in byte 5.                                                               |

Status codes in byte 3 of a transmission report:

| Code | Meaning            | python-dali returns                                      |
| ---- | ------------------ | -------------------------------------------------------- |
| 1    | No answer          | a response built from `None` (a valid "no")              |
| 2    | Answer received    | `BackwardFrame(data[5])`, if byte 4 is 1                 |
| 3    | Invalid answer     | `BackwardFrameError(255)` (a collision or framing error) |
| 4    | Answer too early   | a marker object                                          |
| 5    | Sniffer byte       | a marker object                                          |
| 6    | Sniffer byte error | a marker object                                          |

### Points where the sources disagree or the driver is loose

- **Byte 4 of a reply.** FW says "data length in bits", which would be 8 for a backward frame. python-dali accepts a reply only when `data[4] == 1` (PD `hasseb.py:156`), and a separate Node client does the same (https://github.com/NikolayLiber/node-dali). The firmware probably reports 1. The app should accept 1 or 8, and record what the device sends.
- **Sequence numbers are not checked by python-dali.** `receive` takes the next report with a backward frame as the answer to whatever is pending (PD `hasseb.py:191-203`). The app should match byte 2 against the command it sent and drop anything else. That costs nothing and removes a class of mismatched replies.
- **Timeouts.** The synchronous driver gives up after 200 reads (PD `hasseb.py:269-276`). The asynchronous one waits 200 times 10 ms. With a timeout, python-dali passes `None` on, which reads as "no reply". The app must keep "the gear said nothing" (status 1) apart from "the hasseb said nothing" (a transport fault), because for the governor's verification of MAX LEVEL the difference matters.
- **Pacing.** The driver sleeps 20 ms before every send, with the comment "a delay between sent messages need to be at lest 22*417 µs" (PD `hasseb.py:176`). The vendor's fork uses 15 ms. With the device's input buffer of 10 messages, the app could queue ahead, but then loses control of timing. Send one frame, wait for its report or a timeout, then send the next.
- **Send twice.** The firmware repeats the frame itself after the delay in byte 6. python-dali uses 10 ms. Whether that 10 ms is the whole gap between frames or is added to a built-in settling time is not known. `dali.md` gives the limits the gap has to meet. Measure it with sniffing on, or with a scope.
- **Device type commands.** For a DT8 command, `run_sequence` sends ENABLE DEVICE TYPE 8 and then the command (PD `hasseb.py:109-112`). For a DT8 command that is also send-twice, the bus sees ENABLE DEVICE TYPE, command, command. Whether DA5-L accepts that, or needs ENABLE DEVICE TYPE before each copy, is a question for `dali.md` and the bench. The app can send the two copies itself as separate frames if needed, at the cost of looser timing.
- **Idle reports.** The old firmware sent "NO DATA AVAILABLE" reports continuously (PD `hid.py:799-800`). Both clients of the new firmware still ignore type 0 reports, which suggests they still occur. The transport must drop them cheaply and must not log each one.

### The 2-byte protocol, and why not to use it

PD `hid.py:732-808`. The device "contains an internal table of commands that produce responses. This table doesn't cover device types other than zero. If you send a command it doesn't know that expects a response, the driver will deadlock." DT8 queries are exactly such commands. This confirms the brief's decision.

## 3. The USB descriptor, and a risk to the WebHID plan

Nobody has published a descriptor dump from a real unit. What follows is inference.

### What the descriptor probably is

- The vendor's firmware file contains the strings "hasseb" and "DALI Master" but no descriptor bytes, and it contains the address 0x1fff1ff8. That is the pointer to the LPC1343's built-in ROM USB driver: "ROM \*\* rom = (ROM \*\*)0x1fff1ff8;" (UM section 11.4.2). The research read the file's bytes through the GitHub API to check this. It was not saved or run.
- The ROM driver's HID report descriptor is fixed, except for the two report lengths (UM Table 191). It is 27 bytes: usage page `06 01 00`, usage `09 01`, one application collection, 8-bit fields, an input report and an output report. It has no report ID item.
- NXP's table labels the usage "Vendor Usage 1", but the bytes `06 01 00` encode usage page 0x0001, which is Generic Desktop. Usage 0x01 on that page is Pointer.

The expected descriptor is therefore one collection on Generic Desktop, Pointer, with a 10-byte input report and a 10-byte output report, both unnumbered.

### Is 0xAA a report ID?

Almost certainly not. With no report ID item, 0xAA is the first data byte of a 10-byte report. python-dali passes a 10-byte buffer starting 0xAA to hidapi, whose contract says the first byte is the report ID, or 0 for a device without them. That breaks the contract, and works on Linux and macOS because hidapi only strips a leading zero (https://github.com/libusb/hidapi/blob/master/linux/hid.c and `mac/hid.c`). On the wire the device receives 10 bytes starting 0xAA. That is the fact to reproduce.

| Case                     | `collections[0].outputReports[0]`        | Send                                          | `inputreport` event                    |
| ------------------------ | ---------------------------------------- | --------------------------------------------- | -------------------------------------- |
| A, unnumbered (expected) | `reportId` 0, items totalling 80 bits    | `sendReport(0, tenBytes)` with 0xAA as byte 0 | `reportId` 0, 10 bytes, byte 0 is 0xAA |
| B, numbered with ID 0xAA | `reportId` 0xAA, items totalling 72 bits | `sendReport(0xAA, nineBytes)`                 | `reportId` 0xAA, 9 bytes               |

The specification: "The reportId member is the prefix for this report if the interface uses report IDs, or 0 otherwise" (SPEC), and Chrome's guide: "If the HID device does not use report IDs, set reportId to 0" (CHROME).

Recommendation: do not make this a user setting. At connect time, read `device.collections`, choose case A or B from what it says, and refuse to continue if it matches neither. Stage 4 asks for both readings behind one setting. Detection gives the same coverage with no way to choose wrongly, and the fake device in tests can present either shape.

### The risk: Chrome may block the device

Chrome protects some HID usages. Its guide says: "Chrome inspects the usage of each top-level collection and if a top-level collection has a protected usage (e.g. generic keyboard, mouse), then a website won't be able to send and receive any reports defined in that collection" (CHROME).

In Chromium's source, `IsAlwaysProtected` returns true for input and output reports in a collection on Generic Desktop with usage Pointer, Mouse, Keyboard or Keypad. `RemoveProtectedReports` drops those reports before the page sees the device, and the connection drops protected input reports (CRHID). This check is separate from the device blocklist, so the switch that disables the blocklist may not lift it.

If the hasseb's collection is Generic Desktop, Pointer, as NXP's table says, then in Chrome `collections` would show no input or output reports, `sendReport` would be refused, and no `inputreport` events would arrive. WebHID would not work with the stock firmware.

Evidence against, which keeps this open:

- NXP calls the usage "Vendor Usage 1", so the table's bytes could be a misprint for a vendor page. The independent rewrite repeats the same bytes with the comment "Usage page: generic desktop" (DRAFT), but it was modelled on the manual and may never have been compared with a real unit.
- The vendor's own program works on Windows, where the system normally takes Pointer and Mouse collections for itself.
- No report of anyone using a hasseb from WebHID was found, so there is no field evidence either way.

### What to do about it

This is the largest open risk in the project, and it can be closed in five minutes once any hasseb is plugged into any computer. Read the report descriptor and look at its first bytes. `06 01 00` or `05 01`, followed by `09 01`, means Chrome will protect it. A page from 0xFF00 to 0xFFFF means it is fine.

It would be worth asking the vendor now, before the unit arrives: "What are the usage page and usage in the report descriptor of the 04CC:0802 device with firmware 2.x?" It is one email, and it decides whether Stage 4 builds a WebHID transport or a bridge first.

If Chrome does block it, the options are:

1. The contingency bridge (section 6). The brief already allows for it.
2. Asking the vendor for firmware with a vendor usage page. The ROM driver cannot change its page, so this would need them to change USB stacks.
3. The vendor's newer STM32 unit, whose descriptor is unknown.
4. WebUSB is not a way round it: browsers do not let WebUSB claim HID interfaces (not re-checked in this research).

Stage 2 should design the Transport interface so that the WebHID transport and the bridge transport are interchangeable, which the brief's Simulator, Hardware and Both modes already require. Stage 4's fake device should present the expected descriptor, including its usage page, so the detection code is exercised.

## 4. WebHID

### The API (SPEC)

- `navigator.hid` is exposed in windows, dedicated workers and service workers, in secure contexts only. `requestDevice()` is window only. A worker can use `getDevices()` and devices already granted.
- `requestDevice()` rejects with SecurityError without transient user activation, takes `filters` (and optional `exclusionFilters`), and resolves with an empty array if the user picks nothing.
- `HIDDevice` has `opened`, `vendorId`, `productId`, `productName`, `collections`, `open()`, `close()`, `forget()`, `sendReport(reportId, data)` and the feature report calls. It exposes no serial number.
- `inputreport` events carry `device`, `reportId` and `data` as a DataView.
- `sendReport` rejects with NotAllowedError for a blocked report and NetworkError when the system call fails.
- `forget()` rejects pending sends with AbortError and then revokes the permission. Chrome: it "will revoke access to all the HID interfaces on the same physical device" (CHROME).
- `connect` and `disconnect` events fire on `navigator.hid` for devices the site has permission for (CHROME).
- Both `getDevices()` and `requestDevice()` reject if the document is not allowed the `hid` permissions policy feature. `Permissions-Policy: hid=(self)`, which Stage 0 sends, keeps it to the top-level page.

### Support (BCD)

- Chrome 89, with `forget()` from Chrome 100. Edge and Opera follow Chrome. Not on Android.
- Dedicated workers from Chrome 131, "not shared workers".
- Firefox: no. Mozilla's position is negative (https://github.com/mozilla/standards-positions/issues/459).
- Safari: no. WebKit's position is oppose (https://github.com/WebKit/standards-positions/issues/510).
- Brave: not confirmed. It is believed to ship WebHID turned off behind a flag.

This matches the brief. The detail to add is the worker support: the transport can run in a dedicated worker in Chrome 131 and later, with the page calling `requestDevice()` and the worker finding the device through `getDevices()`. Whether that is worth it is a Stage 2 decision. It would keep bus timing off the main thread.

### Permissions and origins

- A grant belongs to an origin: scheme, host and port. `http://127.0.0.1:47820` (dev), `http://127.0.0.1:47821` (preview) and `http://localhost:47821` are three origins with three separate grants. Stated from the origin model, not from a quoted Chrome page.
- `getDevices()` "returns a list of devices the website has been granted access to previously" (CHROME).
- Not confirmed: whether a grant survives unplugging. Chrome is believed to keep a persistent grant only when it can recognise the device again, which needs a serial number string. The firmware file holds only the manufacturer and product strings, so the hasseb probably has no serial number, and each replug would need the chooser again. That affects Stage 4's "a physical unplug waits, then reconnects": reconnecting may need a click.

### What the app should do

1. Connect button, which is the user gesture: `requestDevice({ filters: [{ vendorId: 0x04cc, productId: 0x0802 }] })`. Nothing broader.
2. Check `collections` and pick the framing (section 3). Refuse anything unexpected.
3. `open()`, send the firmware version command, and refuse to continue if no 0xAA-framed reply comes back (the old firmware).
4. One frame at a time, matched by sequence number, with a timeout.
5. Disconnect in the app: stop sequences, `close()`, then `forget()`. Feature-test `forget` and say so if it is missing.
6. On a `disconnect` event while connected: mark the transport down, keep the simulator running, and offer reconnect.

## 5. Operating systems

- **Linux** needs a udev rule, because HID devices are read-only to users by default (CHROME). python-dali ships one for this device (https://github.com/sde1000/python-dali/blob/master/examples/50-dali-hid.rules). The vendor's suggested rule opens every HID device, keyboards included, to every user (https://github.com/hasseb/python-dali/blob/master/gui/README.md). Do not copy it. A narrow rule for the README, composed from those two and not yet tested:

  ```
  # /etc/udev/rules.d/70-hasseb-dali.rules
  KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="04cc", ATTRS{idProduct}=="0802", TAG+="uaccess"
  ```

  Then reload the rules and replug. Not confirmed: that the file name must sort before systemd's seat rules, and what snap or Flatpak builds of Chromium need.

- **macOS and Windows** need no driver (SHOP). Not confirmed: whether macOS asks for Input Monitoring permission when Chrome opens a Generic Desktop collection, and whether the Windows mouse driver interferes.

## 6. The contingency bridge, on paper

The brief allows a small local bridge if WebHID cannot open the hasseb. Section 3 makes that more likely than the brief assumed, so this design should be ready, though still built only if needed.

### Why 127.0.0.1 alone is not enough

Any web page can make the browser connect to a loopback port. WebSocket handshakes are not subject to the same-origin policy. DNS rebinding lets a remote site's hostname resolve to 127.0.0.1. Guidance for local servers says the same thing in several places: "Servers MUST validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks" and "SHOULD bind only to localhost" (the MCP transport specification, https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/basic/transports.mdx). OWASP: "Validate the `Origin` header on every handshake. Always use an explicit allowlist", and for tokens, "prefer sending the token in the first message" and "Avoid tokens in URL query strings" (https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).

Chrome's Local Network Access asks the user before a public site reaches loopback, and "serving your web app from http://localhost during local development will not trigger LNA checks" (https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access). It helps, but it is a prompt, in Chromium only, and does nothing about other local programs. It is not the control.

### The design

- **One process, one origin.** The bridge is a Python program using python-dali's hasseb driver. It serves the built app's static files and a WebSocket endpoint on the same fixed port, 127.0.0.1:47821, in place of `vite preview`. The WebSocket is then same-origin, and `connect-src 'self'` stays as it is. A bridge on a second port would need a second origin in the CSP, which changes a rule in `CLAUDE.md`. It sends the same security headers as the preview server.
- **Bind** to 127.0.0.1 only, with a strict port.
- **Host check.** Every request must carry `Host: 127.0.0.1:47821` exactly. A rebound request carries the attacker's hostname.
- **Origin check.** The WebSocket upgrade must carry `Origin: http://127.0.0.1:47821` exactly. A missing or `null` origin is refused.
- **Session token.** At start the bridge makes a random token of at least 128 bits and prints a URL with the token in its fragment, which the browser never sends to a server. The app reads the fragment, clears it from the address bar, and sends the token as the first WebSocket message. The bridge compares in constant time and accepts nothing else until it matches. The token is what stops other local programs, which can forge the Host and Origin headers.
- **One client.** A second connection is refused while one is open.
- **A narrow protocol.** Messages are fixed-size binary: a send of one 16-bit frame with its expect-reply and send-twice flags and a sequence number, and a reply with a status and one byte. The bridge builds the hasseb report itself, so the page cannot send arbitrary reports. It caps message size and rate.
- **A second governor.** The bridge enforces the ceiling too: it tracks DTR0 and refuses a SET MAX LEVEL above its own configured ceiling, and refuses RESET, unless started with an explicit flag. With WebHID there is nowhere outside the page to put such a check. With the bridge there is, and it would be a waste not to use it.
- **On disconnect** the bridge sends every device to the safe level, as panic does, and waits.
- **No other endpoints,** no cookies and no CORS headers.
- **Dependencies:** python-dali and hidapi are already locked in `tools/golden/requirements.txt`. A WebSocket library would be one more, hash-locked, or the standard library's HTTP server with a small hand-written WebSocket handshake.

### What the bridge costs

The app stops being a static site with no backend when hardware is in use. The client has to run a Python program, which he will read. Timing gets a second hop. In exchange the hardware path works in Firefox and Safari too. Stage 2's threat model should cover the bridge as a first-class variant, not an afterthought.

## 7. Hardware-day checklist

In this order. Steps 1 to 3 decide whether the WebHID transport is usable, and can be done the moment the device arrives, before the bench is wired.

1. Read the vendor and product IDs. Expect 0x04CC and 0x0802.
2. Dump the HID report descriptor (`usbhid-dump` on Linux, or the `ReportDescriptor` property in `ioreg` on macOS). Record the usage page and usage, whether there is a report ID item, the report lengths and the endpoint polling interval.
3. In Chrome, from the app's origin: `requestDevice` with the filter, then print `device.collections`. If it lists a 10-byte input and output report, continue. If it lists none, WebHID is blocked: stop and switch to the bridge.
4. `open()`, send the firmware version command, and record all 10 bytes of the reply.
5. Count idle `inputreport` events for five seconds with nothing sent.
6. Send QUERY STATUS to address 0 and record all 10 reply bytes. Settle byte 4 (1 or 8) and confirm byte 2 echoes the sequence number.
7. Send a query to an address with no gear. Record the status (expect 1) and how long it takes.
8. Measure throughput: 100 DAPC frames one after another, each sent when the last report arrives. Then 100 queries.
9. Send a send-twice command with sniffing on, or a scope on the bus, and measure the gap between the two frames.
10. Enable sniffing. Record whether a frame arrives as one report, and whether the hasseb's own frames are echoed.
11. Unplug and replug. Does `getDevices()` still list the device, and does `connect` fire?
12. After `forget()`: `getDevices()` is empty and the chooser is needed again.
13. On Linux, test the udev rule above.
14. Note whether the device has a serial number string.

## Unknowns

| Unknown                                                                 | Settled by                                  |
| ----------------------------------------------------------------------- | ------------------------------------------- |
| Usage page and usage of the HID collection                              | Checklist step 2, or an email to the vendor |
| Whether Chrome exposes the reports                                      | Step 3                                      |
| Report ID or not, and report lengths                                    | Steps 2 and 3                               |
| Firmware version, and whether a unit could have the old 2-byte firmware | Step 4                                      |
| Idle report rate                                                        | Step 5                                      |
| Reply byte 4                                                            | Step 6                                      |
| Real throughput, and the USB polling interval                           | Steps 2 and 8                               |
| The send-twice gap                                                      | Step 9                                      |
| Grant persistence across a replug                                       | Step 11                                     |
| Bus supply current                                                      | The vendor's manual, or a measurement       |
| ENABLE DEVICE TYPE with send-twice DT8 commands                         | Bench test with the DA5-L, see `dali.md`    |
