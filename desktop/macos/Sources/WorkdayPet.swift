import AppKit
import CoreFoundation
import Darwin
import WebKit

private let websiteURL = URL(string: "http://www.chatlocalhost.com/")!
private let showNotification = Notification.Name("com.workdayclub.pet.show")

@MainActor
private final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor
private final class PetWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

private struct NativeDragRegion {
    let rect: NSRect
    let petClick: Bool
}

@MainActor
private final class NativeDragOverlay: NSView {
    var regions: [NativeDragRegion] = []
    var exclusions: [NSRect] = []
    var disabled = false
    var onBegin: ((NSPoint, Bool) -> Void)?
    var onMove: ((NSPoint) -> Void)?
    var onEnd: ((NSPoint) -> Void)?
    var screenLocation: () -> NSPoint = { NSEvent.mouseLocation }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    func region(at point: NSPoint) -> NativeDragRegion? {
        guard !disabled, bounds.contains(point), !exclusions.contains(where: { $0.contains(point) }) else { return nil }
        return regions.first { $0.rect.contains(point) }
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        // AppKit supplies superview coordinates; the overlay uses CSS-style top origin.
        region(at: convert(point, from: superview)) == nil ? nil : self
    }

    @discardableResult
    func begin(at point: NSPoint, screenPoint: NSPoint) -> Bool {
        guard let region = region(at: point) else { return false }
        onBegin?(screenPoint, region.petClick)
        return true
    }

    func move(to point: NSPoint) { onMove?(point) }
    func end(at point: NSPoint) { onEnd?(point) }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        begin(at: point, screenPoint: screenLocation())
    }

    override func mouseDragged(with event: NSEvent) {
        // Reading Cocoa screen coordinates avoids stale window-local points after moving.
        move(to: screenLocation())
    }

    override func mouseUp(with event: NSEvent) { end(at: screenLocation()) }

    override func resetCursorRects() {
        guard !disabled else { return }
        for region in regions {
            var pieces = [region.rect.intersection(bounds)]
            for exclusion in exclusions {
                pieces = pieces.flatMap { rect -> [NSRect] in
                    let overlap = rect.intersection(exclusion)
                    guard !overlap.isEmpty, !overlap.isNull else { return [rect] }
                    return [
                        NSRect(x: rect.minX, y: rect.minY, width: rect.width, height: max(0, overlap.minY - rect.minY)),
                        NSRect(x: rect.minX, y: overlap.maxY, width: rect.width, height: max(0, rect.maxY - overlap.maxY)),
                        NSRect(x: rect.minX, y: overlap.minY, width: max(0, overlap.minX - rect.minX), height: overlap.height),
                        NSRect(x: overlap.maxX, y: overlap.minY, width: max(0, rect.maxX - overlap.maxX), height: overlap.height),
                    ].filter { !$0.isEmpty }
                }
            }
            for piece in pieces where !piece.isEmpty && !piece.isNull { addCursorRect(piece, cursor: .openHand) }
        }
    }
}

private struct NativeDragSession {
    let screenStart: NSPoint
    let windowStart: NSPoint
    let petClick: Bool
    var maxDistance: CGFloat = 0
}

@MainActor
private final class WeakPetMessageHandler: NSObject, WKScriptMessageHandler {
    weak var owner: PetApplicationDelegate?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receive(message)
    }
}

@MainActor
private final class PetApplicationDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let selfTest: Bool
    private let referencePreview: Bool
    private let snapshotURL: URL?
    private let defaults = UserDefaults.standard
    private var panel: PetPanel!
    private var webView: WKWebView!
    private var dragOverlay: NativeDragOverlay!
    private var webRoot: URL!
    private var statusItem: NSStatusItem?
    private var visibilityItem: NSMenuItem?
    private var topItem: NSMenuItem?
    private var mouseMonitor: Any?
    private var showObserver: NSObjectProtocol?
    private var screenObserver: NSObjectProtocol?
    private var passthroughTimer: Timer?
    private var pendingSave: DispatchWorkItem?
    private var hitRegions: [NSRect] = []
    private var nativeDrag: NativeDragSession?
    private var pendingDragLayout: [String: Any]?
    private var lastAcceptedLayout: [String: Any]?
    private var presentation = "card"
    private var draggingCursorPushed = false
    private var hasModal = false
    private var isDragging = false
    private var receivedLayout = false
    private var awaitingFirstLayout = true
    private var finishedSelfTest = false
    private var alwaysOnTop = true
    private var settingsPreviousApplication: NSRunningApplication?
    private var activatedForSettings = false
    private var isTerminating = false
    private var selfTestSettingsCompleted = false
    private var selfTestSettingsChecks: [String: Any] = [:]
    private var selfTestQuitRequests = 0
    private var selfTestFocusRequests = 0
    private var settingsTest: Bool { selfTest && CommandLine.arguments.contains("--settings-test") }
    private var dragTest: Bool { selfTest && CommandLine.arguments.contains("--drag-test") }
    private var selfTestDragCompleted = false
    private var selfTestDragChecks: [String: Any] = [:]
    private var selfTestLastDragOutcome: (dragged: Bool, petClick: Bool)?

    init(selfTest: Bool, referencePreview: Bool, snapshotURL: URL?) {
        self.selfTest = selfTest
        self.referencePreview = selfTest && referencePreview
        self.snapshotURL = selfTest ? snapshotURL : nil
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            if selfTest { finishSelfTest(false, reason: "Bundled Web/index.html is missing.") }
            else { showStartupError("没有找到桌面宠物的页面资源，请重新运行 desktop/macos/build.sh。") }
            return
        }
        webRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        alwaysOnTop = selfTest || defaults.object(forKey: "alwaysOnTop") == nil || defaults.bool(forKey: "alwaysOnTop")
        createPanel()
        createWebView()
        if !selfTest {
            createMainMenu()
            createStatusItem()
            installEventMonitoring()
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
                self?.finishSelfTest(false, reason: "Timed out waiting for the bundled pet page.")
            }
        }
        webView.loadFileURL(webRoot.appendingPathComponent("index.html"), allowingReadAccessTo: webRoot)
    }

    private func createPanel() {
        let initial = NSRect(x: 0, y: 0, width: 404, height: 660)
        panel = PetPanel(contentRect: initial, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "陪班小橘"
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = false
        panel.isMovable = true
        panel.isMovableByWindowBackground = false
        panel.acceptsMouseMovedEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.level = alwaysOnTop ? .floating : .normal
        panel.delegate = self
        var frame = initial
        if !selfTest && defaults.bool(forKey: "hasSavedOrigin") {
            let x = defaults.double(forKey: "originX")
            let y = defaults.double(forKey: "originY")
            if x.isFinite && y.isFinite { frame.origin = NSPoint(x: x, y: y) }
        } else if let screen = screenUnderMouse() {
            frame.origin = NSPoint(x: screen.visibleFrame.maxX - frame.width - 28, y: screen.visibleFrame.minY + 24)
        }
        panel.setFrame(constrainedFrame(frame), display: false)
    }

    private func createWebView() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = selfTest ? .nonPersistent() : .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        if referencePreview {
            let fixture = """
            (() => {
                const NativeDate = Date;
                const timestamp = new NativeDate(2026, 10, 3, 17, 3, 27).getTime();
                class PreviewDate extends NativeDate {
                    constructor(...args) { super(...(args.length ? args : [timestamp])); }
                    static now() { return timestamp; }
                }
                globalThis.Date = PreviewDate;
                try {
                    localStorage.setItem('workday-pay:v1', JSON.stringify({
                        dailyPay: 10, start: '08:00', end: '17:30',
                        breakEnabled: true, breakStart: '12:00', breakEnd: '14:00',
                        workdays: [1, 2, 3, 4, 5]
                    }));
                } catch (_) {}
            })()
            """
            configuration.userContentController.addUserScript(WKUserScript(source: fixture, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let handler = WeakPetMessageHandler()
        handler.owner = self
        configuration.userContentController.add(handler, name: "petNative")
        let host = NSView(frame: panel.contentView!.bounds)
        panel.contentView = host
        webView = PetWebView(frame: host.bounds, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.underPageBackgroundColor = .clear
        webView.setValue(false, forKey: "drawsBackground")
        host.addSubview(webView)
        dragOverlay = NativeDragOverlay(frame: host.bounds)
        dragOverlay.autoresizingMask = [.width, .height]
        dragOverlay.onBegin = { [weak self] point, petClick in self?.beginNativeDrag(at: point, petClick: petClick) }
        dragOverlay.onMove = { [weak self] point in self?.continueNativeDrag(to: point) }
        dragOverlay.onEnd = { [weak self] point in self?.endNativeDrag(at: point) }
        host.addSubview(dragOverlay, positioned: .above, relativeTo: webView)
    }

    private func createMainMenu() {
        let main = NSMenu()
        let applicationItem = NSMenuItem(title: "上班鼓励器", action: nil, keyEquivalent: "")
        let applicationMenu = NSMenu(title: "上班鼓励器")
        applicationMenu.addItem(item("退出上班鼓励器", #selector(quit), key: "q"))
        applicationItem.submenu = applicationMenu
        main.addItem(applicationItem)

        let editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        for (title, selector, key, modifiers) in [
            ("撤销", "undo:", "z", NSEvent.ModifierFlags.command),
            ("重做", "redo:", "z", [.command, .shift]),
            ("剪切", "cut:", "x", .command),
            ("复制", "copy:", "c", .command),
            ("粘贴", "paste:", "v", .command),
            ("全选", "selectAll:", "a", .command),
        ] {
            let command = NSMenuItem(title: title, action: Selector(selector), keyEquivalent: key)
            command.keyEquivalentModifierMask = modifiers
            command.target = nil
            editMenu.addItem(command)
        }
        editItem.submenu = editMenu
        main.addItem(editItem)

        let windowItem = NSMenuItem(title: "窗口", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(item("关闭窗口", #selector(closeCurrentWindow), key: "w"))
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.mainMenu = main
    }

    private func createStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem?.button?.image = NSImage(systemSymbolName: "pawprint.fill", accessibilityDescription: "陪班小橘")
        statusItem?.button?.toolTip = "上班鼓励器 · 陪班小橘"
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "上班鼓励器", action: nil, keyEquivalent: ""))
        visibilityItem = item("隐藏小橘", #selector(toggleVisibility))
        menu.addItem(visibilityItem!)
        menu.addItem(item("工资卡片", #selector(showSalary)))
        menu.addItem(item("宠物模式", #selector(showPet)))
        menu.addItem(item("听一句鼓励", #selector(showEncouragement)))
        menu.addItem(item("收起宠物", #selector(collapsePanel)))
        menu.addItem(.separator())
        topItem = item("始终置顶", #selector(toggleAlwaysOnTop))
        topItem?.state = alwaysOnTop ? .on : .off
        menu.addItem(topItem!)
        menu.addItem(item("放回屏幕右下角", #selector(resetPosition)))
        menu.addItem(item("打开网页能量站", #selector(openWebsite)))
        menu.addItem(.separator())
        menu.addItem(item("退出小橘", #selector(quit), key: "q"))
        statusItem?.menu = menu
    }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    private func installEventMonitoring() {
        mouseMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            MainActor.assumeIsolated {
                if let self, event.window === self.panel {
                    if self.hasModal { self.focusSettings() }
                }
            }
            return event
        }
        let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateMousePassthrough() }
        }
        timer.tolerance = 0.015
        RunLoop.main.add(timer, forMode: .common)
        passthroughTimer = timer
        showObserver = DistributedNotificationCenter.default().addObserver(forName: showNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.showPanel() }
        }
        screenObserver = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.panel.setFrame(self.constrainedFrame(self.panel.frame), display: true)
                self.runJavaScript("window.WorkdayDesktop?.refreshLayout()")
            }
        }
    }

    private func updateMousePassthrough() {
        guard panel != nil, panel.isVisible else { return }
        if isDragging || hasModal || presentation == "card" { panel.ignoresMouseEvents = false; return }
        let location = NSEvent.mouseLocation
        let topPoint = NSPoint(x: location.x - panel.frame.minX, y: panel.frame.maxY - location.y)
        let inside = panel.frame.contains(location) && hitRegions.contains { $0.contains(topPoint) }
        panel.ignoresMouseEvents = !inside
    }

    func receive(_ message: WKScriptMessage) {
        guard !isTerminating, message.name == "petNative", message.frameInfo.isMainFrame,
              message.webView === webView,
              let source = message.frameInfo.request.url, isBundledURL(source),
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "layout": receiveLayout(body)
        case "hide": hidePanel()
        case "focusSettings":
            if settingsTest { selfTestFocusRequests += 1 }
            focusSettings()
        case "quit":
            if settingsTest { selfTestQuitRequests += 1 }
            if !selfTest { quit() }
        case "openWebsite": if !selfTest { openWebsite() }
        default: break
        }
    }

    private func finiteNumber(_ value: Any?) -> CGFloat? {
        guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else { return nil }
        return CGFloat(value.doubleValue)
    }

    private func receiveLayout(_ body: [String: Any]) {
        if isDragging { pendingDragLayout = body; return }
        guard let width = finiteNumber(body["width"]), let height = finiteNumber(body["height"]), width > 0, height > 0 else { return }
        lastAcceptedLayout = body
        let visible = bestScreen(for: panel.frame)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let newSize = NSSize(width: min(max(width, 220), min(500, visible.width - 24)), height: min(max(height, 100), visible.height - 24))
        var frame = panel.frame
        let rightEdge = frame.maxX
        frame.size = newSize
        frame.origin.x = rightEdge - newSize.width
        frame = constrainedFrame(frame)
        if abs(frame.width - panel.frame.width) > 0.5 || abs(frame.height - panel.frame.height) > 0.5 || frame.origin != panel.frame.origin {
            panel.setFrame(frame, display: true)
        }
        let previouslyModal = hasModal
        hasModal = body["modal"] as? Bool == true
        presentation = body["presentation"] as? String == "pet" ? "pet" : "card"
        hitRegions = readRects(body["regions"])
        dragOverlay.regions = (body["dragRegions"] as? [[String: Any]] ?? []).prefix(64).compactMap { region in
            guard let rect = readRect(region) else { return nil }
            return NativeDragRegion(rect: rect, petClick: region["pet"] as? Bool == true)
        }
        dragOverlay.exclusions = readRects(body["exclusions"])
        dragOverlay.disabled = hasModal
        panel.invalidateCursorRects(for: dragOverlay)
        receivedLayout = true
        updateMousePassthrough()
        scheduleOriginSave()
        if awaitingFirstLayout && !selfTest {
            showPanel()
        }
        if hasModal && !previouslyModal {
            focusSettings()
        } else if previouslyModal && !hasModal {
            releaseSettingsFocus()
        }
    }

    private func readRect(_ value: [String: Any]) -> NSRect? {
        guard let x = finiteNumber(value["x"]), let y = finiteNumber(value["y"]),
              let width = finiteNumber(value["width"]), let height = finiteNumber(value["height"]), width > 0, height > 0 else { return nil }
        let rect = NSRect(x: x, y: y, width: width, height: height).intersection(NSRect(origin: .zero, size: panel.frame.size))
        return rect.isEmpty || rect.isNull ? nil : rect
    }

    private func readRects(_ value: Any?) -> [NSRect] {
        (value as? [[String: Any]] ?? []).prefix(64).compactMap(readRect)
    }

    private func focusSettings() {
        guard !selfTest, !isTerminating, hasModal, panel != nil, panel.isVisible else { return }
        panel.ignoresMouseEvents = false
        // A nonactivating panel can float over another app without owning its keyboard.
        // Acquire keyboard focus for the settings form, rather than for each layout tick.
        if !NSApp.isActive {
            if let previous = NSWorkspace.shared.frontmostApplication,
               previous.processIdentifier != ProcessInfo.processInfo.processIdentifier {
                settingsPreviousApplication = previous
                activatedForSettings = true
            }
            NSApp.activate(ignoringOtherApps: true)
        }
        guard !panel.isKeyWindow else { return }
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(webView)
        DispatchQueue.main.async { [weak self] in
            guard let self, self.hasModal, !self.isTerminating, self.panel.isKeyWindow else { return }
            self.runJavaScript("window.WorkdayDesktop?.focusSettings()")
        }
    }

    private func releaseSettingsFocus() {
        guard !selfTest else { return }
        let previous = settingsPreviousApplication
        let shouldRestore = activatedForSettings
            && NSWorkspace.shared.frontmostApplication?.processIdentifier == ProcessInfo.processInfo.processIdentifier
        settingsPreviousApplication = nil
        activatedForSettings = false
        panel?.resignKey()
        // If the user has already switched apps, leave that choice alone.
        if shouldRestore, let previous, !previous.isTerminated {
            previous.activate(options: [])
        }
    }

    private func beginNativeDrag(at point: NSPoint, petClick: Bool) {
        guard !isDragging, !hasModal, !isTerminating else { return }
        nativeDrag = NativeDragSession(screenStart: point, windowStart: panel.frame.origin, petClick: petClick)
        isDragging = true
        panel.ignoresMouseEvents = false
        if !selfTest { NSCursor.closedHand.push(); draggingCursorPushed = true }
        runJavaScript("window.WorkdayDesktop?.dragStarted?.()")
    }

    private func continueNativeDrag(to point: NSPoint) {
        guard var drag = nativeDrag else { return }
        let delta = NSPoint(x: point.x - drag.screenStart.x, y: point.y - drag.screenStart.y)
        drag.maxDistance = max(drag.maxDistance, hypot(delta.x, delta.y))
        nativeDrag = drag
        if drag.maxDistance >= 3 {
            panel.setFrameOrigin(NSPoint(x: drag.windowStart.x + delta.x, y: drag.windowStart.y + delta.y))
        }
    }

    private func endNativeDrag(at point: NSPoint) {
        guard nativeDrag != nil else { return }
        continueNativeDrag(to: point)
        guard let drag = nativeDrag else { return }
        nativeDrag = nil
        isDragging = false
        if draggingCursorPushed { NSCursor.pop(); draggingCursorPushed = false }
        let dragged = drag.maxDistance >= 3
        panel.setFrame(constrainedFrame(panel.frame), display: true)
        if let latest = pendingDragLayout {
            pendingDragLayout = nil
            receiveLayout(latest)
        }
        saveOrigin()
        if selfTest { selfTestLastDragOutcome = (dragged, drag.petClick) }
        runJavaScript("window.WorkdayDesktop?.dragEnded(\(dragged), \(drag.petClick))")
        runJavaScript("window.WorkdayDesktop?.refreshLayout(true)")
        panel.invalidateCursorRects(for: dragOverlay)
        updateMousePassthrough()
    }

    private func screenUnderMouse() -> NSScreen? {
        NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main ?? NSScreen.screens.first
    }

    private func bestScreen(for frame: NSRect) -> NSScreen? {
        let candidates = NSScreen.screens.map { screen -> (NSScreen, CGFloat) in
            let overlap = screen.visibleFrame.intersection(frame)
            return (screen, overlap.isNull ? 0 : overlap.width * overlap.height)
        }
        if let best = candidates.max(by: { $0.1 < $1.1 }), best.1 > 0 { return best.0 }
        return screenUnderMouse()
    }

    private func constrainedFrame(_ frame: NSRect) -> NSRect {
        guard let visible = bestScreen(for: frame)?.visibleFrame else { return frame }
        var result = frame
        result.size.width = min(result.width, max(100, visible.width - 24))
        result.size.height = min(result.height, max(100, visible.height - 24))
        result.origin.x = min(max(result.minX, visible.minX + 12), max(visible.minX + 12, visible.maxX - result.width - 12))
        result.origin.y = min(max(result.minY, visible.minY + 12), max(visible.minY + 12, visible.maxY - result.height - 12))
        return result
    }

    private func scheduleOriginSave() {
        guard !selfTest else { return }
        pendingSave?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveOrigin() }
        pendingSave = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
    }

    private func saveOrigin() {
        guard !selfTest, panel != nil else { return }
        defaults.set(panel.frame.minX, forKey: "originX")
        defaults.set(panel.frame.minY, forKey: "originY")
        defaults.set(true, forKey: "hasSavedOrigin")
    }

    func windowDidMove(_ notification: Notification) { scheduleOriginSave() }
    func windowShouldClose(_ sender: NSWindow) -> Bool { hidePanel(); return false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showPanel(); return false }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    private func showPanel() {
        guard !isTerminating else { return }
        awaitingFirstLayout = false
        panel.ignoresMouseEvents = false
        panel.orderFrontRegardless()
        visibilityItem?.title = "隐藏小橘"
        runJavaScript("window.WorkdayDesktop?.show()")
        runJavaScript("window.WorkdayDesktop?.refreshLayout()")
        if hasModal { focusSettings() }
    }

    private func hidePanel() {
        guard !selfTest else { return }
        awaitingFirstLayout = false
        panel.orderOut(nil)
        releaseSettingsFocus()
        visibilityItem?.title = "显示小橘"
    }

    @objc private func toggleVisibility() { panel.isVisible ? hidePanel() : showPanel() }
    @objc private func showSalary() { showPanel(); runJavaScript("window.WorkdayDesktop?.setView('salary')") }
    @objc private func showPet() { showPanel(); runJavaScript("window.WorkdayDesktop?.setPresentation('pet')") }
    @objc private func showEncouragement() { showPanel(); runJavaScript("window.WorkdayDesktop?.setView('quote')"); runJavaScript("document.getElementById('pet-pat')?.click()") }
    @objc private func collapsePanel() { showPanel(); runJavaScript("window.WorkdayDesktop?.collapse(true)") }
    @objc private func toggleAlwaysOnTop() {
        alwaysOnTop.toggle()
        panel.level = alwaysOnTop ? .floating : .normal
        topItem?.state = alwaysOnTop ? .on : .off
        defaults.set(alwaysOnTop, forKey: "alwaysOnTop")
    }
    @objc private func resetPosition() {
        guard let visible = screenUnderMouse()?.visibleFrame else { return }
        panel.setFrameOrigin(NSPoint(x: visible.maxX - panel.frame.width - 28, y: visible.minY + 24))
        panel.setFrame(constrainedFrame(panel.frame), display: true)
        saveOrigin()
        showPanel()
    }
    @objc private func openWebsite() { NSWorkspace.shared.open(websiteURL) }
    @objc private func closeCurrentWindow() {
        if hasModal {
            runJavaScript("document.querySelector('dialog[open]')?.close()")
        } else {
            hidePanel()
        }
    }
    @objc private func quit() {
        isTerminating = true
        pendingSave?.cancel()
        NSApp.terminate(nil)
    }

    private func runJavaScript(_ script: String) { webView?.evaluateJavaScript(script, completionHandler: nil) }

    private func isBundledURL(_ url: URL) -> Bool {
        guard url.isFileURL, webRoot != nil else { return false }
        return url.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(webRoot.path + "/")
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if isBundledURL(url) { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, ["http", "https"].contains(url.scheme?.lowercased() ?? ""), !selfTest {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
           ["http", "https"].contains(url.scheme?.lowercased() ?? ""), !selfTest {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        runJavaScript("window.WorkdayDesktop?.refreshLayout()")
        if selfTest {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.runSelfTest() }
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if selfTest { finishSelfTest(false, reason: error.localizedDescription) }
        else { showStartupError("本地宠物页面无法加载：\(error.localizedDescription)") }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if selfTest { finishSelfTest(false, reason: error.localizedDescription) }
    }

    private func runSelfTest() {
        guard !finishedSelfTest else { return }
        if settingsTest && !selfTestSettingsCompleted {
            runSettingsSelfTest()
            return
        }
        if dragTest && !selfTestDragCompleted {
            runDragSelfTest()
        }
        let script = """
        (() => {
            const key = '__workday_desktop_native_self_test__';
            let storage = false;
            try { localStorage.setItem(key, 'ok'); storage = localStorage.getItem(key) === 'ok'; localStorage.removeItem(key); } catch (_) {}
            const card = document.getElementById('desktop-salary-card');
            const transparent = (element) => {
                const color = getComputedStyle(element).backgroundColor;
                return color === 'transparent' || /^rgba\\([^,]+,[^,]+,[^,]+,\\s*0(?:\\.0+)?\\)$/.test(color);
            };
            return {
                ready: document.readyState === 'complete',
                bridge: !!window.webkit?.messageHandlers?.petNative,
                adapter: typeof window.WorkdayDesktop?.refreshLayout === 'function' && typeof window.WorkdayDesktop?.setPresentation === 'function',
                desktopMode: document.body.classList.contains('is-desktop-pet'),
                cardMode: document.body.classList.contains('is-desktop-salary'),
                card: !!card && !card.hidden && card.getBoundingClientRect().width > 0,
                money: typeof window.WorkdayMoney?.render === 'function',
                transparentPage: transparent(document.documentElement) && transparent(document.body),
                salary: typeof window.WorkdaySalary?.calculate === 'function',
                pet: !!document.getElementById('pet-pat'),
                settings: !!document.getElementById('pay-form'),
                outputs: document.querySelectorAll('[data-pay]').length,
                earned: document.querySelector('[data-pay="earned"]')?.textContent?.trim(),
                month: document.querySelector('[data-pay="month"]')?.textContent?.trim(),
                storage
            };
        })()
        """
        webView.evaluateJavaScript(script) { [weak self] value, error in
            guard let self else { return }
            if let error { self.finishSelfTest(false, reason: error.localizedDescription); return }
            guard var checks = value as? [String: Any] else { self.finishSelfTest(false, reason: "Invalid page self-test result."); return }
            checks["transparentPanel"] = !self.panel.isOpaque && self.panel.backgroundColor.alphaComponent == 0
            checks["borderless"] = !self.panel.styleMask.contains(.titled)
            checks["floating"] = self.panel.level == .floating
            checks["nativeLayout"] = self.receivedLayout
            var boolKeys = ["ready", "bridge", "adapter", "desktopMode", "cardMode", "card", "money", "transparentPage", "salary", "pet", "settings", "storage", "transparentPanel", "borderless", "floating", "nativeLayout"]
            if self.settingsTest {
                checks.merge(self.selfTestSettingsChecks) { _, new in new }
                checks["settingsFocusBridge"] = self.selfTestFocusRequests > 0
                checks["quitButtonsBridge"] = self.selfTestQuitRequests == 2
                checks["quitRequests"] = self.selfTestQuitRequests
                boolKeys += ["settingsOpened", "timeTextEditable", "timeSecondsEditable", "timeSelectionEdit", "timeSurvivesTick", "settingsSaved", "settingsReopened", "invalidTimeRejected", "invalidSecondsRejected", "legacyMinuteInputNormalized", "secondsRestored", "settingsCloseButton", "settingsCancel", "settingsEscape", "settingsFocusBridge", "quitButtonsBridge"]
            }
            if self.dragTest {
                checks.merge(self.selfTestDragChecks) { _, new in new }
                boolKeys += ["nativeDragEventView", "nativeDragHitRegion", "nativeButtonsExcluded", "nativeDragMovesWindow", "nativeDragEnds", "nativePetTap", "nativeDragThresholdLatch", "nativeModalExcludesDrag", "nativeQueuedLayout", "nativeDragNoPreferenceWrites"]
            }
            if self.referencePreview && !self.settingsTest {
                checks["referenceIncome"] = checks["earned"] as? String == "9.4100" && checks["month"] as? String == "¥19.41"
                boolKeys.append("referenceIncome")
            }
            let passed = boolKeys.allSatisfy { checks[$0] as? Bool == true } && (checks["outputs"] as? Int ?? 0) > 0
            if passed, let snapshotURL = self.snapshotURL {
                self.captureOwnView(to: snapshotURL, checks: checks)
            } else {
                self.finishSelfTest(passed, reason: passed ? "Bundled native salary-card integration passed." : "One or more native salary-card checks failed.", checks: checks)
            }
        }
    }

    private func runDragSelfTest() {
        // Drive the same native NSView event methods with app-local test events.
        // The pointer provider is isolated here: no system cursor or visible UI is moved.
        selfTestDragCompleted = true
        guard let overlay = dragOverlay, let layout = lastAcceptedLayout,
              let first = overlay.regions.first, let host = overlay.superview else {
            selfTestDragChecks = ["nativeDragEventView": false]
            return
        }
        let originalFrame = panel.frame
        let originalRegions = overlay.regions
        let originalExclusions = overlay.exclusions
        let originalModal = hasModal
        let originalDisabled = overlay.disabled
        let preferenceKeys = ["originX", "originY", "hasSavedOrigin"]
        func preferences() -> NSDictionary {
            NSDictionary(dictionary: Dictionary(uniqueKeysWithValues: preferenceKeys.map { ($0, defaults.object(forKey: $0) ?? NSNull()) }))
        }
        let beforePreferences = preferences()
        let candidates = [0.5, 0.25, 0.75].flatMap { y in
            [0.5, 0.25, 0.75].map { x in NSPoint(x: first.rect.minX + first.rect.width * x, y: first.rect.minY + first.rect.height * y) }
        }
        guard let point = candidates.first(where: { overlay.region(at: $0) != nil }) else {
            selfTestDragChecks = ["nativeDragHitRegion": false]
            return
        }
        var pointer = panel.convertPoint(toScreen: overlay.convert(point, to: nil))
        overlay.screenLocation = { pointer }
        defer {
            overlay.screenLocation = { NSEvent.mouseLocation }
            overlay.regions = originalRegions
            overlay.exclusions = originalExclusions
            overlay.disabled = originalDisabled
            hasModal = originalModal
            receiveLayout(layout)
            panel.setFrame(originalFrame, display: false)
            panel.invalidateCursorRects(for: overlay)
        }
        func event(_ type: NSEvent.EventType) -> NSEvent? {
            NSEvent.mouseEvent(with: type, location: overlay.convert(point, to: nil), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: panel.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1)
        }
        guard let down = event(.leftMouseDown), let move = event(.leftMouseDragged), let up = event(.leftMouseUp) else {
            selfTestDragChecks = ["nativeDragEventView": false]
            return
        }
        var checks: [String: Any] = [:]
        checks["nativeDragEventView"] = overlay.acceptsFirstMouse(for: down)
        checks["nativeDragHitRegion"] = overlay.hitTest(overlay.convert(point, to: host)) === overlay
        checks["nativeButtonsExcluded"] = originalExclusions.count >= 2 && originalExclusions.allSatisfy {
            overlay.hitTest(overlay.convert(NSPoint(x: $0.midX, y: $0.midY), to: host)) == nil
        }

        let firstPointer = pointer
        let firstOrigin = panel.frame.origin
        overlay.mouseDown(with: down)
        let started = isDragging && nativeDrag != nil
        pointer = NSPoint(x: firstPointer.x + 37, y: firstPointer.y + 19)
        overlay.mouseDragged(with: move)
        checks["nativeDragMovesWindow"] = started && abs(panel.frame.minX - firstOrigin.x - 37) < 0.1 && abs(panel.frame.minY - firstOrigin.y - 19) < 0.1

        var queuedLayout = layout
        queuedLayout["width"] = originalFrame.width - 6
        let beforeWidth = panel.frame.width
        receiveLayout(queuedLayout)
        let deferred = pendingDragLayout != nil && panel.frame.width == beforeWidth
        overlay.mouseUp(with: up)
        checks["nativeDragEnds"] = !isDragging && nativeDrag == nil && selfTestLastDragOutcome?.dragged == true
        checks["nativeQueuedLayout"] = deferred && pendingDragLayout == nil && abs(panel.frame.width - (originalFrame.width - 6)) < 0.1

        receiveLayout(layout)
        panel.setFrame(originalFrame, display: false)
        overlay.regions = [NativeDragRegion(rect: first.rect, petClick: true)]
        pointer = firstPointer
        overlay.mouseDown(with: down)
        pointer = NSPoint(x: firstPointer.x + 1, y: firstPointer.y + 1)
        overlay.mouseUp(with: up)
        checks["nativePetTap"] = selfTestLastDragOutcome?.dragged == false && selfTestLastDragOutcome?.petClick == true

        pointer = firstPointer
        overlay.mouseDown(with: down)
        pointer = NSPoint(x: firstPointer.x + 20, y: firstPointer.y)
        overlay.mouseDragged(with: move)
        pointer = firstPointer
        overlay.mouseDragged(with: move)
        overlay.mouseUp(with: up)
        checks["nativeDragThresholdLatch"] = selfTestLastDragOutcome?.dragged == true && selfTestLastDragOutcome?.petClick == true

        hasModal = true
        overlay.disabled = true
        overlay.mouseDown(with: down)
        checks["nativeModalExcludesDrag"] = overlay.hitTest(overlay.convert(point, to: host)) == nil && !isDragging
        checks["nativeDragNoPreferenceWrites"] = beforePreferences.isEqual(preferences())
        selfTestDragChecks = checks
    }

    private func runSettingsSelfTest() {
        // Exercise the app's own WebKit editor and handlers in temporary storage.
        // This does not synthesize OS input or activate a visible native window.
        let script = """
        const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const dialog = document.getElementById('pay-dialog');
        const form = document.getElementById('pay-form');
        const start = document.getElementById('pay-start');
        const open = () => document.querySelector('#desktop-salary-card [data-open-pay-settings]').click();
        const checks = {};
        open();
        checks.settingsOpened = dialog.open;
        checks.timeSecondsEditable = ['pay-start', 'pay-end', 'pay-break-start', 'pay-break-end'].every((id) => {
            const input = document.getElementById(id);
            return input.type === 'text' && input.maxLength === 8 && /^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(input.value);
        });
        start.focus();
        checks.timeTextEditable = start.type === 'text' && !start.disabled && !start.readOnly && document.activeElement === start;
        start.select();
        let inserted = false;
        try { inserted = document.execCommand('insertText', false, '8:30:15'); } catch (_) {}
        checks.insertTextCommand = inserted;
        if (!inserted || start.value !== '8:30:15') {
            start.setSelectionRange(0, start.value.length);
            start.setRangeText('8:30:15', 0, start.value.length, 'end');
            start.dispatchEvent(new Event('input', { bubbles: true }));
        }
        checks.timeSelectionEdit = start.value === '8:30:15';
        await delay(1100);
        checks.timeSurvivesTick = start.value === '8:30:15' && document.activeElement === start;
        form.requestSubmit();
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem('workday-pay:v1') || '{}'); } catch (_) {}
        checks.editedTime = saved.start || '';
        checks.settingsSaved = !dialog.open && saved.start === '08:30:15';
        open();
        checks.settingsReopened = dialog.open && start.value === '08:30:15';
        start.value = '08:30:60';
        checks.invalidSecondsRejected = !start.checkValidity();
        start.value = '25:99';
        checks.invalidTimeRejected = !start.checkValidity();
        start.value = '8:30';
        form.requestSubmit();
        try { saved = JSON.parse(localStorage.getItem('workday-pay:v1') || '{}'); } catch (_) {}
        checks.legacyMinuteInputNormalized = !dialog.open && saved.start === '08:30:00';
        open();
        start.value = '8:30:15';
        form.requestSubmit();
        try { saved = JSON.parse(localStorage.getItem('workday-pay:v1') || '{}'); } catch (_) {}
        checks.secondsRestored = !dialog.open && saved.start === '08:30:15';
        checks.editedTime = saved.start || '';
        open();
        document.getElementById('pay-close').click();
        checks.settingsCloseButton = !dialog.open;
        open();
        document.getElementById('pay-cancel').click();
        checks.settingsCancel = !dialog.open;
        open();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        checks.settingsEscape = !dialog.open;
        document.getElementById('desktop-card-close').click();
        document.getElementById('pet-hide').click();
        await delay(150);
        return checks;
        """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self, !self.finishedSelfTest else { return }
            switch result {
            case .success(let value):
                guard let checks = value as? [String: Any] else {
                    self.finishSelfTest(false, reason: "Invalid settings editor self-test result.")
                    return
                }
                self.selfTestSettingsChecks = checks
                self.selfTestSettingsCompleted = true
                self.runSelfTest()
            case .failure(let error):
                self.finishSelfTest(false, reason: "Settings editor self-test failed: \(error.localizedDescription)")
            }
        }
    }

    private func captureOwnView(to url: URL, checks: [String: Any]) {
        let configuration = WKSnapshotConfiguration()
        configuration.rect = webView.bounds
        configuration.snapshotWidth = NSNumber(value: Double(webView.bounds.width))
        configuration.afterScreenUpdates = true
        webView.takeSnapshot(with: configuration) { [weak self] image, error in
            guard let self, !self.finishedSelfTest else { return }
            if let error {
                self.finishSelfTest(false, reason: "Own-view snapshot failed: \(error.localizedDescription)", checks: checks)
                return
            }
            guard let image, let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
                  let data = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else {
                self.finishSelfTest(false, reason: "The own-view snapshot did not contain a PNG image.", checks: checks)
                return
            }
            do {
                try data.write(to: url, options: .atomic)
                var result = checks
                result["snapshot"] = url.path
                result["snapshotWidth"] = cgImage.width
                result["snapshotHeight"] = cgImage.height
                self.finishSelfTest(true, reason: "Bundled native salary-card integration and own-view rendering passed.", checks: result)
            } catch {
                self.finishSelfTest(false, reason: "Cannot save own-view PNG: \(error.localizedDescription)", checks: checks)
            }
        }
    }

    private func finishSelfTest(_ success: Bool, reason: String, checks: [String: Any] = [:]) {
        guard !finishedSelfTest else { return }
        finishedSelfTest = true
        let result: [String: Any] = ["success": success, "reason": reason, "checks": checks]
        if let json = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), let text = String(data: json, encoding: .utf8) {
            print(text)
        } else { print(success ? "PASS" : "FAIL") }
        fflush(stdout)
        Darwin.exit(success ? 0 : 1)
    }

    private func showStartupError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "陪班小橘无法启动"
        alert.informativeText = message
        alert.addButton(withTitle: "退出")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        isTerminating = true
        saveOrigin()
        pendingSave?.cancel()
        passthroughTimer?.invalidate()
        if let mouseMonitor { NSEvent.removeMonitor(mouseMonitor) }
        if let showObserver { DistributedNotificationCenter.default().removeObserver(showObserver) }
        if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "petNative")
    }
}

@main
@MainActor
private enum WorkdayPet {
    static func main() {
        let selfTest = CommandLine.arguments.contains("--self-test")
        let referencePreview = selfTest && CommandLine.arguments.contains("--reference-preview")
        var snapshotURL: URL?
        if selfTest, let index = CommandLine.arguments.firstIndex(of: "--snapshot") {
            guard CommandLine.arguments.indices.contains(index + 1), CommandLine.arguments[index + 1].hasPrefix("/") else {
                fputs("--snapshot requires an absolute output PNG path.\n", stderr)
                Darwin.exit(2)
            }
            snapshotURL = URL(fileURLWithPath: CommandLine.arguments[index + 1])
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        if !selfTest, let bundleID = Bundle.main.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).contains(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            DistributedNotificationCenter.default().post(name: showNotification, object: nil)
            return
        }
        let delegate = PetApplicationDelegate(selfTest: selfTest, referencePreview: referencePreview, snapshotURL: snapshotURL)
        app.delegate = delegate
        app.run()
        withExtendedLifetime(delegate) {}
    }
}
