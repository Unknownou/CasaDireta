package mz.casadireta.app;

import com.getcapacitor.BridgeActivity;
import android.Manifest;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.media.MediaRecorder;
import android.util.Base64;
import java.io.File;
import java.nio.file.Files;

public class MainActivity extends BridgeActivity {
    private MediaRecorder recorder;
    private File recordingFile;
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                    } else {
                        request.deny();
                    }
                });
            }
        });
        getBridge().getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface public void start() {
                runOnUiThread(() -> {
                    try {
                        recordingFile = new File(getCacheDir(), "casadireta-" + System.currentTimeMillis() + ".m4a");
                        recorder = new MediaRecorder();
                        recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
                        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                        recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                        recorder.setAudioEncodingBitRate(64000);
                        recorder.setAudioSamplingRate(44100);
                        recorder.setOutputFile(recordingFile.getAbsolutePath());
                        recorder.prepare();
                        recorder.start();
                        getBridge().getWebView().evaluateJavascript("window.__nativeAudioStarted && window.__nativeAudioStarted()", null);
                    } catch (Exception e) {
                        recorder = null;
                        getBridge().getWebView().evaluateJavascript("window.__nativeAudioError && window.__nativeAudioError('" + e.getClass().getSimpleName() + "')", null);
                    }
                });
            }
            @JavascriptInterface public void stop() {
                runOnUiThread(() -> {
                    try {
                        if (recorder != null) { recorder.stop(); recorder.release(); recorder = null; }
                        byte[] bytes = Files.readAllBytes(recordingFile.toPath());
                        String data = "data:audio/mp4;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
                        getBridge().getWebView().evaluateJavascript("window.__nativeAudioDone && window.__nativeAudioDone('" + data + "')", null);
                    } catch (Exception e) {
                        if (recorder != null) { try { recorder.reset(); recorder.release(); } catch (Exception ignored) {} recorder = null; }
                        getBridge().getWebView().evaluateJavascript("window.__nativeAudioError && window.__nativeAudioError('" + e.getClass().getSimpleName() + "')", null);
                    }
                });
            }
        }, "CasaDiretaAudio");
    }
}
