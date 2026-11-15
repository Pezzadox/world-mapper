#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Makes the Swift plugin above visible to Capacitor.
CAP_PLUGIN(WmRanging, "WmRanging",
  CAP_PLUGIN_METHOD(available, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(results, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(deviceChecks, CAPPluginReturnPromise);
)
