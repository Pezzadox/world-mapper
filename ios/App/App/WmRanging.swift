import Foundation
import Capacitor
import CoreBluetooth

/// Phone-to-phone distance measuring over Bluetooth Low Energy.
///
/// The phone advertises its own short World Mapper id and listens for other phones
/// advertising theirs. Signal strength falls off with distance, so a run of samples
/// gives a rough distance between two phones — rough being a few metres at best, which
/// is enough for the close-proximity links the map is built from, and which owes
/// nothing to GPS or to any assumption about the shape of the planet.
@objc(WmRanging)
public class WmRanging: CAPPlugin, CBCentralManagerDelegate, CBPeripheralManagerDelegate {

    // The service id every World Mapper phone advertises under, so phones find each other and nothing else.
    private let service = CBUUID(string: "7707D0B2-5F3A-4B7E-9C21-9F5B1E4A0001")

    private var central: CBCentralManager?
    private var peripheral: CBPeripheralManager?
    private var myId = ""
    private var seen: [String: [Int]] = [:]
    private let lock = NSLock()
    private var pendingStart: CAPPluginCall?

    // MARK: - called from JavaScript

    @objc func available(_ call: CAPPluginCall) {
        let state = central?.state ?? .unknown
        let on = state == .poweredOn
        call.resolve([
            "available": on,
            "canAdvertise": on,
            "reason": state == .poweredOff ? "bluetooth is switched off"
                     : (state == .unauthorized ? "permission not given" : "")
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        myId = call.getString("id") ?? ""
        lock.lock(); seen.removeAll(); lock.unlock()
        pendingStart = call
        // Creating the managers prompts for Bluetooth permission the first time;
        // the delegate callbacks below finish the job once the radio reports ready.
        if central == nil { central = CBCentralManager(delegate: self, queue: nil) }
        if peripheral == nil { peripheral = CBPeripheralManager(delegate: self, queue: nil) }
        beginIfReady()
    }

    @objc func results(_ call: CAPPluginCall) {
        lock.lock()
        let peers = seen.map { ["id": $0.key, "rssi": $0.value] }
        lock.unlock()
        call.resolve(["peers": peers])
    }

    @objc func stop(_ call: CAPPluginCall) {
        central?.stopScan()
        peripheral?.stopAdvertising()
        call.resolve()
    }

    /// Signals that the phone is not what it claims to be. Not proof of cheating, just worth recording.
    @objc func deviceChecks(_ call: CAPPluginCall) {
        var simulator = false
        #if targetEnvironment(simulator)
        simulator = true
        #endif
        var debuggable = false
        #if DEBUG
        debuggable = true
        #endif
        // A jailbroken phone can feed the sensors whatever it likes; a cheap check is enough to note it.
        let jailbreakPaths = ["/Applications/Cydia.app", "/bin/bash", "/usr/sbin/sshd", "/private/var/lib/apt"]
        let jailbroken = jailbreakPaths.contains { FileManager.default.fileExists(atPath: $0) }
        call.resolve([
            "emulator": simulator,
            "debuggable": debuggable,
            "jailbroken": jailbroken,
            "mockLocationAllowed": false,
            "platform": "ios"
        ])
    }

    // MARK: - radio

    private func beginIfReady() {
        guard let call = pendingStart else { return }
        guard central?.state == .poweredOn, peripheral?.state == .poweredOn else { return }
        pendingStart = nil

        central?.scanForPeripherals(
            withServices: [service],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]   // every sighting, so RSSI can be averaged
        )
        peripheral?.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [service],
            CBAdvertisementDataLocalNameKey: myId       // iOS gives no service data in advertisements, so the id rides in the name
        ])
        call.resolve(["started": true, "advertising": true])
    }

    public func centralManagerDidUpdateState(_ cm: CBCentralManager) {
        if cm.state == .poweredOn { beginIfReady() }
        else if let call = pendingStart, cm.state == .poweredOff || cm.state == .unauthorized {
            pendingStart = nil
            call.reject(cm.state == .poweredOff ? "Bluetooth is off" : "Bluetooth permission refused")
        }
    }

    public func peripheralManagerDidUpdateState(_ pm: CBPeripheralManager) {
        if pm.state == .poweredOn { beginIfReady() }
    }

    public func centralManager(_ cm: CBCentralManager, didDiscover p: CBPeripheral,
                               advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? p.name ?? ""
        let other = name.trimmingCharacters(in: .whitespacesAndNewlines)
        // Only World Mapper ids, and never this phone's own.
        guard other.hasPrefix("p-"), other != myId else { return }
        let value = RSSI.intValue
        guard value < 0, value > -127 else { return }       // 127 means "unreadable"
        lock.lock()
        var list = seen[other] ?? []
        if list.count < 400 { list.append(value); seen[other] = list }
        lock.unlock()
    }
}
