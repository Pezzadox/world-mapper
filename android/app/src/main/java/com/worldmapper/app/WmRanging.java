package com.worldmapper.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.ParcelUuid;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONException;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Phone-to-phone distance measuring over Bluetooth Low Energy.
 *
 * Every World Mapper phone does two things at once while a measurement is running:
 * it advertises its own short id, and it listens for other phones advertising theirs.
 * The strength of the signal received (RSSI) falls off with distance, so a run of
 * samples gives a rough distance. Rough is the right word: a few metres at best. It is
 * enough for the "these two phones were near each other" links the map is built from,
 * and it owes nothing to GPS or to any assumption about the shape of the planet.
 */
@CapacitorPlugin(
    name = "WmRanging",
    permissions = {
        @Permission(alias = "bluetooth", strings = {
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_CONNECT
        })
    }
)
public class WmRanging extends Plugin {

    // The service id every World Mapper phone advertises under, so phones find each other and nothing else.
    private static final UUID SERVICE = UUID.fromString("7707d0b2-5f3a-4b7e-9c21-9f5b1e4a0001");

    private BluetoothAdapter adapter;
    private BluetoothLeScanner scanner;
    private BluetoothLeAdvertiser advertiser;
    private ScanCallback scanCallback;
    private AdvertiseCallback advertiseCallback;

    /** id seen -> every RSSI sample taken of it during this run */
    private final Map<String, List<Integer>> seen = new HashMap<>();

    @Override
    public void load() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (m != null) adapter = m.getAdapter();
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        boolean on = adapter != null && adapter.isEnabled();
        r.put("available", on);
        r.put("canAdvertise", on && adapter.isMultipleAdvertisementSupported());
        r.put("reason", adapter == null ? "no bluetooth on this phone" : (!on ? "bluetooth is switched off" : ""));
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (adapter == null || !adapter.isEnabled()) { call.reject("Bluetooth is off"); return; }
        if (getPermissionState("bluetooth") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "afterPermission");
            return;
        }
        begin(call);
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("bluetooth") == com.getcapacitor.PermissionState.GRANTED) begin(call);
        else call.reject("Bluetooth permission refused");
    }

    private void begin(PluginCall call) {
        String id = call.getString("id", "");
        synchronized (seen) { seen.clear(); }
        try {
            advertiser = adapter.getBluetoothLeAdvertiser();
            if (advertiser != null) {
                AdvertiseSettings settings = new AdvertiseSettings.Builder()
                    .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                    .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                    .setConnectable(false)
                    .build();
                // The phone's short id travels as the service data: six characters, nothing else about the phone.
                AdvertiseData data = new AdvertiseData.Builder()
                    .addServiceUuid(new ParcelUuid(SERVICE))
                    .addServiceData(new ParcelUuid(SERVICE), id.getBytes(StandardCharsets.UTF_8))
                    .setIncludeDeviceName(false)
                    .build();
                advertiseCallback = new AdvertiseCallback() { };
                advertiser.startAdvertising(settings, data, advertiseCallback);
            }

            scanner = adapter.getBluetoothLeScanner();
            List<ScanFilter> filters = Collections.singletonList(
                new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build());
            ScanSettings scanSettings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();
            scanCallback = new ScanCallback() {
                @Override
                public void onScanResult(int type, ScanResult result) {
                    byte[] payload = result.getScanRecord() == null ? null
                        : result.getScanRecord().getServiceData(new ParcelUuid(SERVICE));
                    if (payload == null || payload.length == 0) return;
                    String other = new String(payload, StandardCharsets.UTF_8).trim();
                    if (other.isEmpty() || other.equals(id)) return;
                    synchronized (seen) {
                        List<Integer> list = seen.get(other);
                        if (list == null) { list = new ArrayList<>(); seen.put(other, list); }
                        if (list.size() < 400) list.add(result.getRssi());
                    }
                }
            };
            scanner.startScan(filters, scanSettings, scanCallback);
            JSObject r = new JSObject();
            r.put("started", true);
            r.put("advertising", advertiser != null);
            call.resolve(r);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission refused");
        } catch (Exception e) {
            call.reject("Could not start: " + e.getMessage());
        }
    }

    /** Hands back every phone seen in this run with its RSSI samples; the distance maths is done in JavaScript. */
    @PluginMethod
    public void results(PluginCall call) {
        JSArray out = new JSArray();
        synchronized (seen) {
            for (Map.Entry<String, List<Integer>> e : seen.entrySet()) {
                JSObject o = new JSObject();
                o.put("id", e.getKey());
                JSArray samples = new JSArray();
                for (Integer v : e.getValue()) samples.put(v);
                try { o.put("rssi", samples); } catch (Exception ignored) { }
                out.put(o);
            }
        }
        JSObject r = new JSObject();
        try { r.put("peers", out); } catch (Exception ignored) { }
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try { if (scanner != null && scanCallback != null) scanner.stopScan(scanCallback); } catch (Exception ignored) { }
        try { if (advertiser != null && advertiseCallback != null) advertiser.stopAdvertising(advertiseCallback); } catch (Exception ignored) { }
        scanCallback = null; advertiseCallback = null;
        call.resolve();
    }

    /** Signals that the phone is not what it claims to be. Not proof of cheating, just worth recording. */
    @PluginMethod
    public void deviceChecks(PluginCall call) {
        JSObject r = new JSObject();
        boolean emulator = Build.FINGERPRINT.startsWith("generic")
            || Build.FINGERPRINT.toLowerCase().contains("vbox")
            || Build.FINGERPRINT.toLowerCase().contains("emulator")
            || Build.MODEL.contains("Emulator")
            || Build.MODEL.contains("Android SDK built for")
            || "google_sdk".equals(Build.PRODUCT);
        boolean debuggable = (getContext().getApplicationInfo().flags
            & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        boolean mockAllowed = false;
        try {
            mockAllowed = !android.provider.Settings.Secure.getString(
                getContext().getContentResolver(), "mock_location").equals("0");
        } catch (Exception ignored) { }
        r.put("emulator", emulator);
        r.put("debuggable", debuggable);
        r.put("mockLocationAllowed", mockAllowed);
        r.put("platform", "android");
        call.resolve(r);
    }
}
