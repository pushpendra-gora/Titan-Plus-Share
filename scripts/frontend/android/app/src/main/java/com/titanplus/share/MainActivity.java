package com.titanplus.share;

import android.Manifest;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.activity.OnBackPressedCallback;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

import android.content.ContentValues;
import android.content.SharedPreferences;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.DataOutputStream;

public class MainActivity extends BridgeActivity {

    private static final int PERMISSION_REQ_CODE = 200;
    private static final int FILE_CHOOSER_REQ_CODE = 3001;
    private static final int NATIVE_PICK_FILE_REQ = 3002;
    private static final int NATIVE_PICK_MEDIA_REQ = 3003;
    private static final int NATIVE_PICK_FOLDER_REQ = 3004;
    private static final String CHANNEL_ID = "titan_plus_share_channel";
    private static String pendingShareJson = null;
    private static String pendingNotificationTransfer = null;
    private static volatile boolean isAppInForeground = false;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Clean up old temporary shared files older than 24h
        new Thread(() -> {
            try {
                File cacheDir = getCacheDir();
                if (cacheDir != null && cacheDir.exists()) {
                    File[] files = cacheDir.listFiles();
                    if (files != null) {
                        long now = System.currentTimeMillis();
                        for (File f : files) {
                            if (f.getName().startsWith("shared_") || f.getName().startsWith("titan_part_")) {
                                if (now - f.lastModified() > 86400000L) {
                                    f.delete();
                                }
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }).start();

        // 1. Create Android Notification Channel
        createNotificationChannel();

        // 2. Request camera, storage, and notification permissions
        requestAppPermissions();

        // 3. Enable WebRTC Camera Access & Native JS Bridge
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setAllowFileAccess(true);
            webView.getSettings().setAllowContentAccess(true);
            webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }

            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                                ActivityCompat.requestPermissions(MainActivity.this, new String[]{ Manifest.permission.CAMERA }, PERMISSION_REQ_CODE);
                            }
                        }
                        request.grant(request.getResources());
                    });
                }

                @Override
                public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                    if (MainActivity.this.filePathCallback != null) {
                        MainActivity.this.filePathCallback.onReceiveValue(null);
                        MainActivity.this.filePathCallback = null;
                    }
                    MainActivity.this.filePathCallback = filePathCallback;

                    try {
                        Intent intent = fileChooserParams.createIntent();
                        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                        startActivityForResult(intent, FILE_CHOOSER_REQ_CODE);
                    } catch (Exception e) {
                        Intent fallback = new Intent(Intent.ACTION_GET_CONTENT);
                        fallback.addCategory(Intent.CATEGORY_OPENABLE);
                        fallback.setType("*/*");
                        fallback.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                        startActivityForResult(Intent.createChooser(fallback, "Select File"), FILE_CHOOSER_REQ_CODE);
                    }
                    return true;
                }

                @Override
                public boolean onConsoleMessage(android.webkit.ConsoleMessage consoleMessage) {
                    android.util.Log.d("TitanWeb", consoleMessage.message() + " -- Line " + consoleMessage.lineNumber());
                    return true;
                }
            });

            // Native bridge for notifications and direct file saving
            webView.addJavascriptInterface(new TitanNativeBridge(), "TitanNativeBridge");
        }

        // 4. Android Hardware & Gesture Back Button Handler
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            private long lastBackPressTime = 0;

            @Override
            public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "(function() { " +
                        "  if (window.handleTitanBackPress && typeof window.handleTitanBackPress === 'function') { " +
                        "    return window.handleTitanBackPress() === true; " +
                        "  } " +
                        "  return false; " +
                        "})();",
                        result -> {
                            if ("true".equals(result)) {
                                // Handled by web app (closed modal, scanner, or navigated to home)
                                return;
                            }
                            // At root Home view with nothing open: double tap back to exit
                            runOnUiThread(() -> {
                                long now = System.currentTimeMillis();
                                if (now - lastBackPressTime < 2000) {
                                    finish();
                                } else {
                                    lastBackPressTime = now;
                                    Toast.makeText(MainActivity.this, "Press back again to exit", Toast.LENGTH_SHORT).show();
                                }
                            });
                        }
                    );
                } else {
                    finish();
                }
            }
        });

        handleSendIntent(getIntent());
        startBackgroundTransferMonitor();
    }

    @Override
    public void onResume() {
        super.onResume();
        isAppInForeground = true;
        checkAndDeliverNotificationTransfer(getIntent());
    }

    @Override
    public void onPause() {
        super.onPause();
        isAppInForeground = false;
    }

    private void checkAndDeliverNotificationTransfer(Intent intent) {
        if (intent != null && intent.hasExtra("INCOMING_TRANSFER_JSON")) {
            String json = intent.getStringExtra("INCOMING_TRANSFER_JSON");
            intent.removeExtra("INCOMING_TRANSFER_JSON");
            if (json != null && !json.trim().isEmpty()) {
                pendingNotificationTransfer = json;
                runOnUiThread(() -> {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        getBridge().getWebView().evaluateJavascript(
                            "(function() { " +
                            "  try { " +
                            "    var payload = " + json + "; " +
                            "    if (window.handleIncomingNotificationTransfer) { " +
                            "      window.handleIncomingNotificationTransfer(payload); " +
                            "    } else { " +
                            "      window.dispatchEvent(new CustomEvent('titan-open-incoming-transfer', { detail: payload })); " +
                            "    } " +
                            "  } catch(e) {} " +
                            "})();",
                            null
                        );
                    }
                });
            }
        }
    }

    private void startBackgroundTransferMonitor() {
        new Thread(() -> {
            while (!isFinishing()) {
                try {
                    Thread.sleep(2500);
                } catch (InterruptedException e) {
                    break;
                }

                // If app is in foreground, WebSocket handles instant transfer directly
                if (isAppInForeground) continue;

                SharedPreferences prefs = getSharedPreferences("titan_prefs", MODE_PRIVATE);
                String serverUrl = prefs.getString("server_url", null);
                String deviceId = prefs.getString("device_id", null);

                if (serverUrl == null || serverUrl.isEmpty() || serverUrl.contains("127.0.0.1") || serverUrl.contains("localhost")) {
                    continue;
                }

                HttpURLConnection conn = null;
                try {
                    String devParam = deviceId != null ? URLEncoder.encode(deviceId, "UTF-8") : "";
                    URL url = new URL(serverUrl + "/api/transfer/pending?deviceId=" + devParam + "&deviceType=mobile");
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(2500);
                    conn.setReadTimeout(3000);
                    conn.setRequestMethod("GET");

                    if (conn.getResponseCode() == 200) {
                        InputStream is = conn.getInputStream();
                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                        byte[] buf = new byte[4096];
                        int n;
                        while ((n = is.read(buf)) != -1) baos.write(buf, 0, n);
                        String resp = baos.toString("UTF-8");
                        JSONArray arr = new JSONArray(resp);
                        if (arr.length() > 0) {
                            JSONObject item = arr.getJSONObject(0);
                            String trId = item.optString("transferId");
                            String lastNotifiedId = prefs.getString("last_notified_tr_id", "");
                            if (!trId.equals(lastNotifiedId)) {
                                prefs.edit().putString("last_notified_tr_id", trId).apply();
                                showTransferNotification(item);
                            }
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }

    private void showTransferNotification(JSONObject item) {
        try {
            String sender = item.optString("senderName", "Windows PC");
            String fileName = item.optString("fileName", "File");
            long fileSize = item.optLong("fileSize", 0);
            String type = item.optString("transferType", "file");
            String sizeFormatted = fileSize > 0 ? formatFileSize(fileSize) : "";

            String title = "text".equals(type) ? "Incoming Text Note from " + sender : "Incoming File: " + fileName;
            String content = "text".equals(type) 
                ? "From " + sender + " • Tap to open and view note" 
                : (sizeFormatted.isEmpty() ? "" : sizeFormatted + " • ") + "Tap to receive immediately";

            Intent intent = new Intent(MainActivity.this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra("INCOMING_TRANSFER_JSON", item.toString());

            PendingIntent pendingIntent = PendingIntent.getActivity(
                MainActivity.this, (int) System.currentTimeMillis(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(MainActivity.this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(content)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setVibrate(new long[]{ 0, 350, 150, 350 });

            NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (notificationManager != null) {
                notificationManager.notify(7788, builder.build());
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private static String formatFileSize(long bytes) {
        if (bytes <= 0) return "0 B";
        final String[] units = new String[] { "B", "KB", "MB", "GB", "TB" };
        int digitGroups = (int) (Math.log10(bytes) / Math.log10(1024));
        if (digitGroups >= units.length) digitGroups = units.length - 1;
        return String.format(java.util.Locale.US, "%.1f %s", bytes / Math.pow(1024, digitGroups), units[digitGroups]);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQ_CODE) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data.getData() != null) {
                        results = new Uri[]{ data.getData() };
                    }
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
        } else if (requestCode == NATIVE_PICK_FILE_REQ || requestCode == NATIVE_PICK_MEDIA_REQ) {
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    for (int i = 0; i < count; i++) {
                        processIncomingFileUri(data.getClipData().getItemAt(i).getUri());
                    }
                } else if (data.getData() != null) {
                    processIncomingFileUri(data.getData());
                }
            }
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            CharSequence name = "Titan Plus Share";
            String description = "Transfer and file notifications";
            int importance = NotificationManager.IMPORTANCE_HIGH;
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, name, importance);
            channel.setDescription(description);
            channel.enableVibration(true);
            channel.enableLights(true);

            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void requestAppPermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ActivityCompat.requestPermissions(this, new String[]{
                    Manifest.permission.CAMERA,
                    Manifest.permission.POST_NOTIFICATIONS,
                    Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO
                }, PERMISSION_REQ_CODE);
            } else {
                ActivityCompat.requestPermissions(this, new String[]{
                    Manifest.permission.CAMERA,
                    Manifest.permission.READ_EXTERNAL_STORAGE,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE
                }, PERMISSION_REQ_CODE);
            }
        }
    }

    public class TitanNativeBridge {
        @JavascriptInterface
        public void setSavedServerConfig(String serverUrl, String deviceId) {
            try {
                SharedPreferences prefs = getSharedPreferences("titan_prefs", MODE_PRIVATE);
                prefs.edit()
                    .putString("server_url", serverUrl)
                    .putString("device_id", deviceId)
                    .apply();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String getPendingNotificationTransfer() {
            String pending = pendingNotificationTransfer;
            pendingNotificationTransfer = null;
            return pending != null ? pending : "";
        }

        @JavascriptInterface
        public void showNotification(String title, String message) {
            try {
                Intent intent = new Intent(MainActivity.this, MainActivity.class);
                intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent pendingIntent = PendingIntent.getActivity(
                    MainActivity.this, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
                );

                NotificationCompat.Builder builder = new NotificationCompat.Builder(MainActivity.this, CHANNEL_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(title)
                    .setContentText(message)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent)
                    .setDefaults(NotificationCompat.DEFAULT_ALL);

                NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (notificationManager != null) {
                    notificationManager.notify((int) System.currentTimeMillis(), builder.build());
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        @JavascriptInterface
        public boolean saveBase64ToDownloads(String base64Data, String fileName) {
            try {
                if (fileName == null || fileName.trim().isEmpty()) fileName = "file_" + System.currentTimeMillis();
                fileName = new File(fileName).getName().replaceAll("[\\\\/:*?\"<>|]", "_");
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                String extension = MimeTypeMap.getFileExtensionFromUrl(fileName);
                String mimeType = extension != null ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase()) : "application/octet-stream";
                if (mimeType == null) mimeType = "application/octet-stream";

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        Uri queryUri = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                        String selection = MediaStore.Downloads.DISPLAY_NAME + " = ? AND " + MediaStore.Downloads.RELATIVE_PATH + " LIKE ?";
                        String[] selectionArgs = new String[]{ fileName, "%TitanPlusShare%" };
                        getContentResolver().delete(queryUri, selection, selectionArgs);
                    } catch (Exception ignored) {}

                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/TitanPlusShare");

                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                            out.write(bytes);
                            out.flush();
                        }
                        showNotification("File Saved!", fileName + " saved to Downloads/TitanPlusShare");
                        return true;
                    }
                }

                File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File targetDir = new File(downloadDir, "TitanPlusShare");
                if (!targetDir.exists()) targetDir.mkdirs();

                File targetFile = new File(targetDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                    fos.write(bytes);
                    fos.flush();
                }

                MediaScannerConnection.scanFile(MainActivity.this, new String[]{targetFile.getAbsolutePath()}, null, null);
                showNotification("File Saved!", fileName + " saved to Downloads/TitanPlusShare");
                return true;
            } catch (Exception e) {
                e.printStackTrace();
                return false;
            }
        }

        private volatile boolean isDownloadCancelled = false;

        @JavascriptInterface
        public void cancelActiveDownload() {
            isDownloadCancelled = true;
        }

        @JavascriptInterface
        public void downloadDirect(final String fileUrl, final String fileName) {
            isDownloadCancelled = false;
            new Thread(() -> {
                HttpURLConnection conn = null;
                InputStream in = null;
                FileOutputStream out = null;
                File tempPartFile = null;
                try {
                    URL url = new URL(fileUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(120000);
                    conn.setInstanceFollowRedirects(true);
                    conn.setRequestProperty("Accept-Encoding", "identity");
                    conn.connect();

                    int responseCode = conn.getResponseCode();
                    if (responseCode == HttpURLConnection.HTTP_MOVED_PERM ||
                        responseCode == HttpURLConnection.HTTP_MOVED_TEMP ||
                        responseCode == 307 || responseCode == 308) {
                        String newLoc = conn.getHeaderField("Location");
                        if (newLoc != null && !newLoc.isEmpty()) {
                            conn.disconnect();
                            url = new URL(newLoc);
                            conn = (HttpURLConnection) url.openConnection();
                            conn.setConnectTimeout(15000);
                            conn.setReadTimeout(120000);
                            conn.setInstanceFollowRedirects(true);
                            conn.setRequestProperty("Accept-Encoding", "identity");
                            conn.connect();
                            responseCode = conn.getResponseCode();
                        }
                    }
                    if (responseCode >= 200 && responseCode < 300) {
                        long fileLength = -1;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                            fileLength = conn.getContentLengthLong();
                        } else {
                            String header = conn.getHeaderField("Content-Length");
                            if (header != null) {
                                try { fileLength = Long.parseLong(header); } catch (Exception ignored) {}
                            }
                        }

                        // Use temporary file in cache to prevent fragmented/broken files in Downloads
                        File cacheDir = getExternalCacheDir() != null ? getExternalCacheDir() : getCacheDir();
                        if (!cacheDir.exists()) cacheDir.mkdirs();
                        tempPartFile = new File(cacheDir, "titan_part_" + System.currentTimeMillis() + ".tmp");
                        if (tempPartFile.exists()) tempPartFile.delete();

                        in = conn.getInputStream();
                        out = new FileOutputStream(tempPartFile);

                        byte[] buffer = new byte[131072]; // 128 KB buffer for fast high-speed transfer
                        long total = 0;
                        int count;
                        long lastReport = 0;
                        long startTime = System.currentTimeMillis();

                        while (!isDownloadCancelled && (count = in.read(buffer)) != -1) {
                            total += count;
                            out.write(buffer, 0, count);

                            long now = System.currentTimeMillis();
                            if (now - lastReport > 250) {
                                lastReport = now;
                                final int pct = fileLength > 0 ? (int) Math.min(99, (total * 100L) / fileLength) : 0;
                                final long currentLoaded = total;
                                final long currentTotal = fileLength;
                                final double elapsedSec = Math.max(0.1, (now - startTime) / 1000.0);
                                final double mbps = (currentLoaded / (1024.0 * 1024.0)) / elapsedSec;
                                final String speedStr = String.format(java.util.Locale.US, "%.1f MB/s", mbps);

                                runOnUiThread(() -> {
                                    if (getBridge() != null && getBridge().getWebView() != null) {
                                        getBridge().getWebView().evaluateJavascript(
                                            "window.dispatchEvent(new CustomEvent('titan-native-download-progress', { detail: { percent: " + pct + ", loaded: " + currentLoaded + ", total: " + currentTotal + ", speed: '" + speedStr + "' } }));",
                                            null
                                        );
                                    }
                                });
                            }
                        }

                        out.flush();
                        out.close();
                        out = null;

                        if (isDownloadCancelled) {
                            if (tempPartFile != null && tempPartFile.exists()) tempPartFile.delete();
                            return;
                        }

                        // STRICT INTEGRITY CHECK: Reject incomplete / truncated transfers
                        if (fileLength > 0 && total < fileLength) {
                            if (tempPartFile != null && tempPartFile.exists()) tempPartFile.delete();
                            final long transferred = total;
                            final long expected = fileLength;
                            runOnUiThread(() -> {
                                if (getBridge() != null && getBridge().getWebView() != null) {
                                    getBridge().getWebView().evaluateJavascript(
                                        "window.dispatchEvent(new CustomEvent('titan-native-download-error', { detail: { error: 'Transfer incomplete: received " + transferred + " of " + expected + " bytes' } }));",
                                        null
                                    );
                                }
                            });
                            return;
                        }

                        if (total == 0) {
                            if (tempPartFile != null && tempPartFile.exists()) tempPartFile.delete();
                            runOnUiThread(() -> {
                                if (getBridge() != null && getBridge().getWebView() != null) {
                                    getBridge().getWebView().evaluateJavascript(
                                        "window.dispatchEvent(new CustomEvent('titan-native-download-error', { detail: { error: 'Empty file received from server' } }));",
                                        null
                                    );
                                }
                            });
                            return;
                        }

                        // Complete & Verified: Now safely copy/move to public Downloads/TitanPlusShare (NO CORRUPT FRAGMENTS)
                        String safeFileName = new File(fileName).getName().replaceAll("[\\\\/:*?\"<>|]", "_");
                        String extension = MimeTypeMap.getFileExtensionFromUrl(safeFileName);
                        String mimeType = extension != null ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase()) : "application/octet-stream";
                        if (mimeType == null) mimeType = "application/octet-stream";

                        boolean savedSuccess = false;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            // First clean up any existing duplicate file with the exact same name in TitanPlusShare
                            try {
                                Uri queryUri = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                                String selection = MediaStore.Downloads.DISPLAY_NAME + " = ? AND " + MediaStore.Downloads.RELATIVE_PATH + " LIKE ?";
                                String[] selectionArgs = new String[]{ safeFileName, "%TitanPlusShare%" };
                                getContentResolver().delete(queryUri, selection, selectionArgs);
                            } catch (Exception ignored) {}

                            ContentValues values = new ContentValues();
                            values.put(MediaStore.Downloads.DISPLAY_NAME, safeFileName);
                            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/TitanPlusShare");
                            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                            if (uri != null) {
                                try (OutputStream destOut = getContentResolver().openOutputStream(uri);
                                     FileInputStream fis = new FileInputStream(tempPartFile)) {
                                    byte[] buf = new byte[131072];
                                    int r;
                                    while ((r = fis.read(buf)) != -1) {
                                        destOut.write(buf, 0, r);
                                    }
                                    destOut.flush();
                                    savedSuccess = true;
                                }
                            }
                        }

                        if (!savedSuccess) {
                            File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                            File targetDir = new File(downloadDir, "TitanPlusShare");
                            if (!targetDir.exists()) targetDir.mkdirs();
                            File targetFile = new File(targetDir, safeFileName);
                            if (targetFile.exists()) targetFile.delete();
                            tempPartFile.renameTo(targetFile);
                            MediaScannerConnection.scanFile(MainActivity.this, new String[]{targetFile.getAbsolutePath()}, null, null);
                            savedSuccess = true;
                        }

                        // Clean up temporary part file
                        if (tempPartFile != null && tempPartFile.exists()) {
                            tempPartFile.delete();
                        }

                        showNotification("Download Complete!", safeFileName + " saved to Downloads/TitanPlusShare");
                        runOnUiThread(() -> {
                            if (getBridge() != null && getBridge().getWebView() != null) {
                                getBridge().getWebView().evaluateJavascript(
                                    "window.dispatchEvent(new CustomEvent('titan-native-download-complete', { detail: { fileName: '" + safeFileName.replace("'", "\\'") + "' } }));",
                                    null
                                );
                            }
                        });
                    } else {
                        if (tempPartFile != null && tempPartFile.exists()) tempPartFile.delete();
                        final int finalCode = responseCode;
                        runOnUiThread(() -> {
                            if (getBridge() != null && getBridge().getWebView() != null) {
                                getBridge().getWebView().evaluateJavascript(
                                    "window.dispatchEvent(new CustomEvent('titan-native-download-error', { detail: { error: 'Server returned HTTP " + finalCode + "' } }));",
                                    null
                                );
                            }
                        });
                    }
                } catch (Exception e) {
                    if (tempPartFile != null && tempPartFile.exists()) tempPartFile.delete();
                    final String err = e.getMessage() != null ? e.getMessage() : "Download error";
                    runOnUiThread(() -> {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().evaluateJavascript(
                                "window.dispatchEvent(new CustomEvent('titan-native-download-error', { detail: { error: '" + err.replace("'", "\\'") + "' } }));",
                                null
                            );
                        }
                    });
                } finally {
                    try { if (in != null) in.close(); } catch (Exception ignored) {}
                    try { if (out != null) out.close(); } catch (Exception ignored) {}
                    if (conn != null) conn.disconnect();
                    if (isDownloadCancelled && tempPartFile != null && tempPartFile.exists()) {
                        tempPartFile.delete();
                    }
                }
            }).start();
        }

        @JavascriptInterface
        public void downloadViaManager(String downloadUrl, String fileName, String title) {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(downloadUrl));
                request.setTitle(title != null ? title : fileName);
                request.setDescription("Downloading via Titan Plus Share");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "TitanPlusShare/" + fileName);
                request.setAllowedOverMetered(true);
                request.setAllowedOverRoaming(true);

                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager != null) {
                    manager.enqueue(request);
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        private volatile boolean isUploadCancelled = false;

        @JavascriptInterface
        public void cancelActiveUpload() {
            isUploadCancelled = true;
        }

        @JavascriptInterface
        public void uploadDirect(final String filePath, final String targetUrl, final String originalName, final String senderId, final String senderName) {
            isUploadCancelled = false;
            new Thread(() -> {
                HttpURLConnection conn = null;
                FileInputStream fis = null;
                OutputStream os = null;
                try {
                    File file = new File(filePath);
                    if (!file.exists() || !file.canRead()) {
                        dispatchUploadError("Cannot read file: " + filePath);
                        return;
                    }
                    long fileLength = file.length();
                    String boundary = "TitanBoundary" + System.currentTimeMillis();
                    String lineEnd = "\r\n";
                    String twoHyphens = "--";

                    URL url = new URL(targetUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(300000);
                    conn.setDoInput(true);
                    conn.setDoOutput(true);
                    conn.setUseCaches(false);
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Connection", "Keep-Alive");
                    conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                    conn.setChunkedStreamingMode(131072);

                    os = conn.getOutputStream();
                    DataOutputStream dos = new DataOutputStream(os);

                    if (senderId != null) {
                        dos.writeBytes(twoHyphens + boundary + lineEnd);
                        dos.writeBytes("Content-Disposition: form-data; name=\"senderId\"" + lineEnd + lineEnd);
                        dos.write(senderId.getBytes("UTF-8"));
                        dos.writeBytes(lineEnd);
                    }
                    if (senderName != null) {
                        dos.writeBytes(twoHyphens + boundary + lineEnd);
                        dos.writeBytes("Content-Disposition: form-data; name=\"senderName\"" + lineEnd + lineEnd);
                        dos.write(senderName.getBytes("UTF-8"));
                        dos.writeBytes(lineEnd);
                    }
                    dos.writeBytes(twoHyphens + boundary + lineEnd);
                    dos.writeBytes("Content-Disposition: form-data; name=\"originalName\"" + lineEnd + lineEnd);
                    dos.write(originalName.getBytes("UTF-8"));
                    dos.writeBytes(lineEnd);

                    dos.writeBytes(twoHyphens + boundary + lineEnd);
                    dos.writeBytes("Content-Disposition: form-data; name=\"file\"; filename=\"" + originalName + "\"" + lineEnd);
                    dos.writeBytes("Content-Type: application/octet-stream" + lineEnd + lineEnd);
                    dos.flush();

                    fis = new FileInputStream(file);
                    byte[] buffer = new byte[131072];
                    long total = 0;
                    int count;
                    long lastReport = 0;
                    long startTime = System.currentTimeMillis();

                    while (!isUploadCancelled && (count = fis.read(buffer)) != -1) {
                        dos.write(buffer, 0, count);
                        total += count;

                        long now = System.currentTimeMillis();
                        if (now - lastReport > 250) {
                            lastReport = now;
                            final int pct = fileLength > 0 ? (int) Math.min(99, (total * 100L) / fileLength) : 0;
                            final long currentLoaded = total;
                            final double elapsedSec = Math.max(0.1, (now - startTime) / 1000.0);
                            final double mbps = (currentLoaded / (1024.0 * 1024.0)) / elapsedSec;
                            final String speedStr = String.format(java.util.Locale.US, "%.1f MB/s", mbps);

                            runOnUiThread(() -> {
                                if (getBridge() != null && getBridge().getWebView() != null) {
                                    getBridge().getWebView().evaluateJavascript(
                                        "window.dispatchEvent(new CustomEvent('titan-native-upload-progress', { detail: { percent: " + pct + ", loaded: " + currentLoaded + ", total: " + fileLength + ", speed: '" + speedStr + "' } }));",
                                        null
                                    );
                                }
                            });
                        }
                    }

                    dos.writeBytes(lineEnd);
                    dos.writeBytes(twoHyphens + boundary + twoHyphens + lineEnd);
                    dos.flush();

                    if (isUploadCancelled) {
                        return;
                    }

                    int respCode = conn.getResponseCode();
                    if (respCode >= 200 && respCode < 300) {
                        showNotification("Sent successfully!", originalName + " sent to Laptop");
                        runOnUiThread(() -> {
                            if (getBridge() != null && getBridge().getWebView() != null) {
                                try {
                                    JSONObject detail = new JSONObject();
                                    detail.put("fileName", originalName);
                                    getBridge().getWebView().evaluateJavascript(
                                        "window.dispatchEvent(new CustomEvent('titan-native-upload-complete', { detail: " + detail.toString() + " }));",
                                        null
                                    );
                                } catch (Exception ignored) {}
                            }
                        });
                    } else {
                        dispatchUploadError("Server returned HTTP " + respCode);
                    }
                } catch (Exception e) {
                    dispatchUploadError(e.getMessage() != null ? e.getMessage() : "Upload error");
                } finally {
                    try { if (fis != null) fis.close(); } catch (Exception ignored) {}
                    try { if (os != null) os.close(); } catch (Exception ignored) {}
                    if (conn != null) conn.disconnect();
                }
            }).start();
        }

        private void dispatchUploadError(final String errMsg) {
            runOnUiThread(() -> {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    try {
                        JSONObject detail = new JSONObject();
                        detail.put("error", errMsg);
                        getBridge().getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('titan-native-upload-error', { detail: " + detail.toString() + " }));",
                            null
                        );
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void openNativeFilePicker() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(Intent.createChooser(intent, "Choose Files to Share"), NATIVE_PICK_FILE_REQ);
            });
        }

        @JavascriptInterface
        public void openNativeMediaPicker() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
                intent.setType("image/*,video/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(Intent.createChooser(intent, "Choose Photos or Videos"), NATIVE_PICK_MEDIA_REQ);
            });
        }

        @JavascriptInterface
        public void openNativeFolderPicker() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(Intent.createChooser(intent, "Select Files to Share"), NATIVE_PICK_FILE_REQ);
            });
        }

        @JavascriptInterface
        public String getPendingSharedItem() {
            String item = pendingShareJson;
            pendingShareJson = null;
            return item;
        }

        @JavascriptInterface
        public String readCachedFileBase64(String path) {
            try {
                if (path == null) return null;
                File f = new File(path);
                if (!f.exists() || !f.canRead()) return null;
                long len = f.length();
                if (len > 35 * 1024 * 1024) return null; // Protect memory on huge files
                byte[] bytes = new byte[(int) len];
                try (FileInputStream fis = new FileInputStream(f)) {
                    int offset = 0;
                    int numRead = 0;
                    while (offset < bytes.length && (numRead = fis.read(bytes, offset, bytes.length - offset)) >= 0) {
                        offset += numRead;
                    }
                }
                return Base64.encodeToString(bytes, Base64.NO_WRAP);
            } catch (Exception e) {
                e.printStackTrace();
                return null;
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleSendIntent(intent);
        checkAndDeliverNotificationTransfer(intent);
    }

    private void handleSendIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            if ("text/plain".equals(type) || type.startsWith("text/")) {
                String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (sharedText != null && !sharedText.trim().isEmpty()) {
                    try {
                        JSONObject obj = new JSONObject();
                        obj.put("type", "text");
                        obj.put("name", "Shared Note");
                        obj.put("size", sharedText.length());
                        obj.put("text", sharedText);
                        pendingShareJson = obj.toString();
                    } catch (Exception ignored) {}
                    dispatchToWeb("text", sharedText, "Shared Note", 0);
                }
            } else {
                Uri fileUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (fileUri != null) {
                    processIncomingFileUri(fileUri);
                }
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action) && type != null) {
            try {
                java.util.ArrayList<Uri> fileUris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (fileUris != null && !fileUris.isEmpty()) {
                    for (Uri uri : fileUris) {
                        processIncomingFileUri(uri);
                    }
                }
            } catch (Exception ignored) {}
        }
    }

    private void processIncomingFileUri(Uri fileUri) {
        String[] nameAndSize = getFileNameAndSize(fileUri);
        String rawName = nameAndSize[0];
        String fileName = rawName != null ? new File(rawName).getName().replaceAll("[\\\\/:*?\"<>|]", "_") : "Shared_File";
        long fileSize = 0;
        try {
            fileSize = Long.parseLong(nameAndSize[1]);
        } catch (Exception ignored) {}

        File cacheFile = new File(getCacheDir(), "shared_" + System.currentTimeMillis() + "_" + fileName);
        try (InputStream in = getContentResolver().openInputStream(fileUri);
             FileOutputStream out = new FileOutputStream(cacheFile)) {
            byte[] buf = new byte[65536];
            int read;
            while (in != null && (read = in.read(buf)) != -1) {
                out.write(buf, 0, read);
            }
            if (fileSize <= 0) fileSize = cacheFile.length();
        } catch (Exception e) {
            e.printStackTrace();
        }

        try {
            JSONObject obj = new JSONObject();
            obj.put("type", "file");
            obj.put("name", fileName);
            obj.put("size", fileSize);
            obj.put("cachePath", cacheFile.getAbsolutePath());
            pendingShareJson = obj.toString();
        } catch (Exception ignored) {}

        dispatchToWeb("file", cacheFile.getAbsolutePath(), fileName, fileSize);
    }

    private String[] getFileNameAndSize(Uri uri) {
        String displayName = "Shared_File";
        long size = 0;
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameIndex != -1) displayName = cursor.getString(nameIndex);
                if (sizeIndex != -1) size = cursor.getLong(sizeIndex);
            }
        } catch (Exception ignored) {}
        return new String[]{displayName, String.valueOf(size)};
    }

    private void dispatchToWeb(String itemType, String payload, String name, long size) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().post(() -> {
                try {
                    JSONObject detail = new JSONObject();
                    detail.put("type", itemType);
                    detail.put("payload", payload);
                    detail.put("name", name);
                    detail.put("size", size);
                    String js = "window.dispatchEvent(new CustomEvent('incoming-share', { detail: " + detail.toString() + " }));";
                    getBridge().getWebView().evaluateJavascript(js, null);
                } catch (Exception ignored) {}
            });
        }
    }
}
