// courseless-ax — ground a named on-screen UI element to exact screen coordinates, on macOS.
//
// This is the darwin half of the grounding pipeline: the exact one. Rects come straight out of the
// macOS accessibility tree, so a hit is correct by construction. (PointService's vision fallback
// handles what AX cannot name.) It is the port of resources/uia-find.ps1 + resources/screen-shot.ps1
// and keeps their contract: ONE compact JSON line on stdout, always, even on failure, exit 0.
//
// MODES
//   --mode name        find elements whose accessible label matches --name
//   --mode at-point    the element under --x,--y (or the current cursor) — B5 record mode
//   --mode windows     just report the candidate window list (diagnostics)
//   --mode permissions Accessibility + Screen Recording state, optionally prompting
//   --mode shot        ScreenCaptureKit capture of a display, minus --exclude-pid's windows
//   --mode crop        crop an existing capture (PIXEL coordinates of the input file)
//
// COORDINATES. Everything AX-shaped (matches, window rects, --x/--y) is in POINTS, top-left origin
// — the same space as CGWindowList bounds and Electron's screen API, so the caller converts
// nothing. The only pixel space is inside a capture: `shot` reports w/h in PIXELS with the
// scaleFactor used, and `crop` takes its rect in the PIXELS of --in. That mirrors screen-shot.ps1,
// where capture and crop were both physical pixels.
//
// Never writes anything except the PNG it is asked for; never clicks anything.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit

// ------------------------------------------------------------------ output

let clock = DispatchTime.now()
func elapsedMs() -> Int { Int((DispatchTime.now().uptimeNanoseconds - clock.uptimeNanoseconds) / 1_000_000) }

/// One line of compact JSON, then exit 0. Every path out of this program goes through here — a
/// bare crash would leave PointService parsing an empty string and calling it "unparseable".
func emit(_ obj: [String: Any]) -> Never {
    var o = obj
    o["ms"] = elapsedMs()
    let data = (try? JSONSerialization.data(withJSONObject: o, options: [.withoutEscapingSlashes]))
        ?? Data(#"{"ok":false,"error":"json encode failed"}"#.utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

func fail(_ mode: String, _ message: String) -> Never {
    emit(["ok": false, "mode": mode, "error": message, "windows": [], "matches": []])
}

// ------------------------------------------------------------------ args

struct Args {
    var mode = "name"
    var name = ""
    var hint = ""
    var x: Double?
    var y: Double?
    var w = 0
    var h = 0
    var path = ""
    var input = ""
    var excludePids = Set<pid_t>()
    var excludeWindows = Set<CGWindowID>()
    var max = 8
    var budgetMs = 1400
    var prompt = false
    var display: CGDirectDisplayID?
}

let usage = [
    "courseless-ax --mode name       --name <text> [--window-hint <text>] [--exclude-pid 1,2] [--exclude-window 1,2] [--max 8] [--budget-ms 1400]",
    "courseless-ax --mode at-point   [--x <pt> --y <pt>] [--exclude-pid ...] [--exclude-window ...]",
    "courseless-ax --mode windows    [--exclude-pid ...] [--exclude-window ...]",
    "courseless-ax --mode permissions [--prompt]",
    "courseless-ax --mode shot       --path out.png [--exclude-pid ...] [--display <id>]",
    "courseless-ax --mode crop       --in full.png --path crop.png --x <px> --y <px> --w <px> --h <px>",
    "",
    "Coordinates are POINTS (top-left origin) everywhere EXCEPT: shot reports w/h in pixels, and",
    "crop's --x/--y/--w/--h are PIXELS of the --in image (clamped to it). Output is one compact",
    "JSON line on stdout, always, exit 0.",
]

func parseArgs() -> Args {
    var a = Args()
    let argv = Array(CommandLine.arguments.dropFirst())
    var i = 0
    func next(_ flag: String) -> String {
        guard i + 1 < argv.count else { fail(a.mode, "Missing value for \(flag)") }
        i += 1
        return argv[i]
    }
    func ints(_ s: String) -> [Int] {
        s.split(whereSeparator: { ",; ".contains($0) }).compactMap { Int($0) }
    }
    while i < argv.count {
        let flag = argv[i]
        switch flag {
        case "--mode": a.mode = next(flag)
        case "--name": a.name = next(flag)
        case "--window-hint": a.hint = next(flag)
        case "--x": a.x = Double(next(flag))
        case "--y": a.y = Double(next(flag))
        case "--w": a.w = Int(next(flag)) ?? 0
        case "--h": a.h = Int(next(flag)) ?? 0
        case "--path": a.path = next(flag)
        case "--in": a.input = next(flag)
        case "--exclude-pid": a.excludePids.formUnion(ints(next(flag)).map { pid_t($0) })
        case "--exclude-window": a.excludeWindows.formUnion(ints(next(flag)).map { CGWindowID($0) })
        case "--max": a.max = max(1, Int(next(flag)) ?? 8)
        case "--budget-ms": a.budgetMs = max(50, Int(next(flag)) ?? 1400)
        case "--prompt": a.prompt = true
        case "--display": a.display = CGDirectDisplayID(next(flag))
        case "--help", "-h": emit(["ok": true, "mode": "help", "usage": usage])
        default: fail(a.mode, "Unknown flag \(flag)")
        }
        i += 1
    }
    return a
}

let args = parseArgs()

// ------------------------------------------------------------------ AX plumbing

/// 6 of ~12 apps on a normal desktop are AX-unresponsive at any moment (App Nap) and answer with
/// kAXErrorCannotComplete only after the DEFAULT 1.5s timeout — three of those eats the whole
/// budget. Half a second per element is the difference between a bounded search and a hung one.
func tame(_ el: AXUIElement) { AXUIElementSetMessagingTimeout(el, 0.5) }

func axCopy(_ el: AXUIElement, _ attr: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success ? v : nil
}

func axString(_ el: AXUIElement, _ attr: String) -> String? {
    guard let s = axCopy(el, attr) as? String, !s.isEmpty else { return nil }
    return s
}

func axChildren(_ el: AXUIElement) -> [AXUIElement] {
    (axCopy(el, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

func axRect(_ el: AXUIElement) -> CGRect? {
    guard let pv = axCopy(el, kAXPositionAttribute as String), CFGetTypeID(pv) == AXValueGetTypeID(),
          let sv = axCopy(el, kAXSizeAttribute as String), CFGetTypeID(sv) == AXValueGetTypeID()
    else { return nil }
    var p = CGPoint.zero
    var s = CGSize.zero
    guard AXValueGetValue(pv as! AXValue, .cgPoint, &p), AXValueGetValue(sv as! AXValue, .cgSize, &s) else { return nil }
    return CGRect(origin: p, size: s)
}

func axPid(_ el: AXUIElement) -> pid_t {
    var p: pid_t = 0
    AXUIElementGetPid(el, &p)
    return p
}

/// Every string a human might call this element by. AXTitle is the button's label, AXDescription
/// carries the icon-only cases ("Close"), AXValue is where a text field or a static-text node keeps
/// its content — labels in Chromium trees routinely arrive as AXValue.
func labels(_ el: AXUIElement) -> [String] {
    var out: [String] = []
    if let t = axString(el, kAXTitleAttribute as String) { out.append(t) }
    if let d = axString(el, kAXDescriptionAttribute as String) { out.append(d) }
    if let v = axCopy(el, kAXValueAttribute as String) as? String, !v.isEmpty, v.count <= 256 { out.append(v) }
    return out
}

// ------------------------------------------------------------------ screens & windows

let screenUnion: CGRect = {
    // Top-left-origin union of every display, in points. AX rects live in this space.
    var r = CGRect.null
    var ids = [CGDirectDisplayID](repeating: 0, count: 32)
    var count: UInt32 = 0
    if CGGetActiveDisplayList(32, &ids, &count) == .success {
        for k in 0..<Int(count) { r = r.union(CGDisplayBounds(ids[k])) }
    }
    return r.isNull ? CGRect(x: 0, y: 0, width: 5000, height: 5000) : r
}()

let mainScale: CGFloat = NSScreen.main?.backingScaleFactor ?? 2

/// Every active display, in the same POINT space as everything else here.
///
/// The caller needs this to capture the RIGHT screen: `--mode shot` grabs exactly one display, so
/// on a two-monitor desk the vision fallback would otherwise only ever see the main one and report
/// an honest miss for anything on the second. Emitted by name/at-point/windows so the caller gets
/// the census for free on the AX call it was already making — no extra spawn.
func displaysJson() -> [[String: Any]] {
    var ids = [CGDirectDisplayID](repeating: 0, count: 32)
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(32, &ids, &count) == .success else { return [] }
    let main = CGMainDisplayID()
    return (0..<Int(count)).map { k in
        let id = ids[k]
        let b = CGDisplayBounds(id)
        let scale = NSScreen.screens.first(where: {
            ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == id
        })?.backingScaleFactor ?? mainScale
        return [
            "id": Int(id),
            "left": Int(b.minX.rounded()), "top": Int(b.minY.rounded()),
            "w": Int(b.width.rounded()), "h": Int(b.height.rounded()),
            "scaleFactor": Double(scale), "main": id == main,
        ]
    }
}

struct WinInfo {
    var windowId: CGWindowID
    var title: String
    var process: String
    var pid: pid_t
    var how: String
    var isSelf: Bool
    var rect: CGRect
    /// Shell roots (menu bar, Dock) have no meaningful owning-window rect; their popups legally
    /// cover the whole screen, so the outside-window rejection uses the display union instead.
    var shell: Bool = false
    var menuBar: Bool = false

    var json: [String: Any] {
        [
            "windowId": Int(windowId), "title": title, "process": process, "pid": Int(pid),
            "how": how, "self": isSelf,
            "left": Int(rect.minX.rounded()), "top": Int(rect.minY.rounded()),
            "w": Int(rect.width.rounded()), "h": Int(rect.height.rounded()),
        ]
    }
}

struct RawWindow {
    var id: CGWindowID
    var pid: pid_t
    var owner: String
    var name: String
    var rect: CGRect
    var layer: Int
}

/// CGWindowListCopyWindowInfo already returns front-to-back Z-order, which is what makes
/// "the window behind us" portable from the Win32 GetTopWindow/GW_HWNDNEXT walk.
func windowList(onScreenOnly: Bool = true) -> [RawWindow] {
    var opts: CGWindowListOption = [.excludeDesktopElements]
    if onScreenOnly { opts.insert(.optionOnScreenOnly) }
    guard let raw = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return [] }
    return raw.compactMap { d in
        guard let id = d[kCGWindowNumber as String] as? Int,
              let pid = d[kCGWindowOwnerPID as String] as? Int,
              let b = d[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: b as CFDictionary)
        else { return nil }
        return RawWindow(
            id: CGWindowID(id), pid: pid_t(pid),
            owner: (d[kCGWindowOwnerName as String] as? String) ?? "",
            // kCGWindowName is nil WITHOUT Screen Recording. Window-hint matching and the
            // wrong-window rejection both collapse to process-name-only when that happens.
            name: (d[kCGWindowName as String] as? String) ?? "",
            rect: rect,
            layer: (d[kCGWindowLayer as String] as? Int) ?? 0
        )
    }
}

let SHELL_OWNERS: Set<String> = ["Dock", "Window Server", "WindowServer", "Control Center", "Notification Center", "Spotlight"]

func procName(_ pid: pid_t, fallback: String) -> String {
    NSRunningApplication(processIdentifier: pid)?.localizedName ?? (fallback.isEmpty ? "" : fallback)
}

// ------------------------------------------------------------------ candidate windows

let onScreen = windowList()
// Layer 0 is "ordinary application window". The Dock (20), the menu bar (24) and the menu-bar
// extras all live above it, and the desktop below — the same cut Shell_TrayWnd/Progman made.
let appWindows = onScreen.filter { $0.layer == 0 && $0.rect.width >= 32 && $0.rect.height >= 32 }

var candidates: [WinInfo] = []
var seenWindowIds = Set<CGWindowID>()

func addCandidate(_ w: WinInfo) {
    if args.excludeWindows.contains(w.windowId) { return }
    if w.windowId != 0, seenWindowIds.contains(w.windowId) { return }
    if w.windowId != 0 { seenWindowIds.insert(w.windowId) }
    candidates.append(w)
}

func info(_ w: RawWindow, how: String) -> WinInfo {
    WinInfo(
        windowId: w.id, title: w.name, process: procName(w.pid, fallback: w.owner), pid: w.pid,
        how: how, isSelf: args.excludePids.contains(w.pid), rect: w.rect
    )
}

let foreground: WinInfo? = appWindows.first.map { info($0, how: "foreground") }
if let fg = foreground { addCandidate(fg) }

// The window BEHIND us: when the point is triggered from Courseless itself, the app the learner is
// actually working in is one step down the Z-order.
for w in appWindows {
    if args.excludePids.contains(w.pid) { continue }
    if args.excludeWindows.contains(w.id) { continue }
    if SHELL_OWNERS.contains(w.owner) { continue }
    if w.id == foreground?.windowId { continue }
    addCandidate(info(w, how: "behind"))
    break
}

// Windows matching the lesson's tool hint (title or process name).
let hintTokens: [String] = args.hint
    .split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "+" && $0 != "#" })
    .map { $0.lowercased() }
    .filter { $0.count >= 3 }
if !hintTokens.isEmpty {
    var added = 0
    for w in appWindows where added < 6 {
        let hay = "\(w.name) \(procName(w.pid, fallback: w.owner)) \(w.owner)".lowercased()
        if hintTokens.contains(where: { hay.contains($0) }) {
            if !seenWindowIds.contains(w.id) { added += 1 }
            addCandidate(info(w, how: "hint"))
        }
    }
}

// The shell: the menu bar and the Dock. Always a legitimate target ("open Terminal from the Dock",
// "choose View > Enter Full Screen"). The menu bar is macOS's ribbon and belongs to the FRONTMOST
// app, not to any window, so it is a synthetic candidate rather than a CGWindow.
let menuBarPid: pid_t? = {
    if let fa = NSWorkspace.shared.frontmostApplication, !args.excludePids.contains(fa.processIdentifier) {
        return fa.processIdentifier
    }
    return candidates.first(where: { $0.how == "behind" })?.pid
}()
if let mp = menuBarPid {
    let app = NSRunningApplication(processIdentifier: mp)
    addCandidate(WinInfo(
        windowId: 0, title: "\(app?.localizedName ?? "") menu bar", process: app?.localizedName ?? "",
        pid: mp, how: "shell", isSelf: false,
        rect: CGRect(x: screenUnion.minX, y: screenUnion.minY, width: screenUnion.width, height: 24),
        shell: true, menuBar: true
    ))
}
if let dock = onScreen.first(where: { $0.owner == "Dock" && $0.rect.width > 40 && $0.rect.height > 20 }) {
    addCandidate(WinInfo(
        windowId: dock.id, title: "Dock", process: "Dock", pid: dock.pid, how: "shell",
        isSelf: false, rect: dock.rect, shell: true
    ))
}

// ------------------------------------------------------------------ AX roots

/// The AX element for a candidate window. kAXWindows — NOT AXChildren: Finder's app element reports
/// AXWindows=1 and zero window-shaped children, so an AXChildren walk finds nothing at all.
func axRoot(for cand: WinInfo) -> AXUIElement? {
    let app = AXUIElementCreateApplication(cand.pid)
    tame(app)
    if cand.menuBar {
        guard let mb = axCopy(app, kAXMenuBarAttribute as String) else { return nil }
        let el = mb as! AXUIElement
        tame(el)
        return el
    }
    let wins = (axCopy(app, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
    let pool = wins.isEmpty ? axChildren(app) : wins
    if pool.isEmpty { return app }
    // Match on frame — AX positions and CGWindow bounds are the same top-left point space, and the
    // title is unreliable (empty without Screen Recording, duplicated across tabs).
    for w in pool {
        tame(w)
        if let r = axRect(w), abs(r.minX - cand.rect.minX) < 2, abs(r.minY - cand.rect.minY) < 2,
           abs(r.width - cand.rect.width) < 2, abs(r.height - cand.rect.height) < 2 { return w }
    }
    if !cand.title.isEmpty, let byTitle = pool.first(where: { axString($0, kAXTitleAttribute as String) == cand.title }) {
        tame(byTitle)
        return byTitle
    }
    return pool.first ?? app
}

// ------------------------------------------------------------------ match shaping

struct Match {
    var rect: CGRect
    var name: String
    var role: String
    var exact: Bool
    var how: String
    var win: WinInfo
    var ancestors: [String] = []
    var point: CGPoint?
    /// at-point only: the reported coordinate when the rect's own centre is not on the element.
    var centreOverride: CGPoint?
    /// The rect is NOT this element's own: it was borrowed from the AXMenuBarItem that opens the
    /// menu this item lives in. A real, on-screen match anywhere else is a better answer, so this
    /// is ranked below one — here and again in PointService.rank.
    var promoted: Bool = false
    /// name mode, prose-role hits only: the ancestor ROLES, nearest first. A bare AXStaticText is
    /// normally a line of prose and never a target; the same role inside AXRow/AXOutline is a
    /// sidebar row and IS the thing the learner clicks. The caller cannot tell those apart from
    /// role + rect alone, so the chain travels with the match.
    var containers: [String] = []

    var json: [String: Any] {
        let c = centreOverride ?? CGPoint(x: rect.midX, y: rect.midY)
        var o: [String: Any] = [
            "x": Int(c.x.rounded()), "y": Int(c.y.rounded()),
            "left": Int(rect.minX.rounded()), "top": Int(rect.minY.rounded()),
            "w": Int(rect.width.rounded()), "h": Int(rect.height.rounded()),
            "name": name, "role": role, "exact": exact, "how": how,
            "windowId": Int(win.windowId), "windowTitle": win.title,
            "process": win.process, "pid": Int(win.pid), "self": win.isSelf,
        ]
        if !ancestors.isEmpty { o["ancestors"] = ancestors }
        if !containers.isEmpty { o["containers"] = containers }
        if promoted { o["promoted"] = true }
        if let p = point { o["pointX"] = Int(p.x.rounded()); o["pointY"] = Int(p.y.rounded()) }
        return o
    }
}

/// Is this rect something a learner could be pointed AT?
func usableRect(_ r: CGRect, in cand: WinInfo) -> Bool {
    // Items inside a CLOSED menu report (x, y, 0, 0) — a real element with no on-screen presence.
    if r.width <= 0 || r.height <= 0 { return false }
    if !r.origin.x.isFinite || !r.origin.y.isFinite { return false }
    if r.width > 4000 && r.height > 3000 { return false }  // whole-desktop rects are not targets
    let centre = CGPoint(x: r.midX, y: r.midY)
    if !screenUnion.insetBy(dx: -1, dy: -1).contains(centre) { return false }
    // A scroll container reports its full CONTENT bounds, so its centre can sit hundreds of points
    // above the window — Terminal's AXTextArea centres at y = -681. Pointing there points at
    // nothing. Shell roots are exempt: menus legitimately extend past the menu bar.
    if cand.shell { return true }
    return cand.rect.insetBy(dx: -2, dy: -2).contains(centre)
}

/// A hit on an item inside a menu is only reachable once the menu is OPEN, so the answer the runner
/// can actually narrate is the MENU BAR ITEM that opens it: "open the View menu, then Enter Full
/// Screen". Walk up to the enclosing AXMenuBarItem and point at that instead.
func promoteMenuItem(_ el: AXUIElement) -> (AXUIElement, String)? {
    var cur: AXUIElement? = el
    for _ in 0..<8 {
        guard let c = cur, let parent = axCopy(c, kAXParentAttribute as String) else { return nil }
        let p = parent as! AXUIElement
        tame(p)
        if axString(p, kAXRoleAttribute as String) == "AXMenuBarItem" {
            return (p, axString(p, kAXTitleAttribute as String) ?? "menu")
        }
        cur = p
    }
    return nil
}

/// Roles that are prose on their own and a control inside a container. Only these pay for the
/// ancestor-role walk below — every other match keeps the old cost exactly.
let CONTAINER_HINT_ROLES: Set<String> = ["AXStaticText", "AXHeading"]

/// The ancestor ROLES above an element, nearest first, capped hard in both depth and count.
func containerRoles(_ el: AXUIElement) -> [String] {
    var out: [String] = []
    var cur: AXUIElement? = el
    for _ in 0..<6 {
        guard let c = cur, let parent = axCopy(c, kAXParentAttribute as String) else { break }
        let p = parent as! AXUIElement
        tame(p)
        if let r = axString(p, kAXRoleAttribute as String) { out.append(r) }
        cur = p
    }
    return out
}

// ------------------------------------------------------------------ modes

let fgJson: Any = foreground?.json ?? NSNull()

func emitWindows() -> Never {
    emit([
        "ok": true, "mode": args.mode,
        "foreground": fgJson,
        "windows": candidates.map(\.json),
        "matches": [],
        "scaleFactor": Double(mainScale),
        "displays": displaysJson(),
    ])
}

func runPermissions() -> Never {
    let ax = args.prompt
        ? AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        : AXIsProcessTrusted()
    // Screen Recording genuinely requires a RELAUNCH after the grant, so a request here can only
    // put the row in System Settings; preflight is what tells the truth this run.
    let screen = args.prompt ? CGRequestScreenCaptureAccess() : CGPreflightScreenCaptureAccess()
    emit(["ok": true, "mode": "permissions", "accessibility": ax, "screenRecording": screen,
          "scaleFactor": Double(mainScale)])
}

func runName() -> Never {
    let needle = args.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if needle.isEmpty { fail("name", "No --name given.") }
    if !AXIsProcessTrusted() {
        emit(["ok": false, "mode": "name", "error": "Accessibility permission not granted.",
              "foreground": fgJson,
              "windows": candidates.map(\.json), "matches": [], "scaleFactor": Double(mainScale),
              "displays": displaysJson()])
    }
    let lowerNeedle = needle.lowercased()
    // The "partial" rule lets a SHORT element name satisfy a LONGER query — "macOS Finder window"
    // finding "Finder". It must not let a long descriptive query latch onto whatever short word it
    // happens to contain, so: label-shaped queries only.
    let allowPartial = lowerNeedle.split(separator: " ").count <= 4 && lowerNeedle.count >= 6

    func partialHit(_ label: String) -> Bool {
        guard allowPartial, label.count >= 4, label.count < lowerNeedle.count else { return false }
        let pat = "(^|\\s)" + NSRegularExpression.escapedPattern(for: label) + "(\\s|$)"
        guard let re = try? NSRegularExpression(pattern: pat) else { return false }
        return re.firstMatch(in: lowerNeedle, range: NSRange(lowerNeedle.startIndex..., in: lowerNeedle)) != nil
    }

    let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(args.budgetMs) * 1_000_000
    func outOfTime() -> Bool { DispatchTime.now().uptimeNanoseconds >= deadline }

    var found: [Match] = []
    var seenRects = Set<String>()

    func record(_ el: AXUIElement, _ cand: WinInfo, _ label: String, _ exact: Bool, _ kind: String) {
        guard var r = axRect(el) else { return }
        var role = axString(el, kAXRoleAttribute as String) ?? "AXUnknown"
        var how = "\(cand.how)/\(kind)"
        var promoted = false
        if role == "AXMenuItem" || !usableRect(r, in: cand) {
            if let (bar, title) = promoteMenuItem(el), let br = axRect(bar), usableRect(br, in: cand) {
                r = br
                role = "AXMenuBarItem"
                how = "\(cand.how)/menu/\(title)"
                promoted = true
            }
        }
        guard usableRect(r, in: cand) else { return }
        // AX graphs cycle, and the same control is legitimately exposed twice (a toolbar button and
        // its command). One rect is one answer.
        let key = "\(cand.windowId):\(Int(r.minX)),\(Int(r.minY)),\(Int(r.width)),\(Int(r.height))"
        if seenRects.contains(key) { return }
        seenRects.insert(key)
        let chain = CONTAINER_HINT_ROLES.contains(role) ? containerRoles(el) : []
        found.append(Match(rect: r, name: label, role: role, exact: exact, how: how, win: cand,
                           promoted: promoted, containers: chain))
    }

    // Search past --max and cut at the END, exact hits first.
    //
    // uia-find.ps1 could be greedy — it ran a native exact FindAll over each window before the
    // contains BFS, so an exact hit always beat the loose ones in the same window. AX has no
    // indexed name query, so a single walk has to produce both, and greedy truncation gives the
    // wrong answer for real queries: "File" matches "profile" six times in a Chromium window and
    // fills every slot before the menu bar — which holds the actual File menu — is ever opened.
    // Collect a wider net, then keep exact first with candidate order as the tiebreak.
    let netCap = max(args.max * 4, 32)
    func enough() -> Bool { found.count(where: { $0.exact }) >= args.max || found.count >= netCap }

    for cand in candidates {
        if enough() || outOfTime() { break }
        guard let root = axRoot(for: cand) else { continue }
        // Explicit queue, three independent bounds: node cap, depth cap and the wall clock. Depth
        // must be generous — a Chromium tree at depth 20 exposed 413 Discord nodes, at depth 30 it
        // exposed 1657, and the button a lesson names is usually in the second batch.
        var queue: [(AXUIElement, Int)] = [(root, 0)]
        var nodes = 0
        while !queue.isEmpty, nodes < 4000, !enough(), !outOfTime() {
            let (node, depth) = queue.removeFirst()
            nodes += 1
            tame(node)
            for label in labels(node) {
                let lower = label.lowercased()
                if lower == lowerNeedle { record(node, cand, label, true, "exact") }
                else if lower.contains(lowerNeedle) { record(node, cand, label, false, "contains") }
                else if partialHit(lower) { record(node, cand, label, false, "partial") }
                if enough() { break }
            }
            if depth < 30 {
                for kid in axChildren(node) { queue.append((kid, depth + 1)) }
            }
        }
    }

    // Exact first, then candidate order — with one wrinkle: a PROMOTED match (a menu item whose
    // menu is closed, wearing its menu-bar item's rect) is a redirection, not a sighting. When the
    // same name is also visible somewhere real — Finder's "Applications" is both a Go-menu item and
    // a sidebar row — the real one is the answer, so promoted hits sort below their own tier.
    func tier(_ m: Match) -> Int { (m.exact ? 2 : 0) - (m.promoted ? 1 : 0) }
    let ranked = found.enumerated()
        .sorted { a, b in
            tier(a.element) == tier(b.element) ? a.offset < b.offset : tier(a.element) > tier(b.element)
        }
        .prefix(args.max)
        .map(\.element.json)

    // Budget expiry is not an error: partial results are what the ps1 emitted too, and half a
    // pointer beats none.
    emit([
        "ok": true, "mode": "name",
        "foreground": fgJson,
        "windows": candidates.map(\.json),
        "matches": ranked,
        "scaleFactor": Double(mainScale),
        "displays": displaysJson(),
    ])
}

func runAtPoint() -> Never {
    if !AXIsProcessTrusted() {
        emit(["ok": false, "mode": "at-point", "error": "Accessibility permission not granted.",
              "foreground": fgJson,
              "windows": candidates.map(\.json), "matches": [], "scaleFactor": Double(mainScale),
              "displays": displaysJson()])
    }
    var px = args.x
    var py = args.y
    if px == nil || py == nil {
        // NSEvent.mouseLocation is the one bottom-left-origin coordinate in this program.
        let m = NSEvent.mouseLocation
        let flipY = (NSScreen.screens.first?.frame.maxY ?? screenUnion.maxY) - m.y
        px = m.x
        py = flipY
    }
    let pt = CGPoint(x: px!, y: py!)
    let sys = AXUIElementCreateSystemWide()
    tame(sys)
    var elRef: AXUIElement?
    let err = AXUIElementCopyElementAtPosition(sys, Float(pt.x), Float(pt.y), &elRef)
    guard err == .success, let el = elRef else {
        emit(["ok": false, "mode": "at-point", "error": "No accessibility element under the point.",
              "foreground": fgJson,
              "windows": candidates.map(\.json), "matches": [], "scaleFactor": Double(mainScale),
              "displays": displaysJson()])
    }
    tame(el)
    let name = labels(el).first ?? ""
    let role = axString(el, kAXRoleAttribute as String) ?? "AXUnknown"
    let rect = axRect(el) ?? CGRect(x: pt.x, y: pt.y, width: 0, height: 0)

    // The deepest element under a pixel is often an unnamed leaf; the name the user would say is
    // usually a step or two up. Report the chain so the caller can match on any of it — and find
    // the owning window on the way.
    var ancestors: [String] = []
    var windowEl: AXUIElement?
    var cur: AXUIElement? = el
    for _ in 0..<12 {
        guard let c = cur, let pRef = axCopy(c, kAXParentAttribute as String) else { break }
        let p = pRef as! AXUIElement
        tame(p)
        if let n = labels(p).first, ancestors.count < 5, !n.isEmpty { ancestors.append(n) }
        if windowEl == nil, axString(p, kAXRoleAttribute as String) == kAXWindowRole as String { windowEl = p }
        cur = p
    }

    let pid = axPid(el)
    var win = WinInfo(windowId: 0, title: "", process: procName(pid, fallback: ""), pid: pid,
                      how: "at-point", isSelf: args.excludePids.contains(pid), rect: .zero)
    if let we = windowEl, let wr = axRect(we) {
        win.title = axString(we, kAXTitleAttribute as String) ?? ""
        win.rect = wr
        if let raw = windowList().first(where: {
            $0.pid == pid && abs($0.rect.minX - wr.minX) < 2 && abs($0.rect.minY - wr.minY) < 2
        }) {
            win.windowId = raw.id
            if win.title.isEmpty { win.title = raw.name }
        }
    } else if let raw = windowList().first(where: { $0.pid == pid && $0.layer == 0 && $0.rect.contains(pt) }) {
        win.windowId = raw.id
        win.title = raw.name
        win.rect = raw.rect
    }

    // A scroll container reports its full CONTENT bounds, so its centre is routinely off-screen —
    // Terminal's AXTextArea under the cursor centres at y = -685. A mark whose coordinate is
    // nowhere is worse than useless, so when the centre escapes the owning window the recorded
    // coordinate is the pixel that was actually asked about. The true rect still ships in
    // left/top/w/h; only x/y and `how` change.
    var m = Match(rect: rect, name: name, role: role, exact: true, how: "at-point", win: win,
                  ancestors: ancestors, point: pt)
    let centre = CGPoint(x: rect.midX, y: rect.midY)
    if rect.width <= 0 || rect.height <= 0 || !screenUnion.contains(centre)
        || (win.rect != .zero && !win.rect.insetBy(dx: -2, dy: -2).contains(centre)) {
        m.how = "at-point/clamped"
        m.centreOverride = pt
    }
    emit([
        "ok": true, "mode": "at-point",
        "foreground": fgJson,
        "windows": candidates.map(\.json),
        "matches": [m.json],
        "scaleFactor": Double(mainScale),
        "displays": displaysJson(),
    ])
}

// ------------------------------------------------------------------ capture

/// Task.detached's closure is @Sendable, so the capture result has to travel in a reference box
/// rather than a captured `var`. Only one writer, and the reader waits on the semaphore.
final class ResultBox: @unchecked Sendable {
    var value: [String: Any]
    init(_ v: [String: Any]) { value = v }
}

func writePNG(_ img: CGImage, to path: String) -> Bool {
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { return false }
    CGImageDestinationAddImage(dest, img, nil)
    return CGImageDestinationFinalize(dest)
}

func runShot() -> Never {
    if args.path.isEmpty { fail("shot", "No --path given.") }
    if !CGPreflightScreenCaptureAccess() { fail("shot", "Screen Recording permission not granted.") }
    let sem = DispatchSemaphore(value: 0)
    let box = ResultBox(["ok": false, "mode": "shot", "error": "capture did not complete"])
    Task.detached {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            let wanted = args.display ?? CGMainDisplayID()
            guard let display = content.displays.first(where: { $0.displayID == wanted }) ?? content.displays.first else {
                box.value = ["ok": false, "mode": "shot", "error": "No displays available."]
                sem.signal()
                return
            }
            // Excluding our own application removes the pointer overlay from the frame the vision
            // model reads — the never-see-our-own-ghost-cursor property, done by the compositor
            // instead of by a layered-window flag.
            let excluded = content.applications.filter { args.excludePids.contains($0.processID) }
            let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
            let bounds = CGDisplayBounds(display.displayID)
            let scale = NSScreen.screens.first(where: {
                ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == display.displayID
            })?.backingScaleFactor ?? mainScale
            let config = SCStreamConfiguration()
            config.width = Int((CGFloat(display.width) * scale).rounded())
            config.height = Int((CGFloat(display.height) * scale).rounded())
            config.showsCursor = false
            config.captureResolution = .best
            let img = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            guard writePNG(img, to: args.path) else {
                box.value = ["ok": false, "mode": "shot", "error": "Could not write \(args.path)"]
                sem.signal()
                return
            }
            box.value = [
                "ok": true, "mode": "shot", "path": args.path,
                "w": img.width, "h": img.height,
                "x": Int(bounds.minX.rounded()), "y": Int(bounds.minY.rounded()),
                "scaleFactor": Double(CGFloat(img.width) / max(1, bounds.width)),
                "display": Int(display.displayID),
            ]
        } catch {
            box.value = ["ok": false, "mode": "shot", "error": "\(error)".replacingOccurrences(of: "\n", with: " ")]
        }
        sem.signal()
    }
    // 6s is far past the measured 88–119ms; it only exists so a wedged WindowServer still produces
    // a JSON line instead of a hang the caller has to SIGKILL.
    if sem.wait(timeout: .now() + 6) == .timedOut {
        fail("shot", "ScreenCaptureKit timed out.")
    }
    emit(box.value)
}

func runCrop() -> Never {
    if args.input.isEmpty || args.path.isEmpty { fail("crop", "crop needs --in and --path.") }
    guard FileManager.default.fileExists(atPath: args.input) else { fail("crop", "No such capture: \(args.input)") }
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args.input) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("crop", "Could not read \(args.input)") }
    // Clamp, so a target near an edge still produces a legal rect. PIXELS of the input image.
    let cw = min(args.w, img.width)
    let ch = min(args.h, img.height)
    if cw <= 0 || ch <= 0 { fail("crop", "crop needs positive --w and --h.") }
    let cx = max(0, min(Int(args.x ?? 0), img.width - cw))
    let cy = max(0, min(Int(args.y ?? 0), img.height - ch))
    guard let out = img.cropping(to: CGRect(x: cx, y: cy, width: cw, height: ch)) else { fail("crop", "Crop failed.") }
    guard writePNG(out, to: args.path) else { fail("crop", "Could not write \(args.path)") }
    emit(["ok": true, "mode": "crop", "path": args.path, "w": cw, "h": ch, "x": cx, "y": cy])
}

// ------------------------------------------------------------------ dispatch

switch args.mode {
case "windows": emitWindows()
case "permissions": runPermissions()
case "name": runName()
case "at-point", "from-point": runAtPoint()
case "shot": runShot()
case "crop": runCrop()
default: fail(args.mode, "Unknown mode \(args.mode)")
}
