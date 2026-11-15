package com.worldmapper.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WmRanging.class);
        super.onCreate(savedInstanceState);
    }
}
