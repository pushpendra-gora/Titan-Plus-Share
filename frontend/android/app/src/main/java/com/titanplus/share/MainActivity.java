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
import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {

    private static final int PERMISSION_REQ_CODE = 200;
    private static final String CHANNEL_ID = "titan_plus_share_channel";
    private static String pendingShareJson = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Create Android Notification Channel
        createNotificationChannel();

        // 2. Request camera, storage, and notification permissions
        requestAppPermissions();

        // 3. Enable WebRTC Camera Access & Native JS Bridge
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);

            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                }
            });

            // Native bridge for notifications and direct file saving
            webView.addJavascriptInterface(new TitanNativeBridge(), "TitanNativeBridge");
        }

        handleSendIntent(getIntent());
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
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
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
        }
    }

    private void processIncomingFileUri(Uri fileUri) {
        String[] nameAndSize = getFileNameAndSize(fileUri);
        String fileName = nameAndSize[0];
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
                String js = String.format(
                    "window.dispatchEvent(new CustomEvent('incoming-share', { detail: { type: '%s', payload: '%s', name: '%s', size: %d } }));",
                    itemType, payload.replace("'", "\\'"), name.replace("'", "\\'"), size
                );
                getBridge().getWebView().evaluateJavascript(js, null);
            });
        }
    }
}
